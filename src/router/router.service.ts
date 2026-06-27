import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatCompletionRequest, ToolCallRecord } from '../proxy/dto/openai.dto';
import { ProvidersService } from '../providers/providers.service';
import { ProviderResponse } from '../providers/provider.interface';
import { ModelResolverService } from './model-resolver.service';
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
    private modelResolverService: ModelResolverService,
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
          const requestModel = context?.request?.model;
          const pair = requestModel ? this.modelResolverService.getOrchestratorPair(requestModel) : null;
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
          const pair = requestModel ? this.modelResolverService.getOrchestratorPair(requestModel) : null;
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
      const orchestratorPair = this.modelResolverService.getOrchestratorPair(request.model);
      if (orchestratorPair) {
        return this.routeThroughOrchestrator(request, providersConfig, orchestratorPair);
      }
    }

    // Resolve model using ModelResolverService
    const resolved = await this.modelResolverService.resolveModel(
      request.model || 'madame-auto',
      request.messages,
    );

    const modelConfig = resolved.config;
    const providerKey = resolved.providerKey;
    const escalated = resolved.escalated;

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
          mode: resolved.classification ? 'classifier' : 'direct',
          classifierMode: resolved.classification?.mode as any,
          confidence: resolved.classification?.confidence,
          escalated,
          providerKey,
          providerType: modelConfig.type,
          model: modelConfig.model,
          originalTokens,
          finalTokens: this.estimateTokens(request.messages),
        },
      };
    }

    const metadata: RouteMetadata = {
      mode: resolved.classification ? 'classifier' : 'direct',
      classifierMode: resolved.classification?.mode as any,
      confidence: resolved.classification?.confidence,
      escalated,
      providerKey,
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

  private estimateTokens(messages: any[]): number {
    const text = JSON.stringify(messages);
    return Math.ceil(text.length / 3.5);
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
