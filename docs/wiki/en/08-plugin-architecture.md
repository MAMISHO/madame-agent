# Plugin Architecture: Madame-Agent for OpenCode

## 1. Introduction and Context

Currently, **Madame-Agent** runs as a standalone proxy compatible with the OpenAI API. However, OpenCode has a powerful extension system.

### What is the difference between Plugins and MCPs in OpenCode?
- **MCP (Model Context Protocol)**: Designed to provide context and **tools** to models (e.g., allowing a model to run commands, read databases, or access external APIs). It cannot alter the user interface or the model routing core.
- **Plugins (`@opencode-ai/plugin`)**: Have deep access to the platform. They can register **New Model Providers** (`ProviderHook`), create chat commands (`command.execute.before`), transform messages, alter parameters sent to the LLM, and most importantly: **inject User Interface (TUI/Web)** using reactive SolidJS components.

Therefore, **approaching Madame-Agent as an OpenCode Plugin is the natural and ideal evolution**. It eliminates the need to manually configure `opencode.json` and provides an integrated visual experience.

---

## 2. Proposed Plugin Architecture

The Madame-Agent plugin will consist of three main parts:

1. **Manifest (`plugin.json`)**: Defines the metadata and entry points of the plugin.
2. **Server (`server` hook)**: Manages the lifecycle of the Madame-Agent proxy (startup/shutdown) and dynamically registers virtual models (orchestrator/local) using the `ProviderHook`.
3. **Interface (`tui` hook)**: Provides cost visualization directly in the OpenCode client.

### Architecture Diagram (Mermaid)

```mermaid
graph TD
    subgraph OpenCode
        C[OpenCode Client Web/CLI] --> TUI(Plugin: tui.ts)
        S[OpenCode Server] --> SRV(Plugin: server.ts)
    end

    subgraph Madame-Agent Plugin
        SRV -->|ProviderHook| PM[Registers Virtual Provider]
        SRV -->|Lifecycle| P[Node.js Proxy Process :3001]
        
        TUI -->|Slot Register| Slot[Integrated UI Panel]
        TUI -->|Command Register| Slash[/madame-stats]
    end

    Slot -->|REST GET /v1/costs| P
    Slash -->|REST GET /v1/costs| P
    PM -->|Routes LLM Traffic| P
```

---

## 3. Cost Visualization (UI)

A double visualization strategy (A and B) will be implemented to cover both the continuous panel and on-demand queries.

### Option A: Panel Visualization (Web Client)
The OpenCode TUI API (version `1.4.10+`) allows components to be injected using `api.slots.register`.

- **Implementation**: We will use `@opentui/solid` to create a Dashboard component.
- **Location**: We will inject the panel into the `sidebar_content` or `home_bottom` slot.
- **Behavior**: The component will poll or connect via WebSocket/SSE to `http://localhost:3001/dashboard` to display input/output tokens saved and avoided cost in real-time.

### Option B: Slash Command (`/madame-stats`)
We will register a native command in the OpenCode chat via `api.command.register({ slash: { name: "madame-stats" } })`. Its behavior will adapt depending on the environment where it runs:

1. **In the Web Client**:
   - When executing the command, the TUI will launch an interactive Modal using `api.ui.Dialog`.
   - It will show detailed charts or tables of the current session costs without cluttering the chat history.
2. **In the Console / CLI**:
   - If the user is using OpenCode in a native terminal, webviews are not available.
   - The TUI will detect the environment and use `api.renderer` to print the cost summary in rich text / Markdown format directly to the console (similar to the summary from CostTrackerService).

---

## 4. Lifecycle and Benefits

1. **Auto-start**: The plugin's `server.ts` file will import the Madame-Agent core and start the Express/Fastify server on port `3001` (or a dynamic one) automatically when OpenCode starts.
2. **Zero-Config**: Via the `ProviderHook`, the plugin will dynamically inject a provider named `Madame` with the models `Gemini-Orchestrator+Gemma12B-OC`, removing the step where the user has to edit their `opencode.json`.
3. **Persistence**: Session logs and stats will remain synchronized with the `sessionID` exposed by OpenCode through the TUI.
