import { Controller, Post, Get, Query, Body, Req, Res, Logger, Sse, MessageEvent } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProxyService } from './proxy.service';
import { ChatCompletionRequest } from './dto/openai.dto';
import { ConfigService } from '@nestjs/config';
import { ObservabilityService } from '../observability/observability.service';
import { CostTrackerService } from '../observability/cost-tracker.service';
import { AgentLoggerService } from '../utils/agent-logger.service';
import { createHash, randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { HarnessEntity } from '../core/infra/database/entities/harness.entity';

let requestCounter = 0;

@Controller('v1')
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(
    private readonly proxyService: ProxyService,
    private configService: ConfigService,
    private observability: ObservabilityService,
    private costTracker: CostTrackerService,
    private agentLogger: AgentLoggerService,
  ) {}

  @Get('models')
  async getModels() {
    const providersConfig = this.configService.get('providers') || {};
    const modelPairs = this.configService.get('model_pairs') || [];

    // Individual models from providers (only local ones + NVIDIA for direct access)
    const modelsList = Object.values(providersConfig).map((config: any) => ({
      id: config.model,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: config.provider || config.type,
    }));

    const uniqueModels = Array.from(
      new Map(modelsList.map((item) => [item.id, item])).values(),
    );

    // Composite model pairs (exposing both id and name for flexibility)
    const pairModels = modelPairs.flatMap((pair: any) => [
      {
        id: pair.id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'madame-agent',
      },
      {
        id: pair.name,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'madame-agent',
      }
    ]);

    // Active Harnesses from DB
    const activeHarnesses = await HarnessEntity.findAll({ where: { isActive: true } });

    const orchestratorModels = activeHarnesses.flatMap((harness) => [
      {
        id: harness.code,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'madame-agent',
      },
      {
        id: harness.name,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'madame-agent',
      }
    ]);

    const allModels = [...pairModels, ...orchestratorModels, ...uniqueModels];
    const uniqueAllModels = Array.from(
      new Map(allModels.map((item) => [item.id, item])).values(),
    );

    // Virtual models for execution modes
    const virtualModels = [
      {
        id: 'madame-auto',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'madame-agent',
      },
      {
        id: 'madame-local-only',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'madame-agent',
      },
    ];

    const orchestratorVirtuals = activeHarnesses.map((harness) => ({
      id: `madame-orchestrator-${harness.code}`,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'madame-agent',
    }));

    return {
      object: 'list',
      data: [...uniqueAllModels, ...virtualModels, ...orchestratorVirtuals],
    };
  }

  @Get('subagents/active')
  getActiveSubagents() {
    return this.observability.getActiveSubagentTasks();
  }

  @Get('health')
  getHealth() {
    return this.observability.getHealth();
  }

  @Get('metrics')
  getMetrics() {
    return this.observability.getMetrics();
  }

  @Get('costs')
  getCosts(@Query('sessionId') sessionId?: string) {
    return this.costTracker.getSessionStats(sessionId);
  }

  @Get('costs/detailed')
  getDetailedCosts() {
    return this.costTracker.getDetailedStats();
  }

  @Sse('events')
  sendEvent(): Observable<MessageEvent> {
    return this.agentLogger.log$.pipe(
      map(data => ({ data } as MessageEvent))
    );
  }

  @Post('chat/completions')
  async createChatCompletion(
    @Body() body: ChatCompletionRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const requestId = `req_${++requestCounter}`;
    body.requestId = requestId;

    // Detect client interface strategy (opencode vs cli)
    const userAgent = req.headers['user-agent'] || '';
    const clientStrategy =
      req.headers['x-harness-client'] ||
      req.headers['x-client-id'] ||
      (userAgent.toLowerCase().includes('opencode') ? 'opencode' : 'cli');

    // Detect harness configuration
    let harness = body.metadata?.harness;
    if (!harness && body.model) {
      let modelClean = body.model;
      if (modelClean.startsWith('madame-orchestrator-')) {
        modelClean = modelClean.replace('madame-orchestrator-', '');
      }
      const dbHarness = await HarnessEntity.findOne({ where: { code: modelClean } }) ||
                         await HarnessEntity.findOne({ where: { name: modelClean } });
      if (dbHarness) {
        harness = dbHarness.code;
      }
    }
    if (!harness) {
      harness = clientStrategy;
    }

    let sessionId = (body.metadata?.sessionId || req.headers['x-session-id']) as string;
    if (!sessionId) {
      const referer = req.headers['referer'] as string;
      if (referer) {
        const match = referer.match(/session\/(ses_[a-zA-Z0-9]+)/);
        if (match) {
          sessionId = match[1];
        }
      }
    }
    if (!sessionId && body.user) {
      sessionId = body.user;
    }
    if (!sessionId && body.messages && body.messages.length > 0) {
      const firstUserMsg = body.messages.find(m => m.role === 'user');
      if (firstUserMsg && typeof firstUserMsg.content === 'string') {
        sessionId = 'hash_' + createHash('md5').update(firstUserMsg.content).digest('hex');
      }
    }
    if (!sessionId) {
      sessionId = 'default-session';
    }

    // Extract agent mode from OpenCode JSON user messages
    let opencodeAgent: string | undefined = undefined;
    if (body.messages && body.messages.length > 0) {
      const lastUserMsg = [...body.messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg && typeof lastUserMsg.content === 'string') {
        try {
          const parsed = JSON.parse(lastUserMsg.content);
          if (parsed && typeof parsed.agent === 'string') {
            opencodeAgent = parsed.agent;
          }
        } catch {
          // Ignore, not a JSON payload or different format
        }
      }
    }

    // Extract agent mode from plugin header (overrides JSON detection)
    const headerAgentMode = req.headers['x-madame-agent-mode'] as string | undefined;
    if (headerAgentMode) {
      opencodeAgent = headerAgentMode;
    }

    body.metadata = {
      ...body.metadata,
      harness: harness ? (typeof harness === 'string' ? harness : String(harness)) : undefined,
      clientStrategy,
      sessionId,
      opencodeAgent,
    };

    this.observability.startTimer(requestId);

    const mainAbortController = new AbortController();
    const harnessStr = harness ? String(harness) : 'default';
    this.observability.registerMainRequest(requestId, sessionId, harnessStr, mainAbortController);

    const abortHandler = () => {
      this.logger.log(`Client connection closed for ${requestId}. Cancelling active subagents.`);
      this.observability.cancelSubagentsForParent(requestId);
      this.observability.unregisterMainRequest(requestId);
    };
    req.on('close', abortHandler);

    const abortPromise = new Promise<never>((_, reject) => {
      mainAbortController.signal.addEventListener('abort', () => {
        if (this.observability.isHarnessModificationAbort(requestId)) {
          reject(new Error('harness_modified'));
        } else {
          reject(new Error('aborted'));
        }
      });
    });

    try {
      const { response, metadata } = await Promise.race([
        this.proxyService.handleChatCompletion(body),
        abortPromise
      ]) as any;

      this.observability.unregisterMainRequest(requestId);
      const latencyMs = this.observability.finishTimer(requestId);

      const trackSuccess = (outTokens: number) => {
        if (metadata.mode !== 'orchestrator') {
          this.observability.trackRequest({
            requestId,
            sessionId,
            timestamp: new Date(),
            latencyMs,
            routing: {
              requestId,
              mode: metadata.mode,
              classifierMode: metadata.classifierMode,
              confidence: metadata.confidence,
              escalated: metadata.escalated,
              providerKey: metadata.providerKey,
              providerType: metadata.providerType,
              model: metadata.model,
            },
            originalTokens: metadata.originalTokens,
            finalTokens: metadata.finalTokens,
            dedupRemoved: metadata.originalTokens - metadata.finalTokens,
            success: true,
            outputTokens: outTokens,
          });
        }
      };

      if (body.stream && response.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let completionText = '';
        for await (const chunk of response.stream) {
          res.write(chunk);
          
          try {
            const str = (chunk as any).toString('utf8');
            const lines = str.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
                const parsed = JSON.parse(trimmed.slice(6));
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  completionText += content;
                }
              }
            }
          } catch {
            // Ignore parse errors for incomplete chunks
          }
        }
        res.end();

        trackSuccess(Math.ceil(completionText.length / 3.5) || 1);
      } else if (body.stream && !response.stream && response.data) {
        // Client requested streaming but the response is non-streamed (e.g., intervention/error).
        // Convert the chat.completion response into SSE format so streaming clients (OpenCode) display it.
        // Follow standard OpenAI streaming pattern exactly:
        //   chunk 1: delta.role only
        //   chunk 2: delta.content only  
        //   chunk 3: empty delta + finish_reason: stop
        //   [DONE]
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const content = response.data.choices?.[0]?.message?.content || '';
        const id = response.data.id || requestId;
        const created = response.data.created || Math.floor(Date.now() / 1000);
        const model = body.model || response.data.model || 'madame-agent';

        const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        // Chunk 1: role announcement
        res.write(`data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created, model,
          choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
        })}\n\n`);
        await sleep(20);

        // Chunk 2: content delivery
        res.write(`data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created, model,
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        })}\n\n`);
        await sleep(20);

        // Chunk 3: stop signal
        res.write(`data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created, model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`);
        await sleep(20);

        res.write('data: [DONE]\n\n');
        res.end();

        trackSuccess(response.data?.usage?.completion_tokens || Math.ceil(content.length / 3.5) || 1);
      } else {
        trackSuccess(response.data?.usage?.completion_tokens || 0);
        res.json(response.data);
      }
    } catch (error: any) {
      this.observability.finishTimer(requestId);
      this.observability.unregisterMainRequest(requestId);

      if (error.message === 'harness_modified') {
        const id = `chatcmpl-${randomUUID().slice(0, 8)}`;
        const created = Math.floor(Date.now() / 1000);
        const model = body.model || 'madame-agent';
        const content = "⚠️ **[CAMBIO DE MODELO]** La configuración del arnés activo ha sido modificada. La ejecución actual ha sido detenida. ¿Deseas retomar la sesión con la nueva configuración?";
        
        const responseData = {
          id,
          object: 'chat.completion',
          created,
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: Math.ceil(content.length / 3.5),
            total_tokens: Math.ceil(content.length / 3.5),
          },
        };

        if (body.stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          // Chunk 1: role
          res.write(`data: ${JSON.stringify({
            id, object: 'chat.completion.chunk', created, model,
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
          })}\n\n`);

          // Chunk 2: content
          res.write(`data: ${JSON.stringify({
            id, object: 'chat.completion.chunk', created, model,
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
          })}\n\n`);

          // Chunk 3: stop
          res.write(`data: ${JSON.stringify({
            id, object: 'chat.completion.chunk', created, model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`);

          res.write('data: [DONE]\n\n');
          res.end();
          return;
        } else {
          return res.json(responseData);
        }
      }

      this.logger.error(`Request ${requestId} failed: ${error.message}`, error.stack);
      this.logger.error(`Request details: model=${body.model || 'unknown'}, body=${JSON.stringify(body).slice(0, 500)}`);

      // Use routing metadata from the router if available (attached by callWithRoutingMetadata)
      const routing = error.routingMetadata || {
        requestId,
        mode: 'direct',
        escalated: false,
        providerKey: 'unknown',
        providerType: 'unknown',
        model: body.model || 'unknown',
      };
      routing.requestId = requestId;

      this.observability.trackRequest({
        requestId,
        sessionId,
        timestamp: new Date(),
        latencyMs: 0,
        routing,
        originalTokens: 0,
        finalTokens: 0,
        dedupRemoved: 0,
        success: false,
        errorMessage: error.message,
      });

      const status =
        error.message?.includes('not found') || error.message?.includes('missing')
          ? 400
          : error.message?.includes('API returned')
            ? 502
            : error.message?.includes('timeout')
              ? 504
              : 500;

      res.status(status).json({
        error: {
          message: error.message || 'Internal Server Error',
          type: status === 502 ? 'upstream_error'
            : status === 504 ? 'timeout'
              : status === 400 ? 'invalid_request'
                : 'proxy_error',
        },
      });
    } finally {
      req.off('close', abortHandler);
    }
  }

  @Post('chat/completions/resume')
  async resumeWorkflow(
    @Body() body: { requestId: string; response: string },
    @Res() res: Response,
  ) {
    try {
      this.logger.log(`Resuming workflow for request ${body.requestId} with response: ${body.response}`);
      const { response } =
        await this.proxyService.resumeWorkflow(body.requestId, body.response);
      res.json(response.data);
    } catch (error: any) {
      this.logger.error(`Resuming request ${body.requestId} failed: ${error.message}`, error.stack);
      res.status(500).json({
        error: {
          message: error.message || 'Internal Server Error',
          type: 'proxy_error',
        },
      });
    }
  }
}
