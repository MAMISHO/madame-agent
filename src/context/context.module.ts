import { Module } from '@nestjs/common';
import { ContextService } from './context.service';
import { DeduplicatorService } from './deduplicator.service';
import { CompressorService } from './compressor.service';

@Module({
  providers: [ContextService, DeduplicatorService, CompressorService],
  exports: [ContextService],
})
export class ContextModule {}
