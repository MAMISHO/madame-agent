import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ClassificationResult {
  mode: 'plan' | 'execution';
  confidence: number;
}

export interface EscalationDecision {
  shouldEscalate: boolean;
  threshold: number;
  confidence: number;
  targetProviderKey: string;
}

@Injectable()
export class ConfidenceEngineService {
  private readonly logger = new Logger(ConfidenceEngineService.name);

  constructor(private configService: ConfigService) {}

  evaluate(result: ClassificationResult): EscalationDecision {
    const confidenceConfig = this.configService.get('confidence') || {};
    const threshold = confidenceConfig.threshold ?? 0.7;
    const routingConfig = this.configService.get('routing') || {};

    const shouldEscalate = result.confidence < threshold;

    this.logger.debug(
      `Confidence=${result.confidence.toFixed(3)}, threshold=${threshold}, ` +
        `mode=${result.mode}, escalate=${shouldEscalate}`,
    );

    return {
      shouldEscalate,
      threshold,
      confidence: result.confidence,
      targetProviderKey: shouldEscalate
        ? (routingConfig.escalation?.provider ?? '')
        : (routingConfig[result.mode]?.provider ?? ''),
    };
  }
}
