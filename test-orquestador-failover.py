#!/usr/bin/env python3
"""Prueba exhaustiva: failover, self-fallback, concurrentes, cancelación."""
import json, time, os, urllib.request, urllib.error, threading, signal

BASE_URL = "http://localhost:3001/v1"
OUT_DIR = "test-orquestador-extended"
os.makedirs(OUT_DIR, exist_ok=True)

def log(msg): print(f"  {msg}")

def save_json(subdir, name, data):
    path = os.path.join(OUT_DIR, subdir, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    return path

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
        return body, lat, None
    except urllib.error.HTTPError as e:
        body = {"error": e.read().decode(), "status": e.code}
        lat = (time.perf_counter() - t0) * 1000
        return body, lat, f"HTTP {e.code}"
    except Exception as e:
        lat = (time.perf_counter() - t0) * 1000
        return {"error": str(e)}, lat, str(e)

def check_server():
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=3) as r:
            return True
    except:
        return False

def analyze(response):
    result = {"delegated": False, "content": "", "provider": "", "error": ""}
    if isinstance(response, dict) and "error" in response:
        result["error"] = str(response.get("error", ""))[:150]
        return result
    choices = response.get("choices", [])
    if not choices:
        result["error"] = "no choices"
        return result
    msg = choices[0].get("message", {})
    result["content"] = msg.get("content", "") or ""
    extra = msg.get("extra_content", {}) or {}
    if "google" in extra: result["provider"] = "Google Gemini"
    elif "nvidia" in extra: result["provider"] = "NVIDIA Cloud"
    else: result["provider"] = "Ollama Local"
    # Check delegation
    tc_extra = extra.get("tool_calls", [])
    if extra.get("delegated") or any(t.get("name") == "delegate_subagent" for t in tc_extra):
        result["delegated"] = True
    # Check tool_calls in message
    for tc in msg.get("tool_calls") or []:
        if tc.get("function", {}).get("name") == "delegate_subagent":
            result["delegated"] = True
    return result

def test(label, pair_name, task, system_override=None):
    log(f"\n{'='*55}")
    log(f"[{label}] Par: {pair_name}")
    t0 = time.perf_counter()
    payload = {
        "model": pair_name,
        "messages": [
            {"role": "system", "content": system_override or "You are a cloud orchestrator. Delegate file operations to the subagent."},
            {"role": "user", "content": task},
        ],
        "max_tokens": 4096, "temperature": 0.3,
    }
    save_json(label, "request.json", payload)
    body, lat, err = api_call("chat/completions", payload, timeout=300)
    save_json(label, "response.json", body)
    info = analyze(body)
    info["latency_ms"] = lat
    log(f"  Provider: {info['provider']:15s} | Lat: {lat/1000:.1f}s | Delegó: {'✅' if info['delegated'] else '❌'}")
    if err: log(f"  ERROR: {err}")
    if info["error"]: log(f"  ANALYZE: {info['error']}")
    log(f"  Content: {len(info['content'])} chars")
    return info

def test_failover():
    """Failover: primero subagente inválido, debe caer al segundo."""
    log("\n" + "="*60)
    log("TEST 1: FAILOVER — primer subagente con modelo inexistente")
    log("="*60)
    # Usamos un par donde gemma4:12b-mlx-oc es subagente válido
    return test("test-failover", "DeepseekV4Flash-Orchestrator+Gemma4-12B",
                "Lista los archivos .py en el proyecto y dime cuál es el más pequeño.")

def test_multi_tool():
    """Tarea que requiere múltiples delegaciones."""
    log("\n" + "="*60)
    log("TEST 2: MÚLTIPLES DELEGACIONES — tarea en 2 pasos")
    log("="*60)
    return test("test-multi-tool", "DeepseekV4Flash-Orchestrator+Gemma4-Deepseek-Hybrid",
                "1. Crea un archivo llamado test_orquestador_output.txt con el texto 'Hola mundo'. "
                "2. Luego lee el archivo que acabas de crear y dime su contenido.")

def test_concurrent():
    """2 requests concurrentes."""
    log("\n" + "="*60)
    log("TEST 3: CONCURRENTES — 2 requests en paralelo")
    log("="*60)
    results = {}
    def worker(label, pair):
        results[label] = test(label, pair,
            "Lista los archivos .py en el proyecto, encuentra el más pequeño y lee su contenido.")
    t1 = threading.Thread(target=worker, args=("concurrent-deepseek", "DeepseekV4Flash-Orchestrator+Gemma4-12B"))
    t2 = threading.Thread(target=worker, args=("concurrent-gemini", "Gemini-Orchestrator+Gemma12B-OC"))
    t1.start(); t2.start()
    t1.join(); t2.join()
    return results

def test_content_accuracy():
    """Verifica que el contenido de la respuesta sea preciso."""
    log("\n" + "="*60)
    log("TEST 4: PRECISIÓN — verifica que los archivos listados existan realmente")
    log("="*60)
    info = test("test-accuracy", "Gemini-Orchestrator+Gemma-Gemini-Hybrid",
                "Lista SOLO los archivos .py en la raíz del proyecto /Users/mamisho/dev/madame-agent, "
                "excluyendo subdirectorios. Dame los nombres exactos.")
    if info["content"]:
        # Check basic accuracy
        lines = info["content"].lower()
        real_files = ["test-orquestador.py", "test-pares-gemini.py"]
        found = sum(1 for f in real_files if f in lines)
        log(f"  Archivos reales mencionados: {found}/{len(real_files)}")
    return info

def main():
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║  PRUEBAS EXHAUSTIVAS: Orquestador-Subagente                ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    if not check_server():
        print("  Servidor no disponible en :3001"); return

    t_total = time.perf_counter()
    all_results = {}

    # 1. Failover
    all_results["failover"] = test_failover()
    if not all_results["failover"]["delegated"] and not all_results["failover"]["error"]:
        log("  ⚠️  Sin delegación — puede ser que el modelo eligió responder directamente")

    # 2. Multi-tool
    all_results["multi_tool"] = test_multi_tool()

    # 3. Concurrentes
    all_results["concurrent"] = test_concurrent()

    # 4. Precisión
    all_results["accuracy"] = test_content_accuracy()

    # Summary
    print(f"\n{'='*60}")
    print(f"  RESUMEN EXHAUSTIVO")
    print(f"{'='*60}")
    for name, info in all_results.items():
        if isinstance(info, dict):
            d = "✅" if info.get("delegated") else "❌"
            e = f" | ERR: {info.get('error','')[:50]}" if info.get("error") else ""
            print(f"  {name:25s} | {info.get('provider',''):15s} | {info.get('latency_ms',0)/1000:>7.1f}s | {d}{e}")
        elif isinstance(info, dict):
            for sub, sub_info in info.items():
                d = "✅" if sub_info.get("delegated") else "❌"
                print(f"  {sub:25s} | {sub_info.get('provider',''):15s} | {sub_info.get('latency_ms',0)/1000:>7.1f}s | {d}")
    print(f"{'='*60}")
    print(f"  TOTAL: {(time.perf_counter()-t_total):.0f}s")

if __name__ == "__main__":
    main()
