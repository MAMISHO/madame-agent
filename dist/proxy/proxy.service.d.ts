import { RouterService } from '../router/router.service';
import { ChatCompletionRequest } from './dto/openai.dto';
import { ProviderResponse } from '../providers/provider.interface';
export declare class ProxyService {
    private readonly routerService;
    constructor(routerService: RouterService);
    handleChatCompletion(request: ChatCompletionRequest): Promise<ProviderResponse>;
}
