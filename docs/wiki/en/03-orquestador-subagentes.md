# Orchestrator to Local/Hybrid Subagent Delegation

This document details the technical design, architecture, and behavior of task delegation from orchestrator models (usually large and in the cloud) to smaller-scale local or hybrid subagents.

---

## 1. Motivation and Goal

The main goal is to optimize token usage and context window space in the primary (orchestrator) model.

When a complex task requires using tools or multiple iterations (for example, analyzing the filesystem, making modifications, and running tests), the main orchestrator delegates this task to a local or hybrid subagent. The subagent runs its own tool loop in a completely separate and isolated memory context. Once the subtask is resolved, the subagent returns **only the final result** to the main orchestrator.

Additionally, **the execution history within a session is compacted** (`executionSummary`) by `WorkflowService`, meaning the orchestrator does not receive the raw history chats, but rather a summary of the tools used and the results. All intermediate history and subagent tool outputs are discarded or compacted, keeping the orchestrator's context window extremely clean.

---

## 2. Delegation Architecture

```
  ┌────────────────────────────────────────────────────────┐
  │ Madame-Agent (Cloud Orchestrator)                       │
  │                                                        │
  │  Client Message                                        │
  │    │                                                   │
  │    ▼                                                   │
  │  [RouterService] ──► Extracts messages and invokes WorkflowService
  │    │                                                   │
  │    ▼                                                   │
  │  [WorkflowService] ──► Maintains session and compacts history (`executionSummary`)
  │    │                                                   │
  │    ├─ (Prepares prompt and tools)                      │
  │    │                                                   │
  │    ▼                                                   │
  │  [ModelResolverService] ──► Resolves orchestrator and hybrid pairs
  │    │                                                   │
  │    ▼                                                   │
  │  [ToolLoopService] (Cloud Orchestrator)                │
  │    │                                                   │
  │    └─ If decides to delegate ──► Calls `delegate_subagent`
  └────┼───────────────────────────────────────────────────┘
       │
       ▼ Isolated and Recursive Execution
  ┌────────────────────────────────────────────────────────┐
  │ Madame-Agent (Local/Hybrid Subagent)                   │
  │                                                        │
  │  [WorkflowService] (Delegates to subagent)             │
  │    │                                                   │
  │    ▼                                                   │
  │  [ModelResolverService] ──► Determines if subagent escalates to Cloud
  │    │                                                   │
  │    ▼                                                   │
  │  [ToolLoopService] (Subagent)                          │
  │    │                                                   │
  │    ├─ Executes tools (read_file, write_file, ...)      │
  │    │                                                   │
  │    ▼                                                   │
  │  Returns only the final clean solution text            │
  └────────────────────────────────────────────────────────┘
```

---

## 3. Configuration (`routing.yaml`)

Support for orchestrator-subagent pairs is defined using the `orchestrator_pairs` directive. Additionally, a pool of default subagent providers can be defined.

```yaml
routing:
  ...
  subagent:
    providers:
      - local_medium
      - local_qwen

orchestrator_pairs:
  - id: llama-gemma-orchestrator
    name: "Llama70B-Orchestrator+Gemma12B"
    orchestrator: cloud_nvidia
    subagents:
      - local_medium
      - local_qwen
  - id: deepseek-hybrid-orchestrator
    name: "DeepseekFlash-Orchestrator+Gemma4DeepseekHybrid"
    orchestrator: cloud_nvidia_deepseek
    subagents:
      - gemma4-deepseek
      - local_medium
```

---

## 4. Failover Strategy

The delegation method implements fault tolerance using ordered retries and isolated self-allocation:

1. **Subagent Resolution**: An ordered list of subagents is obtained (e.g., `[local_medium, local_qwen]`). If the orchestrator model requests a specific subagent via argument, it takes priority.
2. **Cascading Retries (Failover)**:
   - The subtask is attempted on the first subagent.
   - If it fails (connection issues, local model crash, model errors), the error is logged and it automatically retries with the next subagent in the list.
3. **Self-Allocation in Isolated Fallback**:
   - If all configured subagents fail, the task is not lost.
   - The system executes the task autonomously using the **orchestrator** model itself, but in a completely new and independent chat context to protect the main flow memory.

---

## 5. Task Traceability and Observability

To maintain visibility over active subtasks, `ObservabilityService` logs and exposes subagent traceability:

### Traceability Structure
Each subagent task is registered with:
- `requestId`: Unique subagent request ID (`sub_xxxxxx`).
- `parentRequestId`: Parent request ID that spawned it (`req_xxxxxx`).
- `subagentModel`: Name or ID of the running subagent model.
- `taskDescription`: Detailed explanation of the sent subtask.
- `status`: Current status (`running`, `completed`, `failed`, `cancelled`).
- `startedAt`: Timestamp when started.

### Monitoring API
Madame-agent exposes the endpoint:
- **`GET /v1/subagents/active`**: Returns a detailed list of all subagent tasks currently executing in the background.

---

## 6. Cascading Abort

If the final client cancels or interrupts the main orchestrator's HTTP request (for example, by cancelling code generation in the IDE or OpenCode):

1. The controller detects the disconnection via Express's request `close` event.
2. It invokes `observabilityService.cancelSubagentsForParent(requestId)`.
3. The service searches for all active subtasks associated with the cancelled request.
4. It calls the `.abort()` method of the corresponding `AbortController` for each subagent.
5. The tool execution loop (`ToolLoopService`) and the HTTP request to the local/cloud provider are immediately aborted, releasing resources on the local server.
