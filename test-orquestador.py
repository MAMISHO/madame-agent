#!/usr/bin/env python3
"""
Prueba: Orquestador-Subagente — pares Deepseek y Google (Gemini).
Genera informe similar a test-pares-gemini.

Flujo: Cloud orquestador → tool delegate_subagent → subagente local ejecuta
"""
import json, time, os, urllib.request, urllib.error
from datetime import datetime, timezone

BASE_URL = "http://localhost:3001/v1"
OUT_DIR = "test-orquestador"
os.makedirs(OUT_DIR, exist_ok=True)

ORCH_PAIRS = [
    {
        "id": "deepseek-gemma-orch",
        "name": "DeepseekV4Flash-Orchestrator+Gemma4-12B",
        "tipo": "Deepseek (directo)",
        "orchestrator_expected": "nvidia",
        "warmup": "gemma4:12b-mlx-oc",
    },
    {
        "id": "deepseek-gemma-hybrid-orch",
        "name": "DeepseekV4Flash-Orchestrator+Gemma4-Deepseek-Hybrid",
        "tipo": "Deepseek (hibrido pair)",
        "orchestrator_expected": "nvidia",
        "warmup": "gemma4:12b-mlx-oc",
    },
    {
        "id": "gemini-gemma-oc-orch",
        "name": "Gemini-Orchestrator+Gemma12B-OC",
        "tipo": "Gemini (directo)",
        "orchestrator_expected": "google",
        "warmup": "gemma4:12b-mlx-oc",
    },
    {
        "id": "gemini-gemma-hybrid-orch",
        "name": "Gemini-Orchestrator+Gemma-Gemini-Hybrid",
        "tipo": "Gemini (hibrido pair)",
        "orchestrator_expected": "google",
        "warmup": "gemma4:12b-mlx-oc",
    },
]

TASK = """En el proyecto /Users/mamisho/dev/madame-agent, lista los archivos .py, lee el contenido del más pequeño y dime de qué se trata. Usa tu subagente para las operaciones de archivos."""

def log(msg):
    print(f"  {msg}")

def save_json(subdir, name, data):
    path = os.path.join(OUT_DIR, subdir, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    return path

def fmt_ms(ms):
    if ms < 1000: return f"{ms:.0f}ms"
    return f"{ms/1000:.1f}s"

def fmt_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

def api_call(endpoint, payload, timeout=300):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/{endpoint}", data=data,
        headers={"Content-Type": "application/json"}, method="POST",
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

def get_metrics():
    with urllib.request.urlopen(f"{BASE_URL}/metrics", timeout=5) as r:
        return json.loads(r.read().decode())

def get_subagents():
    try:
        with urllib.request.urlopen(f"{BASE_URL}/subagents/active", timeout=5) as r:
            return json.loads(r.read().decode())
    except:
        return {"error": "no endpoint"}

def check_server():
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=3) as r:
            return True
    except:
        return False

def detect_provider(response):
    if "error" in response: return "ERROR", response.get("error",{}).get("message","")[:100]
    choices = response.get("choices", [])
    if not choices: return "sin_choices", ""
    msg = choices[0].get("message", {})
    extra = msg.get("extra_content", {}) or {}
    if "google" in extra: return "Google Gemini", ""
    if "nvidia" in extra: return "NVIDIA Cloud", ""
    if not extra: return "Ollama Local", ""
    return f"desconocido({list(extra.keys())})", ""

def analyze_response(response):
    result = {"provider": "", "model": "", "content": "", "tool_calls": [], "delegated": False, "error": ""}
    if "error" in response:
        msg = response.get("error", {})
        if isinstance(msg, dict): msg = msg.get("message", str(msg))
        result["error"] = str(msg)[:200]
        return result
    choices = response.get("choices", [])
    if not choices: return result
    msg = choices[0].get("message", {})
    result["provider"], _ = detect_provider(response)
    result["model"] = response.get("model", "")
    result["content"] = msg.get("content", "") or ""
    result["tool_calls"] = msg.get("tool_calls") or []
    for tc in result["tool_calls"]:
        if tc.get("function", {}).get("name") == "delegate_subagent":
            result["delegated"] = True
    # Also check injected metadata in extra_content
    extra = msg.get("extra_content", {}) or {}
    if extra.get("delegated") or any(tc.get("name") == "delegate_subagent" for tc in extra.get("tool_calls", [])):
        result["delegated"] = True
    return result

def warmup_model(model_name):
    log(f"Warming up {model_name}...")
    t0 = time.perf_counter()
    api_call("chat/completions", {
        "model": model_name,
        "messages": [{"role": "user", "content": "decime solo: OK"}],
        "max_tokens": 10, "temperature": 0.1,
    })
    log(f"  {time.perf_counter()-t0:.1f}s")

