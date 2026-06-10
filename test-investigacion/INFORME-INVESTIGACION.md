# Investigación: Ruteo del par gemma4 + Deepseek V4 Flash
## Prompt complejo de análisis de requisitos de cifrado empresarial

| Campo | Valor |
|---|---|
| **Fecha** | 2026-06-10 10:46 UTC |
| **Duración** | 434s (7m 14s) |
| **Prompt** | 4 requisitos de seguridad empresarial conflictivos |
| **Modelo pair** | `Gemma4-12B+DeepseekV4Flash` |
| **Threshold** | 0.70 (configurado en `routing.yaml`) |
| **Clasificador** | `Xenova/mobilebert-uncased-mnli` (zero-shot) |

---

## 1. Resumen Ejecutivo

```
PRUEBAS:
  ├─ gemma4:12b-mlx directo  → 39.9s · 1024 tokens · content=OK · reasoning=OK
  ├─ deepseek-v4-flash directo → TIMEOUT (300s) · NVIDIA sin respuesta
  └─ Pair Gemma4→Deepseek     → 81.4s · 1856 tokens · NO escaló ← 🔴 HALLAZGO

CLASIFICADOR:
  ├─ labels: ["system planning and architecture", "code execution and simple fix"]
  ├─ scores: [0.962, 0.038]
  └─ mode=plan · confidence=0.962

CONFIDENCE ENGINE:
  ├─ threshold=0.70
  ├─ confidence=0.962 >= 0.70
  ├─ shouldEscalate=false
  └─ provider=local_medium (gemma4:12b-mlx)  ← 🔴 USÓ LOCAL PARA PLAN

RESULTADO: Pair NO escaló → gemma4 local para tarea de planificación compleja
```

**Hallazgo crítico**: El clasificador **funciona correctamente** (identifica el prompt como `plan` con 0.962 de confianza). El ConfidenceEngine **funciona según su diseño** (no escala si confianza >= threshold). Pero la **lógica de negocio es incorrecta**: para tareas de tipo `plan`, debería escalar al modelo cloud independientemente de la confianza, porque las tareas de planificación/arquitectura requieren un modelo más potente.

---

## 2. Prompt de Entrada

### System prompt
```
Eres un arquitecto de seguridad experto. Analiza problemas
de criptografía con rigor técnico.
```

### User prompt
```
Una empresa exige:

1. Todas las comunicaciones deben estar cifradas extremo a extremo.
2. Los administradores deben poder inspeccionar cualquier mensaje
   en cualquier momento.
3. Ninguna clave privada puede almacenarse fuera del dispositivo
   del usuario.
4. Los usuarios deben poder recuperar mensajes si pierden todos
   sus dispositivos.

Analiza si los requisitos son compatibles. Si no lo son, identifica
exactamente qué requisitos entran en conflicto y propón alternativas.
```

### Análisis del prompt

Los 4 requisitos son **intrínsecamente contradictorios**:

| Req | Enunciado | Problema |
|-----|-----------|----------|
| R1 | Cifrado E2E | Solo los extremos tienen la clave |
| R2 | Inspección admin | Requiere acceso al plaintext → viola E2E |
| R3 | Claves solo en dispositivo | Sin backup externo de claves |
| R4 | Recuperación tras pérdida | Requiere backup de claves → viola R3 |

Es un problema de **arquitectura de seguridad** → clasificación esperada: `plan`.

### Archivos
- `01-gemma4-direct/request.json`
- `02-deepseek-direct/request.json`
- `03-pair-gemma4-deepseek/request.json`

---

## 3. Trazabilidad del Flujo (Depuración Completa)

### 3.1 Diagrama de la arquitectura de ruteo

