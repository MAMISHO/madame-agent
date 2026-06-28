import { Injectable, Logger } from '@nestjs/common';
import { PromptLoadStrategy } from '../prompt-load-strategy.interface';
import { AgentConfigEntity } from '../../core/infra/database/entities/agent-config.entity';
import { FilePromptStrategy } from './file-prompt.strategy';

@Injectable()
export class DatabasePromptStrategy implements PromptLoadStrategy {
  private readonly logger = new Logger(DatabasePromptStrategy.name);

  constructor(private readonly filePromptStrategy: FilePromptStrategy) {}

  async loadPrompt(id: string, variables: Record<string, string> = {}, harnessId?: string): Promise<string> {
    if (!harnessId || harnessId === 'default') {
      return this.filePromptStrategy.loadPrompt(id, variables);
    }

    const metadata = this.filePromptStrategy.getPromptMetadata(id);
    if (!metadata) {
      throw new Error(`Prompt ID "${id}" not found in file catalog.`);
    }

    // Query DB for custom harness prompt override based on agentTarget (agent role)
    const agentConfig = await AgentConfigEntity.findOne({
      where: {
        harnessId,
        role: metadata.agentTarget,
      },
    });

    if (agentConfig && agentConfig.prompt) {
      this.logger.log(`Loaded custom prompt from DB for agent role "${metadata.agentTarget}" in harness "${harnessId}"`);
      let content = agentConfig.prompt;
      for (const [key, value] of Object.entries(variables)) {
        content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
      return content.trim();
    }

    // Fallback to file prompt if no database override exists for this agent
    this.logger.warn(`No DB prompt override found for role "${metadata.agentTarget}" in harness "${harnessId}". Falling back to file.`);
    return this.filePromptStrategy.loadPrompt(id, variables);
  }

  async loadPromptBySourceTarget(
    source: string,
    target: string,
    variables: Record<string, string> = {},
    harnessId?: string
  ): Promise<string> {
    if (!harnessId || harnessId === 'default') {
      return this.filePromptStrategy.loadPromptBySourceTarget(source, target, variables);
    }

    // Query DB for custom harness prompt override based on target (agent role)
    const agentConfig = await AgentConfigEntity.findOne({
      where: {
        harnessId,
        role: target,
      },
    });

    if (agentConfig && agentConfig.prompt) {
      this.logger.log(`Loaded custom prompt from DB for agent target "${target}" in harness "${harnessId}"`);
      let content = agentConfig.prompt;
      for (const [key, value] of Object.entries(variables)) {
        content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
      return content.trim();
    }

    // Fallback to file prompt if no database override exists for this agent
    this.logger.warn(`No DB prompt override found for target "${target}" in harness "${harnessId}". Falling back to file.`);
    return this.filePromptStrategy.loadPromptBySourceTarget(source, target, variables);
  }
}
