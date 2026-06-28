import { Injectable, Logger } from '@nestjs/common';
import { DatabasePromptStrategy } from './strategies/database-prompt.strategy';
import { HarnessEntity } from '../core/infra/database/entities/harness.entity';

@Injectable()
export class PromptService {
  private readonly logger = new Logger(PromptService.name);

  constructor(
    private readonly databasePromptStrategy: DatabasePromptStrategy
  ) {}

  /**
   * Resolves the active harness ID from database
   */
  private async getActiveHarnessId(): Promise<string> {
    try {
      const activeHarness = await HarnessEntity.findOne({ where: { isActive: true } });
      return activeHarness ? activeHarness.id : 'default';
    } catch (error: any) {
      this.logger.warn(`Failed to query active harness from DB: ${error.message}. Falling back to default.`);
      return 'default';
    }
  }

  async loadPrompt(id: string, variables: Record<string, string> = {}): Promise<string> {
    const harnessId = await this.getActiveHarnessId();
    return this.databasePromptStrategy.loadPrompt(id, variables, harnessId);
  }

  async loadPromptBySourceTarget(
    source: string,
    target: string,
    variables: Record<string, string> = {}
  ): Promise<string> {
    const harnessId = await this.getActiveHarnessId();
    return this.databasePromptStrategy.loadPromptBySourceTarget(source, target, variables, harnessId);
  }
}
