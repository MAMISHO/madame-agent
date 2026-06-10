# Propuesta: Soporte de Tooling / Function Calling para Tareas Agénticas

> **Estado**: Borrador para revisión
> **Propósito**: Documentar el problema, proponer una solución y servir como spec para que otro agente implemente
> **Contexto**: Derivado de la investigación en `test-agentes/INFORME-AGENTES.md`

---

## 1. Problema

### 1.1 Síntoma

Actualmente madame-agent expone `POST /v1/chat/completions` como un proxy de chat estándar. Cuando se envía un prompt que requiere operaciones sobre el sistema de archivos (identificar archivos, crear directorios, mover datos), el modelo solo puede **describir un plan textual**. No puede ejecutar herramientas, leer el workspace real, ni realizar acciones.

### 1.2 Evidencia empírica

Las 3 investigaciones realizadas demostraron:

| Investigación | Prompt | Lo que el modelo HIZO | Lo que DEBERÍA hacer |
|---|---|---|---|
| `test-comprehensive` (16 tests) | Múltiples prompts | Respondió texto | N/A (tests de proxy) |
| `test-investigacion` | Análisis reqs cifrado | Análisis técnico en texto | N/A (análisis, no ejecución) |
| `test-agentes` | Organizar archivos de test | Describió un script Python con pathlib/shutil | **Leer directorios, identificar archivos, moverlos** |

En el estudio agéntico, gemma4 y Deepseek demostraron alta conciencia de tooling (8/10 y 6/10 indicadores respectivamente), pero la API no les permitió ejecutar nada.

### 1.3 Causa raíz

`POST /v1/chat/completions` en madame-agent:
- **NO** soporta el parámetro `tools` del estándar OpenAI
- **NO** tiene un loop de ejecución modelo → tool → resultado → modelo
- **NO** expone herramientas del sistema (filesystem, shell, etc.)
- El modelo es un "asesor", no un "agente"

---

## 2. Arquitectura Propuesta

### 2.1 Visión general

```
Cliente (con tools)
  │
  │ POST /v1/chat/completions
  │ body: { model, messages, tools, tool_choice }
  ▼
┌──────────────────────────────────────────────────────────┐
│ madame-agent                                             │
│                                                           │
│  ┌──────────────────┐    ┌───────────────────────────┐   │
│  │ ProxyController   │───▶│ RouterService             │   │
│  │ (existente)       │    │ (existente, modificado)   │   │
│  └──────────────────┘    └──────────┬────────────────┘   │
│                                     │                      │
│                          ┌──────────▼──────────┐          │
│                          │ ToolLoopService      │          │
│                          │ (NUEVO)              │          │
│                          │                      │          │
│                          │ Mientras model       │          │
│                          │ responda con         │          │
│                          │ tool_calls:          │          │
│                          │   1. Parse tool_call  │          │
│                          │   2. Ejecutar tool    │          │
│                          │   3. Return result    │          │
│                          │   4. Modelo procesa   │          │
│                          │   5. Repetir o parar  │          │
│                          └──────────────────────┘          │
│                                     │                      │
│                          ┌──────────▼──────────┐          │
│                          │ ToolRegistry         │          │
│                          │ (NUEVO)              │          │
│                          │                      │          │
│                          │ tools registrados:   │          │
│                          │  ├─ read_file        │          │
│                          │  ├─ write_file       │          │
│                          │  ├─ glob_files       │          │
│                          │  ├─ execute_command  │          │
│                          │  ├─ list_directory   │          │
│                          │  └─ move_file        │          │
│                          └──────────────────────┘          │
│                                     │                      │
│                          ┌──────────▼──────────┐          │
│                          │ SandboxManager       │          │
│                          │ (NUEVO)              │          │
│                          │                      │          │
│                          │ Control de:          │          │
│                          │  ├─ working directory │          │
│                          │  ├─ allowed commands  │          │
│                          │  ├─ timeout           │          │
│                          │  └─ max tool calls    │          │
│                          └──────────────────────┘          │
└──────────────────────────────────────────────────────────┘
```

### 2.2 Flujo detallado

