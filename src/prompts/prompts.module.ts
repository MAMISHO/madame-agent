import { Module, Global } from '@nestjs/common';
import { PromptService } from './prompt.service';

@Global()
@Module({
  providers: [PromptService],
  exports: [PromptService],
})
export class PromptsModule {}
