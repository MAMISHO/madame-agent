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
import { randomUUID } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

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
  ) {}

  async executeWorkflow(
    request: ChatCompletionRequest,
    pair: { id: string; name: string; orchestrator: string; subagents: string[] },
  ): Promise<any> {
    const parentRequestId = request.requestId || `req_${randomUUID().slice(0, 8)}`;
    request.requestId = parentRequestId;
    const userMessage = this.lastUserMessage(request.messages);

    this.agentLogger.log('System', `Executing multi-agent workflow for request: "${userMessage.slice(0, 100)}..."`, parentRequestId);

    const providersConfig = this.configService.get('providers') || {};
    const orchestratorConfig = providersConfig[pair.orchestrator];
    if (!orchestratorConfig) {
      throw new Error(`Orchestrator provider "${pair.orchestrator}" not found for pair "${pair.name}"`);
    }

    try {
      this.pendingRequests.set(parentRequestId, { request, pair });

      let preparerText = '';

      // 1. Register Custom Executor/QA delegate_subagent tool
      this.registerCustomDelegationTool(pair, parentRequestId, () => preparerText);

      // 2. Environment Preparer Agent (Cloud)
      this.agentLogger.log('Preparer', 'Verifying environment and configuring context...', parentRequestId);
      const preparerPrompt = this.promptService.loadPrompt('preparer');
      const preparerRequest: ChatCompletionRequest = {
        model: pair.orchestrator,
        messages: [
          { role: 'system', content: preparerPrompt },
          { role: 'user', content: `Task: ${userMessage}` },
        ],
        tools: [
          this.getDelegationToolDefinition(pair.subagents),
          this.toolRegistry.getDefinitions().find(t => t.function.name === 'ask_user'),
        ].filter(Boolean) as any,
        tool_choice: 'required',
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
      
      this.agentLogger.log('Preparer', `Environment Report:\n${preparerText.slice(0, 200)}...`, parentRequestId);

      // 3. Planner Agent (Cloud)
      this.agentLogger.log('Planner', 'Generating technical implementation plan...', parentRequestId);
      const plannerPrompt = this.promptService.loadPrompt('planner');
      const plannerRequest: ChatCompletionRequest = {
        model: pair.orchestrator,
        messages: [
          { role: 'system', content: plannerPrompt },
          { role: 'user', content: `Task: ${userMessage}\n\nEnvironment Report:\n${preparerText}` },
        ],
        requestId: `plan_${randomUUID().slice(0, 8)}`,
        parentRequestId,
      };
      const plannerResponse = await this.providersService.getProvider(orchestratorConfig.type).chat(plannerRequest, orchestratorConfig);
      const planText = plannerResponse.data?.choices?.[0]?.message?.content || 'No plan generated';
      
      this.agentLogger.log('Planner', `Plan generated:\n${planText.slice(0, 300)}...`, parentRequestId);

      // 4. Orchestrator Agent (Cloud) - Main Outer Loop
      this.agentLogger.log('Orchestrator', 'Orchestration loop started.', parentRequestId);
      
      // System instructions for outer Orchestrator
      const orchestratorPrompt = this.promptService.loadPrompt('orchestrator-delegate');
      
      // Inject the plan and preparer report directly into the user message context
      const enrichedMessages: Message[] = [
        { role: 'system', content: orchestratorPrompt },
        { 
          role: 'user', 
          content: `Original Task: ${userMessage}\n\nImplementation Plan:\n${planText}\n\nEnvironment Status:\n${preparerText}` 
        },
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
        return {
          response: {
            data: {
              status: 'pending_user_input',
              requestId: err.requestId || parentRequestId,
              question: err.question,
            } as any,
          },
          metadata: {
            mode: 'orchestrator',
            escalated: false,
            providerKey: pair.orchestrator,
            providerType: orchestratorConfig?.type || 'unknown',
            model: orchestratorConfig?.model || 'unknown',
            originalTokens: 0,
            finalTokens: 0,
            iterations: 0,
            toolCalls: [],
            toolErrors: [err.message],
          },
        };
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

        const executorModel = subagentsToTry[0] || 'local_medium';
        const providersConfig = this.configService.get('providers') || {};
        
        let executorConfig = providersConfig[executorModel];
        let executorKey = executorModel;
        if (!executorConfig) {
          const matched = Object.entries(providersConfig).find(
            ([_, cfg]: [string, any]) => cfg.model === executorModel,
          );
          if (matched) {
            executorKey = matched[0];
            executorConfig = matched[1];
          }
        }

        if (!executorConfig) {
          throw new Error(`Executor model '${executorModel}' not configured.`);
        }

        // Get QA model (use local_medium or same as executor key)
        const qaModel = providersConfig['local_medium'] ? 'local_medium' : executorKey;
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
}
