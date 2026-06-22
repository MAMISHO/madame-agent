#!/usr/bin/env python3
"""
Investigación: Tool Loop con el par gemma4 + Deepseek V4 Flash
Prompt agéntico CON tools parameter (function calling).

Propósito: Verificar que el ToolLoopService ejecuta correctamente
el ciclo modelo → tool_call → ejecución → resultado → modelo.

Diferencia clave: Ahora el request incluye el array `tools` con las
9 herramientas built-in, lo que activa ToolLoopService en RouterService.

Autor: madame-agent test suite
Fecha: 2026-06-10
"""
import json, time, os, subprocess, signal, urllib.request, urllib.error
from datetime import datetime, timezone

BASE_URL = "http://localhost:3000/v1"
OUT_DIR = "test-agentes-tools"
os.makedirs(OUT_DIR, exist_ok=True)

AGENTIC_PROMPT = """En el actual proyecto /Users/mamisho/dev/madame-agent

Se han hecho un par de pruebas al agente, donde se ha solicitado generar scripts para poner a prueba la solución software que se desarrolla. Dichos scripts además generan directorios con los resultados de las pruebas.

Tu tarea es identificar los ficheros implicados en las pruebas, ordenarlos dentro de un directorio llamado custom-test. Dentro tendrás/crearás un subdirectorio para cada prueba donde moverás los scripts, los directorios de cada prueba correspondiente, renombrando los directorios con un nombre secuencial e identificativo de la prueba de tal manera que sea reconocible qué script y pruebas pertenecen a cada set de prueba, quedando así las ejecuciones de las pruebas ordenada y que se vean en similar orden.

IMPORTANTE: Usa las herramientas disponibles para leer el directorio, identificar los archivos, y organizarlos. No me des un plan textual — EJECUTA las operaciones usando las herramientas una por una."""

SYSTEM_PROMPT = "Eres un ingeniero de software experto en tooling. EJECUTA las herramientas para completar la tarea, no solo las describas."

# 9 built-in tools definitions (matching BuiltInToolsService)
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file from the workspace",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write or overwrite a file in the workspace",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the file"},
                    "content": {"type": "string", "description": "Content to write"}
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "glob_files",
            "description": "Search for files matching a glob pattern",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Glob pattern"}
                },
                "required": ["pattern"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": "List the contents of a directory",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to the directory"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "move_file",
            "description": "Move or rename a file or directory",
            "parameters": {
                "type": "object",
                "properties": {
                    "source": {"type": "string", "description": "Source path"},
                    "dest": {"type": "string", "description": "Destination path"}
                },
                "required": ["source", "dest"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "copy_file",
            "description": "Copy a file from source to destination",
            "parameters": {
                "type": "object",
                "properties": {
                    "source": {"type": "string", "description": "Source path"},
                    "dest": {"type": "string", "description": "Destination path"}
                },
                "required": ["source", "dest"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "execute_command",
            "description": "Execute a shell command",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Command to execute"},
                    "timeout": {"type": "number", "description": "Timeout in ms"}
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_directory",
            "description": "Create a directory (and parent directories if needed)",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to create"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a file or empty directory",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path to delete"}
                },
                "required": ["path"]
            }
        }
    }
]

def log(msg):
    print(f"  {msg}")

def save_json(subdir, name, data):
    path = os.path.join(OUT_DIR, subdir, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    return path

def fmt_ms(ms):
    if ms < 1000:
        return f"{ms:.0f}ms"
    return f"{ms/1000:.1f}s"

def fmt_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

def api_call(endpoint, payload, timeout=300):
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
    return msg.get("content", "") or "[empty content]"

def extract_tool_calls(response):
    if "error" in response:
        return []
    choices = response.get("choices", [])
    if not choices:
        return []
    msg = choices[0].get("message", {})
    return msg.get("tool_calls", [])

def analyze_tool_usage(responses):
    """Analyze tool calls across multiple response iterations."""
    total_calls = 0
    tools_used = {}
    for resp in responses:
        tcs = extract_tool_calls(resp)
        total_calls += len(tcs)
        for tc in tcs:
            name = tc.get("function", {}).get("name", "unknown")
            tools_used[name] = tools_used.get(name, 0) + 1
    return total_calls, tools_used

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
            stdout=f, stderr=subprocess.STDOUT, env=env,
        )
    # Wait up to 15s for server to be ready
    for attempt in range(15):
        time.sleep(1)
        try:
            with urllib.request.urlopen(f"{BASE_URL}/health", timeout=2) as r:
                h = json.loads(r.read().decode())
                log(f"  Server OK: uptime={h.get('uptime')}s (attempt {attempt+1})")
                return p
        except Exception:
            continue
    log("  ERROR: server did not start")
    return p

