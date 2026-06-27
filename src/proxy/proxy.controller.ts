import { Controller, Post, Get, Body, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProxyService } from './proxy.service';
import { ChatCompletionRequest } from './dto/openai.dto';
import { ConfigService } from '@nestjs/config';
import { ObservabilityService } from '../observability/observability.service';
import { CostTrackerService } from '../observability/cost-tracker.service';

let requestCounter = 0;

@Controller('v1')
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(
    private readonly proxyService: ProxyService,
    private configService: ConfigService,
    private observability: ObservabilityService,
    private costTracker: CostTrackerService,
  ) {}

  @Get('models')
  getModels() {
    const providersConfig = this.configService.get('providers') || {};
    const modelPairs = this.configService.get('model_pairs') || [];
    const orchestratorPairs = this.configService.get('orchestrator_pairs') || [];

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

    // Orchestrator pairs (exposing both id and name)
    const orchestratorModels = orchestratorPairs.flatMap((pair: any) => [
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

    const orchestratorVirtuals = orchestratorPairs.map((pair: any) => ({
      id: `madame-orchestrator-${pair.id || pair.name}`,
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
  getCosts() {
    return this.costTracker.getSessionStats();
  }

  @Post('chat/completions')
  async createChatCompletion(
    @Body() body: ChatCompletionRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const requestId = `req_${++requestCounter}`;
    body.requestId = requestId;

    // Detect harness client
    const userAgent = req.headers['user-agent'] || '';
    const harness =
      body.metadata?.harness ||
      req.headers['x-harness-client'] ||
      req.headers['x-client-id'] ||
      (userAgent.toLowerCase().includes('opencode') ? 'opencode' : undefined);

    if (harness) {
      body.metadata = {
        ...body.metadata,
        harness: typeof harness === 'string' ? harness : String(harness),
      };
    }

    this.observability.startTimer(requestId);

    const abortHandler = () => {
      this.logger.log(`Client connection closed for ${requestId}. Cancelling active subagents.`);
      this.observability.cancelSubagentsForParent(requestId);
    };
    req.on('close', abortHandler);

    try {
      const { response, metadata } =
        await this.proxyService.handleChatCompletion(body);

      const latencyMs = this.observability.finishTimer(requestId);

      // For orchestrator mode, ToolLoopService already tracks each LLM iteration individually.
      // We skip tracking here to avoid double-counting the final tokens.
      if (metadata.mode !== 'orchestrator') {
        this.observability.trackRequest({
          requestId,
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
          outputTokens: response.data?.usage?.completion_tokens || 0,
        });
      }

      if (body.stream && response.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        for await (const chunk of response.stream) {
          res.write(chunk);
        }
        res.end();
      } else if (body.stream && !response.stream && response.data) {
        // Client requested streaming but the response is non-streamed (e.g., intervention/error).
        // Convert the chat.completion response into SSE format so streaming clients (OpenCode) display it.
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const content = response.data.choices?.[0]?.message?.content || '';
        const streamChunk = {
          id: response.data.id || requestId,
          object: 'chat.completion.chunk',
          created: response.data.created || Math.floor(Date.now() / 1000),
          model: response.data.model || body.model || 'madame-agent',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content },
              finish_reason: null,
            },
          ],
        };
        const stopChunk = {
          id: response.data.id || requestId,
          object: 'chat.completion.chunk',
          created: response.data.created || Math.floor(Date.now() / 1000),
          model: response.data.model || body.model || 'madame-agent',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
        };
        res.write(`data: ${JSON.stringify(streamChunk)}\n\n`);
        res.write(`data: ${JSON.stringify(stopChunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.json(response.data);
      }
    } catch (error: any) {
      this.logger.error(`Request ${requestId} failed: ${error.message}`, error.stack);
      this.logger.error(`Request details: model=${body.model || 'unknown'}, body=${JSON.stringify(body).slice(0, 500)}`);
      this.observability.finishTimer(requestId);

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
