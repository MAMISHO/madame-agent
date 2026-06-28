# Model Resolver y Enrutamiento

`ModelResolverService` es el servicio de responsabilidad única encargado de traducir los nombres de modelos solicitados (tanto directos como compuestos o virtuales) en configuraciones concretas de proveedores, evaluando dinámicamente si una tarea debe ser procesada localmente o si requiere ser escalada a la nube.

Este servicio se apoya en el **ClassifierService** y el **ConfidenceEngineService** para tomar decisiones de enrutamiento y fue extraído para centralizar la resolución de modelos, desacoplando esta lógica del `RouterService` y `WorkflowService`.

---

## 1. Tipos de Modelos Manejados

El sistema distingue principalmente tres formas de referenciar un modelo en la solicitud (`modelRaw`):

1. **Orchestrator Pairs (`orchestrator_pairs`)**
   Agrupaciones diseñadas para el `WorkflowService`, donde se define un orquestador principal (usualmente Cloud) y una lista de subagentes delegados (usualmente locales o híbridos). *Ej: `Llama70B-Orchestrator+Gemma4-12B`*.
   
2. **Model Pairs (`model_pairs`)**
   Par de modelos "Híbridos" que enlazan un modelo local y un modelo cloud (escalamiento directo). *Ej: `gemma4:12b-mlx-oc+DeepseekV4Flash`*.

3. **Direct Models (`providers`)**
   Claves directas que apuntan a un proveedor en específico. *Ej: `local_medium` o directamente el nombre del modelo como `gemma4:12b-mlx`*.

---

## 2. Flujo de Resolución (`resolveModel`)

Cuando el sistema necesita resolver a qué proveedor enviar el mensaje, el método `resolveModel(modelRaw, taskOrMessages)` ejecuta el siguiente algoritmo:

### Paso A: Validación de Model Pairs
1. Verifica si `modelRaw` coincide con el nombre o ID de un par híbrido (`model_pairs` en `routing.yaml`).
2. Si coincide, extrae las configuraciones para `pair.local` y `pair.cloud`.
3. Detecta el modo de operación (`plan` o `build`) inspeccionando el `system` prompt de los mensajes.
4. Llama al `ClassifierService` para evaluar la tarea (obteniendo `{ mode, confidence }`) y al `ConfidenceEngine` para evaluar el riesgo.
5. **Decisión de Escalamiento**:
   - Si el sistema está en `systemMode === 'plan'`, **fuerza el escalamiento** al modelo Cloud (el modelo planificador siempre debe ser el más inteligente).
   - Si está en `build`, solo escala si el clasificador determina que la tarea es `plan` (compleja) o si la confianza del clasificador cae por debajo del umbral (`shouldEscalate`).
6. Retorna la configuración elegida (Local o Cloud).

### Paso B: Búsqueda Directa
Si no es un par compuesto, busca directamente el modelo en la lista de proveedores (`providersConfig`). Si existe un match exacto por nombre o por ID, retorna esa configuración directamente (`escalated: false`).

### Paso C: Fallback (Routing Automático por Clasificador)
Si el modelo solicitado no existe o no se provee, entra el modo de **Routing por Clasificador**:
1. El `ClassifierService` evalúa la entrada del usuario.
2. El `ConfidenceEngineService` decide el destino basado en el umbral.
3. Se selecciona el proveedor configurado por defecto para la intención (ej. `routing.plan.provider` vs `routing.execution.provider`).

---

## 3. Resolución de Subagentes (`getLocalConfig`)

El servicio provee el método `getLocalConfig(modelName)` utilizado principalmente por el ciclo de subagentes del orquestador:
- Acepta tanto identificadores directos como nombres de pares híbridos.
- Si recibe un par híbrido, extrae **siempre la configuración local** base de dicho par.
- Esto permite inicializar el ciclo de herramientas locales y comprobar que el LLM base está levantado (ej. Ollama Healthcheck) antes de comenzar la delegación.

---

## 4. Estructura de Retorno (`ResolvedModel`)

Todas las resoluciones del servicio devuelven una interfaz consistente que será consumida por los controladores o servicios de ejecución:

```typescript
export interface ResolvedModel {
  config: any;           // La configuración del provider (type, model, base_url, api_key_env...)
  providerKey: string;   // El ID del provider resuelto (ej. "cloud_nvidia")
  escalated: boolean;    // Flag de observabilidad: ¿se activó la escalación?
  classification?: {
    mode: string;        // Modo detectado ('plan' | 'execution')
    confidence: number;  // Nivel de certeza de la clasificación
  };
}
```

Esta estructura permite a los componentes upstream (como el `ObservabilityService`) trazar y medir con precisión cuándo y por qué se decidió escalar una petición a la nube, mejorando el monitoreo del sistema.
