import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

@Injectable()
export class ClassifierService implements OnModuleInit {
  private readonly logger = new Logger(ClassifierService.name);
  private classifier: any;

  async onModuleInit() {
    this.logger.log('Initializing local AI classifier via transformers.js...');
    try {
      // Dynamic import because it's CommonJS/ESM interop
      const { pipeline, env } = await import('@xenova/transformers');

      // Do not use local cache if not set up, just download to default cache dir
      env.allowLocalModels = false;

      // Load a tiny zero-shot classification model
      this.classifier = await pipeline(
        'zero-shot-classification',
        'Xenova/mobilebert-uncased-mnli',
        {
          quantized: true,
        },
      );
      this.logger.log('Classifier model loaded successfully.');
    } catch (err) {
      this.logger.error('Failed to load local classifier model.', err);
    }
  }

  async classifyTask(
    text: string,
  ): Promise<{ mode: 'plan' | 'execution'; confidence: number }> {
    if (!this.classifier) {
      this.logger.warn('Classifier not ready, falling back to heuristic');
      return this.heuristicFallback(text);
    }

    try {
      const labels = [
        'system planning and architecture',
        'code execution and simple fix',
      ];
      const output = await this.classifier(text, labels);

      this.logger.debug(`Classification results: ${JSON.stringify(output)}`);

      if (output.labels[0] === 'system planning and architecture') {
        return { mode: 'plan', confidence: output.scores[0] };
      }
      return { mode: 'execution', confidence: output.scores[0] };
    } catch (err) {
      this.logger.error('Error during classification, using fallback', err);
      return this.heuristicFallback(text);
    }
  }

  private heuristicFallback(text: string): {
    mode: 'plan' | 'execution';
    confidence: number;
  } {
    const textLower = text.toLowerCase();
    if (
      textLower.includes('plan') ||
      textLower.includes('architect') ||
      textLower.includes('system design')
    ) {
      return { mode: 'plan', confidence: 0.5 };
    }
    return { mode: 'execution', confidence: 0.5 };
  }
}
