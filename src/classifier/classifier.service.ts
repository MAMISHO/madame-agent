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
      this.classifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', {
        quantized: true,
      });
      this.logger.log('Classifier model loaded successfully.');
    } catch (err) {
      this.logger.error('Failed to load local classifier model.', err);
    }
  }

  async classifyTask(text: string): Promise<'plan' | 'execution'> {
    if (!this.classifier) {
      this.logger.warn('Classifier not ready, falling back to heuristic');
      return this.heuristicFallback(text);
    }

    try {
      const labels = ['system planning and architecture', 'code execution and simple fix'];
      const output = await this.classifier(text, labels);
      
      this.logger.debug(`Classification results: ${JSON.stringify(output)}`);
      
      // If the first label is planning and its score is high enough
      if (output.labels[0] === 'system planning and architecture' && output.scores[0] > 0.6) {
        return 'plan';
      }
      return 'execution';
    } catch (err) {
      this.logger.error('Error during classification, using fallback', err);
      return this.heuristicFallback(text);
    }
  }

  private heuristicFallback(text: string): 'plan' | 'execution' {
    const textLower = text.toLowerCase();
    if (textLower.includes('plan') || textLower.includes('architect') || textLower.includes('system design')) {
      return 'plan';
    }
    return 'execution';
  }
}
