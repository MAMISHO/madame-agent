# Tool Loop Logging Specification

## Purpose

Logging detallado de cada tool call en el tool loop: tool name, argumentos truncados, resultado, latencia, e información de iteración. Proporciona visibilidad para debugging y monitoreo de rendimiento.

## Requirements

### Requirement: Tool Call Logging

The system MUST log the following fields for every tool call execution: tool name, iteration number, truncated arguments (max 500 chars), and latency in milliseconds.

#### Scenario: Successful tool call logged

- GIVEN a tool call completes successfully
- WHEN the result is returned
- THEN the log contains tool name, iteration, latency, and truncated args

#### Scenario: Zero-latency tool call

- GIVEN a tool that returns near-instantly
- WHEN the call completes
- THEN the logged latency is 0 or a small positive integer

### Requirement: Error Logging

When a tool call fails or is aborted, the system MUST log the error message and stack trace in addition to the standard tool call fields.

#### Scenario: Tool call throws — error logged with stack trace

- GIVEN a tool call that throws an exception
- WHEN the error is caught by ToolLoopService
- THEN the log includes the error message AND the full stack trace

### Requirement: Log Level Separation

Detailed payloads (full args, full result) MUST be logged at DEBUG level. Summary fields (tool name, latency, iteration) MUST be logged at INFO level.

#### Scenario: Debug-level payloads hidden in production

- GIVEN the logger is configured at INFO level
- WHEN a tool call completes
- THEN the INFO-level log shows summary fields, AND DEBUG-level payloads are not printed
