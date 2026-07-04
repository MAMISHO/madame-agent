# Madame Agent (hybrid proxy)

Madame Agent es un monorrepo que proporciona un proxy híbrido (backend NestJS, frontend Angular) y un plugin de OpenCode para orquestar la delegación entre modelos locales (Ollama) y en la nube.

---

## Requisitos Previos

Antes de instalar Madame Agent, asegúrate de tener instalados los siguientes componentes:
1. **Node.js** (v18 o superior) y **npm** (que incluye `npx`).
2. **OpenCode** (el IDE o servidor de terminal `opencode`). Debes haberlo iniciado al menos una vez para que se cree su estructura de configuración inicial.

## Instalación Rápida (Un Solo Paso)

Para instalar Madame Agent automáticamente en un solo paso, abre tu terminal y ejecuta el siguiente comando:

### macOS / Linux

```bash
# Instalación estándar (puerto 3001)
curl -fsSL https://raw.githubusercontent.com/MAMISHO/madame-agent/main/scripts/bootstrap.sh | bash

# Si el puerto 3001 está ocupado, puedes indicar otro puerto (por ejemplo, el 3002):
curl -fsSL https://raw.githubusercontent.com/MAMISHO/madame-agent/main/scripts/bootstrap.sh | bash -s -- --port 3002

# Para instalar una versión específica (por defecto: latest):
MADAME_VERSION=v1.0.0 curl -fsSL https://raw.githubusercontent.com/MAMISHO/madame-agent/main/scripts/bootstrap.sh | bash
```

---

## Instalación desde Código Fuente (Desarrollo)

Si querés contribuir o inspeccionar el código antes de instalar, cloná el repositorio y ejecutá el instalador local:

### macOS / Linux

```bash
# 1. Clonar el repositorio oficial
git clone https://github.com/MAMISHO/madame-agent.git
cd madame-agent

# 2. Instalar dependencias y compilar
npm install
npm run package

# 3. Instalar
chmod +x scripts/install.sh scripts/install-unix.sh
./scripts/install.sh
```

### Windows (PowerShell)

```powershell
# 1. Clonar el repositorio oficial
git clone https://github.com/MAMISHO/madame-agent.git
cd madame-agent

# 2. Instalar dependencias y compilar
npm install
npm run package

# 3. Instalar
Set-ExecutionPolicy Bypass -Scope Process -Force
.\scripts\install.sh
```

---

## ¿Qué hace el Script de Instalación?

### Bootstrap (recomendado — `bootstrap.sh`)

1. **Descarga desde GitHub Release**: Obtiene el tarball precompilado más reciente (`madame-agent.tar.gz`) desde [GitHub Releases](https://github.com/MAMISHO/madame-agent/releases). Sin clonar, sin compilar.
2. **Extracción**: Descomprime el build completo en `$HOME/.local/share/madame-agent/`.
3. **Dependencias de Producción**: Instala solo las dependencias runtime del backend Sequelize, SQLite, NestJS (`npm install --production`).
4. **Plugin Bridge**: Copia `madame-agent.ts` a `~/.config/opencode/plugins/madame-agent.ts`.
5. **Persistencia de Datos**: Crea `$HOME/.madame-agent/` para la base de datos SQLite.

**Tiempo estimado**: ~15-20 segundos (vs 2-5 minutos con el método anterior).

> **¿Sin release disponible?** El script detecta automáticamente la ausencia de releases y cae al método tradicional de clonar, compilar e instalar.

### Instalación desde fuente — `install.sh`

1. **Verificación de Entorno**: Comprueba Node.js, npm, npx y OpenCode.
2. **Compilación**: Compila Angular, NestJS y el plugin TypeScript en `dist/apps/opencode-plugin`.
3. **Directorio de Distribución**: Copia el build a `$HOME/.local/share/madame-agent/`.
4. **Plugin Bridge**: Copia `madame-agent.ts` a `~/.config/opencode/plugins/madame-agent.ts`.
5. **Persistencia de Datos**: Crea `$HOME/.madame-agent/` para la base de datos.

---

## Uso y Funcionamiento del Plugin

1. **Arranque y Parada Sincronizados**: Al iniciar OpenCode (o el comando `opencode serve`), el plugin detecta si el backend de Madame Agent está activo en el puerto configurado (3001 por defecto). Si está apagado, lo arranca de forma autónoma. Al cerrar el IDE o detener el proceso principal, el servidor de NestJS se apaga automáticamente liberando el puerto.
2. **Interfaz de Gestión**: Abre tu navegador en `http://localhost:3001/#/harness` para configurar tus arneses de modelos y ver las métricas en tiempo real.

---

## Detección Automática de Puerto

El plugin de Madame Agent incluye detección automática de puertos:

1. **Si ya hay una instancia corriendo**: El plugin detecta el puerto automáticamente y usa esa instancia.
2. **Si no hay instancia corriendo**: Busca un puerto libre a partir del 3000 y levanta el backend en ese puerto.
3. **Puerto configurado manualmente**: Si defines `baseURL` en `opencode.json`, el plugin usa ese puerto.

### Configuración Manual de Puerto (Opcional)

Si deseas usar un puerto específico, edita `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "madame-agent": {
      "options": {
        "baseURL": "http://localhost:3002/v1"
      }
    }
  }
}
```

El plugin leerá este valor al arrancar.

### Resiliencia durante la Instalación

* Si Madame Agent ya está corriendo cuando instalas una actualización, el script detecta la instancia existente y la usa.
* Si el puerto por defecto (3000-3019) está ocupado por otra aplicación, el plugin busca automáticamente el siguiente puerto libre.

---

## Desinstalación

Para desinstalar Madame Agent completamente de tu sistema, ejecuta el script de desinstalación correspondiente a tu sistema operativo.

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/MAMISHO/madame-agent/main/scripts/uninstall.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/MAMISHO/madame-agent/main/scripts/uninstall-windows.ps1 | iex
```

### ¿Qué elimina el script de desinstalación?

El script de desinstalación elimina los siguientes archivos y directorios:

| Plataforma | Ruta |
|------------|------|
| Plugin OpenCode | `~/.config/opencode/plugins/madame-agent.ts` |
| Instalación | `~/.local/share/madame-agent/` |
| Datos persistentes | `~/.madame-agent/` |

**Nota**: El script de desinstalación también detiene cualquier proceso de Madame Agent que esté corriendo en el puerto 3001 (o el puerto configurado mediante la variable `MADAME_PORT`).
