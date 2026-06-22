# Prueba de Herramientas Agénticas — madame-agent

**Fecha**: 2026-06-12 22:50:19 UTC
**Features activas**: Tool Loop ✅ · 9 herramientas · Tarea real de organización
**Modelo**: gemma4:12b-mlx (local)
**Timeout tool loop**: 120s | **Timeout HTTP**: 180s

---

## 1. Resumen Ejecutivo

| Métrica | Valor |
|---|---|
| **Tool Loop activado** | ✅ |
| **Tool calls realizadas** | 0 |
| **Iteraciones del loop** | 19 |
| **Herramientas usadas** | ninguna |
| **Estado de la tarea** | ⚠️ Timeout/inconclusa |
| **custom-test/ creado** | ✅ Creado |
| **Latencia total** | 180.0s |
| **Errores del servidor** | 0 |

---

## 2. La Tarea

### Prompt enviado al modelo

```
En el actual proyecto /Users/mamisho/dev/madame-agent
Se han hecho un par de pruebas al agente, donde se ha solicitado generar scripts para poner a prueba la solución software que se desarrolla. Dichos scripts además generan directorios con los resultados de las pruebas.

Tu tarea es identificar los...
```

### Herramientas disponibles

| Herramienta | Descripción |
|---|---|
| read_file | Leer contenido de archivo |
| write_file | Escribir contenido a archivo |
| glob_files | Buscar archivos por glob pattern |
| list_directory | Listar contenidos de directorio |
| move_file | Mover/renombrar archivo o directorio |
| copy_file | Copiar archivo o directorio |
| create_directory | Crear nuevo directorio |
| delete_file | Eliminar archivo o directorio vacío |
| execute_command | Ejecutar comando shell |

---

## 3. Traza de Tool Loop

### Secuencia de eventos

| # | Evento | Tool | Detalle |
|---|---|---|---|
| 1 | provider_call |  |  |
| 2 | tool_loop_start |  |  |
| 3 | provider_call |  |  |
| 4 | tool_calls | 1 |  |
| 5 | provider_call |  |  |
| 6 | tool_calls | 1 |  |
| 7 | provider_call |  |  |
| 8 | tool_calls | 1 |  |
| 9 | provider_call |  |  |
| 10 | tool_calls | 1 |  |
| 11 | provider_call |  |  |
| 12 | tool_calls | 1 |  |
| 13 | provider_call |  |  |
| 14 | tool_calls | 1 |  |
| 15 | provider_call |  |  |
| 16 | tool_calls | 1 |  |
| 17 | provider_call |  |  |
| 18 | tool_calls | 1 |  |
| 19 | provider_call |  |  |
| 20 | tool_calls | 1 |  |
| 21 | provider_call |  |  |
| 22 | tool_calls | 1 |  |
| 23 | provider_call |  |  |
| 24 | tool_calls | 1 |  |
| 25 | tool_error | move_file | The "paths[0]" argument must be of type string. Received undefined (6ms)[39m |
| 26 | provider_call |  |  |
| 27 | tool_calls | 1 |  |
| 28 | provider_call |  |  |
| 29 | tool_calls | 1 |  |
| 30 | tool_error | move_file | The "paths[0]" argument must be of type string. Received undefined (2ms)[39m |
| 31 | provider_call |  |  |
| 32 | tool_calls | 1 |  |
| 33 | tool_error | copy_file | The "paths[0]" argument must be of type string. Received undefined (1ms)[39m |
| 34 | provider_call |  |  |
| 35 | tool_calls | 1 |  |
| 36 | provider_call |  |  |
| 37 | tool_calls | 1 |  |
| 38 | provider_call |  |  |
| 39 | tool_calls | 1 |  |
| 40 | provider_call |  |  |
| 41 | tool_calls | 1 |  |
| 42 | provider_call |  |  |
| 43 | tool_calls | 1 |  |
| 44 | provider_call |  |  |

### Estadísticas de tool calls

| Métrica | Valor |
|---|---|
| Total tool calls | 0 |
| Iteraciones del loop | 19 |
| Herramientas distintas | 0 |
| Latencia del request | 180.0s |
| Tamaño del contenido final | 18 chars |

### Herramientas usadas por el modelo

| Herramienta | Veces usada |
|---|---|
| *(ninguna)* | 0 |

---

## 4. Resultado de la Tarea

### custom-test/ estructura

| Elemento | Estado |
|---|---|
| 📄 `test_1` | Archivo |
| 📄 `test_2` | Archivo |
| 📄 `test_3` | Archivo |
| 📄 `test_4` | Archivo |
| 📄 `test_5` | Archivo |

### Análisis de la aproximación del modelo

⚠️ **Timeout**: El tool loop se activó pero el modelo agotó el tiempo antes de completar.

### Lecciones

| Observación | Impacto |
|---|---|
| Modelo local (gemma4) para tool calling | Usó herramientas correctamente |
| Cantidad de herramientas (9) | Manejable |
| Tarea multi-paso (explorar→decidir→ejecutar) | Completada |

### Análisis de Timeout

Configuración actual del tool loop:
- `max_iterations`: 10
- `global_timeout_ms`: 120000 (120s)

El modelo inició el tool loop pero no alcanzó a terminar dentro de las 10 iteraciones o 120s.

---

## 5. Observabilidad

| Métrica | Valor |
|---|---|
| Requests totales | 1 |
| Por modo | {'direct': 1} |
| Escalaciones | 0 |
| Errores | 0 |
| Latencia promedio | 6.2s |
| Tokens input total | 10 |

---

## 6. Archivos Generados

| Archivo | Contenido |
|---|---|
| `01-fundacion/health.json` | Health endpoint |
| `01-fundacion/models.json` | Models endpoint |
| `02-tarea-agentica/prompt.json` | Prompt enviado al modelo |
| `02-tarea-agentica/response.json` | Respuesta del modelo |
| `02-tarea-agentica/latency.json` | Latencia del request |
| `03-verificacion/custom-test-tree.json` | Estructura de custom-test/ |
| `04-traza-tools/server-logs.json` | Logs relevantes del servidor |
| `04-traza-tools/tool-trace.json` | Traza parseada de tool loop |
| `05-observabilidad/metrics.json` | Métricas del servidor |
| **Este informe** | `INFORME-HERRAMIENTAS.md` |
