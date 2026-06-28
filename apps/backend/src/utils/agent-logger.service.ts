import { Injectable, Logger } from '@nestjs/common';

export type AgentRole = 'Planner' | 'Preparer' | 'Orchestrator' | 'Executor' | 'QA' | 'Supervisor' | 'System';

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

  log(role: AgentRole, message: string, contextId?: string) {
    const color = ColorMap[role] || '';
    const suffix = contextId ? ` [${contextId}]` : '';
    this.logger.log(`${color}[${role}]${suffix} ${message}${ColorReset}`);
  }

  warn(role: AgentRole, message: string, contextId?: string) {
    const color = ColorMap[role] || '';
    const suffix = contextId ? ` [${contextId}]` : '';
    this.logger.warn(`${color}[${role}]${suffix} ${message}${ColorReset}`);
  }

  error(role: AgentRole, message: string, stack?: string, contextId?: string) {
    const color = ColorMap[role] || '';
    const suffix = contextId ? ` [${contextId}]` : '';
    this.logger.error(`${color}[${role}]${suffix} ${message}${ColorReset}`, stack);
  }

  debug(role: AgentRole, message: string, contextId?: string) {
    const color = ColorMap[role] || '';
    const suffix = contextId ? ` [${contextId}]` : '';
    this.logger.debug(`${color}[${role}]${suffix} ${message}${ColorReset}`);
  }
}
