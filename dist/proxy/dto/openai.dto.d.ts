export declare class Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | any[];
    name?: string;
    tool_calls?: any[];
    tool_call_id?: string;
}
export declare class ChatCompletionRequest {
    model: string;
    messages: Message[];
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    stop?: string | string[];
    tools?: any[];
    tool_choice?: any;
    response_format?: any;
}