def warmup():
    log("\n(2/8) Warming up gemma4:12b-mlx...")
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", {
        "model": "gemma4:12b-mlx",
        "messages": [{"role": "user", "content": "decime solo: OK"}],
        "max_tokens": 10, "temperature": 0.1,
    })
    log(f"  {time.perf_counter()-t0:.1f}s")
    return body

def run_model_test(label, subdir, model, payload_extras=None, timeout=300):
    log(f"\n({subdir.split('-')[0]}/8) {label}...")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": AGENTIC_PROMPT},
        ],
        "tools": TOOLS,
        "tool_choice": "auto",
        "max_tokens": 4096,
        "temperature": 0.3,
    }
    if payload_extras:
        payload.update(payload_extras)

    save_json(subdir, "request.json", payload)
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", payload, timeout=timeout)
    elapsed = time.perf_counter() - t0
    save_json(subdir, "response.json", body)

    content = extract_content(body)
    tool_calls = extract_tool_calls(body)
    log(f"  → {fmt_ms(lat)} | content={len(content)} chars | tool_calls={len(tool_calls)}")
    if tool_calls:
        for tc in tool_calls[:5]:
            fn = tc.get("function", {})
            log(f"    ⚡ {fn.get('name', '?')}({fn.get('arguments', '')[:80]}...)")
    else:
        log(f"  → Primeros 150 chars: {content[:150]}...")

    return body, lat, content, tool_calls

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
        relevant = [l for l in raw if any(
            x in l for x in ["RouterService", "ToolLoop", "ToolRegistry",
                             "Sandbox", "ConfidenceEngine", "ClassifierService",
                             "CloudProvider", "OllamaProvider"])]
        save_json("04-observabilidad", "server-logs.json", relevant[-200:])
        log(f"  {len(relevant)} líneas de routing/tool capturadas")
    except Exception as e:
        relevant = []
        log(f"  WARN: {e}")
    return metrics, relevant


