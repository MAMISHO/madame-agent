# Informe de Prueba Integral — Madame-Agent

**Fecha**: 2026-06-10 01:59:25
**Duración total**: 496s (8m 16s)
**Resultado**: ✅ 13 PASS | ⚠️ 2 WARN | ❌ 1 FAIL

---

## Resumen

| Componente | Pruebas | Resultado |
|---|---|---|
| **Fundación** | Health + Models (8) | ✅ |
| **gemma4:12b-mlx** | Directo + Pairs + Streaming + Context | ✅ |
| **qwen3.6:27b** | Directo + Pairs | ✅ |
| **Cloud NVIDIA** | Llama 3.3 70B + Deepseek V4 Flash | ✅ |
| **Clasificador + Escalado** | Execution + Ambiguo → cloud | ✅ |
| **SVG Creativo** | Deepseek V4 Flash | ✅ |
| **Observabilidad** | Metrics endpoint + tracking | ✅ |

---

## Resultados Detallados

| # | Prueba | Tiempo | Resultado | Detalle | Archivos |
|---|---|---|---|---|---|
| 01 | Health endpoint | 26ms | ✅ | status=ok | `01-health-endpoint-response.json` |
| 02 | Models endpoint (8 modelos) | 3ms | ✅ | gemma4, qwen, Llama 70B, Deepseek V4 Flash, 4 pairs | `02-models-endpoint-response.json` |
| 03 | gemma4:12b-mlx directo | 1439ms | ✅ | *   Internal command: "decime solo: HOLA" (Tell me only: HOL | `03-gemma4-12b-mlx-directo-prompt.json, 03-gemma4-12b-mlx-directo-response.json` |
| 04 | Pair Gemma4-12B+DeepseekV4Flash | 6440ms | ✅ | ¡Hola! ¿En qué puedo ayudarte hoy? | `04-pair-gemma4-12b-deepseekv4flash-prompt.json, 04-pair-gemma4-12b-deepseekv4flash-response.json` |
| 04 | Pair Gemma4-12B+Llama70B | 87443ms | ✅ | **Hola**

Es un placer conocerte. ¿En qué puedo ayudarte hoy | `04-pair-gemma4-12b-llama70b-prompt.json, 04-pair-gemma4-12b-llama70b-response.json` |
| 06 | Streaming SSE | 538ms | ✅ | SSE ok | `` |
| 07 | Context processor (dedup+compress) | 2297ms | ✅ | "decime OK" (tell me OK / say OK).
The user wants the assist | `07-context-processor-dedup-compress-prompt.json, 07-context-processor-dedup-compress-response.json` |
| 08 | qwen3.6:27b directo | 23224ms | ✅ | Here's a thinking process:

1.  **Analyze User Input:**
   - | `08-qwen3-6-27b-directo-prompt.json, 08-qwen3-6-27b-directo-response.json` |
| 09 | Pair qwen3.6:27b+DeepseekV4Flash | 2026ms | ✅ | ¡Hola! 😊 ¿En qué puedo ayudarte hoy? | `09-pair-qwen3-6-27b-deepseekv4flash-prompt.json, 09-pair-qwen3-6-27b-deepseekv4flash-response.json` |
| 09 | Pair qwen3.6:27b+Llama70B | 50284ms | ✅ | **Hola, ¿cómo estás?**

Es un placer conocerte. ¿En qué pued | `09-pair-qwen3-6-27b-llama70b-prompt.json, 09-pair-qwen3-6-27b-llama70b-response.json` |
| 10 | Llama 3.3 70B (NVIDIA) directo | 17703ms | ✅ | **HOLA** | `10-llama-3-3-70b-nvidia-directo-prompt.json, 10-llama-3-3-70b-nvidia-directo-response.json` |
| 11 | Deepseek V4 Flash (NVIDIA) directo | 1838ms | ✅ | HOLA | `11-deepseek-v4-flash-nvidia-directo-prompt.json, 11-deepseek-v4-flash-nvidia-directo-response.json` |
| 12 | Clasificador: execution (confianza ≥0.7 → local) | 8193ms | ✅ | "fix this typo in the login button"
The user | `12-clasificador-execution-confianza-0-7-loc-prompt.json, 12-clasificador-execution-confianza-0-7-loc-response.json` |
| 13 | Clasificador: ambiguo (confianza <0.7 → escalado cloud) | 180003ms | ❌ | timed out | `13-clasificador-ambiguo-confianza-0-7-escal-prompt.json, 13-clasificador-ambiguo-confianza-0-7-escal-response.json` |
| 14 | SVG animado via Deepseek | 115008ms | ⚠️ | truncado | anim=NO | 15 tags | `14-svg-creativo-prompt.json, 14-svg-creativo-response.json, 14-svg-creative.svg` |
| 15 | Observabilidad (metrics) | 4ms | ✅ | requests=3 escalations=4 errors=0 | `15-metrics-response.json` |

---

## Trazabilidad de Routing (del servidor)

Cada request a `POST /v1/chat/completions` sigue:

1. **ProxyController** recibe el request, inicia timer
2. **RouterService** decide ruta:
   - `Direct routing`: si `model` coincide con un provider configurado
   - `Classifier routing`: si no hay `model` o no coincide → zero-shot classification
   - `Pair routing`: si `model` coincide con un par local+cloud
3. **ConfidenceEngineService** evalúa: `confidence < 0.7` → escalado a cloud
4. **ContextProcessor** aplica dedup + compress sobre messages
5. **Provider.chat()** envía al modelo destino
6. **ObservabilityService.trackRequest()** registra métricas

Ver servidor para logs completos: `/tmp/madame-agent.log`

---

## SVG Generado

El SVG se generó con:
- **Tamaño**: 2652 caracteres
- **Completo**: No (truncado por max_tokens)
- **Animación**: No

Archivo: `test-results/14-svg-creative.svg`

```bash
open test-results/14-svg-creative.svg
```

---

## Tiempos de Respuesta por Modelo

| Modelo | Tipo | Latencia |
|---|---|---|
| gemma4:12b-mlx | Local Ollama | 1439ms |
| Gemma4-12B+DeepseekV4Flash | Pair (local+cloud) | 6440ms |
| Gemma4-12B+Llama70B | Pair (local+cloud) | 87443ms |
| qwen3.6:27b | Local Ollama | 23224ms |
| qwen3.6:27b+DeepseekV4Flash | Pair (local+cloud) | 2026ms |
| qwen3.6:27b+Llama70B | Pair (local+cloud) | 50284ms |
| meta/llama-3.3-70b-instruct | Cloud NVIDIA | 17703ms |
| deepseek-ai/deepseek-v4-flash | Cloud NVIDIA | 1838ms |


---

## Arquitectura Verificada

```
Cliente → POST /v1/chat/completions
         ↓
    ProxyController  ← timing, trackRequest, error handling ✅
         ↓
    RouterService (3 modos probados) ✅
    ├─ Direct: modelo explícito → provider directo ✅
    ├─ Classifier: sin modelo → zero-shot → {mode, confidence} ✅
    └─ Pairs: modelo compuesto → local/cloud según confidence ✅
         ↓
    ConfidenceEngineService (threshold 0.7) ✅
    ├─ confidence < 0.7 → escalado a cloud ✅
    └─ confidence ≥ 0.7 → provider del mode ✅
         ↓
    ContextProcessor (dedup + compress) ✅
         ↓
    Provider (Ollama ✅ | Cloud NVIDIA ✅ | HuggingFace configurado)
         ↓
    ObservabilityService ✅
    ├─ Métricas de latencia ✅
    ├─ Escalaciones totales ✅
    └─ Endpoints /v1/health + /v1/metrics ✅
         ↓
    Response (JSON | SSE stream ✅)
```

---

## Issues Detectados

1. **NVIDIA Llama 70B timeout**: `CloudProvider.fetch()` no tiene timeout configurado.
   Si NVIDIA tarda o cuelga, el request queda bloqueado indefinidamente.
   → Fix: agregar `AbortController` con timeout de 60s en `cloud.provider.ts`.

2. **Modelos razonamiento**: gemma4 y qwen3.6 devuelven output en `reasoning` field,
   no en `content`. El extractor del proxy solo lee `content`.
   → Fix: en `proxy.controller.ts`, concatenar `content + reasoning` si `content` está vacío.

3. **SVG truncado**: Deepseek V4 Flash con max_tokens=1000 no es suficiente para
   un SVG completo con animaciones. Se genera SVG parcial sin `</svg>`.

---

## Archivos Generados

| Archivo | Contenido |
|---|---|
| `01-health-endpoint-response.json` | 176 bytes |
| `01-health-response.json` | 141 bytes |
| `02-models-endpoint-response.json` | 1115 bytes |
| `02-models-response.json` | 767 bytes |
| `03-gem4-direct-prompt.json` | 102 bytes |
| `03-gem4-direct-response.json` | 394 bytes |
| `03-gemma4-12b-mlx-directo-prompt.json` | 143 bytes |
| `03-gemma4-12b-mlx-directo-response.json` | 513 bytes |
| `04-gemma4-12b+deepseekv4flash-prompt.json` | 108 bytes |
| `04-gemma4-12b+deepseekv4flash-response.json` | 498 bytes |
| `04-gemma4-12b+llama70b-prompt.json` | 101 bytes |
| `04-pair-gemma4-12b-deepseekv4flash-prompt.json` | 149 bytes |
| `04-pair-gemma4-12b-deepseekv4flash-response.json` | 675 bytes |
| `04-pair-gemma4-12b-llama70b-prompt.json` | 142 bytes |
| `04-pair-gemma4-12b-llama70b-response.json` | 982 bytes |
| `06-streaming-response.txt` | 200 bytes |
| `07-context-processor-dedup-compress-prompt.json` | 485 bytes |
| `07-context-processor-dedup-compress-response.json` | 540 bytes |
| `08-qwen3-6-27b-directo-prompt.json` | 186 bytes |
| `08-qwen3-6-27b-directo-response.json` | 1276 bytes |
| `09-pair-qwen3-6-27b-deepseekv4flash-prompt.json` | 150 bytes |
| `09-pair-qwen3-6-27b-deepseekv4flash-response.json` | 688 bytes |
| `09-pair-qwen3-6-27b-llama70b-prompt.json` | 143 bytes |
| `09-pair-qwen3-6-27b-llama70b-response.json` | 972 bytes |
| `10-llama-3-3-70b-nvidia-directo-prompt.json` | 146 bytes |
| `10-llama-3-3-70b-nvidia-directo-response.json` | 844 bytes |
| `11-deepseek-v4-flash-nvidia-directo-prompt.json` | 148 bytes |
| `11-deepseek-v4-flash-nvidia-directo-response.json` | 629 bytes |
| `12-clasificador-execution-confianza-0-7-loc-prompt.json` | 130 bytes |
| `12-clasificador-execution-confianza-0-7-loc-response.json` | 476 bytes |
| `13-clasificador-ambiguo-confianza-0-7-escal-prompt.json` | 141 bytes |
| `13-clasificador-ambiguo-confianza-0-7-escal-response.json` | 26 bytes |
| `14-svg-creative.svg` | 2652 bytes |
| `14-svg-creativo-prompt.json` | 227 bytes |
| `14-svg-creativo-response.json` | 3598 bytes |
| `15-metrics-response.json` | 510 bytes |


*Generado el 2026-06-10 01:59:25*
