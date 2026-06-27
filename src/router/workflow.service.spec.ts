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
import { ValidatorService } from '../tools/validator.service';
import { HarnessService } from '../harness/harness.service';

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
        {
          provide: ValidatorService,
          useValue: {
            getValidatorsForEnvironment: jest.fn().mockReturnValue([]),
            getGlobalCheckCommand: jest.fn().mockReturnValue('echo "check"'),
          },
        },
        {
          provide: HarnessService,
          useValue: {
            getStrategy: jest.fn().mockReturnValue({
              name: 'cli',
              parseRequest: jest.fn().mockImplementation((messages) => ({
                userMessage: 'test task',
                isInterventionReply: false,
              })),
              formatInterventionResponse: jest.fn().mockImplementation((requestId, question, orchestratorConfig) => ({
                response: {
                  data: {
                    status: 'pending_user_input',
                    requestId,
                    question,
                  },
                },
                metadata: {
                  mode: 'orchestrator',
                  escalated: false,
                  providerKey: orchestratorConfig?.provider || 'unknown',
                  providerType: orchestratorConfig?.type || 'unknown',
                  model: orchestratorConfig?.model || 'unknown',
                  originalTokens: 0,
                  finalTokens: 0,
                  iterations: 0,
                  toolCalls: [],
                  toolErrors: [],
                },
              })),
            }),
          },
        },
      ],
    }).compile();

    workflowService = module.get<WorkflowService>(WorkflowService);
    toolLoopService = module.get<ToolLoopService>(ToolLoopService);
    providersService = module.get<ProvidersService>(ProvidersService);
    toolRegistryService = module.get<ToolRegistryService>(ToolRegistryService);
    promptService = module.get<PromptService>(PromptService);

    // Mock Ollama port check so tests don't depend on a real Ollama process
    jest.spyOn(workflowService as any, 'isOllamaResponsive').mockResolvedValue(true);
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

    // 2. Preparer was called via toolLoop.execute
    expect(toolLoopService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.stringMatching(/^prep_/),
        messages: [
          { role: 'system', content: 'mock prompt for preparer' },
          { role: 'user', content: 'Task: test task' },
        ],
      }),
      mockProvidersConfig.cloud_nvidia,
      undefined,
      expect.objectContaining({
        parentRequestId: expect.any(String),
        userResponses: expect.any(Map),
      })
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

  it('should pause execution with status pending_user_input when Ollama is down and resume when user approves', async () => {
    const request: ChatCompletionRequest = {
      model: 'cloud_nvidia',
      messages: [{ role: 'user', content: 'test task' }],
      requestId: 'req_123',
    };

    const pair = {
      id: 'test-pair',
      name: 'Test Pair',
      orchestrator: 'cloud_nvidia',
      subagents: ['local_medium'],
    };

    // Make Ollama appear down so ensureOllamaReady throws UserInteractionRequiredError
    jest.spyOn(workflowService as any, 'isOllamaResponsive').mockResolvedValue(false);

    const result = await workflowService.executeWorkflow(request, pair);

    // Expect intervention response (via CLI strategy formatInterventionResponse)
    expect(result.response.data.status).toBe('pending_user_input');
    expect(result.response.data.question).toContain('Ollama no está activo');

    // On resume, simulate Ollama is now up (user started it manually or script worked)
    jest.spyOn(workflowService as any, 'isOllamaResponsive').mockResolvedValue(true);

    const reqId = result.response.data.requestId;
    const resumeResult = await workflowService.resumeWorkflow(reqId, 'Sí');

    // Expect the final result to be returned successfully
    expect(resumeResult.response.data.choices[0].message.content).toBe('mock orchestrator final content');
  });
});
