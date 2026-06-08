import { Injectable } from '@nestjs/common';
import { RouterService } from '../router/router.service';
import { ChatCompletionRequest } from './dto/openai.dto';
import { ProviderResponse } from '../providers/provider.interface';

@Injectable()
export class ProxyService {
  constructor(private readonly routerService: RouterService) {}

  async handleChatCompletion(request: ChatCompletionRequest): Promise<ProviderResponse> {
    return this.routerService.route(request);
  }
}
