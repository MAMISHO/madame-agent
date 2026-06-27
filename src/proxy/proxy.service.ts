import { Injectable } from '@nestjs/common';
import { RouterService, RouteResult } from '../router/router.service';
import { ChatCompletionRequest } from './dto/openai.dto';

@Injectable()
export class ProxyService {
  constructor(private readonly routerService: RouterService) {}

  async handleChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<RouteResult> {
    return this.routerService.route(request);
  }

  async resumeWorkflow(requestId: string, answer: string): Promise<RouteResult> {
    return this.routerService.resume(requestId, answer);
  }
}
