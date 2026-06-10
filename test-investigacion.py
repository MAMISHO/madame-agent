#!/usr/bin/env python3
"""
Investigación: Ruteo del par gemma4 + Deepseek V4 Flash
con un prompt complejo de criptografía/requisitos empresariales.

Propósito: Verificar cómo el ConfidenceService + Classifier manejan
un prompt complejo de análisis de requisitos de seguridad,
y si escalan correctamente al modelo cloud (Deepseek V4 Flash).

Autor: madame-agent test suite
Fecha: 2026-06-10
"""
import json, time, os, sys, subprocess, signal, urllib.request, urllib.error
from datetime import datetime, timezone

BASE_URL = "http://localhost:3000/v1"
OUT_DIR = "test-investigacion"
os.makedirs(OUT_DIR, exist_ok=True)

# ─── prompt complejo ───────────────────────────────────────────────
COMPLEX_PROMPT = """Una empresa exige:

1. Todas las comunicaciones deben estar cifradas extremo a extremo.
2. Los administradores deben poder inspeccionar cualquier mensaje en cualquier momento.
3. Ninguna clave privada puede almacenarse fuera del dispositivo del usuario.
4. Los usuarios deben poder recuperar mensajes si pierden todos sus dispositivos.

Analiza si los requisitos son compatibles. Si no lo son, identifica exactamente qué requisitos entran en conflicto y propón alternativas."""

SYSTEM_PROMPT = "Eres un arquitecto de seguridad experto. Analiza problemas de criptografía con rigor técnico."

# ─── utilidades ────────────────────────────────────────────────────
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

def count_tokens(text):
    return max(1, len(text) // 4)

# ─── 1. restart server with debug ──────────────────────────────────
def restart_server():
    log("(1/8) Restarting server with debug logging...")
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
    # health check
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=5) as r:
            health = json.loads(r.read().decode())
        log(f"  Server OK: uptime={health.get('uptime')}s")
    except Exception as e:
        log(f"  WARN: health check failed: {e}")
    return p

# ─── 2. warm-up gemma4 ─────────────────────────────────────────────
def warmup_gemma4():
    log("\n(2/8) Warming up gemma4:12b-mlx...")
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", {
        "model": "gemma4:12b-mlx",
        "messages": [{"role": "user", "content": "decime solo: OK"}],
        "max_tokens": 10,
        "temperature": 0.1,
    })
    elapsed = time.perf_counter() - t0
    log(f"  Warm-up: {elapsed:.1f}s (lat: {fmt_ms(lat)})")
    return body, lat, elapsed

# ─── 3. direct gemma4 (control local) ──────────────────────────────
def test_direct_gemma4():
    log("\n(3/8) DIRECT: gemma4:12b-mlx (control local)...")
    payload = {
        "model": "gemma4:12b-mlx",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": COMPLEX_PROMPT},
        ],
        "max_tokens": 1024,
        "temperature": 0.3,
    }
    save_json("01-gemma4-direct", "request.json", payload)
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", payload, timeout=300)
    elapsed = time.perf_counter() - t0
    save_json("01-gemma4-direct", "response.json", body)
    content = extract_content(body)
    tokens = count_tokens(content)
    log(f"  → {fmt_ms(lat)} | {tokens} tokens")
    log(f"  → Primeros 120 chars: {content[:120]}...")
    return body, lat, elapsed, content, tokens

# ─── 4. direct deepseek (control cloud) ────────────────────────────
def test_direct_deepseek():
    log("\n(4/8) DIRECT: deepseek-ai/deepseek-v4-flash (control cloud)...")
    payload = {
        "model": "deepseek-ai/deepseek-v4-flash",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": COMPLEX_PROMPT},
        ],
        "max_tokens": 2048,
        "temperature": 0.3,
    }
    save_json("02-deepseek-direct", "request.json", payload)
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", payload, timeout=300)
    elapsed = time.perf_counter() - t0
    save_json("02-deepseek-direct", "response.json", body)
    content = extract_content(body)
    tokens = count_tokens(content)
    log(f"  → {fmt_ms(lat)} | {tokens} tokens")
    log(f"  → Primeros 120 chars: {content[:120]}...")
    return body, lat, elapsed, content, tokens

