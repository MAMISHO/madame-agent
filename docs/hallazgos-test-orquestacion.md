# Hallazgos: Test de Orquestación Madame-Agent

## Contexto

Test del flujo orquestador cloud→subagente local con el modelo `Gemini-Orchestrator+Gemma12B-OC` (Gemini 3.1 Flash Lite como orquestador, gemma4:12b-mlx-oc como subagente). La tarea: implementar el plugin de opencode para madame-agent según `docs/plugin-architecture.md`.

---

## Hallazgo 1: El orquestador SÍ itera cuando el subagente falla

**Qué pasó**: El orquestador hizo 3 delegaciones en un solo request:

| Call | Acción | Resultado |
|------|--------|-----------|
| 1 | Leer spec (`plugin-architecture.md`) | ✅ Subagente devolvió resumen |
| 2 | Crear estructura de archivos | ❌ "No response from subagent" |
| 3 | Reintentar con código inline en args | ✅ Archivos creados |

**Conclusión**: Cuando la delegación 2 falló (subagente no devolvió resultado), el orquestador en la delegación 3 incluyó el código COMPLETO inline en los `args` del tool call, sin depender del subagente para generarlo. Esto es adaptación positiva.

**Problema**: El contador `iteration` en `extra_content` muestra siempre 0. Necesita reflejar el número real de iteraciones del tool-loop.

**Archivos afectados**:
- `src/providers/cloud.provider.ts` — donde se genera `extra_content`
- `src/tools/tool-loop.service.ts` — donde se lleva el contador de iteraciones

---

## Hallazgo 2: Subagente no confirma comprensión antes de ejecutar

**Qué pasó**: El subagente recibe la tarea y ejecuta DIRECTAMENTE. No hay paso de "confirmar que entendió".

**Flujo actual**:

```
Orquestador → delegate_subagent("crea archivo X con contenido Y")
  → Subagente recibe e IMPLEMENTA directamente
  → Devuelve resultado
```

**Flujo deseado (conversación de confirmación)**:

```
Orquestador → delegate_subagent("crea archivo X con contenido Y")
  → Subagente ARTICULA su entendimiento:
      "Voy a crear X con contenido Y. Pero no conozco la API de opencode
       plugins para el ProviderHook. Necesito la documentación de types."
  → Orquestador EVALÚA el entendimiento:

      Opción A (el orquestador conoce la API):
        → "El ProviderHook real es: { id: string; models?: (provider, ctx) => ... }"
        → Subagente confirma y ejecuta

      Opción B (el orquestador tampoco sabe):
        → "Busca en la web la documentación: usa webfetch en
           https://www.npmjs.com/package/@opencode-ai/plugin o busca
           el archivo local ~/.config/opencode/node_modules/@opencode-ai/plugin/dist/index.d.ts"
        → Subagente webfetch/documenta → extrae API → confirma entendimiento → ejecuta

      Opción C (entendimiento correcto):
        → Orquestador confirma implícitamente → subagente ejecuta

  → Si el entendimiento sigue siendo incorrecto:
      Orquestador itera con más contexto o investigación adicional
```

**La confirmación NO es un check burocrático**. Es el mecanismo natural para que el subagente identifique sus lagunas de conocimiento. El orquestador las resuelve con:
1. Contexto directo (si conoce la API)
2. Investigación delegada (webfetch, MCP, leer archivos locales de tipos)
3. Iteración hasta que el subagente demuestre comprensión completa

**Solución implementada (parcial)**: Se actualizó `templates/prompts/subagent_system.txt` para que el subagente incluya una sección `## Understanding` con:
- Resumen de su plan
- Lo que NO sabe o de lo que no está seguro
- Qué información adicional necesita

**Pendiente**:
- El orquestador debe evaluar activamente la sección `## Understanding` y decidir:
  - Si el entendimiento es correcto → proceder
  - Si falta información → proveer contexto o delegar investigación
  - Si es incorrecto → corregir y pedir reconfirmación
- El subagente necesita acceso a herramientas de investigación (webfetch, read_file de types locales)
- El tool-loop debe soportar ciclos de "delegación → confirmación → más contexto → ejecución"

**Archivos afectados**:
- `templates/prompts/subagent_system.txt` — ya actualizado con sección `## Understanding`
- `templates/prompts/orchestrator_delegate.txt` — instrucciones para evaluar Understanding y decidir iteración con investigación
- `src/tools/tool-loop.service.ts` — soporte para múltiples ciclos de delegación por tarea

---

## Hallazgo 3: "No response" del subagente por error interno

**Qué pasó**: La delegación 2 devolvió "No response from subagent". El log muestra:

