#!/bin/bash
set -e

echo "=== Madame Agent Bootstrapper ==="

# --- Parse arguments ---
PORT_ARG=""
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --port) PORT_ARG="$2"; shift ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
  shift
done

# --- Pre-requisites (both methods need these) ---
for cmd in node npm npx; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: $cmd no está instalado." >&2
    exit 1
  fi
done

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "ERROR: Se requiere Node.js 18+. Versión: $(node -v)" >&2
  exit 1
fi

# --- Configuration ---
REPO="MAMISHO/madame-agent"
INSTALL_DIR="$HOME/.local/share/madame-agent"
PERSISTENT_DIR="$HOME/.madame-agent"
OPENCODE_PLUGIN_DIR="$HOME/.config/opencode/plugins"
MADAME_VERSION="${MADAME_VERSION:-latest}"

# --- Helper: run post-extraction steps ---
run_install_steps() {
  local target_dir="$1"

  echo ""
  echo "=== Instalando componentes ==="

  # Ensure directories
  mkdir -p "$INSTALL_DIR" "$PERSISTENT_DIR" "$OPENCODE_PLUGIN_DIR"

  # Copy everything to install dir
  echo "Copiando archivos a $INSTALL_DIR..."
  rm -rf "${INSTALL_DIR:?}"/*
  cp -r "$target_dir"/* "$INSTALL_DIR/"

  # Install production dependencies for backend
  if [ -f "$INSTALL_DIR/backend/package.json" ]; then
    echo "Instalando dependencias de producción del backend..."
    (cd "$INSTALL_DIR/backend" && npm install --production 2>&1) \
      || (cd "$INSTALL_DIR/backend" && npm install --production --ignore-scripts 2>&1)
  fi

  # Install plugin bridge
  if [ -f "$INSTALL_DIR/madame-agent.ts" ]; then
    echo "Instalando plugin en OpenCode..."
    mkdir -p "$OPENCODE_PLUGIN_DIR"
    cp "$INSTALL_DIR/madame-agent.ts" "$OPENCODE_PLUGIN_DIR/madame-agent.ts"
    echo "Plugin instalado: $OPENCODE_PLUGIN_DIR/madame-agent.ts"
  fi

  # Handle port argument
  if [ -n "$PORT_ARG" ]; then
    export MADAME_PORT="$PORT_ARG"
  fi

  echo ""
  echo "=== Instalación de Madame Agent completada con éxito ==="
  echo "Nota: Si tienes OpenCode ejecutándose, por favor reinícialo."
  echo "Al arrancar OpenCode, Madame Agent se iniciará automáticamente en el puerto ${MADAME_PORT:-3001}."
}

# ============================================================
# METHOD 1: GitHub Release (pre-compiled)
# ============================================================
try_release_install() {
  # Construct download URL
  if [ "$MADAME_VERSION" = "latest" ]; then
    BASE_URL="https://github.com/$REPO/releases/latest/download"
  else
    BASE_URL="https://github.com/$REPO/releases/download/$MADAME_VERSION"
  fi
  DOWNLOAD_URL="$BASE_URL/madame-agent.tar.gz"

  echo "Intentando descarga desde GitHub Release..."
  echo "  URL: $DOWNLOAD_URL"

  TEMP_TAR=$(mktemp)
  TEMP_EXTRACT=$(mktemp -d)
  CLEANUP_TAR=1

  # Download
  echo "  Descargando..."
  curl -fsSL --connect-timeout 10 --max-time 60 \
    -o "$TEMP_TAR" \
    "$DOWNLOAD_URL" 2>/dev/null || {
    echo "  ↳ No se pudo descargar (error de red o URL no disponible)."
    rm -f "$TEMP_TAR"
    rm -rf "$TEMP_EXTRACT"
    return 1
  }

  # Quick sanity check — the file should be > 1MB
  local tar_size
  tar_size=$(stat -f%z "$TEMP_TAR" 2>/dev/null || stat -c%s "$TEMP_TAR" 2>/dev/null || echo "0")
  if [ "$tar_size" -lt 1000000 ]; then
    echo "  ↳ El archivo descargado parece inválido (tamaño: $tar_size bytes)."
    rm -f "$TEMP_TAR"
    rm -rf "$TEMP_EXTRACT"
    return 1
  fi

  # Extract
  echo "Extrayendo..."
  tar -xzf "$TEMP_TAR" -C "$TEMP_EXTRACT"
  rm -f "$TEMP_TAR"

  run_install_steps "$TEMP_EXTRACT"
  rm -rf "$TEMP_EXTRACT"

  echo ""
  echo "Instalación vía release completada en ~15-20 segundos"
  echo "(en vez de los ~2-5 minutos del método anterior)"
  return 0
}

# ============================================================
# METHOD 2: Clone + Build (fallback)
# ============================================================
fallback_clone_and_build() {
  echo ""
  echo "=== Usando método alternativo: clonar y compilar ==="

  if ! command -v git &> /dev/null; then
    echo "ERROR: Git no está instalado. Necesitamos Git para el método alternativo." >&2
    exit 1
  fi

  TEMP_DIR=$(mktemp -d)
  echo "Clonando repositorio en directorio temporal: $TEMP_DIR..."
  git clone "https://github.com/$REPO.git" "$TEMP_DIR"

  cd "$TEMP_DIR"
  echo "Instalando dependencias de compilación..."
  npm install

  # Apply patches from the calling script directory
  SCRIPT_DIR="${MADAME_SCRIPTS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
  if [ -f "$SCRIPT_DIR/install-unix.sh" ]; then
    echo "Aplicando parches de corrección..."
    cp "$SCRIPT_DIR/install-unix.sh" scripts/install-unix.sh
  fi

  echo "Compilando y ejecutando instalación..."
  chmod +x scripts/install.sh scripts/install-unix.sh
  if [ -n "$PORT_ARG" ]; then
    ./scripts/install.sh --port "$PORT_ARG"
  else
    ./scripts/install.sh
  fi

  cd /
  rm -rf "$TEMP_DIR"
}

# ============================================================
# MAIN
# ============================================================
if try_release_install; then
  :  # Success
else
  echo ""
  echo "La descarga desde release no está disponible aún"
  echo "(o no hay conexión a GitHub)."
  echo "Usando método tradicional de clonar y compilar..."
  echo ""
  fallback_clone_and_build
fi
