import { Injectable, Logger } from '@nestjs/common';
import { ModelProvider, ProviderResponse } from './provider.interface';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
import { Agent } from 'undici';

@Injectable()
export class OllamaProvider implements ModelProvider {
  private readonly logger = new Logger(OllamaProvider.name);

  // Disable native fetch timeouts (undici) for long local inference prompts
  private readonly dispatcher = new Agent({
    bodyTimeout: 0,
    headersTimeout: 0,
    keepAliveTimeout: 15 * 60 * 1000, // 15 minutes
  });

  async chat(
    request: ChatCompletionRequest,
    modelConfig: any,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    this.logger.debug(`Calling Ollama API for model ${modelConfig.model}`);

    // Convert OpenAI request to Ollama format if needed.
    // Ollama's /v1/chat/completions is OpenAI compatible!
    const baseUrl = modelConfig.base_url || 'http://localhost:11434';
    const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

    const { requestId, parentRequestId, signal: _signal, ...cleanRequest } = request as any;
    const payload = {
      ...cleanRequest,
      model: modelConfig.model,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
      dispatcher: this.dispatcher,
    } as any);

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Ollama Error: ${response.status} ${errorText}`);
      throw new Error(`Ollama API returned ${response.status}: ${errorText}`);
    }

    if (request.stream) {
      if (!response.body) {
        throw new Error('No response body from Ollama');
      }
      return { stream: response.body as unknown as AsyncIterable<Uint8Array> };
    }

    const data = await response.json();
    return { data };
  }
}
