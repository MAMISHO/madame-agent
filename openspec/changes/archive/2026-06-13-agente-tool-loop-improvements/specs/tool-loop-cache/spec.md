# Tool Loop Cache Specification

## Purpose

Cache de resultados de herramientas por message hash + tool name + args hash. Evita re-ejecutar la misma herramienta con los mismos argumentos dentro de una misma sesión, reduciendo latencia y consumo de providers.

## Requirements

### Requirement: Cache Key Composition

The cache key MUST be composed of: session ID, message hash, tool name, and arguments hash. Each unique combination of these values MUST produce a unique cache entry. The system SHALL compute the args hash deterministically so that identical arguments produce the same hash.

#### Scenario: Same message and args — cache hit

- GIVEN a tool was called with message hash X, tool name "read_file", and args hash Y
- WHEN the same tool is called again with the same message hash and same args
- THEN the cached result is returned WITHOUT executing the tool again

#### Scenario: Different message hash — cache miss

- GIVEN a tool was called with message hash X
- WHEN the same tool is called with the same args but a different message hash
- THEN the tool is executed again (cache miss)

### Requirement: Session Scope

The cache MUST be scoped to a single session. Cache entries MUST be cleared when a new session or request starts. Cache MUST NOT persist across requests.

#### Scenario: New session — previous cache cleared

- GIVEN a tool result was cached in session A
- WHEN session B starts
- THEN the cache from session A is cleared, AND the tool is executed fresh on first invocation

### Requirement: TTL Expiration

Each cache entry MUST have a configurable time-to-live (TTL). Once the TTL expires, the entry MUST be invalidated and the tool re-executed on the next call. The default TTL SHALL be defined in configuration.

#### Scenario: TTL expired — tool re-executed

- GIVEN a cached tool result with a TTL of 60 seconds
- WHEN 61 seconds have passed since caching
- THEN the next call to the same tool with same args re-executes the tool (cache miss due to TTL)