```
CLIENTE
  │
  │ POST /v1/chat/completions
  │ model: "Gemma4-12B+DeepseekV4Flash"
  ▼
┌─────────────────────────────────────────────────────┐
│ ProxyController.createChatCompletion()               │
│   requestId = "req_N"                                │
│   observability.startTimer(requestId)                │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│ RouterService.route()                                │
│                                                      │
│  1. findModelPair("Gemma4-12B+DeepseekV4Flash")     │
│     → match! → routeThroughPair()                    │
│                                                      │
│  2. ClassifierService.classifyTask(messages)         │
│     ├─ modelo: mobilebert-uncased-mnli (zero-shot)   │
│     ├─ labels: ["plan", "execution"]                 │
│     ├─ scores: [0.962, 0.038] ← CLASIFICACIÓN OK     │
│     └─ return: {mode:"plan", confidence:0.962}       │
│                                                      │
│  3. ConfidenceEngineService.evaluate(classification) │
│     ├─ threshold = 0.70                              │
│     ├─ 0.962 >= 0.70 → shouldEscalate = FALSE        │
│     └─ return: {shouldEscalate:false, ...}           │
│                                                      │
│  4. Decision: !shouldEscalate → selectedConfig =     │
│     LOCAL (gemma4:12b-mlx)    ← 🔴 BUG DE DISEÑO     │
│                                                      │
│  5. ContextProcessor.process(messages)               │
│     ├─ dedup: 0 removidos                           │
│     └─ compress: sin truncar (377 tokens < 8192)    │
│                                                      │
│  6. OllamaProvider.chat(gemma4:12b-mlx)             │
│     → respuesta local (1856 tokens)                  │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│ ProxyController.createChatCompletion()               │
│   observability.finishTimer(requestId)               │
│   observability.trackRequest({                       │
│     mode: "classifier",                              │
│     classifierMode: "plan",                          │
│     confidence: 0.962,                               │
│     escalated: false,   ← NO ESCALÓ                  │
│     providerKey: "local_medium",                     │
│     providerType: "ollama",                          │
│     model: "gemma4:12b-mlx"                         │
│   })                                                 │
│   return: response.json(data)                        │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
                    CLIENTE
              (recibe respuesta de gemma4)
```

### 3.2 Logs del servidor (extracto relevante)

```
[ClassifierService]
  LOG  Initializing local AI classifier via transformers.js...
  LOG  Classifier model loaded successfully.

[RouterService]
  LOG  Direct routing for model "gemma4:12b-mlx" → provider "local_small" (ollama)
  LOG  Direct routing for model "deepseek-ai/deepseek-v4-flash" → provider "cloud_nvidia_deepseek" (cloud)

[CloudProvider]
  DEBUG Calling Cloud API for provider nvidia and model deepseek-ai/deepseek-v4-flash
        ↑ 300s después... timeout

[ClassifierService]                               ← 5 minutos después (el pair usa classifier)
  DEBUG Classification results:
    sequence: "...prompt completo..."
    labels: ["system planning and architecture", "code execution and simple fix"]
    scores: [0.9617917332911339, 0.038208266708866026]
                                  ↑               ↑
                            plan: 0.962     execution: 0.038

[ConfidenceEngineService]
  DEBUG Confidence=0.962, threshold=0.7, mode=plan, escalate=false
                                                    ↑
                                            NO escaló pese a ser PLAN

[RouterService]
  LOG  Pair "Gemma4-12B+DeepseekV4Flash": mode=plan, confidence=0.962
       → using local local_medium (gemma4:12b-mlx)
                                    ↑
                          🔴 DEBERÍA SER CLOUD

[OllamaProvider]
  DEBUG Calling Ollama API for model gemma4:12b-mlx
```

**Archivo**: `04-observabilidad/server-logs.json`

### 3.3 Línea de tiempo

```
T+0s     POST /v1/chat/completions (gemma4:12b-mlx direct) ─────────┐
T+39.9s  ← Response gemma4 (1024 tokens, finish=length)             │
                                                                     │
T+40s    POST /v1/chat/completions (deepseek direct) ───────────────┐│
T+40s    CloudProvider.fetch() → NVIDIA API                         ││
T+340s   → TIMEOUT (300s) ← sin AbortController en fetch()          ││
                                                                     ││
T+340s   POST /v1/chat/completions (Pair Gemma4→Deepseek) ─────────┐││
T+340s   ClassifierService.classifyTask() → 0.962, plan             │││
T+340s   ConfidenceEngine → escalate=false                         │││
T+340s   → gemma4 local (NO Deepseek)                              │││
T+421s   ← Response gemma4 (1856 tokens, finish=stop)               │││
                                                                     │││
T+434s   FIN ────────────────────────────────────────────────────────┘││
```

