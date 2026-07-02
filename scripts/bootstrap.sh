#!/bin/bash
# Script de bootstrap para instalación directa en un solo paso
set -e

echo "=== Madame Agent Bootstrapper ==="

# 1. Validaciones previas
if ! command -v git &> /dev/null; then
    echo "ERROR: Git no está instalado. Por favor, instala Git antes de continuar." >&2
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js no está instalado. Por favor, instala Node.js antes de continuar." >&2
    exit 1
fi

# 2. Descarga temporal del repositorio
TEMP_DIR=$(mktemp -d)
echo "Clonando repositorio en directorio temporal: $TEMP_DIR..."
git clone https://github.com/mamisho/madame-agent.git "$TEMP_DIR"

# 3. Compilación e instalación
cd "$TEMP_DIR"
echo "Instalando dependencias de construcción..."
npm install

echo "Ejecutando script de instalación..."
chmod +x scripts/install.sh scripts/install-unix.sh
./scripts/install.sh

# 4. Limpieza del directorio temporal
echo "Limpiando archivos temporales..."
rm -rf "$TEMP_DIR"

echo "=== Instalación finalizada ==="
