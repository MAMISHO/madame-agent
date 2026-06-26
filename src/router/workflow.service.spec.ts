import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WorkflowService } from './workflow.service';
import { ProvidersService } from '../providers/providers.service';
import { PromptService } from '../prompts/prompt.service';
import { AgentLoggerService } from '../utils/agent-logger.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ToolLoopService } from '../tools/tool-loop.service';
import { SkillManagerService } from '../tools/skill-manager.service';
import { SkillScraperService } from '../tools/skill-scraper.service';
import { ObservabilityService } from '../observability/observability.service';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';

describe('WorkflowService', () => {
  let workflowService: WorkflowService;
  let toolLoopService: ToolLoopService;
  let providersService: ProvidersService;
  let toolRegistryService: ToolRegistryService;
  let promptService: PromptService;
  let mockProvider: any;

  const mockProvidersConfig = {
    cloud_nvidia: {
      type: 'cloud',
      provider: 'nvidia',
      model: 'meta/llama-3.3-70b-instruct',
      api_key_env: 'NVIDIA_API_KEY',
    },
    local_medium: {
      type: 'ollama',
      model: 'gemma4:12b-mlx',
    },
  };

  beforeEach(async () => {
    mockProvider = {
      chat: jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'mock planner plan content',
              },
            },
          ],
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'providers') return mockProvidersConfig;
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
          provide: PromptService,
          useValue: {
            loadPrompt: jest.fn().mockImplementation((id: string) => `mock prompt for ${id}`),
          },
        },
        {
          provide: AgentLoggerService,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
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
          provide: ToolLoopService,
          useValue: {
            execute: jest.fn().mockImplementation(async (request: ChatCompletionRequest) => {
              if (request.requestId?.startsWith('prep_')) {
                return {
                  response: {
                    data: {
                      choices: [
                        {
                          message: {
                            role: 'assistant',
                            content: 'mock environment report content',
                          },
                        },
                      ],
                    },
                  },
                  iterations: 1,
                  toolCallsExecuted: 0,
                  errors: [],
                  toolCalls: [],
                };
              }
              // Orchestrator response
              return {
                response: {
                  data: {
                    choices: [
                      {
                        message: {
                          role: 'assistant',
                          content: 'mock orchestrator final content',
                        },
                      },
                    ],
                  },
                },
                iterations: 2,
                toolCallsExecuted: 1,
                errors: [],
                toolCalls: [],
              };
            }),
          },
        },
        {
          provide: SkillManagerService,
          useValue: {
            getSkillContent: jest.fn(),
            loadSkills: jest.fn(),
          },
        },
        {
          provide: SkillScraperService,
          useValue: {
            scrapeSkill: jest.fn(),
          },
        },
        {
          provide: ObservabilityService,
          useValue: {
            trackRequest: jest.fn(),
          },
        },
      ],
    }).compile();

    workflowService = module.get<WorkflowService>(WorkflowService);
    toolLoopService = module.get<ToolLoopService>(ToolLoopService);
    providersService = module.get<ProvidersService>(ProvidersService);
    toolRegistryService = module.get<ToolRegistryService>(ToolRegistryService);
    promptService = module.get<PromptService>(PromptService);
  });

  it('should run multi-agent workflow in inverted order: Preparer first, then Planner, then Orchestrator', async () => {
    const request: ChatCompletionRequest = {
      model: 'cloud_nvidia',
      messages: [{ role: 'user', content: 'test task' }],
    };

    const pair = {
      id: 'test-pair',
      name: 'Test Pair',
      orchestrator: 'cloud_nvidia',
      subagents: ['local_medium'],
    };

    const result = await workflowService.executeWorkflow(request, pair);

    // 1. Tool registration called first
    expect(toolRegistryService.register).toHaveBeenCalled();

    // 2. Preparer was called via toolLoop.execute with tool_choice required
    expect(toolLoopService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.stringMatching(/^prep_/),
        tool_choice: 'required',
        messages: [
          { role: 'system', content: 'mock prompt for preparer' },
          { role: 'user', content: 'Task: test task' },
        ],
      }),
      mockProvidersConfig.cloud_nvidia,
    );

    // 3. Planner was called via chat completion, receiving the environment report
    expect(providersService.getProvider).toHaveBeenCalledWith('cloud');
    expect(mockProvider.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.stringMatching(/^plan_/),
        messages: [
          { role: 'system', content: 'mock prompt for planner' },
          { role: 'user', content: 'Task: test task\n\nEnvironment Report:\nmock environment report content' },
        ],
      }),
      mockProvidersConfig.cloud_nvidia,
    );

    // 4. Orchestrator was called via toolLoop.execute with enriched messages
    expect(toolLoopService.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tool_choice: 'required',
        messages: [
          { role: 'system', content: 'mock prompt for orchestrator-delegate' },
          {
            role: 'user',
            content: 'Original Task: test task\n\nImplementation Plan:\nmock planner plan content\n\nEnvironment Status:\nmock environment report content',
          },
        ],
      }),
      mockProvidersConfig.cloud_nvidia,
    );

    // 5. Correct result format returned
    expect(result.response.data.choices[0].message.content).toBe('mock orchestrator final content');
    expect(result.metadata.mode).toBe('orchestrator');
  });
});
