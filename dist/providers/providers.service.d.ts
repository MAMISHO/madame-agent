import { ConfigService } from '@nestjs/config';
import { ModelProvider } from './provider.interface';
import { OllamaProvider } from './ollama.provider';
import { CloudProvider } from './cloud.provider';
import { HuggingFaceProvider } from './huggingface.provider';
export declare class ProvidersService {
    private configService;
    private ollamaProvider;
    private cloudProvider;
    private huggingFaceProvider;
    private readonly logger;
    private providers;
    constructor(configService: ConfigService, ollamaProvider: OllamaProvider, cloudProvider: CloudProvider, huggingFaceProvider: HuggingFaceProvider);
    private registerProviders;
    getProvider(type: string): ModelProvider;
}
