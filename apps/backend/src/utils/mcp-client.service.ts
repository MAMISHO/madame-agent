import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';

@Injectable()
export class McpClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpClientService.name);
  private mcpProcess: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>();
  private stdoutBuffer = '';

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.startProcess();
  }

  onModuleDestroy() {
    this.stopProcess();
  }

  private startProcess() {
    if (this.mcpProcess) return;

    // Use default path or load from opencode/config
    const commandPath = '/Users/mamisho/dev/ia/browserlens/dist/mcpServer.js';
    const env = {
      ...process.env,
      OCR_MODEL: 'deepseek-ocr',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      VISION_MODEL: 'qwen3-vl:8b',
    };

    this.logger.log(`Starting browserlens MCP server at ${commandPath}`);
    this.mcpProcess = spawn('node', [commandPath], { env });

    this.mcpProcess.stdout?.on('data', (chunk) => {
      this.stdoutBuffer += chunk.toString();
      this.processBuffer();
    });

    this.mcpProcess.stderr?.on('data', (data) => {
      // Just log stderr of MCP server in debug
      this.logger.debug(`[browserlens MCP STDERR] ${data.toString().trim()}`);
    });

    this.mcpProcess.on('close', (code) => {
      this.logger.warn(`browserlens MCP server exited with code ${code}`);
      this.mcpProcess = null;
      // Reject any pending requests
      for (const [id, promise] of this.pendingRequests.entries()) {
        promise.reject(new Error(`MCP server process terminated unexpectedly with code ${code}`));
      }
      this.pendingRequests.clear();
    });
  }

  private stopProcess() {
    if (this.mcpProcess) {
      this.logger.log('Stopping browserlens MCP server process');
      this.mcpProcess.kill();
      this.mcpProcess = null;
    }
  }

  private processBuffer() {
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (line) {
        try {
          const response = JSON.parse(line);
          if (response && typeof response.id === 'number') {
            const promise = this.pendingRequests.get(response.id);
            if (promise) {
              this.pendingRequests.delete(response.id);
              if (response.error) {
                promise.reject(new Error(response.error.message || 'MCP Error'));
              } else {
                promise.resolve(response.result);
              }
            }
          }
        } catch (e: any) {
          // If JSON parse fails, it might be due to incomplete lines, but JSON-RPC is line-based
          this.logger.warn(`Failed to parse MCP JSON response line: ${e.message}. Content: ${line}`);
        }
      }
    }
  }

  async callTool(name: string, args: any): Promise<any> {
    this.startProcess(); // Lazy ensure running
    const id = ++this.requestId;
    const request = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
      id,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      const requestStr = JSON.stringify(request) + '\n';
      this.mcpProcess?.stdin?.write(requestStr, (err) => {
        if (err) {
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }
}
