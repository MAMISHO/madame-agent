import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Message } from '../proxy/dto/openai.dto';

export interface CompressOptions {
  maxTokens?: number;
  keepLast?: number;
  maxMessageChars?: number;
}

export interface CompressResult {
  messages: Message[];
  originalTokens: number;
  finalTokens: number;
  removedTokens: number;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3.5));
}

function messageTokens(msg: Message): number {
  let total = 4;
  if (typeof msg.content === 'string') {
    total += estimateTokens(msg.content);
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      total += estimateTokens(JSON.stringify(part));
    }
  }
  if (msg.tool_calls) {
    total += estimateTokens(JSON.stringify(msg.tool_calls));
  }
  if (msg.name) {
    total += estimateTokens(msg.name);
  }
  return total;
}

@Injectable()
export class CompressorService {
  constructor(private configService: ConfigService) {}

  compress(messages: Message[], options?: CompressOptions): CompressResult {
    const contextConfig = (this.configService.get('context') || {}) as any;
    const maxTokens = options?.maxTokens ?? contextConfig.max_tokens ?? 8192;
    const keepLast = options?.keepLast ?? contextConfig.keep_last ?? 10;
    const maxMessageChars = options?.maxMessageChars ?? contextConfig.max_message_chars ?? 4000;

    const originalTokens = messages.reduce((sum, m) => sum + messageTokens(m), 0);

    if (originalTokens <= maxTokens) {
      return {
        messages: this.truncateLongMessages(messages, maxMessageChars),
        originalTokens,
        finalTokens: originalTokens,
        removedTokens: 0,
      };
    }

    const systemMsgs: Message[] = [];
    const middleMsgs: Message[] = [];
    const recentMsgs: Message[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMsgs.push(msg);
      } else {
        middleMsgs.push(msg);
      }
    }

    if (middleMsgs.length <= keepLast) {
      recentMsgs.push(...middleMsgs);
      middleMsgs.length = 0;
    } else {
      const splitAt = middleMsgs.length - keepLast;
      recentMsgs.push(...middleMsgs.slice(splitAt));
      middleMsgs.length = splitAt;
    }

    const truncatedMiddle: Message[] = [];
    for (const msg of middleMsgs) {
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
        if (content.length > maxMessageChars) {
          content = content.slice(0, maxMessageChars) + '\n\n[context truncated]';
        }
      } else if (Array.isArray(msg.content)) {
        content = JSON.stringify(msg.content);
        if (content.length > maxMessageChars) {
          content = '[complex content truncated]';
        }
      }
      truncatedMiddle.push({ ...msg, content });
    }

    const result = [...systemMsgs, ...truncatedMiddle, ...recentMsgs];

    const finalTokens = result.reduce((sum, m) => sum + messageTokens(m), 0);

    return {
      messages: result,
      originalTokens,
      finalTokens,
      removedTokens: originalTokens - finalTokens,
    };
  }

  private truncateLongMessages(messages: Message[], maxChars: number): Message[] {
    return messages.map((msg) => {
      if (typeof msg.content !== 'string' || msg.content.length <= maxChars) return msg;
      return {
        ...msg,
        content: msg.content.slice(0, maxChars) + '\n\n[context truncated]',
      };
    });
  }
}
