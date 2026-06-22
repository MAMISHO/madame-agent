# Proposal: Agente Tool Loop Improvements

## Intent

Las pruebas de herramientas agénticas revelaron 5 bloqueos que impiden que el tool loop funcione al 100% para tareas multi-paso: (1) timeout no preemptivo, (2) logging insuficiente de tool calls, (3) modelo no determinista, (4) pocas iteraciones para tareas complejas, (5) sin cache de resultados de tools.

## Scope

### In Scope
- Implementar AbortController en provider calls para timeout preemptivo
- Agregar logging detallado (tool name, args, result, latency) en ToolLoopService
- Aumentar global_timeout_ms default a 300s y max_iterations a 20
- Agregar cache de resultados de herramientas (evita re-ejecutar mismas tools)
- Persistencia del estado del tool loop entre iteraciones (tool result history en metadata de respuesta)

### Out of Scope
- Cambiar el modelo por defecto (gemma4 se queda como local default)
- Implementar parallel tool execution (todas secuenciales)
- MCP integration (futuro)
- Tool streaming (respuestas parciales)

## Capabilities

### New Capabilities
- `tool-loop-abort`: Timeout preemptivo con AbortController en provider calls
- `tool-loop-logging`: Logging detallado de tool name, args, result, latency por iteración
- `tool-loop-cache`: Cache de resultados de herramientas por message hash

### Modified Capabilities
- None — capabilities existentes no cambian a nivel spec

## Approach

1. **AbortController**: Cada provider (ollama, cloud, huggingface) acepta `AbortSignal` en su método `chat()`. ToolLoopService crea un AbortController por iteración con el tiempo restante. Si expira, aborta la call y retorna error controlado.

2. **Logging**: En `ToolLoopService.executeSingleToolCall()` y en el loop principal, agregar `this.logger.log()` con tool name, args truncados, resultado, y latencia. En el catch, incluir el stack trace.

3. **Timeout + Iteraciones**: Cambiar defaults en `configuration.ts`/constructor: `global_timeout_ms: 300000`, `max_iterations: 20`. Routing.yaml también actualizado.

4. **Tool Cache**: HashMap `<messageHash + toolName + argsHash> → result`. Antes de ejecutar una tool, checkear cache. El cache se limpia por sesión (no persiste entre requests). TTU configurable.

5. **Estado en metadata**: El ToolLoopResult incluye `toolCalls: Array<{name, args, result, latencyMs, iteration}>` en la metadata de respuesta del router.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/tools/tool-loop.service.ts` | Modificado | Logging, AbortController, tool cache, timeout check en provider call |
| `src/providers/provider.interface.ts` | Modificado | `AbortSignal` opcional en `chat()` |
| `src/providers/ollama.provider.ts` | Modificado | Pasar signal a fetch |
| `src/providers/cloud.provider.ts` | Modificado | Pasar signal a fetch |
| `src/providers/huggingface.provider.ts` | Modificado | Pasar signal a fetch |
| `src/providers/providers.service.ts` | Modificado | Forward signal en getProvider().chat() |
| `src/router/router.service.ts` | Modificado | Incluir `toolCalls` en metadata de respuesta |
| `src/proxy/dto/openai.dto.ts` | Modificado | Nuevo type `ToolCallResult` para metadata |
| `routing.yaml` | Actualizado | `global_timeout_ms: 300000`, `max_iterations: 20` |
| `src/configuration/configuration.ts` | Modificado | Defaults actualizados |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| AbortController no soportado por provider (Ollama fetch) | Low | `fetch()` soporta signal nativamente |
| Cache de tools devuelve stale results | Medium | Hash por sessionId + messageHash; TTL configurable |
| Aumentar timeout a 300s bloquea el server por más tiempo | Medium | El AbortController corta calls colgadas; el timeout HTTP del cliente es independiente |
| Logging excesivo llena los logs | Low | Usar DEBUG level para args/results detallados |

## Rollback Plan

Revertir `global_timeout_ms` y `max_iterations` a valores anteriores. Si AbortController introduce bugs, revertir solo `provider.interface.ts` y provider implementations. Si tool cache causa errores, deshabilitar con feature flag.

## Dependencies

- Node.js 18+ (AbortController es nativo desde Node 16)
- Los providers existentes (ollama, cloud, huggingface) deben actualizar su método `chat()`

## Success Criteria

- [ ] AbortController corta provider calls que exceden el timeout (test con timeout artificial de 5s)
- [ ] Logs del servidor muestran tool name, args, result, y latency por cada tool call
- [ ] Tarea de organización de test files se completa dentro de 300s con ≥5 tool calls
- [ ] Tool cache devuelve mismo resultado para misma tool + mismos args (test de idempotencia)
- [ ] Metadata de respuesta del router incluye `toolCalls[]` con name, args, result, latencyMs
- [ ] 0 errores del servidor en test de herramienta agéntica (test-herramientas-agt.py)
- [ ] custom-test/ creado con contenido (no vacío) al finalizar la tarea
