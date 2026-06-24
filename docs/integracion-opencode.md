# Integración madame-agent → opencode

## 1. Configuración externa desde opencode.json

### Problema

Hoy toda la configuración vive en `routing.yaml` dentro del proyecto madame-agent. Para que opencode pueda usar madame-agent como backend de ejecución, la configuración debe venir DESDE opencode.json.

### Solución

opencode.json tendría una sección `madame` que se pasa completa a madame-agent como un blob JSON. Madame-agent mergea esa configuración con sus defaults internos.

```jsonc
// opencode.json
{
  "model": "gemma4:12b-mlx-oc",  // modelo default (local)

  "madame": {
    "enabled": false,  // opt-in, default false

    "orchestrator": {
      "provider": "google",
      "model": "models/gemini-3.1-flash-lite",
      "enabled": false,  // orquestador cloud opt-in
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
    // "auto"  → usa classifier para decidir local vs cloud
    // "local" → fuerza local siempre
    // "plan"  → siempre cloud (equivalente a plan mode actual)
    // "orchestrator" → usa orquestador cloud con subagente local

    "cost_tracking": {
      "enabled": true,
      "persist_path": "~/.opencode/costs.json"
    },

    "server": {
      "port": 3001,
      "start_on_demand": true,
      "idle_timeout_ms": 300000  // mata el server si está idle 5 min
    }
  }
}
```

### Mecanismo

1. opencode lee `opencode.json` → extrae `madame` section
2. opencode resuelve API keys desde `~/.local/share/opencode/auth.json`
3. Al lanzar madame-agent, pasa config + API keys como argumento y env vars:
   ```bash
   GOOGLE_GENERATIVE_AI_API_KEY=... node dist/main.js \
     --config '{"orchestrator":{"provider":"google",...}}'
   ```
4. Madame-agent recibe:
   - `--config` (configuración desde opencode.json)
   - `process.env.GOOGLE_GENERATIVE_AI_API_KEY` (API key inyectada por opencode)
5. **NUNCA** necesita `.env` — opencode maneja todo el ciclo de secrets

### API Keys: flujo auth.json

Las API keys NUNCA van en opencode.json ni en routing.yaml. opencode usa su propio sistema de credenciales.

Madame-agent puede usar modelos de **distintos proveedores** simultáneamente — cada uno con su propia API key:

| Proveedor | Env var (madame-agent) | auth.json key (opencode) |
|---|---|---|
| Google (Gemini) | `GOOGLE_GENERATIVE_AI_API_KEY` | `"madame_google"` |
| NVIDIA (Deepseek, Llama) | `NVIDIA_API_KEY` | `"madame_nvidia"` |
| OpenAI | `OPENAI_API_KEY` | `"madame_openai"` |
| Anthropic | `ANTHROPIC_API_KEY` | `"madame_anthropic"` |
| OpenRouter | `OPENROUTER_API_KEY` | `"madame_openrouter"` |

**Cada proveedor tiene su propia entrada en auth.json** y opencode las inyecta TODAS al lanzar madame-agent. Madame-agent usa la que necesita según el modelo que se esté usando en cada request.

```
~/.local/share/opencode/auth.json
{
  "madame_google":  { "type": "api", "key": "AIza..." },    // Gemini
  "madame_nvidia":  { "type": "api", "key": "nvapi-..." },  // Deepseek, Llama
  "madame_openai":  { "type": "api", "key": "sk-..." }      // si se configura
}
```

**Flujo:**

```
1. Usuario configura madame-agent en opencode.json
   → orchestrator.provider = "google"
   → también puede escalar a NVIDIA si el classifier lo decide

2. opencode ve qué proveedores cloud necesita madame-agent
   (según la config de orchestrator_pairs y providers)

3. Para CADA proveedor, opencode:
   ¿auth.json tiene "madame_{provider}"?
   ├── Sí → lee la key
   └── No  → pide la key al usuario por UI (como cualquier provider)
            → la guarda en auth.json como "madame_{provider}"

4. opencode lanza child process con TODAS las env vars:
   GOOGLE_GENERATIVE_AI_API_KEY=<key> \
   NVIDIA_API_KEY=<key> \
     node dist/main.js --config '...'

5. madame-agent usa process.env.GOOGLE_GENERATIVE_AI_API_KEY
   o process.env.NVIDIA_API_KEY según el modelo del request
```

**¿Qué pasa si falta una API key para un provider que se necesita?**

- opencode puede degradar gracefulmente: si no hay key para NVIDIA, no usa modelos NVIDIA
- O puede pedir la key en el momento justo (lazy prompt)
- La decisión es de opencode, no de madame-agent

Esto es exactamente como opencode maneja cualquier otro provider — el usuario da la key una vez por UI, opencode la persiste y la inyecta al proceso hijo. La diferencia es que madame-agent puede necesitar **varias** keys porque usa múltiples providers en un mismo flujo (orquestador Google + escalado NVIDIA, por ejemplo).

### Jerarquía de configuración (primero gana)

```
opencode.json  →  --config flag  →  auth.json (API keys)  →  defaults internos
                                               ↓
                                 inyectadas como env vars
                                 al child process
```

