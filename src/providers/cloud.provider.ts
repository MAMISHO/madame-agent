import { Injectable, Logger } from '@nestjs/common';
import { ModelProvider, ProviderResponse } from './provider.interface';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CloudProvider implements ModelProvider {
  private readonly logger = new Logger(CloudProvider.name);

  constructor(private configService: ConfigService) {}

  async chat(
    request: ChatCompletionRequest,
    modelConfig: any,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    this.logger.debug(
      `Calling Cloud API for provider ${modelConfig.provider} and model ${modelConfig.model}`,
    );

    // Resolve base URL: custom base_url config -> provider defaults -> throw
    let baseUrl = modelConfig.base_url;
    if (!baseUrl) {
      if (modelConfig.provider === 'openai') {
        baseUrl = 'https://api.openai.com/v1';
      } else if (modelConfig.provider === 'anthropic') {
        baseUrl = 'https://api.anthropic.com/v1';
      } else if (modelConfig.provider === 'nvidia') {
        baseUrl = 'https://integrate.api.nvidia.com/v1';
      } else if (modelConfig.provider === 'google') {
        baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
      } else {
        throw new Error(
          `Unsupported cloud provider without base_url: ${modelConfig.provider}`,
        );
      }
    }

    // Resolve API key
    let apiKey = '';
    if (modelConfig.api_key_env) {
      apiKey =
        process.env[modelConfig.api_key_env] ||
        this.configService.get<string>(modelConfig.api_key_env) ||
        '';
    } else {
      if (modelConfig.provider === 'openai') {
        apiKey =
          this.configService.get<string>('openaiApiKey') ||
          process.env.OPENAI_API_KEY ||
          '';
      } else if (modelConfig.provider === 'anthropic') {
        apiKey =
          this.configService.get<string>('anthropicApiKey') ||
          process.env.ANTHROPIC_API_KEY ||
          '';
      } else if (modelConfig.provider === 'nvidia') {
        apiKey =
          this.configService.get<string>('NVIDIA_API_KEY') ||
          process.env.NVIDIA_API_KEY ||
          '';
      } else if (modelConfig.provider === 'google') {
        apiKey =
          this.configService.get<string>('GOOGLE_GENERATIVE_AI_API_KEY') ||
          process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
          '';
      }
    }

    let url = '';
    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    let payload = {
      ...request,
      model: modelConfig.model,
    };

    if (modelConfig.provider === 'anthropic') {
      url = `${baseUrl.replace(/\/$/, '')}/messages`;
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';

      // Simple transform for MVP
      const systemMsg = payload.messages.find((m) => m.role === 'system');
      const otherMsgs = payload.messages.filter((m) => m.role !== 'system');
      payload = {
        model: modelConfig.model,
        messages: otherMsgs,
        system: systemMsg ? (systemMsg.content as string) : undefined,
        max_tokens: request.max_tokens || 1024,
      } as any;
      if (request.stream) (payload as any).stream = true;
      this.logger.warn(
        'Anthropic native streaming mapping is complex. Expecting simple responses or errors.',
      );
    } else {
      // Default to OpenAI-compatible structure
      url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
    }

    // Merge custom headers if defined in configuration
    if (modelConfig.headers) {
      headers = {
        ...headers,
        ...modelConfig.headers,
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `Cloud API Error from ${url}: ${response.status} ${errorText}`,
      );
      throw new Error(`Cloud API returned ${response.status}: ${errorText}`);
    }

    if (request.stream) {
      if (!response.body) {
        throw new Error('No response body from Cloud provider');
      }
      return { stream: response.body as unknown as AsyncIterable<Uint8Array> };
    }

    const data = await response.json();
    return { data };
  }
}
