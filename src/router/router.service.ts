import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatCompletionRequest, ToolCallRecord } from '../proxy/dto/openai.dto';
import { ProvidersService } from '../providers/providers.service';
import { ProviderResponse } from '../providers/provider.interface';
import { ClassifierService } from '../classifier/classifier.service';
import { ConfidenceEngineService } from '../confidence/confidence.service';
import { ContextService } from '../context/context.service';
import { CacheService } from '../cache/cache.service';
import { TranslationService } from '../translation/translation.service';
import { ToolLoopService } from '../tools/tool-loop.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ObservabilityService } from '../observability/observability.service';
import { randomUUID } from 'crypto';
import { PromptService } from '../prompts/prompt.service';
import { WorkflowService } from './workflow.service';
import { SkillManagerService } from '../tools/skill-manager.service';

export interface RouteMetadata {
  mode: 'direct' | 'classifier' | 'orchestrator';
  classifierMode?: 'plan' | 'execution';
  confidence?: number;
  escalated: boolean;
  providerKey: string;
  providerType: string;
  model: string;
  originalTokens: number;
  finalTokens: number;
  toolCalls?: ToolCallRecord[];
  toolErrors?: string[];
  iterations?: number;
  outputTokens?: number;
}

export interface RouteResult {
  response: ProviderResponse;
  metadata: RouteMetadata;
}

@Injectable()
export class RouterService implements OnModuleInit {
  private readonly logger = new Logger(RouterService.name);

  constructor(
    private configService: ConfigService,
    private providersService: ProvidersService,
    private classifierService: ClassifierService,
    private confidenceEngine: ConfidenceEngineService,
    private contextService: ContextService,
    private cacheService: CacheService,
    private translationService: TranslationService,
    private toolLoopService: ToolLoopService,
    private toolRegistry: ToolRegistryService,
    private observability: ObservabilityService,
    private skillManager: SkillManagerService,
    private promptService: PromptService,
    private workflowService: WorkflowService,
  ) {}

