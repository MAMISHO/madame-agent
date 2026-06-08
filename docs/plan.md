# Madame-Agent — Plan de Implementación

## Objetivo

Orquestador de LLMs como capa intermedia entre herramientas de desarrollo (OpenCode, IDEs, agentes, CLI)
y múltiples proveedores de modelos. Reduce coste cloud, optimiza tokens, permite uso híbrido local+cloud.

Stack: **NestJS + TypeScript**

## Estado Actual del Proyecto (Junio 2026)

| Componente | Estado | Detalle |
|---|---|---|
| F1: OpenAI Proxy | ✅ COMPLETO | POST /v1/chat/completions + GET /v1/models |
| F2: Provider Abstraction | ✅ COMPLETO | Interface + Ollama, Cloud, HuggingFace |
| F3: Router | ✅ COMPLETO | Routing directo por modelo + automático vía clasificador |
| F4: Context Processor | ⬜ PENDIENTE | |
| F5: Task Classifier | ✅ COMPLETO | transformers.js zero-shot classification |
| F6: Confidence Engine | ⬜ PENDIENTE | |
| F7: Escalation System | ⬜ PENDIENTE | |
| F8: Semantic Cache | ⬜ PENDIENTE | |
| F9: Translation Layer | ⬜ PENDIENTE | |
| F10: Observability | ⬜ PENDIENTE | |
| F11: Tool Calling | ⬜ PENDIENTE | |
| Config & Tests | ⬜ PENDIENTE | routing.yaml listo, tests base pendientes |
| Conexión OpenCode | ⬜ PENDIENTE | |
| Conexión NVIDIA | ⬜ PENDIENTE | |

---

## Prioridades de Implementación

### PRIORIDAD 1 — Fundamentos de Routing y Configuración

Lo más simple, lo que desbloquea todo lo demás.

| # | Tarea | Archivos | Dependencias |
|---|---|---|---|
| 1.1 | Actualizar `routing.yaml` con config de OpenCode | `routing.yaml` | — |
| 1.2 | Leer config de NVIDIA desde OpenCode | `src/config/configuration.ts` | 1.1 |
| 1.3 | Leer config de modelo local desde OpenCode | `src/config/configuration.ts` | 1.1 |
| 1.4 | Tests unitarios del RouterService | `src/router/router.service.spec.ts` | 1.1-1.3 |

### PRIORIDAD 2 — Confidence Engine + Escalation System

Clasificador + threshold routing. Ya tenemos clasificador, falta la lógica de escalado.

| # | Tarea | Archivos | Dependencias |
|---|---|---|---|
| 2.1 | Ampliar clasificador a más categorías | `src/classifier/classifier.service.ts` | — |
| 2.2 | Crear ConfidenceEngineService | `src/confidence/` (nuevo) | 2.1 |
| 2.3 | Integrar escalamiento en Router | `src/router/router.service.ts` | 2.2 |
| 2.4 | Tests de confidence y escalado | `src/confidence/` | 2.1-2.3 |

### PRIORIDAD 3 — Context Processor (Compresión)

Reducir tokens antes de enviar a modelos.

| # | Tarea | Archivos | Dependencias |
|---|---|---|---|
| 3.1 | Deduplicación de mensajes/logs | `src/context/` (nuevo) | — |
| 3.2 | Compresión con modelo local | `src/context/` | — |
| 3.3 | Integrar en Router | `src/router/router.service.ts` | 3.1-3.2 |
| 3.4 | Tests de compresión | `src/context/` | 3.1-3.3 |

### PRIORIDAD 4 — Observabilidad

Métricas y logs para entender qué pasa.

| # | Tarea | Archivos | Dependencias |
|---|---|---|---|
| 4.1 | Métricas de tokens, proveedores, latencia | `src/observability/` (nuevo) | 1.x |
| 4.2 | Logs estructurados por request | `src/observability/` | 4.1 |
| 4.3 | Endpoint de health + metrics | `src/proxy/proxy.controller.ts` | 4.1-4.2 |

### PRIORIDAD 5 — Conexión y Verificación con OpenCode

Probar que todo funciona en el mundo real.

| # | Tarea | Archivos | Dependencias |
|---|---|---|---|
| 5.1 | Configurar OpenCode para apuntar a Madame | Config OpenCode | 1.x |
| 5.2 | Verificar streaming en OpenCode | — | 5.1 |
| 5.3 | Verificar routing automático | — | 5.1, 2.x |
| 5.4 | Prueba de escalado (local falla → cloud) | — | 2.x, 5.1 |

### PRIORIDAD 6 — Funcionalidades Avanzadas

Para cuando lo básico funcione sólido.

| # | Tarea | Archivos | Dependencias |
|---|---|---|---|
| 6.1 | Semantic Cache (embeddings + vector store) | `src/cache/` (nuevo) | 1.x |
| 6.2 | Translation Layer (input no inglés → traducir) | `src/translation/` (nuevo) | 1.x, 3.x |
| 6.3 | Tool Calling (MCP passthrough, function calling) | `src/proxy/`, providers | 1.x |
| 6.4 | Tests E2E completos | `test/` | 1.x-6.3 |

---

## Arquitectura Actual

```
OpenCode
    ↓
POST /v1/chat/completions  ← ProxyController
    ↓
ProxyService
    ↓
RouterService
    ├─ Direct routing (by model name)
    └─ Classifier routing
           ↓
    ClassifierService  (transformers.js - mobilebert)
           ↓
    ProvidersService
        ├─ OllamaProvider  → gemma4:12b-mlx (local)
        ├─ CloudProvider   → NVIDIA / OpenAI / Anthropic
        └─ HuggingFaceProvider
    ↓
Response (stream | json)
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

- [ ] OpenCode funciona sin modificaciones apuntando a `http://localhost:3000/v1`
- [ ] Routing automático redirige a local para execution, cloud para plan
- [ ] Escalamiento funciona: local falla → cloud
- [ ] Clasificador detecta tareas con confianza > 0.7
- [ ] Tests unitarios pasan
- [ ] Tests de integración (curl) pasan
- [ ] Reducción de llamadas cloud visibles en logs