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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyController = void 0;
const common_1 = require("@nestjs/common");
const proxy_service_1 = require("./proxy.service");
const openai_dto_1 = require("./dto/openai.dto");
const config_1 = require("@nestjs/config");
let ProxyController = class ProxyController {
    proxyService;
    configService;
    constructor(proxyService, configService) {
        this.proxyService = proxyService;
        this.configService = configService;
    }
    getModels() {
        const providersConfig = this.configService.get('providers') || {};
        const modelsList = Object.values(providersConfig).map((config) => ({
            id: config.model,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: config.provider || config.type,
        }));
        const uniqueModels = Array.from(new Map(modelsList.map(item => [item.id, item])).values());
        return {
            object: 'list',
            data: uniqueModels,
        };
    }
    async createChatCompletion(body, req, res) {
        try {
            const result = await this.proxyService.handleChatCompletion(body);
            if (body.stream && result.stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                for await (const chunk of result.stream) {
                    res.write(chunk);
                }
                res.end();
            }
            else {
                res.json(result.data);
            }
        }
        catch (error) {
            res.status(500).json({
                error: {
                    message: error.message || 'Internal Server Error',
                    type: 'proxy_error',
                },
            });
        }
    }
};
exports.ProxyController = ProxyController;
__decorate([
    (0, common_1.Get)('models'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ProxyController.prototype, "getModels", null);
__decorate([
    (0, common_1.Post)('chat/completions'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [openai_dto_1.ChatCompletionRequest, Object, Object]),
    __metadata("design:returntype", Promise)
], ProxyController.prototype, "createChatCompletion", null);
exports.ProxyController = ProxyController = __decorate([
    (0, common_1.Controller)('v1'),
    __metadata("design:paramtypes", [proxy_service_1.ProxyService,
        config_1.ConfigService])
], ProxyController);
//# sourceMappingURL=proxy.controller.js.map