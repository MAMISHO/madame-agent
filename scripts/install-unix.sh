#!/bin/bash
set -e

echo "=== Iniciando instalación para plataformas Unix (macOS / Linux) ==="

# 1. Verificar si OpenCode está instalado
OPENCODE_CONFIG_DIR="$HOME/.config/opencode"
if [ ! -d "$OPENCODE_CONFIG_DIR" ] && ! command -v opencode &> /dev/null; then
    echo "ERROR: No se detectó OpenCode instalado. Inicia OpenCode al menos una vez antes de instalar Madame Agent." >&2
    exit 1
fi

# Asegurar que existe la carpeta de configuración de opencode
mkdir -p "$OPENCODE_CONFIG_DIR/plugins"

# 2. Compilar y empaquetar el monorrepo
echo "Compilando y empaquetando la aplicación..."
npm run package

# 3. Crear directorios de instalación
INSTALL_DIR="$HOME/.local/share/madame-agent"
PERSISTENT_DIR="$HOME/.madame-agent"
BIN_DIR="$HOME/.local/bin"

echo "Creando directorios de instalación..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$PERSISTENT_DIR"
mkdir -p "$BIN_DIR"

# 4. Limpiar instalación anterior y copiar nuevo build
echo "Copiando archivos compilados a $INSTALL_DIR..."
# Preservar la base de datos local si existiera por accidente en la carpeta share (aunque ahora se persistirá en ~/.madame-agent)
rm -rf "${INSTALL_DIR:?}"/*
cp -r dist/apps/opencode-plugin/* "$INSTALL_DIR/"

# 5. Instalar plugin puente en OpenCode
echo "Instalando plugin en OpenCode..."
cp apps/opencode-plugin/madame-agent.ts "$OPENCODE_CONFIG_DIR/plugins/madame-agent.ts"

# 6. Configurar opencode.json de forma segura
CONFIG_FILE="$OPENCODE_CONFIG_DIR/opencode.json"
if [ -f "$CONFIG_FILE" ]; then
    TIMESTAMP=$(date +%Y%m%d%H%M%S)
    BACKUP_FILE="${CONFIG_FILE}.bak.${TIMESTAMP}"
    echo "Haciendo backup de opencode.json en $BACKUP_FILE..."
    cp "$CONFIG_FILE" "$BACKUP_FILE"

    echo "Actualizando configuración en opencode.json..."
    node -e "
const fs = require('fs');
const path = require('path');
const configPath = '$CONFIG_FILE';

try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config.madame) config.madame = {};
  if (!config.madame.server) config.madame.server = {};
  config.madame.server.path = '$INSTALL_DIR';
  
  if (!config.provider) config.provider = {};
  if (!config.provider['madame-agent']) {
    config.provider['madame-agent'] = {
      npm: '@ai-sdk/openai-compatible',
      name: 'Madame Agent (hybrid proxy)',
      options: {
        baseURL: 'http://localhost:3001/v1'
      },
      models: {
        'madame-auto': {
          name: 'Madame Auto (Dynamic Routing)'
        }
      }
    };
  }
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('opencode.json actualizado correctamente.');
} catch (err) {
  console.error('Error al actualizar opencode.json:', err.message);
  process.exit(1);
}
"
else
    echo "WARNING: No se encontró opencode.json en $CONFIG_FILE. La configuración no se pudo inicializar."
fi

echo ""
echo "=== Instalación de Madame Agent completada con éxito ==="
echo "Nota: Si tienes OpenCode ejecutándose, por favor reinícialo."
echo "Al arrancar OpenCode, Madame Agent se iniciará automáticamente en el puerto 3001."
