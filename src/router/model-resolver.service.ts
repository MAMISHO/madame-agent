import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClassifierService } from '../classifier/classifier.service';
import { ConfidenceEngineService } from '../confidence/confidence.service';

export interface ResolvedModel {
  config: any;
  providerKey: string;
  escalated: boolean;
  classification?: {
    mode: string;
    confidence: number;
  };
}

@Injectable()
export class ModelResolverService {
  private readonly logger = new Logger(ModelResolverService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly classifierService: ClassifierService,
    private readonly confidenceEngine: ConfidenceEngineService,
  ) {}

  /**
   * Resolves a potentially composite or virtual model name into a concrete provider configuration.
   */
  async resolveModel(
    modelRaw: string,
    taskOrMessages?: string | any[],
  ): Promise<ResolvedModel> {
    const providersConfig = this.configService.get('providers') || {};
    const modelPairs = this.configService.get('model_pairs') || [];

    // 1. Check if model matches a composite model pair
    const pair = this.getModelPair(modelRaw);
    if (pair) {
      const localConfig = providersConfig[pair.local];
      if (!localConfig) {
        throw new Error(`Local provider "${pair.local}" not found for pair "${pair.name}"`);
      }
      const cloudConfig = providersConfig[pair.cloud];
      if (!cloudConfig) {
        throw new Error(`Cloud provider "${pair.cloud}" not found for pair "${pair.name}"`);
      }

      // Extract details from taskOrMessages
      let userInput = '';
      let systemMode: 'plan' | 'build' | null = null;

      if (Array.isArray(taskOrMessages)) {
        userInput = this.lastUserMessage(taskOrMessages);
        systemMode = this.detectMode(taskOrMessages);
      } else if (typeof taskOrMessages === 'string') {
        userInput = taskOrMessages;
      }

      // Classification & Confidence Evaluation
      const classification = await this.classifierService.classifyTask(userInput);
      const decision = this.confidenceEngine.evaluate(classification);

      // Only "plan" mode forces escalation — OpenCode is planning and needs the smartest model.
      // "Build" mode falls back to the classifier: if it detects a complex task, escalate.
      const shouldEscalate =
        systemMode === 'plan'
          ? true
          : classification.mode === 'plan' || decision.shouldEscalate;

      const selectedConfig = shouldEscalate ? cloudConfig : localConfig;
      const providerKey = shouldEscalate ? pair.cloud : pair.local;

      this.logger.log(
        `Pair "${pair.name}": systemMode=${systemMode}, mode=${classification.mode}, confidence=${classification.confidence.toFixed(3)}` +
          (shouldEscalate
            ? ` → ESCALATING to ${pair.cloud} (${selectedConfig.model})`
            : ` → using local ${pair.local} (${selectedConfig.model})`),
      );

      return {
        config: selectedConfig,
        providerKey,
        escalated: shouldEscalate,
        classification: {
          mode: classification.mode,
          confidence: classification.confidence,
        },
      };
    }

    // 2. Direct model lookup
    const directMatch = this.findProviderByModel(modelRaw, providersConfig);
    if (directMatch) {
      return {
        config: directMatch.config,
        providerKey: directMatch.key,
        escalated: false,
      };
    }

    // 3. Fallback: Classifier-based routing using default configuration
    let userInput = '';
    if (Array.isArray(taskOrMessages)) {
      userInput = this.lastUserMessage(taskOrMessages);
    } else if (typeof taskOrMessages === 'string') {
      userInput = taskOrMessages;
    }

    const classification = await this.classifierService.classifyTask(userInput);
    const decision = this.confidenceEngine.evaluate(classification);
    const selectedProviderKey = decision.targetProviderKey;

    if (!selectedProviderKey) {
      throw new Error(
        `No provider selected: routing config missing for mode=${classification.mode}, escalation=${decision.shouldEscalate}`,
      );
    }

    const modelConfig = providersConfig[selectedProviderKey];
    if (!modelConfig) {
      throw new Error(`Provider configuration missing for key: ${selectedProviderKey}`);
    }

    if (decision.shouldEscalate) {
      this.logger.log(
        `Escalating (default): confidence ${classification.confidence.toFixed(3)} < threshold ${decision.threshold} → ${selectedProviderKey} (${modelConfig.type} - ${modelConfig.model})`,
      );
    } else {
      this.logger.log(
        `Classifier routing (default) to: ${selectedProviderKey} (${modelConfig.type} - ${modelConfig.model})`,
      );
    }

    return {
      config: modelConfig,
      providerKey: selectedProviderKey,
      escalated: decision.shouldEscalate,
      classification: {
        mode: classification.mode,
        confidence: classification.confidence,
      },
    };
  }

  /**
   * Resolves the local provider configuration for a model name (composite or direct).
   */
  getLocalConfig(modelName: string): any {
    const providersConfig = this.configService.get('providers') || {};
    const pair = this.getModelPair(modelName);
    const targetId = pair ? pair.local : modelName;

    const directCfg = providersConfig[targetId];
    if (directCfg) return directCfg;

    const matched = Object.values(providersConfig).find(
      (cfg: any) => cfg.model === targetId
    );
    return matched || null;
  }

  /**
   * Finds an orchestrator pair by name/id.
   */
  getOrchestratorPair(modelName: string): any | null {
    const orchestratorPairs = this.configService.get('orchestrator_pairs') || [];
    for (const pair of orchestratorPairs) {
      if (pair.name === modelName || pair.id === modelName) {
        return pair;
      }
    }
    return null;
  }

  /**
   * Finds a model pair by name/id.
   */
  getModelPair(modelName: string): any | null {
    const modelPairs = this.configService.get('model_pairs') || [];
    for (const pair of modelPairs) {
      if (pair.name === modelName || pair.id === modelName) {
        return pair;
      }
    }
    return null;
  }

  // --- Helpers ---

  private findProviderByModel(
    modelName: string,
    providersConfig: Record<string, any>,
  ): { key: string; config: any } | null {
    if (providersConfig[modelName]) {
      return { key: modelName, config: providersConfig[modelName] };
    }
    for (const [key, config] of Object.entries(providersConfig)) {
      if (config.model === modelName) {
        return { key, config };
      }
    }
    return null;
  }

  private lastUserMessage(messages: any[]): string {
    if (!messages || messages.length === 0) return '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content;
        return typeof content === 'string' ? content : JSON.stringify(content);
      }
    }
    return '';
  }

  private detectMode(messages: any[]): 'plan' | 'build' | null {
    const systemMsg = messages.find((m) => m.role === 'system');
    if (!systemMsg || typeof systemMsg.content !== 'string') return null;

    const content = systemMsg.content.toLowerCase();
    if (
      content.includes('modo de planificación') ||
      content.includes('planning mode') ||
      content.includes('plan mode')
    ) {
      return 'plan';
    }
    if (
      content.includes('modo de desarrollo activo') ||
      content.includes('active development mode') ||
      content.includes('build mode')
    ) {
      return 'build';
    }
    return null;
  }
}
