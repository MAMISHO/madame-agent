# Proposal: Tooling / Function Calling Support for Agentic Tasks

> **Status**: Approved & Implemented
> **Purpose**: Document the problem, the solution, and serve as the spec for tooling execution.
> **Context**: Derived from research in `test-agentes/INFORME-AGENTES.md`.

---

## 1. Problem

### 1.1 Symptom

Previously, madame-agent exposed `POST /v1/chat/completions` as a standard chat proxy. When a prompt requiring filesystem operations (identifying files, creating directories, moving data) was sent, the model could only **describe a textual plan**. It could not execute tools, read the real workspace, or perform actions.

### 1.2 Empirical Evidence

The research showed:

| Research | Prompt | What the model DID | What it SHOULD do |
|---|---|---|---|
| `test-comprehensive` (16 tests) | Multiple prompts | Responded with text | N/A (proxy tests) |
| `test-investigacion` | Encryption reqs analysis | Technical analysis in text | N/A (analysis, not execution) |
| `test-agentes` | Organize test files | Described a Python script with pathlib/shutil | **Read directories, identify files, move them** |

In the agentic study, gemma4 and Deepseek demonstrated high tooling awareness (8/10 and 6/10 indicators respectively), but the API did not allow them to execute anything.

### 1.3 Root Cause

`POST /v1/chat/completions` in madame-agent:
- **DID NOT** support the OpenAI standard `tools` parameter
- **DID NOT** have a model → tool → result → model execution loop
- **DID NOT** expose system tools (filesystem, shell, etc.)
- The model was an "advisor", not an "agent"

---

## 2. Proposed & Implemented Architecture

### 2.1 Overview

```
Client (with tools)
  │
  │ POST /v1/chat/completions
  │ body: { model, messages, tools, tool_choice }
  ▼
┌──────────────────────────────────────────────────────────┐
│ madame-agent                                             │
│                                                           │
│  ┌──────────────────┐    ┌───────────────────────────┐   │
│  │ ProxyController   │───▶│ RouterService             │   │
│  │ (existing)        │    │ (existing, modified)      │   │
│  └──────────────────┘    └──────────┬────────────────┘   │
│                                     │                      │
│                          ┌──────────▼──────────┐          │
│                          │ ToolLoopService      │          │
│                          │ (IMPLEMENTED)        │          │
│                          │                      │          │
│                          │ While model          │          │
│                          │ responds with        │          │
│                          │ tool_calls:          │          │
│                          │   1. Parse tool_call  │          │
│                          │   2. Execute tool     │          │
│                          │   3. Return result    │          │
│                          │   4. Model processes  │          │
│                          │   5. Repeat or stop   │          │
│                          └──────────────────────┘          │
│                                     │                      │
│                          ┌──────────▼──────────┐          │
│                          │ ToolRegistry         │          │
│                          │ (IMPLEMENTED)        │          │
│                          │                      │          │
│                          │ registered tools:    │          │
│                          │  ├─ read_file        │          │
│                          │  ├─ write_file       │          │
│                          │  ├─ glob_files       │          │
│                          │  ├─ execute_command  │          │
│                          │  ├─ list_directory   │          │
│                          │  └─ move_file        │          │
│                          └──────────────────────┘          │
│                                     │                      │
│                          ┌──────────▼──────────┐          │
│                          │ SandboxManager       │          │
│                          │ (IMPLEMENTED)        │          │
│                          │                      │          │
│                          │ Control of:          │          │
│                          │  ├─ working directory │          │
│                          │  ├─ allowed commands  │          │
│                          │  ├─ timeout           │          │
│                          │  └─ max tool calls    │          │
│                          └──────────────────────┘          │
└──────────────────────────────────────────────────────────┘
```

### 2.2 Detailed Flow

