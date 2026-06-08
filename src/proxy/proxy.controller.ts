import { Controller, Post, Get, Body, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProxyService } from './proxy.service';
import { ChatCompletionRequest } from './dto/openai.dto';
import { ConfigService } from '@nestjs/config';

@Controller('v1')
export class ProxyController {
  constructor(
    private readonly proxyService: ProxyService,
    private configService: ConfigService,
  ) {}

  @Get('models')
  getModels() {
    const providersConfig = this.configService.get('providers') || {};
    const modelsList = Object.values(providersConfig).map((config: any) => ({
      id: config.model,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: config.provider || config.type,
    }));
    
    // Deduplicate models
    const uniqueModels = Array.from(new Map(modelsList.map(item => [item.id, item])).values());

    return {
      object: 'list',
      data: uniqueModels,
    };
  }

  @Post('chat/completions')
  async createChatCompletion(
    @Body() body: ChatCompletionRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const result = await this.proxyService.handleChatCompletion(body);

      if (body.stream && result.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        for await (const chunk of result.stream) {
          res.write(chunk);
        }
        res.end();
      } else {
        res.json(result.data);
      }
    } catch (error: any) {
      res.status(500).json({
        error: {
          message: error.message || 'Internal Server Error',
          type: 'proxy_error',
        },
      });
    }
  }
}