---

## 2. Timeouts por capa

### Problema

Hoy hay un solo `global_timeout_ms: 300000` en routing.yaml. El orquestador cloud (Gemini/Deepseek) y el subagente local (gemma4:12b-mlx-oc) tienen perfiles muy distintos:

| Capa | Rango típico | Nota |
|---|---|---|
| Orquestador cloud (Gemini) | 20-130s | Estable pero variable |
| Orquestador cloud (Deepseek) | 30-250s+ | Puede rate-limitar |
| Subagente local (carga) | 8-15s | Primera carga del modelo |
| Subagente local (ejecución) | 5-60s | Ejecución de herramientas |
| Self-fallback | 30-120s | El orquestador hace de sí mismo |

### Solución

Timeouts configurables por capa, desde `opencode.json` o inyectados como env vars por opencode:

```yaml
# routing.yaml — defaults
tools:
  orchestrator_timeout_ms: 300000   # tiempo para que el cloud model responda
  subagent_timeout_ms: 120000        # por intento de subagente
  subagent_total_timeout_ms: 300000  # suma de todos los intentos (failover)
  self_fallback_timeout_ms: 180000   # self-fallback cuando fallan todos
```

opencode los inyecta como env vars al child process (alternativa al JSON config):
```bash
MADAME_ORCHESTRATOR_TIMEOUT_MS=300000 \
MADAME_SUBAGENT_TIMEOUT_MS=120000 \
  node dist/main.js --config '...'
```

### Implementación

En `tool-loop.service.ts`:

```typescript
// En lugar de un solo global_timeout_ms:
const timeouts = {
  orchestrator: request.timeout_ms || config.tools.orchestrator_timeout_ms,
  subagent: config.tools.subagent_timeout_ms,
  selfFallback: config.tools.self_fallback_timeout_ms,
};

// routeThroughOrchestrator usa orchestrator timeout
// delegate_subagent usa subagent timeout (con failover sumando)
// self-fallback usa self_fallback timeout
```

El subagente **hereda el timeout por defecto** del `subagent_timeout_ms` pero puede overridearse si el orquestador pasa un argumento extra:

```json
{
  "task": "lista los archivos...",
  "subagent_model": "gemma4:12b-mlx-oc",
  "timeout_ms": 60000  // override opcional
}
```

---

## 3. Cost Tracking

### Problema

Cada request cloud tiene un costo real (Gemini, NVIDIA). Sin tracking, el usuario no sabe cuánto gasta. Esto es importante para el opt-in — si el usuario activa el orquestador cloud, debe poder ver cuánto consume.

### Solución

Persistir costos en un archivo JSON en `~/.opencode/costs.json`. Estructura:

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

### Precios de referencia

Estos son valores estimados que deberían ser configurables (o actualizables vía web):

| Provider | Modelo | Input (por 1K tokens) | Output (por 1K tokens) |
|---|---|---|---|
| Google Gemini | gemini-3.1-flash-lite | $0.0003 | $0.0006 |
| NVIDIA | deepseek-ai/deepseek-v4-flash | Gratis (rate-limited) | Gratis |
| NVIDIA | meta/llama-3.3-70b-instruct | $0.001 | $0.001 |

### Endpoint REST

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

Resetea la sesión actual. El archivo persistido mantiene el histórico.

---

## 4. Startup bajo demanda desde opencode

### Problema

Hoy el usuario debe iniciar `npx nest start` manualmente antes de usar opencode con madame-agent. Esto rompe el flujo — opencode debería manejar su propio lifecycle.

### Solución

opencode lanza madame-agent como **child process** bajo demanda, similar a cómo maneja MCPs.

### Ciclo de vida

```
1. opencode detecta que necesita madame-agent
   (porque el modo es "orchestrator" o el classifier decidió escalar)
   
2. opencode busca madame-agent:
   a. ¿Ya hay un proceso escuchando en :3001? → úsalo (reuse)
   b. Si no: lanza child process:
      node /path/to/madame-agent/dist/main.js \
        --config "$MADAME_CONFIG_JSON" \
        --port 3001
   
3. opencode espera a que el server responda 200 en /v1/health
   (polling cada 100ms, timeout 30s)
   
4. opencode usa el server para chat/completions

5. Cuando el server está idle por X tiempo → opencode lo mata
   (SIGTERM, graceful shutdown)
```

### Gestión de procesos

```typescript
// En opencode (hypothetical):
interface MadameManager {
  start(config: MadameConfig): Promise<ChildProcess>;
  stop(): Promise<void>;
  health(): Promise<boolean>;
  isRunning(): boolean;
  killOnIdle(idleMs: number): void;  // auto-kill after idle
}
```

### Señales

| Señal | Comportamiento |
|---|---|
| `SIGTERM` | Graceful shutdown: completa requests activas, mata subagentes, persiste costs |
| `SIGKILL` | Kill forzoso (solo si SIGTERM no responde en 5s) |
| `SIGHUP` | Recargar configuración sin reiniciar |

### Config desde opencode

