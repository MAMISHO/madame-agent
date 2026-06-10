import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ContextService } from './context.service';
import { DeduplicatorService } from './deduplicator.service';
import { CompressorService } from './compressor.service';
import { Message } from '../proxy/dto/openai.dto';

describe('ContextService', () => {
  let service: ContextService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextService,
        DeduplicatorService,
        CompressorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(() => undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ContextService>(ContextService);
  });

  it('runs dedup then compress on messages', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'hello' },
    ];

    const result = service.process(msgs);

    expect(result.messages).toHaveLength(2);
    expect(result.dedup.removedCount).toBe(1);
    expect(result.compress.finalTokens).toBeGreaterThan(0);
  });

  it('returns compression ratio info', () => {
    const msgs: Message[] = Array.from({ length: 20 }, (_, i) => ({
      role: ('user' as const),
      content: `message ${i} with some padding content `.repeat(20),
    }));

    const result = service.process(msgs, { maxTokens: 50, keepLast: 3 });

    expect(result.compress.originalTokens).toBeGreaterThan(0);
    expect(result.compress.finalTokens).toBeGreaterThan(0);
    expect(typeof result.compress.removedTokens).toBe('number');
  });

  it('handles empty messages', () => {
    const result = service.process([]);

    expect(result.messages).toHaveLength(0);
  });

  it('does not modify messages under limit', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'hi' },
    ];

    const result = service.process(msgs);

    expect(result.messages).toHaveLength(1);
    expect(result.dedup.removedCount).toBe(0);
    expect(result.compress.removedTokens).toBe(0);
  });
});