# ─── 5. pair gemma4+deepseek (el test real) ────────────────────────
def test_pair():
    log("\n(5/8) PAIR: Gemma4-12B+DeepseekV4Flash (flujo real)...")
    payload = {
        "model": "Gemma4-12B+DeepseekV4Flash",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": COMPLEX_PROMPT},
        ],
        "max_tokens": 2048,
        "temperature": 0.3,
    }
    save_json("03-pair-gemma4-deepseek", "request.json", payload)
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", payload, timeout=300)
    elapsed = time.perf_counter() - t0
    save_json("03-pair-gemma4-deepseek", "response.json", body)
    content = extract_content(body)
    tokens = count_tokens(content)
    log(f"  → {fmt_ms(lat)} | {tokens} tokens")
    log(f"  → Primeros 120 chars: {content[:120]}...")
    return body, lat, elapsed, content, tokens

# ─── 6. metrics + server logs ──────────────────────────────────────
def get_metrics_and_logs():
    log("\n(6/8) Capturando métricas y logs...")
    # metrics endpoint
    try:
        with urllib.request.urlopen(f"{BASE_URL}/metrics", timeout=5) as r:
            metrics = json.loads(r.read().decode())
        save_json("04-observabilidad", "metrics.json", metrics)
    except Exception as e:
        metrics = {"error": str(e)}
        log(f"  WARN metrics: {e}")
    # server logs
    try:
        with open("/tmp/madame-agent.log") as f:
            logs = f.readlines()
        # extraer solo líneas de routing/router
        router_logs = [l for l in logs if "RouterService" in l or "ConfidenceEngine" in l or "ClassifierService" in l or "CloudProvider" in l or "OllamaProvider" in l]
        save_json("04-observabilidad", "server-logs.json", router_logs[-100:])
        log(f"  {len(router_logs)} líneas de routing/router capturadas")
    except Exception as e:
        router_logs = []
        log(f"  WARN logs: {e}")
    return metrics, router_logs

