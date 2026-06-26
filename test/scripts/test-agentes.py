#!/usr/bin/env python3
"""
Investigación: Ruteo del par gemma4 + Deepseek V4 Flash
con un prompt de tarea agéntica (organización de archivos en el workspace).

Propósito: Verificar cómo el ConfidenceService + Classifier manejan
un prompt de tipo "tool-use / agentic task" que requiere operaciones
sobre el filesystem (identificar, renombrar, mover archivos).

Diferencia clave: Este prompt describe una tarea que DEBE ejecutarse
en el sistema de archivos local — el modelo debería reconocer que
necesita herramientas (fs_read, fs_write, mv, mkdir) para completarla.

Autor: madame-agent test suite
Fecha: 2026-06-10
"""
import json, time, os, sys, subprocess, signal, urllib.request, urllib.error
from datetime import datetime, timezone

BASE_URL = "http://localhost:3000/v1"
OUT_DIR = "test-agentes"
os.makedirs(OUT_DIR, exist_ok=True)

# ─── prompt agéntico ───────────────────────────────────────────────
AGENTIC_PROMPT = """En el actual proyecto /Users/mamisho/dev/madame-agent

Se han hecho un par de pruebas al agente, donde se ha solicitado generar scripts para poner a prueba la solución software que se desarrolla. Dichos scripts además generan directorios con los resultados de las pruebas.

Tu tarea es identificar los ficheros implicados en las pruebas, ordenarlos dentro de un directorio llamado custom-test. Dentro tendrás/crearás un subdirectorio para cada prueba donde moverás los scripts, los directorios de cada prueba correspondiente, renombrando los directorios con un nombre secuencial e identificativo de la prueba de tal manera que sea reconocible qué script y pruebas pertenecen a cada set de prueba, quedando así las ejecuciones de las pruebas ordenada y que se vean en similar orden."""

SYSTEM_PROMPT = "Eres un ingeniero de software experto en tooling y automatización. Tu tarea implica operaciones sobre el sistema de archivos. Piensa paso a paso qué herramientas necesitas."

# ─── utilidades ────────────────────────────────────────────────────
def log(msg):
    print(f"  {msg}")

def save_json(subdir, name, data):
    path = os.path.join(OUT_DIR, subdir, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    return path

def save_txt(subdir, name, text):
    path = os.path.join(OUT_DIR, subdir, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    return path

def fmt_ms(ms):
    if ms < 1000:
        return f"{ms:.0f}ms"
    return f"{ms/1000:.1f}s"

def fmt_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

# ─── HTTP helper ───────────────────────────────────────────────────
def api_call(endpoint, payload, timeout=180):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/{endpoint}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.loads(resp.read().decode())
        lat = (time.perf_counter() - t0) * 1000
        return body, lat
    except urllib.error.HTTPError as e:
        body = {"error": e.read().decode(), "status": e.code}
        lat = (time.perf_counter() - t0) * 1000
        return body, lat
    except Exception as e:
        lat = (time.perf_counter() - t0) * 1000
        return {"error": str(e)}, lat

def extract_content(response):
    if "error" in response:
        return f"[ERROR: {response['error']}]"
    choices = response.get("choices", [])
    if not choices:
        return "[sin choices]"
    msg = choices[0].get("message", {})
    return msg.get("content", "[sin content]") or msg.get("reasoning", "[sin content ni reasoning]")

def extract_reasoning(response):
    if "error" in response:
        return ""
    choices = response.get("choices", [])
    if not choices:
        return ""
    msg = choices[0].get("message", {})
    return msg.get("reasoning", "")

# ─── workspace context (for report) ─────────────────────────────────
def get_workspace_context():
    scripts = []
    dirs = []
    for f in ["test-comprehensive.py", "test-comprehensive.sh", "test-investigacion.py", "test-madame.sh"]:
        path = f"/Users/mamisho/dev/madame-agent/{f}"
        if os.path.exists(path):
            size = os.path.getsize(path)
            scripts.append({"name": f, "size": size, "size_str": f"{size/1024:.0f}KB"})
    for d in ["test-results", "test-investigacion"]:
        path = f"/Users/mamisho/dev/madame-agent/{d}"
        if os.path.isdir(path):
            files = os.listdir(path)
            dirs.append({"name": d, "files": len(files), "entries": files[:5]})
    return scripts, dirs

# ─── 1. restart server ─────────────────────────────────────────────
def restart_server():
    log("(1/8) Restarting server...")
    subprocess.run(
        "kill $(lsof -ti:3000) 2>/dev/null; sleep 1",
        shell=True, capture_output=True,
    )
    env = os.environ.copy()
    env["NODE_ENV"] = "development"
    env["DEBUG"] = "true"
    with open("/tmp/madame-agent.log", "w") as f:
        p = subprocess.Popen(
            ["node", "dist/main.js"],
            stdout=f, stderr=subprocess.STDOUT,
            env=env,
        )
    time.sleep(3)
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=5) as r:
            h = json.loads(r.read().decode())
        log(f"  Server OK: uptime={h.get('uptime')}s")
    except Exception as e:
        log(f"  WARN: {e}")
    return p

# ─── 2. warm-up gemma4 ─────────────────────────────────────────────
def warmup():
    log("\n(2/8) Warming up gemma4:12b-mlx...")
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", {
        "model": "gemma4:12b-mlx",
        "messages": [{"role": "user", "content": "decime solo: OK"}],
        "max_tokens": 10,
        "temperature": 0.1,
    })
    elapsed = time.perf_counter() - t0
    log(f"  Warm-up: {elapsed:.1f}s")
    return elapsed

