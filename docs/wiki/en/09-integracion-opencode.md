# madame-agent → opencode Integration

## 1. External Configuration from opencode.json

### Problem

Today all configuration lives in `routing.yaml` within the madame-agent project. For opencode to use madame-agent as an execution backend, the configuration must come FROM opencode.json.

### Solution

opencode.json would have a `madame` section passed entirely to madame-agent as a JSON blob. Madame-agent merges this configuration with its internal defaults.

```json
// opencode.json
{
  "model": "gemma4:12b-mlx-oc",  // default local model

  "madame": {
    "enabled": false,  // opt-in, default false

    "orchestrator": {
      "provider": "google",
      "model": "models/gemini-3.1-flash-lite",
      "enabled": false,  // cloud orchestrator opt-in
      "timeout_ms": 300000,
      "rate_limit": {
        "max_retries": 3,
        "base_delay_ms": 4000
      }
    },

    "subagents": {
      "default": "gemma4:12b-mlx-oc",
      "fallback": ["qwen3.6:27b-oc"],
      "timeout_ms": 120000,
      "tools": [
        "read_file", "write_file", "glob_files", "list_directory",
        "execute_command"
      ]
    },

    "mode": "auto",
    // "auto"  → uses classifier to decide local vs cloud
    // "local" → forces local always
    // "plan"  → always cloud (equivalent to current plan mode)
    // "orchestrator" → uses cloud orchestrator with local subagent

    "cost_tracking": {
      "enabled": true,
      "persist_path": "~/.opencode/costs.json"
    },

    "server": {
      "port": 3001,
      "start_on_demand": true,
      "idle_timeout_ms": 300000  // kills the server if idle for 5 min
    }
  }
}
```

### Mechanism

1. opencode reads `opencode.json` → extracts `madame` section.
2. opencode resolves API keys from `~/.local/share/opencode/auth.json`.
3. When launching madame-agent, it passes the config + API keys as arguments and env vars:
   ```bash
   GOOGLE_GENERATIVE_AI_API_KEY=... node dist/main.js \
     --config '{"orchestrator":{"provider":"google",...}}'
   ```
4. Madame-agent receives:
   - `--config` (configuration from opencode.json)
   - `process.env.GOOGLE_GENERATIVE_AI_API_KEY` (API key injected by opencode)
5. It **NEVER** needs `.env` — opencode handles the entire secrets lifecycle.

### API Keys: auth.json Flow

API keys NEVER go in `opencode.json` or `routing.yaml`. opencode uses its own credential system.

Madame-agent can use models from **different providers** simultaneously — each with its own API key:

| Provider | Env var (madame-agent) | auth.json key (opencode) |
|---|---|---|
| Google (Gemini) | `GOOGLE_GENERATIVE_AI_API_KEY` | `"madame_google"` |
| NVIDIA (Deepseek, Llama) | `NVIDIA_API_KEY` | `"madame_nvidia"` |
| OpenAI | `OPENAI_API_KEY` | `"madame_openai"` |
| Anthropic | `ANTHROPIC_API_KEY` | `"madame_anthropic"` |
| OpenRouter | `OPENROUTER_API_KEY` | `"madame_openrouter"` |

**Each provider has its own entry in auth.json** and opencode injects them ALL when launching madame-agent. Madame-agent uses the one it needs depending on the model being used in each request.

```json
// ~/.local/share/opencode/auth.json
{
  "madame_google":  { "type": "api", "key": "AIza..." },    // Gemini
  "madame_nvidia":  { "type": "api", "key": "nvapi-..." },  // Deepseek, Llama
  "madame_openai":  { "type": "api", "key": "sk-..." }      // if configured
}
```

**Flow:**

