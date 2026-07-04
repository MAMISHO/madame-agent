#!/bin/bash
set -e

echo "=== Desinstalando Madame Agent ==="

# Detectar SO
detect_os() {
    case "$(uname -s)" in
        Darwin*)  echo "macos" ;;
        Linux*)   echo "linux" ;;
        *)        echo "linux" ;;
    esac
}

OS_TYPE=$(detect_os)
MADAME_PORT="${MADAME_PORT:-3001}"

# 1. Detener proceso si está corriendo
echo "Deteniendo Madame Agent en puerto $MADAME_PORT..."

if [ "$OS_TYPE" = "macos" ]; then
    PID=$(lsof -ti :$MADAME_PORT 2>/dev/null || true)
else
    PID=$(lsof -ti :$MADAME_PORT 2>/dev/null || true)
fi

if [ -n "$PID" ]; then
    echo "Deteniendo proceso PID $PID..."
    kill -9 $PID 2>/dev/null || true
    sleep 1
    echo "Proceso detenido."
else
    echo "No se encontró proceso ejecutándose en el puerto $MADAME_PORT."
fi

# 2. Directorios a eliminar
INSTALL_DIR="$HOME/.local/share/madame-agent"
PERSISTENT_DIR="$HOME/.madame-agent"
OPENCODE_PLUGIN="$HOME/.config/opencode/plugins/madame-agent.ts"

# 3. Eliminar archivos de instalación
echo "Eliminando archivos..."

# Plugin de OpenCode
if [ -f "$OPENCODE_PLUGIN" ]; then
    rm -f "$OPENCODE_PLUGIN"
    echo "  - Plugin de OpenCode eliminado: $OPENCODE_PLUGIN"
fi

# Directorio de instalación
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    echo "  - Directorio de instalación eliminado: $INSTALL_DIR"
fi

# Directorio persistente (datos, skills, etc.)
if [ -d "$PERSISTENT_DIR" ]; then
    rm -rf "$PERSISTENT_DIR"
    echo "  - Directorio de datos eliminado: $PERSISTENT_DIR"
fi

# 4. Verificar limpieza
REMAINING=""
if [ -f "$OPENCODE_PLUGIN" ] || [ -d "$INSTALL_DIR" ] || [ -d "$PERSISTENT_DIR" ]; then
    REMAINING="yes"
fi

echo ""
if [ -z "$REMAINING" ]; then
    echo "=== Desinstalación completada con éxito ==="
    echo ""
    echo "Archivos eliminados:"
    echo "  - $OPENCODE_PLUGIN"
    echo "  - $INSTALL_DIR"
    echo "  - $PERSISTENT_DIR"
    echo ""
    echo "Si tenías OpenCode ejecutándose, por favor reinícialo para completar la desinstalación del plugin."
else
    echo "=== Desinstalación parcialmente completada ==="
    echo "Algunos archivos no pudieron ser eliminados. Verifica los permisos."
fi