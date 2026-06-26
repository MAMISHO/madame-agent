# Plan de Test: Orquestador- Subagentes + Feature Plugin

## Objetivo

Probar que madame-agent puede gestionar tareas complejas de **implementación de software** mediante:

1. **Orquestador (modelo cloud grande)**:
   - Planifica y razona (conserva su contexto para pensar, no para leer archivos)
   - Delega micro-tareas a subagentes locales
   - Evalúa resultados y **itera** si el subagente no entendió bien la tarea
   - Sintetiza los resultados parciales en una respuesta final coherente

2. **Subagentes (modelos locales pequeños)**:
   - Ejecutan tareas concretas (leer/escribir archivos, ejecutar comandos)
   - **Confirman comprensión** antes de implementar
   - Devuelven resultados estructurados

3. **Feature a implementar**: Plugin de opencode para madame-agent
   - `~/.config/opencode/plugins/madame-agent.ts` (server plugin: ProviderHook, system prompt injection, /madame-stats)
   - TUI plugin separado (dashboard SolidJS, slots UI)

---

## Estado Actual

### ✅ Server corriendo en dev (watch) — CAMBIAR A PROD
- Puerto: `:3001`
- Modelos: 63 registrados (orchestrator pairs, model pairs, direct models)
- Último test: Planning funcionó (Gemini delegó lectura de archivo → subagente local → Gemini sintetizó plan)

### ✅ Plugin creado (sin probar porque opencode no se reinició)
- `~/.config/opencode/plugins/madame-agent.ts`
- Hooks implementados: `provider`, `experimental.chat.system.transform`, `command.execute.before`
- Falta reiniciar opencode para que lo cargue

### ✅ Prompt del orquestador corregido
- Antes: "delegate ANY local workspace task" → subagente planeaba
- Ahora: "delegate only EXECUTION, reason yourself" → subagente solo ejecuta

---

## Plan de Test

### Fase 1: Setup (hacer ahora)

1. **Compilar madame-agent a producción**:
   ```bash
   npm run build
   # luego matar el proceso dev y arrancar:
   node dist/main.js
   ```

2. **Configurar server para que el /madame-stats funcione**:
   - Cost endpoint `/v1/costs` existe pero devuelve estructura plana
   - Actualizar plugin para que parse el response real

### Fase 2: Test del flujo orquestador completo (3 escenarios)

#### Escenario A: Planificación + Implementación delegada (FLUJO FELIZ)
1. Request al orquestador Gemini con la feature completa
2. Orquestador debe:
   - Pensar el plan él mismo (NO delegar el planning)
   - Delegar CADA micro-tarea individual (crear archivo plugin.json, index.ts, dashboard.tsx, etc.)
   - **Iterar si el resultado es insuficiente**:
     - Evaluar el resultado del subagente
     - Si falta contenido o es incorrecto → delegar de nuevo con instrucciones más específicas
3. Sintetizar resultado final

**Criterio de éxito**: 4+ archivos creados correctamente, orquestador iteró al menos 1 vez

#### Escenario B: Subagente no entiende → Orquestador clarifica
1. Orquestador delega una tarea ambigua/insuficientemente especificada
2. Subagente debe responder: "No tengo suficiente contexto, necesito saber X, Y, Z"
3. Orquestador recibe el feedback y delega de nuevo con instrucciones más claras
4. Subagente implementa correctamente

**Criterio de éxito**: Se produce al menos un ciclo de clarificación

#### Escenario C: Falla de API cloud → Failover
1. Si NVIDIA/Google da 429 (rate limit) o timeout
2. Orquestador debe reintentar o fallback a otro provider
3. El stack debe mostrar el error claramente

**Criterio de éxito**: Error manejado, request no se pierde silenciosamente

### Fase 3: Verificación de resultados

1. Verificar que los archivos creados existen con contenido válido
2. Probar que el plugin carga en opencode (requiere reiniciar opencode)
3. Ejecutar `/madame-stats` en opencode

### Fase 4: Feature completa

1. Implementar TUI plugin (dashboard SolidJS)
2. Implementar cost tracking persistente
3. Implementar graceful shutdown

---

## Arquitectura del Flujo Orquestador

```
Usuario/Prompt
    │
    ▼
┌─────────────────────────────────────┐
│  RouteThroughOrchestrator()         │
│  - tool_choice: 'required' (1ra vez)│
│  - Inyecta prompt delegación        │
│  - tool_choice removido tras iter 1 │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│  ORQUESTADOR (Gemini 3.1 Flash Lite)│
│  - RAZONA y PLANIFICA él mismo      │
│  - Delega micro-tareas vía tool     │
│  - Evalúa resultados → itera si     │
│    necesario                        │
└─────────────────────────────────────┘
    │
    ├── delegate_subagent("Crea plugin.json...")
    │       │
    │       ▼
    │   ┌─────────────────────────┐
    │   │ SUBAGENTE (gemma4 local)│
    │   │ - Lee instrucción       │
    │   │ - CONFIRMA comprensión  │
    │   │ - Implementa            │
    │   │ - Devuelve resultado    │
    │   └─────────────────────────┘
    │
    ├── delegate_subagent("Crea index.ts...")
    │       │ (mismo ciclo)
    │
    └── Orquestador sintetiza resultado final
```

---

## Mejoras Pendientes en madame-agent

### 1. Confirmación de comprensión por subagente
Actualmente el subagente recibe la tarea y directamente implementa. Debería:
1. Confirmar que entendió: "Voy a crear el archivo X con contenido Y, Z. ¿Correcto?"
2. Esperar confirmación del orquestador (o instrucción mejorada)
3. Implementar

**Dónde**: En el tool-loop o en el handler de delegate_subagent

### 2. Iteración automática del orquestador
El orquestador actualmente hace 1 delegación por tarea y sintetiza. Debería:
1. Evaluar el resultado del subagente (¿está completo? ¿es válido?)
2. Si no es suficiente → delegar de nuevo con más contexto
3. Limitar iteraciones (max 3 por tarea)

**Dónde**: En el tool-loop (tool_choice: 'required' en iter 1, luego auto)

### 3. Timeouts por capa
- Orquestador: 300s
- Subagente individual: 120s
- Failover subagente: 180s total
- Self-fallback: 180s

**Dónde**: Ya especificado en `docs/integracion-opencode.md`

---

## Configuración Actual (opencoe.json para madame-agent)

Provider `madame-agent` ya configurado en:
```json
{
  "madame-agent": {
    "npm": "@ai-sdk/openai-compatible",
    "options": { "baseURL": "http://localhost:3001/v1" },
    "models": {
      "madame-auto": { "name": "Madame Auto (Dynamic Routing)", "tools": true },
      "Gemini-Orchestrator+Gemma12B-OC": { "name": "Gemini 3.1 Flash Lite + Gemma4 12B (Orchestrator)", "tools": true },
      ...
    }
  }
}
```

---

## Notas para la Próxima Sesión

- El subagente local gemma4:12b-mlx-oc NO conoce la API de plugins de opencode
- El orquestador DEBE dar instrucciones muy específicas (casi código completo) al subagente para archivos que requieren API knowledge
- El plugin está creado pero necesita que opencode se reinicie para cargarlo
- El endpoint `/v1/costs` existe con estructura `{totalCloudUsd, totalSavedUsd, cloudInputTokens, ...}`
- El comando `/madame-stats` usa ese endpoint
