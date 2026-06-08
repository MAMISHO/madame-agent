import { ModelProvider, ProviderResponse } from './provider.interface';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
export declare class OllamaProvider implements ModelProvider {
    private readonly logger;
    chat(request: ChatCompletionRequest, modelConfig: any): Promise<ProviderResponse>;
}
