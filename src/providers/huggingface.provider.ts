import { Injectable, Logger } from '@nestjs/common';
import { ModelProvider, ProviderResponse } from './provider.interface';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
import { ConfigService } from '@nestjs/config';
import { HfInference } from '@huggingface/inference';

@Injectable()
export class HuggingFaceProvider implements ModelProvider {
  private readonly logger = new Logger(HuggingFaceProvider.name);
  private hf: HfInference;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('hfApiKey');
    this.hf = new HfInference(apiKey);
  }

  async chat(
    request: ChatCompletionRequest,
    modelConfig: any,
  ): Promise<ProviderResponse> {
    this.logger.debug(`Calling HuggingFace for model ${modelConfig.model}`);

    if (request.stream) {
      const stream = this.hf.chatCompletionStream({
        model: modelConfig.model,
        messages: request.messages as any,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
      });

      // Wrap the AsyncGenerator from HuggingFace to yield Server-Sent Events strings compatible with OpenAI
      async function* openAiStreamWrapper() {
        for await (const chunk of stream) {
          yield Buffer.from(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        yield Buffer.from('data: [DONE]\n\n');
      }

      return { stream: openAiStreamWrapper() as AsyncIterable<Uint8Array> };
    } else {
      const data = await this.hf.chatCompletion({
        model: modelConfig.model,
        messages: request.messages as any,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
      });

      return { data };
    }
  }
}
