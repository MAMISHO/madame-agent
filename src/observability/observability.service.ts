import { Injectable, Logger } from '@nestjs/common';
import { CostTrackerService } from './cost-tracker.service';

export interface RoutingInfo {
  requestId: string;
  mode: 'direct' | 'classifier' | 'orchestrator';
  classifierMode?: 'plan' | 'execution';
  confidence?: number;
  escalated: boolean;
  providerKey: string;
  providerType: string;
  model: string;
  parentRequestId?: string;
}

export interface ActiveSubagentTask {
  requestId: string;
  parentRequestId: string;
  subagentModel: string;
  taskDescription: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  abortController: AbortController;
}

export interface RequestMetrics {
  requestId: string;
  sessionId?: string;
  timestamp: Date;
  latencyMs: number;
  routing: RoutingInfo;
  originalTokens: number;
  finalTokens: number;
  dedupRemoved: number;
  success: boolean;
  errorMessage?: string;
  outputTokens?: number;
}

export interface MetricsSummary {
  uptime: number;
  requests: {
    total: number;
    byProvider: Record<string, number>;
    byMode: Record<string, number>;
  };
  escalations: {
    total: number;
    rate: number;
  };
  tokens: {
    inputTotal: number;
    savedByContext: number;
  };
  latency: {
    avgMs: number;
  };
  errors: {
    total: number;
    byProvider: Record<string, number>;
  };
}

export interface HealthResponse {
  status: string;
  uptime: number;
  version: string;
  providers: Record<string, string>;
  timestamp: string;
}

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);
  private readonly startTime = Date.now();
  private readonly maxStored = 1000;
  private requests: RequestMetrics[] = [];
  private timers = new Map<string, number>();
  private activeSubagents: Map<string, ActiveSubagentTask> = new Map();

  constructor(private costTracker: CostTrackerService) {}

  startTimer(requestId: string): void {
    this.timers.set(requestId, Date.now());
  }

  finishTimer(requestId: string): number {
    const start = this.timers.get(requestId);
    if (!start) return 0;
    this.timers.delete(requestId);
    return Date.now() - start;
  }

  trackRequest(metrics: RequestMetrics): void {
    this.requests.push(metrics);
    if (this.requests.length > this.maxStored) {
      this.requests.shift();
    }

    this.logger.log(
      `Request ${metrics.requestId}: ` +
        `mode=${metrics.routing.mode}, ` +
        `provider=${metrics.routing.providerKey} (${metrics.routing.model}), ` +
        `tokens=${metrics.originalTokens}→${metrics.finalTokens}, ` +
        `latency=${metrics.latencyMs}ms, ` +
        `success=${metrics.success}` +
        (metrics.routing.escalated ? ' [ESCALATED]' : ''),
    );

    // Track costs
    if (metrics.success) {
      const isLocal = metrics.routing.providerType === 'ollama';
      const costEntry = this.costTracker.trackCost({
        requestId: metrics.requestId,
        sessionId: metrics.sessionId,
        mode: metrics.routing.mode,
        provider: isLocal ? 'ollama' : metrics.routing.providerKey,
        model: metrics.routing.model,
        inputTokens: metrics.finalTokens,
        outputTokens: metrics.outputTokens || 0,
        isLocal,
      });

      // Print Summary in terminal
      const stats = this.costTracker.getSessionStats();
      console.log('\n=========================================');
      console.log('💰 MADAME-AGENT COST SUMMARY (SESSION) 💰');
      console.log('=========================================');
      console.log(`☁️  Cloud Tokens Used:  In: ${stats.cloudInputTokens.toLocaleString()}, Out: ${stats.cloudOutputTokens.toLocaleString()}`);
      console.log(`☁️  Cloud Cost:         $${stats.totalCloudUsd.toFixed(4)}`);
      console.log(`🏠 Local Tokens Saved: In: ${stats.localInputTokens.toLocaleString()}, Out: ${stats.localOutputTokens.toLocaleString()}`);
      console.log(`💵 Estimated Savings:  $${stats.totalSavedUsd.toFixed(4)}`);
      console.log('=========================================\n');
    }
  }

  getMetrics(): MetricsSummary {
    const total = this.requests.length;
    const byProvider: Record<string, number> = {};
    const byMode: Record<string, number> = {};
    let escalations = 0;
    let inputTotal = 0;
    let savedByContext = 0;
    let totalLatency = 0;
    const errorsByProvider: Record<string, number> = {};
    let errorTotal = 0;

    for (const r of this.requests) {
      byProvider[r.routing.providerKey] = (byProvider[r.routing.providerKey] || 0) + 1;
      byMode[r.routing.mode] = (byMode[r.routing.mode] || 0) + 1;
      if (r.routing.escalated) escalations++;
      inputTotal += r.originalTokens;
      savedByContext += r.originalTokens - r.finalTokens;
      totalLatency += r.latencyMs;
      if (!r.success) {
        errorTotal++;
        errorsByProvider[r.routing.providerKey] = (errorsByProvider[r.routing.providerKey] || 0) + 1;
      }
    }

    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      requests: {
        total,
        byProvider,
        byMode,
      },
      escalations: {
        total: escalations,
        rate: total > 0 ? escalations / total : 0,
      },
      tokens: {
        inputTotal,
        savedByContext,
      },
      latency: {
        avgMs: total > 0 ? Math.round(totalLatency / total) : 0,
      },
      errors: {
        total: errorTotal,
        byProvider: errorsByProvider,
      },
    };
  }

  getHealth(): HealthResponse {
    const metrics = this.getMetrics();
    const providerStatus: Record<string, string> = {};
    for (const key of Object.keys(metrics.requests.byProvider)) {
      providerStatus[key] = 'active';
    }
    if (Object.keys(providerStatus).length === 0) {
      providerStatus['ollama'] = 'configured';
      providerStatus['cloud'] = 'configured';
    }

    return {
      status: 'ok',
      uptime: metrics.uptime,
      version: '0.0.1',
      providers: providerStatus,
      timestamp: new Date().toISOString(),
    };
  }

  getRecentRequests(limit = 10): RequestMetrics[] {
    return this.requests.slice(-limit);
  }

  registerSubagentTask(task: ActiveSubagentTask): void {
    this.activeSubagents.set(task.requestId, task);
    this.logger.log(`Subagent task registered: ${task.requestId} (parent: ${task.parentRequestId})`);
  }

  updateSubagentTaskStatus(requestId: string, status: 'completed' | 'failed' | 'cancelled'): void {
    const task = this.activeSubagents.get(requestId);
    if (task) {
      task.status = status;
      this.logger.log(`Subagent task ${requestId} status updated to: ${status}`);
    }
  }

  getActiveSubagentTasks(): Omit<ActiveSubagentTask, 'abortController'>[] {
    return Array.from(this.activeSubagents.values())
      .filter((t) => t.status === 'running')
      .map(({ abortController, ...rest }) => rest);
  }

  cancelSubagentsForParent(parentRequestId: string): void {
    let cancelCount = 0;
    for (const task of this.activeSubagents.values()) {
      if (task.parentRequestId === parentRequestId && task.status === 'running') {
        task.abortController.abort();
        task.status = 'cancelled';
        cancelCount++;
      }
    }
    if (cancelCount > 0) {
      this.logger.log(`Cancelled ${cancelCount} active subagent tasks for parent request: ${parentRequestId}`);
    }
  }
}
