# Proposal: Orchestrator-Subagent Testing

## Intent

Integration-test the orchestrator-subagent delegation flow (inverse of model pairs). Instead of local→cloud escalation, this tests cloud→local subagent delegation with tool execution, failover, and self-fallback.

## Scope

### In Scope
- Integration test: orchestrator routes to cloud, injects `delegate_subagent` tool
- Integration test: subagent receives delegated task, executes tools, returns result
- Integration test: failover cascade (first subagent fails → tries next)
- Integration test: subagent ablation (with/without tools)
- Observability: verify subagent task tracking in `/v1/subagents/active`
- Test ≥2 orchestrator pair types (Deepseek+Gemma, Gemini+Gemma)

### Out of Scope
- Cascading abort on client disconnect (unit-tested already)
- Self-fallback (all subagents fail) — unit-tested already
- Performance/benchmark testing
- Production deployment

## Capabilities

### New Capabilities
- `orchestrator-subagent-test`: Integration tests for delegation flow

### Modified Capabilities
None — no spec changes, only tests.

## Approach

Python integration tests (same pattern as `test-agentes-tools.py`) that:
1. Call an orchestrator pair endpoint (e.g. `DeepseekV4Flash-Orchestrator+Gemma4-12B`)
2. Verify `delegate_subagent` tool is available
3. Send an agentic task that triggers delegation
4. Verify subagent executed tools and returned results
5. Check `/v1/subagents/active` for tracking
6. Repeat with Gemini orchestrator and different subagent configs

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `routing.yaml` | Already configured | 12 orchestrator pairs exist |
| `test-orchestrator-delegation.py` | New | Integration test script |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cloud API latency (Deepseek slow) | Medium | Increase timeouts, warm up first |
| Cloud API errors (503/429) | Medium | Add retry logic in test |
| Subagent model not loaded | Low | Warm up in test script |

## Rollback Plan

Delete `test-orchestrator-delegation.py`. No production code changes, so no rollback risk.

## Dependencies

- Cloud API keys for Deepseek and Gemini (already configured)
- Subagent models (Gemma 4 12B, Gemma 4 4B) loaded in runtime

## Success Criteria

- [ ] Orchestrator pair routes correctly to cloud provider
- [ ] `delegate_subagent` tool is injected in response
- [ ] Subagent can execute tools and return results
- [ ] Subagent task appears in `/v1/subagents/active`
- [ ] At least 2 orchestrator pairs tested successfully