  onModuleInit() {
    this.toolRegistry.register({
      definition: this.getDelegationToolDefinition(),
      execute: async (args: { task: string; subagent_model?: string; max_iterations?: number; timeout_ms?: number; skills?: string[] }, context?: { parentRequestId?: string; parentSignal?: AbortSignal; request?: ChatCompletionRequest }) => {
        const parentRequestId = context?.parentRequestId || 'unknown';
        const parentSignal = context?.parentSignal;

        let subagentsToTry: string[] = [];

        if (args.subagent_model) {
          subagentsToTry = [args.subagent_model];
        } else {
          // Resolve subagents from active orchestrator pair if possible
          const orchestratorPairs = this.configService.get('orchestrator_pairs') || [];
          const requestModel = context?.request?.model;
          const pair = requestModel ? this.findOrchestratorPair(requestModel, orchestratorPairs) : null;
          if (pair && pair.subagents) {
            subagentsToTry = [...pair.subagents];
          } else {
            // Fallback to global subagent providers
            subagentsToTry = this.configService.get('routing.subagent.providers') || ['local_medium'];
          }
        }

        this.logger.log(`[Orchestrator ${parentRequestId}] DELEGATING TASK: "${args.task.slice(0, 200)}"`);
        this.logger.log(`[Orchestrator ${parentRequestId}] FAILOVER CRITERIA (candidate subagents in order): [${subagentsToTry.join(', ')}]`);

        let finalResultContent: string | null = null;
        let lastError: Error | null = null;

        for (const subagentModel of subagentsToTry) {
          if (parentSignal?.aborted) {
            this.logger.warn(`[Orchestrator ${parentRequestId}] Subagent execution skipped (parent request aborted)`);
            throw new Error('Parent request aborted');
          }

          const subagentRequestId = `sub_${randomUUID().slice(0, 8)}`;
          const subagentAbortController = new AbortController();

          const abortHandler = () => {
            subagentAbortController.abort();
          };
          if (parentSignal) {
            parentSignal.addEventListener('abort', abortHandler);
          }

          this.observability.registerSubagentTask({
            requestId: subagentRequestId,
            parentRequestId,
            subagentModel,
            taskDescription: args.task,
            status: 'running',
            startedAt: new Date(),
            abortController: subagentAbortController,
          });

          this.logger.log(`[Subagent ${subagentRequestId}] STARTED task execution using model: "${subagentModel}" (Parent: ${parentRequestId})`);
          this.logger.log(`[Subagent ${subagentRequestId}] INPUT RECEIVED: "${args.task}"`);

          const startTime = Date.now();
          try {
            let systemContent = this.promptService.loadPrompt('subagent-system');
            if (args.skills && args.skills.length > 0) {
              systemContent += '\n\n=== RELEVANT SKILLS / KNOWLEDGE ===\n';
              for (const skillName of args.skills) {
                const content = this.skillManager.getSkillContent(skillName);
                if (content) {
                  systemContent += `\n--- Skill: ${skillName} ---\n${content}\n`;
                } else {
                  this.logger.warn(`[Orchestrator ${parentRequestId}] Requested skill '${skillName}' not found`);
                }
              }
            }

            const subagentRequest: ChatCompletionRequest = {
              model: subagentModel,
              messages: [
                {
                  role: 'system',
                  content: systemContent
                },
                {
                  role: 'user',
                  content: args.task
                }
              ],
              tools: this.toolRegistry.getDefinitions().filter(t => t.function.name !== 'delegate_subagent'),
              requestId: subagentRequestId,
              parentRequestId,
              maxIterations: args.max_iterations,
              timeoutMs: args.timeout_ms,
            };
            (subagentRequest as any).signal = subagentAbortController.signal;

            const routeResult = await this.route(subagentRequest);
            finalResultContent = routeResult.response.data?.choices?.[0]?.message?.content;
            if (!finalResultContent) {
              const toolErrors = routeResult.metadata?.toolErrors || [];
              if (toolErrors.length > 0) {
                finalResultContent = `No response from subagent. Tool errors encountered:\n${toolErrors.join('\n')}`;
              } else {
                finalResultContent = 'No response from subagent';
              }
            }
            
            const duration = Date.now() - startTime;
            this.logger.log(`[Subagent ${subagentRequestId}] COMPLETED successfully in ${duration}ms (Model: ${subagentModel})`);
            const outputText = finalResultContent || 'No response content';
            this.logger.log(`[Subagent ${subagentRequestId}] OUTPUT RETURNED: "${outputText.slice(0, 300)}${outputText.length > 300 ? '...' : ''}"`);
            
            this.observability.updateSubagentTaskStatus(subagentRequestId, 'completed');
            if (parentSignal) {
              parentSignal.removeEventListener('abort', abortHandler);
            }
            break;
          } catch (err: any) {
            const duration = Date.now() - startTime;
            this.logger.warn(`[Subagent ${subagentRequestId}] FAILED in ${duration}ms (Model: ${subagentModel}). Error: "${err.message}"`);
            lastError = err;
            this.observability.updateSubagentTaskStatus(subagentRequestId, 'failed');
            if (parentSignal) {
              parentSignal.removeEventListener('abort', abortHandler);
            }
          }
        }

        // Self-fallback
        if (finalResultContent === null) {
          this.logger.warn(`[Orchestrator ${parentRequestId}] All candidate subagents failed. Falling back to isolated self-assignment.`);
          
          const requestModel = context && (context as any).request?.model;
          const orchestratorPairs = this.configService.get('orchestrator_pairs') || [];
          const pair = requestModel ? this.findOrchestratorPair(requestModel, orchestratorPairs) : null;
          const orchestratorModelKey = pair ? pair.orchestrator : (requestModel || 'cloud_nvidia');
          
          const selfRequestId = `self_${randomUUID().slice(0, 8)}`;
          const selfAbortController = new AbortController();

          const abortHandler = () => {
            selfAbortController.abort();
          };
          if (parentSignal) {
            parentSignal.addEventListener('abort', abortHandler);
          }

          this.observability.registerSubagentTask({
            requestId: selfRequestId,
            parentRequestId,
            subagentModel: orchestratorModelKey,
            taskDescription: `[Self-fallback] ${args.task}`,
            status: 'running',
            startedAt: new Date(),
            abortController: selfAbortController,
          });

          this.logger.log(`[Orchestrator ${parentRequestId}] Self-fallback execution ${selfRequestId} STARTED on orchestrator model: "${orchestratorModelKey}"`);

          const startTime = Date.now();
          try {
            const selfRequest: ChatCompletionRequest = {
              model: orchestratorModelKey,
              messages: [
                {
                  role: 'system',
                  content: this.promptService.loadPrompt('self-fallback-system')
                },
                {
                  role: 'user',
                  content: args.task
                }
              ],
              tools: this.toolRegistry.getDefinitions().filter(t => t.function.name !== 'delegate_subagent'),
              requestId: selfRequestId,
              parentRequestId,
            };
            (selfRequest as any).signal = selfAbortController.signal;

            const routeResult = await this.route(selfRequest);
            finalResultContent = routeResult.response.data?.choices?.[0]?.message?.content || 'No response from self-fallback';
            
            const duration = Date.now() - startTime;
            this.logger.log(`[Orchestrator ${parentRequestId}] Self-fallback execution ${selfRequestId} COMPLETED successfully in ${duration}ms`);
            const selfOutput = finalResultContent || 'No response content';
            this.logger.log(`[Orchestrator ${parentRequestId}] Self-fallback OUTPUT: "${selfOutput.slice(0, 300)}${selfOutput.length > 300 ? '...' : ''}"`);
            
            this.observability.updateSubagentTaskStatus(selfRequestId, 'completed');
            if (parentSignal) {
              parentSignal.removeEventListener('abort', abortHandler);
            }
          } catch (err: any) {
            const duration = Date.now() - startTime;
            this.logger.error(`[Orchestrator ${parentRequestId}] Self-fallback execution ${selfRequestId} FAILED in ${duration}ms. Error: "${err.message}"`);
            this.observability.updateSubagentTaskStatus(selfRequestId, 'failed');
            if (parentSignal) {
              parentSignal.removeEventListener('abort', abortHandler);
            }
            throw new Error(`All subagents failed (last error: ${lastError?.message || 'unknown'}) and self-fallback failed: ${err.message}`);
          }
        }

        return {
          status: 'success',
          result: finalResultContent
        };
      }
    });
  }

