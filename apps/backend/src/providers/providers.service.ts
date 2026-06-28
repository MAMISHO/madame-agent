import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModelProvider } from './provider.interface';
import { OllamaProvider } from './ollama.provider';
import { CloudProvider } from './cloud.provider';
import { HuggingFaceProvider } from './huggingface.provider';

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);
  private providers: Map<string, ModelProvider> = new Map();

  constructor(
    private configService: ConfigService,
    private ollamaProvider: OllamaProvider,
    private cloudProvider: CloudProvider,
    private huggingFaceProvider: HuggingFaceProvider,
  ) {
    this.registerProviders();
  }

  private registerProviders() {
    this.providers.set('ollama', this.ollamaProvider);
    this.providers.set('cloud', this.cloudProvider);
    this.providers.set('huggingface', this.huggingFaceProvider);
    this.logger.log('Providers registered successfully.');
  }

  getProvider(type: string): ModelProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Provider type '${type}' not found.`);
    }
    return provider;
  }
}
