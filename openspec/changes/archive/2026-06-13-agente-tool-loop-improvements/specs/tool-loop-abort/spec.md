# Tool Loop Abort Specification

## Purpose

Timeout preemptivo con AbortController en provider calls. Previene que llamadas a herramientas queden colgadas indefinidamente y permite que el tool loop recupere el control cuando un provider no responde dentro del tiempo disponible.

## Requirements

### Requirement: AbortSignal Support

Every provider's `chat()` method MUST accept an optional `AbortSignal` parameter. When a signal is provided, the provider MUST pass it to the underlying HTTP call (e.g., `fetch()`). When no signal is provided, the provider SHALL behave as before (no timeout).

#### Scenario: Signal never fires — provider returns normally

- GIVEN a provider call with an AbortSignal that never fires
- WHEN the provider responds within the time limit
- THEN the response is returned normally without interruption

#### Scenario: Signal fires — provider call is aborted

- GIVEN a provider call with an AbortSignal
- WHEN the signal fires before the provider responds
- THEN the call is aborted, AND a controlled `ToolAbortError` is returned (not a crash)

### Requirement: Timeout Enforcement

ToolLoopService MUST create one AbortController per tool call iteration. The timeout MUST be calculated as the remaining session time (`global_timeout_ms` minus elapsed time). If the remaining time is zero or negative, ToolLoopService MUST skip the call and return a timeout error immediately without making the provider call.

#### Scenario: Remaining time is zero — call skipped immediately

- GIVEN the session has 0ms of remaining time
- WHEN a tool call is about to be made
- THEN the call is skipped immediately, AND a timeout error is returned without any provider interaction

### Requirement: Graceful Recovery

When a tool call is aborted, ToolLoopService MUST catch the error and continue the loop for remaining iterations. A single aborted tool call MUST NOT crash the entire session.

#### Scenario: One tool aborts, others complete

- GIVEN a multi-tool session where one tool call is aborted due to timeout
- WHEN the remaining tools have time to complete
- THEN the loop continues execution for subsequent tool calls, AND the aborted call is recorded with an error in the result metadata
