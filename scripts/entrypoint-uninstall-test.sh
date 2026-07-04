#!/bin/bash
# Entrypoint for uninstall test - starts pre-installed OpenCode and Madame Agent

set -uo pipefail

export PATH="/root/.opencode/bin:${PATH}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========================================"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Uninstall Test Container"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========================================"

OPENCODE_CONFIG_DIR="/root/.config/opencode"
OPENCODE_PLUGIN_DIR="${OPENCODE_CONFIG_DIR}/plugins"

mkdir -p "${OPENCODE_PLUGIN_DIR}"

if [ ! -f "${OPENCODE_CONFIG_DIR}/opencode.json" ]; then
    echo '{}' > "${OPENCODE_CONFIG_DIR}/opencode.json"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] OpenCode version: $(opencode --version 2>&1)"

# Verificar que Madame Agent está instalado
if [ -f "/root/.config/opencode/plugins/madame-agent.ts" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Madame Agent plugin: INSTALLED"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Madame Agent plugin: NOT FOUND"
fi

if [ -d "/root/.local/share/madame-agent" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Madame Agent backend: INSTALLED"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Madame Agent backend: NOT FOUND"
fi

# Iniciar backend
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backend on port 3001..."
cd /root/.local/share/madame-agent/backend
nohup node dist/main.js > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backend started with PID: ${BACKEND_PID}"

# Esperar backend
sleep 3
for i in {1..10}; do
    if curl -s http://localhost:3001/v1/health > /dev/null 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backend is ready!"
        break
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Waiting for backend... (${i}/10)"
    sleep 2
done

# Iniciar OpenCode serve
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting OpenCode serve on port 4098..."
nohup opencode serve --port 4098 --hostname 0.0.0.0 > /tmp/opencode.log 2>&1 &
OPENCODE_PID=$!
echo "[$(date '+%Y-%m-%d %H:%M:%S')] OpenCode serve started with PID: ${OPENCODE_PID}"

# Esperar OpenCode
sleep 5
for i in {1..10}; do
    if curl -s --max-time 2 http://localhost:4098/ > /dev/null 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] OpenCode is ready!"
        break
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Waiting for OpenCode... (${i}/10)"
    sleep 2
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========================================"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Services Ready"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backend:  http://localhost:3001"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] OpenCode:  http://localhost:4098"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========================================"

sleep infinity