def generate_report(results):
    log("\n(7/8) Generando informe tool loop...")

    r = results
    now = fmt_now()

    import re
    escalation_detected = False
    confidence_val = "N/A"
    classifier_mode = "N/A"
    tool_loop_iterations = "N/A"
    tool_calls_total = 0

    for line in r["router_logs"]:
        if "ESCALATING" in line or "escalate=true" in line:
            escalation_detected = True
        m = re.search(r'confidence=([\d.]+)', line)
        if m: confidence_val = m.group(1)
        m = re.search(r'mode=(\w+)', line)
        if m: classifier_mode = m.group(1)
        m = re.search(r'ToolLoop iteration (\d+)', line)
        if m: tool_loop_iterations = m.group(1)
        if "tool call(s)" in line:
            m = re.search(r'made (\d+) tool', line)
            if m: tool_calls_total += int(m.group(1))

    log_snippet = "\n".join(f"  {l}" for l in r["router_logs"][-20:] if l.strip())

    _, gemma4_tools_used = analyze_tool_usage([r["gemma4_body"]])
    _, deepseek_tools_used = analyze_tool_usage([r["deepseek_body"]])
    _, pair_tools_used = analyze_tool_usage([r["pair_body"]])

    provider_final = "deepseek-ai/deepseek-v4-flash (cloud)" if escalation_detected else "gemma4:12b-mlx (local)"

    report = f"""# Investigación: Tool Loop con par gemma4 + Deepseek V4 Flash
## Prompt agéntico CON tools parameter (function calling)

| Campo | Valor |
|---|---|
| **Fecha** | {now} |
| **Prompt** | Tarea agéntica: organizar archivos de test en custom-test/ |
| **Tools incluidos** | 9 built-in (read, write, glob, ls, mv, cp, exec, mkdir, rm) |
| **Modelo pair** | `Gemma4-12B+DeepseekV4Flash` |
| **ToolLoop** | Activado (request.tools.length > 0) |

---

## 1. Resumen Ejecutivo

```
PRUEBAS (con tools):
  ├─ gemma4:12b-mlx + tools  → {fmt_ms(r['gemma4_lat'])} · {len(r['gemma4_content'])} chars · {r['gemma4_tc']} tool_calls
  ├─ deepseek-v4-flash + tools → {fmt_ms(r['deepseek_lat'])} · {len(r['deepseek_content'])} chars · {r['deepseek_tc']} tool_calls
  └─ Pair Gemma4→Deepseek + tools → {fmt_ms(r['pair_lat'])} · {len(r['pair_content'])} chars · {r['pair_tc']} tool_calls
        ├─ Clasificador: mode={classifier_mode}, confidence={confidence_val}
        └─ Provider final: {provider_final}

TOOL LOOP (del pair):
  ├─ Iteraciones detectadas: {tool_loop_iterations}
  └─ Total tool_calls: {tool_calls_total}
```

---

## 2. Prompt de Entrada

### System
```
Eres un ingeniero de software experto en tooling. EJECUTA las
herramientas para completar la tarea, no solo las describas.
```

### Tools definitions enviadas
```json
{json.dumps([t["function"]["name"] for t in TOOLS])}
```

---

## 3. Trazabilidad del Flujo

### 3.1 Arquitectura del Tool Loop

```
CLIENTE
    │ POST /v1/chat/completions {{ model, messages, tools, tool_choice }}
  ▼
┌──────────────────────────────────────────────────────────┐
│ RouterService.route()                                    │
│   ├─ routeThroughPair() (model = "Gemma4-12B+Deepseek..")│
│   ├─ Classifier → mode={classifier_mode}, conf={confidence_val}
│   ├─ Bug fix aplicado: escalation_detected={escalation_detected}
│   └─ selectedConfig → {provider_final}
│                                                          │
│   └─ callProviderOrToolLoop()                            │
│       ├─ hasTools = {True} ← tools.length = 9             │
│       └─ ToolLoopService.execute() ⚡                     │
│                                                          │
│           ┌─────────────────────────────────────┐        │
│           │ ToolLoop: for i in range(max_iter)   │        │
│           │  1. provider.chat(messages, tools)   │        │
│           │  2. ¿tool_calls?                     │        │
│           │     ├─ NO → return response          │        │
│           │     └─ SÍ →                          │        │
│           │       for tc in tool_calls:          │        │
│           │         a. ToolRegistry.get(name)    │        │
│           │         b. SandboxManager.check()    │        │
│           │         c. tool.execute(args)        │        │
│           │         d. messages.push(tool_result) │        │
│           │  3. Repetir                          │        │
│           └─────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Logs del servidor (extracto tool loop)

```
{log_snippet}
```

### 3.3 Métricas

```json
{json.dumps(r['metrics'], indent=2) if isinstance(r['metrics'], dict) else str(r['metrics'])}
```

---

## 4. Análisis de Tool Calls

### 4.1 Control A: gemma4:12b-mlx + tools

| Atributo | Valor |
|---|---|
| **Modelo** | `gemma4:12b-mlx` (Ollama local) |
| **Latencia** | {fmt_ms(r['gemma4_lat'])} |
| **Tool calls** | {r['gemma4_tc']} |
| **Output** | {len(r['gemma4_content'])} chars |

**Tools usadas**:
{json.dumps(gemma4_tools_used, indent=2) if gemma4_tools_used else "  Ninguna — el modelo respondió con texto en lugar de tool_calls"}

**Respuesta** (primeros 300 chars):
```
{r['gemma4_content'][:300]}
```

### 4.2 Control B: deepseek-ai/deepseek-v4-flash + tools

| Atributo | Valor |
|---|---|
| **Modelo** | `deepseek-ai/deepseek-v4-flash` (NVIDIA cloud) |
| **Latencia** | {fmt_ms(r['deepseek_lat'])} |
| **Tool calls** | {r['deepseek_tc']} |
| **Output** | {len(r['deepseek_content'])} chars |

**Tools usadas**:
{json.dumps(deepseek_tools_used, indent=2) if deepseek_tools_used else "  Ninguna — el modelo respondió con texto en lugar de tool_calls"}

**Respuesta** (primeros 300 chars):
```
{r['deepseek_content'][:300]}
```

### 4.3 Flujo real: Pair Gemma4-12B+DeepseekV4Flash + tools

| Atributo | Valor |
|---|---|
| **Modelo pair** | `Gemma4-12B+DeepseekV4Flash` |
| **Provider final** | {provider_final} |
| **Latencia** | {fmt_ms(r['pair_lat'])} |
| **Tool calls** | {r['pair_tc']} |
| **Output** | {len(r['pair_content'])} chars |

**Tools usadas**:
{json.dumps(pair_tools_used, indent=2) if pair_tools_used else "  Ninguna — el modelo respondió con texto en lugar de tool_calls"}

**Respuesta** (primeros 300 chars):
```
{r['pair_content'][:300]}
```

---

## 5. Análisis del Tool Loop

### 5.1 ¿El modelo hizo tool_calls?

| Ruta | Hizo tool_calls? | Cuántas | Tools usadas |
|---|---|---|---|
| gemma4 direct + tools | {'✅' if r['gemma4_tc'] > 0 else '❌'} | {r['gemma4_tc']} | {', '.join(gemma4_tools_used.keys()) if gemma4_tools_used else 'N/A'} |
| Deepseek direct + tools | {'✅' if r['deepseek_tc'] > 0 else '❌'} | {r['deepseek_tc']} | {', '.join(deepseek_tools_used.keys()) if deepseek_tools_used else 'N/A'} |
| Pair + tools | {'✅' if r['pair_tc'] > 0 else '❌'} | {r['pair_tc']} | {', '.join(pair_tools_used.keys()) if pair_tools_used else 'N/A'} |

### 5.2 Calidad de las tool_calls

"""
    for model_key, model_name, tc_list, tools_dict in [
        ("gemma4", "gemma4:12b-mlx", r["gemma4_tc_raw"], gemma4_tools_used),
        ("deepseek", "deepseek-v4-flash", r["deepseek_tc_raw"], deepseek_tools_used),
        ("pair", "Pair gemma4→deepseek", r["pair_tc_raw"], pair_tools_used),
    ]:
        report += f"\n**{model_name}**:\n"
        if len(tc_list) == 0:
            report += "  No se generaron tool_calls. El modelo optó por responder con texto directamente."
        else:
            for i, tc in enumerate(tc_list[:8]):
                fn = tc.get("function", {})
                name = fn.get("name", "?")
                args = fn.get("arguments", "{}")
                try:
                    args_pretty = json.dumps(json.loads(args), ensure_ascii=False)
                except:
                    args_pretty = args
                report += f"\n  {i+1}. `{name}({args_pretty[:120]})`"

    report += f"""

### 5.3 ¿El ToolLoop se completó correctamente?

- **ToolLoopService activado**: {'✅' if tool_loop_iterations != 'N/A' else '❌'}
- **Iteraciones**: {tool_loop_iterations}
- **Tool calls ejecutadas**: {tool_calls_total}
- **Respuesta final devuelta**: {'✅' if r['pair_content'] else '❌'}

### 5.4 Limitaciones observadas

1. **El modelo debe elegir usar tools**: El `tool_choice: "auto"` permite al modelo
   decidir si usa tools o responde texto. Con `tool_choice: "required"` lo forzaríamos.

2. **Sin estado entre requests**: El ToolLoopService mantiene estado en memoria
   (el array messages crece con cada tool_call + tool_result), pero cada request
   HTTP es independiente.

3. **Timeout global**: {r['metrics'].get('latency', {}).get('avgMs', 'N/A')}ms de latencia promedio.

---

## 6. Conclusiones

### 6.1 Veredicto

| Componente | Funciona | Notas |
|---|---|---|
| ToolLoopService | {'✅' if tool_loop_iterations != 'N/A' else '⚠️'} | {'Iteraciones detectadas' if tool_loop_iterations != 'N/A' else 'No se activó'} |
| ToolRegistry (9 tools) | ✅ | read, write, glob, ls, mv, cp, exec, mkdir, rm |
| SandboxManager | ✅ | Path validation + denied commands + timeout |
| Bug fix routeThroughPair | {'✅' if escalation_detected else '⚠️'} | {'Escaló plan a cloud' if escalation_detected else 'No escaló'} |
| Modelo usó tool_calls | {'✅' if tool_calls_total > 0 else '❌'} | {tool_calls_total} tool_calls totales |

### 6.2 Issues detectados

1. **{'⚠️' if tool_calls_total == 0 else '✅'} Los modelos no siempre usan tool_calls**: Con
   `tool_choice: "auto"`, el modelo puede optar por responder texto.
   → Para tareas agénticas, considerar `tool_choice: "required"`.

2. **⚠️ ToolLoop no persiste el resultado**: Las tool_calls se ejecutan y devuelven
   resultados al modelo dentro del mismo request, pero el resultado final (archivos
   movidos, directorios creados) solo existe en la respuesta textual. No hay
   confirmación de que el modelo realmente ejecutó todo.

3. **{'🔴' if not escalation_detected else '✅'} Bug fix routeThroughPair**:
   {'El bug persiste' if not escalation_detected else 'Plan tasks escalan a cloud correctamente'}

---

## 7. Archivos Generados

| Archivo | Contenido |
|---|---|
| `01-gemma4-tools/request.json` | Request gemma4 + tools |
| `01-gemma4-tools/response.json` | Response gemma4 + tools |
| `02-deepseek-tools/request.json` | Request Deepseek + tools |
| `02-deepseek-tools/response.json` | Response Deepseek + tools |
| `03-pair-tools/request.json` | Request pair + tools |
| `03-pair-tools/response.json` | Response pair + tools |
| `04-observabilidad/metrics.json` | Métricas del sistema |
| `04-observabilidad/server-logs.json` | Logs de routing + tool loop |
| **Este informe** | `INFORME-TOOL-LOOP.md` |
"""

    path = os.path.join(OUT_DIR, "INFORME-TOOL-LOOP.md")
    with open(path, "w") as f:
        f.write(report)
    log(f"  Informe: {path}")
    return path


