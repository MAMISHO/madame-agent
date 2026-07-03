#!/bin/bash
# Entrypoint script for Madame-Agent isolated development environment
# Provides installation simulation with comprehensive debug logging

set -uo pipefail  # Don't exit on error - keep container running

# Configuration
LOG_FILE="/tmp/install-debug.log"
PROJECT_DIR="/workspace/madame-agent"
OPENCODE_CONFIG_DIR="/root/.config/opencode"
OPENCODE_PLUGIN_DIR="${OPENCODE_CONFIG_DIR}/plugins"

# Initialize log file
exec > >(tee -a "$LOG_FILE") 2>&1
exec 2>&1

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error_exit() {
    log "ERROR: $1"
    log "Debug log available at: $LOG_FILE"
    log "Failed command: $BASH_COMMAND"
    exit 1
}

# Trap for unexpected errors - log but don't exit
# trap 'error_exit "Unexpected error occurred"' ERR

log "========================================"
log "Madame-Agent Container Entrypoint"
log "========================================"

# Step 1: Verify Node.js installation
log "Step 1/6: Verifying Node.js installation..."
NODE_VERSION=$(node --version 2>&1) || error_exit "Node.js not found"
log "Node.js version: ${NODE_VERSION}"

# Verify Node.js meets minimum version requirement (22.23.1+)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1 | tr -d 'v')
NODE_MINOR=$(echo "$NODE_VERSION" | cut -d. -f2)
NODE_PATCH=$(echo "$NODE_VERSION" | cut -d. -f3 | cut -d- -f1)

if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 23 ]; }; then
    error_exit "Node.js version must be 22.23.1 or higher. Found: ${NODE_VERSION}"
fi

# For 22.23.x, patch must be >= 1; for 22.24+, any patch is fine
if [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -eq 23 ] && [ "$NODE_PATCH" -lt 1 ]; then
    error_exit "Node.js version must be 22.23.1 or higher. Found: ${NODE_VERSION}"
fi
log "Node.js version ${NODE_VERSION} meets requirement (22.23.1+)"

# Step 2: Initialize OpenCode CLI
log "Step 2/6: Initializing OpenCode CLI..."
mkdir -p "${OPENCODE_PLUGIN_DIR}"

if [ ! -f "${OPENCODE_CONFIG_DIR}/opencode.json" ] || [ ! -s "${OPENCODE_CONFIG_DIR}/opencode.json" ]; then
    log "OpenCode config not found or empty, initializing with valid JSON..."
    # OpenCode v0.0.55 doesn't have init subcommand; config is created on first run
    # Create valid empty JSON object to prevent "Unexpected end of JSON input" errors
    echo '{}' > "${OPENCODE_CONFIG_DIR}/opencode.json"
    log "OpenCode config initialized with: {}"
else
    log "OpenCode config already exists at ${OPENCODE_CONFIG_DIR}/opencode.json"
fi

# Verify OpenCode is available
OPENCODE_VERSION=$(opencode --version 2>&1) || error_exit "OpenCode CLI not found"
log "OpenCode CLI version: ${OPENCODE_VERSION}"

# Initialize OpenCode config by running it once (creates valid opencode.json)
log "Running OpenCode once to initialize config..."
opencode --version > /dev/null 2>&1 || true
if [ -f "${OPENCODE_CONFIG_DIR}/opencode.json" ] && [ ! -s "${OPENCODE_CONFIG_DIR}/opencode.json" ]; then
    # If still empty after running opencode, create minimal valid config
    echo '{}' > "${OPENCODE_CONFIG_DIR}/opencode.json"
    log "Created minimal opencode.json: {}"
fi

# Step 3: Navigate to project directory
log "Step 3/6: Preparing project directory..."
if [ -d "${PROJECT_DIR}" ]; then
    cd "${PROJECT_DIR}"
    log "Project directory: ${PROJECT_DIR}"
    log "Contents: $(ls -la "${PROJECT_DIR}" | head -20)"
else
    log "WARNING: Project directory ${PROJECT_DIR} not found"
    log "This is expected if bind mount is not configured"
fi