```jsonc
// opencode.json
{
  "model": "gemma4:12b-mlx-oc",

  "madame": {
    "enabled": true,
    "server": {
      "path": "/opt/madame-agent",  // o relativo a opencode
      "port": 3001,
      "start_on_demand": true,
      "idle_timeout_ms": 300000
    },
    // ... resto de config
  }
}
```

---

## 5. Diagrama de flujo completo

```
opencode.json ──→ opencode
                     │
                     │ (1) Lee config madame
                     │ (2) Decide que necesita orquestador
                     │
                     ├── (3) ¿API key en auth.json?
                     │      ├── Sí → leer key
                     │      └── No  → pedir por UI → guardar en auth.json
                     │
                     ├── (4) ¿madame-agent corriendo?
                     │   ├── Sí → reusar
                     │   └── No  → lanzar child process con API key inyectada
                     │            │
                     │            │ (5) GOOGLE_GENERATIVE_AI_API_KEY=... \
                     │            │     node dist/main.js --config='{...}'
                     │            │
                     │            ▼
                     │      madame-agent (NestJS)
                     │      ┌──────────────────┐
                     │      │ tools:           │
                     │      │  delegate_       │ ← solo para orquestador
                     │      │  subagent        │
                     │      │                  │
                     │      │  read_file,      │ ← para subagente local
                     │      │  write_file...   │
                     │      │                  │
                     │      │ cost_tracker     │ ← persistente
                     │      └──────────────────┘
                     │
                     │ (4) POST /v1/chat/completions
                     │     { model: "Gemini-Orchestrator+Gemma12B-OC" }
                     │
                     │ (5) Router → orchestrator pair
                     │     → routeThroughOrchestrator()
                     │       → tool_choice: 'required'
                     │       → inyecta delegate_subagent
                     │       → llama a Gemini API
                     │
                     │ (6) Gemini llama delegate_subagent
                     │     → tool ejecuta subagente local
                     │     → resultado vuelve a Gemini
                     │     → Gemini genera respuesta final
                     │
                     │ (7) opencode recibe response
                     │     → muestra al usuario
                     │
                     │ (8) idle_timeout_ms sin requests
                     │     → opencode mata child process
                     │     → SIGTERM → graceful shutdown
```

---

## 6. Resumen de cambios necesarios

| # | Cambio | Archivos | Prioridad |
|---|---|---|---|
| 1 | Parser de `--config` JSON en madame-agent | `src/config/` | Alta |
| 2 | Merge external config + defaults (sin .env) | `src/config/` | Alta |
| 3 | Timeouts por capa en tool-loop | `src/tools/tool-loop.service.ts` | Alta |
| 4 | Cost tracking + persistencia | `src/observability/cost-tracker.service.ts` | Media |
| 5 | Endpoint GET /v1/costs | `src/proxy/proxy.controller.ts` | Media |
| 6 | Graceful shutdown (SIGTERM handler) | `src/main.ts` | Media |
| 7 | opencode: MadameManager (child process) | opencode repo | Alta |
| 8 | opencode: idle timeout + auto-kill | opencode repo | Media |

---

## 7. Configuración Real e Integración Final (Modo Proxy Transparente Standalone)

Debido a que OpenCode es un proyecto independiente y no es modificable directamente, el servidor de `madame-agent` se ejecuta como un **Proxy Transparente Standalone** que actúa como un endpoint compatible con la API de OpenAI.

### Paso 1: Levantar Madame-Agent
El servidor corre de manera independiente en el puerto configurado en el archivo `.env` (por defecto `3001`):
```bash
npm run start:dev
```

### Paso 2: Configuración del proveedor en `opencode.json`
Para integrar Madame-Agent, edita el archivo de configuración `opencode.json` de tu cliente de OpenCode para agregar `madame` como un proveedor personalizado del tipo `openai`:

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

### Paso 3: Selección de Modelos Virtuales en OpenCode
Una vez configurado, OpenCode obtendrá los modelos disponibles dinámicamente mediante el endpoint `/v1/models`. El usuario podrá seleccionar en la interfaz de chat cualquiera de los siguientes modelos virtuales:

1. **`madame-auto`**: Enruta dinámicamente usando el clasificador automático local (decide si delegar a la nube o resolver localmente según la complejidad).
2. **`madame-local-only`**: Fuerza que la petición sea ejecutada únicamente por los modelos locales configurados en Ollama.
3. **Pares Orquestadores** (ej. `Gemini-Orchestrator+Gemma-Gemini-Hybrid`): Fuerza la delegación usando el par orquestador en nube y subagente local definidos en `routing.yaml`.

### Paso 4: Visualización de Costes y Ahorros de Tokens
Dado que OpenCode es inmutable y no tiene interfaz para mostrar estadísticas de madame-agent, el cálculo de costes y ahorros se realiza de forma centralizada:
* **Por Consola**: Al finalizar cada llamada, la consola del servidor imprime un cuadro detallado y síncrono con el desglose de tokens de entrada (In), salida (Out), coste cloud en USD y ahorro estimado en local.
* **Vía API**: Se puede consultar la salud de los costes acumulados en cualquier momento mediante:
  ```bash
  curl http://localhost:3001/v1/costs
  ```

