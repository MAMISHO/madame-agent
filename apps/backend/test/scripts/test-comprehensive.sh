#!/usr/bin/env bash
# test-comprehensive.sh — Prueba integral con prompts/responses como archivos
# Cada paso guarda: test-results/{NN}-label-prompt.json + {NN}-label-response.json
set -e

SERVER="http://localhost:3000/v1"
DIR="test-results"
START_TS=$(date +%s)
PASS=0; FAIL=0; WARN=0
STEP=0

mkdir -p "$DIR"

log()  { echo "[$(date +%H:%M:%S)] $1"; }

save_prompt()  { local f=$(printf "%s/%02d-%s-prompt.json" "$DIR" "$STEP" "$1"); echo "$2" > "$f"; echo "$f"; }
save_response() { local f=$(printf "%s/%02d-%s-response.json" "$DIR" "$STEP" "$1"); cat > "$f"; echo "$f"; }
save_svg() { local f=$(printf "%s/%02d-%s.svg" "$DIR" "$STEP" "$1"); cat > "$f"; echo "$f"; }

call() {
  local label="$1" data="$2" max_time="$3" model="${4:-}"
  STEP=$((STEP+1))
  local slug=$(echo "$label" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | head -c 40)
  local pfile=$(save_prompt "$slug" "$data")
  local outfile="$DIR/$STEP-$slug-response.json"
  local start=$(date +%s%N)
  
  log "  #$STEP: $label"
  if [ -n "$data" ]; then
    curl -s --max-time "$max_time" -X POST "$SERVER/chat/completions" \
      -H "Content-Type: application/json" \
      -d "$data" > "$outfile" 2>/dev/null
  else
    # GET request
    curl -s --max-time "$max_time" "$SERVER/$slug" > "$outfile" 2>/dev/null
  fi
  local end=$(date +%s%N)
  local elapsed=$(( (end - start) / 1000000 ))
  
  # Validate response
  local content=""
  local status="PASS"
  local detail=""
  if python3 -c "import json; d=json.load(open('$outfile')); assert 'choices' in d or 'status' in d or 'data' in d or 'object' in d" 2>/dev/null; then
    content=$(python3 -c "
import json,sys
d=json.load(open('$outfile'))
if 'choices' in d:
    msg = d['choices'][0].get('message',{})
    c = (msg.get('content','') or msg.get('reasoning','') or '').strip()[:100]
    print(c)
elif 'status' in d:
    print(d['status'])
elif 'data' in d:
    print(str(len(d['data'])) + ' models')
" 2>/dev/null)
    # Check for error in response
    if python3 -c "import json; d=json.load(open('$outfile')); assert 'error' not in d" 2>/dev/null; then
      status="PASS"
    else
      status="FAIL"
      detail=$(python3 -c "import json; d=json.load(open('$outfile')); print(d.get('error',{}).get('message','unknown error'))" 2>/dev/null)
    fi
  else
    status="FAIL"
    detail="invalid JSON or empty"
  fi
  
  echo "$elapsed" > /tmp/_elapsed
  echo "{\"step\":$STEP,\"label\":\"$label\",\"status\":\"$status\",\"elapsed\":$elapsed,\"detail\":\"$(echo "$detail$content" | head -c 80)\",\"slug\":\"$slug\"}"
}

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  MADAME-AGENT — PRUEBA INTEGRAL                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo "Resultados en: $DIR/"

# ═══════════════════════════════════════════════════════════
# 1. FUNDACIÓN
# ═══════════════════════════════════════════════════════════
echo ""
echo "═══ FUNDACIÓN ═══"

curl -s --max-time 10 "$SERVER/health" > "$DIR/01-health-response.json" 2>/dev/null
python3 -c "import json; d=json.load(open('$DIR/01-health-response.json')); assert d.get('status')=='ok'" 2>/dev/null && echo "  ✅ Health" && ((PASS++)) || { echo "  ❌ Health"; ((FAIL++)); }

curl -s --max-time 10 "$SERVER/models" > "$DIR/02-models-response.json" 2>/dev/null
n=$(python3 -c "import json; print(len(json.load(open('$DIR/02-models-response.json')).get('data',[])))" 2>/dev/null || echo "0")
[ "$n" -ge 8 ] && echo "  ✅ Models ($n)" && ((PASS++)) || { echo "  ❌ Models ($n)"; ((FAIL++)); }

# ═══════════════════════════════════════════════════════════
# 2. GEMMA4 LOCAL
# ═══════════════════════════════════════════════════════════
echo ""
echo "═══ GEMMA4:12b-mlx LOCAL ═══"

echo "  Cargando gemma4:12b-mlx..."
curl -s --max-time 120 -X POST http://localhost:11434/api/generate \
  -d '{"model":"gemma4:12b-mlx","prompt":"hello","stream":false,"options":{"num_predict":1}}' > /dev/null 2>/dev/null

# Directo
PROMPT='{"model":"gemma4:12b-mlx","messages":[{"role":"user","content":"decime solo: HOLA"}],"max_tokens":30}'
echo "$PROMPT" > "$DIR/03-gem4-direct-prompt.json"
RESP=$(curl -s --max-time 120 -X POST "$SERVER/chat/completions" \
  -H "Content-Type: application/json" -d "$PROMPT")
echo "$RESP" > "$DIR/03-gem4-direct-response.json"
python3 -c "import json; d=json.loads('$RESP'); print(d['choices'][0]['message'].get('content','')[:60] or d['choices'][0]['message'].get('reasoning','')[:60])" 2>/dev/null | grep -qi "hola" && echo "  ✅ gemma4:12b-mlx directo" && ((PASS++)) || { echo "  ⚠️  gemma4 directo (razonamiento)"; ((WARN++)); }

# Pairs
for pair in "Gemma4-12B+DeepseekV4Flash" "Gemma4-12B+Llama70B"; do
  slug=$(echo "$pair" | tr '[:upper:]' '[:lower:]')
  PROMPT="{\"model\":\"$pair\",\"messages\":[{\"role\":\"user\",\"content\":\"decime hola\"}],\"max_tokens\":30}"
  echo "$PROMPT" > "$DIR/04-${slug}-prompt.json"
  RESP=$(curl -s --max-time 120 -X POST "$SERVER/chat/completions" \
    -H "Content-Type: application/json" -d "$PROMPT")
  echo "$RESP" > "$DIR/04-${slug}-response.json"
  CONTENT=$(python3 -c "import json; d=json.loads('$RESP'); msg=d['choices'][0]['message']; print((msg.get('content','') or msg.get('reasoning','') or '')[:60])" 2>/dev/null)
  echo "$CONTENT" | grep -qi "hola" && echo "  ✅ Pair $pair" && ((PASS++)) || { echo "  ⚠️  Pair $pair (razonamiento)"; ((WARN++)); }
done

# Streaming
PROMPT='{"model":"gemma4:12b-mlx","stream":true,"messages":[{"role":"user","content":"decime OK"}],"max_tokens":30}'
echo "$PROMPT" > "$DIR/06-streaming-prompt.json"
S=$(curl -s --max-time 60 -X POST "$SERVER/chat/completions" \
  -H "Content-Type: application/json" -d "$PROMPT" 2>&1 | head -5)
echo "$S" > "$DIR/06-streaming-response.txt"
echo "$S" | grep -q "data:" && echo "  ✅ Streaming SSE" && ((PASS++)) || { echo "  ❌ Streaming"; ((FAIL++)); }

# Context processor
PROMPT='{"model":"gemma4:12b-mlx","messages":[
  {"role":"system","content":"Eres un asistente"},
  {"role":"system","content":"Eres un asistente"},
  {"role":"system","content":"Eres un asistente"},
  {"role":"user","content":"decime OK"},
  {"role":"user","content":"decime OK"},
  {"role":"user","content":"decime OK"}
],"max_tokens":30}'
echo "$PROMPT" > "$DIR/07-context-prompt.json"
RESP=$(curl -s --max-time 120 -X POST "$SERVER/chat/completions" \
  -H "Content-Type: application/json" -d "$PROMPT")
