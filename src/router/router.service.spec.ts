import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RouterService } from './router.service';
import { ProvidersService } from '../providers/providers.service';
import { ClassifierService } from '../classifier/classifier.service';
import { ConfidenceEngineService } from '../confidence/confidence.service';
import { ModelResolverService } from './model-resolver.service';
import { ContextService } from '../context/context.service';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
import {
  ModelProvider,
  ProviderResponse,
} from '../providers/provider.interface';
import { CacheService } from '../cache/cache.service';
import { TranslationService } from '../translation/translation.service';
import { ToolLoopService } from '../tools/tool-loop.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ObservabilityService } from '../observability/observability.service';
import { SkillManagerService } from '../tools/skill-manager.service';
import { PromptService } from '../prompts/prompt.service';
import { WorkflowService } from './workflow.service';

describe('RouterService', () => {
  let routerService: RouterService;
  let configService: ConfigService;
  let providersService: ProvidersService;
  let classifierService: ClassifierService;
  let mockProvider: ModelProvider;
  let moduleRef: TestingModule;

  const mockProvidersConfig = {
    local_small: {
      type: 'ollama',
      model: 'gemma4:12b-mlx',
      base_url: 'http://localhost:11434',
    },
    local_medium: {
      type: 'ollama',
      model: 'gemma4:12b-mlx',
      base_url: 'http://localhost:11434',
    },
    cloud_nvidia: {
      type: 'cloud',
      provider: 'nvidia',
      model: 'meta/llama-3.3-70b-instruct',
      api_key_env: 'NVIDIA_API_KEY',
    },
  };

  const mockRoutingConfig = {
    plan: { provider: 'cloud_nvidia' },
    execution: { provider: 'local_medium' },
    escalation: { provider: 'cloud_nvidia' },
  };

  const mockConfidenceConfig = { threshold: 0.7 };

  const defaultClassification = {
    mode: 'execution' as const,
    confidence: 0.85,
  };

  beforeEach(async () => {
    mockProvider = {
      chat: jest.fn().mockImplementation(
        (
          _request: ChatCompletionRequest,
          _modelConfig: any,
        ): Promise<ProviderResponse> =>
          Promise.resolve({
            data: {
              id: 'test-id',
              object: 'chat.completion',
              created: Date.now(),
              model: _modelConfig.model,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'test response' },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
              },
            },
          }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RouterService,
        ModelResolverService,
        ConfidenceEngineService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'providers') return mockProvidersConfig;
              if (key === 'routing') return mockRoutingConfig;
              if (key === 'confidence') return mockConfidenceConfig;
              return undefined;
            }),
          },
        },
        {
          provide: ProvidersService,
          useValue: {
            getProvider: jest.fn().mockReturnValue(mockProvider),
          },
        },
        {
          provide: ClassifierService,
          useValue: {
            classifyTask: jest.fn().mockResolvedValue(defaultClassification),
          },
        },
        {
          provide: ContextService,
          useValue: {
            process: jest
              .fn()
              .mockImplementation((messages: any[]) => ({
                messages,
                dedup: { messages, removedCount: 0 },
                compress: {
                  messages,
                  originalTokens: 100,
                  finalTokens: 100,
                  removedTokens: 0,
                },
              })),
          },
        },
        {
          provide: CacheService,
          useValue: {
            findSimilar: jest.fn().mockResolvedValue(null),
            store: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: TranslationService,
          useValue: {
            isEnabled: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: ToolLoopService,
          useValue: {
            execute: jest.fn().mockResolvedValue({
              response: { data: { choices: [{ message: { content: 'test response' } }] } },
              toolCalls: [],
            }),
          },
        },
        {
          provide: ToolRegistryService,
          useValue: {
            register: jest.fn(),
            getDefinitions: jest.fn().mockReturnValue([]),
            get: jest.fn(),
          },
        },
        {
          provide: ObservabilityService,
          useValue: {
            startTimer: jest.fn(),
            finishTimer: jest.fn(),
            trackRequest: jest.fn(),
            registerSubagentTask: jest.fn(),
            updateSubagentTaskStatus: jest.fn(),
            getActiveSubagentTasks: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: SkillManagerService,
          useValue: {
            getSkillContent: jest.fn().mockReturnValue('mock skill content'),
          },
        },
        {
          provide: PromptService,
          useValue: {
            loadPrompt: jest.fn().mockReturnValue('mock prompt content'),
          },
        },
        {
          provide: WorkflowService,
          useValue: {
            executeWorkflow: jest.fn().mockResolvedValue({
              response: { data: { choices: [{ message: { content: 'test response' } }] } },
              metadata: {
                mode: 'orchestrator',
                escalated: false,
                providerKey: 'cloud_nvidia',
                providerType: 'cloud',
                model: 'meta/llama-3.3-70b-instruct',
                originalTokens: 10,
                finalTokens: 10,
              },
            }),
          },
        },
      ],
    }).compile();

    moduleRef = module;
    routerService = module.get<RouterService>(RouterService);
    configService = module.get<ConfigService>(ConfigService);
    providersService = module.get<ProvidersService>(ProvidersService);
    classifierService = module.get<ClassifierService>(ClassifierService);
    routerService.onModuleInit();
  });

  describe('direct routing', () => {
    it('routes to correct provider when model matches configured provider', async () => {
      const request: ChatCompletionRequest = {
        model: 'gemma4:12b-mlx',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const result = await routerService.route(request);

      expect(providersService.getProvider).toHaveBeenCalledWith('ollama');
      expect(mockProvider.chat).toHaveBeenCalledWith(
        request,
        expect.objectContaining({ model: 'gemma4:12b-mlx', type: 'ollama' }),
      );
      expect(result.response.data).toBeDefined();
      expect(result.response.data.model).toBe('gemma4:12b-mlx');
    });

    it('falls back to classifier when model does not match any provider', async () => {
      const request: ChatCompletionRequest = {
        model: 'unknown-model',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const result = await routerService.route(request);

      expect(classifierService.classifyTask).toHaveBeenCalled();
      expect(providersService.getProvider).toHaveBeenCalledWith('ollama');
      expect(result.response.data).toBeDefined();
    });

    it('routes to cloud provider for plan tasks via classifier', async () => {
      (classifierService.classifyTask as jest.Mock).mockResolvedValue({
        mode: 'plan',
        confidence: 0.91,
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'design the architecture' }],
      };

      const result = await routerService.route(request);

      expect(providersService.getProvider).toHaveBeenCalledWith('cloud');
      expect(mockProvider.chat).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          model: 'meta/llama-3.3-70b-instruct',
          type: 'cloud',
        }),
      );
      expect(result.response.data).toBeDefined();
    });
  });

  describe('classifier routing', () => {
    it('uses classifier when no model specified', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'fix this bug' }],
      };

      const result = await routerService.route(request);

      expect(classifierService.classifyTask).toHaveBeenCalled();
      expect(result.response.data).toBeDefined();
    });

    it('throws when provider config is missing for selected key', async () => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'providers') return {};
        if (key === 'routing')
          return { execution: { provider: 'nonexistent' } };
        if (key === 'confidence') return mockConfidenceConfig;
        return undefined;
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'hello' }],
      };

      await expect(routerService.route(request)).rejects.toThrow(
        'Provider configuration missing for key: nonexistent',
      );
    });
  });

  describe('confidence & escalation', () => {
    it('uses execution provider when confidence is high', async () => {
      (classifierService.classifyTask as jest.Mock).mockResolvedValue({
        mode: 'execution',
        confidence: 0.95,
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'fix this typo' }],
      };

      const result = await routerService.route(request);

      expect(providersService.getProvider).toHaveBeenCalledWith('ollama');
      expect(result.response.data).toBeDefined();
    });

    it('escalates to cloud when confidence is below threshold', async () => {
      (classifierService.classifyTask as jest.Mock).mockResolvedValue({
        mode: 'execution',
        confidence: 0.45,
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'build a distributed system' }],
      };

      const result = await routerService.route(request);

      expect(providersService.getProvider).toHaveBeenCalledWith('cloud');
      expect(mockProvider.chat).toHaveBeenCalledWith(
        request,
        expect.objectContaining({ model: 'meta/llama-3.3-70b-instruct' }),
      );
      expect(result.response.data).toBeDefined();
    });

    it('does not escalate plan tasks with high confidence', async () => {
      (classifierService.classifyTask as jest.Mock).mockResolvedValue({
        mode: 'plan',
        confidence: 0.92,
      });

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'design system architecture' }],
      };

      const result = await routerService.route(request);

      expect(providersService.getProvider).toHaveBeenCalledWith('cloud');
      expect(result.response.data).toBeDefined();
    });
  });

  describe('findProviderByModel', () => {
    it('matches model name ignoring provider key', async () => {
      const request: ChatCompletionRequest = {
        model: 'meta/llama-3.3-70b-instruct',
        messages: [{ role: 'user', content: 'hello' }],
      };

      const result = await routerService.route(request);

      expect(providersService.getProvider).toHaveBeenCalledWith('cloud');
      expect(mockProvider.chat).toHaveBeenCalledWith(
        request,
        expect.objectContaining({ model: 'meta/llama-3.3-70b-instruct' }),
      );
      expect(result.response.data).toBeDefined();
    });
  });

  describe('streaming', () => {
    it('passes streaming flag to provider', async () => {
      const mockStream = (async function* () {})();
      mockProvider.chat = jest.fn().mockResolvedValue({ stream: mockStream });

      const request: ChatCompletionRequest = {
        model: 'gemma4:12b-mlx',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      };

      const result = await routerService.route(request);

      expect(result.response.stream).toBeDefined();
    });
  });

  describe('orchestrator pairs and delegation', () => {
    const mockOrchestratorPairs = [
      {
        id: 'llama-gemma-orchestrator',
        name: 'Llama70B-Orchestrator+Gemma12B',
        orchestrator: 'cloud_nvidia',
        subagents: ['local_medium', 'local_small'],
      },
    ];

    beforeEach(() => {
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'providers') return mockProvidersConfig;
        if (key === 'routing') return mockRoutingConfig;
        if (key === 'confidence') return mockConfidenceConfig;
        if (key === 'orchestrator_pairs') return mockOrchestratorPairs;
        return undefined;
      });
    });

    it('routes orchestrator pair to the orchestrator model and injects delegate_subagent tool', async () => {
      const request: ChatCompletionRequest = {
        model: 'llama-gemma-orchestrator',
        messages: [{ role: 'user', content: 'delegate this job' }],
      };

      const result = await routerService.route(request);

      expect(moduleRef.get(WorkflowService).executeWorkflow).toHaveBeenCalledWith(
        request,
        expect.objectContaining({ id: 'llama-gemma-orchestrator' })
      );
      expect(result.metadata.mode).toBe('orchestrator');
    });

    it('executes delegate_subagent execution callback with failover and self-fallback', async () => {
      const registerSpy = moduleRef.get(ToolRegistryService).register as jest.Mock;
      const delegationTool = registerSpy.mock.calls.find(
        (call) => call[0].definition.function.name === 'delegate_subagent',
      )?.[0];

      expect(delegationTool).toBeDefined();

      const routeSpy = jest.spyOn(routerService, 'route');
      routeSpy.mockImplementation(async (req: ChatCompletionRequest) => {
        if (req.model === 'local_medium') {
          throw new Error('Local medium offline');
        }
        if (req.model === 'local_small') {
          return {
            response: {
              data: {
                choices: [{ message: { role: 'assistant', content: 'resolved by small' } }],
              },
            },
            metadata: {} as any,
          };
        }
        return {
          response: {
            data: { choices: [{ message: { role: 'assistant', content: 'orchestrator response' } }] },
          },
          metadata: {} as any,
        };
      });

      const executeResult = await delegationTool.execute(
        { task: 'do cleanup' },
        { request: { model: 'llama-gemma-orchestrator' } },
      );

      expect(executeResult.status).toBe('success');
      expect(executeResult.result).toBe('resolved by small');
      expect(routeSpy).toHaveBeenCalledWith(expect.objectContaining({ model: 'local_medium' }));
      expect(routeSpy).toHaveBeenCalledWith(expect.objectContaining({ model: 'local_small' }));
    });
  });
});
