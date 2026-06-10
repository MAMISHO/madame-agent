import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
import { ProvidersService } from '../providers/providers.service';
import { ProviderResponse } from '../providers/provider.interface';
import { ClassifierService } from '../classifier/classifier.service';
import { ConfidenceEngineService } from '../confidence/confidence.service';
import { ContextService } from '../context/context.service';

export interface RouteMetadata {
  mode: 'direct' | 'classifier';
  classifierMode?: 'plan' | 'execution';
  confidence?: number;
  escalated: boolean;
  providerKey: string;
  providerType: string;
  model: string;
  originalTokens: number;
  finalTokens: number;
}

export interface RouteResult {
  response: ProviderResponse;
  metadata: RouteMetadata;
}

@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name);

  constructor(
    private configService: ConfigService,
    private providersService: ProvidersService,
    private classifierService: ClassifierService,
    private confidenceEngine: ConfidenceEngineService,
    private contextService: ContextService,
  ) {}

  async route(request: ChatCompletionRequest): Promise<RouteResult> {
    const providersConfig = this.configService.get('providers') || {};
    const modelPairs = this.configService.get('model_pairs') || [];

    // 1. Composite pair routing: if model matches a named pair, use local + optional escalation
    if (request.model) {
      const pair = this.findModelPair(request.model, modelPairs);
      if (pair) {
        return this.routeThroughPair(request, providersConfig, pair);
      }
    }

    // 2. Direct routing: if the client specifies a model that matches a configured provider, use it directly
    if (request.model) {
      const directMatch = this.findProviderByModel(
        request.model,
        providersConfig,
      );
      if (directMatch) {
        this.logger.log(
          `Direct routing for model "${request.model}" → provider "${directMatch.key}" (${directMatch.config.type})`,
        );
        const providerInstance = this.providersService.getProvider(
          directMatch.config.type,
        );
        const originalTokens = this.estimateTokens(request.messages);
        const processed = this.contextService.process(request.messages, {
          maxTokens: this.resolveContextLimit(directMatch.config),
        });
        request.messages = processed.messages;
        const response = await providerInstance.chat(
          request,
          directMatch.config,
        );
        return {
          response,
          metadata: {
            mode: 'direct',
            escalated: false,
            providerKey: directMatch.key,
            providerType: directMatch.config.type,
            model: directMatch.config.model,
            originalTokens,
            finalTokens: this.estimateTokens(request.messages),
          },
        };
      }
      this.logger.debug(
        `Model "${request.model}" not found in providers config, falling back to classifier routing.`,
      );
    }

    // 3. Classifier-based routing with confidence evaluation
    const messagesStr = JSON.stringify(request.messages);
    const classification =
      await this.classifierService.classifyTask(messagesStr);

    this.logger.debug(
      `Classifier: mode=${classification.mode}, confidence=${classification.confidence.toFixed(3)}`,
    );

    // 4. Confidence Engine: decide if we need to escalate
    const decision = this.confidenceEngine.evaluate(classification);
    const selectedProviderKey = decision.targetProviderKey;

    if (!selectedProviderKey) {
      throw new Error(
        `No provider selected: routing config missing for mode=${classification.mode}, escalation=${decision.shouldEscalate}`,
      );
    }

    const modelConfig = providersConfig[selectedProviderKey];

    if (!modelConfig) {
      throw new Error(
        `Provider configuration missing for key: ${selectedProviderKey}`,
      );
    }

    if (decision.shouldEscalate) {
      this.logger.log(
        `Escalating: confidence ${classification.confidence.toFixed(3)} < threshold ${decision.threshold} → ${selectedProviderKey} (${modelConfig.type} - ${modelConfig.model})`,
      );
    } else {
      this.logger.log(
        `Classifier routing to: ${selectedProviderKey} (${modelConfig.type} - ${modelConfig.model})`,
      );
    }

    const originalTokens = this.estimateTokens(request.messages);
    const processed = this.contextService.process(request.messages, {
      maxTokens: this.resolveContextLimit(modelConfig),
    });
    request.messages = processed.messages;

    const providerInstance = this.providersService.getProvider(
      modelConfig.type,
    );
    const response = await providerInstance.chat(request, modelConfig);
    return {
      response,
      metadata: {
        mode: 'classifier',
        classifierMode: classification.mode,
        confidence: classification.confidence,
        escalated: decision.shouldEscalate,
        providerKey: selectedProviderKey,
        providerType: modelConfig.type,
        model: modelConfig.model,
        originalTokens,
        finalTokens: this.estimateTokens(request.messages),
      },
    };
  }

  private async routeThroughPair(
    request: ChatCompletionRequest,
    providersConfig: Record<string, any>,
    pair: { id: string; name: string; local: string; cloud: string },
  ): Promise<RouteResult> {
    const localConfig = providersConfig[pair.local];
    if (!localConfig) {
      throw new Error(`Local provider "${pair.local}" not found for pair "${pair.name}"`);
    }
    const cloudConfig = providersConfig[pair.cloud];
    if (!cloudConfig) {
      throw new Error(`Cloud provider "${pair.cloud}" not found for pair "${pair.name}"`);
    }

    // Run classifier to determine if we should escalate
    const messagesStr = JSON.stringify(request.messages);
    const classification = await this.classifierService.classifyTask(messagesStr);
    const decision = this.confidenceEngine.evaluate(classification);

    // Escalate if the task requires planning (needs powerful cloud model)
    // OR if confidence is below threshold (unsure about classification)
    const shouldEscalate = classification.mode === 'plan' || decision.shouldEscalate;
    const selectedConfig = shouldEscalate ? cloudConfig : localConfig;
    const providerKey = shouldEscalate ? pair.cloud : pair.local;
    const providerType = selectedConfig.type;

    this.logger.log(
      `Pair "${pair.name}": mode=${classification.mode}, confidence=${classification.confidence.toFixed(3)}` +
        (shouldEscalate
          ? ` → ESCALATING to ${pair.cloud} (${selectedConfig.model})`
          : ` → using local ${pair.local} (${selectedConfig.model})`),
    );

    const originalTokens = this.estimateTokens(request.messages);
    const processed = this.contextService.process(request.messages, {
      maxTokens: this.resolveContextLimit(selectedConfig),
    });
    request.messages = processed.messages;

    const providerInstance = this.providersService.getProvider(providerType);
    const response = await providerInstance.chat(request, selectedConfig);

    return {
      response,
      metadata: {
        mode: 'classifier',
        classifierMode: classification.mode,
        confidence: classification.confidence,
        escalated: shouldEscalate,
        providerKey,
        providerType,
        model: selectedConfig.model,
        originalTokens,
        finalTokens: this.estimateTokens(request.messages),
      },
    };
  }

  private estimateTokens(messages: any[]): number {
    const text = JSON.stringify(messages);
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Finds a provider configuration whose 'model' field matches the requested model name.
   */
  private findProviderByModel(
    modelName: string,
    providersConfig: Record<string, any>,
  ): { key: string; config: any } | null {
    for (const [key, config] of Object.entries(providersConfig)) {
      if (config.model === modelName) {
        return { key, config };
      }
    }
    return null;
  }

  private findModelPair(
    modelName: string,
    modelPairs: any[],
  ): { id: string; name: string; local: string; cloud: string } | null {
    for (const pair of modelPairs) {
      if (pair.name === modelName || pair.id === modelName) {
        return pair;
      }
    }
    return null;
  }

  private resolveContextLimit(modelConfig: any): number | undefined {
    if (modelConfig.context_limit) return modelConfig.context_limit;
    if (modelConfig.type === 'ollama') return 8192;
    if (modelConfig.type === 'cloud') return 32768;
    return undefined;
  }
}
