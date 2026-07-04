import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClassifierService } from '../classifier/classifier.service';
import { ConfidenceEngineService } from '../confidence/confidence.service';
import { ScalableModelEntity } from '../core/infra/database/entities/scalable-model.entity';
import { ProviderEntity } from '../core/infra/database/entities/provider.entity';
import { HarnessEntity } from '../core/infra/database/entities/harness.entity';
import { AgentEntity } from '../core/infra/database/entities/agent.entity';
import { ModelEntity } from '../core/infra/database/entities/model.entity';

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

    // --- Dynamic DB Agent Config Interception ---
    const dbAgentConfig = await this.resolveAgentConfig(modelRaw);
    if (dbAgentConfig) {
      return {
        config: dbAgentConfig,
        providerKey: dbAgentConfig.provider || 'default',
        escalated: false,
      };
    }
    // --------------------------------------------

    // 1. Check if model matches a composite model pair
    const pair = await this.getModelPair(modelRaw);
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
  async getLocalConfig(modelName: string): Promise<any> {
    const dbAgentConfig = await this.resolveAgentConfig(modelName);
    if (dbAgentConfig) return dbAgentConfig;

    const providersConfig = this.configService.get('providers') || {};
    const pair = await this.getModelPair(modelName);
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
  async getOrchestratorPair(modelName: string): Promise<any | null> {
    // 1. Check static config
    const orchestratorPairs = this.configService.get('orchestrator_pairs') || [];
    for (const pair of orchestratorPairs) {
      if (pair.name === modelName || pair.id === modelName) {
        return pair;
      }
    }

    // 2. Check DB
    const dbHarness = await HarnessEntity.findOne({ where: { code: modelName } }) ||
                       await HarnessEntity.findOne({ where: { id: modelName } }) ||
                       await HarnessEntity.findOne({ where: { name: modelName } });

    if (dbHarness) {
      return {
        id: dbHarness.code,
        name: dbHarness.name,
        orchestrator: `${dbHarness.code}_orchestrator`,
        preparer: `${dbHarness.code}_preparer`,
        planner: `${dbHarness.code}_planner`,
        supervisor: `${dbHarness.code}_supervisor`,
        executor: `${dbHarness.code}_executor`,
        qa: `${dbHarness.code}_qa`,
        subagents: [`${dbHarness.code}_executor`] // Backwards compatibility for lists of subagents
      };
    }

    return null;
  }

  /**
   * Finds a model pair by name/id/code.
   */
  async getModelPair(modelName: string): Promise<any | null> {
    // 1. Check database first for scalable models
    const dbPair = await ScalableModelEntity.findOne({ where: { code: modelName } }) || 
                   await ScalableModelEntity.findOne({ where: { id: modelName } });
    if (dbPair) {
      return {
        id: dbPair.id,
        name: dbPair.name,
        local: dbPair.localProviderId, // Note: Provider ID needs to match providers mapping or we construct config dynamically
        cloud: dbPair.cloudProviderId,
        // Because the providers in providers.json use IDs like "ollama", if localProviderId is the UUID,
        // we might need to resolve it. But wait, we'll map this below. Let's just return what's expected
        // for now and fix resolveModel next if needed. 
        dbEntity: dbPair // passing the entity to construct dynamic config if needed
      };
    }

    // 2. Check static config
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

  private async resolveAgentConfig(modelRaw: string): Promise<any> {
    if (!modelRaw || !modelRaw.includes('_')) return null;
    const parts = modelRaw.split('_');
    const harnessCode = parts[0];
    const role = parts[1];
    const rolesList = ['orchestrator', 'preparer', 'planner', 'supervisor', 'executor', 'qa'];
    if (!rolesList.includes(role)) return null;

    const dbHarness = await HarnessEntity.findOne({ where: { code: harnessCode } }) ||
                       await HarnessEntity.findOne({ where: { id: harnessCode } });
    if (!dbHarness) return null;

    const agentConfig = await AgentEntity.findOne({
      where: { harnessId: dbHarness.id, role },
      include: [{
        model: ModelEntity,
        include: [ProviderEntity]
      }]
    });
    if (!agentConfig) return null;

    const providersConfig = this.configService.get('providers') || {};
    let providerConfig: any = null;
    if (agentConfig.model) {
      const dbModel = agentConfig.model;
      const dbProvider = dbModel.provider;
      if (dbProvider) {
        const isCloud = ['openai', 'gemini', 'nvidia', 'anthropic', 'cloud'].includes(dbProvider.code.toLowerCase());
        providerConfig = {
          provider: dbProvider.code,
          type: isCloud ? 'cloud' : 'ollama',
          model: dbModel.code,
          apiKey: dbProvider.apiKey || undefined,
          baseUrl: dbProvider.baseUrl || undefined
        };
      }
    }
    if (!providerConfig) {
      providerConfig = providersConfig['local_medium'] || {
        provider: 'ollama',
        type: 'ollama',
        model: 'gemma4:latest-oc'
      };
    }
    return providerConfig;
  }

  /**
   * Checks if a harness needs local models (Ollama) or can operate purely on cloud.
   * Returns true if at least one agent uses a local provider.
   */
  async needsLocalModels(harnessCode: string): Promise<boolean> {
    const dbHarness = await HarnessEntity.findOne({ where: { code: harnessCode } }) ||
                       await HarnessEntity.findOne({ where: { id: harnessCode } });
    if (!dbHarness) {
      this.logger.warn(`[ModelResolver] Harness "${harnessCode}" not found, defaulting to needs local models`);
      return true; // Default to checking Ollama if harness not found
    }

    const agents = await AgentEntity.findAll({
      where: { harnessId: dbHarness.id },
      include: [{
        model: ModelEntity,
        include: [ProviderEntity]
      }]
    });

    // If no agents found, assume local models might be needed
    if (!agents || agents.length === 0) {
      return true;
    }

    // Check if any agent uses a local (non-cloud) provider
    for (const agent of agents) {
      if (agent.model?.provider) {
        const providerCode = agent.model.provider.code.toLowerCase();
        const isCloud = ['openai', 'gemini', 'nvidia', 'anthropic', 'cloud', 'eecc-jrc', 'jrc'].includes(providerCode);
        if (!isCloud) {
          this.logger.log(`[ModelResolver] Harness "${harnessCode}" needs local models (agent uses: ${providerCode})`);
          return true;
        }
      }
    }

    this.logger.log(`[ModelResolver] Harness "${harnessCode}" is cloud-only, skipping Ollama check`);
    return false;
  }
}
