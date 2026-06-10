import { Injectable, Logger } from '@nestjs/common';
import { Message } from '../proxy/dto/openai.dto';
import { DeduplicatorService, DedupResult } from './deduplicator.service';
import { CompressorService, CompressOptions, CompressResult } from './compressor.service';

export interface ProcessResult {
  messages: Message[];
  dedup: DedupResult;
  compress: CompressResult;
}

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(
    private readonly deduplicator: DeduplicatorService,
    private readonly compressor: CompressorService,
  ) {}

  process(messages: Message[], options?: CompressOptions): ProcessResult {
    const dedup = this.deduplicator.deduplicate(messages);
    const compress = this.compressor.compress(dedup.messages, options);

    if (dedup.removedCount > 0 || compress.removedTokens > 0) {
      this.logger.debug(
        `Context: dedup=${dedup.removedCount}msgs, ` +
          `compress=${compress.removedTokens}tok ` +
          `(${compress.originalTokens}→${compress.finalTokens}, ` +
          `ratio=${(compress.finalTokens / Math.max(1, compress.originalTokens)).toFixed(3)})`,
      );
    }

    return { messages: compress.messages, dedup, compress };
  }
}
