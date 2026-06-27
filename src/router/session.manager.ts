import { Injectable, Logger } from '@nestjs/common';

export interface SessionState {
  id: string;
  state: 'NEW' | 'PREPARED' | 'PLANNED' | 'EXECUTING' | 'COMPLETED';
  originalTask: string;
  preparerReport?: string;
  currentPlan?: string;
  executionSummary?: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SessionManager {
  private readonly logger = new Logger(SessionManager.name);
  private sessions = new Map<string, SessionState>();

  getSession(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  createSession(id: string, originalTask: string): SessionState {
    const session: SessionState = {
      id,
      state: 'NEW',
      originalTask,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(id, session);
    this.logger.log(`Created new session: ${id}`);
    return session;
  }

  updateSession(id: string, updates: Partial<SessionState>): SessionState {
    const session = this.getSession(id);
    if (!session) {
      throw new Error(`Session ${id} not found`);
    }
    const updated = {
      ...session,
      ...updates,
      updatedAt: new Date(),
    };
    this.sessions.set(id, updated);
    this.logger.log(`Updated session ${id} -> state: ${updated.state}`);
    return updated;
  }

  deleteSession(id: string): boolean {
    const deleted = this.sessions.delete(id);
    if (deleted) {
      this.logger.log(`Deleted session: ${id}`);
    }
    return deleted;
  }

  listSessions(): SessionState[] {
    return Array.from(this.sessions.values());
  }
}
