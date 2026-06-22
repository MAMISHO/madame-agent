# Design: Agente Tool Loop Improvements

## Technical Approach

Five independent concerns, one pass: (1) `AbortSignal` threaded through the provider chain for preemptive timeout, (2) structured logging per tool call, (3) config defaults bumped to 300s / 20 iterations, (4) session-scoped tool result cache, (5) tool call metadata in `RouteMetadata` and `response.data`.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| Signal param | `signal?: AbortSignal` as 3rd optional arg in `ModelProvider.chat()` | Wrapped options object, separate `abort()` method | Minimal interface delta, non-breaking, fetch natively accepts signal |
| Tool cache scope | `Map` inside `execute()`, discarded on return | Redis, shared `CacheService`, LRU | No cross-request persistence needed; 20-iteration loop is trivially bounded |
| HF abort strategy | `Promise.race([hfCall, rejectOnAbort(signal)])` | Patch HfInference internals, skip abort | Provider-agnostic; works regardless of SDK version |
| Metadata destination | `RouteMetadata.toolCalls` + `response.data._toolCalls` | Only metadata, only in logs | Observability needs it in metadata; clients benefit from inline visibility |

## Data Flow

```
ToolLoopService.execute(request, modelConfig)
  │
  ├─ abortController = new AbortController()
  ├─ toolCache = new Map()
  │
  └─ for iteration i in 0..maxIterations:
       │
       │  remaining = globalTimeoutMs - elapsed
       │  if remaining ≤ 0 → break (loop timeout)
       │
       ├─ providerInstance.chat(req, modelConfig, abortController.signal)
       │    ├─ on abort → ToolLoopAbortError → break loop
       │    └─ no tool_calls → return early
       │
       └─ for each toolCall in response:
            │
            │  key = sha256(msgHash + toolName + stringify(args))
            ├─ cache.has(key) → return cached result (skip execute)
            ├─ cache miss → result = await tool.execute(args)
            │              → cache.set(key, result)
            │
            ├─ log(name, args, result, latencyMs)
            └─ collect ToolCallRecord
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/providers/provider.interface.ts` | Modify | `signal?: AbortSignal` on `chat()` |
| `src/providers/ollama.provider.ts` | Modify | Pass `signal` to `fetch()` |
| `src/providers/cloud.provider.ts` | Modify | Pass `signal` to `fetch()` |
| `src/providers/huggingface.provider.ts` | Modify | `Promise.race` with abort guard |
| `src/providers/providers.service.ts` | Modify | Forward `signal` in `getProvider().chat()` |
| `src/tools/tool-loop.service.ts` | Modify | AbortController, logging, cache, `ToolCallRecord[]` |
| `src/router/router.service.ts` | Modify | Add `toolCalls` to `RouteMetadata` |
| `src/proxy/dto/openai.dto.ts` | Modify | Add `ToolCallRecord` interface |
| `routing.yaml` | Modify | `max_iterations: 20`, `global_timeout_ms: 300000` |
| `src/config/configuration.ts` | Modify | Bump defaults |

## Interfaces / Contracts

```typescript
// provider.interface.ts
interface ModelProvider {
  chat(
    request: ChatCompletionRequest,
    modelConfig: any,
    signal?: AbortSignal,          // ← NEW
  ): Promise<ProviderResponse>;
}

// openai.dto.ts — NEW
interface ToolCallRecord {
  name: string;
  args: any;
  result: any;
  latencyMs: number;
  iteration: number;
}

// router.service.ts — NEW field on RouteMetadata
interface RouteMetadata {
  // ...existing fields...
  toolCalls?: ToolCallRecord[];
}
```

### Tool Cache Design

- **Key**: `crypto.createHash('sha256').update(messagesStr + toolName + JSON.stringify(args)).digest('hex')`
- **Scope**: Fresh `Map` inside `execute()`, discarded on return
- **TTL**: None (session-scoped per invocation)
- **Eviction**: FIFO at 100 entries (theoretical ceiling for 20 iterations × 5 tools)

### Abort/Timeout Behavior

```
Timeout detection:   Date.now() - startTime > globalTimeoutMs → break
Preemptive abort:    provider.chat() with signal → on timeout signal fires → fetch rejects
HuggingFace abort:   Promise.race([hf.chatCompletion(), new Promise((_,rej) => signal.onabort = rej)])
Error classification: ToolLoopAbortError (name === 'AbortError') → push to errors[], break loop
Final response:      After abort/break, return last successful provider response (not re-call)
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Signal abort → provider rejects | Mock fetch to hang, signal abort, assert reject in <5ms |
| Unit | Cache returns cached result | Same tool+args twice in one execute(), assert tool.execute called once |
| Unit | Log output has name/args/latency | Spy on logger, verify structured fields |
| Unit | HuggingFace Promise.race abort | Mock HfInference, verify abort guard fires |
| Unit | ToolCallRecord in metadata | 1-tool execution, assert `metadata.toolCalls[0].name` exists |
| Integration | 300s timeout / 20 iterations | Slow tool mock, assert loop terminates gracefully |

## Migration / Rollout

No migration required. `signal` is optional — existing callers unchanged. Config bumps are backward-compatible. Rollback: revert `routing.yaml` and configuration defaults; if AbortController introduces bugs, revert only the provider interface + implementations.

## Open Questions

- [ ] `@huggingface/inference` SDK version — does it support `AbortSignal` in `chatCompletion()` options? If not, `Promise.race` wrapper confirmed as fallback. Verify during apply.
