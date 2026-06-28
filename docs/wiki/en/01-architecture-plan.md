# Madame-Agent — Implementation Plan

## Goal

LLM orchestrator acting as an intermediate layer between development tools (OpenCode, IDEs, agents, CLI) and multiple model providers. Reduces cloud costs, optimizes token usage, and enables hybrid local+cloud setups.

Stack: **NestJS + TypeScript**

## Current Project Status (June 2026)

| Component | Status | Detail |
|---|---|---|
| P0: Repo Setup | ✅ COMPLETE | .gitignore configured, removed node_modules/dist/.atl from git cache |
| F1: OpenAI Proxy | ✅ COMPLETE | POST /v1/chat/completions + GET /v1/models |
| F2: Provider Abstraction | ✅ COMPLETE | Interface + Ollama, Cloud, HuggingFace implementations |
| F3: Router | ✅ COMPLETE | Direct routing + classifier + confidence + escalation |
| F4: Context Processor | ✅ COMPLETE | Dedup + Compress integrated into the Router |
| F5: Task Classifier | ✅ COMPLETE | transformers.js zero-shot, returns {mode, confidence} |
| F6: Confidence Engine | ✅ COMPLETE | ConfidenceEngineService with configurable threshold |
| F7: Escalation System | ✅ COMPLETE | Routes to escalation provider if confidence < threshold |
| F8: Semantic Cache | ✅ COMPLETE | CacheService with embeddings via Ollama, cosine similarity, in-memory store, integrated into RouterService (3 paths) |
| F9: Translation Layer | ✅ COMPLETE | TranslationService with language detection + translation via Ollama, integrated into RouterService |
| F10: Observability | ✅ COMPLETE | Metrics, health, per-request logs |
| F11: Tool Calling | ✅ COMPLETE | 6 phases: DTO → ToolRegistry → Sandbox → ToolLoop → Router → Tests. 9 built-in tools. |
| F12: Orchestrator Delegation | ✅ COMPLETE | Cloud orchestrator delegates to local/hybrid subagents, ordered failover, active tracking, and cascading abort |
| Unit Tests | ✅ COMPLETE | 71 tests, 10 suites |
| Observability trackRequest | ✅ COMPLETE | RouterService returns RouteResult with metadata, ProxyController calls trackRequest() |
| OpenCode Connection | ✅ COMPLETE | Provider `madame-agent` configured in opencode.json as OpenAI-compatible |
| NVIDIA Connection | ✅ COMPLETE | `NVIDIA_API_KEY` in environment, routing.yaml points to NVIDIA |

---

## Implementation Priorities

### PRIORITY 0 — Repository Configuration ✅

| # | Task | Status |
|---|---|---|
| 0.1 | Create .gitignore for NestJS/TypeScript | ✅ |
| 0.2 | Remove node_modules, dist, .atl from git index | ✅ |

### PRIORITY 1 — Routing and Configuration Foundations ✅

| # | Task | Status |
|---|---|---|
| 1.1 | routing.yaml synchronized with OpenCode | ✅ (NVIDIA + gemma4) |
| 1.2 | NVIDIA API key from environment | ✅ (NVIDIA_API_KEY) |
| 1.3 | Local model from routing.yaml | ✅ (gemma4:12b-mlx) |
| 1.4 | Unit tests for RouterService | ✅ (9 tests) |

### PRIORITY 2 — Confidence Engine + Escalation System ✅

| # | Task | Status |
|---|---|---|
| 2.1 | ClassifierService returns {mode, confidence} | ✅ |
| 2.2 | ConfidenceEngineService created | ✅ |
| 2.3 | Integration with RouterService | ✅ |
| 2.4 | Confidence and escalation tests | ✅ (8 tests) |

### PRIORITY 3 — Context Processor (Compression) ✅

| # | Task | Status |
|---|---|---|
| 3.1 | DeduplicatorService | ✅ |
| 3.2 | CompressorService (deterministic truncation) | ✅ |
| 3.3 | Integration in RouterService | ✅ |
| 3.4 | Tests: 3 suites, 18 tests | ✅ |
| 3.5 | Technical document docs/context-processor.md | ✅ |