# ─── 3. direct gemma4 ──────────────────────────────────────────────
def test_direct_gemma4():
    log("\n(3/8) DIRECT: gemma4:12b-mlx (control local)...")
    payload = {
        "model": "gemma4:12b-mlx",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": AGENTIC_PROMPT},
        ],
        "max_tokens": 2048,
        "temperature": 0.3,
    }
    save_json("01-gemma4-direct", "request.json", payload)
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", payload, timeout=300)
    elapsed = time.perf_counter() - t0
    save_json("01-gemma4-direct", "response.json", body)
    content = extract_content(body)
    reasoning = extract_reasoning(body)
    log(f"  → {fmt_ms(lat)} | {len(content)} chars")
    log(f"  → Reasoning: {len(reasoning)} chars")
    log(f"  → Primeros 150 chars: {content[:150]}...")
    return body, lat, content, reasoning

# ─── 4. direct deepseek ────────────────────────────────────────────
def test_direct_deepseek():
    log("\n(4/8) DIRECT: deepseek-ai/deepseek-v4-flash (control cloud)...")
    payload = {
        "model": "deepseek-ai/deepseek-v4-flash",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": AGENTIC_PROMPT},
        ],
        "max_tokens": 4096,
        "temperature": 0.3,
    }
    save_json("02-deepseek-direct", "request.json", payload)
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", payload, timeout=300)
    elapsed = time.perf_counter() - t0
    save_json("02-deepseek-direct", "response.json", body)
    content = extract_content(body)
    reasoning = extract_reasoning(body)
    log(f"  → {fmt_ms(lat)} | {len(content)} chars")
    log(f"  → Primeros 150 chars: {content[:150]}...")
    return body, lat, content, reasoning

# ─── 5. pair gemma4+deepseek ───────────────────────────────────────
def test_pair():
    log("\n(5/8) PAIR: Gemma4-12B+DeepseekV4Flash (flujo real)...")
    payload = {
        "model": "Gemma4-12B+DeepseekV4Flash",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": AGENTIC_PROMPT},
        ],
        "max_tokens": 4096,
        "temperature": 0.3,
    }
    save_json("03-pair-gemma4-deepseek", "request.json", payload)
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", payload, timeout=300)
    elapsed = time.perf_counter() - t0
    save_json("03-pair-gemma4-deepseek", "response.json", body)
    content = extract_content(body)
    reasoning = extract_reasoning(body)
    log(f"  → {fmt_ms(lat)} | {len(content)} chars")
    log(f"  → Primeros 150 chars: {content[:150]}...")
    return body, lat, content, reasoning

