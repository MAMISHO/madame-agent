import { Test, TestingModule } from '@nestjs/testing';
import { ObservabilityService } from './observability.service';
import { CostTrackerService } from './cost-tracker.service';

describe('ObservabilityService', () => {
  let service: ObservabilityService;

  beforeEach(async () => {
    const mockCostTracker = {
      trackCost: jest.fn(),
      getSessionStats: jest.fn().mockReturnValue({
        cloudInputTokens: 0,
        cloudOutputTokens: 0,
        totalCloudUsd: 0,
        localInputTokens: 0,
        localOutputTokens: 0,
        totalSavedUsd: 0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObservabilityService,
        { provide: CostTrackerService, useValue: mockCostTracker }
      ],
    }).compile();

    service = module.get<ObservabilityService>(ObservabilityService);
  });

  it('tracks timing correctly', () => {
    const requestId = 'test-1';
    service.startTimer(requestId);
    const latency = service.finishTimer(requestId);

    expect(latency).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for unknown timer', () => {
    const latency = service.finishTimer('nonexistent');
    expect(latency).toBe(0);
  });

  it('tracks and aggregates requests', () => {
    service.trackRequest({
      requestId: 'req_1',
      timestamp: new Date(),
      latencyMs: 100,
      routing: {
        requestId: 'req_1',
        mode: 'direct',
        providerKey: 'local_medium',
        providerType: 'ollama',
        model: 'gemma4:12b-mlx',
        escalated: false,
      },
      originalTokens: 1000,
      finalTokens: 800,
      dedupRemoved: 0,
      success: true,
    });

    const metrics = service.getMetrics();
    expect(metrics.requests.total).toBe(1);
    expect(metrics.requests.byProvider['local_medium']).toBe(1);
    expect(metrics.tokens.inputTotal).toBe(1000);
    expect(metrics.tokens.savedByContext).toBe(200);
  });

  it('tracks escalations', () => {
    service.trackRequest({
      requestId: 'req_1',
      timestamp: new Date(),
      latencyMs: 500,
      routing: {
        requestId: 'req_1',
        mode: 'classifier',
        classifierMode: 'execution',
        confidence: 0.45,
        providerKey: 'cloud_nvidia',
        providerType: 'cloud',
        model: 'meta/llama-3.3-70b-instruct',
        escalated: true,
      },
      originalTokens: 500,
      finalTokens: 300,
      dedupRemoved: 0,
      success: true,
    });

    const metrics = service.getMetrics();
    expect(metrics.escalations.total).toBe(1);
    expect(metrics.escalations.rate).toBe(1);
  });

  it('tracks errors by provider', () => {
    service.trackRequest({
      requestId: 'req_err',
      timestamp: new Date(),
      latencyMs: 0,
      routing: {
        requestId: 'req_err',
        mode: 'direct',
        providerKey: 'ollama',
        providerType: 'ollama',
        model: 'gemma',
        escalated: false,
      },
      originalTokens: 100,
      finalTokens: 100,
      dedupRemoved: 0,
      success: false,
      errorMessage: 'connection refused',
    });

    const metrics = service.getMetrics();
    expect(metrics.errors.total).toBe(1);
    expect(metrics.errors.byProvider['ollama']).toBe(1);
  });

  it('limits stored requests to maxStored', () => {
    for (let i = 0; i < 1001; i++) {
      service.trackRequest({
        requestId: `req_${i}`,
        timestamp: new Date(),
        latencyMs: 10,
        routing: {
          requestId: `req_${i}`,
          mode: 'direct',
          providerKey: 'local_medium',
          providerType: 'ollama',
          model: 'gemma4',
          escalated: false,
        },
        originalTokens: 10,
        finalTokens: 10,
        dedupRemoved: 0,
        success: true,
      });
    }

    const metrics = service.getMetrics();
    expect(metrics.requests.total).toBe(1000);
  });

  it('returns health response', () => {
    const health = service.getHealth();
    expect(health.status).toBe('ok');
    expect(health.version).toBeDefined();
    expect(health.uptime).toBeGreaterThanOrEqual(0);
  });
});