```
Tool 'list_directory': ENOENT: no such file or directory, scandir './plugin**'
```

El subagente intentó hacer `list_directory` con un glob inválido (`./plugin**` con doble `**` suelto). Esto:
1. Lanzó `ENOENT` (no era error de sandbox)
2. El tool-loop capturó el error pero no lo propagó correctamente
3. El subagente "desapareció" sin devolver resultado
4. El orquestador recibió "No response"

**Causa raíz**: El subagente (gemma4:12b-mlx-oc) alucinó la sintaxis del glob. Usó `**` como si fuera un sufijo de path en vez de `**/*`.

**Solución necesaria**: El tool-loop debe capturar errores de tool y devolverlos al subagente para que intente de nuevo (en vez de silenciar al subagente). Si el subagente falla tras N intentos, recién ahí devolver "No response" al orquestador con el error detallado.

**Archivos afectados**:
- `src/tools/tool-loop.service.ts` — manejo de errores de tool calls, reintentos del subagente

---

## Hallazgo 4: Subagente genera código con API inventada

**Qué pasó**: El subagente creó `src/server.ts` y `src/tui.tsx` usando APIs que NO existen en opencode:

```typescript
// CÓDIGO INCORRECTO generado por el subagente:
export const server: ProviderHook = {
  name: 'madame-agent-provider',
  async onInit(api) {
    api.registerProvider({ ... });  // ❌ NO EXISTE
  }
};
```

**API REAL** de opencode plugin (de `@opencode-ai/plugin/dist/index.d.ts`):

```typescript
// ProviderHook real:
export type ProviderHook = {
    id: string;
    models?: (provider: ProviderV2, ctx: ProviderHookContext) => Promise<Record<string, ModelV2>>;
};

// Plugin real: async function que devuelve hooks
export type Plugin = (input: PluginInput) => Promise<Hooks>;
```

**Causa raíz**: El subagente local (gemma4:12b-mlx-oc, 12B) no tiene conocimiento de la API de opencode plugins. No aparece en sus datos de entrenamiento.

**Solución (a través del flujo de confirmación)**:

La solución NO es que el orquestador dé código completo. La solución es que el **flujo de confirmación** detecte esta laguna naturalmente:

```
1. Subagente: "## Understanding: crearé server.ts con ProviderHook.
   Pero NO conozco la API exacta de ProviderHook en opencode."

2. Orquestador evalúa: el subagente identificó correctamente su laguna.
   → Opción A: Orquestador provee los types (si los conoce)
   → Opción B: Orquestador delega investigación:
       "Lee el archivo de types en ~/.config/opencode/node_modules/
        @opencode-ai/plugin/dist/index.d.ts y extrae la definición
        de ProviderHook y Plugin."

3. Subagente recibe la información, actualiza su entendimiento:
   "## Understanding (actualizado): Ahora sé que ProviderHook es
   { id: string; models?: (provider, ctx) => Promise<...> }.
   Implementaré server.ts con esta API."

4. Orquestador confirma → subagente ejecuta
```

**Ventajas**:
- No requiere que el orquestador adivine qué necesita el subagente
- El subagente aprende y puede aplicar el conocimiento en tareas futuras
- Escala a cualquier API que el subagente no conozca
- El orquestador conserva contexto (no necesita incluir código completo en cada delegación)

**Archivos afectados**:
- `templates/prompts/subagent_system.txt` — la sección `## Understanding` debe explicitar: "Si no sabes algo, DILO. No inventes APIs."
- `templates/prompts/orchestrator_delegate.txt` — instrucciones para cuando el subagente reporta desconocimiento: proveer contexto o delegar investigación
- Considerar: dar al subagente acceso a `read_file` para leer types locales, o `webfetch` para documentación online

---

## Hallazgo 5: No hay flujo de permisos para escritura fuera del workspace

**Qué pasó** (potencial): Si el subagente necesita escribir en `~/.config/opencode/plugins/` (fuera del workspace definido en `routing.yaml`), el sandbox lanza `SandboxViolationError` y la operación falla.

**Flujo actual** (`src/tools/sandbox-manager.service.ts`):

```typescript
// Línea 51-54: Rechazo seco
if (!resolved.startsWith(this.workspace + '/') && resolved !== this.workspace) {
  throw new SandboxViolationError(
    `Path '${value}' resolves to '${resolved}' which is outside the allowed workspace '${this.workspace}'`,
  );
}
```

**Problema**: El error se propaga como excepción. No hay manera de que el usuario autorice la operación.

**Diseño propuesto**:

### Flujo de permisos para escritura fuera del workspace