```
1. POST /v1/chat/completions { messages, tools, tool_choice }
     │
2. RouterService.route() (existente, aplicar contexto)
     │
3. ToolLoopService.execute(modelConfig, messages, tools, maxIterations)
     │
     ├─ 3a. Llamar al modelo (Ollama o Cloud) con messages + tools
     │
     ├─ 3b. ¿Modelo devolvió tool_calls?
     │      │
     │      ├─ NO → Devolver response final, FIN
     │      │
     │      └─ SÍ →
     │           │
     │           ├─ 3c. Para cada tool_call:
     │           │    ├─ Buscar tool en ToolRegistry
     │           │    ├─ Validar args contra schema
     │           │    ├─ SandboxManager.check(tool_name, args)
     │           │    ├─ Ejecutar tool (con timeout)
     │           │    └─ Añadir tool_result a messages
     │           │
     │           ├─ 3d. ¿maxIterations alcanzado?
     │           │    ├─ SÍ → Devolver respuesta parcial, FIN
     │           │    └─ NO → Volver a 3a con messages actualizados
     │
     └─ 4. ProxyController devuelve response final (con tool_calls en historial)
```

---

## 3. Cambios en el Código

### 3.1 DTO: Extender ChatCompletionRequest

**Archivo**: `src/proxy/dto/openai.dto.ts`

```typescript
// Extender para soportar tools (OpenAI-compatible)
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

// En ChatCompletionRequest:
export class ChatCompletionRequest {
  // ... campos existentes ...
  tools?: ToolDefinition[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
}
```

### 3.2 Servicio nuevo: ToolLoopService

**Archivo**: `src/tools/tool-loop.service.ts`

```typescript
@Injectable()
export class ToolLoopService {
  constructor(
    private toolRegistry: ToolRegistryService,
    private sandbox: SandboxManagerService,
    private providersService: ProvidersService,
  ) {}

  async execute(
    request: ChatCompletionRequest,
    modelConfig: any,
    maxIterations: number = 10,
  ): Promise<ProviderResponse> {
    let messages = [...request.messages];

    for (let i = 0; i < maxIterations; i++) {
      // 1. Llamar al modelo con messages + tools
      const response = await this.callModel({ ...request, messages }, modelConfig);

      // 2. Verificar si hay tool_calls
      if (!response.data?.choices?.[0]?.message?.tool_calls) {
        return response; // Respuesta final
      }

      // 3. Procesar cada tool_call
      const toolCalls = response.data.choices[0].message.tool_calls;
      messages.push(response.data.choices[0].message);

      for (const toolCall of toolCalls) {
        const result = await this.executeToolCall(toolCall);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    // maxIterations alcanzado
    return this.callModel({ ...request, messages }, modelConfig);
  }

  private async executeToolCall(toolCall: ToolCall): Promise<any> {
    const tool = this.toolRegistry.get(toolCall.function.name);
    if (!tool) {
      return { error: `Tool '${toolCall.function.name}' not found` };
    }

    const args = JSON.parse(toolCall.function.arguments);
    this.sandbox.check(toolCall.function.name, args);
    return tool.execute(args);
  }
}
```

### 3.3 Servicio nuevo: ToolRegistryService

**Archivo**: `src/tools/tool-registry.service.ts`

Registro central de herramientas disponibles. Cada herramienta es un plugin con:

```typescript
export interface ToolHandler {
  definition: ToolDefinition;    // Schema para el modelo
  execute: (args: any) => Promise<any>;  // Implementación
  timeout?: number;              // Timeout específico
}

@Injectable()
export class ToolRegistryService {
  private tools = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void {
    this.tools.set(handler.definition.function.name, handler);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }
}
```

### 3.4 Herramientas sugeridas (built-in)

| Tool | Args | Descripción | Riesgo |
|---|---|---|---|
| `read_file` | `{ path: string }` | Lee un archivo del workspace | Bajo (solo lectura) |
| `write_file` | `{ path: string, content: string }` | Escribe/sobrescribe archivo | Alto (puede dañar) |
| `glob_files` | `{ pattern: string }` | Busca archivos por patrón glob | Bajo |
| `list_directory` | `{ path: string }` | Lista contenido de directorio | Bajo |
| `move_file` | `{ source: string, dest: string }` | Mueve/renombra archivo | Medio |
| `copy_file` | `{ source: string, dest: string }` | Copia archivo | Medio |
| `execute_command` | `{ command: string, args: string[], timeout?: number }` | Ejecuta comando shell | ALTO (sandbox obligatorio) |
| `create_directory` | `{ path: string }` | Crea directorio | Bajo |
| `delete_file` | `{ path: string }` | Elimina archivo | Alto |