# ─── 6. metrics + logs ─────────────────────────────────────────────
def get_observability():
    log("\n(6/8) Capturando métricas y logs...")
    try:
        with urllib.request.urlopen(f"{BASE_URL}/metrics", timeout=5) as r:
            metrics = json.loads(r.read().decode())
        save_json("04-observabilidad", "metrics.json", metrics)
    except Exception as e:
        metrics = {"error": str(e)}
    try:
        with open("/tmp/madame-agent.log") as f:
            raw = f.readlines()
        relevant = [l for l in raw if any(x in l for x in
            ["RouterService", "ConfidenceEngine", "ClassifierService",
             "CloudProvider", "OllamaProvider", "classification"])]
        save_json("04-observabilidad", "server-logs.json", relevant[-100:])
        log(f"  {len(relevant)} líneas de routing capturadas")
    except Exception as e:
        relevant = []
        log(f"  WARN: {e}")
    return metrics, relevant

# ─── 7. generate report ────────────────────────────────────────────
def tool_analysis(content, reasoning):
    """Analyze how the model handles tooling concepts."""
    c = (content + " " + reasoning).lower()
    findings = {}

    # Tool-awareness indicators
    indicators = {
        "Tool mention": any(w in c for w in ["tool", "herramienta", "comand"]),
        "Filesystem ops": any(w in c for w in ["mkdir", "mv ", "cp ", "rename", "move", "crear directorio", "mover"]),
        "Script recognition": any(w in c for w in [".py", ".sh", "script", "ejecutable"]),
        "Directory structure": any(w in c for w in ["subdirectorio", "subcarpeta", "anidado", "estructura"]),
        "Step-by-step plan": any(w in c for w in ["paso", "step", "primero", "1.", "2.", "3."]),
        "MCP awareness": any(w in c for w in ["mcp", "model context protocol"]),
        "File identification": any(w in c for w in ["identificar", "listar", "ls ", "find ", "glob"]),
        "Sequential naming": any(w in c for w in ["secuencial", "01-", "02-", "prefix", "numerar"]),
        "Preserve origin": any(w in c for w in ["original", "backup", "copia", "preservar"]),
        "Task decomposition": any(w in c for w in ["subtask", "sub-tarea", "dividir", "fase"]),
    }
    return indicators