```
1. POST /v1/chat/completions { messages, tools, tool_choice }
     │
2. RouterService.route() (existing, apply context)
     │
3. ToolLoopService.execute(modelConfig, messages, tools, maxIterations)
     │
     ├─ 3a. Call model (Ollama or Cloud) with messages + tools
     │
     ├─ 3b. Did the model return tool_calls?
     │      │
     │      ├─ NO → Return final response, DONE
     │      │
     │      └─ YES →
     │           │
     │           ├─ 3c. For each tool_call:
     │           │    ├─ Look up tool in ToolRegistry
     │           │    ├─ Validate args against schema
     │           │    ├─ SandboxManager.check(tool_name, args)
     │           │    ├─ Execute tool (with timeout)
     │           │    └─ Add tool_result to messages
     │           │
     │           ├─ 3d. Was maxIterations reached?
     │           │    ├─ YES → Return partial response, DONE
     │           │    └─ NO → Go back to 3a with updated messages
     │
     └─ 4. ProxyController returns final response (with tool_calls in history)
```

---

## 3. Code Changes

### 3.1 DTO: Extending ChatCompletionRequest

**File**: `src/proxy/dto/openai.dto.ts`

```typescript
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

export class ChatCompletionRequest {
  tools?: ToolDefinition[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
}
```

### 3.2 Service: ToolLoopService

**File**: `src/tools/tool-loop.service.ts`

Handles the execution loop for functions requested by the model.

### 3.3 Service: ToolRegistryService

**File**: `src/tools/tool-registry.service.ts`

Handles the registration and metadata definition for all tools.

```typescript
export interface ToolHandler {
  definition: ToolDefinition;
  execute: (args: any) => Promise<any>;
  timeout?: number;
}
```

### 3.4 Built-in Tools

| Tool | Args | Description | Risk |
|---|---|---|---|
| `read_file` | `{ path }` | Reads a file from the workspace | Low |
| `write_file` | `{ path, content }` | Writes/overwrites a file | High |
| `glob_files` | `{ pattern }` | Searches files by glob pattern | Low |
| `list_directory` | `{ path }` | Lists directory content | Low |
| `move_file` | `{ source, dest }` | Moves/renames a file | Medium |
| `copy_file` | `{ source, dest }` | Copies a file | Medium |
| `execute_command` | `{ command, args, timeout? }` | Executes a shell command | HIGH |
| `create_directory` | `{ path }` | Creates a directory | Low |
| `delete_file` | `{ path }` | Deletes a file | High |

### 3.5 Service: SandboxManagerService

**File**: `src/tools/sandbox-manager.service.ts`

Validations:
- All paths must be within the configured workspace.
- Denied commands: `rm`, `sudo`, `curl`, `wget`
- Maximum timeout per tool call: 30s
- `allow_network: false` by default

### 3.6 Integration in RouterService

If `request.tools.length > 0`, the router delegates execution to `toolLoopService.execute()` instead of calling `providerInstance.chat()` directly.

---

## 4. Configuration

In `routing.yaml`:

```yaml
tools:
  enabled: true
  max_iterations: 10
  sandbox:
    workspace: /Users/mamisho/dev/madame-agent
    denied_commands: [rm, sudo, curl, wget]
    max_timeout_ms: 30000
    allow_network: false
  builtin_tools:
    - read_file
    - write_file
    - glob_files
    - list_directory
    - move_file
    - copy_file
    - execute_command
    - create_directory
    - delete_file
```

---

## 5. Security

| Risk | Mitigation |
|---|---|
| `rm -rf /` | Sandbox restricts workspace + denied_commands |
| Reading .env, .ssh | Whitelist of allowed patterns in sandbox |
| Infinite loop | `max_iterations` + global timeout |
| Command injection | Args sanitization in execute_command |
| Data exfiltration | `allow_network: false` by default |

Principles: **opt-in** (only if the request includes `tools`), **sandbox by default**, **auditable** (each tool_call is registered in ObservabilityService), **always timeout**.

---

## 6. Compatibility by Provider

| Provider | Tool calls | Notes |
|---|---|---|
| Ollama (gemma4:12b-mlx) | ✅ Yes (0.3.0+) | May ignore complex tools |
| Ollama (qwen3.6:27b) | ✅ Yes | Native support |
| NVIDIA (Llama 3.3 70B) | ✅ Yes | OpenAI compatible API |
| NVIDIA (Deepseek V4 Flash) | ✅ Yes | OpenAI compatible API |

Requests **without** `tools` → current behavior, no changes.