  async route(request: ChatCompletionRequest): Promise<RouteResult> {
    const startTime = Date.now();
    const isSubagent = !!request.parentRequestId;
    try {
      const result = await this.routeInternal(request);
      const latencyMs = Date.now() - startTime;

      // Inject executed tool calls and delegation status into response extra_content
      const toolCalls = result.metadata.toolCalls;
      if (
        result.response.data &&
        result.response.data.choices &&
        result.response.data.choices[0] &&
        result.response.data.choices[0].message
      ) {
        const msg = result.response.data.choices[0].message;
        if (!msg.extra_content) {
          msg.extra_content = {};
        }
        if (result.metadata.iterations !== undefined) {
          msg.extra_content.iteration = result.metadata.iterations;
        }
        if (toolCalls && toolCalls.length > 0) {
          msg.extra_content.tool_calls = toolCalls;
          const delegated = toolCalls.some((tc) => tc.name === 'delegate_subagent');
          if (delegated) {
            msg.extra_content.delegated = true;
          }
        }
      }

      if (isSubagent) {
        this.observability.trackRequest({
          requestId: request.requestId || '',
          timestamp: new Date(),
          latencyMs,
          routing: {
            requestId: request.requestId || '',
            mode: result.metadata.mode,
            classifierMode: result.metadata.classifierMode,
            confidence: result.metadata.confidence,
            escalated: result.metadata.escalated,
            providerKey: result.metadata.providerKey,
            providerType: result.metadata.providerType,
            model: result.metadata.model,
            parentRequestId: request.parentRequestId,
          },
          originalTokens: result.metadata.originalTokens,
          finalTokens: result.metadata.finalTokens,
          dedupRemoved: result.metadata.originalTokens - result.metadata.finalTokens,
          success: true,
          outputTokens: result.response.data?.usage?.completion_tokens || 0,
        });
      }

      return result;
    } catch (error: any) {
      if (isSubagent) {
        const latencyMs = Date.now() - startTime;
        this.observability.trackRequest({
          requestId: request.requestId || '',
          timestamp: new Date(),
          latencyMs,
          routing: {
            requestId: request.requestId || '',
            mode: 'direct',
            escalated: false,
            providerKey: 'unknown',
            providerType: 'unknown',
            model: request.model || 'unknown',
            parentRequestId: request.parentRequestId,
          },
          originalTokens: 0,
          finalTokens: 0,
          dedupRemoved: 0,
          success: false,
          errorMessage: error.message,
        });
      }
      throw error;
    }
  }

