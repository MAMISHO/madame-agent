import { Injectable, Logger } from '@nestjs/common';
import { ToolDefinition, ChatCompletionRequest } from '../proxy/dto/openai.dto';

export interface ToolHandler {
  definition: ToolDefinition;
  execute: (args: any, context?: { parentRequestId?: string; parentSignal?: AbortSignal; request?: ChatCompletionRequest; executionOptions?: any }) => Promise<any>;
  timeout?: number;
}

@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private tools = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void {
    const name = handler.definition.function.name;
    this.tools.set(name, handler);
    this.logger.debug(`Tool registered: ${name}`);
  }

  get(name: string): ToolHandler | undefined {
    const normalized = name.toLowerCase();
    for (const [key, value] of this.tools.entries()) {
      if (key.toLowerCase() === normalized) {
        return value;
      }
    }
    return undefined;
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  has(name: string): boolean {
    const normalized = name.toLowerCase();
    for (const key of this.tools.keys()) {
      if (key.toLowerCase() === normalized) {
        return true;
      }
    }
    return false;
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
