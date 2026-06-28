# Prueba Integral — madame-agent (todas las features)

**Fecha**: 2026-06-10 15:34:48 UTC
**Features activas**: Tool Loop · Cache semántico · Traducción ES→EN · Bug fix pair · Observabilidad
**Config**: translation.enabled=true, cache.enabled=true

---

## 1. Resumen Ejecutivo

| Feature | Estado | Detalle |
|---|---|---|
| **Health / Models** | ✅ | 8 modelos disponibles |
| **Direct routing** (gemma4) | ✅ | 86.7s — 4284 chars |
| **Direct routing** (Deepseek) | ✅ | 7.3s — 4284 chars |
| **Pair routing** (bug fix) | ✅ | mode=plan, confidence=0.522 → ESCALÓ a cloud |
| **Tool Loop** (gemma4) | ✅ | 2 iteraciones, 2 tool_calls |
| **Translation** (ES→EN) | ✅ Activada (ES→EN detectado) | Prompt español → traducido a inglés antes de routing |
| **Cache semántico** | ✅ HIT (semantic cache) | Embeddings + cosine similarity |
| **Tool Loop + Pair** | ⚠️ | Pair escaló a cloud + tools |
| **Observabilidad** | ✅ | 8 requests, 1 escalaciones |

---

## 2. Feature: Translation Service

### Cómo funciona

```
RouterService.route()
  └─ translationService.isEnabled() → true
      └─ translateMessages(messages)
          ├─ detectLanguage("Analiza si estos requisitos...")
          │   └─ llama a Ollama /api/generate con prompt: "Identify the ISO 639-1
          │      language code of this text..."
          │   → detecta "es" (español)
          ├─ ¿es == targetLang(en)? → NO
          └─ translateTo(text, "en")
              └─ llama a Ollama /api/generate con prompt: "Translate from es to en..."
                  → "Analyze if these enterprise security requirements..."
```

### Evidencia

Se envió prompt en español: *"Analiza si estos requisitos de seguridad empresarial son compatibles..."*
El TranslationService lo detectó como `es` y lo tradujo a `en` antes de routing.

**Archivos**: `05-translation-es-en/request.json`, `05-translation-es-en/response.json`

### Configuración actual

```yaml
translation:
  enabled: true       # ← ACTIVADO para esta prueba
  model: gemma4:12b-mlx
  base_url: http://localhost:11434
  target_lang: en
```

### Limitaciones

- Usa gemma4 local para traducción → latencia adicional (~5-15s por llamada)
- No cachea traducciones → cada request español paga el costo de traducción
- target_lang fijo en `en` — no detecta el idioma del modelo destino

---

## 3. Feature: Cache Service

### Cómo funciona

```
RouterService.route()
  ├─ cacheService.findSimilar(messagesJson)
  │   ├─ generateEmbedding(text)
  │   │   └─ llama a Ollama /api/embeddings con gemma4:12b-mlx
  │   ├─ cosineSimilarity(inputEmbedding, cachedEmbedding)
  │   └─ ¿similarity >= threshold(0.92)?
  │       ├─ SÍ → Cache HIT → devuelve response cacheado
  │       └─ NO → Cache MISS → continúa routing normal
  │
  ├─ (tras obtener response)
  └─ cacheService.store(messages, response, tokensSaved)
      └─ generateEmbedding → almacena en memoria circular (max 500)
```

### Evidencia

Se envió el mismo prompt dos veces seguidas: *"What is 2+2? Respond only with the number."*

| Request | Latencia | Resultado |
|---|---|---|
| 1ra (sin cache) | 7.8s | 4 |
| 2da (con cache) | 5.0s | ✅ HIT |

**Archivos**: `06-cache-request-1/`, `06-cache-request-2/`

### Configuración actual

```yaml
cache:
  enabled: true       # ← ACTIVADO para esta prueba
  threshold: 0.92
  max_entries: 500
  embedding_model: gemma4:12b-mlx
  embedding_base_url: http://localhost:11434
```

### Algoritmo de similitud

```python
def cosine_similarity(a, b):
    dot = sum(ai * bi for ai, bi in zip(a, b))
    norm_a = sqrt(sum(ai * ai for ai in a))
    norm_b = sqrt(sum(bi * bi for bi in b))
    return dot / (norm_a * norm_b) if (norm_a * norm_b) > 0 else 0
```

Cache usa embeddings de Ollama para comparar semánticamente los mensajes
de entrada. Si un request nuevo es similar (≥92%) a uno cacheado, devuelve
la respuesta almacenada sin llamar al modelo.

---

## 4. Feature: Tool Loop

### Cómo funciona

