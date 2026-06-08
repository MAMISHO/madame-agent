"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ClassifierService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClassifierService = void 0;
const common_1 = require("@nestjs/common");
let ClassifierService = ClassifierService_1 = class ClassifierService {
    logger = new common_1.Logger(ClassifierService_1.name);
    classifier;
    async onModuleInit() {
        this.logger.log('Initializing local AI classifier via transformers.js...');
        try {
            const { pipeline, env } = await import('@xenova/transformers');
            env.allowLocalModels = false;
            this.classifier = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', {
                quantized: true,
            });
            this.logger.log('Classifier model loaded successfully.');
        }
        catch (err) {
            this.logger.error('Failed to load local classifier model.', err);
        }
    }
    async classifyTask(text) {
        if (!this.classifier) {
            this.logger.warn('Classifier not ready, falling back to heuristic');
            return this.heuristicFallback(text);
        }
        try {
            const labels = ['system planning and architecture', 'code execution and simple fix'];
            const output = await this.classifier(text, labels);
            this.logger.debug(`Classification results: ${JSON.stringify(output)}`);
            if (output.labels[0] === 'system planning and architecture' && output.scores[0] > 0.6) {
                return 'plan';
            }
            return 'execution';
        }
        catch (err) {
            this.logger.error('Error during classification, using fallback', err);
            return this.heuristicFallback(text);
        }
    }
    heuristicFallback(text) {
        const textLower = text.toLowerCase();
        if (textLower.includes('plan') || textLower.includes('architect') || textLower.includes('system design')) {
            return 'plan';
        }
        return 'execution';
    }
};
exports.ClassifierService = ClassifierService;
exports.ClassifierService = ClassifierService = ClassifierService_1 = __decorate([
    (0, common_1.Injectable)()
], ClassifierService);
//# sourceMappingURL=classifier.service.js.map