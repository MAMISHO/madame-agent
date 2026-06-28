import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { ChatCompletionRequest, ToolCall, ToolCallRecord } from '../proxy/dto/openai.dto';
import { ProviderResponse } from '../providers/provider.interface';
import { ToolRegistryService } from './tool-registry.service';
import { SandboxManagerService } from './sandbox-manager.service';
import { ProvidersService } from '../providers/providers.service';
import { ObservabilityService } from '../observability/observability.service';

export interface ToolLoopResult {
  response: ProviderResponse;
  iterations: number;
  toolCallsExecuted: number;
  errors: string[];
  toolCalls: ToolCallRecord[];
}

export class FatalToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalToolError';
  }
}

export class UserInteractionRequiredError extends Error {
  constructor(public readonly question: string, public readonly requestId: string) {
    super(question);
    this.name = 'UserInteractionRequiredError';
  }
}

const MAX_CACHE_ENTRIES = 100;

@Injectable()
export class ToolLoopService {
  private readonly logger = new Logger(ToolLoopService.name);
  private readonly maxIterations: number;
  private readonly globalTimeoutMs: number;

  constructor(
    private configService: ConfigService,
    private toolRegistry: ToolRegistryService,
    private sandbox: SandboxManagerService,
    private providersService: ProvidersService,
    private observability: ObservabilityService,
  ) {
    this.maxIterations = this.configService.get<number>('tools.max_iterations', 20);
    this.globalTimeoutMs = this.configService.get<number>('tools.global_timeout_ms', 300_000);
  }

