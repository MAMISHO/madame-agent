import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatCompletionRequest, Message, ToolCallRecord } from '../proxy/dto/openai.dto';
import { RouteResult, RouteMetadata } from './router.service';
import { ProvidersService } from '../providers/providers.service';
import { PromptService } from '../prompts/prompt.service';
import { AgentLoggerService } from '../utils/agent-logger.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ToolLoopService, FatalToolError, UserInteractionRequiredError } from '../tools/tool-loop.service';
import { SkillManagerService } from '../tools/skill-manager.service';
import { SkillScraperService } from '../tools/skill-scraper.service';
import { ValidatorService } from '../tools/validator.service';
import { ObservabilityService } from '../observability/observability.service';
import { HarnessService } from '../harness/harness.service';
import { SessionManager } from './session.manager';
import { ModelResolverService } from './model-resolver.service';
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

const execAsync = promisify(exec);

interface TelemetryEntry {
  iteration: number;
  task: string;
  executorModel: string;
  executorOutputSummary: string;
  qaStatus: 'APPROVED' | 'REJECTED';
  qaFeedback: string;
}

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);
  private pendingRequests = new Map<string, { request: ChatCompletionRequest; pair: any }>();
  private userResponses = new Map<string, string>();

  constructor(
    private configService: ConfigService,
    private providersService: ProvidersService,
    private promptService: PromptService,
    private agentLogger: AgentLoggerService,
    private toolRegistry: ToolRegistryService,
    private toolLoop: ToolLoopService,
    private skillManager: SkillManagerService,
    private skillScraper: SkillScraperService,
    private observability: ObservabilityService,
    private validatorService: ValidatorService,
    private harnessService: HarnessService,
    private sessionManager: SessionManager,
    private modelResolverService: ModelResolverService,
  ) {}

  private isConfirmationMessage(msg: string): boolean {
    if (!msg) return false;
    const clean = msg.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?¿¡!]/g, "");
    const confirmations = [
      'si', 'sí', 'yes', 'ok', 'okay', 'procede', 'proceder', 'dale', 'afirmativo',
      'continuar', 'continua', 'continúa', 'go ahead', 'proceed', 'run', 'ejecutar', 'ejecuta'
    ];
    return confirmations.includes(clean) || (clean.length < 10 && confirmations.some(c => clean.includes(c)));
  }

  async executeWorkflow(
    request: ChatCompletionRequest,
    pair: { id: string; name: string; orchestrator: string; subagents: string[] },
  ): Promise<any> {
    const parentRequestId = request.requestId || `req_${randomUUID().slice(0, 8)}`;
    request.requestId = parentRequestId;
    const harnessName = request.metadata?.harness;
    const strategy = this.harnessService.getStrategy(harnessName);

    const parsed = strategy.parseRequest(request.messages);
    let userMessage = parsed.userMessage;
    if (parsed.isInterventionReply && parsed.interventionAnswer) {
      this.userResponses.set(parentRequestId, parsed.interventionAnswer);
      this.agentLogger.log(
        'System',
        `Detected user response to intervention in history: "${parsed.interventionAnswer}" using strategy "${strategy.name}"`,
        parentRequestId,
      );
    }

    this.agentLogger.log('System', `Executing multi-agent workflow for request: "${userMessage.slice(0, 100)}..."`, parentRequestId);

    const providersConfig = this.configService.get('providers') || {};
    const orchestratorConfig = providersConfig[pair.orchestrator];
    if (!orchestratorConfig) {
      throw new Error(`Orchestrator provider "${pair.orchestrator}" not found for pair "${pair.name}"`);
    }

    const sessionId = request.metadata?.sessionId || 'default-session';
    let session = this.sessionManager.getSession(sessionId);

    if (!session) {
      session = this.sessionManager.createSession(sessionId, userMessage);
    }

    try {
      this.pendingRequests.set(parentRequestId, { request, pair });

      // Identify if we need to run/re-run Preparer or Planner based on session state and user message
      let preparerText = session.preparerReport || '';
      let planText = session.currentPlan || '';

      // 1. Register Custom Executor/QA delegate_subagent tool
      this.registerCustomDelegationTool(pair, parentRequestId, () => preparerText);

      // 1.5. Ollama Lifecycle Check (deterministic, not LLM-dependent)
      await this.ensureOllamaReady(parentRequestId, request, pair);

      // 2. Environment Preparer Agent (Cloud) - Only run if state is NEW
      if (session.state === 'NEW') {
        this.agentLogger.log('Preparer', 'Verifying environment and configuring context...', parentRequestId);
        const preparerPrompt = this.promptService.loadPrompt('preparer');
        const preparerRequest: ChatCompletionRequest = {
          model: pair.orchestrator,
          messages: [
            { role: 'system', content: preparerPrompt },
            { role: 'user', content: `Task: ${userMessage}` },
          ],
          tools: this.toolRegistry.getDefinitions().filter(t => t.function.name !== 'delegate_subagent') as any,
          requestId: `prep_${randomUUID().slice(0, 8)}`,
          parentRequestId,
        };
        const preparerResult = await this.toolLoop.execute(
          preparerRequest,
          orchestratorConfig,
          undefined,
          {
            parentRequestId,
            userResponses: this.userResponses,
          }
        );
        preparerText = preparerResult.response.data?.choices?.[0]?.message?.content || 'Environment ready';
        session = this.sessionManager.updateSession(sessionId, {
          preparerReport: preparerText,
          state: 'PREPARED',
        });
        this.agentLogger.log('Preparer', `Environment Report:\n${preparerText.slice(0, 200)}...`, parentRequestId);
      } else {
        this.agentLogger.log('Preparer', 'Skipped environment verification (cached report used).', parentRequestId);
      }

      // Check if we need to re-run the Planner (Feedback case)
      const isFeedback = session.state !== 'NEW' && session.state !== 'PREPARED' && !this.isConfirmationMessage(userMessage);

      // 3. Planner Agent (Cloud) - Run on PREPARED or if user sends Feedback
      if (session.state === 'PREPARED' || isFeedback) {
        this.agentLogger.log('Planner', isFeedback ? 'Re-evaluating plan based on feedback...' : 'Generating technical implementation plan...', parentRequestId);
        const plannerPrompt = this.promptService.loadPrompt('planner');
        const plannerUserContent = isFeedback
          ? `Original Task: ${session.originalTask}\n\nEnvironment Report:\n${preparerText}\n\nPrevious Plan:\n${planText}\n\nNew User Feedback:\n${userMessage}`
          : `Task: ${session.originalTask}\n\nEnvironment Report:\n${preparerText}`;

        const plannerRequest: ChatCompletionRequest = {
          model: pair.orchestrator,
          messages: [
            { role: 'system', content: plannerPrompt },
            { role: 'user', content: plannerUserContent },
          ],
          requestId: `plan_${randomUUID().slice(0, 8)}`,
          parentRequestId,
        };
        const plannerResponse = await this.providersService.getProvider(orchestratorConfig.type).chat(plannerRequest, orchestratorConfig);
        planText = plannerResponse.data?.choices?.[0]?.message?.content || 'No plan generated';
        
        session = this.sessionManager.updateSession(sessionId, {
          currentPlan: planText,
          state: 'PLANNED',
        });
        
        this.agentLogger.log('Planner', `Plan updated:\n${planText.slice(0, 300)}...`, parentRequestId);
      } else {
        this.agentLogger.log('Planner', 'Skipped plan generation (cached plan used).', parentRequestId);
      }

      // 4. Orchestrator Agent (Cloud) - Main Outer Loop
      this.agentLogger.log('Orchestrator', 'Orchestration loop started.', parentRequestId);
      
      // System instructions for outer Orchestrator
      const orchestratorPrompt = this.promptService.loadPrompt('orchestrator-delegate');
      
      // Construct token-optimized compacted user message
      const userPromptContent = `Original Task: ${session.originalTask}

Environment Status:
${preparerText || 'Not prepared'}

Implementation Plan:
${planText || 'No plan proposed'}

Previous Execution Steps:
${session.executionSummary || 'No execution history yet'}

Latest User Input/Feedback:
${userMessage}`;

      const enrichedMessages: Message[] = [
        { role: 'system', content: orchestratorPrompt },
        { role: 'user', content: userPromptContent },
      ];

      const searchSkills = this.toolRegistry.getDefinitions().find(t => t.function.name === 'search_skills');
      
      const orchestratorRequest: ChatCompletionRequest = {
        model: pair.orchestrator,
        messages: enrichedMessages,
        tools: [
          this.getDelegationToolDefinition(pair.subagents),
          ...(searchSkills ? [searchSkills] : [])
        ],
        requestId: parentRequestId,
        tool_choice: 'required',
      };

      // Run the orchestrator using ToolLoopService
      this.agentLogger.log('Orchestrator', `Executing orchestrator model: "${pair.orchestrator}"`, parentRequestId);
      const startMs = Date.now();
      try {
        const result = await this.toolLoop.execute(orchestratorRequest, orchestratorConfig);
        const endMs = Date.now() - startMs;

        this.agentLogger.log('System', `Workflow completed in ${endMs}ms`, parentRequestId);

        // Update Session executionSummary
        const toolsSummary = result.toolCalls.map(tc => {
          if (tc.name === 'delegate_subagent') {
            return `- Delegated to subagent: "${tc.args?.task}"`;
          }
          return `- Called tool: "${tc.name}"`;
        }).join('\n');
        
        const finalContent = result.response.data?.choices?.[0]?.message?.content || 'No response content';
        const newSummary = `\n[Turn completed in ${endMs}ms]\nTools Executed:\n${toolsSummary || 'None'}\nOutcome: ${finalContent.slice(0, 200)}...`;
        
        this.sessionManager.updateSession(sessionId, {
          state: 'COMPLETED',
          executionSummary: (session.executionSummary || '') + newSummary,
        });

        return {
          response: result.response,
          metadata: {
            mode: 'orchestrator',
            escalated: false,
            providerKey: pair.orchestrator,
            providerType: orchestratorConfig.type,
            model: orchestratorConfig.model,
            originalTokens: Math.ceil(JSON.stringify(request.messages).length / 3.5),
            finalTokens: Math.ceil(JSON.stringify(orchestratorRequest.messages).length / 3.5),
            iterations: result.iterations,
            toolCalls: result.toolCalls,
            toolErrors: result.errors,
          },
        };
      } catch (err: any) {
        const endMs = Date.now() - startMs;
        this.agentLogger.error('System', `Workflow aborted due to fatal error after ${endMs}ms: ${err.message}`, parentRequestId);
        return {
          response: {
            data: {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: `⚠️ **[ERROR DE INFRAESTRUCTURA]** La tarea no pudo completarse debido a un fallo crítico en la comunicación con el proveedor de IA (${orchestratorConfig?.model || 'LLM'}):\n\n\`\`\`\n${err.message}\n\`\`\`\n\nPor favor, comprueba que los servicios locales (como Ollama) estén activos o que la conexión a internet sea estable e inténtalo de nuevo.`,
                  },
                },
              ],
            },
          } as any,
          metadata: {
            mode: 'orchestrator',
            escalated: false,
            providerKey: pair.orchestrator,
            providerType: orchestratorConfig.type,
            model: orchestratorConfig.model,
            originalTokens: 0,
            finalTokens: 0,
            iterations: 0,
            toolCalls: [],
            toolErrors: [err.message],
          },
        };
      }
    } catch (err: any) {
      if (err instanceof UserInteractionRequiredError || err.name === 'UserInteractionRequiredError') {
        this.agentLogger.log('System', `Workflow paused for user interaction: "${err.question}"`, parentRequestId);
        
        // Update Session state and summary
        const newSummary = `\n[Workflow Paused] Asked: "${err.question}"`;
        this.sessionManager.updateSession(sessionId, {
          state: 'EXECUTING',
          executionSummary: (session.executionSummary || '') + newSummary,
        });

        const harnessName = request.metadata?.harness;
        const strategy = this.harnessService.getStrategy(harnessName);
        return strategy.formatInterventionResponse(parentRequestId, err.question, orchestratorConfig);
      }
      throw err;
    }
  }

  async resumeWorkflow(requestId: string, answer: string): Promise<any> {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      throw new Error(`No pending workflow found for request ID: ${requestId}`);
    }
    this.agentLogger.log('System', `Resuming workflow for request ${requestId} with user response: "${answer}"`, requestId);
    this.userResponses.set(requestId, answer);
    return this.executeWorkflow(pending.request, pending.pair);
  }

  private registerCustomDelegationTool(
    pair: { id: string; name: string; orchestrator: string; subagents: string[] },
    parentRequestId: string,
    getPreparerText: () => string
  ) {
    const providersConfig = this.configService.get('providers') || {};
    const orchestratorConfig = providersConfig[pair.orchestrator];
    this.toolRegistry.register({
      definition: this.getDelegationToolDefinition(pair.subagents),
      execute: async (
        args: { task: string; subagent_model?: string; max_iterations?: number; timeout_ms?: number; skills?: string[] },
        context?: { parentSignal?: AbortSignal }
      ) => {
        const subagentRequestId = `sub_${randomUUID().slice(0, 8)}`;
        this.agentLogger.log('Orchestrator', `Delegated Sub-Task: "${args.task.slice(0, 150)}..."`, parentRequestId);

        // Resolve candidate subagents (Executor models)
        let subagentsToTry: string[] = [];
        if (args.subagent_model) {
          subagentsToTry = [args.subagent_model];
        } else {
          subagentsToTry = [...pair.subagents];
        }

        const rawExecutorModel = subagentsToTry[0] || 'local_medium';
        const resolved = await this.modelResolverService.resolveModel(rawExecutorModel, args.task);
        const executorConfig = resolved.config;
        const executorKey = resolved.providerKey;
        let executorModel = executorConfig.model;

        // Get QA model (use the same executorKey to reuse model memory and avoid loading timeouts)
        const providersConfig = this.configService.get('providers') || {};
        const qaModel = executorKey;
        const qaConfig = providersConfig[qaModel];

        let finalResultContent: string | null = null;
        const telemetryHistory: TelemetryEntry[] = [];
        let supervisorOverride: string | null = null;
        let activeSkills = args.skills || [];
        let accumulatedWorkingMemory = '';

        // Max local subagent execution/QA loop budget (defaults to 5)
        const maxSubIterations = args.max_iterations || 5;

        for (let iteration = 1; iteration <= maxSubIterations; iteration++) {
          if (context?.parentSignal?.aborted) {
            throw new Error('Parent execution aborted');
          }

          try {
            this.agentLogger.log('Executor', `Iteration ${iteration}/${maxSubIterations} starting...`, subagentRequestId);

            // 1. Build Executor Prompt
            const basePrompt = this.promptService.loadPrompt('subagent-base');
            let executorSystemContent = basePrompt + '\n\n' + this.promptService.loadPrompt('executor');
            if (supervisorOverride) {
              executorSystemContent += `\n\n=== CRITICAL SUPERVISOR OVERRIDE ===\nThe Transversal Supervisor has issued a mandatory override instruction. You MUST obey this override immediately and prioritize it over other rules.\nOverride Instruction: ${supervisorOverride}\n\n`;
            }
            if (activeSkills.length > 0) {
              executorSystemContent += '\n\n=== RELEVANT SKILLS / KNOWLEDGE ===\n';
              for (const skillName of activeSkills) {
                const content = this.skillManager.getSkillContent(skillName);
                if (content) {
                  executorSystemContent += `\n--- Skill: ${skillName} ---\n${content}\n`;
                }
              }
            }

            let executorInput = `Task: ${args.task}`;
            if (iteration > 1) {
              const lastFeedback = telemetryHistory[telemetryHistory.length - 1]?.qaFeedback || 'REJECTED';
              executorInput = `[QA FEEDBACK FROM PREVIOUS ITERATION]\nStatus: REJECTED\nFeedback:\n${lastFeedback}\n\n[ACCUMULATED WORKING MEMORY]\n${accumulatedWorkingMemory || 'None'}\n\nDO NOT repeat actions you have already successfully completed. Use the working memory above to proceed.\n\n${executorInput}`;
            }
            if (supervisorOverride) {
              executorInput = `[SUPERVISOR OVERRIDE ALERT]\n${supervisorOverride}\n\n${executorInput}`;
              this.agentLogger.log('Executor', `Applying supervisor override instruction.`, subagentRequestId);
            }

            const executorRequest: ChatCompletionRequest = {
              model: executorModel,
              messages: [
                { role: 'system', content: executorSystemContent },
                { role: 'user', content: executorInput },
              ],
              // Remove delegate_subagent from tools available to local subagent
              tools: this.toolRegistry.getDefinitions().filter(t => t.function.name !== 'delegate_subagent'),
              requestId: `${subagentRequestId}_exec_${iteration}`,
              parentRequestId: parentRequestId,
            };

            // Run Executor using the ToolLoopService
            const executionOptions = {
              validators: this.validatorService.getValidatorsForEnvironment(getPreparerText()),
              parentRequestId,
              userResponses: this.userResponses,
            };

            const execStart = Date.now();
            const execResult = await this.toolLoop.execute(
              executorRequest,
              executorConfig,
              5,
              executionOptions,
            );
            const executorOutput = execResult.response.data?.choices?.[0]?.message?.content || 'No output';
            this.agentLogger.log('Executor', `Execution completed in ${Date.now() - execStart}ms`, subagentRequestId);

            // Check if Executor reported type/compilation syntax errors from write_file
            let localSyntaxError = '';
            if (execResult.toolCalls) {
              for (const tc of execResult.toolCalls) {
                if (tc.name === 'write_file' && tc.result && tc.result.status === 'written_but_has_syntax_errors') {
                  const pathVal = tc.args?.path || 'unknown';
                  const fileErrors = Array.isArray(tc.result.errors) ? tc.result.errors.join('\n') : JSON.stringify(tc.result.errors);
                  localSyntaxError += `File ${pathVal} write error:\n${fileErrors}\n`;
                }
              }
            }

            // 2. Build QA Prompt
            this.agentLogger.log('QA', 'Starting compilation and type check verification...', subagentRequestId);
            
            // Run global tsc and linting check to find project-wide typescript issues
            let tscReport = 'TypeScript type checking and linting passed cleanly.';
            const globalCommand = this.validatorService.getGlobalCheckCommand(getPreparerText());
            try {
              await execAsync(globalCommand, { cwd: process.cwd() });
            } catch (err: any) {
              tscReport = err.stdout || err.stderr || err.message;
            }

            // If write_file itself threw errors, prepend them to the report
            if (localSyntaxError) {
              tscReport = `[Local Write Syntax Errors]:\n${localSyntaxError}\n\n[Project Build Errors]:\n${tscReport}`;
            }

            // Extract actual modified file contents to prevent QA hallucinations over conversational text
            let modifiedFilesReport = '';
            const modifiedPaths = new Set<string>();
            if (execResult.toolCalls) {
              for (const tc of execResult.toolCalls) {
                if (['write_file', 'replace_file_content', 'multi_replace_file_content'].includes(tc.name) && tc.args?.path) {
                  modifiedPaths.add(tc.args.path as string);
                }
              }
            }

            if (modifiedPaths.size > 0) {
              modifiedFilesReport += '\n\n[Archivos Modificados por el Executor en esta iteración]\n';
              for (const filePath of modifiedPaths) {
                try {
                  const absolutePath = path.resolve(process.cwd(), filePath);
                  if (fs.existsSync(absolutePath)) {
                    const content = fs.readFileSync(absolutePath, 'utf-8');
                    modifiedFilesReport += `\n--- ${filePath} ---\n${content}\n`;
                  }
                } catch (e) {
                  // Ignore read errors
                }
              }
            }

            let toolCallsReport = '';
            if (execResult.toolCalls && execResult.toolCalls.length > 0) {
              toolCallsReport += '\n\n[Llamadas a Herramientas y Resultados en esta iteración]\n';
              for (const tc of execResult.toolCalls) {
                toolCallsReport += `\n--- Herramienta: ${tc.name} ---\n`;
                toolCallsReport += `Args: ${JSON.stringify(tc.args)}\n`;
                if (tc.result) {
                  if (tc.name === 'execute_command') {
                    toolCallsReport += `Exit Code: ${tc.result.exitCode}\n`;
                    if (tc.result.stdout) toolCallsReport += `Stdout:\n${tc.result.stdout}\n`;
                    if (tc.result.stderr) toolCallsReport += `Stderr:\n${tc.result.stderr}\n`;
                  } else {
                    toolCallsReport += `Resultado:\n${typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}\n`;
                  }
                }
              }
            }

            const qaSystemPrompt = basePrompt + '\n\n' + this.promptService.loadPrompt('qa');
            const qaRequest: ChatCompletionRequest = {
              model: qaModel,
              messages: [
                { role: 'system', content: qaSystemPrompt },
                { 
                  role: 'user', 
                  content: `Task: ${args.task}\n\nExecutor Output:\n${executorOutput}\n\nTypeScript Compiler / Build Report:\n${tscReport}${modifiedFilesReport}${toolCallsReport}` 
                },
              ],
              requestId: `${subagentRequestId}_qa_${iteration}`,
              parentRequestId: parentRequestId,
            };

            // Call QA Model
            const qaResponse = await this.providersService.getProvider(qaConfig.type).chat(qaRequest, qaConfig);
            const qaFeedback = qaResponse.data?.choices?.[0]?.message?.content || 'REJECTED';

            // Parse QA status (APPROVED vs REJECTED)
            const isApproved = qaFeedback.toUpperCase().includes('APPROVED') && !qaFeedback.toUpperCase().includes('REJECTED');
            const qaStatus = isApproved ? 'APPROVED' as const : 'REJECTED' as const;

            // Extract Working Memory Update
            let workingMemoryUpdate = '';
            const wmMatch = qaFeedback.match(/(?:-\s*\*\*)?Working Memory Update\*\*?:\s*([^\r\n]+)/i);
            if (wmMatch && wmMatch[1]) {
              const val = wmMatch[1].trim();
              if (val.toLowerCase() !== 'none' && val.toLowerCase() !== '[none]' && val !== '') {
                workingMemoryUpdate = val;
              }
            }
            if (workingMemoryUpdate) {
              accumulatedWorkingMemory += `- Iteration ${iteration}: ${workingMemoryUpdate}\n`;
            }

            this.agentLogger.log('QA', `Verification complete. Status: ${qaStatus}. Feedback:\n${qaFeedback}`, subagentRequestId);

            // Update telemetry entry
            const telemetryEntry: TelemetryEntry = {
              iteration,
              task: args.task,
              executorModel,
              executorOutputSummary: executorOutput.slice(0, 300),
              qaStatus,
              qaFeedback,
            };
            telemetryHistory.push(telemetryEntry);

            if (isApproved) {
              this.agentLogger.log('QA', 'Task APPROVED. Exiting Executor/QA loop.', subagentRequestId);
              finalResultContent = executorOutput;
              break;
            }

            // 3. Transversal Supervisor Agent (Cloud) - Parallel loop detection & override injection
            this.agentLogger.log('Supervisor', 'Evaluating telemetry for loops and desyncs...', subagentRequestId);
            const supervisorSystemPrompt = this.promptService.loadPrompt('supervisor');
            
            const supervisorRequest: ChatCompletionRequest = {
              model: pair.orchestrator, // Cloud model
              messages: [
                { role: 'system', content: supervisorSystemPrompt },
                { 
                  role: 'user', 
                  content: `Telemetry History of Executor loop:\n${JSON.stringify(telemetryHistory, null, 2)}` 
                },
              ],
              requestId: `${subagentRequestId}_sup_${iteration}`,
              parentRequestId: parentRequestId,
            };

            const supervisorResponse = await this.providersService.getProvider(orchestratorConfig.type).chat(supervisorRequest, orchestratorConfig);
            const supervisorOutput = supervisorResponse.data?.choices?.[0]?.message?.content || '';

            this.agentLogger.log('Supervisor', `Analysis:\n${supervisorOutput}`, subagentRequestId);

            // Parse Supervisor Status and Override
            const statusMatch = supervisorOutput.match(/Status\s*:\s*(\w+)/i);
            const isLoopingOrDiverged = statusMatch && ['LOOPING', 'DIVERGED'].includes(statusMatch[1].toUpperCase());

            const matchOverride = supervisorOutput.match(/Supervisor Override(?:[\*:\s]+)([\s\S]+)$/i);
            if (isLoopingOrDiverged && matchOverride && matchOverride[1] && !matchOverride[1].toUpperCase().includes('NONE')) {
              supervisorOverride = matchOverride[1].trim();
            } else {
              supervisorOverride = null;
            }

            // 4. Knowledge Gap Detection & Dynamic Skill Injection (browserlens scraping)
            const needsScraping = qaFeedback.toLowerCase().includes('missing skill') || 
                                  qaFeedback.toLowerCase().includes('unknown api') || 
                                  executorOutput.toLowerCase().includes('i do not know the exact signature') ||
                                  tscReport.includes('cannot find module');

            if (needsScraping) {
              this.agentLogger.warn('System', 'Knowledge gap detected. Initiating SkillWorkflow scraping...', subagentRequestId);
              // Identify search query (e.g. from compiler logs or missing package mentions)
              let searchQuery = '';
              const packageMatch = tscReport.match(/cannot find module [\x27\x22]([^\x27\x22]+)[\x27\x22]/i);
              if (packageMatch && packageMatch[1]) {
                searchQuery = packageMatch[1];
              } else {
                // Fallback to extraction from executor output or query terms
                searchQuery = args.task.split(' ').slice(0, 4).join(' ');
              }

              if (searchQuery) {
                const scraped = await this.skillScraper.scrapeSkill(searchQuery);
                if (scraped) {
                  // Generate and write skill locally
                  const slug = searchQuery.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                  const skillFile = path.resolve(process.cwd(), 'skills', `${slug}.md`);
                  const skillContent = `---
name: ${slug}
description: Dynamic scraped skill for ${searchQuery}
category: scraped
tags: [scraped, ${slug}]
status: draft
---

# Scraped Skill: ${scraped.name}

${scraped.content}
`;
                  this.agentLogger.log('System', `Writing dynamic scraped skill to ${skillFile}`, subagentRequestId);
                  fs.writeFileSync(skillFile, skillContent, 'utf-8');
                  await this.skillManager.loadSkills();
                  if (!activeSkills.includes(slug)) {
                    activeSkills.push(slug);
                  }
                }
              }
            }

            // Save final fallback content to return if max iterations is hit without approval
            finalResultContent = executorOutput;
          } catch (err: any) {
            if (err instanceof FatalToolError || err.name === 'FatalToolError') {
              throw err;
            }
            const errMsg = err.message || String(err);
            this.agentLogger.error('System', `Subagent step failed catastrophically: ${errMsg}`, subagentRequestId);
            throw new FatalToolError(`Subagent connection or execution failed: ${errMsg}`);
          }
        }

        return {
          status: 'success',
          result: finalResultContent
        };
      }
    });
  }

  private lastUserMessage(messages: any[]): string {
    if (!messages || messages.length === 0) return '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content;
        return typeof content === 'string' ? content : JSON.stringify(content);
      }
    }
    return '';
  }

  private getDelegationToolDefinition(subagents: string[] = []) {
    const allowedSubagents = subagents.length > 0 ? ` MUST be one of: ${subagents.join(', ')}.` : '';
    return {
      type: 'function' as const,
      function: {
        name: 'delegate_subagent',
        description: 'Delegates a specific sub-task or task to a local sub-agent. The sub-agent has access to filesystem tools and can run commands to solve the task, returning only the final result.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'The detailed instructions/task for the subagent to perform.'
            },
            subagent_model: {
              type: 'string',
              description: `Optional model name to use for the subagent.${allowedSubagents} If not specified, the default subagents will be tried in order.`
            },
            max_iterations: {
              type: 'number',
              description: 'Optional maximum number of iterations for the subagent. Set higher (e.g. 30-40) for complex tasks, or lower (e.g. 5-10) for simple tasks.'
            },
            timeout_ms: {
              type: 'number',
              description: 'Optional timeout in milliseconds for the subagent tool loop.'
            },
            skills: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional array of skill names to inject into the subagent prompt (e.g. ["opencode-plugin-api"]). Use the search_skills tool to find available skills.'
            }
          },
          required: ['task']
        }
      }
    };
  }

  /**
   * Deterministic Ollama lifecycle check. Replaces the unreliable LLM-prompt-based check.
   * Checks if any subagent in the pair uses Ollama, verifies port connectivity,
   * and throws UserInteractionRequiredError if Ollama is down.
   * On workflow resume (user responded), executes the optimize script.
   */
  private async ensureOllamaReady(
    parentRequestId: string,
    request: ChatCompletionRequest,
    pair: { id: string; name: string; orchestrator: string; subagents: string[] },
  ): Promise<void> {
    // Check if any subagent in this pair uses Ollama
    const usesOllama = pair.subagents.some((subagentId) => {
      const localCfg = this.modelResolverService.getLocalConfig(subagentId);
      return localCfg && localCfg.type === 'ollama';
    });

    if (!usesOllama) {
      this.agentLogger.log('System', 'No Ollama subagents in this pair, skipping lifecycle check.', parentRequestId);
      return;
    }

    // Check if Ollama port is responsive
    const isUp = await this.isOllamaResponsive();
    if (isUp) {
      this.agentLogger.log('System', 'Ollama is responsive on port 11434.', parentRequestId);
      return;
    }

    // Ollama is down. Check if we already have a user response (resume flow)
    const existingAnswer = this.userResponses.get(parentRequestId);
    if (existingAnswer) {
      // User already answered — check if affirmative
      const normalized = existingAnswer.toLowerCase().trim();
      const isAffirmative = ['sí', 'si', 'yes', 'ok', 'dale', 'adelante', 'claro', 'por supuesto', 'hazlo'].some(
        (word) => normalized.includes(word),
      );

      if (isAffirmative) {
        this.agentLogger.log('System', 'User approved Ollama start. Running optimize-ollama.sh...', parentRequestId);
        try {
          const scriptPath = path.resolve('scripts/optimize-ollama.sh');
          if (fs.existsSync(scriptPath)) {
            const { stdout, stderr } = await execAsync(`sh ${scriptPath}`, { timeout: 30000 });
            this.agentLogger.log('System', `optimize-ollama.sh output: ${stdout.trim()}`, parentRequestId);
            if (stderr.trim()) {
              this.agentLogger.log('System', `optimize-ollama.sh stderr: ${stderr.trim()}`, parentRequestId);
            }

            // Verify Ollama is now responsive
            const readyAfterScript = await this.isOllamaResponsive(15);
            if (readyAfterScript) {
              this.agentLogger.log('System', 'Ollama started and responsive after optimization.', parentRequestId);
            } else {
              this.agentLogger.error('System', 'Ollama did not become responsive after running optimize-ollama.sh.', parentRequestId);
            }
          } else {
            // No script, try starting Ollama directly
            this.agentLogger.log('System', 'optimize-ollama.sh not found. Attempting direct start...', parentRequestId);
            await execAsync('nohup OLLAMA_NUM_PARALLEL=2 ollama serve > /dev/null 2>&1 &', { timeout: 5000 }).catch(() => {});
            const readyDirect = await this.isOllamaResponsive(15);
            if (readyDirect) {
              this.agentLogger.log('System', 'Ollama started directly and is responsive.', parentRequestId);
            } else {
              this.agentLogger.error('System', 'Ollama did not become responsive after direct start attempt.', parentRequestId);
            }
          }
        } catch (err: any) {
          this.agentLogger.error('System', `Failed to start Ollama: ${err.message}`, parentRequestId);
        }
      } else {
        this.agentLogger.log('System', `User declined Ollama start: "${existingAnswer}"`, parentRequestId);
      }
      // Clear the response so we don't re-process it
      this.userResponses.delete(parentRequestId);
      return;
    }

    // No user response yet — throw to ask the user
    this.agentLogger.log('System', 'Ollama is not responsive. Requesting user permission to start it.', parentRequestId);
    throw new UserInteractionRequiredError(
      'He detectado que Ollama no está activo (puerto 11434 no responde). Para proceder con las tareas locales, ¿me permites iniciarlo con optimización para múltiples contextos paralelos?',
      parentRequestId,
    );
  }

  /**
   * TCP port check to determine if Ollama is listening.
   * Retries up to `maxAttempts` times with 1-second intervals.
   */
  private async isOllamaResponsive(maxAttempts = 1): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const isUp = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(2000);
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(11434, '127.0.0.1');
      });
      if (isUp) return true;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return false;
  }
}
