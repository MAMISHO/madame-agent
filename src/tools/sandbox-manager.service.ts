import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve, normalize } from 'path';

export class SandboxViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxViolationError';
  }
}

@Injectable()
export class SandboxManagerService {
  private readonly logger = new Logger(SandboxManagerService.name);
  private readonly workspace: string;
  private readonly deniedCommands: string[];
  private readonly maxTimeoutMs: number;
  private readonly allowNetwork: boolean;

  constructor(private configService: ConfigService) {
    const sandboxConfig = this.configService.get('tools.sandbox') || {};
    this.workspace = resolve(sandboxConfig.workspace || process.cwd());
    this.deniedCommands = sandboxConfig.denied_commands || ['rm', 'sudo', 'curl', 'wget'];
    this.maxTimeoutMs = sandboxConfig.max_timeout_ms || 30_000;
    this.allowNetwork = sandboxConfig.allow_network ?? false;
  }

  check(toolName: string, args: any): void {
    this.checkPaths(toolName, args);
    this.checkCommand(toolName, args);
    this.checkTimeout(args);
    this.checkNetwork(toolName, args);
  }

  private checkPaths(toolName: string, args: any): void {
    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== 'string') continue;
      const isPathArg = key.includes('path') || key === 'source' || key === 'dest' || key === 'pattern';
      if (!isPathArg) continue;

      if (key === 'pattern') {
        if ((value as string).includes('..')) {
          throw new SandboxViolationError(
            `Pattern '${value}' contains '..' which is not allowed`,
          );
        }
        continue;
      }

      const resolved = resolve(this.workspace, normalize(value as string));
      if (!resolved.startsWith(this.workspace + '/') && resolved !== this.workspace) {
        throw new SandboxViolationError(
          `Path '${value}' resolves to '${resolved}' which is outside the allowed workspace '${this.workspace}'`,
        );
      }
    }
  }

  private checkCommand(toolName: string, args: any): void {
    if (toolName !== 'execute_command') return;
    const cmd = (args.command as string || '').split(' ')[0];
    if (this.deniedCommands.includes(cmd)) {
      throw new SandboxViolationError(
        `Command '${cmd}' is denied by sandbox policy. Denied commands: ${this.deniedCommands.join(', ')}`,
      );
    }
  }

  private checkTimeout(args: any): void {
    if (args.timeout && args.timeout > this.maxTimeoutMs) {
      throw new SandboxViolationError(
        `Timeout ${args.timeout}ms exceeds maximum ${this.maxTimeoutMs}ms`,
      );
    }
  }

  private checkNetwork(_toolName: string, args: any): void {
    if (this.allowNetwork) return;
    if (args.url || args.host) {
      throw new SandboxViolationError(
        'Network access is not allowed by sandbox policy',
      );
    }
  }

  getWorkspace(): string {
    return this.workspace;
  }
}
