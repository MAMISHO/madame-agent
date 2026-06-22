# Tasks: Agente Tool Loop Improvements

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~200-220 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

## Phase 1: Foundation — Interfaces & Config

- [x] 1.1 Add `signal?: AbortSignal` as 3rd param to `ModelProvider.chat()` in `provider.interface.ts`
- [x] 1.2 Add `ToolCallRecord` interface (`name, args, result, latencyMs, iteration`) to `openai.dto.ts`
- [x] 1.3 Add `toolCalls?: ToolCallRecord[]` to `RouteMetadata` in `router.service.ts`
- [x] 1.4 Bump `max_iterations: 20` and `global_timeout_ms: 300000` in `routing.yaml`

## Phase 2: Provider Abort Support

- [x] 2.1 Accept and forward `signal` to `fetch()` options in `OllamaProvider.chat()`
- [x] 2.2 Accept and forward `signal` to `fetch()` options in `CloudProvider.chat()`
- [x] 2.3 Add `Promise.race` abort guard in `HuggingFaceProvider.chat()` for SDK without signal support

## Phase 3: Core Tool Loop & Metadata

- [x] 3.1 Create `AbortController` per iteration, compute remaining timeout, pass signal to `providerInstance.chat()`, catch `AbortError`, break loop
- [x] 3.2 Log tool name, iteration, truncated args, latency at INFO; full payloads at DEBUG in `executeSingleToolCall()` and loop body
- [x] 3.3 Add `Map`-based tool cache with SHA-256 key (`messagesStr + toolName + stringify(args)`), check before exec, set after result, 100-entry FIFO limit
- [x] 3.4 Add `toolCalls: ToolCallRecord[]` to `ToolLoopResult`, collect during loop
- [x] 3.5 Modify `RouterService.callProviderOrToolLoop()` to surface toolCalls; wire into `RouteMetadata` in all 3 routing paths (direct, classifier, pair)

## Phase 4: Tests

- [x] 4.1 Test abort: mock fetch to hang, fire signal, assert reject; test remaining=0 → skip call
- [x] 4.2 Test cache: same tool+args twice → execute once; different message hash → miss
- [x] 4.3 Test logging: spy on logger, verify INFO fields (name, latency, iteration), verify DEBUG hidden at INFO level
- [x] 4.4 Test metadata: run 1-tool execution, assert `ToolCallRecord` in result
- [x] 4.5 Test HuggingFace abort guard: mock `HfInference`, fire abort, assert controlled rejection