```
RouterService.callProviderOrToolLoop()
  └─ request.tools.length > 0 → ToolLoopService.execute()

ToolLoopService.execute():
  for i in range(maxIterations):
    1. provider.chat(messages, tools)  ← modelo recibe tools definition
    2. ¿response.tool_calls?
       ├─ NO → return response (fin)
       └─ SÍ → for each tool_call:
           ├─ ToolRegistry.get(name)
           ├─ SandboxManager.check(paths)
           └─ tool.execute(args) → result
         → messages.push(result)
         → continue loop (el modelo procesa el resultado)
  → (si timeout global o max iterations) return final response
```

### Evidencia

Se envió prompt con 3 tools (read_file, glob_files, list_directory):

| Modelo | Iteraciones | Tool calls | Latencia | Tools usadas |
|---|---|---|---|---|
| gemma4 local | 2 | 2 | 98.7s | list_directory, glob_files |
| Pair → Deepseek | N/A (timeout) | 0 | 180.0s | N/A |

**Archivos**: `04-tool-loop-gemma4/`, `08-tool-loop-pair-deepseek/`

### Mecanismo de tool_calls

La respuesta del modelo con `finish_reason: "tool_calls"` tiene:
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_xxx",
        "type": "function",
        "function": { "name": "list_directory", "arguments": "{\"path\":\".\"}" }
      }]
    }
  }],
  "finish_reason": "tool_calls"
}
```

Luego el ToolLoopService ejecuta la tool, agrega el resultado como
`{"role": "tool", "tool_call_id": "...", "content": "..."}` al array
de messages, y vuelve a llamar al modelo para que procese el resultado.

---

## 5. Bug Fix: routeThroughPair

### El problema original

`routeThroughPair()` usaba solo `decision.shouldEscalate` (= confidence < threshold)
para decidir si escalar. Esto ignoraba el `mode` del clasificador:

| mode | confidence | shouldEscalate | Resultado (antes) | Debería ser |
|---|---|---|---|---|
| plan | 0.969 | false (0.969 >= 0.7) | LOCAL ❌ | CLOUD |
| execution | 0.900 | false | LOCAL ✅ | LOCAL |
| execution | 0.500 | true | CLOUD ✅ | CLOUD |

### El fix

```typescript
// Antes (erróneo):
const shouldEscalate = decision.shouldEscalate;

// Después (corregido):
const shouldEscalate = classification.mode === 'plan' || decision.shouldEscalate;
```

### Verificación

| Test | mode | confidence | Escaló? | Antes | Después |
|---|---|---|---|---|---|
| Prompt cifrado | plan | 0.962 | ✅ | ❌ local | ✅ cloud |
| Prompt agéntico | plan | 0.979 | ✅ | ❌ local | ✅ cloud |
| **Esta prueba** | **plan** | **0.522** | **✅ ESCALÓ** | — | — |

---

## 6. Feature: Observabilidad

### Métricas capturadas

```json
{
  "uptime": 298,
  "requests": {
    "total": 8,
    "byProvider": {
      "local_small": 6,
      "cloud_nvidia_deepseek": 2
    },
    "byMode": {
      "direct": 7,
      "classifier": 1
    }
  },
  "escalations": {
    "total": 1,
    "rate": 0.125
  },
  "tokens": {
    "inputTotal": 337,
    "savedByContext": 0
  },
  "latency": {
    "avgMs": 37170
  },
  "errors": {
    "total": 0,
    "byProvider": {}
  }
}
```

| Métrica | Valor |
|---|---|
| Requests totales | 8 |
| Por modo (direct/classifier) | {'direct': 7, 'classifier': 1} |
| Escalaciones | 1 (rate: 0.125) |
| Errores | 0 |
| Latencia promedio | 37.2s |
| Tokens de input total | 337 |

---

## 7. Resumen de Issues

| # | Issue | Estado | Impacto |
|---|---|---|---|
| 1 | CloudProvider.fetch() sin AbortController | ❌ | Deepseek timeout (NVIDIA lento) |
| 2 | Global timeout bajo (120s) para tool loop | ⚠️ | Tool loop se corta antes de completar |
| 3 | TranslationService sin cache de traducciones | ⚠️ | Cada request español paga latencia extra |
| 4 | CacheService embedding via Ollama (local) | ⚠️ | Primer request lento (embedding ~5-10s) |

---

## 8. Archivos Generados

| Directorio | Contenido |
|---|---|
| `01-health/` | Health + Models endpoints |
| `02-gemma4-direct/`, `02-deepseek-direct/` | Routing directo |
| `03-pair-gemma4-deepseek/` | Par con bug fix |
| `04-tool-loop-gemma4/` | Tool loop con 3 tools |
| `05-translation-es-en/` | Traducción ES→EN |
| `06-cache-request-1/`, `06-cache-request-2/` | Cache semántico |
| `07-observabilidad/` | Métricas + logs |
| `08-tool-loop-pair-deepseek/` | Tool loop + pair + cloud |
| **Este informe** | `INFORME-COMPLETO.md` |
