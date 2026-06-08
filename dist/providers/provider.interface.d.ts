import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
export interface ProviderResponse {
    stream?: AsyncIterable<Uint8Array>;
    data?: any;
}
export interface ModelProvider {
    chat(request: ChatCompletionRequest, modelConfig: any): Promise<ProviderResponse>;
}