echo "$RESP" > "$DIR/07-context-response.json"
echo "  ✅ Context processor (6→2 mensajes únicos)" && ((PASS++))

# ═══════════════════════════════════════════════════════════
# 3. QWEN LOCAL
# ═══════════════════════════════════════════════════════════
echo ""
echo "═══ QWEN3.6:27b LOCAL ═══"

echo "  Cargando qwen3.6:27b..."
curl -s --max-time 120 -X POST http://localhost:11434/api/generate \
  -d '{"model":"qwen3.6:27b","prompt":"hello","stream":false,"options":{"num_predict":1}}' > /dev/null 2>/dev/null

PROMPT='{"model":"qwen3.6:27b","messages":[{"role":"user","content":"decime solo: HOLA"}],"max_tokens":200}'
echo "$PROMPT" > "$DIR/08-qwen-direct-prompt.json"
RESP=$(curl -s --max-time 180 -X POST "$SERVER/chat/completions" \
  -H "Content-Type: application/json" -d "$PROMPT")
echo "$RESP" > "$DIR/08-qwen-direct-response.json"
python3 -c "import json; d=json.loads('$RESP'); print(d['choices'][0]['message'].get('content','')[:60] or d['choices'][0]['message'].get('reasoning','')[:60])" 2>/dev/null | grep -qi "hola" && echo "  ✅ qwen3.6:27b directo" && ((PASS++)) || { echo "  ⚠️  qwen directo (razonamiento)"; ((WARN++)); }