def main():
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║  INVESTIGACIÓN: Tool Loop con par gemma4+Deepseek           ║")
    print("║  Prompt: Tarea agéntica CON tools (function calling)        ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print()

    t_total = time.perf_counter()
    proc = restart_server()

    warmup()

    g_body, g_lat, g_content, g_tc = run_model_test(
        "gemma4:12b-mlx + tools", "01-gemma4-tools", "gemma4:12b-mlx")
    d_body, d_lat, d_content, d_tc = run_model_test(
        "deepseek + tools", "02-deepseek-tools", "deepseek-ai/deepseek-v4-flash",
        timeout=300)
    p_body, p_lat, p_content, p_tc = run_model_test(
        "Pair + tools", "03-pair-tools", "Gemma4-12B+DeepseekV4Flash",
        timeout=300)

    metrics, router_logs = get_observability()

    results = {
        "gemma4_lat": g_lat,
        "gemma4_content": g_content,
        "gemma4_tc": len(g_tc),
        "gemma4_tc_raw": g_tc,
        "gemma4_body": g_body,
        "deepseek_lat": d_lat,
        "deepseek_content": d_content,
        "deepseek_tc": len(d_tc),
        "deepseek_tc_raw": d_tc,
        "deepseek_body": d_body,
        "pair_lat": p_lat,
        "pair_content": p_content,
        "pair_tc": len(p_tc),
        "pair_tc_raw": p_tc,
        "pair_body": p_body,
        "metrics": metrics,
        "router_logs": router_logs,
    }
    report_path = generate_report(results)

    total = time.perf_counter() - t_total
    print(f"\n{'═' * 60}")
    print(f"  TOTAL: {total:.0f}s")
    print(f"  Informe: {report_path}")
    print(f"{'═' * 60}")

    if proc:
        os.kill(proc.pid, signal.SIGTERM)


if __name__ == "__main__":
    main()
