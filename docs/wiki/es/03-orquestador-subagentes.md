# Delegación de Orquestador Cloud a Subagentes Locales/Híbridos

Este documento detalla el diseño técnico, la arquitectura y el funcionamiento de la delegación de tareas desde modelos orquestadores (usualmente grandes y en la nube) hacia subagentes locales o híbridos de menor escala.

---

## 1. Motivación y Objetivo

El objetivo principal es optimizar el uso de tokens y el espacio de la ventana de contexto en el modelo principal (orquestador). 

Cuando una tarea compleja requiere el uso de herramientas o múltiples iteraciones (por ejemplo, analizar el sistema de archivos, realizar modificaciones y pruebas), el orquestador principal delega esta tarea a un subagente local o híbrido. El subagente ejecuta su propio bucle de herramientas en un contexto de memoria completamente separado y aislado. Una vez resuelta la subtarea, el subagente devuelve **únicamente el resultado final** al orquestador principal. 

Además, **el historial de ejecución dentro de una sesión es compactado** (`executionSummary`) por el `WorkflowService`, lo que significa que el orquestador no recibe los chats crudos del historial, sino un resumen de las herramientas usadas y los resultados. Toda la historia intermedia y salidas de las herramientas del subagente son descartadas o compactadas, manteniendo extremadamente limpia la ventana de contexto del orquestador.

---

## 2. Arquitectura de Delegación

```
  ┌────────────────────────────────────────────────────────┐
  │ Madame-Agent (Orquestador Cloud)                       │
  │                                                        │
  │  Mensaje del Cliente                                   │
  │    │                                                   │
  │    ▼                                                   │
  │  [RouterService] ──► Extrae mensajes e invoca WorkflowService   │
  │    │                                                   │
  │    ▼                                                   │
  │  [WorkflowService] ──► Mantiene sesión y compacta historial (`executionSummary`)
  │    │                                                   │
  │    ├─ (Prepara prompt y herramientas)                  │
  │    │                                                   │
  │    ▼                                                   │
  │  [ModelResolverService] ──► Determina orquestador y pares híbridos
  │    │                                                   │
  │    ▼                                                   │
  │  [ToolLoopService] (Orquestador Cloud)                 │
  │    │                                                   │
  │    └─ Si decide delegar ──► Llama a `delegate_subagent`│
  │  [ToolLoopService] (Orquestador Cloud)                 │
  │    │                                                   │
  │    └─ Si decide delegar ──► Llama a `delegate_subagent`│
  └────┼───────────────────────────────────────────────────┘
       │
       ▼ Ejecución Aislada y Recursiva
  ┌────────────────────────────────────────────────────────┐
  │ Madame-Agent (Subagente Local/Híbrido)                 │
  │                                                        │
  │  [WorkflowService] (Delega al subagente)               │
  │    │                                                   │
  │    ▼                                                   │
  │  [ModelResolverService] ──► Determina si el subagente escala a Cloud
  │    │                                                   │
  │    ▼                                                   │
  │  [ToolLoopService] (Subagente)                         │
  │    │                                                   │
  │    ├─ Ejecuta herramientas (read_file, write_file, ...)│
  │    │                                                   │
  │    ▼                                                   │
  │  Retorna solo el texto con la solución final           │
  └────────────────────────────────────────────────────────┘
```

---

## 3. Configuración (`routing.yaml`)

El soporte para parejas orquestador-subagentes se define mediante la directiva `orchestrator_pairs`. Adicionalmente, se puede definir un pool de proveedores de subagentes por defecto.

```yaml
routing:
  ...
  subagent:
    providers:
      - local_medium
      - local_qwen

orchestrator_pairs:
  - id: llama-gemma-orchestrator
    name: "Llama70B-Orchestrator+Gemma12B"
    orchestrator: cloud_nvidia
    subagents:
      - local_medium
      - local_qwen
  - id: deepseek-hybrid-orchestrator
    name: "DeepseekFlash-Orchestrator+Gemma4DeepseekHybrid"
    orchestrator: cloud_nvidia_deepseek
    subagents:
      - gemma4-deepseek
      - local_medium
```

---

## 4. Estrategia de Tolerancia a Fallos (Failover)

El método de delegación implementa tolerancia a fallos mediante reintentos ordenados y auto-asignación aislada:

1. **Resolución de Subagentes**: Se obtiene la lista de subagentes ordenada (por ejemplo, `[local_medium, local_qwen]`). Si el modelo orquestador solicita un subagente específico vía argumento, este tiene prioridad.
2. **Reintentos en Cascada (Failover)**:
   - Se intenta ejecutar la subtarea en el primer subagente.
   - Si falla (problemas de conexión, caída del modelo local, errores del modelo), se registra el error y se reintenta automáticamente con el siguiente subagente de la lista.
3. **Auto-asignación en Fallback Aislado**:
   - Si todos los subagentes configurados fallan, la tarea no se pierde.
   - El sistema ejecuta la tarea de forma autónoma usando el propio modelo **orquestador**, pero en un contexto de chat completamente nuevo e independiente para proteger la memoria principal del flujo.

---

## 5. Trazabilidad de Tareas y Observabilidad

Para mantener visibilidad sobre las subtareas activas, `ObservabilityService` registra y expone la trazabilidad de los subagentes:

### Estructura de Trazabilidad
Cada tarea de subagente se registra con:
- `requestId`: ID único del subagente (`sub_xxxxxx`).
- `parentRequestId`: ID de la petición del orquestador padre que la originó (`req_xxxxxx`).
- `subagentModel`: Nombre o ID del modelo del subagente en ejecución.
- `taskDescription`: Explicación detallada de la subtarea enviada.
- `status`: Estado actual (`running`, `completed`, `failed`, `cancelled`).
- `startedAt`: Timestamp de inicio.

### API de Monitoreo
Madame-agent expone el endpoint:
- **`GET /v1/subagents/active`**: Devuelve una lista detallada con todas las tareas de subagentes que se encuentran actualmente ejecutándose en segundo plano.

---

## 6. Cancelación en Cascada (Cascading Abort)

Si el cliente final cancela o interrumpe la petición HTTP del orquestador principal (por ejemplo, cancelando la generación de código en el IDE o en OpenCode):

1. El controlador detecta la desconexión mediante el evento `close` del objeto request de Express.
2. Invoca a `observabilityService.cancelSubagentsForParent(requestId)`.
3. El servicio busca todas las subtareas activas asociadas a la petición cancelada.
4. Invoca el método `.abort()` del `AbortController` correspondiente de cada subagente.
5. El bucle de ejecución de la herramienta (`ToolLoopService`) y la petición HTTP al proveedor local/cloud se cancelan de manera inmediata, liberando recursos en el servidor local.
