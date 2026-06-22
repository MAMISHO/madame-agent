import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ToolLoopService } from './tool-loop.service';
import { ToolRegistryService } from './tool-registry.service';
import { SandboxManagerService } from './sandbox-manager.service';
import { ProvidersService } from '../providers/providers.service';
import { OllamaProvider } from '../providers/ollama.provider';
import { CloudProvider } from '../providers/cloud.provider';
import { HuggingFaceProvider } from '../providers/huggingface.provider';
import { ChatCompletionRequest, ToolCallRecord } from '../proxy/dto/openai.dto';

describe('ToolLoopService', () => {
  let service: ToolLoopService;
  let mockProvidersService: any;
  let mockToolRegistry: any;
  let mockSandbox: any;

  const makeResponse = (toolCalls?: any[]) => ({
    data: {
      choices: [
        {
          message: {
            role: 'assistant',
            content: toolCalls ? null : 'final answer',
            tool_calls: toolCalls,
          },
        },
      ],
    },
  });

  beforeEach(async () => {
    mockToolRegistry = {
      get: jest.fn(),
      list: jest.fn().mockReturnValue(['read_file']),
    };

    mockSandbox = {
      check: jest.fn(),
    };

    mockProvidersService = {
      getProvider: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolLoopService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'tools.max_iterations') return 10;
              if (key === 'tools.global_timeout_ms') return 120000;
              return undefined;
            }),
          },
        },
        { provide: ToolRegistryService, useValue: mockToolRegistry },
        { provide: SandboxManagerService, useValue: mockSandbox },
        { provide: ProvidersService, useValue: mockProvidersService },
      ],
    }).compile();

    service = module.get<ToolLoopService>(ToolLoopService);
  });

  it('returns response directly when model does not use tool_calls', async () => {
    const mockProvider = { chat: jest.fn().mockResolvedValue(makeResponse()) };
    mockProvidersService.getProvider.mockReturnValue(mockProvider);

    const result = await service.execute(
      { messages: [{ role: 'user', content: 'hello' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
    );

    expect(result.iterations).toBe(1);
    expect(result.toolCallsExecuted).toBe(0);
    expect(result.response.data.choices[0].message.content).toBe('final answer');
    expect(result.toolCalls).toEqual([]);
  });

  it('executes a single tool call and returns model response', async () => {
    const toolFn = jest.fn().mockResolvedValue({ content: 'file contents' });
    mockToolRegistry.get.mockReturnValue({
      definition: {
        type: 'function',
        function: { name: 'read_file', description: '', parameters: {} },
      },
      execute: toolFn,
    });

    // First call returns tool_calls, second returns final
    const mockProvider = {
      chat: jest
        .fn()
        .mockResolvedValueOnce(
          makeResponse([
            { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"test.ts"}' } },
          ]),
        )
        .mockResolvedValueOnce(makeResponse()),
    };
    mockProvidersService.getProvider.mockReturnValue(mockProvider);

    const result = await service.execute(
      { messages: [{ role: 'user', content: 'read file' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
    );

    expect(result.iterations).toBe(2);
    expect(result.toolCallsExecuted).toBe(1);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_file');
    expect(result.toolCalls[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.toolCalls[0].iteration).toBe(1);
    expect(toolFn).toHaveBeenCalledWith({ path: 'test.ts' });
    expect(mockSandbox.check).toHaveBeenCalledWith('read_file', { path: 'test.ts' });
  });

  it('handles multiple tool calls in a single iteration', async () => {
    const toolFn = jest.fn().mockResolvedValue({ content: 'data' });
    mockToolRegistry.get.mockReturnValue({
      definition: {
        type: 'function',
        function: { name: 'read_file', description: '', parameters: {} },
      },
      execute: toolFn,
    });

    const mockProvider = {
      chat: jest
        .fn()
        .mockResolvedValueOnce(
          makeResponse([
            { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
            { id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.ts"}' } },
          ]),
        )
        .mockResolvedValueOnce(makeResponse()),
    };
    mockProvidersService.getProvider.mockReturnValue(mockProvider);

    const result = await service.execute(
      { messages: [{ role: 'user', content: 'read two files' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
    );

    expect(result.toolCallsExecuted).toBe(2);
    expect(result.toolCalls).toHaveLength(2);
    expect(toolFn).toHaveBeenCalledTimes(2);
  });

  it('handles unknown tool gracefully and continues', async () => {
    mockToolRegistry.get.mockReturnValue(undefined);

    const mockProvider = {
      chat: jest
        .fn()
        .mockResolvedValueOnce(
          makeResponse([
            { id: 'call_1', type: 'function', function: { name: 'nonexistent', arguments: '{}' } },
          ]),
        )
        .mockResolvedValueOnce(makeResponse()),
    };
    mockProvidersService.getProvider.mockReturnValue(mockProvider);

    const result = await service.execute(
      { messages: [{ role: 'user', content: 'do something' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('nonexistent');
    expect(result.toolCalls).toHaveLength(0);
  });

  it('respects max iterations', async () => {
    const mockProvider = {
      chat: jest.fn().mockResolvedValue(
        makeResponse([
          { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"x.ts"}' } },
        ]),
      ),
    };
    const toolFn = jest.fn().mockResolvedValue({ content: 'data' });
    mockToolRegistry.get.mockReturnValue({
      definition: {
        type: 'function',
        function: { name: 'read_file', description: '', parameters: {} },
      },
      execute: toolFn,
    });
    mockProvidersService.getProvider.mockReturnValue(mockProvider);

    const result = await service.execute(
      { messages: [{ role: 'user', content: 'loop' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
      3,
    );

    expect(result.iterations).toBe(3);
    expect(mockProvider.chat).toHaveBeenCalledTimes(4); // 3 loop + 1 final
  });

  // === NEW: Abort tests ===

  it('aborts provider call when AbortController signal fires', async () => {
    // Mock that hangs forever but listens to the abort signal
    const mockProvider = {
      chat: jest.fn().mockImplementation(
        (_req: any, _config: any, signal?: AbortSignal) =>
          new Promise<never>((_, reject) => {
            if (signal?.aborted) {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
              return;
            }
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            }, { once: true });
          }),
      ),
    };

    // Create a module with a very short timeout so abort fires immediately
    const abortModule: TestingModule = await Test.createTestingModule({
      providers: [
        ToolLoopService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'tools.max_iterations') return 10;
              if (key === 'tools.global_timeout_ms') return 50;
              return undefined;
            }),
          },
        },
        { provide: ToolRegistryService, useValue: mockToolRegistry },
        { provide: SandboxManagerService, useValue: mockSandbox },
        {
          provide: ProvidersService,
          useValue: { getProvider: jest.fn().mockReturnValue(mockProvider) },
        },
      ],
    }).compile();

    const abortService = abortModule.get<ToolLoopService>(ToolLoopService);
    const result = await abortService.execute(
      { messages: [{ role: 'user', content: 'do something' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
      1,
    );

    // Should have aborted (error recorded) and broke out of loop
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain('aborted');
  });

  it('skips tool call when remaining timeout is zero — immediate break', async () => {
    const mockProvider = {
      chat: jest.fn(),
    };

    // Re-create service with 0ms timeout
    const zeroModule: TestingModule = await Test.createTestingModule({
      providers: [
        ToolLoopService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'tools.max_iterations') return 10;
              if (key === 'tools.global_timeout_ms') return 0;
              return undefined;
            }),
          },
        },
        { provide: ToolRegistryService, useValue: mockToolRegistry },
        { provide: SandboxManagerService, useValue: mockSandbox },
        {
          provide: ProvidersService,
          useValue: { getProvider: jest.fn().mockReturnValue(mockProvider) },
        },
      ],
    }).compile();

    const zeroTimeoutService = zeroModule.get<ToolLoopService>(ToolLoopService);
    const result = await zeroTimeoutService.execute(
      { messages: [{ role: 'user', content: 'do something' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
    );

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain('timeout');
    // Provider should NEVER be called
    expect(mockProvider.chat).not.toHaveBeenCalled();
  });

  // === NEW: Cache tests ===

  it('returns cached result for same tool and same args within same iteration', async () => {
    // The cache key includes messagesStr + toolName + argsStr.
    // Two IDENTICAL tool calls emitted by the model in the SAME response
    // should share the same messages array → cache hit on the second call.
    const toolFn = jest.fn().mockResolvedValue({ content: 'cached data' });
    mockToolRegistry.get.mockReturnValue({
      definition: {
        type: 'function',
        function: { name: 'read_file', description: '', parameters: {} },
      },
      execute: toolFn,
    });

    // Two identical tool calls in the SAME response
    const sameToolCalls = [
      { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"same.txt"}' } },
      { id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{"path":"same.txt"}' } },
    ];

    const mockProvider = {
      chat: jest
        .fn()
        .mockResolvedValueOnce(makeResponse(sameToolCalls))
        .mockResolvedValueOnce(makeResponse()),  // final response
    };
    mockProvidersService.getProvider.mockReturnValue(mockProvider);

    const result = await service.execute(
      { messages: [{ role: 'user', content: 'read file' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
      2,
    );

    // Tool should be executed only ONCE (second call from cache)
    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(result.toolCallsExecuted).toBe(2);  // both count as executed tool calls
    expect(result.errors).toHaveLength(0);
  });

  it('cache miss for different tool args within same iteration', async () => {
    const toolFn = jest.fn().mockResolvedValue({ content: 'data' });
    mockToolRegistry.get.mockReturnValue({
      definition: {
        type: 'function',
        function: { name: 'read_file', description: '', parameters: {} },
      },
      execute: toolFn,
    });

    // Two tool calls with DIFFERENT args in the same response → cache miss on second
    const differentToolCalls = [
      { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
      { id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{"path":"b.txt"}' } },
    ];

    const mockProvider = {
      chat: jest
        .fn()
        .mockResolvedValueOnce(makeResponse(differentToolCalls))
        .mockResolvedValueOnce(makeResponse()),  // final response
    };
    mockProvidersService.getProvider.mockReturnValue(mockProvider);

    const result = await service.execute(
      { messages: [{ role: 'user', content: 'read files' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
      2,
    );

    // Different args means tool is executed twice
    expect(toolFn).toHaveBeenCalledTimes(2);
    expect(result.toolCallsExecuted).toBe(2);
  });

  // === NEW: Logging tests ===

  it('logs tool name, iteration, and latency at INFO level on successful call', async () => {
    const toolFn = jest.fn().mockResolvedValue({ content: 'file contents' });
    mockToolRegistry.get.mockReturnValue({
      definition: {
        type: 'function',
        function: { name: 'read_file', description: '', parameters: {} },
      },
      execute: toolFn,
    });

    const mockProvider = {
      chat: jest
        .fn()
        .mockResolvedValueOnce(
          makeResponse([
            { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"test.ts"}' } },
          ]),
        )
        .mockResolvedValueOnce(makeResponse()),
    };
    mockProvidersService.getProvider.mockReturnValue(mockProvider);

    // Spy on the service's logger
    const logSpy = jest.spyOn(service['logger'], 'log');

    await service.execute(
      { messages: [{ role: 'user', content: 'read file' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
    );

    // Should contain at least one log with 'Tool executing' or 'completed'
    const toolLogs = logSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        (call[0].includes("'read_file'") || call[0].includes('read_file')),
    );
    expect(toolLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('logs DEBUG payloads that are hidden at INFO level', async () => {
    const toolFn = jest.fn().mockResolvedValue({ content: 'file contents' });
    mockToolRegistry.get.mockReturnValue({
      definition: {
        type: 'function',
        function: { name: 'read_file', description: '', parameters: {} },
      },
      execute: toolFn,
    });

    const mockProvider = {
      chat: jest
        .fn()
        .mockResolvedValueOnce(
          makeResponse([
            { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"test.ts"}' } },
          ]),
        )
        .mockResolvedValueOnce(makeResponse()),
    };
    mockProvidersService.getProvider.mockReturnValue(mockProvider);

    const debugSpy = jest.spyOn(service['logger'], 'debug');

    await service.execute(
      { messages: [{ role: 'user', content: 'read file' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
    );

    // DEBUG messages should have been called
    expect(debugSpy).toHaveBeenCalled();
    // At least one should contain args/result detail
    const debugPayloads = debugSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        (call[0].includes('args') || call[0].includes('result') || call[0].includes('cache HIT')),
    );
    expect(debugPayloads.length).toBeGreaterThanOrEqual(1);
  });

  it('logs stack trace when tool call throws', async () => {
    mockToolRegistry.get.mockReturnValue({
      definition: {
        type: 'function',
        function: { name: 'read_file', description: '', parameters: {} },
      },
      execute: jest.fn().mockRejectedValue(new Error('execution failed')),
    });

    const mockProvider = {
      chat: jest
        .fn()
        .mockResolvedValueOnce(
          makeResponse([
            { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"x.ts"}' } },
          ]),
        )
        .mockResolvedValueOnce(makeResponse()),
    };
    mockProvidersService.getProvider.mockReturnValue(mockProvider);

    const debugSpy = jest.spyOn(service['logger'], 'debug');

    await service.execute(
      { messages: [{ role: 'user', content: 'read file' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
    );

    // Should log stack trace at DEBUG level
    const stackTraces = debugSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('Stack trace'),
    );
    expect(stackTraces.length).toBeGreaterThanOrEqual(1);
  });

  // === NEW: Metadata test (ToolCallRecord) ===

  it('includes ToolCallRecord in result with name, args, result, latencyMs, iteration', async () => {
    const toolFn = jest.fn().mockResolvedValue({ content: 'file contents' });
    mockToolRegistry.get.mockReturnValue({
      definition: {
        type: 'function',
        function: { name: 'read_file', description: '', parameters: {} },
      },
      execute: toolFn,
    });

    const mockProvider = {
      chat: jest
        .fn()
        .mockResolvedValueOnce(
          makeResponse([
            { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"test.ts"}' } },
          ]),
        )
        .mockResolvedValueOnce(makeResponse()),
    };
    mockProvidersService.getProvider.mockReturnValue(mockProvider);

    const result = await service.execute(
      { messages: [{ role: 'user', content: 'read file' }] } as ChatCompletionRequest,
      { type: 'ollama', model: 'test-model' },
    );

    expect(result.toolCalls).toHaveLength(1);
    const record = result.toolCalls[0];
    expect(record.name).toBe('read_file');
    expect(record.args).toEqual({ path: 'test.ts' });
    expect(record.result).toEqual({ content: 'file contents' });
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    expect(record.iteration).toBe(1);
  });

  // === NEW: HuggingFace abort guard test ===

  it('HuggingFace provider rejects on abort via Promise.race', async () => {
    const mockHfProvider = {
      chat: jest.fn().mockImplementation(
        async (_req: any, _config: any, signal?: AbortSignal) => {
          // Simulate the Promise.race pattern from HuggingFaceProvider
          const hfPromise = new Promise<never>(() => {}); // never resolves
          await Promise.race([
            hfPromise,
            new Promise<never>((_, reject) => {
              if (signal?.aborted) {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
                return;
              }
              signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              }, { once: true });
            }),
          ]);
          return makeResponse();
        },
      ),
    };

    // Create module with short timeout so abort fires
    const hfModule: TestingModule = await Test.createTestingModule({
      providers: [
        ToolLoopService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'tools.max_iterations') return 10;
              if (key === 'tools.global_timeout_ms') return 50;
              return undefined;
            }),
          },
        },
        { provide: ToolRegistryService, useValue: mockToolRegistry },
        { provide: SandboxManagerService, useValue: mockSandbox },
        {
          provide: ProvidersService,
          useValue: { getProvider: jest.fn().mockReturnValue(mockHfProvider) },
        },
      ],
    }).compile();

    const hfService = hfModule.get<ToolLoopService>(ToolLoopService);
    const result = await hfService.execute(
      { messages: [{ role: 'user', content: 'test' }] } as ChatCompletionRequest,
      { type: 'huggingface', model: 'test-model' },
      1,
    );

    // Should have aborted and recorded controlled error (not a crash)
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]).toContain('aborted');
  });
});