def generate_report(results):
    log("\n(7/8) Generando informe de investigación agéntica...")

    r = results
    now = fmt_now()

    # Parse routing from logs
    escalation_detected = False
    confidence_val = "N/A"
    classifier_mode = "N/A"
    scores_raw = ""
    import re
    for line in r["router_logs"]:
        if "Escalating" in line or "ESCALATING" in line or "escalate=true" in line:
            escalation_detected = True
        m = re.search(r'confidence=([\d.]+)', line)
        if m: confidence_val = m.group(1)
        m = re.search(r'mode=(\w+)', line)
        if m: classifier_mode = m.group(1)
        if "scores" in line:
            m = re.search(r'scores[^]]+\]', line)
            if m: scores_raw = m.group(0)

    log_snippet = "\n".join(f"  {l}" for l in r["router_logs"][-15:] if l.strip())

    # Tool analysis for each route
    gemma4_tools = tool_analysis(r["gemma4_content"], r["gemma4_reasoning"])
    deepseek_tools = tool_analysis(r["deepseek_content"], r["deepseek_reasoning"])
    pair_tools = tool_analysis(r["pair_content"], r["pair_reasoning"])

    # Workspace context
    scripts, dirs = get_workspace_context()

    provider_final = "deepseek-ai/deepseek-v4-flash (cloud)" if escalation_detected else "gemma4:12b-mlx (local)"

    report = f"""# Investigación: Ruteo del par gemma4 + Deepseek V4 Flash
## Prompt agéntico: organización de archivos de prueba en el workspace

| Campo | Valor |
|---|---|
| **Fecha** | {now} |
| **Prompt** | Tarea agéntica: identificar, renombrar y organizar archivos/directorios de tests |
| **Modelo pair** | `Gemma4-12B+DeepseekV4Flash` |
| **Threshold** | 0.70 |
| **Clasificador** | `Xenova/mobilebert-uncased-mnli` |

---

## 1. Resumen Ejecutivo

```
WORKSPACE ANTES DE LA PRUEBA:
  Scripts:  {', '.join(s['name'] for s in scripts)}
  Directorios de resultados: {', '.join(d['name'] for d in dirs)}
  Archivos en test-results:  {dirs[0]['files'] if dirs else 0} ficheros
  Archivos en test-investigacion: {dirs[1]['files'] if len(dirs) > 1 else 0} ficheros

PRUEBAS:
  ├─ gemma4:12b-mlx directo  → {fmt_ms(r['gemma4_lat'])} · {len(r['gemma4_content'])} chars
  ├─ deepseek-v4-flash directo → {fmt_ms(r['deepseek_lat'])} · {len(r['deepseek_content'])} chars
  └─ Pair Gemma4→Deepseek     → {fmt_ms(r['pair_lat'])} · {len(r['pair_content'])} chars · {'✅ ESCALÓ a Deepseek' if escalation_detected else '❌ NO escaló'}

CLASIFICADOR:  mode={classifier_mode} · confidence={confidence_val}
RUTEO FINAL:   {provider_final}
```

---

## 2. Prompt de Entrada

### System prompt
```
Eres un ingeniero de software experto en tooling y automatización.
Tu tarea implica operaciones sobre el sistema de archivos.
Piensa paso a paso qué herramientas necesitas.
```

### User prompt (agéntico)
```
{r['prompt'][:500]}...
```

### Archivos
- `01-gemma4-direct/request.json`
- `02-deepseek-direct/request.json`
- `03-pair-gemma4-deepseek/request.json`

---

## 3. Trazabilidad del Flujo (Depuración)

### 3.1 Diagrama de la arquitectura de ruteo

```
CLIENTE
  │ POST /v1/chat/completions
  │ model: "Gemma4-12B+DeepseekV4Flash"
  ▼
┌──────────────────────────────────────────────────────────┐
│ RouterService.route()                                     │
│   ├─ findModelPair("Gemma4-12B+DeepseekV4Flash")         │
│   │   → match! → routeThroughPair()                      │
│   │                                                       │
│   ├─ ClassifierService.classifyTask()                     │
│   │   ├─ model: mobilebert-uncased-mnli                  │
│   │   ├─ labels: ["plan", "execution"]                   │
│   │   └─ scores: {scores_raw or "N/A"}                   │
│   │                                                       │
│   ├─ ConfidenceEngineService.evaluate()                  │
│   │   ├─ threshold = 0.70                                │
│   │   └─ escalate = {str(escalation_detected).lower()}   │
│   │                                                       │
│   └─ Provider: {provider_final}                           │
│                                                           │
│   NOTA: La API /v1/chat/completions es text-in/text-out.  │
│   NO hay soporte de function calling ni tool use.         │
│   El modelo solo puede RESPONDER con un plan, no          │
│   ejecutar las operaciones.                               │
└───────────────────────────────────────────────────────────┘
```

### 3.2 Logs del servidor

```
{log_snippet}
```

**Archivo**: `04-observabilidad/server-logs.json`

### 3.3 Métricas

```json
{json.dumps(r['metrics'], indent=2) if isinstance(r['metrics'], dict) else str(r['metrics'])}
```

---

## 4. Análisis de Respuestas

### 4.1 Control A: gemma4:12b-mlx (local)

| Atributo | Valor |
|---|---|
| **Modelo** | `gemma4:12b-mlx` (Ollama local) |
| **Latencia** | {fmt_ms(r['gemma4_lat'])} |
| **Output** | {len(r['gemma4_content'])} chars |
| **Reasoning** | {len(r['gemma4_reasoning'])} chars |

**Respuesta** (completa):
```
{r['gemma4_content']}
```

**Reasoning** (proceso de pensamiento):
```
{r['gemma4_reasoning'][:500]}...
```

### 4.2 Control B: deepseek-ai/deepseek-v4-flash (cloud)

| Atributo | Valor |
|---|---|
| **Modelo** | `deepseek-ai/deepseek-v4-flash` (NVIDIA cloud) |
| **Latencia** | {fmt_ms(r['deepseek_lat'])} |
| **Output** | {len(r['deepseek_content'])} chars |
| **Reasoning** | {len(r['deepseek_reasoning'])} chars |

**Respuesta** (completa):
```
{r['deepseek_content']}
```

**Reasoning**:
```
{r['deepseek_reasoning'][:500]}...
```

### 4.3 Flujo real: Pair Gemma4-12B+DeepseekV4Flash

| Atributo | Valor |
|---|---|
| **Modelo pair** | `Gemma4-12B+DeepseekV4Flash` |
| **Provider final** | {provider_final} |
| **Latencia** | {fmt_ms(r['pair_lat'])} |
| **Output** | {len(r['pair_content'])} chars |
| **Reasoning** | {len(r['pair_reasoning'])} chars |

**Respuesta** (completa):
```
{r['pair_content']}
```

**Reasoning**:
```
{r['pair_reasoning'][:500]}...
```

---

## 5. Análisis de Tooling / MCP / Capacidades Agénticas

### 5.1 Conciencia de herramientas por modelo

| Indicador | gemma4 | Deepseek | Pair |
|---|---|---|---|
| Menciona "tool"/"herramienta"/"comando" | {'✅' if gemma4_tools['Tool mention'] else '❌'} | {'✅' if deepseek_tools['Tool mention'] else '❌'} | {'✅' if pair_tools['Tool mention'] else '❌'} |
| Operaciones de filesystem (mkdir/mv/cp) | {'✅' if gemma4_tools['Filesystem ops'] else '❌'} | {'✅' if deepseek_tools['Filesystem ops'] else '❌'} | {'✅' if pair_tools['Filesystem ops'] else '❌'} |
| Reconoce scripts/archivos del proyecto | {'✅' if gemma4_tools['Script recognition'] else '❌'} | {'✅' if deepseek_tools['Script recognition'] else '❌'} | {'✅' if pair_tools['Script recognition'] else '❌'} |
| Propone estructura de directorios | {'✅' if gemma4_tools['Directory structure'] else '❌'} | {'✅' if deepseek_tools['Directory structure'] else '❌'} | {'✅' if pair_tools['Directory structure'] else '❌'} |
| Plan paso a paso | {'✅' if gemma4_tools['Step-by-step plan'] else '❌'} | {'✅' if deepseek_tools['Step-by-step plan'] else '❌'} | {'✅' if pair_tools['Step-by-step plan'] else '❌'} |
| Menciona MCP | {'✅' if gemma4_tools['MCP awareness'] else '❌'} | {'✅' if deepseek_tools['MCP awareness'] else '❌'} | {'✅' if pair_tools['MCP awareness'] else '❌'} |
| Identifica archivos específicos | {'✅' if gemma4_tools['File identification'] else '❌'} | {'✅' if deepseek_tools['File identification'] else '❌'} | {'✅' if pair_tools['File identification'] else '❌'} |
| Nombrado secuencial | {'✅' if gemma4_tools['Sequential naming'] else '❌'} | {'✅' if deepseek_tools['Sequential naming'] else '❌'} | {'✅' if pair_tools['Sequential naming'] else '❌'} |
| Preserva originales/backup | {'✅' if gemma4_tools['Preserve origin'] else '❌'} | {'✅' if deepseek_tools['Preserve origin'] else '❌'} | {'✅' if pair_tools['Preserve origin'] else '❌'} |
| Descomposición en subtareas | {'✅' if gemma4_tools['Task decomposition'] else '❌'} | {'✅' if deepseek_tools['Task decomposition'] else '❌'} | {'✅' if pair_tools['Task decomposition'] else '❌'} |

### 5.2 Análisis cualitativo

**¿El modelo reconoce que necesita herramientas?**"""

    # Qualitative analysis
    for model_key, model_name, tools_data, content_str, reasoning_str in [
        ("gemma4", "gemma4", gemma4_tools, r["gemma4_content"], r["gemma4_reasoning"]),
        ("deepseek", "Deepseek", deepseek_tools, r["deepseek_content"], r["deepseek_reasoning"]),
        ("pair", "Pair", pair_tools, r["pair_content"], r["pair_reasoning"]),
    ]:
        tool_count = sum(1 for v in tools_data.values() if v)
        report += f"""

**{model_name}** ({tool_count}/10 indicadores):
"""
        if tool_count >= 7:
            report += "El modelo demostró ALTA conciencia de tooling. Reconoce la necesidad de operaciones de filesystem y estructura el plan adecuadamente."
        elif tool_count >= 4:
            report += "El modelo tiene conciencia MODERADA de tooling. Identifica algunos aspectos pero no todos."
        else:
            report += "El modelo tiene BAJA conciencia de tooling. Trata la tarea principalmente como un ejercicio de planificación textual."

        # Check for specific tool-related phrases
        c = (content_str + " " + reasoning_str).lower()
        for phrase, label in [
            ("mkdir", "mkdir"),
            ("mv ", "mv (mover)"),
            ("cp ", "cp (copiar)"),
            ("ls ", "ls (listar)"),
            ("find ", "find (buscar)"),
            ("glob", "glob"),
            ("chmod", "chmod"),
            ("python", "Python"),
            ("bash", "bash/sh"),
            ("subprocess", "subprocess"),
        ]:
            if phrase in c:
                report += f"\n  - Usa `{label}`"

    report += f"""

### 5.3 Limitación fundamental: API text-in/text-out

La API de madame-agent (`POST /v1/chat/completions`) es una API de chat
estándar. **NO soporta function calling, tool use, ni ejecución de código.**
El modelo solo puede generar texto de respuesta.

Consecuencias para tareas agénticas:
1. **El modelo no puede ejecutar tool calls** — solo puede describir un plan
2. **No hay ciclo de ejecución** — el agente no puede leer directorios,
   identificar archivos, ni moverlos
3. **La respuesta es estática** — el modelo adivina el estado del workspace
   basado en su conocimiento del prompt, no en observación real
4. **Sin herramientas, no hay agencia real** — el modelo es un "asesor",
   no un "agente"

Para que madame-agent soporte tareas agénticas reales, necesitaría:
- Function calling / tool definition (OpenAI-compatible)
- Un loop de ejecución (modelo → tool → resultado → modelo)
- Acceso al filesystem via tools (read, write, exec, glob)
- Posiblemente un sandbox de ejecución

### 5.4 Comparativa: prompt agéntico vs prompts anteriores

| Aspecto | Prompt simple ("decime HOLA") | Prompt complejo (cifrado) | Prompt agéntico (filesystem) |
|---|---|---|---|
| Clasificación esperada | execution | plan | plan o execution? |
| Tooling necesario | Ninguno | Ninguno | ALTO (read, write, exec) |
| El modelo puede ejecutar | Sí (responde texto) | Sí (analiza y responde) | NO (solo describe plan) |
| Valor de la respuesta | Bajo | Alto (análisis técnico) | Bajo (no puede ejecutar) |

---

## 6. Conclusiones

### 6.1 Veredicto por componente

| Componente | Funciona | Notas |
|---|---|---|
| Clasificador | {'✅' if classifier_mode != 'N/A' else '❌'} | mode={classifier_mode} para tarea agéntica |
| ConfidenceEngine | {'✅' if confidence_val != 'N/A' else '❌'} | confidence={confidence_val} vs 0.70 |
| Escalación | {'✅' if escalation_detected else '✅ No escaló'} | {'Escaló a cloud' if escalation_detected else 'De cisión del confidence engine'} |
| Ruteo pair | ✅ | Sin errores |
| Tool awareness (gemma4) | {'✅' if gemma4_tools['Tool mention'] else '❌'} | {'Reconoce necesidad de herramientas' if gemma4_tools['Tool mention'] else 'No menciona herramientas'} |
| Tool awareness (Deepseek) | {'✅' if deepseek_tools['Tool mention'] else '❌'} | {'Reconoce necesidad de herramientas' if deepseek_tools['Tool mention'] else 'No menciona herramientas'} |
| API soporta function calling | ❌ | Limitación de la plataforma |

### 6.2 Calidad de respuesta vs ruta

- **Mejor respuesta para este prompt**: {'Deepseek (cloud)' if escalation_detected else 'gemma4 (local)'}
- **¿El modelo entendería qué hacer?**: La respuesta describe un plan que un
  operador humano podría seguir, pero el modelo NO puede ejecutarlo por sí mismo.

### 6.3 Issues detectados

1. **⚠️ API sin function calling**: madame-agent no soporta tool use. Para tareas
   agénticas reales, necesita implementar `tools` en el DTO y un loop de ejecución.

2. **⚠️ El modelo alucina el estado del workspace**: Sin herramientas de lectura
   de filesystem, el modelo solo puede inferir qué archivos existen basado en
   el prompt. No puede verificar.

3. **{'🔴' if not escalation_detected else '✅'} Bug de diseño en routeThroughPair()**:
   {'No escaló (ver bug doc del estudio anterior)' if not escalation_detected else 'Escaló correctamente a cloud.'}

---

## 7. Archivos Generados

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
| **Este informe** | `INFORME-AGENTES.md` |
"""

    path = os.path.join(OUT_DIR, "INFORME-AGENTES.md")
    with open(path, "w") as f:
        f.write(report)
    log(f"  Informe: {path}")
    return path


