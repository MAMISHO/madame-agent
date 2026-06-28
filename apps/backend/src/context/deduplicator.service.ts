import { Injectable } from '@nestjs/common';
import { Message } from '../proxy/dto/openai.dto';

export interface DedupResult {
  messages: Message[];
  removedCount: number;
}

function contentHash(msg: Message): string {
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  const toolCalls = msg.tool_calls ? JSON.stringify(msg.tool_calls) : '';
  let hash = 0;
  const str = `${msg.role}|${content}|${toolCalls}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}

@Injectable()
export class DeduplicatorService {
  deduplicate(messages: Message[]): DedupResult {
    let removedCount = 0;

    // 1. Remove consecutive duplicates (same role + same content)
    const pass1: Message[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (i > 0) {
        const prev = messages[i - 1];
        if (messages[i].role === prev.role && contentHash(messages[i]) === contentHash(prev)) {
          removedCount++;
          continue;
        }
      }
      pass1.push(messages[i]);
    }

    // 2. User/System: keep first occurrence of each unique content
    const seen = new Map<string, number>();
    const pass2: Message[] = [];
    for (const msg of pass1) {
      const hash = contentHash(msg);
      if (msg.role === 'user' || msg.role === 'system') {
        if (seen.has(hash)) {
          removedCount++;
          continue;
        }
        seen.set(hash, pass2.length);
      }
      pass2.push(msg);
    }

    // 3. Assistant: keep last occurrence of each unique content
    const keepIndices = new Set<number>(pass2.map((_, i) => i));
    const seenAssistant = new Set<string>();
    for (let i = pass2.length - 1; i >= 0; i--) {
      if (pass2[i].role === 'assistant') {
        const hash = contentHash(pass2[i]);
        if (seenAssistant.has(hash)) {
          keepIndices.delete(i);
          removedCount++;
        } else {
          seenAssistant.add(hash);
        }
      }
    }

    const pass3 = pass2.filter((_, i) => keepIndices.has(i));

    return { messages: pass3, removedCount };
  }
}