  async routeInternal(request: ChatCompletionRequest): Promise<RouteResult> {
    request.requestId = request.requestId || `req_${randomUUID().slice(0, 8)}`;

    if (this.translationService.isEnabled()) {
      request.messages = await this.translationService.translateMessages(request.messages);
    }

    const providersConfig = this.configService.get('providers') || {};
    const modelPairs = this.configService.get('model_pairs') || [];
    const orchestratorPairs = this.configService.get('orchestrator_pairs') || [];

    // --- Virtual Models Interception ---
    if (request.model === 'madame-auto') {
      // Force classifier/confidence routing
      request.model = undefined;
    } else if (request.model === 'madame-local-only') {
       // Force local routing by finding the default local subagent
       const defaultLocal = this.configService.get('routing.subagent.providers')?.[0] || 'local_medium';
       request.model = defaultLocal;
    } else if (request.model?.startsWith('madame-orchestrator-')) {
       // Force orchestrator routing
       request.model = request.model.replace('madame-orchestrator-', '');
    }
    // -----------------------------------

    // 0. Orchestrator routing: if model matches a named orchestrator pair
    if (request.model) {
      const orchestratorPair = this.findOrchestratorPair(request.model, orchestratorPairs);
      if (orchestratorPair) {
        return this.routeThroughOrchestrator(request, providersConfig, orchestratorPair);
      }
    }

    // 1. Composite pair routing: if model matches a named pair, use local + optional escalation
    if (request.model) {
      const pair = this.findModelPair(request.model, modelPairs);
      if (pair) {
        return this.routeThroughPair(request, providersConfig, pair);
      }
    }

    // 2. Direct routing: if the client specifies a model that matches a configured provider, use it directly
    if (request.model) {
      const directMatch = this.findProviderByModel(
        request.model,
        providersConfig,
      );
      if (directMatch) {
        this.logger.log(
          `Direct routing for model "${request.model}" → provider "${directMatch.key}" (${directMatch.config.type})`,
        );
        const providerInstance = this.providersService.getProvider(
          directMatch.config.type,
        );
        const originalTokens = this.estimateTokens(request.messages);
        const processed = this.contextService.process(request.messages, {
          maxTokens: this.resolveContextLimit(directMatch.config),
        });
        request.messages = processed.messages;

        const cacheInput = JSON.stringify(request.messages);
        const cached = await this.cacheService.findSimilar(cacheInput);
        if (cached) {
          return {
            response: { data: cached.response },
            metadata: {
              mode: 'direct',
              escalated: false,
              providerKey: directMatch.key,
              providerType: directMatch.config.type,
              model: directMatch.config.model,
              originalTokens,
              finalTokens: this.estimateTokens(request.messages),
            },
          };
        }

        const metadata: RouteMetadata = {
          mode: 'direct',
          escalated: false,
          providerKey: directMatch.key,
          providerType: directMatch.config.type,
          model: directMatch.config.model,
          originalTokens,
          finalTokens: this.estimateTokens(request.messages),
        };
        const { response, toolCalls, iterations, toolErrors } = await this.callWithRoutingMetadata(
          () => this.callProviderOrToolLoop(request, directMatch.config),
          metadata,
        );

        if (response.data) {
          await this.cacheService.store(
            request.messages,
            response.data,
            originalTokens - this.estimateTokens(request.messages),
          );
        }

        return { response, metadata: { ...metadata, toolCalls, iterations, toolErrors } };
      }
      this.logger.debug(
        `Model "${request.model}" not found in providers config, falling back to classifier routing.`,
      );
    }

    // 3. Classifier-based routing with confidence evaluation
    // Use only the last user message so the classifier isn't dominated by the system prompt
    const userInput = this.lastUserMessage(request.messages);
    const classification =
      await this.classifierService.classifyTask(userInput);

    this.logger.debug(
      `Classifier: mode=${classification.mode}, confidence=${classification.confidence.toFixed(3)}`,
    );

    // 4. Confidence Engine: decide if we need to escalate
    const decision = this.confidenceEngine.evaluate(classification);
    const selectedProviderKey = decision.targetProviderKey;

    if (!selectedProviderKey) {
      throw new Error(
        `No provider selected: routing config missing for mode=${classification.mode}, escalation=${decision.shouldEscalate}`,
      );
    }

    const modelConfig = providersConfig[selectedProviderKey];

    if (!modelConfig) {
      throw new Error(
        `Provider configuration missing for key: ${selectedProviderKey}`,
      );
    }

    if (decision.shouldEscalate) {
      this.logger.log(
        `Escalating: confidence ${classification.confidence.toFixed(3)} < threshold ${decision.threshold} → ${selectedProviderKey} (${modelConfig.type} - ${modelConfig.model})`,
      );
    } else {
      this.logger.log(
        `Classifier routing to: ${selectedProviderKey} (${modelConfig.type} - ${modelConfig.model})`,
      );
    }

    const originalTokens = this.estimateTokens(request.messages);
    const processed = this.contextService.process(request.messages, {
      maxTokens: this.resolveContextLimit(modelConfig),
    });
    request.messages = processed.messages;

    const cacheInput = JSON.stringify(request.messages);
    const cached = await this.cacheService.findSimilar(cacheInput);
    if (cached) {
      return {
        response: { data: cached.response },
        metadata: {
          mode: 'classifier',
          classifierMode: classification.mode,
          confidence: classification.confidence,
          escalated: decision.shouldEscalate,
          providerKey: selectedProviderKey,
          providerType: modelConfig.type,
          model: modelConfig.model,
          originalTokens,
          finalTokens: this.estimateTokens(request.messages),
        },
      };
    }

    const metadata: RouteMetadata = {
      mode: 'classifier',
      classifierMode: classification.mode,
      confidence: classification.confidence,
      escalated: decision.shouldEscalate,
      providerKey: selectedProviderKey,
      providerType: modelConfig.type,
      model: modelConfig.model,
      originalTokens,
      finalTokens: this.estimateTokens(request.messages),
      iterations: 0,
    };
    const { response, toolCalls, iterations, toolErrors } = await this.callWithRoutingMetadata(
      () => this.callProviderOrToolLoop(request, modelConfig),
      metadata,
    );

    if (response.data) {
      await this.cacheService.store(
        request.messages,
        response.data,
        originalTokens - this.estimateTokens(request.messages),
      );
    }

    return { response, metadata: { ...metadata, toolCalls, iterations, toolErrors } };
  }

