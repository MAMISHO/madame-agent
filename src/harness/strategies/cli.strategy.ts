import { Injectable } from '@nestjs/common';
import { HarnessStrategy, HarnessParseResult } from '../harness.strategy';
import { Message } from '../../proxy/dto/openai.dto';

@Injectable()
export class CliStrategy implements HarnessStrategy {
  readonly name = 'cli';

  parseRequest(messages: Message[]): HarnessParseResult {
    let userMessage = this.lastUserMessage(messages);
    let isInterventionReply = false;
    let interventionAnswer: string | undefined = undefined;

    // A simple CLI client might send answers directly or keep them in messages
    if (messages && messages.length >= 3) {
      const lastMessage = messages[messages.length - 1];
      const prevMessage = messages[messages.length - 2];
      if (
        lastMessage.role === 'user' &&
        prevMessage.role === 'assistant' &&
        typeof prevMessage.content === 'string' &&
        prevMessage.content.includes('Intervención requerida:')
      ) {
        const rawAnswer = lastMessage.content;
        interventionAnswer = typeof rawAnswer === 'string' ? rawAnswer : JSON.stringify(rawAnswer);
        isInterventionReply = true;

        for (let i = messages.length - 3; i >= 0; i--) {
          if (messages[i].role === 'user') {
            const rawContent = messages[i].content;
            userMessage = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
            break;
          }
        }
      }
    }

    return {
      userMessage,
      isInterventionReply,
      interventionAnswer,
    };
  }

  formatInterventionResponse(
    parentRequestId: string,
    question: string,
    orchestratorConfig?: any,
  ): any {
    // For CLI, return a custom structured JSON response
    return {
      response: {
        data: {
          status: 'pending_user_input',
          requestId: parentRequestId,
          question,
        } as any,
      },
      metadata: {
        mode: 'orchestrator',
        escalated: false,
        providerKey: orchestratorConfig?.provider || 'unknown',
        providerType: orchestratorConfig?.type || 'unknown',
        model: orchestratorConfig?.model || 'unknown',
        originalTokens: 0,
        finalTokens: 0,
        iterations: 0,
        toolCalls: [],
        toolErrors: [],
      },
    };
  }

  private lastUserMessage(messages: Message[]): string {
    if (!messages || messages.length === 0) return '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content;
        return typeof content === 'string' ? content : JSON.stringify(content);
      }
    }
    return '';
  }
}
