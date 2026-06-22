import { Controller, Post, Get, Body, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProxyService } from './proxy.service';
import { ChatCompletionRequest } from './dto/openai.dto';
import { ConfigService } from '@nestjs/config';
import { ObservabilityService } from '../observability/observability.service';

let requestCounter = 0;

@Controller('v1')
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(
    private readonly proxyService: ProxyService,
    private configService: ConfigService,
    private observability: ObservabilityService,
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

    return {
      object: 'list',
      data: uniqueAllModels,
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

  @Post('chat/completions')
  async createChatCompletion(
    @Body() body: ChatCompletionRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const requestId = `req_${++requestCounter}`;
    body.requestId = requestId;
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
      });

      if (body.stream && response.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        for await (const chunk of response.stream) {
          res.write(chunk);
        }
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
}