# Step 4: Install npm dependencies
log "Step 4/6: Installing npm dependencies..."
if [ -f "package.json" ]; then
    npm install 2>&1 || error_exit "npm install failed"
    log "npm install completed successfully"
else
    log "WARNING: package.json not found in ${PROJECT_DIR}"
    log "Skipping npm install"
fi

# Step 5: Build packages
log "Step 5/6: Building Madame-Agent packages..."
if command -v npm &> /dev/null && [ -f "package.json" ]; then
    npm run package 2>&1 || error_exit "npm run package failed"
    log "Package build completed successfully"
else
    log "WARNING: Cannot run package build - npm or package.json not available"
fi

# Step 6: Run installation script
log "Step 6/6: Running installation script..."
if [ -f "${PROJECT_DIR}/scripts/install.sh" ]; then
    chmod +x "${PROJECT_DIR}/scripts/install.sh"
    chmod +x "${PROJECT_DIR}/scripts/install-unix.sh" 2>/dev/null || true
    "${PROJECT_DIR}/scripts/install.sh" 2>&1 || error_exit "install.sh failed"
    log "Installation script completed successfully"
else
    log "WARNING: install.sh not found in ${PROJECT_DIR}/scripts/"
    log "Skipping install script execution"
fi

# Step 7: Start services (backend + OpenCode serve)
log "Step 7/7: Starting services..."

# Fix OpenCode config for v1.17+
cat > "${OPENCODE_CONFIG_DIR}/opencode.json" << 'EOF'
{
  "provider": {
    "madame-agent": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Madame Agent (hybrid proxy)",
      "options": {
        "baseURL": "http://localhost:3001"
      },
      "models": {
        "madame-auto": {
          "name": "Madame Auto (Dynamic Routing)"
        }
      }
    }
  }
}
EOF

# Start backend on port 3001
log "Starting backend on port 3001..."
cd /workspace/madame-agent/apps/backend
export MADAME_PATH="$HOME"
export PORT=3001
# Set global-agent proxy for outbound connections (only if proxy vars exist)
if [ -n "${HTTPS_PROXY}" ] || [ -n "${HTTP_PROXY}" ]; then
    export GLOBAL_AGENT_HTTP_PROXY="${HTTPS_PROXY:-${HTTP_PROXY}}"
    export GLOBAL_AGENT_HTTPS_PROXY="${HTTPS_PROXY}"
    export GLOBAL_AGENT_NO_PROXY="${NO_PROXY:-localhost,127.0.0.1}"
    log "Proxy configured: ${GLOBAL_AGENT_HTTP_PROXY}"
else
    log "No proxy detected - using direct connections"
fi
nohup node dist/main.js > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
log "Backend started with PID: ${BACKEND_PID}"

# Wait for backend to be ready
sleep 3
for i in {1..10}; do
    if curl -s http://localhost:3001/v1/health > /dev/null 2>&1; then
        log "Backend is ready!"
        break
    fi
    log "Waiting for backend... (${i}/10)"
    sleep 2
done

# Start OpenCode serve on port 4098
log "Starting OpenCode serve on port 4098..."
nohup opencode serve --port 4098 --hostname 0.0.0.0 > /tmp/opencode-serve.log 2>&1 &
OPENCODE_PID=$!
log "OpenCode serve started with PID: ${OPENCODE_PID}"

# Wait for OpenCode to be ready
sleep 5
for i in {1..10}; do
    if curl -s --max-time 2 http://localhost:4098/ > /dev/null 2>&1; then
        log "OpenCode serve is ready!"
        break
    fi
    log "Waiting for OpenCode... (${i}/10)"
    sleep 2
done

# Final status
log "========================================"
log "Services Started Successfully"
log "========================================"
log "Backend API:  http://localhost:3001"
log "OpenCode:     http://localhost:4098"
log "========================================"

# Keep container running - tail logs in background and wait
tail -f /tmp/backend.log /tmp/opencode-serve.log 2>/dev/null &
TAIL_PID=$!
log "Tailing logs (PID: ${TAIL_PID})"

# Wait for any signal or exec the provided command
if [ $# -eq 0 ]; then
    log "No command provided, keeping container alive..."
    # Keep container alive
    sleep infinity
else
    log "Executing: $@"
    exec "$@"
fi