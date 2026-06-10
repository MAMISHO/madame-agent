import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConfidenceEngineService } from './confidence.service';

describe('ConfidenceEngineService', () => {
  let service: ConfidenceEngineService;

  const mockRoutingConfig = {
    plan: { provider: 'cloud_nvidia' },
    execution: { provider: 'local_medium' },
    escalation: { provider: 'cloud_nvidia' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfidenceEngineService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'confidence') return { threshold: 0.7 };
              if (key === 'routing') return mockRoutingConfig;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ConfidenceEngineService>(ConfidenceEngineService);
  });

  it('returns execution provider when confidence is high', () => {
    const decision = service.evaluate({ mode: 'execution', confidence: 0.95 });

    expect(decision.shouldEscalate).toBe(false);
    expect(decision.targetProviderKey).toBe('local_medium');
  });

  it('escalates when confidence is below threshold', () => {
    const decision = service.evaluate({ mode: 'execution', confidence: 0.45 });

    expect(decision.shouldEscalate).toBe(true);
    expect(decision.targetProviderKey).toBe('cloud_nvidia');
  });

  it('uses plan provider when mode is plan with high confidence', () => {
    const decision = service.evaluate({ mode: 'plan', confidence: 0.95 });

    expect(decision.shouldEscalate).toBe(false);
    expect(decision.targetProviderKey).toBe('cloud_nvidia');
  });

  it('uses default threshold of 0.7 when config is missing', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfidenceEngineService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(() => undefined),
          },
        },
      ],
    }).compile();

    const localService = module.get<ConfidenceEngineService>(
      ConfidenceEngineService,
    );
    const decision = localService.evaluate({
      mode: 'execution',
      confidence: 0.95,
    });

    expect(decision.shouldEscalate).toBe(false);
    expect(decision.threshold).toBe(0.7);
  });

  it('escalates when confidence equals threshold exactly', () => {
    const decision = service.evaluate({ mode: 'execution', confidence: 0.69 });

    expect(decision.shouldEscalate).toBe(true);
  });

  it('does not escalate when confidence equals or exceeds threshold', () => {
    const decision = service.evaluate({ mode: 'execution', confidence: 0.7 });

    expect(decision.shouldEscalate).toBe(false);
  });
});