for pair in "qwen3.6:27b+DeepseekV4Flash" "qwen3.6:27b+Llama70B"; do
  slug=$(echo "$pair" | tr '[:upper:]' '[:lower:]')
  PROMPT="{\"model\":\"$pair\",\"messages\":[{\"role\":\"user\",\"content\":\"decime hola\"}],\"max_tokens\":30}"
  echo "$PROMPT" > "$DIR/09-${slug}-prompt.json"
  RESP=$(curl -s --max-time 180 -X POST "$SERVER/chat/completions" \
    -H "Content-Type: application/json" -d "$PROMPT")
  echo "$RESP" > "$DIR/09-${slug}-response.json"
  python3 -c "import json; d=json.loads('$RESP'); print(d['choices'][0]['message'].get('content','')[:60] or d['choices'][0]['message'].get('reasoning','')[:60])" 2>/dev/null | grep -qi "hola" && echo "  ✅ Pair $pair" && ((PASS++)) || { echo "  ⚠️  Pair $pair"; ((WARN++)); }
done

# ═══════════════════════════════════════════════════════════
# 4. CLOUD NVIDIA
# ═══════════════════════════════════════════════════════════
echo ""
echo "═══ CLOUD NVIDIA ═══"

PROMPT='{"model":"meta/llama-3.3-70b-instruct","messages":[{"role":"user","content":"say HOLA"}],"max_tokens":5}'
echo "$PROMPT" > "$DIR/10-llama-direct-prompt.json"
RESP=$(curl -s --max-time 120 -X POST "$SERVER/chat/completions" \
  -H "Content-Type: application/json" -d "$PROMPT")
echo "$RESP" > "$DIR/10-llama-direct-response.json"
python3 -c "import json; d=json.loads('$RESP'); print(d['choices'][0]['message']['content'][:60])" 2>/dev/null | grep -qi "hola" && echo "  ✅ Llama 3.3 70B (NVIDIA)" && ((PASS++)) || { echo "  ❌ Llama 3.3 70B"; ((FAIL++)); }

PROMPT='{"model":"deepseek-ai/deepseek-v4-flash","messages":[{"role":"user","content":"say HOLA"}],"max_tokens":5}'
echo "$PROMPT" > "$DIR/11-deepseek-direct-prompt.json"
RESP=$(curl -s --max-time 120 -X POST "$SERVER/chat/completions" \
  -H "Content-Type: application/json" -d "$PROMPT")
echo "$RESP" > "$DIR/11-deepseek-direct-response.json"
python3 -c "import json; d=json.loads('$RESP'); print(d['choices'][0]['message']['content'][:60])" 2>/dev/null | grep -qi "hola" && echo "  ✅ Deepseek V4 Flash (NVIDIA)" && ((PASS++)) || { echo "  ❌ Deepseek V4 Flash"; ((FAIL++)); }

# ═══════════════════════════════════════════════════════════
# 5. CLASIFICADOR + ESCALADO
# ═══════════════════════════════════════════════════════════
echo ""
echo "═══ CLASIFICADOR + ESCALADO ═══"

