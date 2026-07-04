# Uninstall Madame Agent for Windows

$ErrorActionPreference = "Stop"

Write-Host "=== Desinstalando Madame Agent ===" -ForegroundColor Cyan

# Detectar puerto
$port = if ($env:MADAME_PORT) { $env:MADAME_PORT } else { "3001" }

# 1. Detener proceso si está corriendo
Write-Host "Deteniendo Madame Agent en puerto $port..."

$process = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -First 1

if ($process) {
    Write-Host "Deteniendo proceso PID $process..."
    Stop-Process -Id $process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Write-Host "Proceso detenido."
} else {
    Write-Host "No se encontró proceso ejecutándose en el puerto $port."
}

# 2. Directorios a eliminar
$homeDir = $env:USERPROFILE
$installDir = "$homeDir\.local\share\madame-agent"
$persistentDir = "$homeDir\.madame-agent"
$opencodePlugin = "$homeDir\.config\opencode\plugins\madame-agent.ts"

# 3. Eliminar archivos
Write-Host "Eliminando archivos..."

# Plugin de OpenCode
if (Test-Path $opencodePlugin) {
    Remove-Item -Path $opencodePlugin -Force
    Write-Host "  - Plugin de OpenCode eliminado: $opencodePlugin"
}

# Directorio de instalación
if (Test-Path $installDir) {
    Remove-Item -Path $installDir -Recurse -Force
    Write-Host "  - Directorio de instalación eliminado: $installDir"
}

# Directorio persistente
if (Test-Path $persistentDir) {
    Remove-Item -Path $persistentDir -Recurse -Force
    Write-Host "  - Directorio de datos eliminado: $persistentDir"
}

# 4. Verificar
$remaining = $false
if ((Test-Path $opencodePlugin) -or (Test-Path $installDir) -or (Test-Path $persistentDir)) {
    $remaining = $true
}

Write-Host ""
if (-not $remaining) {
    Write-Host "=== Desinstalacion completada con exito ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "Archivos eliminados:"
    Write-Host "  - $opencodePlugin"
    Write-Host "  - $installDir"
    Write-Host "  - $persistentDir"
    Write-Host ""
    Write-Host "Si tenias OpenCode ejecutandose, por favor reinicialo para completar la desinstalacion del plugin."
} else {
    Write-Host "=== Desinstalacion parcialmente completada ===" -ForegroundColor Yellow
    Write-Host "Algunos archivos no pudieron ser eliminados. Verifica los permisos."
}