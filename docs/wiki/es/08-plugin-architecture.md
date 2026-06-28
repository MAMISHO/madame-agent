# Arquitectura del Plugin: Madame-Agent para OpenCode

## 1. Introducción y Contexto

Actualmente, **Madame-Agent** funciona como un proxy independiente (Standalone Proxy) compatible con la API de OpenAI. Sin embargo, OpenCode dispone de un sistema de extensión muy potente.

### ¿Qué diferencia a los Plugins de los MCPs en OpenCode?
- **MCP (Model Context Protocol)**: Está diseñado para proporcionar contexto y **tools** a los agentes (por ejemplo, permitirle al agente ejecutar comandos, leer bases de datos o acceder a APIs externas). No puede alterar la interfaz del usuario ni el núcleo de enrutamiento de modelos.
- **Plugins (`@opencode-ai/plugin`)**: Tienen acceso profundo a la plataforma. Pueden registrar **Nuevos Proveedores de Modelos** (`ProviderHook`), crear comandos en el chat (`command.execute.before`), transformar mensajes, alterar los parámetros que se envían al LLM, y lo más importante: **inyectar Interfaz de Usuario (TUI/Web)** usando componentes reactivos de SolidJS.

Por lo tanto, **enfocar Madame-Agent como un Plugin de OpenCode es la evolución natural e ideal**. Nos permite eliminar la necesidad de configurar manualmente el `opencode.json` y proporciona una experiencia visual integrada.

---

## 2. Arquitectura Propuesta del Plugin

El plugin de Madame-Agent constará de tres partes principales:

1. **Manifiesto (`plugin.json`)**: Define los metadatos y puntos de entrada del plugin.
2. **Servidor (`server` hook)**: Gestiona el ciclo de vida del proxy de Madame-Agent (arranque/apagado) y registra los modelos virtuales (orquestador/local) de forma dinámica usando el `ProviderHook`.
3. **Interfaz (`tui` hook)**: Proporciona la visualización de los costes directamente en el cliente de OpenCode.

### Diagrama de Arquitectura (Mermaid)

```mermaid
graph TD
    subgraph OpenCode
        C[OpenCode Client Web/CLI] --> TUI(Plugin: tui.ts)
        S[OpenCode Server] --> SRV(Plugin: server.ts)
    end

    subgraph Madame-Agent Plugin
        SRV -->|ProviderHook| PM[Registra Provider Virtual]
        SRV -->|Ciclo de vida| P[Proceso Proxy Node.js :3001]
        
        TUI -->|Slot Register| Slot[Panel UI Integrado]
        TUI -->|Command Register| Slash[/madame-stats]
    end

    Slot -->|REST GET /v1/costs| P
    Slash -->|REST GET /v1/costs| P
    PM -->|Enruta Tráfico LLM| P
```

---

## 3. Visualización de Costes (UI)

De acuerdo a los requisitos, se implementará una doble estrategia de visualización (A y B) para cubrir tanto el panel continuo como las consultas bajo demanda.

### Opción A: Visualización en Panel (Web Client)
La API TUI de OpenCode (versión `1.4.10+`) permite inyectar componentes mediante `api.slots.register`.

- **Implementación**: Usaremos `@opentui/solid` para crear un componente de Dashboard.
- **Ubicación**: Inyectaremos el panel en el slot `sidebar_content` o `home_bottom`.
- **Funcionamiento**: El componente realizará polling o conectará por WebSocket/SSE a `http://localhost:3001/dashboard` para mostrar en tiempo real los tokens de entrada/salida ahorrados y el coste evitado.

### Opción B: Comando Slash (`/madame-stats`)
Registraremos un comando nativo en el chat de OpenCode mediante `api.command.register({ slash: { name: "madame-stats" } })`. Su comportamiento será adaptativo según el entorno donde se ejecute:

1. **En el Cliente Web**:
   - Al ejecutar el comando, el TUI lanzará un Modal interactivo usando `api.ui.Dialog`.
   - Mostrará gráficos o tablas detalladas con los costes de la sesión actual, sin ensuciar el historial del chat.
2. **En Consola / CLI**:
   - Si el usuario está usando OpenCode en terminal nativa, no hay webviews disponibles.
   - El TUI detectará el entorno y usará `api.renderer` para imprimir directamente el resumen de costes en formato de texto enriquecido / Markdown en la consola (similar al resumen de CostTrackerService).

---

## 4. Ciclo de Vida y Ventajas

1. **Auto-arranque (Auto-start)**: El archivo `server.ts` del plugin importará el núcleo de Madame-Agent y levantará el servidor Express/Fastify en el puerto `3001` (o uno dinámico) automáticamente al arrancar OpenCode.
2. **Zero-Config**: A través del `ProviderHook`, el plugin inyectará dinámicamente un proveedor llamado `Madame` con los modelos `Gemini-Orchestrator+Gemma12B-OC`, eliminando el paso en el que el usuario debe editar su `opencode.json`.
3. **Persistencia**: Los logs y estadísticas de la sesión se mantendrán sincronizados con el `sessionID` que OpenCode expone a través del TUI.
