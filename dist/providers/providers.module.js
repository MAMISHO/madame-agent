"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProvidersModule = void 0;
const common_1 = require("@nestjs/common");
const providers_service_1 = require("./providers.service");
const ollama_provider_1 = require("./ollama.provider");
const cloud_provider_1 = require("./cloud.provider");
const huggingface_provider_1 = require("./huggingface.provider");
let ProvidersModule = class ProvidersModule {
};
exports.ProvidersModule = ProvidersModule;
exports.ProvidersModule = ProvidersModule = __decorate([
    (0, common_1.Module)({
        providers: [providers_service_1.ProvidersService, ollama_provider_1.OllamaProvider, cloud_provider_1.CloudProvider, huggingface_provider_1.HuggingFaceProvider],
        exports: [providers_service_1.ProvidersService],
    })
], ProvidersModule);
//# sourceMappingURL=providers.module.js.map