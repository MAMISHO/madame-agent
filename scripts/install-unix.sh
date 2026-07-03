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

# Determinar directorio del proyecto (donde está este script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 2. Determinar puerto y verificar conflictos
CONFIG_FILE="$OPENCODE_CONFIG_DIR/opencode.json"
PORT="3001"
if [ -n "$MADAME_PORT" ]; then
    PORT="$MADAME_PORT"
elif [ -f "$CONFIG_FILE" ]; then
    PORT_DETECTED=$(node -e "
const fs = require('fs');
try {
  const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
  const baseURL = config.provider?.['madame-agent']?.options?.baseURL;
  if (baseURL) {
    const match = baseURL.match(/:(\d+)/);
    if (match) console.log(match[1]);
  }
} catch (e) {}
" 2>/dev/null || echo "")
    if [ -n "$PORT_DETECTED" ]; then
        PORT="$PORT_DETECTED"
    fi
fi

echo "Verificando estado del puerto $PORT..."
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
    HEALTH_CHECK=$(curl -s --max-time 2 http://localhost:$PORT/v1/health || true)
    if [[ "$HEALTH_CHECK" == *"status"* && "$HEALTH_CHECK" == *"ok"* ]]; then
        echo "Madame Agent detectado ejecutándose en el puerto $PORT. Deteniendo proceso para reinstalación limpia..."
        lsof -t -i :$PORT | xargs kill -9 2>/dev/null || true
        sleep 1
    else
        echo "ERROR: El puerto $PORT ya está ocupado por otra aplicación externa." >&2
        echo "Puedes especificar un puerto libre diferente usando la opción --port:" >&2
        echo "  ./scripts/install.sh --port 3002" >&2
        exit 1
    fi
fi

# 3. Compilar y empaquetar el monorrepo
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
# No borrar el backend si ya existe (puede estar montado desde el host con node_modules)
rm -rf "${INSTALL_DIR:?}"/{dist,frontend,plugin.json,package.json,plugin.json,src,types}
rm -rf "${INSTALL_DIR:?}"/backend/dist 2>/dev/null || true

# Copiar plugin de OpenCode
echo "Copiando plugin de OpenCode..."
cp -r "$PROJECT_DIR/dist/apps/opencode-plugin/"* "$INSTALL_DIR/"

# Copiar backend de NestJS compilado
echo "Copiando backend de NestJS..."
mkdir -p "$INSTALL_DIR/backend/dist"
cp -r "$PROJECT_DIR/apps/backend/dist/"* "$INSTALL_DIR/backend/dist/"

# Copiar routing.yaml para el seeding de harnesses
echo "Copiando routing.yaml..."
cp "$PROJECT_DIR/apps/backend/routing.yaml" "$INSTALL_DIR/backend/"

# Copiar frontend compilado
echo "Copiando frontend..."
mkdir -p "$INSTALL_DIR/frontend"
cp -r "$PROJECT_DIR/apps/frontend/dist/frontend/"* "$INSTALL_DIR/frontend/"

# Copiar package.json del backend para poder instalar dependencias
echo "Copiando dependencias del backend..."
cp "$PROJECT_DIR/apps/backend/package.json" "$INSTALL_DIR/backend/"

# Instalar dependencias del backend (necesario para NestJS)
echo "Instalando dependencias del backend..."
cd "$INSTALL_DIR/backend"
npm install 2>&1 || npm install --include=dev 2>&1

# Volver al directorio del proyecto
cd "$PROJECT_DIR"

# 5. Instalar plugin puente en OpenCode
echo "Instalando plugin en OpenCode..."
cp apps/opencode-plugin/madame-agent.ts "$OPENCODE_CONFIG_DIR/plugins/madame-agent.ts"
echo "Plugin instalado: $OPENCODE_CONFIG_DIR/plugins/madame-agent.ts"

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
        baseURL: 'http://localhost:$PORT/v1'
      },
      models: {
        'madame-auto': {
          name: 'Madame Auto (Dynamic Routing)'
        }
      }
    };
  } else {
    // Si ya existe el proveedor, actualizamos su baseURL para usar el puerto seleccionado
    if (!config.provider['madame-agent'].options) config.provider['madame-agent'].options = {};
    config.provider['madame-agent'].options.baseURL = 'http://localhost:$PORT/v1';
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
