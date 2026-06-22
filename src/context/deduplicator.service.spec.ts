import { Test, TestingModule } from '@nestjs/testing';
import { DeduplicatorService } from './deduplicator.service';
import { Message } from '../proxy/dto/openai.dto';

describe('DeduplicatorService', () => {
  let service: DeduplicatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeduplicatorService],
    }).compile();

    service = module.get<DeduplicatorService>(DeduplicatorService);
  });

  it('removes consecutive duplicate messages', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'assistant', content: 'hi' },
    ];

    const result = service.deduplicate(msgs);

    expect(result.messages).toHaveLength(2);
    expect(result.removedCount).toBe(2);
  });

  it('keeps non-consecutive duplicates for user messages (keep first)', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'hello' },
    ];

    const result = service.deduplicate(msgs);

    expect(result.messages).toHaveLength(2);
    expect(result.removedCount).toBe(1);
    expect(result.messages[1].role).toBe('assistant');
  });

  it('keeps last occurrence for assistant duplicates', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'response' },
      { role: 'user', content: 'b' },
      { role: 'assistant', content: 'response' },
    ];

    const result = service.deduplicate(msgs);

    expect(result.messages).toHaveLength(3);
    expect(result.removedCount).toBe(1);
    expect(result.messages[2].role).toBe('assistant');
  });

  it('handles empty messages', () => {
    const result = service.deduplicate([]);

    expect(result.messages).toHaveLength(0);
    expect(result.removedCount).toBe(0);
  });

  it('deduplicates system messages', () => {
    const msgs: Message[] = [
      { role: 'system', content: 'you are a bot' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'you are a bot' },
    ];

    const result = service.deduplicate(msgs);

    expect(result.messages).toHaveLength(2);
    expect(result.removedCount).toBe(1);
  });

  it('preserves messages with different content', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'world' },
      { role: 'assistant', content: 'ok' },
    ];

    const result = service.deduplicate(msgs);

    expect(result.messages).toHaveLength(3);
    expect(result.removedCount).toBe(0);
  });

  it('handles array content for hashing', () => {
    const msgs: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ];

    const result = service.deduplicate(msgs);

    expect(result.messages).toHaveLength(1);
    expect(result.removedCount).toBe(1);
  });

  it('treats assistant messages with different tool_calls as different', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'do something' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call1', type: 'function', function: { name: 'test', arguments: '{}' } }] },
      { role: 'user', content: 'continue' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call2', type: 'function', function: { name: 'test', arguments: '{}' } }] },
    ];

    const result = service.deduplicate(msgs);

    expect(result.messages).toHaveLength(4);
    expect(result.removedCount).toBe(0);
  });
});
