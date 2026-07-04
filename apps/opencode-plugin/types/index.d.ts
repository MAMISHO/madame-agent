export interface ModelV2 {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
  maxTokens?: number;
  contextLength?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderHook {
  id: string;
  models: (
    provider: unknown,
    ctx: unknown,
  ) => Promise<Record<string, ModelV2>>;
}

export interface ChatMessageContext {
  sessionID: string;
  agent?: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  messageID?: string;
  variant?: string;
}

export interface ChatParamsContext {
  sessionID: string;
  agent: string;
  model: unknown;
  provider: unknown;
  message: unknown;
}

export interface ChatHeadersContext {
  sessionID: string;
  agent: string;
  model: unknown;
  provider: unknown;
  message: unknown;
}

export type HookFunction = (...args: any[]) => unknown | Promise<unknown>;

export interface Hooks {
  dispose?: () => Promise<void>;
  "chat.message"?: (
    input: ChatMessageContext,
    output: {
      message: { role: string; content: string; [key: string]: unknown };
      parts: unknown[];
    },
  ) => Promise<void>;
  "chat.params"?: (
    input: ChatParamsContext,
    output: {
      temperature: number;
      topP: number;
      topK: number;
      maxOutputTokens: number | undefined;
      options: Record<string, unknown>;
    },
  ) => Promise<void>;
  "chat.headers"?: (
    input: ChatHeadersContext,
    output: {
      headers: Record<string, string>;
    },
  ) => Promise<void>;
  "command.execute.before"?: HookFunction;
  "tool.execute.before"?: HookFunction;
  "tool.execute.after"?: HookFunction;
  "experimental.chat.system.transform"?: HookFunction;
  [key: string]: HookFunction | undefined;
}

export interface PluginOutput {
  provider?: ProviderHook;
  dispose?: () => Promise<void>;
  [key: string]: HookFunction | ProviderHook | undefined;
}

export type PluginInput = Record<string, unknown>;

export type Plugin = (input?: PluginInput) => PluginOutput | Promise<PluginOutput>;