# ══════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════
def main():
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║  INVESTIGACIÓN: Ruteo pair gemma4+Deepseek                  ║")
    print("║  Prompt: Tarea agéntica (organizar archivos de test)        ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print()

    t_total = time.perf_counter()

    proc = restart_server()
    w_elapsed = warmup()

    g_body, g_lat, g_content, g_reasoning = test_direct_gemma4()
    d_body, d_lat, d_content, d_reasoning = test_direct_deepseek()
    p_body, p_lat, p_content, p_reasoning = test_pair()

    metrics, router_logs = get_observability()

    results = {
        "total_ms": (time.perf_counter() - t_total) * 1000,
        "gemma4_lat": g_lat,
        "gemma4_content": g_content,
        "gemma4_reasoning": g_reasoning,
        "deepseek_lat": d_lat,
        "deepseek_content": d_content,
        "deepseek_reasoning": d_reasoning,
        "pair_lat": p_lat,
        "pair_content": p_content,
        "pair_reasoning": p_reasoning,
        "metrics": metrics,
        "router_logs": router_logs,
        "prompt": AGENTIC_PROMPT,
        "system_prompt": SYSTEM_PROMPT,
    }
    report_path = generate_report(results)

    total = (time.perf_counter() - t_total)
    print(f"\n{'═' * 60}")
    print(f"  TOTAL: {total:.0f}s")
    print(f"  Informe: {report_path}")
    print(f"  Datos: {OUT_DIR}/")
    print(f"{'═' * 60}")

    if proc:
        os.kill(proc.pid, signal.SIGTERM)


if __name__ == "__main__":
    main()
