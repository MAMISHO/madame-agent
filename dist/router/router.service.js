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
var RouterService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouterService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const providers_service_1 = require("../providers/providers.service");
const classifier_service_1 = require("../classifier/classifier.service");
let RouterService = RouterService_1 = class RouterService {
    configService;
    providersService;
    classifierService;
    logger = new common_1.Logger(RouterService_1.name);
    constructor(configService, providersService, classifierService) {
        this.configService = configService;
        this.providersService = providersService;
        this.classifierService = classifierService;
    }
    async route(request) {
        const providersConfig = this.configService.get('providers') || {};
        if (request.model) {
            const directMatch = this.findProviderByModel(request.model, providersConfig);
            if (directMatch) {
                this.logger.log(`Direct routing for model "${request.model}" → provider "${directMatch.key}" (${directMatch.config.type})`);
                const providerInstance = this.providersService.getProvider(directMatch.config.type);
                return providerInstance.chat(request, directMatch.config);
            }
            this.logger.debug(`Model "${request.model}" not found in providers config, falling back to classifier routing.`);
        }
        const messagesStr = JSON.stringify(request.messages);
        const routingMode = await this.classifierService.classifyTask(messagesStr);
        this.logger.debug(`Classifier selected routing mode: ${routingMode}`);
        const routingConfig = this.configService.get('routing') || {};
        const selectedProviderKey = routingConfig[routingMode]?.provider;
        if (!selectedProviderKey) {
            throw new Error(`Routing configuration missing for mode: ${routingMode}`);
        }
        const modelConfig = providersConfig[selectedProviderKey];
        if (!modelConfig) {
            throw new Error(`Provider configuration missing for key: ${selectedProviderKey}`);
        }
        this.logger.log(`Classifier routing to: ${selectedProviderKey} (${modelConfig.type} - ${modelConfig.model})`);
        const providerInstance = this.providersService.getProvider(modelConfig.type);
        return providerInstance.chat(request, modelConfig);
    }
    findProviderByModel(modelName, providersConfig) {
        for (const [key, config] of Object.entries(providersConfig)) {
            if (config.model === modelName) {
                return { key, config };
            }
        }
        return null;
    }
};
exports.RouterService = RouterService;
exports.RouterService = RouterService = RouterService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        providers_service_1.ProvidersService,
        classifier_service_1.ClassifierService])
], RouterService);
//# sourceMappingURL=router.service.js.map