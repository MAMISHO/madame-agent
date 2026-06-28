import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PromptLoadStrategy } from '../prompt-load-strategy.interface';

export interface PromptMetadata {
  id: string;
  description: string;
  agentSource: string;
  agentTarget: string;
  file: string;
}

@Injectable()
export class FilePromptStrategy implements PromptLoadStrategy {
  private readonly logger = new Logger(FilePromptStrategy.name);
  private catalog: { prompts: PromptMetadata[] } = { prompts: [] };
  private readonly catalogPath: string;
  private readonly templatesDir: string;

  constructor() {
    this.catalogPath = join(__dirname, '..', 'prompts.json');
    this.templatesDir = join(__dirname, '..', 'templates');
    this.loadCatalog();
  }

  private loadCatalog() {
    try {
      const data = readFileSync(this.catalogPath, 'utf8');
      this.catalog = JSON.parse(data);
      this.logger.log(`Loaded ${this.catalog.prompts.length} prompts from file catalog.`);
    } catch (error: any) {
      this.logger.error(`Failed to load prompts catalog from ${this.catalogPath}: ${error.message}`);
    }
  }

  getPromptMetadata(id: string): PromptMetadata | undefined {
    return this.catalog.prompts.find((p) => p.id === id);
  }

  getPromptMetadataBySourceTarget(source: string, target: string): PromptMetadata | undefined {
    return this.catalog.prompts.find(
      (p) => p.agentSource === source && p.agentTarget === target
    );
  }

  async loadPrompt(id: string, variables: Record<string, string> = {}): Promise<string> {
    const metadata = this.getPromptMetadata(id);
    if (!metadata) {
      throw new Error(`Prompt ID "${id}" not found in file catalog.`);
    }
    return this.loadPromptFile(metadata, variables);
  }

  async loadPromptBySourceTarget(
    source: string,
    target: string,
    variables: Record<string, string> = {}
  ): Promise<string> {
    const metadata = this.getPromptMetadataBySourceTarget(source, target);
    if (!metadata) {
      throw new Error(`No prompt mapping from "${source}" to "${target}" found in file catalog.`);
    }
    return this.loadPromptFile(metadata, variables);
  }

  private loadPromptFile(metadata: PromptMetadata, variables: Record<string, string> = {}): string {
    const filePath = join(this.templatesDir, metadata.file);
    try {
      let content = readFileSync(filePath, 'utf8');
      for (const [key, value] of Object.entries(variables)) {
        content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
      return content.trim();
    } catch (error: any) {
      this.logger.error(`Failed to read prompt file ${filePath}: ${error.message}`);
      throw error;
    }
  }
}
