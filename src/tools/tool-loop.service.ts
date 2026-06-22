import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { ChatCompletionRequest, ToolCall, ToolCallRecord } from '../proxy/dto/openai.dto';
import { ProviderResponse } from '../providers/provider.interface';
import { ToolRegistryService } from './tool-registry.service';
import { SandboxManagerService } from './sandbox-manager.service';
import { ProvidersService } from '../providers/providers.service';

export interface ToolLoopResult {
  response: ProviderResponse;
  iterations: number;
  toolCallsExecuted: number;
  errors: string[];
  toolCalls: ToolCallRecord[];
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
  ) {
    this.maxIterations = this.configService.get<number>('tools.max_iterations', 20);
    this.globalTimeoutMs = this.configService.get<number>('tools.global_timeout_ms', 300_000);
  }

  async execute(
    request: ChatCompletionRequest,
    modelConfig: any,
    maxIterations?: number,
  ): Promise<ToolLoopResult> {
    const iterations = maxIterations ?? this.maxIterations;
    const messages = [...request.messages];
    const errors: string[] = [];
    let toolCallsExecuted = 0;
    const toolCallRecords: ToolCallRecord[] = [];
    const startTime = Date.now();

    // Session-scoped tool result cache
    const toolCache = new Map<string, any>();

    let loopTimedOut = false;

    for (let i = 0; i < iterations; i++) {
      const elapsed = Date.now() - startTime;
      const remaining = this.globalTimeoutMs - elapsed;

      if (remaining <= 0) {
        errors.push(`Global timeout of ${this.globalTimeoutMs}ms exceeded after ${i} iterations`);
        loopTimedOut = true;
        break;
      }

      const providerType = modelConfig.type;
      const providerInstance = this.providersService.getProvider(providerType);

      // Create AbortController for preemptive timeout on this iteration
      const abortController = new AbortController();
      const abortTimeout = setTimeout(() => abortController.abort(), remaining);
      const requestSignal = (request as any).signal;
      const requestAbortHandler = () => abortController.abort();
      if (requestSignal) {
        requestSignal.addEventListener('abort', requestAbortHandler);
      }

      let response: ProviderResponse;
      try {
        response = await providerInstance.chat(
          { ...request, messages },
          modelConfig,
          abortController.signal,
        );
      } catch (err: any) {
        clearTimeout(abortTimeout);
        if (requestSignal) {
          requestSignal.removeEventListener('abort', requestAbortHandler);
        }
        if (err.name === 'AbortError') {
          const abortMsg = `Provider call aborted after ${elapsed}ms (timeout ${this.globalTimeoutMs}ms)`;
          errors.push(abortMsg);
          this.logger.warn(abortMsg);
          loopTimedOut = true;
          break;
        }
        throw err;
      } finally {
        clearTimeout(abortTimeout);
        if (requestSignal) {
          requestSignal.removeEventListener('abort', requestAbortHandler);
        }
      }

      const toolCalls: ToolCall[] | undefined = response.data?.choices?.[0]?.message?.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        this.logger.log(`ToolLoop: model responded without tool_calls after ${i + 1} iterations (${Date.now() - startTime}ms)`);
        return { response, iterations: i + 1, toolCallsExecuted, errors, toolCalls: toolCallRecords };
      }

      this.logger.log(
        `ToolLoop iteration ${i + 1}: model made ${toolCalls.length} tool call(s) (${Date.now() - startTime}ms elapsed)`,
      );

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
          const latencyMs = Date.now() - toolStart;
          const errMsg = `Tool '${toolName}': ${err.message}`;
          errors.push(errMsg);
          this.logger.warn(`${errMsg} (${latencyMs}ms)`);
          this.logger.debug(`Stack trace for tool '${toolName}' error: ${err.stack}`);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: err.message }),
          });
        }
      }
    }

    if (loopTimedOut) {
      this.logger.warn(`ToolLoop: loop timed out after ${iterations} iterations`);
      return {
        response: { data: { choices: [{ message: { role: 'assistant', content: null } }] } },
        iterations,
        toolCallsExecuted,
        errors,
        toolCalls: toolCallRecords,
      };
    }

    this.logger.warn(`ToolLoop: max iterations reached (${iterations}), returning final response`);

    const providerInstance = this.providersService.getProvider(modelConfig.type);
    try {
      const finalResponse = await providerInstance.chat(
        { ...request, messages },
        modelConfig,
      );
      return { response: finalResponse, iterations, toolCallsExecuted, errors, toolCalls: toolCallRecords };
    } catch (err: any) {
      const finalErrMsg = `Final provider call failed after tool loop: ${err.message}`;
      errors.push(finalErrMsg);
      this.logger.error(finalErrMsg);
      this.logger.debug(`Stack trace: ${err.stack}`);
      return {
        response: { data: { choices: [{ message: { role: 'assistant', content: 'Tool loop completed but final provider call failed.' } }] } },
        iterations,
        toolCallsExecuted,
        errors,
        toolCalls: toolCallRecords,
      };
    }
  }

  private async executeSingleToolCall(
    toolCall: ToolCall,
    context?: { parentRequestId?: string; parentSignal?: AbortSignal },
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
}