  private async routeThroughPair(
    request: ChatCompletionRequest,
    providersConfig: Record<string, any>,
    pair: { id: string; name: string; local: string; cloud: string },
  ): Promise<RouteResult> {
    const localConfig = providersConfig[pair.local];
    if (!localConfig) {
      throw new Error(`Local provider "${pair.local}" not found for pair "${pair.name}"`);
    }
    const cloudConfig = providersConfig[pair.cloud];
    if (!cloudConfig) {
      throw new Error(`Cloud provider "${pair.cloud}" not found for pair "${pair.name}"`);
    }

    // Detect OpenCode mode from system prompt — this takes priority over classifier
    const systemMode = this.detectMode(request.messages);

    // Run classifier on the last user message only (not the system prompt)
    const userInput = this.lastUserMessage(request.messages);
    const classification = await this.classifierService.classifyTask(userInput);
    const decision = this.confidenceEngine.evaluate(classification);

    // Only "plan" mode forces escalation — OpenCode is planning and needs the smartest model.
    // "Build" mode falls back to the classifier: if it detects a complex task, escalate.
    const shouldEscalate = systemMode === 'plan' ? true : classification.mode === 'plan' || decision.shouldEscalate;
    const selectedConfig = shouldEscalate ? cloudConfig : localConfig;
    const providerKey = shouldEscalate ? pair.cloud : pair.local;
    const providerType = selectedConfig.type;

    this.logger.log(
      `Pair "${pair.name}": systemMode=${systemMode}, mode=${classification.mode}, confidence=${classification.confidence.toFixed(3)}` +
        (shouldEscalate
          ? ` → ESCALATING to ${pair.cloud} (${selectedConfig.model})`
          : ` → using local ${pair.local} (${selectedConfig.model})`),
    );

    const originalTokens = this.estimateTokens(request.messages);
    const processed = this.contextService.process(request.messages, {
      maxTokens: this.resolveContextLimit(selectedConfig),
    });
    request.messages = processed.messages;

    const cacheInput = JSON.stringify(request.messages);
    const cached = await this.cacheService.findSimilar(cacheInput);
    if (cached) {
      return {
        response: { data: cached.response },
        metadata: {
          mode: 'classifier',
          classifierMode: classification.mode,
          confidence: classification.confidence,
          escalated: shouldEscalate,
          providerKey,
          providerType,
          model: selectedConfig.model,
          originalTokens,
          finalTokens: this.estimateTokens(request.messages),
        },
      };
    }

    const metadata: RouteMetadata = {
      mode: 'classifier',
      classifierMode: classification.mode,
      confidence: classification.confidence,
      escalated: shouldEscalate,
      providerKey,
      providerType,
      model: selectedConfig.model,
      originalTokens,
      finalTokens: this.estimateTokens(request.messages),
    };
    const { response, toolCalls, iterations, toolErrors } = await this.callWithRoutingMetadata(
      () => this.callProviderOrToolLoop(request, selectedConfig),
      metadata,
    );

    if (response.data) {
      await this.cacheService.store(
        request.messages,
        response.data,
        originalTokens - this.estimateTokens(request.messages),
      );
    }

    return { response, metadata: { ...metadata, toolCalls, iterations, toolErrors } };
  }

