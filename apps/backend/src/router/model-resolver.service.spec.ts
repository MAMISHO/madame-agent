import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ModelResolverService } from './model-resolver.service';
import { ClassifierService } from '../classifier/classifier.service';
import { ConfidenceEngineService } from '../confidence/confidence.service';
import { HarnessEntity } from '../core/infra/database/entities/harness.entity';
import { AgentEntity } from '../core/infra/database/entities/agent.entity';
import { ModelEntity } from '../core/infra/database/entities/model.entity';
import { ProviderEntity } from '../core/infra/database/entities/provider.entity';

jest.mock('../core/infra/database/entities/harness.entity');
jest.mock('../core/infra/database/entities/agent.entity');
jest.mock('../core/infra/database/entities/model.entity');
jest.mock('../core/infra/database/entities/provider.entity');

describe('ModelResolverService', () => {
  let service: ModelResolverService;
  let configService: ConfigService;
  let classifierService: ClassifierService;
  let confidenceEngine: ConfidenceEngineService;

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
    },
    cloud_gemini: {
      type: 'cloud',
      provider: 'google',
      model: 'gemini-1.5-pro',
    },
  };

  const mockModelPairs = [
    {
      id: 'gemma-hybrid',
      name: 'gemma-hybrid-pair',
      local: 'local_medium',
      cloud: 'cloud_gemini',
    },
  ];

  const mockOrchestratorPairs = [
    {
      id: 'gemini-orchestrator',
      name: 'gemini-orch-pair',
      orchestrator: 'cloud_gemini',
      subagents: ['gemma-hybrid'],
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelResolverService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'providers') return mockProvidersConfig;
              if (key === 'model_pairs') return mockModelPairs;
              if (key === 'orchestrator_pairs') return mockOrchestratorPairs;
              if (key === 'routing.subagent.providers') return ['local_medium'];
              return undefined;
            }),
          },
        },
        {
          provide: ClassifierService,
          useValue: {
            classifyTask: jest.fn().mockResolvedValue({ mode: 'execution', confidence: 0.95 }),
          },
        },
        {
          provide: ConfidenceEngineService,
          useValue: {
            evaluate: jest.fn().mockReturnValue({ shouldEscalate: false, targetProviderKey: 'local_medium' }),
          },
        },
      ],
    }).compile();

    service = module.get<ModelResolverService>(ModelResolverService);
    configService = module.get<ConfigService>(ConfigService);
    classifierService = module.get<ClassifierService>(ClassifierService);
    confidenceEngine = module.get<ConfidenceEngineService>(ConfidenceEngineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveModel', () => {
    it('should resolve a direct provider configuration', async () => {
      const result = await service.resolveModel('gemma4:12b-mlx');
      expect(result.providerKey).toBe('local_small');
      expect(result.config.type).toBe('ollama');
      expect(result.escalated).toBe(false);
    });

    it('should resolve a direct provider config using its provider key', async () => {
      const result = await service.resolveModel('cloud_nvidia');
      expect(result.providerKey).toBe('cloud_nvidia');
      expect(result.config.provider).toBe('nvidia');
      expect(result.escalated).toBe(false);
    });

    it('should resolve a hybrid model pair to local when task is execution mode and confidence is high', async () => {
      const result = await service.resolveModel('gemma-hybrid', 'simple task');
      expect(result.providerKey).toBe('local_medium');
      expect(result.config.type).toBe('ollama');
      expect(result.escalated).toBe(false);
      expect(classifierService.classifyTask).toHaveBeenCalledWith('simple task');
    });

    it('should escalate a hybrid model pair to cloud when task mode is plan', async () => {
      (classifierService.classifyTask as jest.Mock).mockResolvedValueOnce({
        mode: 'plan',
        confidence: 0.9,
      });

      const result = await service.resolveModel('gemma-hybrid', 'complex planning task');
      expect(result.providerKey).toBe('cloud_gemini');
      expect(result.config.type).toBe('cloud');
      expect(result.escalated).toBe(true);
    });

    it('should escalate a hybrid model pair when confidence engine recommends escalation', async () => {
      (classifierService.classifyTask as jest.Mock).mockResolvedValueOnce({
        mode: 'execution',
        confidence: 0.3,
      });
      (confidenceEngine.evaluate as jest.Mock).mockReturnValueOnce({
        shouldEscalate: true,
      });

      const result = await service.resolveModel('gemma-hybrid', 'difficult execution task');
      expect(result.providerKey).toBe('cloud_gemini');
      expect(result.config.type).toBe('cloud');
      expect(result.escalated).toBe(true);
    });

    it('should run fallback classifier routing if the model name is unknown', async () => {
      (confidenceEngine.evaluate as jest.Mock).mockReturnValueOnce({
        shouldEscalate: false,
        targetProviderKey: 'local_medium',
      });

      const result = await service.resolveModel('unknown-model-name', 'some user input');
      expect(result.providerKey).toBe('local_medium');
      expect(result.config.model).toBe('gemma4:12b-mlx');
      expect(result.escalated).toBe(false);
    });
  });

  describe('getLocalConfig', () => {
    it('should return local config directly for a non-pair model', () => {
      const result = service.getLocalConfig('cloud_nvidia');
      expect(result.provider).toBe('nvidia');
    });

    it('should resolve local config from pair for a pair model', () => {
      const result = service.getLocalConfig('gemma-hybrid');
      expect(result.type).toBe('ollama');
      expect(result.model).toBe('gemma4:12b-mlx');
    });
  });

  describe('helpers', () => {
    it('should get model pair by name/id', () => {
      const pair = service.getModelPair('gemma-hybrid');
      expect(pair).toBeDefined();
      expect(pair.local).toBe('local_medium');
    });

    it('should get orchestrator pair by name/id', () => {
      const pair = service.getOrchestratorPair('gemini-orchestrator');
      expect(pair).toBeDefined();
      expect(pair.orchestrator).toBe('cloud_gemini');
    });
  });

  describe('needsLocalModels', () => {
    beforeEach(() => {
      (HarnessEntity.findOne as jest.Mock).mockReset();
      (AgentEntity.findAll as jest.Mock).mockReset();
    });

    it('should return true if harness not found', async () => {
      (HarnessEntity.findOne as jest.Mock).mockResolvedValue(null);
      
      const result = await service.needsLocalModels('nonexistent-harness');
      expect(result).toBe(true);
    });

    it('should return true if any agent uses local provider', async () => {
      (HarnessEntity.findOne as jest.Mock).mockResolvedValue({ id: 'h1', code: 'local-harness' });
      (AgentEntity.findAll as jest.Mock).mockResolvedValue([
        { 
          model: { 
            provider: { code: 'ollama' } 
          } 
        }
      ]);
      
      const result = await service.needsLocalModels('local-harness');
      expect(result).toBe(true);
    });

    it('should return false for cloud-only harness', async () => {
      (HarnessEntity.findOne as jest.Mock).mockResolvedValue({ id: 'h2', code: 'cloud-harness' });
      (AgentEntity.findAll as jest.Mock).mockResolvedValue([
        { 
          model: { 
            provider: { code: 'openai' } 
          } 
        }
      ]);
      
      const result = await service.needsLocalModels('cloud-harness');
      expect(result).toBe(false);
    });
  });
});
