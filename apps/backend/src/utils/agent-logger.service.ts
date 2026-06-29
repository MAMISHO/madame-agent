import { Injectable, Logger } from '@nestjs/common';
import { appendFileSync } from 'fs';
import { join } from 'path';
import { Subject } from 'rxjs';
import { ExecutionLogEntity } from '../core/infra/database/entities/execution-log.entity';
import { HarnessEntity } from '../core/infra/database/entities/harness.entity';

export type AgentRole = 'Planner' | 'Preparer' | 'Orchestrator' | 'Executor' | 'QA' | 'Supervisor' | 'System';

export interface AgentLogEvent {
  role: AgentRole;
  message: string;
  contextId?: string;
  timestamp: string;
  type: 'log' | 'warn' | 'error' | 'debug';
  state: 'idle' | 'working' | 'error' | 'completed';
}

const ColorMap: Record<AgentRole, string> = {
  Planner: '\x1b[32m',       // Green
  Preparer: '\x1b[36m',      // Cyan
  Orchestrator: '\x1b[33m',  // Yellow
  Executor: '\x1b[34m',      // Blue
  QA: '\x1b[35m',            // Magenta
  Supervisor: '\x1b[31m',    // Red
  System: '\x1b[37m',        // White/Light Gray
};

const ColorReset = '\x1b[0m';

@Injectable()
export class AgentLoggerService {
  private readonly logger = new Logger('AgentWorkflow');
  
  // Observable stream for real-time SSE logs
  public readonly log$ = new Subject<AgentLogEvent>();

  // Deduce the agent state from the message content
  private deduceState(role: AgentRole, message: string, type: 'log' | 'warn' | 'error' | 'debug'): 'idle' | 'working' | 'error' | 'completed' {
    if (type === 'error') return 'error';
    
    const msg = message.toLowerCase();
    
    // Executor states
    if (role === 'Executor') {
      if (msg.includes('starting') || msg.includes('applying override')) return 'working';
      if (msg.includes('completed') || msg.includes('finished')) return 'completed';
    }

    // QA states
    if (role === 'QA') {
      if (msg.includes('starting') || msg.includes('verifying')) return 'working';
      if (msg.includes('approved')) return 'completed';
      if (msg.includes('rejected') || msg.includes('failed')) return 'error';
    }

    // Planner/Preparer/Supervisor/Orchestrator states
    if (role === 'Preparer' || role === 'Planner' || role === 'Supervisor' || role === 'Orchestrator') {
      if (msg.includes('generating') || msg.includes('verifying') || msg.includes('evaluating') || msg.includes('started')) return 'working';
      if (msg.includes('report:') || msg.includes('updated') || msg.includes('analysis:') || msg.includes('completed')) return 'completed';
    }

    return 'idle';
  }

  private async writeLogEntry(role: AgentRole, message: string, type: 'log' | 'warn' | 'error' | 'debug', contextId?: string) {
    const timestamp = new Date().toISOString();
    const cleanMsg = message.replace(/\x1b\[[0-9;]*m/g, ''); // strip colors
    const state = this.deduceState(role, cleanMsg, type);

    // 1. Emit to active SSE subscribers
    this.log$.next({ role, message: cleanMsg, contextId, timestamp, type, state });

    // 2. Append to physical log files
    try {
      const logsDir = join(process.cwd(), 'logs', 'agents');
      const filepath = join(logsDir, `${role.toLowerCase()}.log`);
      appendFileSync(filepath, `[${timestamp}] [${type.toUpperCase()}]${contextId ? ` [${contextId}]` : ''} ${cleanMsg}\n`, 'utf8');
    } catch (err: any) {
      this.logger.error(`Failed to write log file: ${err.message}`);
    }

    // 3. Persist to SQLite database if associated with a session context
    if (contextId) {
      try {
        const activeHarness = await HarnessEntity.findOne({ where: { isActive: true } });
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0];

        await ExecutionLogEntity.create({
          sessionId: contextId,
          harnessId: activeHarness ? activeHarness.id : 'default',
          modelName: 'gemma4:latest-oc', // default fallback
          executionDate: dateStr,
          executionTime: timeStr,
          log: `[${type.toUpperCase()}] ${cleanMsg}`,
        });
      } catch (err: any) {
        // Silent catch to prevent workflow failure on log save error
      }
    }
  }

  log(role: AgentRole, message: string, contextId?: string) {
    const color = ColorMap[role] || '';
    const suffix = contextId ? ` [${contextId}]` : '';
    this.logger.log(`${color}[${role}]${suffix} ${message}${ColorReset}`);
    this.writeLogEntry(role, message, 'log', contextId);
  }

  warn(role: AgentRole, message: string, contextId?: string) {
    const color = ColorMap[role] || '';
    const suffix = contextId ? ` [${contextId}]` : '';
    this.logger.warn(`${color}[${role}]${suffix} ${message}${ColorReset}`);
    this.writeLogEntry(role, message, 'warn', contextId);
  }

  error(role: AgentRole, message: string, stack?: string, contextId?: string) {
    const color = ColorMap[role] || '';
    const suffix = contextId ? ` [${contextId}]` : '';
    this.logger.error(`${color}[${role}]${suffix} ${message}${ColorReset}`, stack);
    this.writeLogEntry(role, message + (stack ? `\nStack: ${stack}` : ''), 'error', contextId);
  }

  debug(role: AgentRole, message: string, contextId?: string) {
    const color = ColorMap[role] || '';
    const suffix = contextId ? ` [${contextId}]` : '';
    this.logger.debug(`${color}[${role}]${suffix} ${message}${ColorReset}`);
    this.writeLogEntry(role, message, 'debug', contextId);
  }
}
