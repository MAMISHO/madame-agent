import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
import { ProvidersService } from '../providers/providers.service';
import { ProviderResponse } from '../providers/provider.interface';
import { ClassifierService } from '../classifier/classifier.service';

@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name);

  constructor(
    private configService: ConfigService,
    private providersService: ProvidersService,
    private classifierService: ClassifierService,
  ) {}

  async route(request: ChatCompletionRequest): Promise<ProviderResponse> {
    const providersConfig = this.configService.get('providers') || {};

    // 1. Direct routing: if the client specifies a model that matches a configured provider, use it directly
    if (request.model) {
      const directMatch = this.findProviderByModel(request.model, providersConfig);
      if (directMatch) {
        this.logger.log(`Direct routing for model "${request.model}" → provider "${directMatch.key}" (${directMatch.config.type})`);
        const providerInstance = this.providersService.getProvider(directMatch.config.type);
        return providerInstance.chat(request, directMatch.config);
      }
      this.logger.debug(`Model "${request.model}" not found in providers config, falling back to classifier routing.`);
    }

    // 2. Classifier-based routing (automatic mode)
    const messagesStr = JSON.stringify(request.messages);
    const routingMode = await this.classifierService.classifyTask(messagesStr);
    
    this.logger.debug(`Classifier selected routing mode: ${routingMode}`);

    const routingConfig = this.configService.get('routing') || {};
    const selectedProviderKey = routingConfig[routingMode]?.provider;

    if (!selectedProviderKey) {
      throw new Error(`Routing configuration missing for mode: ${routingMode}`);
    }

    const modelConfig = providersConfig[selectedProviderKey];

    if (!modelConfig) {
      throw new Error(`Provider configuration missing for key: ${selectedProviderKey}`);
    }

    this.logger.log(`Classifier routing to: ${selectedProviderKey} (${modelConfig.type} - ${modelConfig.model})`);

    const providerInstance = this.providersService.getProvider(modelConfig.type);
    return providerInstance.chat(request, modelConfig);
  }

  /**
   * Finds a provider configuration whose 'model' field matches the requested model name.
   */
  private findProviderByModel(modelName: string, providersConfig: Record<string, any>): { key: string; config: any } | null {
    for (const [key, config] of Object.entries(providersConfig)) {
      if ((config as any).model === modelName) {
        return { key, config };
      }
    }
    return null;
  }
}
