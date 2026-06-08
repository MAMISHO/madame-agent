import { Module } from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { OllamaProvider } from './ollama.provider';
import { CloudProvider } from './cloud.provider';
import { HuggingFaceProvider } from './huggingface.provider';

@Module({
  providers: [ProvidersService, OllamaProvider, CloudProvider, HuggingFaceProvider],
  exports: [ProvidersService],
})
export class ProvidersModule {}