def test_orch(pair):
    pid = pair["id"]
    pname = pair["name"]
    label = pid

    log(f"\n{'='*55}")
    log(f"[{label}]")
    log(f"  Par: {pname}")
    log(f"  Tipo: {pair['tipo']}")

    payload = {
        "model": pname,
        "messages": [
            {
                "role": "system",
                "content": "You are a cloud orchestrator with a local subagent available via delegate_subagent. "
                           "For any file operations, delegate to the subagent and return its result."
            },
            {"role": "user", "content": TASK},
        ],
        "max_tokens": 4096,
        "temperature": 0.3,
    }
    save_json(label, "request.json", payload)

    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", payload, timeout=300)
    elapsed = time.perf_counter() - t0
    save_json(label, "response.json", body)

    info = analyze_response(body)
    info["latency"] = lat
    info["pair_name"] = pname
    info["pair_tipo"] = pair["tipo"]

    log(f"  Provider: {info['provider']:15s} | Model: {info['model'][:35]}")
    log(f"  Latencia: {fmt_ms(lat):>8s} | Content: {len(info['content'])} chars")
    log(f"  Tool calls: {len(info['tool_calls'])} | Delegó: {'✅' if info['delegated'] else '❌'}")

    if info["error"]:
        log(f"  ERROR: {info['error'][:100]}")

    if info["tool_calls"]:
        for tc in info["tool_calls"][:3]:
            fn = tc.get("function", {})
            args = fn.get("arguments", "{}")[:100]
            log(f"    ⚡ {fn.get('name','?')}({args})")

    return info

def main():
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║  PRUEBA: Orquestador Cloud → Subagente Local               ║")
    print("║  Pares: Deepseek (NVIDIA) + Gemini (Google)                ║")
    print("╚══════════════════════════════════════════════════════════════╝")

    if not check_server():
        print("  Servidor no disponible en :3001"); return

    t_total = time.perf_counter()
    all_results = []

    warmed = set()
    for pair in ORCH_PAIRS:
        wm = pair["warmup"]
        if wm not in warmed:
            warmup_model(wm)
            warmed.add(wm)
        r = test_orch(pair)
        all_results.append(r)

    metrics = get_metrics()
    subagents = get_subagents()
    save_json("logs", "metrics.json", metrics)
    save_json("logs", "subagents-active.json", subagents)

    # Report
    now = fmt_now()
    rows = ""
    for r in all_results:
        delegated = "✅" if r["delegated"] else "❌"
        dstatus = "Delegó" if r["delegated"] else "No delegó"
        err = f" ({r['error'][:50]})" if r["error"] else ""
        rows += (
            f"| {r['pair_name'][:45]:45s} | {r['pair_tipo']:20s} | "
            f"{r['provider']:15s} | {fmt_ms(r['latency']):>8s} | "
            f"{len(r['content']):>4d} | {delegated} |{err}\n"
        )

    report = f"""# Prueba: Orquestador-Subagente — Deepseek + Gemini

**Fecha**: {now}
**Task**: Listar .py, leer el más pequeño, resumir

## Resumen

| Par | Tipo | Provider | Latencia | Output chars | Delegó |
|---|---|---|---|---|---|
{rows}

## Métricas del servidor

```json
{json.dumps(metrics, indent=2)}
```

## Subagentes activos

```json
{json.dumps(subagents, indent=2)[:500]}
```

## Metodología

- Se llama al orquestador pair por nombre
- El server inyecta automáticamente la tool `delegate_subagent`
- El modelo orquestador (cloud) decide si delegar al subagente local
- El subagente ejecuta herramientas de filesystem y devuelve resultado
- Failover: si el primer subagente falla, intenta el siguiente
"""
    path = os.path.join(OUT_DIR, "INFORME-ORQUESTADOR.md")
    with open(path, "w") as f:
        f.write(report)

    print(f"\n{'='*60}")
    print(f"  RESUMEN")
    print(f"{'='*60}")
    for r in all_results:
        d = "✅ Delegó" if r["delegated"] else "❌ No delegó"
        e = f" | {r['error'][:60]}" if r["error"] else ""
        print(f"  {r['pair_name'][:48]:48s} | {r['provider']:13s} | {fmt_ms(r['latency']):>8s} | {d}{e}")
    print(f"{'='*60}")
    print(f"  {metrics['requests']['total']} requests | byProvider: {json.dumps(metrics['requests']['byProvider'])}")
    print(f"  TOTAL: {(time.perf_counter()-t_total):.0f}s")
    print(f"  Informe: {path}")

if __name__ == "__main__":
    main()
