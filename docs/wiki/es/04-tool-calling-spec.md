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
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

export class ChatCompletionRequest {
  tools?: ToolDefinition[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
}
```

### 3.2 Servicio nuevo: ToolLoopService

**Archivo**: `src/tools/tool-loop.service.ts`

```
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
      const response = await this.callModel({ ...request, messages }, modelConfig);
      if (!response.data?.choices?.[0]?.message?.tool_calls) {
        return response;
      }
      const toolCalls = response.data.choices[0].message.tool_calls;
      messages.push(response.data.choices[0].message);
      for (const toolCall of toolCalls) {
        const result = await this.executeToolCall(toolCall);
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
    }
    return this.callModel({ ...request, messages }, modelConfig);
  }
}
```

### 3.3 Servicio nuevo: ToolRegistryService

**Archivo**: `src/tools/tool-registry.service.ts`

```typescript
export interface ToolHandler {
  definition: ToolDefinition;
  execute: (args: any) => Promise<any>;
  timeout?: number;
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
| `read_file` | `{ path }` | Lee un archivo del workspace | Bajo |
| `write_file` | `{ path, content }` | Escribe/sobrescribe archivo | Alto |
| `glob_files` | `{ pattern }` | Busca archivos por patrón glob | Bajo |
| `list_directory` | `{ path }` | Lista contenido de directorio | Bajo |
| `move_file` | `{ source, dest }` | Mueve/renombra archivo | Medio |
| `copy_file` | `{ source, dest }` | Copia archivo | Medio |
| `execute_command` | `{ command, args, timeout? }` | Ejecuta comando shell | ALTO |
| `create_directory` | `{ path }` | Crea directorio | Bajo |
| `delete_file` | `{ path }` | Elimina archivo | Alto |

### 3.5 Servicio nuevo: SandboxManagerService

**Archivo**: `src/tools/sandbox-manager.service.ts`

Validaciones por defecto:
- Todas las rutas deben estar dentro del workspace configurado
- Comandos denegados: `rm`, `sudo`, `curl`, `wget`
- Timeout máximo por tool call: 30s
- `allow_network: false` por defecto

### 3.6 Integración en RouterService

El flujo existente se mantiene. Solo se agrega: si `request.tools.length > 0`, ejecutar `toolLoopService.execute()` en lugar del `providerInstance.chat()` directo.

---

## 4. Configuración

En `routing.yaml`:

```yaml
tools:
  enabled: true
  max_iterations: 10
  sandbox:
    workspace: /Users/mamisho/dev/madame-agent
    denied_commands: [rm, sudo, curl, wget]
    max_timeout_ms: 30000
    allow_network: false
  builtin_tools:
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

## 5. Seguridad

| Riesgo | Mitigación |
|---|---|
| `rm -rf /` | Sandbox restringe workspace + denied_commands |
| Lectura de .env, .ssh | Whitelist de patrones permitidos en sandbox |
| Loop infinito | `max_iterations` + timeout global |
| Inyección de comandos | Sanitización de args en execute_command |
| Exfiltración de datos | `allow_network: false` por defecto |

Principios: **opt-in** (solo si el request incluye `tools`), **sandbox por defecto**, **auditable** (cada tool_call se registra en ObservabilityService), **timeout siempre**.

---

## 6. Compatibilidad por Provider

| Provider | Tool calls | Notas |
|---|---|---|
| Ollama (gemma4:12b-mlx) | ✅ Sí (0.3.0+) | Puede ignorar tools complejas |
| Ollama (qwen3.6:27b) | ✅ Sí | Soporte nativo |
| NVIDIA (Llama 3.3 70B) | ✅ Sí | API compatible con OpenAI |
| NVIDIA (Deepseek V4 Flash) | ✅ Sí | API compatible con OpenAI |

Requests **sin** `tools` → comportamiento actual, sin cambios.

---

## 7. Plan de Implementación

| Fase | Tareas | Depende de |
|---|---|---|
| **Fase 1** | DTO (tools en ChatCompletionRequest), Provider interface update | — |
| **Fase 2** | ToolRegistryService + built-in tools | Fase 1 |
| **Fase 3** | SandboxManagerService | — |
| **Fase 4** | ToolLoopService (loop de ejecución) | Fases 2+3 |
| **Fase 5** | Integración en RouterService | Fase 4 |
| **Fase 6** | Tests unitarios + integración | Fases 1-5 |

---

## 8. Preguntas Abiertas

1. ¿Los tool_calls deben propagarse a través del ConfidenceEngine?
2. ¿Implementar streaming de tool_calls o solo modo no-streaming inicialmente?
3. ¿ContextProcessor debe desactivarse durante el tool loop?
4. ¿Permitir tools definidas por el usuario en runtime?
5. ¿Timeout global del loop o por tool call?