### PRIORITY 4 — Observability ✅

| # | Task | Status |
|---|---|---|
| 4.1 | ObservabilityService: metrics, timing, tracking | ✅ |
| 4.2 | Structured logs per request | ✅ |
| 4.3 | Endpoints GET /v1/health + GET /v1/metrics | ✅ |
| 4.4 | Integration in ProxyController | ✅ |
| 4.5 | Tests (7) | ✅ |
| 4.6 | Technical document docs/observability.md | ✅ |

### PRIORITY 5 — Connection and Verification with OpenCode ✅

| # | Task | Status | Detail |
|---|---|---|---|
| 5.1 | Configure OpenCode to point to Madame | ✅ | `madame-agent` provider in opencode.json with `@ai-sdk/openai-compatible`, baseURL `localhost:3000/v1`, gemma4 + llama-3.3-70b models |
| 5.2 | Verify streaming in OpenCode | ✅ | SSE streaming functional through the proxy (verified with curl) |
| 5.3 | Verify automatic routing | ✅ | Direct routing (explicit model → direct provider) + classifier (no model → classifier → local/cloud according to confidence) |
| 5.4 | Escalation test | ✅ | Ambiguous query "what do you think about react" → confidence 0.503 < 0.7 → escalation to NVIDIA Llama 3.3 70B |
| 5.5 | Fix: Observability trackRequest | ✅ | RouterService now returns RouteResult with routing metadata; ProxyController calls trackRequest() with real data |
| 5.6 | Updated tests | ✅ | 10 RouterService tests (previously 9), all pass; 42 total |

### PRIORITY 6 — Advanced Features ✅

| # | Task | Files | Dependencies | Detail |
|---|---|---|---|---|
| 6.1 | Semantic Cache ✅ | `src/cache/cache.service.ts` | 1.x | CacheService with generateEmbedding() via Ollama /api/embeddings, cosine similarity in in-memory vector store. Integrated in RouterService: check → hit → return cache, miss → call provider → store. Configurable via routing.yaml `cache.enabled`. |
| 6.2 | Translation Layer ✅ | `src/translation/translation.service.ts` | 1.x | TranslationService with detectLanguage() + translateTo() via Ollama /api/generate. Translates non-English user messages before routing. Configurable via routing.yaml `translation.enabled`. |
| 6.3 | Tool Calling ✅ | `src/tools/` | 1.x | 6 phases completed: (1) DTO: ToolDefinition, ToolCall, ToolMessage typed, (2) ToolRegistryService central registration, (3) SandboxManagerService path/commands/network validation, (4) ToolLoopService model→tool→result loop with max_iterations, (5) Integration in RouterService via callProviderOrToolLoop(), (6) 18 unit tests. 9 built-in tools: read, write, glob, ls, mv, cp, exec, mkdir, rm. |
| 6.4 | E2E Tests ✅ | `test-madame.sh` | 1.x-6.3 | E2E script with 11 sections: health, models, model pairs, local chat, NVIDIA chat, escalation, metrics, streaming, tool calling. |

### PRIORITY 7 — Observability Improvements (Post-MVP) ⬜

Current observability is functional but minimal: in-memory metrics with a circular buffer of 1000 requests, exposed via REST. For production, these improvements are needed:

| # | Task | Description | Alternatives |
|---|---|---|---|
| 7.1 | Database Persistence | Replace circular buffer with SQLite/PostgreSQL. Metrics survive restarts. Allows historical queries. | SQLite (embedded, no infrastructure), PostgreSQL (scalable, requires connection) |
| 7.2 | Web Dashboard UI | Web interface to view real-time metrics: latency charts, escalation rate, tokens saved by context, errors per provider. | Grafana + Prometheus (industry standard), or custom lightweight dashboard with Chart.js |
| 7.3 | Structured Logs to File | Replace `console.log` with structured logger (pino, winston) writing to a rotating file with JSON lines. Facilitizes grep and subsequent analysis. | pino (faster), winston (larger ecosystem) |
| 7.4 | Export to External System | Send metrics to Datadog, New Relic, or Prometheus to correlate with other system signals. | OpenTelemetry SDK (vendor-neutral), direct export via each platform's API |
| 7.5 | Alerts | Notifications when: error rate > threshold, p99 latency > threshold, frequent escalations (possible local degradation). | Slack webhook, email, PagerDuty |
| 7.6 | Distributed Tracing | Correlate requests through the proxy with individual spans (classifier → context → provider). Useful for identifying bottlenecks. | OpenTelemetry tracing |