```
1. Subagente intenta write_file("/Users/mamisho/.config/opencode/plugins/...")
2. Sandbox detecta: fuera del workspace
3. En vez de lanzar excepción → devuelve:
   {
     status: "permission_required",
     path: "/Users/mamisho/.config/opencode/plugins/...",
     operation: "write_file",
     reason: "Outside workspace"
   }
4. El tool-loop propaga esto al subagente
5. El subagente lo devuelve al orquestador como parte del resultado
6. El orquestador (o yo como supervisor) notifica al usuario
```

### Alternativa: Lista de paths permitidos

Más simple que un sistema de permisos interactivo. En `routing.yaml`:

```yaml
tools:
  sandbox:
    workspace: /Users/mamisho/dev/madame-agent
    allowed_paths:        # NUEVO
      - ~/.config/opencode/plugins/   # escritura permitida aquí
      - /tmp/madame-agent/
```

El `SandboxManagerService` checkea contra `allowed_paths` además del workspace:

```typescript
// Nuevo método checkPaths mejorado
private isPathAllowed(resolved: string): boolean {
  if (resolved.startsWith(this.workspace)) return true;
  return this.allowedPaths.some(allowed => {
    const allowedPath = resolve(expandHome(allowed));
    return resolved.startsWith(allowedPath + '/') || resolved === allowedPath;
  });
}
```

**Archivos afectados**:
- `src/tools/sandbox-manager.service.ts` — agregar `allowedPaths` + lógica de verificación
- `routing.yaml` — agregar `tools.sandbox.allowed_paths`
- `src/config/configuration.ts` — schema si existe

---

## Hallazgo 6: Contador `iteration` bugueado en extra_content

**Qué pasó**: El campo `iteration` en `extra_content` mostró 0 cuando el tool-loop realmente iteró 3 veces.

**Causa**: Revisar dónde se setea `extra_content.iteration` en el flujo de tool-loop y orchestrator. Probablemente se setea una sola vez al inicio en vez de incrementarse por cada ciclo del tool-loop.

**Archivos afectados**:
- `src/providers/cloud.provider.ts` — generación de `extra_content`
- `src/tools/tool-loop.service.ts` — contador de iteraciones

---

## Resumen de Archivos a Modificar

| Prioridad | Archivo | Cambio |
|-----------|---------|--------|
| Alta | `src/tools/tool-loop.service.ts` | Manejar errores de tools sin silenciar al subagente; incrementar contador iteration correctamente |
| Alta | `templates/prompts/subagent_system.txt` | ✅ YA ACTUALIZADO — incluye resumen de comprensión |
| Alta | `templates/prompts/orchestrator_delegate.txt` | Instruir al orquestador para evaluar Understanding y decidir iteración |
| Media | `src/tools/sandbox-manager.service.ts` | Agregar `allowedPaths` para escritura controlada fuera del workspace |
| Media | `routing.yaml` | Agregar `tools.sandbox.allowed_paths` |
| Media | `src/providers/cloud.provider.ts` | Bugs: contador iteration, propagación de errores |

## Comportamiento Esperado Post-Fixes

```
Usuario → "Implementa el plugin"
  ↓
Orquestador (Gemini) → razona el plan
  ↓
Delega tarea 1 → Subagente local
  ┌────────────────────────────────────────────┐
  │ CICLO DE CONFIRMACIÓN (iterativo)          │
  │                                            │
  │ 1. Subagente ARTICULA entendimiento:       │
  │    "Crearé X. Pero no sé la API de Y."     │
  │                                            │
  │ 2. Orquestador EVALÚA:                     │
  │    ✅ Entendimiento completo → ejecutar    │
  │    ❌ Falta contexto → provee o investiga  │
  │    ❌ API desconocida → delega research:   │
  │       "webfetch/docs o lee types locales"  │
  │                                            │
  │ 3. Subagente RECIBE input → actualiza      │
  │    entendimiento → reconfirma              │
  │                                            │
  │ 4. Loop hasta que entendimiento es ✅      │
  └────────────────────────────────────────────┘
  ↓
Subagente EJECUTA (con el entendimiento completo)
  ↓
Devuelve resultado al orquestador
  ↓
Delega tarea 2 → Subagente local
  (mismo ciclo de confirmación + ejecución)
  ↓
Si subagente necesita escribir fuera del workspace:
  Sandbox devuelve permission_required
  → Orquestador puede autorizar si path está en allowed_paths
  → O notifica al supervisor humano
  ↓
Orquestador sintetiza resultado final
```

---

## Historial

- **2026-06-25**: Test inicial. Hallazgos documentados por supervisor del test.