  private async callWithRoutingMetadata(
    task: () => Promise<{ response: ProviderResponse; toolCalls?: ToolCallRecord[]; iterations?: number; toolErrors?: string[] }>,
    metadata: RouteMetadata,
  ): Promise<{ response: ProviderResponse; toolCalls?: ToolCallRecord[]; iterations?: number; toolErrors?: string[] }> {
    try {
      const result = await task();
      metadata.outputTokens = result.response.data?.usage?.completion_tokens || 0;
      return result;
    } catch (error) {
      throw Object.assign(error, { routingMetadata: metadata });
    }
  }

  private async callProviderOrToolLoop(
    request: ChatCompletionRequest,
    modelConfig: any,
  ): Promise<{ response: ProviderResponse; toolCalls?: ToolCallRecord[]; iterations?: number; toolErrors?: string[] }> {
    const hasTools = request.tools && request.tools.length > 0;

    if (hasTools) {
      this.logger.log(`ToolLoop activated: ${request.tools!.length} tool(s) provided, model=${modelConfig.model}`);
      const result = await this.toolLoopService.execute(request, modelConfig);
      return { response: result.response, toolCalls: result.toolCalls, iterations: result.iterations, toolErrors: result.errors };
    }

    const providerInstance = this.providersService.getProvider(modelConfig.type);
    const response = await providerInstance.chat(request, modelConfig);
    return { response, toolCalls: undefined, iterations: 1, toolErrors: undefined };
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

  private detectMode(messages: any[]): 'plan' | 'build' | null {
    const systemMsg = messages.find(m => m.role === 'system');
    if (!systemMsg || typeof systemMsg.content !== 'string') return null;

    const content = systemMsg.content.toLowerCase();
    if (content.includes('modo de planificación') || content.includes('planning mode') || content.includes('plan mode')) {
      return 'plan';
    }
    if (content.includes('modo de desarrollo activo') || content.includes('active development mode') || content.includes('build mode')) {
      return 'build';
    }
    return null;
  }

  private estimateTokens(messages: any[]): number {
    const text = JSON.stringify(messages);
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Finds a provider configuration whose 'model' field matches the requested model name.
   */
  private findProviderByModel(
    modelName: string,
    providersConfig: Record<string, any>,
  ): { key: string; config: any } | null {
    if (providersConfig[modelName]) {
      return { key: modelName, config: providersConfig[modelName] };
    }
    for (const [key, config] of Object.entries(providersConfig)) {
      if (config.model === modelName) {
        return { key, config };
      }
    }
    return null;
  }

  private findModelPair(
    modelName: string,
    modelPairs: any[],
  ): { id: string; name: string; local: string; cloud: string } | null {
    for (const pair of modelPairs) {
      if (pair.name === modelName || pair.id === modelName) {
        return pair;
      }
    }
    return null;
  }

  private findOrchestratorPair(
    modelName: string,
    orchestratorPairs: any[],
  ): { id: string; name: string; orchestrator: string; subagents: string[] } | null {
    for (const pair of orchestratorPairs) {
      if (pair.name === modelName || pair.id === modelName) {
        return pair;
      }
    }
    return null;
  }

  private getDelegationToolDefinition() {
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
              description: 'Optional model name or pair name to use for the subagent. If not specified, the default subagents will be tried in order.'
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

  private async routeThroughOrchestrator(
    request: ChatCompletionRequest,
    providersConfig: Record<string, any>,
    pair: { id: string; name: string; orchestrator: string; subagents: string[] },
  ): Promise<RouteResult> {
    return this.workflowService.executeWorkflow(request, pair);
  }

  private resolveContextLimit(modelConfig: any): number | undefined {
    if (modelConfig.context_limit) return modelConfig.context_limit;
    if (modelConfig.type === 'ollama') return 8192;
    if (modelConfig.type === 'cloud') return 32768;
    return undefined;
  }

  async resume(requestId: string, answer: string): Promise<RouteResult> {
    return this.workflowService.resumeWorkflow(requestId, answer);
  }
}
