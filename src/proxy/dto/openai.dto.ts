export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

export class Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCallRecord {
  name: string;
  args: any;
  result: any;
  latencyMs: number;
  iteration: number;
}

export class ChatCompletionRequest {
  model?: string;
  messages: Message[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  tools?: ToolDefinition[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  response_format?: any;
  requestId?: string;
  parentRequestId?: string;
}