### 3.5 Servicio nuevo: SandboxManagerService

**Archivo**: `src/tools/sandbox-manager.service.ts`

```typescript
@Injectable()
export class SandboxManagerService {
  private readonly allowedWorkspace: string;
  private readonly deniedCommands: string[];
  private readonly maxTimeout: number;

  check(toolName: string, args: any): void {
    // 1. Verificar que todas las rutas estén dentro del workspace
    for (const [key, value] of Object.entries(args)) {
      if (key.includes('path') || key === 'source' || key === 'dest') {
        const resolved = path.resolve(value as string);
        if (!resolved.startsWith(this.allowedWorkspace)) {
          throw new SandboxViolationError(
            `Path '${resolved}' fuera del workspace permitido '${this.allowedWorkspace}'`
          );
        }
      }
    }

    // 2. Para execute_command, verificar comando permitido
    if (toolName === 'execute_command') {
      const cmd = (args.command as string).split(' ')[0];
      if (this.deniedCommands.includes(cmd)) {
        throw new SandboxViolationError(`Comando denegado: ${cmd}`);
      }
    }

    // 3. Verificar timeout máximo
    if (args.timeout && args.timeout > this.maxTimeout) {
      throw new SandboxViolationError(`Timeout ${args.timeout}ms excede el máximo ${this.maxTimeout}ms`);
    }
  }
}
```

### 3.6 Provider Interface: Extender para tool_calls

**Archivo**: `src/providers/provider.interface.ts`

```typescript
export interface ProviderResponse {
  data?: any;
  stream?: AsyncIterable<Uint8Array>;
  tool_calls?: ToolCall[];  // NUEVO
}
```

### 3.7 Integración en RouterService

**Archivo**: `src/router/router.service.ts`

El flujo existente se mantiene. Solo se agrega un paso:

```typescript
async route(request: ChatCompletionRequest): Promise<RouteResult> {
  // ... lógica existente de routing (directo, pair, classifier) ...

  // Si el request incluye tools, ejecutar loop agéntico
  if (request.tools && request.tools.length > 0) {
    const response = await this.toolLoopService.execute(
      request,
      selectedConfig,
      this.configService.get('tools.maxIterations') || 10,
    );
    // ... wrapper con metadata ...
  }
}
```

---

## 4. Configuración

En `routing.yaml` (o `.env`):

```yaml
tools:
  enabled: true                    # Activar/desactivar tool use
  max_iterations: 10               # Máximo de ciclos tool_call → result
  sandbox:
    workspace: /Users/mamisho/dev/madame-agent  # Ruta permitida
    denied_commands:               # Comandos prohibidos
      - rm
      - sudo
      - curl
      - wget
    max_timeout_ms: 30000          # Timeout máximo por tool call
    allow_network: false           # Permitir conexiones de red
  builtin_tools:                   # Tools built-in activas
    - read_file
    - write_file
    - glob_files
    - list_directory
    - move_file
    - copy_file
    - execute_command
    - create_directory
    - delete_file
```

---

## 5. Dependencias

| Paquete | Uso | Prioridad |
|---|---|---|
| `glob` (built-in) | Búsqueda de archivos | Alta |
| `fs/promises` (built-in) | Operaciones de filesystem | Alta |
| Node.js `child_process` | Ejecución de comandos (con sandbox) | Alta |

No se requieren dependencias externas nuevas. Todo se implementa con built-ins de Node.js.

---

## 6. Seguridad

### 6.1 Riesgos identificados

| Riesgo | Mitigación |
|---|---|
| El modelo ejecuta `rm -rf /` | Sandbox restringe workspace + denied_commands |
| El modelo lee archivos sensibles (.env, .ssh) | Whitelist de patrones permitidos en sandbox |
| Ejecución infinita (loop sin fin) | `max_iterations` + timeout global |
| Inyección de comandos | Sanitización de args en execute_command |
| Exfiltración de datos | `allow_network: false` por defecto |

### 6.2 Principios de diseño

