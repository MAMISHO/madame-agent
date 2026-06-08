"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var HuggingFaceProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HuggingFaceProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const inference_1 = require("@huggingface/inference");
let HuggingFaceProvider = HuggingFaceProvider_1 = class HuggingFaceProvider {
    configService;
    logger = new common_1.Logger(HuggingFaceProvider_1.name);
    hf;
    constructor(configService) {
        this.configService = configService;
        const apiKey = this.configService.get('hfApiKey');
        this.hf = new inference_1.HfInference(apiKey);
    }
    async chat(request, modelConfig) {
        this.logger.debug(`Calling HuggingFace for model ${modelConfig.model}`);
        if (request.stream) {
            const stream = this.hf.chatCompletionStream({
                model: modelConfig.model,
                messages: request.messages,
                max_tokens: request.max_tokens,
                temperature: request.temperature,
            });
            async function* openAiStreamWrapper() {
                for await (const chunk of stream) {
                    yield Buffer.from(`data: ${JSON.stringify(chunk)}\n\n`);
                }
                yield Buffer.from('data: [DONE]\n\n');
            }
            return { stream: openAiStreamWrapper() };
        }
        else {
            const data = await this.hf.chatCompletion({
                model: modelConfig.model,
                messages: request.messages,
                max_tokens: request.max_tokens,
                temperature: request.temperature,
            });
            return { data };
        }
    }
};
exports.HuggingFaceProvider = HuggingFaceProvider;
exports.HuggingFaceProvider = HuggingFaceProvider = HuggingFaceProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], HuggingFaceProvider);
//# sourceMappingURL=huggingface.provider.js.map