/**
 * madame-agent — OpenCode Plugin (Server)
 *
 * Integrates madame-agent proxy as a native opencode plugin:
 * 1. Registers madame models dynamically via ProviderHook
 * 2. Injects delegation instructions into system prompt
 * 3. Provides /madame-stats command for cost tracking
 *
 * The proxy server runs independently on :3001.
 * This plugin registers the provider so opencode knows about the models
 * without manual opencode.json configuration.
 */

console.log("[madame-agent] Plugin loading...")

import type { Plugin, ProviderHookContext } from "@opencode-ai/plugin"
import type { Provider as ProviderV2, Model as ModelV2 } from "@opencode-ai/sdk/v2"
import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

let PROXY_URL = "http://localhost:3001"

// Models that madame-agent exposes — must match what the server serves
const MADAME_MODELS: Record<string, ModelV2> = {
  "madame-auto": {
    id: "madame-auto",
    name: "Madame Auto (Dynamic Routing)",
    provider: "madame-agent",
    capabilities: ["chat"],
    metadata: { tools: true },
  },
  "Gemini-Orchestrator+Gemma12B-OC": {
    id: "Gemini-Orchestrator+Gemma12B-OC",
    name: "Gemini 3.1 Flash Lite + Gemma4 12B (Orchestrator)",
    provider: "madame-agent",
    capabilities: ["chat"],
    metadata: { tools: true },
  },
  "Gemini-Orchestrator+Qwen27B-OC": {
    id: "Gemini-Orchestrator+Qwen27B-OC",
    name: "Gemini 3.1 Flash Lite + Qwen 27B (Orchestrator)",
    provider: "madame-agent",
    capabilities: ["chat"],
    metadata: { tools: true },
  },
  "DeepseekV4Flash-Orchestrator+Gemma4-12B": {
    id: "DeepseekV4Flash-Orchestrator+Gemma4-12B",
    name: "Deepseek V4 Flash + Gemma4 12B (Orchestrator)",
    provider: "madame-agent",
    capabilities: ["chat"],
    metadata: { tools: true },
  },
  "Llama70B-Orchestrator+Gemma4-12B": {
    id: "Llama70B-Orchestrator+Gemma4-12B",
    name: "Llama 3.3 70B + Gemma4 12B (Orchestrator)",
    provider: "madame-agent",
    capabilities: ["chat"],
    metadata: { tools: true },
  },
  "Gemma4-12B+DeepseekV4Flash": {
    id: "Gemma4-12B+DeepseekV4Flash",
    name: "Gemma4 12B + Deepseek V4 Flash",
    provider: "madame-agent",
    capabilities: ["chat"],
    metadata: {},
  },
  "Gemma4-12B+Llama70B": {
    id: "Gemma4-12B+Llama70B",
    name: "Gemma4 12B + Llama 3.3 70B",
    provider: "madame-agent",
    capabilities: ["chat"],
    metadata: {},
  },
  "madame-local-only": {
    id: "madame-local-only",
    name: "Madame Local Only (Ollama)",
    provider: "madame-agent",
    capabilities: ["chat"],
    metadata: { tools: true },
  },
}

// Instructions injected into every chat's system prompt
const DELEGATION_INSTRUCTIONS = `

## Delegation via Madame-Agent

You have access to madame-agent's orchestrator models for complex tasks:

- Use \`Gemini-Orchestrator+Gemma12B-OC\` or \`DeepseekV4Flash-Orchestrator+Gemma4-12B\` when a task requires planning + delegation.
- The orchestrator model will: (1) analyze the task using its own reasoning, (2) delegate execution subtasks to local sub-agents, (3) synthesize the final result.
- Local sub-agents handle file operations, command execution, and coding — the orchestrator handles thinking and planning.
- For simple tasks, use a direct model (\`gemma4:12b-mlx-oc\`, etc.) without orchestration overhead.

**When to use orchestrator models:**
- ✅ Multi-file implementation tasks
- ✅ Tasks requiring research + coding
- ✅ Any task where delegation reduces context pollution
- ❌ Simple Q&A or single-edit tasks (use direct model)
`

