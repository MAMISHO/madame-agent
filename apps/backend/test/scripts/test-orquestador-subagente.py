#!/usr/bin/env python3
"""
Prueba: Orquestador-Subagente (inverso de model pairs).

Flujo: Cloud orquestador → recibe task → delega a subagente local →
       subagente ejecuta tools → devuelve resultado.

NO reinicia el servidor. Usa :3001.
"""
import json, time, os, urllib.request, urllib.error, re
from datetime import datetime, timezone

BASE_URL = "http://localhost:3001/v1"
OUT_DIR = "test-orquestador-subagente"
os.makedirs(OUT_DIR, exist_ok=True)

ORCH_PAIRS = [
    {
        "id": "deepseek-gemma-orch",
        "name": "DeepseekV4Flash-Orchestrator+Gemma4-12B",
        "orchestrator": "Deepseek (NVIDIA)",
        "warmup": "gemma4:12b-mlx-oc",
    },
    {
        "id": "gemini-gemma-oc-orch",
        "name": "Gemini-Orchestrator+Gemma12B-OC",
        "orchestrator": "Gemini (Google)",
        "warmup": "gemma4:12b-mlx-oc",
    },
]

TASK_FS = """List the files in /Users/mamisho/dev/madame-agent, find all Python test files (*.py), and tell me how many there are and their names."""

TASK_AGENTIC = """En el proyecto /Users/mamisho/dev/madame-agent, identifica los scripts de prueba Python, lee el más pequeño y dime de qué se trata."""

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

def extract_content(response):
    if "error" in response: return f"[ERROR]"
    choices = response.get("choices", [])
    if not choices: return "[sin choices]"
    return choices[0].get("message", {}).get("content", "")

def extract_tool_calls(response):
    if "error" in response: return []
    choices = response.get("choices", [])
    if not choices: return []
    return choices[0].get("message", {}).get("tool_calls", [])

def detect_provider(response):
    if "error" in response: return "ERROR"
    choices = response.get("choices", [])
    if not choices: return "sin_choices"
    extra = choices[0].get("message", {}).get("extra_content", {}) or {}
    if "google" in extra: return "Google Gemini (cloud)"
    if "nvidia" in extra: return "NVIDIA (cloud)"
    if not extra: return "Ollama (local)"
    return f"desconocido"

def get_metrics():
    with urllib.request.urlopen(f"{BASE_URL}/metrics", timeout=5) as r:
        return json.loads(r.read().decode())

def get_subagents():
    try:
        with urllib.request.urlopen(f"{BASE_URL}/subagents/active", timeout=5) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}

def check_server():
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=3) as r:
            return True
    except Exception:
        return False

def warmup_model(model_name):
    log(f"Warming up {model_name}...")
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", {
        "model": model_name,
        "messages": [{"role": "user", "content": "decime solo: OK"}],
        "max_tokens": 10, "temperature": 0.1,
    })
    log(f"  {time.perf_counter()-t0:.1f}s")

def test_orchestrator(pair_id, pair_name, orch_label, task, tool_choice="auto"):
    label = f"{pair_id}/{tool_choice}"
    log(f"\n{'='*50}")
    log(f"[{label}]")
    log(f"  Orquestador: {orch_label}")

    payload = {
        "model": pair_name,
        "messages": [
            {
                "role": "system",
                "content": "You are a cloud orchestrator with access to a local subagent via the delegate_subagent tool. "
                           "For tasks that involve reading files, listing directories, or executing commands, "
                           "delegate to the subagent using delegate_subagent and return the result."
            },
            {"role": "user", "content": task},
        ],
        "tool_choice": tool_choice,
        "max_tokens": 4096,
        "temperature": 0.3,
    }
    save_json(label, "request.json", payload)
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", payload, timeout=300)
    elapsed = time.perf_counter() - t0
    save_json(label, "response.json", body)

    provider = detect_provider(body)
    content = extract_content(body)
    tool_calls = extract_tool_calls(body)

    log(f"  Provider: {provider}")
    log(f"  Latencia: {fmt_ms(lat)}")
    log(f"  Content:  {len(content)} chars")
    log(f"  Tool calls: {len(tool_calls)}")

    delegated = False
    for tc in tool_calls:
        fn = tc.get("function", {})
        if fn.get("name") == "delegate_subagent":
            delegated = True
            args = json.loads(fn.get("arguments", "{}"))
            log(f"  ⚡ delegate_subagent llamada!")
            log(f"     task: {args.get('task', '')[:100]}...")
            log(f"     subagent_model: {args.get('subagent_model', 'auto')}")

    if delegated:
        log(f"  ✅ El orquestador delegó al subagente")
    elif len(tool_calls) > 0:
        log(f"  ⚠ Llamó {len(tool_calls)} tool(s) pero ninguna fue delegate_subagent")
    else:
        log(f"  ⚠ El orquestador respondió con texto, no delegó")

    return {
        "pair": pair_name,
        "orchestrator": orch_label,
        "tool_choice": tool_choice,
        "provider": provider,
        "latency": lat,
        "content_len": len(content),
        "tool_calls": len(tool_calls),
        "delegated": delegated,
        "tool_calls_detail": tool_calls,
    }


def main():
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║  PRUEBA: Orquestador Cloud → Subagente Local               ║")
    print("║  (Inverso de model pairs — cloud delega a local)           ║")
    print("╚══════════════════════════════════════════════════════════════╝")

    if not check_server():
        print("  Servidor no disponible en :3001")
        return

    t_total = time.perf_counter()
    all_results = []

    m0 = get_metrics()
    log(f"\nRequests iniciales: {m0['requests']['total']}")

    for pair in ORCH_PAIRS:
        warmup_model(pair["warmup"])

        # Test 1: tool_choice="auto" — modelo decide si delegar
        r1 = test_orchestrator(pair["id"], pair["name"], pair["orchestrator"],
                               TASK_FS, tool_choice="auto")
        all_results.append(r1)

        # Test 2: tool_choice="required" — forzado a usar tool
        r2 = test_orchestrator(pair["id"], pair["name"], pair["orchestrator"],
                               TASK_FS, tool_choice="required")
        all_results.append(r2)

    m1 = get_metrics()
    subagents = get_subagents()

    save_json("logs", "metrics-final.json", m1)
    save_json("logs", "subagents-active.json", subagents)

    # Summary
    print(f"\n{'='*60}")
    print(f"  RESUMEN")
    print(f"{'='*60}")
    for r in all_results:
        d = "✅ Delegó" if r["delegated"] else "❌ No delegó"
        tc = f"({r['tool_calls']} tool_calls)" if r["tool_calls"] > 0 else ""
        print(f"  {r['pair'][:40]:40s} | {r['tool_choice']:8s} | {d:12s} {tc}")
    print(f"{'='*60}")
    print(f"  Total requests: {m1['requests']['total']}")
    print(f"  Por provider: {json.dumps(m1['requests']['byProvider'])}")
    print(f"  Subagentes activos: {len(subagents.get('tasks', []))}")
    print(f"  TOTAL: {(time.perf_counter()-t_total):.0f}s")
    print(f"  Datos: {OUT_DIR}/")

if __name__ == "__main__":
    main()