```
1. User configures madame-agent in opencode.json
   → orchestrator.provider = "google"
   → can also escalate to NVIDIA if the classifier decides

2. opencode sees which cloud providers madame-agent needs
   (based on orchestrator_pairs and providers config)

3. For EACH provider, opencode checks:
   Does auth.json have "madame_{provider}"?
   ├── Yes → read the key
   └── No  → request the key from the user via UI (like any provider)
             → save to auth.json as "madame_{provider}"

4. opencode launches child process with ALL env vars:
   GOOGLE_GENERATIVE_AI_API_KEY=<key> \
   NVIDIA_API_KEY=<key> \
     node dist/main.js --config '...'

5. madame-agent uses process.env.GOOGLE_GENERATIVE_AI_API_KEY
   or process.env.NVIDIA_API_KEY depending on request model
```

**What happens if an API key is missing for a required provider?**

- opencode can degrade gracefully: if there is no key for NVIDIA, it does not use NVIDIA models.
- Or it can prompt for the key on-demand (lazy prompt).
- The decision belongs to opencode, not madame-agent.

This is exactly how opencode handles any other provider — the user provides the key once via the UI, opencode persists it, and injects it into the child process. The difference is that madame-agent may need **multiple** keys because it uses multiple providers in a single flow (Google orchestrator + NVIDIA escalation, for example).

### Configuration Hierarchy (First Wins)

```
opencode.json  →  --config flag  →  auth.json (API keys)  →  internal defaults
                                               ↓
                                 injected as env vars
                                 to child process
```

---

## 2. Timeouts per Layer

### Problem

Today there is a single `global_timeout_ms: 300000` in `routing.yaml`. The cloud orchestrator (Gemini/Deepseek) and the local subagent (gemma4:12b-mlx-oc) have very different execution profiles:

| Layer | Typical Range | Note |
|---|---|---|
| Cloud orchestrator (Gemini) | 20-130s | Stable but variable |
| Cloud orchestrator (Deepseek) | 30-250s+ | Can rate-limit |
| Local subagent (loading) | 8-15s | First load of the model |
| Local subagent (execution) | 5-60s | Executing tools |
| Self-fallback | 30-120s | Orchestrator acts as subagent |

### Solution

Configurable timeouts per layer, from `opencode.json` or injected as env vars by opencode:

```yaml
# routing.yaml — defaults
tools:
  orchestrator_timeout_ms: 300000   # time for the cloud model to respond
  subagent_timeout_ms: 120000        # per subagent attempt
  subagent_total_timeout_ms: 300000  # sum of all attempts (failover)
  self_fallback_timeout_ms: 180000   # self-fallback when all fail
```

opencode injects them as env vars to the child process (alternative to JSON config):
```bash
MADAME_ORCHESTRATOR_TIMEOUT_MS=300000 \
MADAME_SUBAGENT_TIMEOUT_MS=120000 \
  node dist/main.js --config '...'
```

### Implementation

In `tool-loop.service.ts`:

```typescript
// Instead of a single global_timeout_ms:
const timeouts = {
  orchestrator: request.timeout_ms || config.tools.orchestrator_timeout_ms,
  subagent: config.tools.subagent_timeout_ms,
  selfFallback: config.tools.self_fallback_timeout_ms,
};

// routeThroughOrchestrator uses orchestrator timeout
// delegate_subagent uses subagent timeout (with failover accumulation)
// self-fallback uses self_fallback timeout
```

The subagent **inherits the default timeout** from `subagent_timeout_ms` but can be overridden if the orchestrator passes an extra argument:

```json
{
  "task": "list the files...",
  "subagent_model": "gemma4:12b-mlx-oc",
  "timeout_ms": 60000  // optional override
}
```

---

## 3. Cost Tracking

### Problem

Each cloud request has a real cost (Gemini, NVIDIA). Without tracking, the user does not know how much they are spending. This is important for opt-in — if the user enables the cloud orchestrator, they must be able to see how much they consume.

### Solution

Persist costs in a JSON file at `~/.opencode/costs.json`. Structure:

