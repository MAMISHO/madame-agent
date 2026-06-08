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
var CloudProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudProvider = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
let CloudProvider = CloudProvider_1 = class CloudProvider {
    configService;
    logger = new common_1.Logger(CloudProvider_1.name);
    constructor(configService) {
        this.configService = configService;
    }
    async chat(request, modelConfig) {
        this.logger.debug(`Calling Cloud API for provider ${modelConfig.provider} and model ${modelConfig.model}`);
        let baseUrl = modelConfig.base_url;
        if (!baseUrl) {
            if (modelConfig.provider === 'openai') {
                baseUrl = 'https://api.openai.com/v1';
            }
            else if (modelConfig.provider === 'anthropic') {
                baseUrl = 'https://api.anthropic.com/v1';
            }
            else if (modelConfig.provider === 'nvidia') {
                baseUrl = 'https://integrate.api.nvidia.com/v1';
            }
            else {
                throw new Error(`Unsupported cloud provider without base_url: ${modelConfig.provider}`);
            }
        }
        let apiKey = '';
        if (modelConfig.api_key_env) {
            apiKey = process.env[modelConfig.api_key_env] || this.configService.get(modelConfig.api_key_env) || '';
        }
        else {
            if (modelConfig.provider === 'openai') {
                apiKey = this.configService.get('openaiApiKey') || process.env.OPENAI_API_KEY || '';
            }
            else if (modelConfig.provider === 'anthropic') {
                apiKey = this.configService.get('anthropicApiKey') || process.env.ANTHROPIC_API_KEY || '';
            }
            else if (modelConfig.provider === 'nvidia') {
                apiKey = this.configService.get('NVIDIA_API_KEY') || process.env.NVIDIA_API_KEY || '';
            }
        }
        let url = '';
        let headers = {
            'Content-Type': 'application/json',
        };
        let payload = {
            ...request,
            model: modelConfig.model,
        };
        if (modelConfig.provider === 'anthropic') {
            url = `${baseUrl.replace(/\/$/, '')}/messages`;
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
            const systemMsg = payload.messages.find(m => m.role === 'system');
            const otherMsgs = payload.messages.filter(m => m.role !== 'system');
            payload = {
                model: modelConfig.model,
                messages: otherMsgs,
                system: systemMsg ? systemMsg.content : undefined,
                max_tokens: request.max_tokens || 1024,
            };
            if (request.stream)
                payload.stream = true;
            this.logger.warn('Anthropic native streaming mapping is complex. Expecting simple responses or errors.');
        }
        else {
            url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
        }
        if (modelConfig.headers) {
            headers = {
                ...headers,
                ...modelConfig.headers,
            };
        }
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`Cloud API Error from ${url}: ${response.status} ${errorText}`);
            throw new Error(`Cloud API returned ${response.status}: ${errorText}`);
        }
        if (request.stream) {
            if (!response.body) {
                throw new Error('No response body from Cloud provider');
            }
            return { stream: response.body };
        }
        const data = await response.json();
        return { data };
    }
};
exports.CloudProvider = CloudProvider;
exports.CloudProvider = CloudProvider = CloudProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], CloudProvider);
//# sourceMappingURL=cloud.provider.js.map