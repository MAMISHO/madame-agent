import { ConfigService } from '@nestjs/config';
import { ChatCompletionRequest } from '../proxy/dto/openai.dto';
import { ProvidersService } from '../providers/providers.service';
import { ProviderResponse } from '../providers/provider.interface';
import { ClassifierService } from '../classifier/classifier.service';
export declare class RouterService {
    private configService;
    private providersService;
    private classifierService;
    private readonly logger;
    constructor(configService: ConfigService, providersService: ProvidersService, classifierService: ClassifierService);
    route(request: ChatCompletionRequest): Promise<ProviderResponse>;
    private findProviderByModel;
}