1. **Opt-in**: Tools solo se activan si el request incluye `tools: [...]`
2. **Sandbox por defecto**: Sin configuración explícita, no hay ejecución
3. **Auditable**: Cada tool_call y resultado se registra en ObservabilityService
4. **Timeout siempre**: Cada tool tiene timeout configurable, default 10s

---

## 7. Migración y Compatibilidad

### 7.1 Backwards compatibility

- Requests **sin** `tools` → comportamiento actual, sin cambios
- Requests **con** `tools` → se activa ToolLoopService
- Providers que no soportan function calling (Ollama con modelos antiguos) → el modelo ignora `tools` y responde directamente → ToolLoopService detecta que no hay `tool_calls` y devuelve la respuesta

### 7.2 Consideraciones por provider

| Provider | Soporta tool_calls? | Notas |
|---|---|---|
| Ollama (gemma4:12b-mlx) | ✅ Sí (desde Ollama 0.3.0+) | Modelo pequeño, puede ignorar tools complejas |
| Ollama (qwen3.6:27b) | ✅ Sí | Soporte nativo de function calling |
| NVIDIA (Deepseek V4 Flash) | ✅ Sí | API compatible con OpenAI |
| NVIDIA (Llama 3.3 70B) | ✅ Sí | Soporte nativo de tool use |

---

## 8. Pruebas

### 8.1 Tests unitarios

| Test | Descripción |
|---|---|
| ToolRegistry.register/get | Registro y obtención de herramientas |
| ToolLoopService.single_call | Modelo responde sin tool_calls |
| ToolLoopService.one_tool | Modelo hace 1 tool_call, recibe resultado, responde |
| ToolLoopService.multi_tool | Modelo hace múltiples tool_calls en paralelo |
| ToolLoopService.max_iterations | Se alcanza el límite de iteraciones |
| SandboxManager.path_traversal | Rechazar path fuera del workspace |
| SandboxManager.denied_command | Rechazar comando prohibido |
| SandboxManager.timeout_exceeded | Rechazar timeout excesivo |

### 8.2 Tests de integración

Usando el mismo patrón de `test-agentes.py`, verificar que con el prompt de organización de archivos:

```
1. Sin tools → modelo describe plan (comportamiento actual) ✅
2. Con tools → modelo ejecuta glob_files, list_directory, move_file → resultado real
```

---

## 9. No-Alcance (para esta iteración)

- **Claude-style computer use** (solo tool calls estándar)
- **MCP (Model Context Protocol)**: Se puede considerar en futura iteración como alternativa a tool definitions manuales
- **Tools de red/API externas**: Solo filesystem + shell en esta fase
- **Interfaz de usuario**: Solo API REST, sin UI
- **Memoria persistente entre requests**: Cada request es independiente

---

## 10. Plan de Implementación

| Fase | Tareas | Depende de |
|---|---|---|
| **Fase 1** | DTO (tools en ChatCompletionRequest), Provider interface update | — |
| **Fase 2** | ToolRegistryService + built-in tools (read, write, glob, ls, mv) | Fase 1 |
| **Fase 3** | SandboxManagerService (path validation, denied commands, timeout) | — |
| **Fase 4** | ToolLoopService (loop de ejecución modelo→tool→resultado) | Fases 2+3 |
| **Fase 5** | Integración en RouterService (ruta condicional si hay tools) | Fase 4 |
| **Fase 6** | Tests unitarios + integración con test-agentes.py | Fases 1-5 |

---

## 11. Preguntas Abiertas

1. **¿Los tool_calls deben propagarse a través del ConfidenceEngine?** Si el modelo hace tool_calls, ¿debería contar como "execution" (está ejecutando) o "plan" (está planificando la ejecución)?

2. **¿Cómo manejar tool_calls en streaming?** El estándar OpenAI envía tool_calls como chunks delta. ¿Implementar streaming de tool_calls o solo modo no-streaming inicialmente?

3. **¿Debe expirar el contexto entre iteraciones del loop?** El ContextProcessor podría truncar mensajes entre ciclos. ¿Debe desactivarse durante el tool loop?

4. **¿Permitir tools definidas por el usuario en runtime?** ¿O solo las built-in configuradas en `routing.yaml`?

5. **¿Timeout global del loop o por tool call?** Propuesta: timeout por tool call + max_iterations como control global.

---

*Documento generado el 2026-06-10*
*Próximo paso: Revisión por equipo técnico y asignación para implementación*