```json
{
  "version": 1,
  "providers": {
    "google": {
      "total_requests": 12,
      "total_input_tokens": 8456,
      "total_output_tokens": 3243,
      "estimated_cost_usd": 0.0082,
      "last_request": "2026-06-23T23:40:00Z"
    },
    "nvidia": {
      "total_requests": 8,
      "total_input_tokens": 6123,
      "total_output_tokens": 2891,
      "estimated_cost_usd": 0.0154,
      "last_request": "2026-06-23T23:35:00Z"
    }
  },
  "session": [
    {
      "timestamp": "2026-06-23T23:40:00Z",
      "orchestrator_pair": "Gemini-Orchestrator+Gemma12B-OC",
      "provider": "google",
      "model": "models/gemini-3.1-flash-lite",
      "input_tokens": 240,
      "output_tokens": 114,
      "estimated_cost": 0.0003,
      "latency_ms": 95200,
      "subagent": {
        "model": "gemma4:12b-mlx-oc",
        "latency_ms": 45000
      }
    }
  ]
}
```

### Reference Pricing

These are estimated values that should be configurable (or updatable via web):

| Provider | Model | Input (per 1K tokens) | Output (per 1K tokens) |
|---|---|---|---|
| Google Gemini | gemini-3.1-flash-lite | $0.0003 | $0.0006 |
| NVIDIA | deepseek-ai/deepseek-v4-flash | Free (rate-limited) | Free |
| NVIDIA | meta/llama-3.3-70b-instruct | $0.001 | $0.001 |

### REST Endpoint

```http
GET /v1/costs
```

```json
{
  "totals": { "google": 0.0082, "nvidia": 0.0154 },
  "this_session": 0.0035,
  "by_request": [ ... ]
}
```

### Reset

```http
POST /v1/costs/reset
```

Resets the current session. The persisted file maintains the history.

---

## 4. On-Demand Startup from opencode

### Problem

Today the user must start `npm run start` manually before using opencode with madame-agent. This breaks the flow — opencode should manage its own lifecycle.

### Solution

opencode launches madame-agent as an on-demand **child process**, similar to how it handles MCPs.

### Lifecycle

```
1. opencode detects it needs madame-agent
   (because mode is "orchestrator" or classifier decided to escalate)
   
2. opencode searches for madame-agent:
   a. Is there a process listening on :3001? → use it (reuse)
   b. If not: launch child process:
      node /path/to/madame-agent/dist/main.js \
        --config "$MADAME_CONFIG_JSON" \
        --port 3001
   
3. opencode waits for server to return 200 on /v1/health
   (polling every 100ms, timeout 30s)
   
4. opencode uses the server for chat/completions

5. When the server is idle for X time → opencode kills it
   (SIGTERM, graceful shutdown)
```

### Process Management

```typescript
// Inside opencode (hypothetical):
interface MadameManager {
  start(config: MadameConfig): Promise<ChildProcess>;
  stop(): Promise<void>;
  health(): Promise<boolean>;
  isRunning(): boolean;
  killOnIdle(idleMs: number): void;  // auto-kill after idle
}
```

### Signals

| Signal | Behavior |
|---|---|
| `SIGTERM` | Graceful shutdown: completes active requests, kills subagents, persists costs |
| `SIGKILL` | Forced kill (only if SIGTERM does not respond within 5s) |
| `SIGHUP` | Reload configuration without restarting |

### Config from opencode

```json
// opencode.json
{
  "model": "gemma4:12b-mlx-oc",

  "madame": {
    "enabled": true,
    "server": {
      "path": "/opt/madame-agent",  // or relative to opencode
      "port": 3001,
      "start_on_demand": true,
      "idle_timeout_ms": 300000
    }
  }
}
```

---

## 5. Complete Flowchart

