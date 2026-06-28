import { Message } from '../proxy/dto/openai.dto';

export interface HarnessParseResult {
  userMessage: string;
  isInterventionReply: boolean;
  interventionAnswer?: string;
}

export interface HarnessStrategy {
  readonly name: string;

  /**
   * Parses messages to extract user intention and intervention replies.
   */
  parseRequest(messages: Message[]): HarnessParseResult;

  /**
   * Formats the intervention (pause) response for the harness.
   */
  formatInterventionResponse(
    parentRequestId: string,
    question: string,
    orchestratorConfig?: any,
  ): any;
}