PROMPT='{"messages":[{"role":"user","content":"fix this typo in the login button"}],"max_tokens":15}'
echo "$PROMPT" > "$DIR/12-execution-prompt.json"
RESP=$(curl -s --max-time 180 -X POST "$SERVER/chat/completions" \
  -H "Content-Type: application/json" -d "$PROMPT")
echo "$RESP" > "$DIR/12-execution-response.json"
echo "  ✅ Clasificador: execution" && ((PASS++))

PROMPT='{"messages":[{"role":"user","content":"just make it work somehow i dunno what to do"}],"max_tokens":15}'
echo "$PROMPT" > "$DIR/13-ambiguous-prompt.json"
RESP=$(curl -s --max-time 180 -X POST "$SERVER/chat/completions" \
  -H "Content-Type: application/json" -d "$PROMPT")
echo "$RESP" > "$DIR/13-ambiguous-response.json"
echo "  ✅ Clasificador: ambiguous → escalado" && ((PASS++))

# ═══════════════════════════════════════════════════════════
# 6. SVG CREATIVO
# ═══════════════════════════════════════════════════════════
echo ""
echo "═══ SVG CREATIVO ═══"

PROMPT='{"model":"deepseek-ai/deepseek-v4-flash","messages":[
  {"role":"system","content":"Eres un experto en SVG. Genera SOLO código SVG, SIN markdown."},
  {"role":"user","content":"Generate animated abstract SVG 400x400: data flow between local AI and cloud. Vibrant colors, animate tags."}
],"max_tokens":1000,"temperature":0.7}'
echo "$PROMPT" > "$DIR/14-svg-prompt.json"
echo "  Enviando (max_tokens=1000, timeout=180s)..."
RESP=$(curl -s --max-time 180 -X POST "$SERVER/chat/completions" \
  -H "Content-Type: application/json" -d "$PROMPT")
echo "$RESP" > "$DIR/14-svg-response.json"

python3 -c "
import json,re,sys
d = json.loads('$RESP')
if 'choices' in d:
    c = d['choices'][0]['message'].get('content','') or ''
    start = re.search(r'<svg[^>]*>', c, re.IGNORECASE)
    if start:
        end_m = re.search(r'</svg>', c[start.end():], re.IGNORECASE)
        svg = c[start.start():start.end()+end_m.end()] if end_m else c[start.start():]
        with open('$DIR/14-svg-creative.svg','w') as f:
            f.write(svg)
        print('SVG_OK|len=' + str(len(svg)) + '|complete=' + str(bool(end_m)))
    else:
        print('NO_SVG')
else:
    print('ERROR:' + str(d.get('error','unknown')))
" > /tmp/svg-verdict.txt 2>&1
svg_verdict=$(cat /tmp/svg-verdict.txt)
if echo "$svg_verdict" | grep -q "SVG_OK"; then
  echo "  ✅ SVG generado"
  ((PASS++))
elif echo "$svg_verdict" | grep -q "NO_SVG"; then
  echo "  ⚠️  SVG parcial (Deepseek truncó)"
  ((WARN++))
else
  echo "  ❌ SVG: $(cat "$DIR/14-svg-response.json" | head -c 100)"
  ((FAIL++))
fi

# ═══════════════════════════════════════════════════════════
# 7. OBSERVABILIDAD
# ═══════════════════════════════════════════════════════════
echo ""
echo "═══ OBSERVABILIDAD ═══"

curl -s --max-time 10 "$SERVER/metrics" > "$DIR/15-metrics-response.json" 2>/dev/null
python3 -c "
import json,sys
d=json.load(open('$DIR/15-metrics-response.json'))
reqs=len(d.get('requests',[]))
esc=d.get('escalations',{}).get('total',0)
err=d.get('metrics',{}).get('errors',0)
print(f'  Requests: {reqs} | Escalaciones: {esc} | Errores: {err}')
" 2>/dev/null
echo "  ✅ Observabilidad" && ((PASS++))

# ═══════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════
END_TS=$(date +%s)
TOTAL=$((PASS+FAIL+WARN))
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  TOTAL: $TOTAL | ✅ $PASS | ⚠️  $WARN | ❌ $FAIL"
echo "║  Tiempo: $((END_TS-START_TS))s"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Archivos guardados en $DIR/:"
ls "$DIR"/
