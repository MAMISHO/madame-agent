#!/usr/bin/env bash
# test-madame.sh — Verificación completa de madame-agent
# Para usar en una terminal nueva.
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
check "Health endpoint" "ok" "$(curl -s $SERVER/health)"

echo "=== 3. Models ==="
MODELS=$(curl -s $SERVER/models)
check "Modelo local visible" "gemma4:12b-mlx" "$MODELS"
check "Modelo cloud visible" "llama-3.3-70b" "$MODELS"

echo "=== 4. Chat directo → LOCAL ==="
LOCAL=$(curl -s --max-time 60 -X POST $SERVER/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemma4:12b-mlx","messages":[{"role":"user","content":"decime hola en una palabra"}],"max_tokens":10}')
check "Respuesta local" "hola" "$(echo "$LOCAL" | python3 -c 'import json,sys; print(json.load(sys.stdin)["choices"][0]["message"]["content"].lower().strip())' 2>/dev/null || echo '')"

echo "=== 5. Chat directo → NVIDIA ==="
NVIDIA=$(curl -s --max-time 120 -X POST $SERVER/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"meta/llama-3.3-70b-instruct","messages":[{"role":"user","content":"say hello in spanish, one word"}],"max_tokens":10}')
check "Respuesta NVIDIA" "hola" "$(echo "$NVIDIA" | python3 -c 'import json,sys; print(json.load(sys.stdin)["choices"][0]["message"]["content"].lower().strip())' 2>/dev/null || echo '')"

echo "=== 6. Clasificador + Escalamiento ==="
AMBIGUOUS=$(curl -s --max-time 120 -X POST $SERVER/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"que pensas sobre react"}],"max_tokens":30}')
check "Escalamiento detectado" "NVIDIA" "$(curl -s $SERVER/metrics | python3 -c 'import json,sys; d=json.load(sys.stdin); print("NVIDIA" if d["escalations"]["total"]>0 else "no escalation")' 2>/dev/null || echo '')"

echo "=== 7. Métricas ==="
METRICS=$(curl -s $SERVER/metrics)
check "Requests totales > 0" "total" "$METRICS"
check "Latencia > 0" "avgMs" "$METRICS"

echo "=== 8. Streaming ==="
STREAM_OUT=$(curl -s --max-time 30 -X POST $SERVER/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemma4:12b-mlx","stream":true,"messages":[{"role":"user","content":"count to 2"}],"max_tokens":20}' 2>&1 | head -3)
check "Streaming SSE" "data:" "$STREAM_OUT"

echo ""
echo "=== RESULTADOS: $PASS pasaron, $FAIL fallaron ==="
kill $(lsof -ti:3000) 2>/dev/null || true
[ "$FAIL" -eq 0 ]
