# Windows-Installationsskript für Madame Agent
$ErrorActionPreference = "Stop"

Write-Host "=== Iniciando instalación para Windows ===" -ForegroundColor Green

# 1. Verificar si OpenCode está instalado
$opencodeConfigDir = Join-Path $env:USERPROFILE ".config\opencode"
$opencodeJsonPath = Join-Path $opencodeConfigDir "opencode.json"

if (-not (Test-Path $opencodeConfigDir)) {
    Write-Error "ERROR: No se detectó OpenCode instalado. Inicia OpenCode al menos una vez antes de continuar."
    Exit 1
}

# Asegurar carpeta de plugins
$pluginsDir = Join-Path $opencodeConfigDir "plugins"
if (-not (Test-Path $pluginsDir)) {
    New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
}

# 2. Compilar y empaquetar
Write-Host "Compilando y empaquetando la aplicación..." -ForegroundColor Cyan
npm run package

# 3. Crear directorios
$installDir = Join-Path $env:LOCALAPPDATA "madame-agent"
$persistentDir = Join-Path $env:USERPROFILE ".madame-agent"

Write-Host "Creando directorios..." -ForegroundColor Cyan
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
}
if (-not (Test-Path $persistentDir)) {
    New-Item -ItemType Directory -Force -Path $persistentDir | Out-Null
}

# 4. Copiar compilados
Write-Host "Copiando archivos a $installDir..." -ForegroundColor Cyan
if (Test-Path $installDir) {
    Remove-Item -Recurse -Force -Path (Join-Path $installDir "*") -ErrorAction SilentlyContinue
}
Copy-Item -Recurse -Force -Path "dist\apps\opencode-plugin\*" -Destination $installDir

# 5. Instalar plugin puente
Write-Host "Instalando plugin en OpenCode..." -ForegroundColor Cyan
$pluginDest = Join-Path $pluginsDir "madame-agent.ts"
Copy-Item -Force -Path "apps\opencode-plugin\madame-agent.ts" -Destination $pluginDest

# 6. Configurar opencode.json
if (Test-Path $opencodeJsonPath) {
    $timestamp = Get-Date -Format "yyyyMMddHHmmss"
    $backupPath = "$opencodeJsonPath.bak.$timestamp"
    Write-Host "Creando backup de opencode.json en $backupPath..." -ForegroundColor Cyan
    Copy-Item -Path $opencodeJsonPath -Destination $backupPath

    Write-Host "Actualizando configuración en opencode.json..." -ForegroundColor Cyan
    $nodeScript = @"
const fs = require('fs');
try {
  const config = JSON.parse(fs.readFileSync('$($opencodeJsonPath.Replace('\', '/'))', 'utf8'));
  if (!config.madame) config.madame = {};
  if (!config.madame.server) config.madame.server = {};
  config.madame.server.path = '$($installDir.Replace('\', '/'))';
  
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
  fs.writeFileSync('$($opencodeJsonPath.Replace('\', '/'))', JSON.stringify(config, null, 2));
  console.log('opencode.json actualizado correctamente.');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
"@
    node -e $nodeScript
} else {
    Write-Warning "No se encontró opencode.json en $opencodeJsonPath. La configuración no se pudo inicializar."
}

Write-Host "`n=== Instalación de Madame Agent completada con éxito ===" -ForegroundColor Green
Write-Host "Nota: Si tienes OpenCode ejecutándose, por favor reinícialo."
Write-Host "Al arrancar OpenCode, Madame Agent se iniciará automáticamente en el puerto 3001."
