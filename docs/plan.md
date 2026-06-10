# Madame-Agent — Plan de Implementación

## Objetivo

Orquestador de LLMs como capa intermedia entre herramientas de desarrollo (OpenCode, IDEs, agentes, CLI)
y múltiples proveedores de modelos. Reduce coste cloud, optimiza tokens, permite uso híbrido local+cloud.

Stack: **NestJS + TypeScript**

## Estado Actual del Proyecto (Junio 2026)

| Componente | Estado | Detalle |
|---|---|---|
| P0: Repo Setup | ✅ COMPLETO | .gitignore, git rm cached de node_modules/dist/.atl |
| F1: OpenAI Proxy | ✅ COMPLETO | POST /v1/chat/completions + GET /v1/models |
| F2: Provider Abstraction | ✅ COMPLETO | Interface + Ollama, Cloud, HuggingFace |
| F3: Router | ✅ COMPLETO | Routing directo + clasificador + confidence + escalado |
| F4: Context Processor | ✅ COMPLETO | Dedup + Compress, integrado en Router |
| F5: Task Classifier | ✅ COMPLETO | transformers.js zero-shot, devuelve {mode, confidence} |
| F6: Confidence Engine | ✅ COMPLETO | ConfidenceEngineService con threshold configurable |
| F7: Escalation System | ✅ COMPLETO | Routing a escalation provider si confidence < threshold |
| F8: Semantic Cache | ⬜ PENDIENTE | |
| F9: Translation Layer | ⬜ PENDIENTE | |
| F10: Observability | ✅ COMPLETO | Métricas, health, logs por request |
| F11: Tool Calling | ⬜ PENDIENTE | |
| Tests unitarios | ✅ COMPLETO | 42 tests, 7 suites |
| Observability trackRequest | ✅ COMPLETO | RouterService devuelve RouteResult con metadata, ProxyController llama trackRequest() |
| Conexión OpenCode | ✅ COMPLETO | Provider `madame-agent` configurado en opencode.json como OpenAI-compatible |
| Conexión NVIDIA | ✅ COMPLETO | `NVIDIA_API_KEY` en env, routing.yaml apunta a NVIDIA |

---

## Prioridades de Implementación

### PRIORIDAD 0 — Configuración del Repositorio ✅

| # | Tarea | Estado |
|---|---|---|
| 0.1 | Crear .gitignore para NestJS/TypeScript | ✅ |
| 0.2 | Sacar node_modules, dist, .atl del índice git | ✅ |

### PRIORIDAD 1 — Fundamentos de Routing y Configuración ✅

| # | Tarea | Estado |
|---|---|---|
| 1.1 | routing.yaml sincronizado con OpenCode | ✅ (NVIDIA + gemma4) |
| 1.2 | API key NVIDIA desde env | ✅ (NVIDIA_API_KEY) |
| 1.3 | Modelo local desde routing.yaml | ✅ (gemma4:12b-mlx) |
| 1.4 | Tests unitarios del RouterService | ✅ (9 tests) |

### PRIORIDAD 2 — Confidence Engine + Escalation System ✅

| # | Tarea | Estado |
|---|---|---|
| 2.1 | ClassifierService devuelve {mode, confidence} | ✅ |
| 2.2 | ConfidenceEngineService creado | ✅ |
| 2.3 | Integración con RouterService | ✅ |
| 2.4 | Tests de confidence y escalado | ✅ (8 tests) |

### PRIORIDAD 3 — Context Processor (Compresión) ✅

| # | Tarea | Estado |
|---|---|---|
| 3.1 | DeduplicatorService | ✅ |
| 3.2 | CompressorService (truncación determinista) | ✅ |
| 3.3 | Integración en RouterService | ✅ |
| 3.4 | Tests: 3 suites, 18 tests | ✅ |
| 3.5 | Documento técnico docs/context-processor.md | ✅ |

### PRIORIDAD 4 — Observabilidad ✅

| # | Tarea | Estado |
|---|---|---|
| 4.1 | ObservabilityService: métricas, timing, tracking | ✅ |
| 4.2 | Logs estructurados por request | ✅ |
| 4.3 | Endpoints GET /v1/health + GET /v1/metrics | ✅ |
| 4.4 | Integración en ProxyController | ✅ |
| 4.5 | Tests (7) | ✅ |
| 4.6 | Documento técnico docs/observability.md | ✅ |

### PRIORIDAD 5 — Conexión y Verificación con OpenCode ✅

| # | Tarea | Estado | Detalle |
|---|---|---|---|
| 5.1 | Configurar OpenCode para apuntar a Madame | ✅ | `madame-agent` provider en opencode.json con `@ai-sdk/openai-compatible`, baseURL `localhost:3000/v1`, modelos gemma4 + llama-3.3-70b |
| 5.2 | Verificar streaming en OpenCode | ✅ | SSE streaming funcional a través del proxy (verificado con curl) |
| 5.3 | Verificar routing automático | ✅ | Routing directo (modelo explícito → provider directo) + clasificador (sin modelo → classifier → local/cloud según confidence) |
| 5.4 | Prueba de escalado | ✅ | Ambiguous query "what do you think about react" → confidence 0.503 < 0.7 → escalation a NVIDIA Llama 3.3 70B |
| 5.5 | Fix: Observability trackRequest | ✅ | RouterService ahora devuelve RouteResult con metadata de routing; ProxyController llama trackRequest() con datos reales |
| 5.6 | Tests actualizados | ✅ | 10 tests de RouterService (antes 9), todos pasan; 42 totales |

### PRIORIDAD 6 — Funcionalidades Avanzadas ⬜

