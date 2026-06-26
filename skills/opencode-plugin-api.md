---
name: "opencode-plugin-api"
description: "Core API types for @opencode-ai/plugin including ProviderHook and Plugin interfaces."
version: "1.0.0"
category: "API Reference"
tags: ["opencode", "plugin", "typescript", "provider"]
status: "verified"
---
# OpenCode Plugin API Specification Skill

This skill provides the correct TypeScript definitions, API signatures, and architectural patterns for creating OpenCode plugins using `@opencode-ai/plugin` and `@opentui/solid`.

## 1. Directory & Imports Structure
When writing plugins, always import the types from the correct locations:
- Server-side types: `import { Plugin, Hooks, ProviderHook } from '../types/index.js';`
- TUI (UI) types: `import { TuiPlugin, TuiCommand } from '../types/tui.js';`

## 2. Server Hook (`server.ts`)
The server hook initializes the plugin, hooks into the lifecycle, and registers virtual model providers.

```typescript
import { Plugin, Hooks, ProviderHook } from '../types/index.js';

// The plugin must export a default async function matching the Plugin type
const plugin: Plugin = async (input) => {
  // Start your local servers or initialize resources here
  // e.g. Express/NestJS server on http://localhost:3001
  
  const providerHook: ProviderHook = {
    id: 'madame-agent',
    models: async (provider, ctx) => {
      return {
        'gemini-gemma-oc': {
          id: 'gemini-gemma-oc',
          name: 'Gemini-Orchestrator+Gemma12B-OC',
          provider: 'madame-agent',
          capabilities: ['chat'],
          // Define other models or providers here
        }
      };
    }
  };

  const chatHook = {
    params: async (params, ctx) => {
      // Modify or redirect request params here
      if (params.model === 'gemini-gemma-oc') {
        params.url = 'http://localhost:3001/v1/chat/completions';
      }
      return params;
    },
    headers: async (headers, ctx) => {
      // Add authentication or routing headers
      return headers;
    }
  };

  return {
    providers: [providerHook],
    chat: chatHook
  };
};

export default plugin;
```

## 3. TUI Hook (`tui.ts`)
The TUI hook registers user interface components, sidebar slots, and slash commands.

```typescript
import { TuiPlugin, TuiCommand } from '../types/tui.js';

const tuiPlugin: TuiPlugin = async (api) => {
  // 1. Register Slash Commands
  api.command.register(() => [
    {
      name: 'madame-stats',
      description: 'Show Madame-Agent token usage and cost statistics',
      execute: async (args, context) => {
        // If web environment, open dialog
        if (api.ui && api.ui.Dialog) {
          api.ui.Dialog.open({
            title: 'Madame-Agent Stats',
            content: 'Cost avoided: ...'
          });
        } else {
          // Fallback for CLI/Console using renderer
          api.renderer.print('Madame-Agent Statistics:\nCost avoided: ...');
        }
      }
    }
  ]);

  // 2. Register UI Sidebar/Slots
  api.slots.register('sidebar_content', () => {
    // Return or render the SolidJS component from @opentui/solid
    return {
      name: 'Madame Stats Panel',
      component: 'MadameStatsDashboard'
    };
  });
};

export default tuiPlugin;
```

## 4. Manifest (`plugin.json`)
The manifest file registers the entry points of your hooks.

```json
{
  "name": "madame-agent",
  "version": "1.0.0",
  "description": "Madame-Agent integration plugin for OpenCode",
  "entry": {
    "server": "./dist/server.js",
    "tui": "./dist/tui.js"
  }
}
```
