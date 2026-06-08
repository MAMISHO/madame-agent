import { ModelProvider, ProviderResponse } from './provider.interface';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
import { ConfigService } from '@nestjs/config';
export declare class HuggingFaceProvider implements ModelProvider {
    private configService;
    private readonly logger;
    private hf;
    constructor(configService: ConfigService);
    chat(request: ChatCompletionRequest, modelConfig: any): Promise<ProviderResponse>;
}
