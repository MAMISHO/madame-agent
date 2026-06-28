import { Module, Global } from '@nestjs/common';
import { PromptService } from './prompt.service';
import { FilePromptStrategy } from './strategies/file-prompt.strategy';
import { DatabasePromptStrategy } from './strategies/database-prompt.strategy';

@Global()
@Module({
  providers: [
    PromptService,
    FilePromptStrategy,
    DatabasePromptStrategy,
  ],
  exports: [PromptService],
})
export class PromptsModule {}