| # | Tarea | Archivos | Dependencias | Detalle |
|---|---|---|---|---|
| 6.1 | Semantic Cache | `src/cache/` (nuevo) | 1.x | Cache de respuestas vía embeddings + vector store. Requests similares devuelven respuesta cacheada sin llamar al LLM. Reduce latencia y coste cloud. |
| 6.2 | Translation Layer | `src/translation/` (nuevo) | 1.x, 3.x | Detección y traducción automática de input no inglés antes de enviar al modelo. Usa modelo pequeño local para traducción. |
| 6.3 | Tool Calling | `src/proxy/`, providers | 1.x | Passthrough de function calling / tool calling desde el cliente al modelo. Soporte para MCP tools. |
| 6.4 | Tests E2E completos | `test/` | 1.x-6.3 | Tests de integración reales contra Ollama + NVIDIA, validando todos los flujos de routing. |

### PRIORIDAD 7 — Mejoras de Observabilidad (Post-MVP) ⬜

La observabilidad actual es funcional pero mínima: métricas in-memory con buffer circular de 1000 requests, expuestas vía REST. Para producción se necesitan estas mejoras:

| # | Tarea | Descripción | Alternativas |
|---|---|---|---|
| 7.1 | Persistencia a DB | Reemplazar buffer circular por SQLite/PostgreSQL. Métricas sobreviven a reinicios. Permite consultas históricas. | SQLite (embebido, sin infra), PostgreSQL (escalable, requiere conexión) |
| 7.2 | Dashboard web UI | Interfaz web para ver métricas en tiempo real: gráficos de latencia, tasa de escalación, tokens ahorrados por contexto, errores por provider. | Grafana + Prometheus (estándar industria), o dashboard custom liviano con Chart.js |
| 7.3 | Logs estructurados a archivo | Reemplazar `console.log` con logger estructurado (pino, winston) que escriba a archivo rotativo con JSON lines. Facilita grep y análisis posterior. | pino (más rápido), winston (más ecosistema) |
| 7.4 | Export a sistema externo | Enviar métricas a Datadog, New Relic, o Prometheus para correlacionar con otras señales del sistema. | OpenTelemetry SDK (vendor-neutral), export directo vía API de cada plataforma |
| 7.5 | Alertas | Notificaciones cuando: tasa de error > umbral, latencia p99 > umbral, escalaciones frecuentes (posible degradación local). | Slack webhook, email, PagerDuty |
| 7.6 | Trazado distribuido | Correlacionar requests a través del proxy con spans individuales (classifier → context → provider). Útil para identificar cuellos de botella. | OpenTelemetry tracing |

---

## Arquitectura Actual

```
OpenCode / Client
    ↓
POST /v1/chat/completions  ← ProxyController
    ↓
ProxyService
    ↓
RouterService
    ├─ Direct routing (model name match → provider directo)
    │      ↓
    │   ContextProcessor (dedup + compress)
    │      ↓
    │   Provider.chat()
    │
    └─ Classifier routing (sin modelo o modelo no encontrado)
           ↓
    ClassifierService  (transformers.js - mobilebert)
     → { mode: 'plan'|'execution', confidence: 0.xx }
           ↓
    ConfidenceEngineService  (threshold: 0.7)
     → ¿Escalar? → escalation provider
           ↓
    ContextProcessor  (dedup + compress)
           ↓
    ProvidersService
        ├─ OllamaProvider  → gemma4:12b-mlx (local)
        ├─ CloudProvider   → NVIDIA / OpenAI / Anthropic
        └─ HuggingFaceProvider
    ↓
Response (stream SSE | json)
```

### Flujo de Escalamiento

```
Execution request (confidence 0.45 < 0.7)
         ↓
    Escalation: cloud_nvidia
         ↓
    ContextProcessor: dedup + compress
         ↓
    Se usa modelo cloud en lugar de local
```

## Configuración Actual (routing.yaml)

```yaml
providers:
  local_small:
    type: ollama
    model: gemma4:12b-mlx
    base_url: http://localhost:11434
  local_medium:
    type: ollama
    model: gemma4:12b-mlx
    base_url: http://localhost:11434
  cloud_nvidia:
    type: cloud
    provider: nvidia
    model: meta/llama-3.3-70b-instruct
    api_key_env: NVIDIA_API_KEY
  cloud_openai:
    type: cloud
    provider: openai
    model: gpt-4o
  cloud_hf:
    type: huggingface
    model: meta-llama/Meta-Llama-3-8B-Instruct

routing:
  plan:
    provider: cloud_nvidia
  execution:
    provider: local_medium
  escalation:
    provider: cloud_nvidia

confidence:
  threshold: 0.70
```

---

## Definición de Éxito

- [x] Repo limpio: .gitignore, sin node_modules/dist/.atl trackeados
- [x] Tests unitarios: 42 tests, 7 suites, todos pasan
- [x] Context Processor: deduplicación + compresión implementados
- [x] Confidence Engine + Escalation: threshold 0.7, escalado a cloud
- [x] Observabilidad: health, metrics, timing por request
- [x] Documentación técnica: docs/confidence-engine.md, docs/context-processor.md, docs/observability.md
- [x] OpenCode configurado como provider `madame-agent` apuntando a `http://localhost:3000/v1`
- [x] Routing automático redirige a local para execution (confidence >= 0.7), cloud para plan / escalado
- [x] Escalamiento funciona: confidence baja (< 0.7) → cloud (NVIDIA Llama 3.3 70B)
- [x] Tests de integración (curl) pasan: health, models, chat completions (non-stream + stream), escalado
- [x] Observability trackRequest integrado: métricas por request con metadata de routing
- [ ] Reducción de llamadas cloud visibles en logs