#!/bin/bash

# Haupt-Installationsskript für Madame Agent
set -e

echo "=== Iniciando instalación de Madame Agent ==="

# 1. Verificar requisitos previos
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js no está instalado. Instálalo antes de continuar." >&2
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "ERROR: Se requiere Node.js versión 18 o superior. Versión detectada: v$NODE_VERSION" >&2
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "ERROR: npm no está instalado." >&2
    exit 1
fi

if ! command -v npx &> /dev/null; then
    echo "ERROR: npx no está instalado." >&2
    exit 1
fi

# 2. Detectar argumentos y puerto personalizado
PORT_ARG=""
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --port) PORT_ARG="$2"; shift ;;
        *) echo "Opción desconocida: $1" >&2; exit 1 ;;
    esac
    shift
done

if [ -n "$PORT_ARG" ]; then
    export MADAME_PORT="$PORT_ARG"
elif [ -n "$PORT" ]; then
    export MADAME_PORT="$PORT"
fi

# 3. Detectar sistema operativo
OS="$(uname -s)"
case "${OS}" in
    Darwin*|Linux*)
        echo "Sistema operativo detectado: ${OS} (Unix)"
        chmod +x "$(dirname "$0")/install-unix.sh"
        "$(dirname "$0")/install-unix.sh" "$@"
        ;;
    CYGWIN*|MINGW32*|MSYS*|MINGW*)
        echo "Sistema operativo detectado: Windows (Bash/Mingw/Msys)"
        powershell.exe -ExecutionPolicy Bypass -File "$(dirname "$0")/install-windows.ps1" -Port "$MADAME_PORT"
        ;;
    *)
        echo "Intentando invocar el instalador de Windows..."
        if command -v powershell.exe &> /dev/null; then
            powershell.exe -ExecutionPolicy Bypass -File "$(dirname "$0")/install-windows.ps1" -Port "$MADAME_PORT"
        else
            echo "ERROR: Sistema operativo '${OS}' no soportado directamente." >&2
            exit 1
        fi
        ;;
esac

echo "=== Instalación de Madame Agent completada con éxito ==="
