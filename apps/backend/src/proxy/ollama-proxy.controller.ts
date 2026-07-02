import { Controller, Post, Get, Body, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProxyService } from './proxy.service';
import { ChatCompletionRequest } from './dto/openai.dto';
import { ObservabilityService } from '../observability/observability.service';
import { CostTrackerService } from '../observability/cost-tracker.service';
import { HarnessEntity } from '../core/infra/database/entities/harness.entity';
import { ConfigService } from '@nestjs/config';

let requestCounter = 0;

@Controller('api')
export class OllamaProxyController {
  private readonly logger = new Logger(OllamaProxyController.name);

  constructor(
    private readonly proxyService: ProxyService,
    private configService: ConfigService,
    private observability: ObservabilityService,
    private costTracker: CostTrackerService,
  ) {}

  @Get('tags')
  async getTags() {
    const providersConfig = this.configService.get('providers') || {};
    const modelPairs = this.configService.get('model_pairs') || [];
    
    const modelsList = Object.values(providersConfig).map((config: any) => ({
      name: config.model,
      model: config.model,
      details: { format: 'gguf', family: 'llama' }
    }));

    const pairModels = modelPairs.flatMap((pair: any) => [
      { name: pair.id, model: pair.id, details: { format: 'gguf', family: 'hybrid' } },
      { name: pair.name, model: pair.name, details: { format: 'gguf', family: 'hybrid' } }
    ]);

    const activeHarnesses = await HarnessEntity.findAll({ where: { isActive: true } });
    const orchestratorModels = activeHarnesses.flatMap((harness) => [
      { name: harness.code, model: harness.code, details: { format: 'gguf', family: 'orchestrator' } },
      { name: harness.name, model: harness.name, details: { format: 'gguf', family: 'orchestrator' } },
      { name: `madame-orchestrator-${harness.code}`, model: `madame-orchestrator-${harness.code}`, details: { format: 'gguf', family: 'orchestrator' } }
    ]);

    const virtualModels = [
      { name: 'madame-auto', model: 'madame-auto', details: { format: 'gguf', family: 'virtual' } },
      { name: 'madame-local-only', model: 'madame-local-only', details: { format: 'gguf', family: 'virtual' } }
    ];

    const allModels = [...modelsList, ...pairModels, ...orchestratorModels, ...virtualModels];
    const uniqueModels = Array.from(new Map(allModels.map(item => [item.name, item])).values());

    return { models: uniqueModels };
  }

  @Post('chat')
  async createChatCompletion(@Body() body: any, @Req() req: Request, @Res() res: Response) {
    const requestId = `req_${++requestCounter}`;
    
    // Translate Ollama to OpenAI
    const metadata = {
      clientStrategy: 'opencode-ollama',
      sessionId: req.headers['x-session-id'] as string || 'default-session',
      harness: ''
    };

    const openAiBody: ChatCompletionRequest = {
      model: body.model,
      messages: body.messages || [],
      stream: body.stream !== false,
      temperature: body.options?.temperature,
      requestId,
      metadata
    };

    let harness = body.model;
    if (harness.startsWith('madame-orchestrator-')) harness = harness.replace('madame-orchestrator-', '');
    metadata.harness = harness;

    this.observability.startTimer(requestId);
    const mainAbortController = new AbortController();
    this.observability.registerMainRequest(requestId, metadata.sessionId, harness, mainAbortController);

    req.on('close', () => {
      this.observability.cancelSubagentsForParent(requestId);
      this.observability.unregisterMainRequest(requestId);
    });

    const abortPromise = new Promise<never>((_, reject) => {
      mainAbortController.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });

    try {
      const { response, metadata } = await Promise.race([
        this.proxyService.handleChatCompletion(openAiBody),
        abortPromise
      ]) as any;

      this.observability.unregisterMainRequest(requestId);
      const latencyMs = this.observability.finishTimer(requestId);

      if (openAiBody.stream && response.stream) {
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let completionText = '';
        for await (const chunk of response.stream) {
          const str = (chunk as any).toString('utf8');
          const lines = str.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  completionText += content;
                  res.write(JSON.stringify({
                    model: body.model,
                    created_at: new Date().toISOString(),
                    message: { role: 'assistant', content },
                    done: false
                  }) + '\n');
                }
              } catch (e) {}
            }
          }
        }
        res.write(JSON.stringify({
          model: body.model,
          created_at: new Date().toISOString(),
          message: { role: 'assistant', content: '' },
          done: true
        }) + '\n');
        res.end();

        // Stats tracking
        if (metadata.mode !== 'orchestrator') {
          this.observability.trackRequest({
            requestId, sessionId: openAiBody.metadata!.sessionId, timestamp: new Date(), latencyMs,
            routing: { 
              requestId, 
              mode: metadata.mode, 
              model: metadata.model,
              escalated: false,
              providerKey: 'local',
              providerType: 'ollama'
            },
            originalTokens: metadata.originalTokens, finalTokens: metadata.finalTokens,
            dedupRemoved: metadata.originalTokens - metadata.finalTokens,
            success: true, outputTokens: Math.ceil(completionText.length / 4)
          });
        }
      } else {
        const content = response.choices?.[0]?.message?.content || '';
        res.json({
          model: body.model,
          created_at: new Date().toISOString(),
          message: { role: 'assistant', content },
          done: true
        });
      }
    } catch (error: any) {
      this.logger.error(`Error in Ollama chat completion: ${error.message}`);
      this.observability.unregisterMainRequest(requestId);
      if (!res.headersSent) res.status(500).json({ error: error.message });
    }
  }
}
