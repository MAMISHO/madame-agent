import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CompressorService } from './compressor.service';
import { Message } from '../proxy/dto/openai.dto';

describe('CompressorService', () => {
  let service: CompressorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompressorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'context') return undefined;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<CompressorService>(CompressorService);
  });

  it('keeps messages intact when under token limit', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello' },
    ];

    const result = service.compress(msgs);

    expect(result.messages).toHaveLength(2);
    expect(result.removedTokens).toBe(0);
    expect(result.originalTokens).toBe(result.finalTokens);
  });

  it('preserves system prompt and recent messages when over limit', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'you are a helpful assistant' },
      { role: 'user', content: 'a'.repeat(5000) },
      { role: 'assistant', content: 'b'.repeat(5000) },
      { role: 'user', content: 'c'.repeat(5000) },
      { role: 'assistant', content: 'd'.repeat(5000) },
      { role: 'user', content: 'final question' },
    ];

    const result = service.compress(msgs, {
      maxTokens: 100,
      keepLast: 2,
      maxMessageChars: 100,
    });

    expect(result.messages[0].role).toBe('system');
    expect(result.messages[result.messages.length - 1].content).toBe(
      'final question',
    );
    expect(result.messages.length).toBeLessThanOrEqual(msgs.length);
    expect(result.finalTokens).toBeLessThan(result.originalTokens);
    expect(result.removedTokens).toBeGreaterThan(0);
  });

  it('truncates long individual messages', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'x'.repeat(5000) },
    ];

    const result = service.compress(msgs, { maxMessageChars: 100 });

    expect(result.messages[0].content).toContain('[context truncated]');
    expect((result.messages[0].content as string).length).toBeLessThan(5000);
  });

  it('uses default options when none provided', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'hello' },
    ];

    const result = service.compress(msgs);

    expect(result.messages).toHaveLength(1);
    expect(result.removedTokens).toBe(0);
  });

  it('handles array content in messages', () => {
    const msgs: Message[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    ];

    const result = service.compress(msgs);

    expect(result.messages).toHaveLength(1);
  });

  it('handles empty messages', () => {
    const result = service.compress([]);

    expect(result.messages).toHaveLength(0);
    expect(result.originalTokens).toBe(0);
  });
});
