#!/bin/bash
# Entrypoint for uninstall test - clean OpenCode only, no auto-install

set -uo pipefail

echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========================================"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Uninstall Test Container - Clean OpenCode"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ========================================"

OPENCODE_CONFIG_DIR="/root/.config/opencode"
OPENCODE_PLUGIN_DIR="${OPENCODE_CONFIG_DIR}/plugins"
mkdir -p "${OPENCODE_PLUGIN_DIR}"

if [ ! -f "${OPENCODE_CONFIG_DIR}/opencode.json" ]; then
    echo '{}' > "${OPENCODE_CONFIG_DIR}/opencode.json"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] OpenCode config initialized"

if ! command -v opencode &> /dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: OpenCode CLI not found in PATH"
    exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] OpenCode version: $(opencode --version 2>&1)"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Container ready. OpenCode installed but NOT configured."
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Ready to receive Madame Agent installation via podman exec"

sleep infinity