  async execute(
    request: ChatCompletionRequest,
    modelConfig: any,
    maxIterations?: number,
    executionOptions?: any,
  ): Promise<ToolLoopResult> {
    const iterations = request.maxIterations ?? maxIterations ?? this.maxIterations;
    const messages = [...request.messages];
    const errors: string[] = [];
    let toolCallsExecuted = 0;
    const toolCallRecords: ToolCallRecord[] = [];
    const generatedText: string[] = [];
    const startTime = Date.now();
    const timeoutMs = request.timeoutMs ?? this.globalTimeoutMs;

    // Session-scoped tool result cache
    const toolCache = new Map<string, any>();

    let loopTimedOut = false;
    let lastToolCallKey = '';
    let consecutiveIdenticalCount = 0;
    let actualIterations = 0;

    for (let i = 0; i < iterations; i++) {
      actualIterations = i + 1;
      const elapsed = Date.now() - startTime;

      if (timeoutMs >= 0 && elapsed >= timeoutMs) {
        errors.push(`Global timeout of ${timeoutMs}ms exceeded after ${i} iterations`);
        loopTimedOut = true;
        break;
      }

      const providerType = modelConfig.type;
      const providerInstance = this.providersService.getProvider(providerType);

      // Create AbortController for preemptive timeout on this iteration
      const abortController = new AbortController();
      let abortTimeout: NodeJS.Timeout | undefined;
      if (timeoutMs > 0) {
        const remaining = timeoutMs - elapsed;
        abortTimeout = setTimeout(() => abortController.abort(), remaining);
      }
      const requestSignal = (request as any).signal;
      const requestAbortHandler = () => abortController.abort();
      if (requestSignal) {
        requestSignal.addEventListener('abort', requestAbortHandler);
      }

      let response: ProviderResponse;
      try {
        const chatReq = { ...request, messages };
        if (i > 0 && chatReq.tool_choice) {
          delete chatReq.tool_choice;
        }
        
        const callStartMs = Date.now();
        response = await providerInstance.chat(
          chatReq,
          modelConfig,
          abortController.signal,
        );
        const callLatencyMs = Date.now() - callStartMs;

        const requestTokens = Math.ceil(JSON.stringify(chatReq.messages).length / 3.5);
        this.observability.trackRequest({
          requestId: request.requestId || `tool_loop_${Date.now()}`,
          sessionId: request.metadata?.sessionId,
          timestamp: new Date(),
          latencyMs: callLatencyMs,
          routing: {
            requestId: request.requestId || `tool_loop_${Date.now()}`,
            mode: 'orchestrator',
            classifierMode: 'execution',
            confidence: 1,
            escalated: false,
            providerKey: modelConfig.providerKey || 'unknown',
            providerType: modelConfig.type || 'unknown',
            model: modelConfig.model || 'unknown',
          },
          originalTokens: requestTokens,
          finalTokens: requestTokens,
          dedupRemoved: 0,
          success: true,
          outputTokens: response.data?.usage?.completion_tokens || 0,
        });

      } catch (err: any) {
        if (abortTimeout) clearTimeout(abortTimeout);
        if (requestSignal) {
          requestSignal.removeEventListener('abort', requestAbortHandler);
        }
        if (err.name === 'AbortError') {
          const abortMsg = `Provider call aborted after ${elapsed}ms (timeout ${timeoutMs}ms)`;
          errors.push(abortMsg);
          this.logger.warn(abortMsg);
          loopTimedOut = true;
          break;
        }
        throw err;
      } finally {
        if (abortTimeout) clearTimeout(abortTimeout);
        if (requestSignal) {
          requestSignal.removeEventListener('abort', requestAbortHandler);
        }
      }

      const responseContent = response.data?.choices?.[0]?.message?.content;
      if (responseContent) {
        generatedText.push(responseContent.trim());
      }

      const toolCalls: ToolCall[] | undefined = response.data?.choices?.[0]?.message?.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        this.logger.log(`ToolLoop: model responded without tool_calls after ${i + 1} iterations (${Date.now() - startTime}ms)`);
        if (generatedText.length > 0 && response.data?.choices?.[0]?.message) {
          response.data.choices[0].message.content = this.accumulateGeneratedText(generatedText, toolCallRecords, modelConfig) || '';
        }
        return { response, iterations: i + 1, toolCallsExecuted, errors, toolCalls: toolCallRecords };
      }

      this.logger.log(
        `ToolLoop iteration ${i + 1}: model made ${toolCalls.length} tool call(s) (${Date.now() - startTime}ms elapsed)`,
      );

      // Programmatic loop detection: check consecutive tool calls
      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        const toolArgsString = toolCall.function.arguments || '';
        const toolCallKey = `${toolName}:${toolArgsString}`;

        if (toolCallKey === lastToolCallKey) {
          consecutiveIdenticalCount++;
          if (consecutiveIdenticalCount >= 4) {
            const loopErrorMsg = `Loop detected: tool '${toolName}' called 4 times consecutively with identical arguments.`;
            this.logger.error(loopErrorMsg);
            errors.push(loopErrorMsg);
            loopTimedOut = true;
            break;
          }
        } else {
          lastToolCallKey = toolCallKey;
          consecutiveIdenticalCount = 1;
        }
      }

      if (loopTimedOut) {
        break;
      }

      messages.push(response.data.choices[0].message);

      // Snapshot messages before processing tool calls — tool results appended
      // during execution would change the cache key, breaking within-iteration dedup
      const baseMessages = [...messages];

      for (const toolCall of toolCalls) {
        const toolStart = Date.now();
        const toolName = toolCall.function.name;

        try {
          const args = this.parseArgs(toolCall);
          const cacheKey = this.buildCacheKey(baseMessages, toolName, args);

          // Check cache first
          if (toolCache.has(cacheKey)) {
            const cachedResult = toolCache.get(cacheKey);
            const latencyMs = Date.now() - toolStart;
            this.logger.log(`Tool cache HIT for '${toolName}' (iteration ${i + 1}, ${latencyMs}ms)`);
            this.logger.debug(`Tool cache HIT — args: ${JSON.stringify(args).slice(0, 500)}`);
            toolCallsExecuted++;
            toolCallRecords.push({
              name: toolName,
              args,
              result: cachedResult,
              latencyMs,
              iteration: i + 1,
            });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(cachedResult),
            });
            continue;
          }

          this.logger.log(`Tool executing '${toolName}' (iteration ${i + 1})`);
          this.logger.debug(`Tool args for '${toolName}': ${JSON.stringify(args).slice(0, 500)}`);

          const result = await this.executeSingleToolCall(toolCall, {
            parentRequestId: request.requestId,
            parentSignal: abortController.signal,
            request,
            executionOptions,
          });
          const latencyMs = Date.now() - toolStart;

