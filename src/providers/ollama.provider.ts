import { Injectable, Logger } from '@nestjs/common';
import { ModelProvider, ProviderResponse } from './provider.interface';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OllamaProvider implements ModelProvider {
  private readonly logger = new Logger(OllamaProvider.name);

  async chat(request: ChatCompletionRequest, modelConfig: any): Promise<ProviderResponse> {
    this.logger.debug(`Calling Ollama API for model ${modelConfig.model}`);
    
    // Convert OpenAI request to Ollama format if needed. 
    // Ollama's /v1/chat/completions is OpenAI compatible!
    const baseUrl = modelConfig.base_url || 'http://localhost:11434';
    const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

    const payload = {
      ...request,
      model: modelConfig.model,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

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
