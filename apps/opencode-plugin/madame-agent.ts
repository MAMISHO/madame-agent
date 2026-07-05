import type { Plugin, ProviderHookContext } from "@opencode-ai/plugin"
import type { Model as ModelV2 } from "@opencode-ai/sdk/v2"
import { spawn } from "child_process"
import * as fs from "fs"
import * as http from "http"
import * as path from "path"
import * as os from "os"

const MADAME_BASE_URL = "http://localhost:3001"
let PROXY_URL = MADAME_BASE_URL
let _backendStarted = false

const PLUGIN_PORT_PATH = path.join(os.homedir(), ".local/share/madame-agent/plugin-port")

const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 } as const
type LogLevel = keyof typeof LOG_LEVELS

function createLogger(level?: string) {
  const configuredLevel = process.env.MADAME_LOG_LEVEL || level || "ERROR"
  const currentLevel = (LOG_LEVELS as Record<string, number>)[configuredLevel]
  const effectiveLevel = currentLevel !== undefined ? currentLevel : LOG_LEVELS.ERROR
  return (lvl: LogLevel, ...args: unknown[]) => {
    if (LOG_LEVELS[lvl] <= effectiveLevel) {
      console.log(`[madame-agent] [${lvl}]`, ...args)
    }
  }
}

const DELEGATION_INSTRUCTIONS = `
## Delegation via Madame-Agent
You have access to madame-agent's orchestrator models for complex tasks.
`

function getOpenCodeConfigPath(): string {
  return path.join(os.homedir(), ".config/opencode/opencode.json")
}

function modelsToConfigFormat(models: Record<string, ModelV2>): Record<string, { name: string }> {
  const out: Record<string, { name: string }> = {}
  for (const [id, m] of Object.entries(models)) {
    out[id] = { name: m.name }
  }
  return out
}

function writeConfigSync(cfg: any) {
  const configPath = getOpenCodeConfigPath()
  const tmpPath = configPath + ".madame-tmp"
  fs.writeFileSync(tmpPath, JSON.stringify(cfg, null, 2) + "\n")
  fs.renameSync(tmpPath, configPath)
}

function syncModelsToConfig(models: Record<string, ModelV2>, log: ReturnType<typeof createLogger>) {
  const configPath = getOpenCodeConfigPath()
  if (!fs.existsSync(configPath)) return

  try {
    const raw = fs.readFileSync(configPath, "utf-8")
    const cfg = JSON.parse(raw)

    if (!cfg.provider) cfg.provider = {}
    if (!cfg.provider["madame-agent"]) {
      cfg.provider["madame-agent"] = {
        name: "Madame Agent (hybrid proxy)",
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "http://localhost:3001/v1" },
        models: {},
      }
    }

    cfg.provider["madame-agent"].models = modelsToConfigFormat(models)
    writeConfigSync(cfg)
    log("INFO", `Synced ${Object.keys(models).length} models to config`)
  } catch (e) {
    log("ERROR", "Error syncing models to config:", e)
  }
}