```
opencode.json ──→ opencode
                      │
                      │ (1) Reads madame config
                      │ (2) Decides cloud orchestrator is needed
                      │
                      ├── (3) API key in auth.json?
                      │      ├── Yes → read key
                      │      └── No  → request via UI → save to auth.json
                      │
                      ├── (4) Is madame-agent running?
                      │   ├── Yes → reuse
                      │   └── No  → launch child process with injected API key
                      │            │
                      │            │ (5) GOOGLE_GENERATIVE_AI_API_KEY=... \
                      │            │     node dist/main.js --config='{...}'
                      │            │
                      │            ▼
                      │      madame-agent (NestJS)
                      │      ┌──────────────────┐
                      │      │ tools:           │
                      │      │  delegate_       │ ← cloud orchestrator only
                      │      │  subagent        │
                      │      │                  │
                      │      │  read_file,      │ ← local subagent
                      │      │  write_file...   │
                      │      │                  │
                      │      │ cost_tracker     │ ← persistent
                      │      └──────────────────┘
                      │
                      │ (4) POST /v1/chat/completions
                      │     { model: "Gemini-Orchestrator+Gemma12B-OC" }
                      │
                      │ (5) Router → orchestrator pair
                      │     → routeThroughOrchestrator()
                      │       → tool_choice: 'required'
                      │       → injects delegate_subagent
                      │       → calls Gemini API
                      │
                      │ (6) Gemini calls delegate_subagent
                      │     → tool runs local subagent
                      │     → result returns to Gemini
                      │     → Gemini generates final response
                      │
                      │ (7) opencode receives response
                      │     → displays to user
                      │
                      │ (8) idle_timeout_ms without requests
                      │     → opencode kills child process
                      │     → SIGTERM → graceful shutdown
```

---

## 6. Required Changes Summary

| # | Change | Files | Priority |
|---|---|---|---|
| 1 | Parse `--config` JSON in madame-agent | `src/config/` | High |
| 2 | Merge external config + defaults (no .env) | `src/config/` | High |
| 3 | Timeouts per layer in tool-loop | `src/tools/tool-loop.service.ts` | High |
| 4 | Cost tracking + persistence | `src/observability/cost-tracker.service.ts` | Medium |
| 5 | Endpoint GET /v1/costs | `src/proxy/proxy.controller.ts` | Medium |
| 6 | Graceful shutdown (SIGTERM handler) | `src/main.ts` | Medium |
| 7 | opencode: MadameManager (child process) | opencode repo | High |
| 8 | opencode: idle timeout + auto-kill | opencode repo | Medium |

---

## 7. Real Configuration & Final Integration (Transparent Standalone Proxy Mode)

Because OpenCode is a separate project and not directly editable, the `madame-agent` server runs as a **Transparent Standalone Proxy** acting as an OpenAI API compatible endpoint.

### Step 1: Running Madame-Agent
The server runs independently on the port configured in the `.env` file (defaults to `3001`):
```bash
npm run start:dev
```

### Step 2: Provider Configuration in `opencode.json`
To integrate Madame-Agent, edit your OpenCode client's `opencode.json` configuration file to add `madame` as a custom provider of type `openai`:

```json
{
  "providers": {
    "madame": {
      "api_type": "openai",
      "api_base": "http://localhost:3001/v1",
      "api_key": "dummy-key-not-required",
      "models": [
        "madame-auto",
        "madame-local-only",
        "DeepseekV4Flash-Orchestrator+Gemma4-12B",
        "DeepseekV4Flash-Orchestrator+Gemma4-Deepseek-Hybrid",
        "Gemini-Orchestrator+Gemma12B-OC",
        "Gemini-Orchestrator+Gemma-Gemini-Hybrid"
      ]
    }
  }
}
```

### Step 3: Selecting Virtual Models in OpenCode
Once configured, OpenCode will obtain the available models dynamically via the `/v1/models` endpoint. The user can select any of the following virtual models in the chat UI:

1. **`madame-auto`**: Dynamically routes using the local auto-classifier (decides whether to delegate to the cloud or resolve locally based on complexity).
2. **`madame-local-only`**: Forces the request to be executed solely by local models configured in Ollama.
3. **Orchestrator Pairs** (e.g., `Gemini-Orchestrator+Gemma-Gemini-Hybrid`): Forces delegation using the cloud orchestrator and local subagent defined in `routing.yaml`.

### Step 4: Visualizing Costs and Token Savings
Since OpenCode is immutable and does not have a UI to show madame-agent statistics, cost and savings calculations are done centrally:
* **In the Console**: At the end of each call, the server console prints a detailed, synchronous table showing input (In) tokens, output (Out) tokens, cloud cost in USD, and estimated local savings.
* **Via API**: You can check accumulated cost health at any time using:
  ```bash
  curl http://localhost:3001/v1/costs
  ```
