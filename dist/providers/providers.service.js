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
var ProvidersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProvidersService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ollama_provider_1 = require("./ollama.provider");
const cloud_provider_1 = require("./cloud.provider");
const huggingface_provider_1 = require("./huggingface.provider");
let ProvidersService = ProvidersService_1 = class ProvidersService {
    configService;
    ollamaProvider;
    cloudProvider;
    huggingFaceProvider;
    logger = new common_1.Logger(ProvidersService_1.name);
    providers = new Map();
    constructor(configService, ollamaProvider, cloudProvider, huggingFaceProvider) {
        this.configService = configService;
        this.ollamaProvider = ollamaProvider;
        this.cloudProvider = cloudProvider;
        this.huggingFaceProvider = huggingFaceProvider;
        this.registerProviders();
    }
    registerProviders() {
        this.providers.set('ollama', this.ollamaProvider);
        this.providers.set('cloud', this.cloudProvider);
        this.providers.set('huggingface', this.huggingFaceProvider);
        this.logger.log('Providers registered successfully.');
    }
    getProvider(type) {
        const provider = this.providers.get(type);
        if (!provider) {
            throw new Error(`Provider type '${type}' not found.`);
        }
        return provider;
    }
};
exports.ProvidersService = ProvidersService;
exports.ProvidersService = ProvidersService = ProvidersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        ollama_provider_1.OllamaProvider,
        cloud_provider_1.CloudProvider,
        huggingface_provider_1.HuggingFaceProvider])
], ProvidersService);
//# sourceMappingURL=providers.service.js.map