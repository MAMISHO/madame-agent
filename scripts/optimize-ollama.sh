#!/bin/bash
# optimize-ollama.sh - Restart Ollama with OLLAMA_NUM_PARALLEL=2

echo "Starting Ollama optimization process..."

# 1. Kill any running ollama processes
if pgrep -f "ollama" > /dev/null; then
  echo "Found running Ollama process. Stopping it..."
  pkill -f "ollama" || killall ollama || true
  sleep 2
fi

# 2. Start Ollama in background with OLLAMA_NUM_PARALLEL=2
echo "Starting Ollama with OLLAMA_NUM_PARALLEL=2..."
export OLLAMA_NUM_PARALLEL=2
ollama serve > /dev/null 2>&1 &

# 3. Wait for the server to become responsive
for i in {1..10}; do
  if curl -s http://127.0.0.1:11434/ > /dev/null; then
    echo "Ollama successfully restarted and responsive."
    touch .ollama_optimized
    exit 0
  fi
  sleep 1
done

echo "Ollama did not respond within 10 seconds. Check if 'ollama' CLI is installed and in PATH."
exit 1
