import { Injectable, Logger } from '@nestjs/common';
import { readFile, writeFile, readdir, rename, copyFile, mkdir, unlink } from 'fs/promises';
import { resolve, relative, sep } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolRegistryService, ToolHandler } from './tool-registry.service';

const execAsync = promisify(exec);

@Injectable()
export class BuiltInToolsService {
  private readonly logger = new Logger(BuiltInToolsService.name);

  constructor(private registry: ToolRegistryService) {
    this.registerAll();
  }

  private register(handler: ToolHandler): void {
    this.registry.register(handler);
  }

  private registerAll(): void {
    this.registerReadFile();
    this.registerWriteFile();
    this.registerGlobFiles();
    this.registerListDirectory();
    this.registerMoveFile();
    this.registerCopyFile();
    this.registerExecuteCommand();
    this.registerCreateDirectory();
    this.registerDeleteFile();
    this.logger.log('9 built-in tools registered');
  }

  private registerReadFile(): void {
    this.register({
      definition: {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read the contents of a file from the workspace',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to the file (relative or absolute within workspace)' },
            },
            required: ['path'],
          },
        },
      },
      execute: async (args: { path: string }) => {
        const content = await readFile(args.path, 'utf-8');
        return { path: args.path, size: content.length, content };
      },
      timeout: 10_000,
    });
  }

  private registerWriteFile(): void {
    this.register({
      definition: {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Write or overwrite a file in the workspace. Creates parent directories if needed.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to the file' },
              content: { type: 'string', description: 'Content to write' },
            },
            required: ['path', 'content'],
          },
        },
      },
      execute: async (args: { path: string; content: string }, context?: any) => {
        const dir = resolve(args.path, '..');
        await mkdir(dir, { recursive: true });
        let content = args.content;
        if (content.includes('\\"')) {
          if (/import\s+.*from\s+\\"|const\s+.*=\s+\\"|let\s+.*=\s+\\"|var\s+.*=\s+\\"|function\s+.*\(.*\\"/i.test(content)) {
            content = content.replace(/\\"/g, '"');
          }
        }

        const hasDoubleEscapes = (str: string): boolean => {
          const literalNewlines = (str.match(/\\n/g) || []).length;
          return literalNewlines > 3;
        };

        const healContent = (str: string): string => {
          return str
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"');
        };

        const ext = args.path.includes('.') ? args.path.substring(args.path.lastIndexOf('.')) : '';
        const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.php', '.py', '.java', '.go', '.rs', '.cpp', '.h', '.cs', '.rb'];

        if (codeExtensions.includes(ext) && hasDoubleEscapes(content)) {
          const healed = healContent(content);
          this.logger.log(`Pre-emptively healed formatting anomalies for: ${args.path}`);
          content = healed;
        }

        await writeFile(args.path, content, 'utf-8');

        // Dynamic validator execution based on active validators in context
        const validators = context?.executionOptions?.validators || [];
        const validator = validators.find((v: any) => v.ext === ext);

        if (validator) {
          const cmd = validator.command.replace('{path}', args.path);
          try {
            await execAsync(cmd, { cwd: process.cwd() });
            return { path: args.path, size: content.length, status: 'written', syntax: 'valid' };
          } catch (err: any) {
            const output = err.stdout || err.stderr || err.message;
            return {
              path: args.path,
              size: content.length,
              status: 'written_but_has_syntax_errors',
              error: output,
            };
          }
        }

        return { path: args.path, size: content.length, status: 'written' };
      },
      timeout: 10_000,
    });
  }

  private registerGlobFiles(): void {
    this.register({
      definition: {
        type: 'function',
        function: {
          name: 'glob_files',
          description: 'Search for files matching a glob pattern in the workspace',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.ts", "test/*.py")' },
            },
            required: ['pattern'],
          },
        },
      },
      execute: async (args: { pattern: string }) => {
        if (typeof args.pattern !== 'string' || args.pattern.length === 0) {
          return { error: 'pattern must be a non-empty string', pattern: args.pattern, count: 0, files: [] };
        }
        const { glob } = await import('glob');
        const files = await glob(args.pattern, { nodir: true });
        return { pattern: args.pattern, count: files.length, files };
      },
      timeout: 15_000,
    });
  }

  private registerListDirectory(): void {
    this.register({
      definition: {
        type: 'function',
        function: {
          name: 'list_directory',
          description: 'List the contents of a directory',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to the directory' },
            },
            required: ['path'],
          },
        },
      },
      execute: async (args: { path: string }) => {
        const entries = await readdir(args.path, { withFileTypes: true });
        const contents = entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          size: e.isFile() ? 0 : undefined,
        }));
        return { path: args.path, count: contents.length, contents };
      },
      timeout: 10_000,
    });
  }

  private registerMoveFile(): void {
    this.register({
      definition: {
        type: 'function',
        function: {
          name: 'move_file',
          description: 'Move or rename a file or directory',
          parameters: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Source path' },
              dest: { type: 'string', description: 'Destination path' },
            },
            required: ['source', 'dest'],
          },
        },
      },
      execute: async (args: { source: string; dest: string }) => {
        const dir = resolve(args.dest, '..');
        await mkdir(dir, { recursive: true });
        await rename(args.source, args.dest);
        return { source: args.source, dest: args.dest, status: 'moved' };
      },
      timeout: 10_000,
    });
  }

  private registerCopyFile(): void {
    this.register({
      definition: {
        type: 'function',
        function: {
          name: 'copy_file',
          description: 'Copy a file from source to destination',
          parameters: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Source path' },
              dest: { type: 'string', description: 'Destination path' },
            },
            required: ['source', 'dest'],
          },
        },
      },
      execute: async (args: { source: string; dest: string }) => {
        const dir = resolve(args.dest, '..');
        await mkdir(dir, { recursive: true });
        await copyFile(args.source, args.dest);
        return { source: args.source, dest: args.dest, status: 'copied' };
      },
      timeout: 10_000,
    });
  }

  private truncateOutput(str: string): string {
    const LIMIT = 25000;
    if (!str || str.length <= LIMIT) {
      return str;
    }
    return str.slice(0, LIMIT) + '\n\n...[OUTPUT TRUNCATED DUE TO EXCESSIVE LENGTH: Use filters, glob_files, or pagination]...';
  }

  private registerExecuteCommand(): void {
    this.register({
      definition: {
        type: 'function',
        function: {
          name: 'execute_command',
          description: 'Execute a shell command. Use with caution — commands run in the workspace directory.',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command to execute (e.g. "ls -la", "node --version")' },
              timeout: { type: 'number', description: 'Timeout in milliseconds (max 30000)' },
            },
            required: ['command'],
          },
        },
      },
      execute: async (args: { command: string; timeout?: number }) => {
        const timeout = Math.min(args.timeout ?? 15_000, 30_000);
        let stdout = '';
        let stderr = '';
        let exitCode = 0;
        try {
          const res = await execAsync(args.command, { timeout });
          stdout = res.stdout;
          stderr = res.stderr;
        } catch (error: any) {
          stdout = error.stdout ?? '';
          stderr = error.stderr ?? error.message ?? '';
          exitCode = error.code ?? 1;
        }
        return {
          command: args.command,
          stdout: this.truncateOutput(stdout),
          stderr: this.truncateOutput(stderr),
          exitCode,
        };
      },
      timeout: 30_000,
    });
  }

  private registerCreateDirectory(): void {
    this.register({
      definition: {
        type: 'function',
        function: {
          name: 'create_directory',
          description: 'Create a directory (and parent directories if needed)',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to the directory to create' },
            },
            required: ['path'],
          },
        },
      },
      execute: async (args: { path: string }) => {
        await mkdir(args.path, { recursive: true });
        return { path: args.path, status: 'created' };
      },
      timeout: 10_000,
    });
  }

  private registerDeleteFile(): void {
    this.register({
      definition: {
        type: 'function',
        function: {
          name: 'delete_file',
          description: 'Delete a file or empty directory',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to the file or directory to delete' },
            },
            required: ['path'],
          },
        },
      },
      execute: async (args: { path: string }) => {
        await unlink(args.path);
        return { path: args.path, status: 'deleted' };
      },
      timeout: 10_000,
    });
  }
}
