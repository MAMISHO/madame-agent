import type { Plugin, ProviderHookContext } from "@opencode-ai/plugin"
import type { Provider as ProviderV2, Model as ModelV2 } from "@opencode-ai/sdk/v2"
import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const MADAME_BASE_URL = "http://localhost:3001"
let PROXY_URL = MADAME_BASE_URL
let _backendStarted = false

const STATIC_MODELS: Record<string, ModelV2> = {
  "madame-auto": {
    id: "madame-auto",
    name: "Madame Auto (Dynamic Routing)",
    provider: "madame-agent",
    capabilities: ["chat"],
    metadata: { tools: true },
  },
  "madame-local-only": {
    id: "madame-local-only",
    name: "Madame Local Only (Ollama)",
    provider: "madame-agent",
    capabilities: ["chat"],
    metadata: { tools: true },
  },
}

const DELEGATION_INSTRUCTIONS = `
## Delegation via Madame-Agent
You have access to madame-agent's orchestrator models for complex tasks.
`

export const MadameAgent: Plugin = async () => {
  const log = (...args: unknown[]) => console.log("[madame-agent]", ...args)

  let backendProcess: ReturnType<typeof spawn> | null = null

  const findMainJs = (): string | null => {
    const candidates = [
      path.join(os.homedir(), ".local/share/madame-agent/backend/dist/main.js"),
      path.join(os.homedir(), ".local/share/madame-agent/backend/main.js"),
      path.join(process.cwd(), "apps/backend/dist/main.js"),
      path.join(process.cwd(), "dist/main.js"),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    return null
  }

  const isPortInUse = async (port: number): Promise<boolean> => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 500)
      const res = await fetch(`http://localhost:${port}/v1/models`, {
        signal: controller.signal,
      })
      clearTimeout(timeout)
      return res.ok
    } catch {
      return false
    }
  }

  const startBackend = async (port: number) => {
    const mainJs = findMainJs()
    if (!mainJs) {
      log(`WARNING: main.js not found, skipping auto-start`)
      return false
    }

    const cwd = path.dirname(path.dirname(mainJs))
    log(`Starting backend on port ${port} from ${mainJs}`)

    backendProcess = spawn("node", [mainJs], {
      cwd,
      stdio: "pipe",
      env: { ...process.env, PORT: String(port) },
    })

    backendProcess.stdout?.on("data", (d) => process.stdout.write(d))
    backendProcess.stderr?.on("data", (d) => process.stderr.write(d))

    return true
  }

  const initialize = async () => {
    if (_backendStarted) return
    _backendStarted = true

    for (let p = 3000; p < 3020; p++) {
      if (await isPortInUse(p)) {
        log(`Backend detected on port ${p}`)
        PROXY_URL = `http://localhost:${p}`
        return
      }
    }

    if (await isPortInUse(3001)) {
      log(`Backend already running on :3001`)
      return
    }

    await startBackend(3001)
    log(`Backend configured at ${PROXY_URL}`)
  }

  await initialize()

  return {
    provider: {
      id: "madame-agent",
      models: async (provider: ProviderV2, _ctx: ProviderHookContext): Promise<Record<string, ModelV2>> => {
        try {
          const res = await fetch(`${PROXY_URL}/v1/models`)
          if (res.ok) {
            const data = await res.json()
            const dynamicModels: Record<string, ModelV2> = { ...STATIC_MODELS }
            
            for (const m of data.data || []) {
              // Skip ollama and cloud provider models (handled by their own providers)
              if (m.owned_by === "ollama" || m.owned_by === "google" || m.owned_by === "nvidia") {
                continue
              }
              
              // Format display name
              let displayName = m.id
              if (m.id.startsWith("madame-orchestrator-")) {
                displayName = `Madame-Orchestrator (${m.id.replace("madame-orchestrator-", "")})`
              } else if (m.id.startsWith("madame-")) {
                displayName = m.id.replace("madame-", "Madame ").replace(/-/g, " ")
              }
              
              dynamicModels[m.id] = {
                id: m.id,
                name: displayName,
                provider: "madame-agent",
                capabilities: ["chat"],
                metadata: { tools: true },
              }
            }
            return dynamicModels
          }
        } catch (e) {
          log("Error fetching models:", e)
        }
        return STATIC_MODELS
      },
    } as any,

    "chat.params": async (input: any, output: any) => {
      const agentMode = input.agent?.mode || "build"
      output.options = {
        ...output.options,
        baseUrl: PROXY_URL,
        agentMode,
      }
    },

    "chat.headers": async (input: any, output: any) => {
      const agentMode = input.agent?.mode || "build"
      output.headers = {
        ...(output.headers || {}),
        "x-madame-proxy": "plugin",
        "x-madame-agent-mode": agentMode,
      }
    },

    "experimental.chat.system.transform": async (_input: any, output: any) => {
      if (output.system.length > 0) {
        output.system[output.system.length - 1] += DELEGATION_INSTRUCTIONS
      } else {
        output.system.push(DELEGATION_INSTRUCTIONS)
      }
    },

    "command.execute.before": async (input: any, output: any) => {
      if (input.command !== "madame-stats") return

      try {
        const res = await fetch(`${PROXY_URL}/v1/costs`, {
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) {
          output.parts.push({
            type: "text",
            text: "⚠️ Madame-Agent proxy no responde.",
          })
          return
        }

        const data = await res.json()
        output.parts.push({
          type: "text",
          text: [
            `## Madame Stats`,
            ``,
            `| Métrica | Valor |`,
            `|---------|-------|`,
            `| **Coste cloud** | $${(data.totalCloudUsd ?? 0).toFixed(6)} |`,
            `| **Ahorro** | $${(data.totalSavedUsd ?? 0).toFixed(6)} |`,
            `| **Tokens cloud** | ${(data.cloudInputTokens ?? 0).toLocaleString()} in / ${(data.cloudOutputTokens ?? 0).toLocaleString()} out |`,
            `| **Tokens local** | ${(data.localInputTokens ?? 0).toLocaleString()} in / ${(data.localOutputTokens ?? 0).toLocaleString()} out |`,
          ].join("\n"),
        })
      } catch {
        output.parts.push({
          type: "text",
          text: "⚠️ No se pudo conectar con Madame-Agent proxy.",
        })
      }
    },

    dispose: async () => {
      if (backendProcess && !backendProcess.killed) {
        log("Stopping backend process")
        backendProcess.kill("SIGTERM")
      }
    },
  }
}


