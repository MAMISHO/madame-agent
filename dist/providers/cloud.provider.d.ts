import { ModelProvider, ProviderResponse } from './provider.interface';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
import { ConfigService } from '@nestjs/config';
export declare class CloudProvider implements ModelProvider {
    private configService;
    private readonly logger;
    constructor(configService: ConfigService);
    chat(request: ChatCompletionRequest, modelConfig: any): Promise<ProviderResponse>;
}