---

## Current Architecture

```
OpenCode / Client
    ↓
POST /v1/chat/completions  ← ProxyController
    ↓
ProxyService
    ↓
RouterService
    ├─ Direct routing (model name match → direct provider)
    │      ↓
    │   ContextProcessor (dedup + compress)
    │      ↓
    │   Provider.chat()
    │
    └─ Classifier routing (no model or model not found)
           ↓
    ClassifierService  (transformers.js - mobilebert)
     → { mode: 'plan'|'execution', confidence: 0.xx }
           ↓
    ConfidenceEngineService  (threshold: 0.7)
     → Escalate? → escalation provider
           ↓
    ContextProcessor  (dedup + compress)
           ↓
    ProvidersService
        ├─ OllamaProvider  → gemma4:12b-mlx (local)
        ├─ CloudProvider   → NVIDIA / OpenAI / Anthropic
        └─ HuggingFaceProvider
    ↓
Response (stream SSE | json)
```

### Escalation Flow

```
Execution request (confidence 0.45 < 0.7)
         ↓
    Escalation: cloud_nvidia
         ↓
    ContextProcessor: dedup + compress
         ↓
    Cloud model is used instead of local
```

## Current Configuration (routing.yaml)

```yaml
providers:
  local_small:
    type: ollama
    model: gemma4:12b-mlx
    base_url: http://localhost:11434
  local_medium:
    type: ollama
    model: gemma4:12b-mlx
    base_url: http://localhost:11434
  cloud_nvidia:
    type: cloud
    provider: nvidia
    model: meta/llama-3.3-70b-instruct
    api_key_env: NVIDIA_API_KEY
  cloud_openai:
    type: cloud
    provider: openai
    model: gpt-4o
  cloud_hf:
    type: huggingface
    model: meta-llama/Meta-Llama-3-8B-Instruct

routing:
  plan:
    provider: cloud_nvidia
  execution:
    provider: local_medium
  escalation:
    provider: cloud_nvidia

confidence:
  threshold: 0.70
```

---

## Success Definition

- [x] Clean repo: .gitignore configured, no node_modules/dist/.atl tracked
- [x] Unit tests: 60 tests, 10 suites, all passing
- [x] Context Processor: deduplication + compression implemented
- [x] Confidence Engine + Escalation: threshold 0.7, escalated to cloud
- [x] Observability: health, metrics, timing per request
- [x] Technical documentation: docs/confidence-engine.md, docs/context-processor.md, docs/observability.md, docs/tool-calling-spec.md
- [x] OpenCode configured as `madame-agent` provider pointing to `http://localhost:3000/v1`
- [x] Automatic routing redirects to local for execution (confidence >= 0.7), cloud for plan / escalation
- [x] Escalation works: low confidence (< 0.7) → cloud (NVIDIA Llama 3.3 70B)
- [x] Integration tests (curl) passing: health, models, chat completions (non-stream + stream), escalation, tool calling
- [x] Observability trackRequest integrated: metrics per request with routing metadata
- [x] Semantic Cache implemented: embeddings via Ollama, cosine similarity, cache hit/miss in 3 routing paths
- [ ] Reduced visible cloud calls in logs (depends on Semantic Cache enabled)
- [x] Translation Layer implemented: detection and translation of non-English input
- [x] Tool Calling implemented: ToolLoopService, ToolRegistryService, SandboxManagerService, 9 built-in tools, integration in RouterService
- [x] Tool Calling spec documented and executed: `docs/tool-calling-spec.md` → full implementation in 6 phases
- [x] Orchestrator-Subagent Delegation: Cloud orchestrator delegates subtasks, fault tolerance, active tracking, and cascading abort, documented in docs/orquestador-subagentes.md
