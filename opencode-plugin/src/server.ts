import type { Plugin, Hooks, ProviderHook, ModelV2 } from "../types/index.js";

const MADAME_PROVIDER_ID = "madame-agent";
const MADAME_BASE_URL = "http://localhost:3001";

const providerHook: ProviderHook = {
  id: MADAME_PROVIDER_ID,
  models: async (_provider, _ctx) => {
    const models: Record<string, ModelV2> = {
      "madame-auto": {
        id: "madame-auto",
        name: "Madame-Agent (Auto)",
        provider: MADAME_PROVIDER_ID,
        capabilities: ["chat"],
        metadata: { description: "Auto-routes between local and cloud models" },
      },
      "madame-local-only": {
        id: "madame-local-only",
        name: "Madame-Agent (Local Only)",
        provider: MADAME_PROVIDER_ID,
        capabilities: ["chat"],
        metadata: { description: "Local models only, no cloud routing" },
      },
    };

    const pairs = [
      "qwen3.5-o1+deepseek",
      "qwen3.5-o1+gemini",
      "gemma4:12b-mlx-oc+deepseek",
      "gemma4:12b-mlx-oc+gemini",
      "gemma4:latest-oc+deepseek",
      "gemma4:latest-oc+gemini",
    ];

    for (const pair of pairs) {
      const pairId = `madame-orchestrator-${pair}`;
      models[pairId] = {
        id: pairId,
        name: `Madame-Orchestrator (${pair})`,
        provider: MADAME_PROVIDER_ID,
        capabilities: ["chat"],
      };
    }

    return models;
  },
};

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const server: Plugin = async () => {
  const hooks: Hooks = {};

  // Check health and auto-start backend if needed
  try {
    const res = await fetch(`${MADAME_BASE_URL}/v1/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error();
  } catch (error) {
    const projectRoot = path.resolve(__dirname, "../../");
    const mainJs = path.join(projectRoot, "dist/main.js");
    
    const child = spawn("node", [mainJs], {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PORT: "3001" },
    });
    child.unref();
  }

  hooks["chat.params"] = async (_input, output) => {
    output.options = {
      ...output.options,
      baseUrl: MADAME_BASE_URL,
    };
  };

  hooks["chat.headers"] = async (_input, output) => {
    output.headers = {
      ...(output.headers as Record<string, string> | undefined),
      "x-madame-proxy": "plugin",
    };
  };

  return {
    ...hooks,
    provider: providerHook,
  };
};