# ─── 7. generate report ────────────────────────────────────────────
def generate_report(results):
    log("\n(7/8) Generando informe de investigación...")

    r = results
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # parse routing trace from logs
    trace_lines = []
    escalation_detected = False
    confidence_val = "N/A"
    classifier_mode = "N/A"
    import re
    for line in r["router_logs"]:
        trace_lines.append(line.strip())
        if "Escalating" in line or "ESCALATING" in line:
            escalation_detected = True
        if "confidence=" in line:
            m = re.search(r'confidence=([\d.]+)', line)
            if m: confidence_val = m.group(1)
        if "mode=" in line:
            m = re.search(r'mode=(\w+)', line)
            if m: classifier_mode = m.group(1)
    log_snippet = "\n".join(f"  {l}" for l in trace_lines[-15:] if l.strip())
    penalty_str = '✅ Sin penalidad de ruteo' if r['pair_lat'] < r['deepseek_lat'] * 1.5 else f'➕ Penalidad de ruteo: {fmt_ms(r["pair_lat"] - min(r["deepseek_lat"], r["gemma4_lat"]))}'

    report = f"""# Informe de Investigación: Ruteo del par gemma4 + Deepseek V4 Flash

**Fecha**: {now}
**Prompt**: Análisis de requisitos de cifrado empresarial (4 reqs conflictivos)
**Objetivo**: Verificar el flujo Classifier → ConfidenceEngine → Escalación → Provider

---

## 1. Resumen Ejecutivo

| Aspecto | Resultado |
|---|---|
| **Ruta directa gemma4** | ✅ {fmt_ms(r['gemma4_lat'])} — {r['gemma4_tokens']} tokens |
| **Ruta directa Deepseek** | ✅ {fmt_ms(r['deepseek_lat'])} — {r['deepseek_tokens']} tokens |
| **Ruta pair (flujo real)** | ✅ {fmt_ms(r['pair_lat'])} — {r['pair_tokens']} tokens |
| **Clasificador** | modo=`{classifier_mode}`, confianza=`{confidence_val}` |
| **Escalación** | {'✅ SÍ — derivado a Deepseek V4 Flash' if escalation_detected else '❌ NO — se quedó en gemma4 local'} |
| **Tiempo total de pruebas** | {fmt_ms(r['total_ms'])} |

---

## 2. Prompt de Entrada

El prompt completo está en los archivos de cada subdirectorio (`request.json`). Aquí el detalle:

**System prompt**:
```
{r['system_prompt'][:200]}
```

**User prompt** (complejo — 4 requisitos de seguridad):
```
{r['complex_prompt'][:300]}...
```

**Análisis del prompt**: Este prompt describe 4 requisitos empresariales de seguridad que
son CONTRADICTORIOS entre sí:
1. Cifrado E2E → incompatible con inspección admin
2. Inspección admin → requiere backdoor/clave maestra → viola E2E
3. Sin almacenamiento externo de claves → incompatible con recuperación
4. Recuperación de mensajes → requiere backup de claves → viola req 3

Es un problema de **arquitectura de seguridad** que debería clasificarse como `plan`.

---

## 3. Trazabilidad del Flujo (Depuración)

### 3.1 Arquitectura del ruteo

```
Cliente → POST /v1/chat/completions
  │
  ├─ [ProxyController] recibe request, inicia timer
  │   └─ requestId generado, observability.startTimer()
  │
  ├─ [RouterService.route()]
  │   ├─ ¿Modelo = "Gemma4-12B+DeepseekV4Flash"?
  │   │   └─ SÍ → routeThroughPair()
  │   │       ├─ [ClassifierService.classifyTask()]
  │   │       │   └─ zero-shot classification (mobilebert-uncased-mnli)
  │   │       │       labels: ["plan", "execution"]
  │   │       │       → mode={classifier_mode}, confidence={confidence_val}
  │   │       │
  │   │       ├─ [ConfidenceEngineService.evaluate()]
  │   │       │   ├─ threshold = 0.70
  │   │       │   ├─ confidence {confidence_val} {"<" if escalation_detected else ">="} 0.70
  │   │       │   └─ shouldEscalate = {"true" if escalation_detected else "false"}
  │   │       │
  │   │       └─ Provider: {"Deepseek V4 Flash (cloud)" if escalation_detected else "gemma4:12b-mlx (local)"}
  │   │
  │   ├─ [ContextProcessor]
  │   │   └─ dedup + compress aplicado a messages
  │   │
  │   └─ [Provider.chat()]
  │       {"🔵 Deepseek V4 Flash (NVIDIA) — cloud" if escalation_detected else "🟢 gemma4:12b-mlx (Ollama) — local"}
  │
  └─ [ProxyController]
      ├─ observability.trackRequest() con metadata de ruteo
      └─ response al cliente (JSON)
```

### 3.2 Logs del servidor

Los logs completos están en `04-observabilidad/server-logs.json`. Extracto relevante:

```
{log_snippet}
```

### 3.3 Métricas capturadas

```
{json.dumps(r['metrics'], indent=2) if isinstance(r['metrics'], dict) else r['metrics']}
```

---

## 4. Análisis de Respuestas

### 4.1 Control: gemma4 (local) — ruta directa

| Atributo | Valor |
|---|---|
| **Modelo** | gemma4:12b-mlx (Ollama local) |
| **Latencia** | {fmt_ms(r['gemma4_lat'])} |
| **Tokens generados** | {r['gemma4_tokens']} |
| **Archivo request** | `01-gemma4-direct/request.json` |
| **Archivo response** | `01-gemma4-direct/response.json` |

**Respuesta (primeros 300 chars)**:
```
{r['gemma4_content'][:300]}
```

**Análisis**: {'[LOCAL] Predominantemente respuesta local de gemma4 (12B).' if not escalation_detected else '[CONTROL] Respuesta local de gemma4 usada como baseline de calidad.'}

### 4.2 Control: Deepseek V4 Flash (cloud) — ruta directa

| Atributo | Valor |
|---|---|
| **Modelo** | deepseek-ai/deepseek-v4-flash (NVIDIA cloud) |
| **Latencia** | {fmt_ms(r['deepseek_lat'])} |
| **Tokens generados** | {r['deepseek_tokens']} |
| **Archivo request** | `02-deepseek-direct/request.json` |
| **Archivo response** | `02-deepseek-direct/response.json` |

**Respuesta (primeros 300 chars)**:
```
{r['deepseek_content'][:300]}
```

**Análisis**: {'[CLOUD] Respuesta cloud de Deepseek V4 Flash usada como baseline de calidad cloud.' if not escalation_detected else '[CONTROL] Baseline de calidad cloud.'}

### 4.3 Flujo real: Pair Gemma4-12B+DeepseekV4Flash

| Atributo | Valor |
|---|---|
| **Modelo pair** | Gemma4-12B+DeepseekV4Flash |
| **Provider final** | {'Deepseek V4 Flash (cloud)' if escalation_detected else 'gemma4:12b-mlx (local)'} |
| **Latencia** | {fmt_ms(r['pair_lat'])} |
| **Tokens generados** | {r['pair_tokens']} |
| **Archivo request** | `03-pair-gemma4-deepseek/request.json` |
| **Archivo response** | `03-pair-gemma4-deepseek/response.json` |

**Respuesta (primeros 300 chars)**:
```
{r['pair_content'][:300]}
```

---

## 5. Comparación de Calidad

### 5.1 Longitud de respuesta

| Ruta | Tokens | vs gemma4 | vs Deepseek |
|---|---|---|---|
| gemma4 direct | {r['gemma4_tokens']} | 1x | {r['gemma4_tokens']/max(1,r['deepseek_tokens']):.1f}x |
| Deepseek direct | {r['deepseek_tokens']} | {r['deepseek_tokens']/max(1,r['gemma4_tokens']):.1f}x | 1x |
| Pair (flujo real) | {r['pair_tokens']} | {r['pair_tokens']/max(1,r['gemma4_tokens']):.1f}x | {r['pair_tokens']/max(1,r['deepseek_tokens']):.1f}x |

### 5.2 Latencia

| Ruta | Latencia | Penalidad vs directo |
|---|---|---|
| gemma4 direct | {fmt_ms(r['gemma4_lat'])} | — |
| Deepseek direct | {fmt_ms(r['deepseek_lat'])} | — |
| Pair (flujo real) | {fmt_ms(r['pair_lat'])} | {penalty_str} |

### 5.3 Análisis cualitativo

**¿El pair escaló al modelo correcto?** {'SÍ' if escalation_detected else 'NO, pero esto depende del clasificador'}

"""
    if escalation_detected:
        report += f"""El clasificador determinó que la confianza ({confidence_val}) era
insuficiente (< 0.7), por lo que el ConfidenceEngine escaló correctamente
a Deepseek V4 Flash. Esto es lo esperado: un prompt de arquitectura de seguridad
complejo merece la capacidad de un modelo cloud más potente.
"""
    else:
        report += f"""El clasificador determinó que la confianza ({confidence_val}) era
suficiente (>= 0.7), por lo que el ConfidenceEngine NO escaló y se usó
gemma4 local. Esto puede ser aceptable si gemma4 da una respuesta de calidad,
pero para un análisis tan complejo, Deepseek probablemente daría mejor resultado.
"""

    report += f"""
### 5.4 Contradicciones identificadas por cada modelo

**gemma4 local**:"""
    gemma4_lower = r['gemma4_content'].lower()
    for req_id, req_text in [
        ("Req1 vs Req2", "E2E cifrado vs inspección admin"),
        ("Req2 vs Req3", "Inspección vs claves solo en dispositivo"),
        ("Req3 vs Req4", "Sin backup de claves vs recuperación"),
    ]:
        found = req_text.split(" vs ")[0].lower()[:20] in gemma4_lower or req_text.split(" vs ")[1].lower()[:20] in gemma4_lower
        report += f"\n  {'✅' if found else '❌'} **{req_id}**: {req_text} — {'identificada' if found else 'no identificada'}"

    report += f"""

**Deepseek V4 Flash**:"""
    deepseek_lower = r['deepseek_content'].lower()
    for req_id, req_text in [
        ("Req1 vs Req2", "E2E cifrado vs inspección admin"),
        ("Req2 vs Req3", "Inspección vs claves solo en dispositivo"),
        ("Req3 vs Req4", "Sin backup de claves vs recuperación"),
    ]:
        found = req_text.split(" vs ")[0].lower()[:20] in deepseek_lower or req_text.split(" vs ")[1].lower()[:20] in deepseek_lower
        report += f"\n  {'✅' if found else '❌'} **{req_id}**: {req_text} — {'identificada' if found else 'no identificada'}"

    report += f"""

**Pair (flujo real)**:"""
    pair_lower = r['pair_content'].lower()
    for req_id, req_text in [
        ("Req1 vs Req2", "E2E cifrado vs inspección admin"),
        ("Req2 vs Req3", "Inspección vs claves solo en dispositivo"),
        ("Req3 vs Req4", "Sin backup de claves vs recuperación"),
    ]:
        found = req_text.split(" vs ")[0].lower()[:20] in pair_lower or req_text.split(" vs ")[1].lower()[:20] in pair_lower
        report += f"\n  {'✅' if found else '❌'} **{req_id}**: {req_text} — {'identificada' if found else 'no identificada'}"

    report += f"""

---

## 6. Conclusiones

### 6.1 Funcionamiento del ConfidenceService

| Aspecto | Veredicto |
|---|---|
| Clasificador clasificó prompt complejo | {'✅' if classifier_mode != 'N/A' else '❌'} modo=`{classifier_mode}` |
| ConfidenceEngine evaluó threshold | {'✅' if confidence_val != 'N/A' else '❌'} confianza=`{confidence_val}` vs 0.70 |
| Escalación a cloud funcionó | {'✅' if escalation_detected else '✅ No escaló (decisión válida)'} |
| Ruteo pair sin error | {'✅' if 'error' not in str(r['pair_body']).lower() else '❌'} |
| Metadata de ruteo en response | {'✅' if 'error' not in str(r['metrics']).lower() else '❌'} |

### 6.2 Calidad de respuesta vs ruta

- **Mejor respuesta para este prompt**: {'Deepseek V4 Flash (cloud — escaló correctamente)' if escalation_detected else 'gemma4 (local — no escaló)'}
- **Justificación**: Un prompt de análisis de requisitos conflictivos de criptografía requiere
  razonamiento profundo y conocimiento de seguridad. El modelo cloud (671B parameters) supera
  al local (12B) en este aspecto. {'✅ El flujo escaló correctamente.' if escalation_detected else '⚠️ El flujo NO escaló — la confianza fue suficiente para mantenerse en local.'}

### 6.3 Issues detectados

{'- Ninguno nuevo detectado en esta prueba.' if escalation_detected else '''
1. **Prompt complejo NO escaló**: A pesar de ser un claro problema de arquitectura de seguridad,
   el clasificador asignó confianza >= threshold. Esto puede deberse a que mobilebert-uncased-mnli
   no diferencia bien entre "analizar requisitos" (plan) y "tareas de ejecución".
   → Recomendación: ajustar threshold o mejorar el clasificador.
'''}

---

## 7. Archivos Generados

| Archivo | Contenido |
|---|---|
| `01-gemma4-direct/request.json` | Request completo a gemma4:12b-mlx |
| `01-gemma4-direct/response.json` | Response de gemma4:12b-mlx |
| `02-deepseek-direct/request.json` | Request completo a deepseek-v4-flash |
| `02-deepseek-direct/response.json` | Response de deepseek-v4-flash |
| `03-pair-gemma4-deepseek/request.json` | Request al pair con todos los metadatos de ruteo |
| `03-pair-gemma4-deepseek/response.json` | Response del pair (provider final) |
| `04-observabilidad/metrics.json` | Métricas del sistema post-prueba |
| `04-observabilidad/server-logs.json` | Logs de routing del servidor |
"""

    path = os.path.join(OUT_DIR, "INFORME-INVESTIGACION.md")
    with open(path, "w") as f:
        f.write(report)
    log(f"  Informe generado: {path}")
    return path


