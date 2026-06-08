"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouterModule = void 0;
const common_1 = require("@nestjs/common");
const router_service_1 = require("./router.service");
const providers_module_1 = require("../providers/providers.module");
const classifier_module_1 = require("../classifier/classifier.module");
let RouterModule = class RouterModule {
};
exports.RouterModule = RouterModule;
exports.RouterModule = RouterModule = __decorate([
    (0, common_1.Module)({
        imports: [providers_module_1.ProvidersModule, classifier_module_1.ClassifierModule],
        providers: [router_service_1.RouterService],
        exports: [router_service_1.RouterService],
    })
], RouterModule);
//# sourceMappingURL=router.module.js.map