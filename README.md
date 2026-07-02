# Madame Agent (hybrid proxy)

Madame Agent es un monorrepo que proporciona un proxy híbrido (backend NestJS, frontend Angular) y un plugin de OpenCode para orquestar la delegación entre modelos locales (Ollama) y en la nube.

---

## Requisitos Previos

Antes de instalar Madame Agent, asegúrate de tener instalados los siguientes componentes:
1. **Node.js** (v18 o superior) y **npm** (que incluye `npx`).
2. **OpenCode** (el IDE o servidor de terminal `opencode`). Debes haberlo iniciado al menos una vez para que se cree su estructura de configuración inicial.
3. **Git** (para descargar y actualizar el repositorio).

## Instalación Rápida (Un Solo Paso)

Para instalar Madame Agent automáticamente en un solo paso, abre tu terminal y ejecuta el siguiente comando:

### macOS / Linux

```bash
# Instalación estándar (puerto 3001)
curl -fsSL https://raw.githubusercontent.com/MAMISHO/madame-agent/main/scripts/bootstrap.sh | bash

# Si el puerto 3001 está ocupado, puedes indicar otro puerto (por ejemplo, el 3002):
curl -fsSL https://raw.githubusercontent.com/MAMISHO/madame-agent/main/scripts/bootstrap.sh | bash -s -- --port 3002
```

---

## Instalación Paso a Paso (Modo Manual)

Para descargar e instalar el plugin y el backend de forma completamente automatizada en tu sistema, ejecuta el siguiente bloque de comandos en tu terminal:

### macOS / Linux

```bash
# 1. Clonar el repositorio oficial
git clone https://github.com/MAMISHO/madame-agent.git
cd madame-agent

# 2. Instalar dependencias globales del monorrepo
npm install

# 3. Lanzar el script de instalación automática
chmod +x scripts/install.sh scripts/install-unix.sh
./scripts/install.sh
```

### Windows (PowerShell)

```powershell
# 1. Clonar el repositorio oficial
git clone https://github.com/MAMISHO/madame-agent.git
cd madame-agent

# 2. Instalar dependencias globales del monorrepo
npm install

# 3. Lanzar el script de instalación automática
Set-ExecutionPolicy Bypass -Scope Process -Force
.\scripts\install.sh
```

---

## ¿Qué hace el Script de Instalación?

1. **Verificación de Entorno**: Comprueba que tienes instalados Node.js, npm, npx y OpenCode.
2. **Compilación y Empaquetado**: Compila la interfaz de Angular, el servidor NestJS y el plugin en TypeScript, ensamblando un build autocontenido en la carpeta `dist/apps/opencode-plugin`.
3. **Directorio de Distribución**: Copia el build completo al directorio de usuario del sistema (independiente de tu carpeta de desarrollo/repositorio):
   - **macOS / Linux**: `$HOME/.local/share/madame-agent/`
   - **Windows**: `%LOCALAPPDATA%\madame-agent\`
4. **Persistencia de Datos**: Crea la carpeta `$HOME/.madame-agent/` donde se persistirá de forma segura tu base de datos SQLite (`madame-agent.sqlite`), evitando pérdida de arneses al actualizar el código.
5. **Instalación del Plugin**: Instala el script puente `madame-agent.ts` en `~/.config/opencode/plugins/madame-agent.ts`.
6. **Configuración Automática**: Realiza una copia de seguridad con fecha y hora de tu `opencode.json` y actualiza la configuración para registrar el proveedor `madame-agent` y el path del backend dinámicamente.

---

## Uso y Funcionamiento del Plugin

1. **Arranque y Parada Sincronizados**: Al iniciar OpenCode (o el comando `opencode serve`), el plugin detecta si el backend de Madame Agent está activo en el puerto configurado (3001 por defecto). Si está apagado, lo arranca de forma autónoma. Al cerrar el IDE o detener el proceso principal, el servidor de NestJS se apaga automáticamente liberando el puerto.
2. **Interfaz de Gestión**: Abre tu navegador en `http://localhost:3001/#/harness` para configurar tus arneses de modelos y ver las métricas en tiempo real.

---

## Personalización de Puerto y Resiliencia

### Cómo cambiar el puerto de Madame Agent
Si el puerto `3001` ya está ocupado en tu máquina, puedes parametrizar un puerto diferente en tu archivo `~/.config/opencode/opencode.json` modificando el campo `baseURL` del proveedor:

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

El plugin leerá automáticamente este valor en el arranque e iniciará el servidor backend de Madame Agent en el nuevo puerto configurado (`3002` en este caso).

### Resiliencia durante la Instalación
* Si realizas una reinstalación o actualización del monorrepo mientras Madame Agent se está ejecutando en el puerto configurado, el script de instalación detectará que el puerto está ocupado por Madame Agent (mediante una verificación interna de su estado de salud), detendrá el proceso anterior automáticamente de forma limpia y procederá con la copia de los nuevos compilados sin bloqueos de archivos.
* Si el puerto está ocupado por una aplicación externa que no es Madame Agent, el script se detendrá mostrando un error descriptivo e indicando que debes configurar un puerto diferente antes de continuar.