### 3.4 Métricas del sistema

```json
{
  "requests": { "total": 4, "byMode": { "direct": 3, "classifier": 1 } },
  "escalations": { "total": 0, "rate": 0 },
  "errors": { "total": 1, "byProvider": { "unknown": 1 } },
  "latency": { "avgMs": 32386 }
}
```

La métrica `escalations: 0` confirma que ninguna request fue escalada. El error `byProvider.unknown` corresponde al timeout de Deepseek directo.

---

## 4. Análisis de Respuestas

### 4.1 Control A: gemma4:12b-mlx (directo)

| Atributo | Valor |
|---|---|
| **Modelo** | `gemma4:12b-mlx` vía Ollama (local) |
| **Latencia** | 39.9s |
| **Tokens output** | 1024 (truncado por `max_tokens=1024`) |
| **finish_reason** | `length` |
| **Contenido en** | `content` + `reasoning` (modelo de razonamiento) |
| **Calidad** | Identifica conflicto R1 vs R2 y R3 vs R4. NO identifica R2 vs R3. |

**Respuesta** (inicio):
> Como arquitecto de seguridad, he analizado los cuatro requisitos
> proporcionados. Mi conclusión técnica es que **los requisitos son
> mutuamente incompatibles**. Existen dos conflictos fundamentales...

**Fragmento del `reasoning`** (thinking process del modelo):
```
* Role: Expert Security Architect.
* Conflict A: Req 1 (E2EE) vs. Req 2 (Admin Inspection).
  E2EE is mathematically designed to prevent intermediaries
  (including admins) from reading data.
* Conflict B: Req 3 (No keys off-device) vs. Req 4 (Recovery after loss).
```

**Archivos**: `01-gemma4-direct/request.json`, `01-gemma4-direct/response.json`

### 4.2 Control B: deepseek-ai/deepseek-v4-flash (directo)

| Atributo | Valor |
|---|---|
| **Modelo** | `deepseek-ai/deepseek-v4-flash` vía NVIDIA API (cloud) |
| **Latencia** | 300.0s (timeout) |
| **Tokens output** | N/A |
| **Resultado** | `[ERROR: timed out]` |
| **Causa** | `CloudProvider.fetch()` no tiene `AbortController` |

La llamada directa a Deepseek V4 Flash via NVIDIA **nunca respondió**. El cliente (Python) tenía timeout de 300s, pero `fetch()` del lado del servidor no tiene timeout configurado, por lo que el request queda bloqueado hasta que el cliente aborte la conexión. Esto refuerza el issue #1 del test anterior.

**Archivos**: `02-deepseek-direct/request.json`, `02-deepseek-direct/response.json`

### 4.3 Flujo real: Pair Gemma4-12B+DeepseekV4Flash

| Atributo | Valor |
|---|---|
| **Modelo pair** | `Gemma4-12B+DeepseekV4Flash` |
| **Provider final** | `local_medium` → `gemma4:12b-mlx` (local) |
| **Latencia** | 81.4s |
| **Tokens output** | 1856 (completo, `finish_reason=stop`) |
| **Modo clasificador** | `plan` |
| **Confianza** | 0.962 |
| **Escaló** | **NO** 🔴 |
| **Calidad** | Identifica los 3 conflictos (R1vsR2, R2vsR3, R3vsR4). Más completo que el directo. |

**Respuesta** (inicio):
> Como arquitecto de seguridad, he analizado los cuatro requisitos
> proporcionados. Mi conclusión técnica es que **los requisitos son
> incompatibles entre sí**. Existe una contradicción fundamental...

El contenido empieza **igual** que gemma4 directo (confirmación de que fue el mismo modelo local). La respuesta es más larga porque `max_tokens=2048` vs `max_tokens=1024` en el directo.

**Hallazgo**: El pair usó gemma4 **a pesar de que el clasificador dijo "plan" con 0.962**. Deepseek nunca fue consultado.

