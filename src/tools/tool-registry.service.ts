import { Injectable, Logger } from '@nestjs/common';
import { ToolDefinition } from '../proxy/dto/openai.dto';

export interface ToolHandler {
  definition: ToolDefinition;
  execute: (args: any) => Promise<any>;
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
    return this.tools.get(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