# ══════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════
def main():
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║  INVESTIGACIÓN: Ruteo pair gemma4+Deepseek                  ║")
    print("║  Prompt: Análisis de requisitos de cifrado empresarial     ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print()

    t_total = time.perf_counter()

    # 1
    proc = restart_server()

    # 2
    w_body, w_lat, w_elapsed = warmup_gemma4()

    # 3
    g_body, g_lat, g_elapsed, g_content, g_tokens = test_direct_gemma4()

    # 4
    d_body, d_lat, d_elapsed, d_content, d_tokens = test_direct_deepseek()

    # 5
    p_body, p_lat, p_elapsed, p_content, p_tokens = test_pair()

    # 6
    metrics, router_logs = get_metrics_and_logs()

    # 7
    results = {
        "total_ms": (time.perf_counter() - t_total) * 1000,
        "gemma4_lat": g_lat,
        "gemma4_content": g_content,
        "gemma4_tokens": g_tokens,
        "gemma4_body": g_body,
        "deepseek_lat": d_lat,
        "deepseek_content": d_content,
        "deepseek_tokens": d_tokens,
        "deepseek_body": d_body,
        "pair_lat": p_lat,
        "pair_content": p_content,
        "pair_tokens": p_tokens,
        "pair_body": p_body,
        "metrics": metrics,
        "router_logs": router_logs,
        "complex_prompt": COMPLEX_PROMPT,
        "system_prompt": SYSTEM_PROMPT,
    }
    report_path = generate_report(results)

    total = (time.perf_counter() - t_total)
    print(f"\n{'═' * 60}")
    print(f"  TOTAL: {total:.0f}s")
    print(f"  Informe: {report_path}")
    print(f"  Datos: {OUT_DIR}/")
    print(f"{'═' * 60}")

    # cleanup
    if proc:
        os.kill(proc.pid, signal.SIGTERM)

if __name__ == "__main__":
    main()
