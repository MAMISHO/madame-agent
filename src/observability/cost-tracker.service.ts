import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface CostEntry {
  timestamp: string;
  requestId: string;
  sessionId?: string;
  mode: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  isLocal: boolean;
  savedCostUsd: number; // If local, how much we saved vs sending to average cloud
}

const RATES_PER_1M = {
  // Input, Output
  'deepseek': { in: 0.14, out: 0.28 },
  'google': { in: 3.50, out: 10.50 },
  'openai': { in: 5.00, out: 15.00 },
  'anthropic': { in: 3.00, out: 15.00 },
  'nvidia': { in: 0.14, out: 0.28 }, // Llama/Deepseek equivalent
  'default_cloud': { in: 1.00, out: 3.00 } // Average baseline for savings calculation
};

@Injectable()
export class CostTrackerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CostTrackerService.name);
  private logFilePath: string;
  private writeStream: fs.WriteStream | null = null;
  private sessionStats = {
    totalCloudUsd: 0,
    totalSavedUsd: 0,
    cloudInputTokens: 0,
    cloudOutputTokens: 0,
    localInputTokens: 0,
    localOutputTokens: 0,
  };
  private sessionStatsMap = new Map<
    string,
    {
      totalCloudUsd: number;
      totalSavedUsd: number;
      cloudInputTokens: number;
      cloudOutputTokens: number;
      localInputTokens: number;
      localOutputTokens: number;
    }
  >();

  onModuleInit() {
    this.logFilePath = path.join(process.cwd(), '.madame-agent-costs.jsonl');
    try {
      this.writeStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
    } catch (e: any) {
      this.logger.error(`Failed to open cost tracker file: ${e.message}`);
    }
  }

  onModuleDestroy() {
    if (this.writeStream) {
      this.writeStream.end();
    }
  }

  private getOrCreateSessionStats(sessionId: string) {
    let stats = this.sessionStatsMap.get(sessionId);
    if (!stats) {
      stats = {
        totalCloudUsd: 0,
        totalSavedUsd: 0,
        cloudInputTokens: 0,
        cloudOutputTokens: 0,
        localInputTokens: 0,
        localOutputTokens: 0,
      };
      this.sessionStatsMap.set(sessionId, stats);
    }
    return stats;
  }

  public trackCost(
    data: Omit<CostEntry, 'timestamp' | 'costUsd' | 'savedCostUsd'>,
  ): CostEntry {
    const isLocal = data.isLocal || data.provider === 'ollama';
    let costUsd = 0;
    let savedCostUsd = 0;

    const rates = RATES_PER_1M[data.provider as keyof typeof RATES_PER_1M];

    if (!isLocal) {
      const rate = rates || RATES_PER_1M['default_cloud'];
      costUsd =
        (data.inputTokens / 1_000_000) * rate.in +
        (data.outputTokens / 1_000_000) * rate.out;
      this.sessionStats.totalCloudUsd += costUsd;
      this.sessionStats.cloudInputTokens += data.inputTokens;
      this.sessionStats.cloudOutputTokens += data.outputTokens;

      if (data.sessionId) {
        const sStats = this.getOrCreateSessionStats(data.sessionId);
        sStats.totalCloudUsd += costUsd;
        sStats.cloudInputTokens += data.inputTokens;
        sStats.cloudOutputTokens += data.outputTokens;
      }
    } else {
      // It's local, calculate savings based on default cloud or parent
      const rate = RATES_PER_1M['default_cloud'];
      savedCostUsd =
        (data.inputTokens / 1_000_000) * rate.in +
        (data.outputTokens / 1_000_000) * rate.out;
      this.sessionStats.totalSavedUsd += savedCostUsd;
      this.sessionStats.localInputTokens += data.inputTokens;
      this.sessionStats.localOutputTokens += data.outputTokens;

      if (data.sessionId) {
        const sStats = this.getOrCreateSessionStats(data.sessionId);
        sStats.totalSavedUsd += savedCostUsd;
        sStats.localInputTokens += data.inputTokens;
        sStats.localOutputTokens += data.outputTokens;
      }
    }

    const entry: CostEntry = {
      ...data,
      timestamp: new Date().toISOString(),
      costUsd,
      savedCostUsd,
    };

    if (this.writeStream) {
      this.writeStream.write(JSON.stringify(entry) + '\n');
    }

    return entry;
  }

  public getSessionStats(sessionId?: string) {
    if (sessionId) {
      return this.getOrCreateSessionStats(sessionId);
    }
    return this.sessionStats;
  }
}
