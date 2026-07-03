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

    try {
      const res = await fetch(`${MADAME_BASE_URL}/api/tags`);
      if (res.ok) {
        const data = await res.json();
        for (const m of data.models || []) {
          const modelId = m.model as string;
          // Only include orchestrator models (created from active harnesses)
          if (modelId.startsWith("madame-orchestrator-")) {
            const harnessCode = modelId.replace("madame-orchestrator-", "");
            models[modelId] = {
              id: modelId,
              name: `Madame-Orchestrator (${harnessCode})`,
              provider: MADAME_PROVIDER_ID,
              capabilities: ["chat"],
              metadata: { description: `Orchestrator for harness: ${harnessCode}` },
            };
          }
        }
      }
    } catch (e) {
      // Fallback: don't load external models if backend is down
    }

    return models;
  },
};

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

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
    const pluginRoot = path.resolve(__dirname, "..");
    const prodMainJs = path.join(pluginRoot, "backend/main.js");
    const isProd = fs.existsSync(prodMainJs);

    const mainJs = isProd ? prodMainJs : path.join(path.resolve(__dirname, "../../"), "dist/main.js");
    const cwd = isProd ? pluginRoot : path.resolve(__dirname, "../../");
    
    const child = spawn("node", [mainJs], {
      cwd,
      env: { ...process.env, PORT: "3001" },
    });
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