          // Cache the result (FIFO eviction at MAX_CACHE_ENTRIES)
          if (toolCache.size >= MAX_CACHE_ENTRIES) {
            const firstKey = toolCache.keys().next().value;
            if (firstKey !== undefined) toolCache.delete(firstKey);
          }
          toolCache.set(cacheKey, result);

          this.logger.log(`Tool '${toolName}' completed in ${latencyMs}ms (iteration ${i + 1})`);
          this.logger.debug(`Tool result for '${toolName}': ${JSON.stringify(result).slice(0, 500)}`);

          toolCallsExecuted++;
          toolCallRecords.push({
            name: toolName,
            args,
            result,
            latencyMs,
            iteration: i + 1,
          });
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        } catch (err: any) {
          if (
            err instanceof FatalToolError || 
            err.name === 'FatalToolError' || 
            err.isFatal || 
            err instanceof UserInteractionRequiredError || 
            err.name === 'UserInteractionRequiredError'
          ) {
            throw err;
          }
          const latencyMs = Date.now() - toolStart;
          const errMsg = `Tool '${toolName}': ${err.message}`;
          errors.push(errMsg);
          this.logger.warn(`${errMsg} (${latencyMs}ms)`);
          this.logger.debug(`Stack trace for tool '${toolName}' error: ${err.stack}`);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ 
              error: err.message, 
              instruction: "The tool failed. Please analyze the error and respond with a new plan or a different tool call. Do not return an empty response." 
            }),
          });
        }
      }
    }

    if (loopTimedOut) {
      this.logger.warn(`ToolLoop: loop timed out after ${actualIterations} iterations`);
      const finalContent = this.accumulateGeneratedText(generatedText, toolCallRecords, modelConfig);
      return {
        response: { data: { choices: [{ message: { role: 'assistant', content: finalContent } }] } } as any,
        iterations: actualIterations,
        toolCallsExecuted,
        errors,
        toolCalls: toolCallRecords,
      };
    }

    this.logger.warn(`ToolLoop: max iterations reached (${actualIterations}), returning final response`);

    const providerInstance = this.providersService.getProvider(modelConfig.type);
    try {
      const finalResponse = await providerInstance.chat(
        { ...request, messages },
        modelConfig,
      );
      const finalResponseContent = finalResponse.data?.choices?.[0]?.message?.content;
      if (finalResponseContent) {
        generatedText.push(finalResponseContent.trim());
      }
      if (generatedText.length > 0 && finalResponse.data?.choices?.[0]?.message) {
        finalResponse.data.choices[0].message.content = this.accumulateGeneratedText(generatedText, toolCallRecords, modelConfig) || '';
      }
      return { response: finalResponse, iterations: actualIterations, toolCallsExecuted, errors, toolCalls: toolCallRecords };
    } catch (err: any) {
      const finalErrMsg = `Final provider call failed after tool loop: ${err.message}`;
      errors.push(finalErrMsg);
      this.logger.error(finalErrMsg);
      this.logger.debug(`Stack trace: ${err.stack}`);
      const accumulated = this.accumulateGeneratedText(generatedText, toolCallRecords, modelConfig);
      const finalContent = accumulated ? accumulated + '\n\n[Final call failed]' : 'Tool loop completed but final provider call failed.';
      return {
        response: { data: { choices: [{ message: { role: 'assistant', content: finalContent } }] } } as any,
        iterations,
        toolCallsExecuted,
        errors,
        toolCalls: toolCallRecords,
      };
    }
  }

  private async executeSingleToolCall(
    toolCall: ToolCall,
    context?: { parentRequestId?: string; parentSignal?: AbortSignal; request?: ChatCompletionRequest; executionOptions?: any },
  ): Promise<any> {
    const toolName = toolCall.function.name;
    const tool = this.toolRegistry.get(toolName);

    if (!tool) {
      throw new Error(`Tool '${toolName}' not found in registry. Available: ${this.toolRegistry.list().join(', ')}`);
    }

    const args = this.parseArgs(toolCall);

    this.sandbox.check(toolName, args);
    const result = await tool.execute(args, context);
    return result;
  }

  private parseArgs(toolCall: ToolCall): any {
    try {
      return JSON.parse(toolCall.function.arguments);
    } catch {
      throw new Error(`Invalid JSON arguments for tool '${toolCall.function.name}': ${toolCall.function.arguments}`);
    }
  }

  private buildCacheKey(messages: any[], toolName: string, args: any): string {
    const messagesStr = JSON.stringify(messages);
    const argsStr = JSON.stringify(args);
    return createHash('sha256').update(messagesStr + toolName + argsStr).digest('hex');
  }

  private accumulateGeneratedText(
    generatedText: string[],
    toolCallRecords: ToolCallRecord[],
    modelConfig: any,
  ): string | null {
    if (generatedText.length === 0) return null;

    // Dynamic Context Limit Calculation
    const contextLimitTokens = modelConfig?.context_limit || (modelConfig?.type === 'ollama' ? 8192 : 32768);
    const maxTokensForAccumulation = Math.floor(contextLimitTokens * 0.25);
    const maxChars = maxTokensForAccumulation * 4;

    const joined = generatedText.join('\n\n---\n\n');
    if (joined.length <= maxChars) {
      return joined;
    }

    // Keep the first turn (usually ## Understanding) and the last turn (usually ## Execution)
    const first = generatedText[0];
    const last = generatedText[generatedText.length - 1];

    const firstLimit = Math.floor(maxChars * 0.4);
    const lastLimit = Math.floor(maxChars * 0.5);

    // Semantic Extraction vs. Slicing Ciego
    let cleanFirst = first;
    const understandingMatch = first.match(/(## Understanding[\s\S]*?)(?:\n##|$)/i);
    if (understandingMatch && understandingMatch[1]) {
      const block = understandingMatch[1].trim();
      cleanFirst = block.length > firstLimit
        ? block.slice(0, firstLimit) + '\n... [Understanding truncated to save context] ...'
        : block;
    } else {
      cleanFirst = first.length > firstLimit
        ? first.slice(0, firstLimit) + '\n... [Understanding truncated to save context] ...'
        : first;
    }

    let cleanLast = last;
    const executionMatch = last.match(/(## Execution[\s\S]*)/i);
    if (executionMatch && executionMatch[1]) {
      const block = executionMatch[1].trim();
      if (block.length > lastLimit) {
        // Keep the header "## Execution\n" and grab the end of the content
        const header = "## Execution\n";
        const contentToSlice = block.slice(header.length);
        const sliceLength = lastLimit - header.length;
        const slicedContent = contentToSlice.slice(contentToSlice.length - Math.max(0, sliceLength));
        cleanLast = `${header}... [Final execution details truncated to save context] ...\n${slicedContent}`;
      } else {
        cleanLast = block;
      }
    } else {
      cleanLast = last.length > lastLimit
        ? '\n... [Final execution details truncated to save context] ...\n' + last.slice(last.length - lastLimit)
        : last;
    }

    // Breadcrumb logic for intermediate turns
    const numIntermediate = generatedText.length - 2;
    let intermediateMarker = '';

    if (numIntermediate > 0) {
      // Find all tools executed in intermediate turns (iteration > 1 and < final iteration)
      // Since generatedText starts at iteration 1, the final iteration is generatedText.length.
      const finalIterationNum = generatedText.length;
      const intermediateTools = toolCallRecords
        ? toolCallRecords
            .filter(r => r.iteration > 1 && r.iteration < finalIterationNum)
            .map(r => r.name)
        : [];

      const uniqueTools = Array.from(new Set(intermediateTools));
      const toolsStr = uniqueTools.length > 0 ? ` Tools executed: ${uniqueTools.join(', ')}.` : '';
      intermediateMarker = `\n\n---\n\n... [Truncated ${numIntermediate} intermediate assistant turns to save context space.${toolsStr}] ...\n\n---\n\n`;
    } else {
      intermediateMarker = '\n\n---\n\n... [Truncated intermediate steps] ...\n\n---\n\n';
    }

    return `${cleanFirst}${intermediateMarker}${cleanLast}`;
  }
}