export const MadameAgent: Plugin = async (ctx) => {
  const log = (...args: any[]) => console.log("[madame-agent]", ...args)

  const getDefaultInstallDir = () => {
    if (process.platform === 'win32') {
      return path.join(os.homedir(), 'AppData', 'Local', 'madame-agent');
    }
    return path.join(os.homedir(), '.local', 'share', 'madame-agent');
  };

  let projectRoot = getDefaultInstallDir();
  let detectedPort: string | null = null;

  try {
    const configPath = path.join(os.homedir(), ".config/opencode/opencode.json")
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
      if (config.madame?.server?.path) {
        projectRoot = config.madame.server.path
      }
      const baseURL = config.provider?.['madame-agent']?.options?.baseURL
      if (baseURL) {
        const match = baseURL.match(/:(\d+)/)
        if (match) {
          detectedPort = match[1]
        }
        const urlMatch = baseURL.match(/^(https?:\/\/[^\/:]+(:\d+)?)/)
        if (urlMatch) {
          PROXY_URL = urlMatch[1]
        }
      }
    }
  } catch (err) {
    // ignore
  }

  const findMainJs = (): string | null => {
    const candidates = [
      path.join(projectRoot, "backend/dist/main.js"),
      path.join(projectRoot, "backend/main.js"),
      path.join(projectRoot, "dist/main.js"),
      path.join(projectRoot, "apps/backend/dist/main.js"),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  };

  const isPortInUse = async (port: number): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const res = await fetch(`http://localhost:${port}/v1/models`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  };

  const findFreePort = async (startPort: number): Promise<number> => {
    let port = startPort;
    while (port < startPort + 100) {
      if (!(await isPortInUse(port))) {
        return port;
      }
      port++;
    }
    return startPort;
  };

  const startBackend = async (port: number) => {
    const mainJs = findMainJs();
    if (!mainJs) {
      log(`ERROR: main.js not found in ${projectRoot}`);
      return;
    }
    log(`Starting backend on port ${port} from ${mainJs}`);
    spawn("node", [mainJs], {
      cwd: projectRoot,
      stdio: "inherit",
      env: { ...process.env, PORT: String(port), MADAME_PATH: projectRoot },
      detached: true,
    });
  };

  const initialize = async () => {
    const startPort = 3000;
    let targetPort: number;

    if (detectedPort) {
      const portNum = parseInt(detectedPort, 10);
      if (await isPortInUse(portNum)) {
        log(`Madame Agent already running on port ${portNum}`);
        targetPort = portNum;
        PROXY_URL = `http://localhost:${portNum}`;
      } else {
        log(`Configured port ${portNum} not in use, starting backend...`);
        targetPort = portNum;
        await startBackend(targetPort);
      }
    } else {
      for (let p = startPort; p < startPort + 20; p++) {
        if (await isPortInUse(p)) {
          log(`Madame Agent detected on port ${p}`);
          targetPort = p;
          PROXY_URL = `http://localhost:${p}`;
          break;
        }
      }
      if (!targetPort) {
        targetPort = await findFreePort(startPort);
        log(`No running instance found. Using free port ${targetPort}`);
        await startBackend(targetPort);
      }
    }
    log(`Backend configured at ${PROXY_URL}`);
  };

  initialize();

  return {
    // ─── ProviderHook: Register madame models dynamically ────────────
    provider: {
      id: "madame-agent",
      models: async (provider: ProviderV2, _ctx: ProviderHookContext): Promise<Record<string, ModelV2>> => {
        log(`ProviderHook called for provider "${provider.id}"`)
        try {
          const res = await fetch(`${PROXY_URL}/v1/models`);
          if (res.ok) {
            const data = await res.json();
            const dynamicModels: Record<string, ModelV2> = { ...MADAME_MODELS };
            for (const m of data.data || []) {
              dynamicModels[m.id] = {
                id: m.id,
                name: m.id.startsWith("madame-orchestrator-") 
                  ? `Madame-Orchestrator (${m.id.replace("madame-orchestrator-", "")})`
                  : m.id,
                provider: "madame-agent",
                capabilities: ["chat"],
                metadata: { tools: true },
              };
            }
            return dynamicModels;
          }
        } catch (e) {
          // fallback
        }
        return MADAME_MODELS;
      },
    } as any,

    // ─── System Prompt: Inject delegation instructions ─────────────
    "experimental.chat.system.transform": async (_input, output) => {
      if (output.system.length > 0) {
        output.system[output.system.length - 1] += DELEGATION_INSTRUCTIONS
      } else {
        output.system.push(DELEGATION_INSTRUCTIONS)
      }
    },

    // ─── Slash Command: /madame-stats ─────────────────────────────
    "command.execute.before": async (input, output) => {
      if (input.command !== "madame-stats") return

      try {
        const res = await fetch(`${PROXY_URL}/v1/costs`, {
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) {
          output.parts.push({
            type: "text",
            text: "⚠️ Madame-Agent proxy no responde. Asegúrate de que el servidor esté corriendo en :3001.",
          })
          return
        }

        const data = await res.json()
        const totalCloudUsd = data.totalCloudUsd ?? 0
        const totalSavedUsd = data.totalSavedUsd ?? 0
        const cloudIn = data.cloudInputTokens ?? 0
        const cloudOut = data.cloudOutputTokens ?? 0
        const localIn = data.localInputTokens ?? 0
        const localOut = data.localOutputTokens ?? 0

        output.parts.push({
          type: "text",
          text: [
            `## Madame Stats`,
            ``,
            `| Métrica | Valor |`,
            `|---------|-------|`,
            `| **Coste cloud sesión** | $${totalCloudUsd.toFixed(6)} |`,
            `| **Ahorro estimado** | $${totalSavedUsd.toFixed(6)} |`,
            `| **Tokens cloud in** | ${cloudIn.toLocaleString()} |`,
            `| **Tokens cloud out** | ${cloudOut.toLocaleString()} |`,
            `| **Tokens local in** | ${localIn.toLocaleString()} |`,
            `| **Tokens local out** | ${localOut.toLocaleString()} |`,
            ``,
            `> Ejecuta \`/madame-stats\` en cualquier momento para ver esta información.`,
          ].join("\n"),
        })
      } catch {
        output.parts.push({
          type: "text",
          text: "⚠️ No se pudo conectar con Madame-Agent proxy en :3001.",
        })
      }
    },
  }
}

export default MadameAgent
