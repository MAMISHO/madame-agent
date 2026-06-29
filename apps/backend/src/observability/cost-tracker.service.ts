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

  public async getDetailedStats() {
    const file = path.join(process.cwd(), '.madame-agent-costs.jsonl');
    if (!fs.existsSync(file)) {
      return [];
    }

    // 1. Get Session -> Harness mapping from DB
    const sessionHarnessMap = new Map<string, { id: string; name: string }>();
    try {
      const { HarnessEntity } = require('../core/infra/database/entities/harness.entity');
      const { ExecutionLogEntity } = require('../core/infra/database/entities/execution-log.entity');
      
      const logs = await ExecutionLogEntity.findAll({
        attributes: ['sessionId', 'harnessId'],
        group: ['sessionId', 'harnessId'],
        include: [{ model: HarnessEntity, attributes: ['name'] }],
      });

      for (const log of logs) {
        sessionHarnessMap.set(log.sessionId, {
          id: log.harnessId,
          name: log.harness?.name || 'Unknown Harness',
        });
      }
    } catch (e) {
      // ignore db errors
    }

    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const entries: CostEntry[] = lines.map(l => JSON.parse(l));

    // Grouping structure: Session -> Harness -> Agent -> Model
    const sessions = new Map<string, any>();

    for (const entry of entries) {
      const sId = entry.sessionId || 'default-session';
      const harnessInfo = sessionHarnessMap.get(sId) || { id: 'default', name: 'Default Harness' };
      
      if (!sessions.has(sId)) {
        sessions.set(sId, {
          sessionId: sId,
          totalCloudUsd: 0,
          totalSavedUsd: 0,
          harnesses: new Map<string, any>(),
        });
      }

      const sessionObj = sessions.get(sId);
      sessionObj.totalCloudUsd += entry.costUsd;
      sessionObj.totalSavedUsd += entry.savedCostUsd;

      const hName = harnessInfo.name;
      if (!sessionObj.harnesses.has(hName)) {
        sessionObj.harnesses.set(hName, {
          harnessName: hName,
          totalCloudUsd: 0,
          totalSavedUsd: 0,
          agents: new Map<string, any>(),
        });
      }

      const harnessObj = sessionObj.harnesses.get(hName);
      harnessObj.totalCloudUsd += entry.costUsd;
      harnessObj.totalSavedUsd += entry.savedCostUsd;

      const agentRole = entry.mode || 'system';
      if (!harnessObj.agents.has(agentRole)) {
        harnessObj.agents.set(agentRole, {
          role: agentRole,
          totalCloudUsd: 0,
          totalSavedUsd: 0,
          models: new Map<string, any>(),
        });
      }

      const agentObj = harnessObj.agents.get(agentRole);
      agentObj.totalCloudUsd += entry.costUsd;
      agentObj.totalSavedUsd += entry.savedCostUsd;

      const modelName = entry.model || 'unknown';
      if (!agentObj.models.has(modelName)) {
        agentObj.models.set(modelName, {
          model: modelName,
          totalCloudUsd: 0,
          totalSavedUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
        });
      }

      const modelObj = agentObj.models.get(modelName);
      modelObj.totalCloudUsd += entry.costUsd;
      modelObj.totalSavedUsd += entry.savedCostUsd;
      modelObj.inputTokens += entry.inputTokens;
      modelObj.outputTokens += entry.outputTokens;
    }

    // Convert Maps to nested Arrays for JSON transmission
    return Array.from(sessions.values()).map(s => ({
      ...s,
      harnesses: Array.from(s.harnesses.values()).map((h: any) => ({
        ...h,
        agents: Array.from(h.agents.values()).map((a: any) => ({
          ...a,
          models: Array.from(a.models.values()),
        })),
      })),
    }));
  }
}
