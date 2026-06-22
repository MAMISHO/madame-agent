#!/usr/bin/env python3
"""
Prueba: Pares Gemini con detección de modo plan/build.

Comportamiento actual (router.service.ts L241):
- plan mode → siempre escala a cloud
- build mode → clasificador decide: si es 'plan' o baja confianza → escala
"""
import json, time, os, urllib.request, urllib.error, re
from datetime import datetime, timezone

BASE_URL = "http://localhost:3001/v1"
OUT_DIR = "test-pares-gemini"
os.makedirs(OUT_DIR, exist_ok=True)

PAIRS = [
    {
        "id": "gemma-gemini",
        "name": "gemma4:12b-mlx-oc+Gemini",
        "warmup_model": "gemma4:12b-mlx-oc",
    },
    {
        "id": "qwen-gemini",
        "name": "qwen3.6:27b-oc+Gemini",
        "warmup_model": "qwen3.6:27b-oc",
    },
]

TASK_PROMPT = """En el actual proyecto /Users/mamisho/dev/madame-agent

Se han hecho un par de pruebas al agente, donde se ha solicitado generar scripts para poner a prueba la solución software que se desarrolla. Dichos scripts además generan directorios con los resultados de las pruebas.

Tu tarea es identificar los ficheros implicados en las pruebas, ordenarlos dentro de un directorio llamado custom-test. Dentro tendrás/crearás un subdirectorio para cada prueba donde moverás los scripts, los directorios de cada prueba correspondiente, renombrando los directorios con un nombre secuencial e identificativo de la prueba de tal manera que sea reconocible qué script y pruebas pertenecen a cada set de prueba, quedando así las ejecuciones de las pruebas ordenada y que se vean en similar orden."""

PLAN_SYSTEM = "You are in planning mode. Analyze the task and provide a detailed plan."
BUILD_SYSTEM = "You are in active development mode / build mode. Execute the task directly."

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

def extract_content(response):
    if "error" in response: return f"[ERROR: {response['error']}]"
    choices = response.get("choices", [])
    if not choices: return "[sin choices]"
    msg = choices[0].get("message", {})
    return msg.get("content", "") or "[sin content]"

def detect_provider(response):
    """Detecta provider real por extra_content en la respuesta."""
    if "error" in response: return "ERROR"
    choices = response.get("choices", [])
    if not choices: return "sin_choices"
    msg = choices[0].get("message", {})
    extra = msg.get("extra_content", {}) or {}
    if "google" in extra: return "Google Gemini (cloud)"
    if "nvidia" in extra: return "NVIDIA (cloud)"
    if not extra: return "Ollama (local)"
    return f"desconocido"

def check_server():
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=3) as r:
            h = json.loads(r.read().decode())
            log(f"  Server OK")
            return True
    except Exception as e:
        log(f"  Server NOT reachable: {e}")
        return False

def read_logs():
    try:
        with open("/tmp/madame-agent.log") as f:
            return [l.strip() for l in f.readlines()]
    except Exception as e:
        return [f"WARN: {e}"]

def extract_pair_logs(logs):
    """Extrae líneas de Pair de los logs, incluyendo la última de cada test."""
    pair_lines = []
    for line in logs:
        if 'Pair "' in line and 'systemMode' in line:
            pair_lines.append(line)
    return pair_lines

def warmup_model(model_name):
    log(f"\nWarming up {model_name}...")
    t0 = time.perf_counter()
    body, lat = api_call("chat/completions", {
        "model": model_name,
        "messages": [{"role": "user", "content": "decime solo: OK"}],
        "max_tokens": 10, "temperature": 0.1,
    })
    log(f"  {time.perf_counter()-t0:.1f}s")

def test_mode(pair_id, pair_name, mode_label, system_prompt):
    label = f"{pair_id}/{mode_label}"
    log(f"\n[{label}]")
    payload = {
        "model": pair_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": TASK_PROMPT},
        ],
        "max_tokens": 1024, "temperature": 0.3,
    }
    save_json(label, "request.json", payload)
    body, lat = api_call("chat/completions", payload, timeout=300)
    save_json(label, "response.json", body)
    provider = detect_provider(body)
    content_len = len(extract_content(body))
    log(f"  → {fmt_ms(lat)} | {content_len} chars | {provider}")
    return {"pair": pair_name, "mode": mode_label, "latency": lat, "chars": content_len, "provider": provider}

def main():
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║  PRUEBA: Pares Gemini — plan/build routing                 ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    if not check_server(): return

    all_results = []
    t_total = time.perf_counter()

    for pair in PAIRS:
        warmup_model(pair["warmup_model"])
        all_results.append(test_mode(pair["id"], pair["name"], "plan", PLAN_SYSTEM))
        all_results.append(test_mode(pair["id"], pair["name"], "build", BUILD_SYSTEM))

    logs = read_logs()
    save_json("logs", "server-logs.json", logs[-300:])

    # Mostrar línea de Pair del server para cada test
    pair_logs = extract_pair_logs(logs)
    log(f"\n── Logs de ruteo del server ──")
    for l in pair_logs[-6:]:
        log(f"  {l}")

    # Reporte
    print(f"\n{'═' * 60}")
    print(f"  RESULTADOS")
    print(f"{'─' * 60}")
    for r in all_results:
        expected_cloud = "si" if r["mode"] == "plan" else "segun clasificador"
        ok = "✅" if (r["mode"] == "plan" and "cloud" in r["provider"]) or \
                     (r["mode"] == "build") else "❌"
        print(f"  {ok} {r['pair']:35s} | {r['mode']:5s} | {fmt_ms(r['latency']):>8s} | {r['provider']}")
    print(f"{'═' * 60}")
    print(f"  TOTAL: {(time.perf_counter()-t_total):.0f}s")
    print(f"  Datos: {OUT_DIR}/")
    print(f"{'═' * 60}")

if __name__ == "__main__":
    main()
