"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var OllamaProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaProvider = void 0;
const common_1 = require("@nestjs/common");
let OllamaProvider = OllamaProvider_1 = class OllamaProvider {
    logger = new common_1.Logger(OllamaProvider_1.name);
    async chat(request, modelConfig) {
        this.logger.debug(`Calling Ollama API for model ${modelConfig.model}`);
        const baseUrl = modelConfig.base_url || 'http://localhost:11434';
        const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
        const payload = {
            ...request,
            model: modelConfig.model,
        };
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`Ollama Error: ${response.status} ${errorText}`);
            throw new Error(`Ollama API returned ${response.status}: ${errorText}`);
        }
        if (request.stream) {
            if (!response.body) {
                throw new Error('No response body from Ollama');
            }
            return { stream: response.body };
        }
        const data = await response.json();
        return { data };
    }
};
exports.OllamaProvider = OllamaProvider;
exports.OllamaProvider = OllamaProvider = OllamaProvider_1 = __decorate([
    (0, common_1.Injectable)()
], OllamaProvider);
//# sourceMappingURL=ollama.provider.js.map