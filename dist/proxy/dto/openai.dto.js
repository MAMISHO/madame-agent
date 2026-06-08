"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatCompletionRequest = exports.Message = void 0;
class Message {
    role;
    content;
    name;
    tool_calls;
    tool_call_id;
}
exports.Message = Message;
class ChatCompletionRequest {
    model;
    messages;
    stream;
    temperature;
    top_p;
    max_tokens;
    stop;
    tools;
    tool_choice;
    response_format;
}
exports.ChatCompletionRequest = ChatCompletionRequest;
//# sourceMappingURL=openai.dto.js.map