async function fetchModelsFromBackend(): Promise<Record<string, ModelV2> | null> {
  try {
    const res = await fetch(`${PROXY_URL}/v1/models`)
    if (!res.ok) return null
    const data = await res.json()
    const dynamicModels: Record<string, ModelV2> = {}

    for (const m of data.data || []) {
      if (m.owned_by === "ollama" || m.owned_by === "google" || m.owned_by === "nvidia") {
        continue
      }

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
  } catch {
    return null
  }
}

async function findExistingServer(portFilePath: string): Promise<number | null> {
  try {
    if (!fs.existsSync(portFilePath)) return null
    const port = parseInt(fs.readFileSync(portFilePath, "utf-8").trim(), 10)
    if (isNaN(port)) return null
    const res = await fetch(`http://127.0.0.1:${port}/health?source=plugin`, {
      signal: AbortSignal.timeout(1000),
    })
    if (res.ok) return port
    return null
  } catch {
    return null
  }
}

export const MadameAgent: Plugin = async (input: any) => {
  const log = createLogger()
  const client = input?.client

  log("INFO", "Plugin loaded")

  let backendProcess: ReturnType<typeof spawn> | null = null
  let myPort: number | null = null

  async function syncToLiveConfig(models: Record<string, ModelV2>) {
    if (!client) {
      log("WARN", "client not available, skipping live config sync")
      return
    }
    try {
      const configData = await client.config.get()
      const cfg = configData?.data || {}
      if (!cfg.provider) cfg.provider = {}
      if (!cfg.provider["madame-agent"]) {
        cfg.provider["madame-agent"] = {
          name: "Madame Agent (hybrid proxy)",
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: `${PROXY_URL}/v1` },
          models: {},
        }
      }
      cfg.provider["madame-agent"].models = modelsToConfigFormat(models)
      await client.config.update({ body: cfg })
      log("INFO", `Synced ${Object.keys(models).length} models to live config`)
    } catch (e: any) {
      log("ERROR", "Error syncing to live config:", e.message)
    }
  }

  // ── HTTP server for backend-triggered sync (singleton) ──
  const existingPort = await findExistingServer(PLUGIN_PORT_PATH)
  let httpServer: http.Server | null = null

  if (existingPort === null) {
    httpServer = http.createServer(async (req, res) => {
      if (req.method === "GET" && req.url?.startsWith("/health")) {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: true }))
        return
      }
      if (req.method === "POST" && req.url === "/sync-models") {
        try {
          const models = await fetchModelsFromBackend()
          if (models) {
            await syncToLiveConfig(models)
            syncModelsToConfig(models, log)
          }
          const count = models ? Object.keys(models).length : 0
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true, count }))
        } catch (e: any) {
          res.writeHead(500, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
        return
      }
      res.writeHead(404)
      res.end()
    })

    httpServer.setMaxListeners(0)

    httpServer.listen(0, "127.0.0.1", () => {
      myPort = (httpServer!.address() as any).port
      try {
        fs.mkdirSync(path.dirname(PLUGIN_PORT_PATH), { recursive: true })
        fs.writeFileSync(PLUGIN_PORT_PATH, String(myPort))
        log("INFO", `Sync HTTP server listening on port ${myPort}`)
      } catch (e) {
        log("WARN", `Could not write plugin port file:`, e)
      }
    })

    httpServer.on("close", () => {
      log("DEBUG", "HTTP server closed")
    })
  } else {
    myPort = existingPort
    log("INFO", `Reusing existing HTTP server on port ${existingPort}`)
  }

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
      const res = await fetch(`http://localhost:${port}/v1/health`, {
        signal: AbortSignal.timeout(1000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  const startBackend = async (port: number) => {
    const mainJs = findMainJs()
    if (!mainJs) {
      log("WARN", "main.js not found, skipping auto-start")
      return false
    }

    const cwd = path.dirname(path.dirname(mainJs))
    log("INFO", `Starting backend on port ${port} from ${mainJs}`)

    backendProcess = spawn("node", [mainJs], {
      cwd,
      stdio: "pipe",
      env: { ...process.env, PORT: String(port) },
    })

    backendProcess.stdout?.on("data", (d) => process.stdout.write(d))
    backendProcess.stderr?.on("data", (d) => process.stderr.write(d))

    return true
  }

  const waitForBackend = async (port: number, timeoutMs = 30000): Promise<boolean> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://localhost:${port}/v1/health`, {
          signal: AbortSignal.timeout(2000),
        })
        if (res.ok) {
          log("INFO", `Backend ready on port ${port}`)
          return true
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    log("WARN", `Backend did not become ready within ${timeoutMs / 1000}s`)
    return false
  }

  const initialize = async () => {
    if (_backendStarted) return
    _backendStarted = true

    // Scan ports 3000-3019 for an already running backend (hot-reload recovery)
    for (let p = 3000; p < 3020; p++) {
      try {
        const res = await fetch(`http://localhost:${p}/v1/health`, {
          signal: AbortSignal.timeout(1000),
        })
        if (res.ok) {
          log("INFO", `Found backend on port ${p}`)
          PROXY_URL = `http://localhost:${p}`
          const models = await fetchModelsFromBackend()
          if (models) await syncToLiveConfig(models)
          return
        }
      } catch {
        /* try next */
      }
    }

    // Fallback: double-check port 3001 to avoid spawning a duplicate
    if (await isPortInUse(3001)) {
      log("INFO", "Backend already running on :3001")
      const models = await fetchModelsFromBackend()
      if (models) await syncToLiveConfig(models)
      return
    }

    await startBackend(3001)
    const ready = await waitForBackend(3001)
    log("INFO", `Backend configured at ${PROXY_URL}`)
    if (ready) {
      const models = await fetchModelsFromBackend()
      if (models) {
        await syncToLiveConfig(models)
      }
    }
  }

  initialize().catch((err) => log("ERROR", "Backend startup error:", err))

  return {
    provider: {
      id: "madame-agent",
      models: async (): Promise<Record<string, ModelV2>> => {
        log("DEBUG", "models() hook called — fetching from backend")
        return (await fetchModelsFromBackend()) ?? {}
      },
    },

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
      // Kill backend process so it doesn't become a zombie
      if (backendProcess) {
        backendProcess.kill("SIGTERM")
        backendProcess = null
      }

      // Only delete plugin-port file if it's ours
      try {
        const currentPort = fs.readFileSync(PLUGIN_PORT_PATH, "utf-8").trim()
        if (currentPort === String(myPort)) {
          fs.unlinkSync(PLUGIN_PORT_PATH)
        }
      } catch {
        /* file doesn't exist or not ours */
      }

      // Reset flag so next instance can start backend on hot-reload
      _backendStarted = false

      // DO NOT close httpServer — it's shared, other instances use it
    },
  }
}
