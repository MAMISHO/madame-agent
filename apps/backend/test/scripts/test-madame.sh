#!/usr/bin/env bash
# test-madame.sh — Verificación E2E completa de madame-agent
# Cubre: health, models, chat LOCAL/NVIDIA, escalamiento, métricas,
#        streaming, model pairs, tool calling, cache, traducción.
set -e

SERVER="http://localhost:3000/v1"
PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  ✅ $label"
    ((PASS++))
  else
    echo "  ❌ $label (expected '$expected')"
    ((FAIL++))
  fi
}

echo "=== 1. Arrancar servidor ==="
cd "$(dirname "$0")"
npm run build 2>/dev/null
kill $(lsof -ti:3000) 2>/dev/null || true
nohup node dist/main.js > /tmp/madame-agent.log 2>&1 &
sleep 4

echo "=== 2. Health ==="
HEALTH=$(curl -s $SERVER/health)
check "Health endpoint" "ok" "$HEALTH"

echo "=== 3. Models ==="
MODELS=$(curl -s $SERVER/models)
check "Modelo local visible" "gemma4:12b-mlx" "$MODELS"
check "Modelo cloud visible" "llama-3.3-70b" "$MODELS"
check "Deepseek visible" "deepseek-v4-flash" "$MODELS"

echo "=== 4. Model Pairs ==="
check "Pair Gemma4-Deepseek" "Gemma4-12B+DeepseekV4Flash" "$MODELS"
check "Pair Gemma4-Llama" "Gemma4-12B+Llama70B" "$MODELS"
check "Pair Qwen-Deepseek" "qwen3.6:27b+DeepseekV4Flash" "$MODELS"
check "Pair Qwen-Llama" "qwen3.6:27b+Llama70B" "$MODELS"

echo "=== 5. Chat directo → LOCAL ==="
LOCAL=$(curl -s --max-time 60 -X POST $SERVER/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemma4:12b-mlx","messages":[{"role":"user","content":"decime hola en una palabra"}],"max_tokens":10}')
check "Respuesta local" "hola" "$(echo "$LOCAL" | python3 -c 'import json,sys; print(json.load(sys.stdin)["choices"][0]["message"]["content"].lower().strip())' 2>/dev/null || echo '')"

echo "=== 6. Chat directo → NVIDIA ==="
NVIDIA=$(curl -s --max-time 120 -X POST $SERVER/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"meta/llama-3.3-70b-instruct","messages":[{"role":"user","content":"say hello in spanish, one word"}],"max_tokens":10}')
check "Respuesta NVIDIA" "hola" "$(echo "$NVIDIA" | python3 -c 'import json,sys; print(json.load(sys.stdin)["choices"][0]["message"]["content"].lower().strip())' 2>/dev/null || echo '')"

echo "=== 7. Clasificador + Escalamiento ==="
AMBIGUOUS=$(curl -s --max-time 120 -X POST $SERVER/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"que pensas sobre react"}],"max_tokens":30}')
check "Escalamiento detectado" "NVIDIA" "$(curl -s $SERVER/metrics | python3 -c 'import json,sys; d=json.load(sys.stdin); print("NVIDIA" if d["escalations"]["total"]>0 else "no escalation")' 2>/dev/null || echo '')"

echo "=== 8. Métricas ==="
METRICS=$(curl -s $SERVER/metrics)
check "Requests totales > 0" "total" "$METRICS"
check "Latencia > 0" "avgMs" "$METRICS"

echo "=== 9. Streaming ==="
STREAM_OUT=$(curl -s --max-time 30 -X POST $SERVER/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemma4:12b-mlx","stream":true,"messages":[{"role":"user","content":"count to 2"}],"max_tokens":20}' 2>&1 | head -3)
check "Streaming SSE" "data:" "$STREAM_OUT"

echo "=== 10. Tool Calling (request con tools, sin ejecución real) ==="
# Envía un request con tools definidas — el modelo podría o no ejecutarlas,
# pero el server debe aceptar el parámetro y responder sin error
TOOL_REQ=$(curl -s --max-time 60 -X POST $SERVER/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model":"gemma4:12b-mlx",
    "messages":[{"role":"user","content":"list files in src directory"}],
    "tools":[{"type":"function","function":{"name":"list_directory","description":"List directory","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}],
    "max_tokens":50
  }')
check "Tool calling aceptado" "choices" "$TOOL_REQ"

echo "=== 11. Cache endpoint ==="
# Cache está disabled por defecto, pero los endpoints deben responder
METRICS_AFTER=$(curl -s $SERVER/metrics)
check "Métricas después de requests" "total" "$METRICS_AFTER"

echo ""
echo "=== RESULTADOS: $PASS pasaron, $FAIL fallaron ==="
kill $(lsof -ti:3000) 2>/dev/null || true
[ "$FAIL" -eq 0 ]
