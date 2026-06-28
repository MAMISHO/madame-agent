# Harness Audit Report — madame-agent

## Goal
- Perform a comprehensive technical audit of the madame-agent project (NestJS LLM delegation harness) and write findings to `docs/audit/harness-audit-report.md` per the ORNITH SELF-SCAFFOLDING AUDIT TASK protocol.

## Constraints & Preferences
- Follow Engram persistent memory protocol (`mem_save`, `mem_session_summary`)
- Write final output exactly as if writing to `docs/audit/harness-audit-report.md`
- Use `<template>` structure for anchored summary
- Do not answer the conversation; summarize only
- Preserve exact file paths and identifiers

## Progress
### Done
- Read all 10 documentation files in `docs/wiki/en/` (00-overview through 09-integracion-opencode)
- Read core NestJS entry points: `src/main.ts`, `src/app.module.ts`, `src/app.controller.ts`, `src/app.service.ts`
- Read proxy module: `src/proxy/proxy.controller.ts`, `src/proxy/proxy.service.ts`, `src/proxy/proxy.module.ts`
- Read router core: `src/router/router.service.ts`, `src/router/model-resolver.service.ts`, `src/router/workflow.service.ts`
- Read providers/: `cloud.provider.ts`, `ollama.provider.ts`, `huggingface.provider.ts`, `provider.interface.ts`, `providers.service.ts`
- Read classifier/: `classifier.service.ts` (uses @xenova/transformers zero-shot classification with heuristic fallback)
- Read confidence/: `confidence.service.ts` — ConfidenceEngineService with configurable threshold + mode-based routing
- Read context/: `context.service.ts`, `deduplicator.service.ts` (consecutive dup removal, user/system first-occurrence, assistant last-occurrence), `compressor.service.ts` (token estimation, truncation, sliding window)
- Read cache/: `cache.service.ts` — semantic cache with Ollama embedding + cosine similarity
- Read tools/: `tool-loop.service.ts` (6-phase tool calling: parse→validate→sandbox→execute→observe→loop), `sandbox-manager.service.ts` (path/command/timeout/network checks, denied commands list), `tool-registry.service.ts`, `built-in-tools.service.ts` (10 built-in tools)
- Read observability/: `observability.service.ts` — request metrics, routing info, health endpoint, cost tracker
- Read harness/: `harness.service.ts`, `opencode.strategy.ts`, `cli.strategy.ts` (intervention reply detection)

### In Progress
- Compile audit findings and write final report to `docs/audit/harness-audit-report.md`

### Blocked
- (none)

## Key Decisions
- (none yet — audit is in progress)

## Next Steps
1. Write complete audit report with findings against 4 criteria
2. Save key architectural decisions via `mem_save` after writing the report

## Critical Context
- Project: madame-agent — NestJS TypeScript LLM orchestrator/proxy for OpenCode plugin integration
- Architecture: Orchestrator/Subagent hierarchy with context compaction, dynamic escalation, semantic cache, tool calling (6 phases), confidence engine
- Key concern: Stream corruption/malformed JSON chunks handling during long-running delegation loops

## Relevant Files
- `docs/wiki/en/00-overview.md` through `docs/wiki/en/09-integracion-opencode.md` — architecture documentation
- `src/main.ts` — NestJS bootstrap entry point (10 lines)
- `src/app.module.ts` — Root module with all sub-modules imported (31 lines)
- `src/proxy/proxy.controller.ts` — OpenAI-compatible `/v1/chat/completions` + `/v1/models` endpoints
- `src/router/router.service.ts` — Main routing logic with 6 phases
- `src/router/workflow.service.ts` — Orchestrator-subagent delegation loop with QA, confirmation, iteration
