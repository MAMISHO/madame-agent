/* ------------------------------------------------------------------ */
/*  Server-side types for @opencode-ai/plugin                         */
/* ------------------------------------------------------------------ */

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

export type HookFunction = (...args: any[]) => unknown | Promise<unknown>;

export interface Hooks {
  [hookName: `chat.${string}` | `command.${string}`]: HookFunction;
}

export interface PluginOutput {
  provider?: ProviderHook;
  [key: string]:
    | HookFunction
    | ProviderHook
    | undefined;
}

export type PluginInput = Record<string, unknown>;

export type Plugin = (input?: PluginInput) => PluginOutput | Promise<PluginOutput>;