**Archivos**: `03-pair-gemma4-deepseek/request.json`, `03-pair-gemma4-deepseek/response.json`

---

## 5. Comparación de Calidad

### 5.1 Análisis de conflictos identificados

| Conflicto | gemma4 direct | gemma4 (pair) | Deepseek (direct) |
|---|---|---|---|
| R1 (E2EE) vs R2 (Inspección) | ✅ Identificado | ✅ Identificado | ❌ Timeout |
| R2 (Inspección) vs R3 (Claves local) | ❌ NO identificado | ✅ Identificado | ❌ Timeout |
| R3 (Claves local) vs R4 (Recuperación) | ✅ Identificado | ✅ Identificado | ❌ Timeout |
| Propone alternativas | ✅ Sí (parcial) | ✅ Sí (detallado) | ❌ N/A |

### 5.2 Métricas por ruta

| Ruta | Latencia | Tokens output | Costo relativo |
|---|---|---|---|
| gemma4 direct | 39.9s | 1024 | 1x (local, gratuito) |
| Deepseek direct | 300.0s | 0 | ∞ (timeout, sin datos) |
| Pair (gemma4→Deepseek) | 81.4s | 1856 | 1x (local, no escaló) |

### 5.3 Análisis de la latencia del pair

```
81.4s = 300ms (classifier) + 81.1s (gemma4 inference)
```

La penalidad del ruteo (classifier + confidence) es de ~300ms, despreciable frente al tiempo de inferencia. El cuello de botella es gemma4, no el ruteo.

---

## 6. Análisis del Bug de Diseño en routeThroughPair

### 6.1 El problema

En `src/router/router.service.ts:routeThroughPair()`:

```typescript
// Lógica ACTUAL (errónea para modo plan):
const shouldEscalate = decision.shouldEscalate;
// shouldEscalate = confidence < threshold
// → confidence=0.962 < 0.7 = false → USA LOCAL

const selectedConfig = shouldEscalate ? cloudConfig : localConfig;
```

**Esto es incorrecto** porque trata la escalación como una función UNICAMENTE de la confianza, ignorando el `mode`. La consecuencia:

| Escenario | confidence | threshold | shouldEscalate | Provider usado | Debería ser |
|---|---|---|---|---|---|
| Plan con alta confianza | 0.962 | 0.70 | false | **LOCAL** ❌ | **CLOUD** (plan → cloud) |
| Plan con baja confianza | 0.500 | 0.70 | true | **CLOUD** ✅ | **CLOUD** (plan → cloud) |
| Execution con alta confianza | 0.900 | 0.70 | false | **LOCAL** ✅ | **LOCAL** (exec → local) |
| Execution con baja confianza | 0.500 | 0.70 | true | **CLOUD** ✅ | **CLOUD** (incierto → cloud) |

El único caso incorrecto es **el que ocurrió**: "plan con alta confianza" → debería ir a cloud.

### 6.2 Comparación con el flujo NO-pair

En el flujo sin pair (`RouterService.route()`), la lógica es diferente:

```typescript
// route() - flujo sin pair
const decision = this.confidenceEngine.evaluate(classification);
if (decision.shouldEscalate) {
  // usar escalation provider (cloud_nvidia)
} else {
  // usar routingConfig[result.mode]?.provider
  // mode="plan" → provider = cloud_nvidia ← CORRECTO
}
```

En `route()`, cuando `shouldEscalate=false`, se usa `routingConfig[result.mode]?.provider`. Como `routing.plan.provider = cloud_nvidia`, las tareas "plan" van a cloud **aunque no escalen por confianza**. El bug existe SOLO en `routeThroughPair()`.

### 6.3 La corrección propuesta

```typescript
// routeThroughPair() - lógica CORREGIDA
const shouldEscalate = classification.mode === 'plan'
  || decision.shouldEscalate;
```

O más explícitamente:

```typescript
// Si es plan → cloud (necesita modelo potente)
// Si es execution con baja confianza → cloud (incierto)
// Si es execution con alta confianza → local (suficiente)
const selectedConfig = (classification.mode === 'plan' || decision.shouldEscalate)
  ? cloudConfig
  : localConfig;
```

