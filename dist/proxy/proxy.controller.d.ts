import type { Request, Response } from 'express';
import { ProxyService } from './proxy.service';
import { ChatCompletionRequest } from './dto/openai.dto';
import { ConfigService } from '@nestjs/config';
export declare class ProxyController {
    private readonly proxyService;
    private configService;
    constructor(proxyService: ProxyService, configService: ConfigService);
    getModels(): {
        object: string;
        data: {
            id: any;
            object: string;
            created: number;
            owned_by: any;
        }[];
    };
    createChatCompletion(body: ChatCompletionRequest, req: Request, res: Response): Promise<void>;
}
