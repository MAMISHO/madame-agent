import { OnModuleInit } from '@nestjs/common';
export declare class ClassifierService implements OnModuleInit {
    private readonly logger;
    private classifier;
    onModuleInit(): Promise<void>;
    classifyTask(text: string): Promise<'plan' | 'execution'>;
    private heuristicFallback;
}