Esto asegura que:
- **plan** → siempre cloud (Deepseek V4 Flash o Llama 70B)
- **execution** + confianza baja → cloud (escalación por duda)
- **execution** + confianza alta → local (gemma4)

### 6.4 Threshold vs modo: discusión arquitectónica

Hay dos escuelas de diseño para la escalación:

| Enfoque | Lógica | Ventaja | Desventaja |
|---|---|---|---|
| **Solo confianza** (actual) | `escalate = confidence < threshold` | Simple, un parámetro | No distingue tipos de tarea |
| **Modo + confianza** (propuesto) | `escalate = (mode === 'plan') \|\| (confidence < threshold)` | Precisa: plan→cloud, exec dudosa→cloud | Dos condiciones |
| **Routing por modo** | `provider = routingConfig[mode]` | Clara separación plan/exec | No maneja incertidumbre |

Para el par gemma4+Deepseek, la opción correcta es **Modo + confianza**, porque:
1. Las tareas de planificación necesitan la potencia de Deepseek (cloud, 671B params estimados)
2. Las tareas de ejecución pueden resolverse con gemma4 (12B local)
3. La incertidumbre (confianza baja) debe escalar siempre

---

## 7. Conclusiones

### 7.1 Veredicto por componente

| Componente | Funciona | Notas |
|---|---|---|
| **Clasificador** (mobilebert) | ✅ | Clasificó correctamente `plan` con 0.962 |
| **ConfidenceEngine** | ⚠️ | Funciona según diseño, pero el diseño es incorrecto para pairs |
| **routeThroughPair()** | ❌ | Ignora `mode` en la decisión de escalación |
| **route() (sin pair)** | ✅ | Usa `routingConfig[mode]` que mapea plan→cloud correctamente |
| **CloudProvider.fetch()** | ❌ | Sin timeout: Deepseek directo colgó 300s |
| **OllamaProvider** | ✅ | Responde en ~39-81s para gemma4 (modelo de razonamiento) |

### 7.2 Issues detectados

1. **🔴 Bug de diseño en `routeThroughPair()`**: La escalación debe considerar `classification.mode`, no solo `confidence`. Una tarea clasificada como `plan` con alta confianza debe ir al cloud, no al local. Ver sección 6.

2. **🔴 `CloudProvider.fetch()` sin timeout**: La llamada directa a Deepseek V4 Flash via NVIDIA nunca respondió (timeout de 300s del cliente). El servidor no tiene `AbortController` configurado. Issue ya reportado en test anterior.

3. **⚠️ gemma4 es lento para prompts complejos**: 39-81s para generar 1024-1856 tokens. El `reasoning` field añadió latencia significativa (el modelo piensa antes de responder).

### 7.3 Recomendaciones

1. **FIX INMEDIATO**: En `routeThroughPair()`, cambiar la decisión a:
   ```typescript
   const selectedConfig = (classification.mode === 'plan' || decision.shouldEscalate)
     ? cloudConfig
     : localConfig;
   ```

2. **FIX PENDIENTE**: Agregar `AbortController` con timeout de 60s en `CloudProvider.fetch()`.

3. **MEJORA**: Considerar dos thresholds: `threshold.plan` para decidir entre Deepseek y Llama, y `threshold.execution` para decidir entre gemma4 y escalación.

4. **DOC**: Agregar este hallazgo a la documentación de arquitectura del routing.

---

## 8. Archivos Generados

| Archivo | Ruta |
|---|---|
| Request gemma4 direct | `01-gemma4-direct/request.json` |
| Response gemma4 direct | `01-gemma4-direct/response.json` |
| Request Deepseek direct | `02-deepseek-direct/request.json` |
| Response Deepseek direct | `02-deepseek-direct/response.json` |
| Request pair | `03-pair-gemma4-deepseek/request.json` |
| Response pair | `03-pair-gemma4-deepseek/response.json` |
| Métricas | `04-observabilidad/metrics.json` |
| Logs servidor | `04-observabilidad/server-logs.json` |
| **Este informe** | `INFORME-INVESTIGACION.md` |
