# Investigación: Ruteo del par gemma4 + Deepseek V4 Flash
## Prompt agéntico: organización de archivos de prueba en el workspace

| Campo | Valor |
|---|---|
| **Fecha** | 2026-06-10 09:20:13 UTC |
| **Prompt** | Tarea agéntica: identificar, renombrar y organizar archivos/directorios de tests |
| **Modelo pair** | `Gemma4-12B+DeepseekV4Flash` |
| **Threshold** | 0.70 |
| **Clasificador** | `Xenova/mobilebert-uncased-mnli` |

---

## 1. Resumen Ejecutivo

```
WORKSPACE ANTES DE LA PRUEBA:
  Scripts:  test-comprehensive.py, test-comprehensive.sh, test-investigacion.py, test-madame.sh
  Directorios de resultados: test-results, test-investigacion
  Archivos en test-results:  29 ficheros
  Archivos en test-investigacion: 5 ficheros

PRUEBAS:
  ├─ gemma4:12b-mlx directo  → 70.7s · 3918 chars
  ├─ deepseek-v4-flash directo → 185.5s · 2634 chars
  └─ Pair Gemma4→Deepseek     → 88.2s · 5046 chars · ❌ NO escaló

CLASIFICADOR:  mode=plan · confidence=0.979
RUTEO FINAL:   gemma4:12b-mlx (local)
```

---

## 2. Prompt de Entrada

### System prompt
```
Eres un ingeniero de software experto en tooling y automatización.
Tu tarea implica operaciones sobre el sistema de archivos.
Piensa paso a paso qué herramientas necesitas.
```

### User prompt (agéntico)
```
En el actual proyecto /Users/mamisho/dev/madame-agent

Se han hecho un par de pruebas al agente, donde se ha solicitado generar scripts para poner a prueba la solución software que se desarrolla. Dichos scripts además generan directorios con los resultados de las pruebas.

Tu tarea es identificar los ficheros implicados en las pruebas, ordenarlos dentro de un directorio llamado custom-test. Dentro tendrás/crearás un subdirectorio para cada prueba donde moverás los scripts, los directorios de cad...
```

### Archivos
- `01-gemma4-direct/request.json`
- `02-deepseek-direct/request.json`
- `03-pair-gemma4-deepseek/request.json`

---

## 3. Trazabilidad del Flujo (Depuración)

### 3.1 Diagrama de la arquitectura de ruteo

```
CLIENTE
  │ POST /v1/chat/completions
  │ model: "Gemma4-12B+DeepseekV4Flash"
  ▼
┌──────────────────────────────────────────────────────────┐
│ RouterService.route()                                     │
│   ├─ findModelPair("Gemma4-12B+DeepseekV4Flash")         │
│   │   → match! → routeThroughPair()                      │
│   │                                                       │
│   ├─ ClassifierService.classifyTask()                     │
│   │   ├─ model: mobilebert-uncased-mnli                  │
│   │   ├─ labels: ["plan", "execution"]                   │
│   │   └─ scores: scores":[0.9790162522364264,0.020983747763573646]                   │
│   │                                                       │
│   ├─ ConfidenceEngineService.evaluate()                  │
│   │   ├─ threshold = 0.70                                │
│   │   └─ escalate = false   │
│   │                                                       │
│   └─ Provider: gemma4:12b-mlx (local)                           │
│                                                           │
│   NOTA: La API /v1/chat/completions es text-in/text-out.  │
│   NO hay soporte de function calling ni tool use.         │
│   El modelo solo puede RESPONDER con un plan, no          │
│   ejecutar las operaciones.                               │
└───────────────────────────────────────────────────────────┘
```

### 3.2 Logs del servidor

```
  [32m[Nest] 30154  - [39m10/06/2026, 11:14:18 [32m    LOG[39m [38;5;3m[ClassifierService] [39m[32mInitializing local AI classifier via transformers.js...[39m

  [32m[Nest] 30154  - [39m10/06/2026, 11:14:18 [32m    LOG[39m [38;5;3m[ClassifierService] [39m[32mClassifier model loaded successfully.[39m

  [32m[Nest] 30154  - [39m10/06/2026, 11:14:20 [32m    LOG[39m [38;5;3m[RouterService] [39m[32mDirect routing for model "gemma4:12b-mlx" → provider "local_small" (ollama)[39m

  [95m[Nest] 30154  - [39m10/06/2026, 11:14:20 [95m  DEBUG[39m [38;5;3m[OllamaProvider] [39m[95mCalling Ollama API for model gemma4:12b-mlx[39m

  [32m[Nest] 30154  - [39m10/06/2026, 11:14:29 [32m    LOG[39m [38;5;3m[RouterService] [39m[32mDirect routing for model "gemma4:12b-mlx" → provider "local_small" (ollama)[39m

  [95m[Nest] 30154  - [39m10/06/2026, 11:14:29 [95m  DEBUG[39m [38;5;3m[OllamaProvider] [39m[95mCalling Ollama API for model gemma4:12b-mlx[39m

  [32m[Nest] 30154  - [39m10/06/2026, 11:15:40 [32m    LOG[39m [38;5;3m[RouterService] [39m[32mDirect routing for model "deepseek-ai/deepseek-v4-flash" → provider "cloud_nvidia_deepseek" (cloud)[39m

  [95m[Nest] 30154  - [39m10/06/2026, 11:15:40 [95m  DEBUG[39m [38;5;3m[CloudProvider] [39m[95mCalling Cloud API for provider nvidia and model deepseek-ai/deepseek-v4-flash[39m

  [95m[Nest] 30154  - [39m10/06/2026, 11:18:45 [95m  DEBUG[39m [38;5;3m[ClassifierService] [39m[95mClassification results: {"sequence":"[{\"role\":\"system\",\"content\":\"Eres un ingeniero de software experto en tooling y automatización. Tu tarea implica operaciones sobre el sistema de archivos. Piensa paso a paso qué herramientas necesitas.\"},{\"role\":\"user\",\"content\":\"En el actual proyecto /Users/mamisho/dev/madame-agent\\n\\nSe han hecho un par de pruebas al agente, donde se ha solicitado generar scripts para poner a prueba la solución software que se desarrolla. Dichos scripts además generan directorios con los resultados de las pruebas.\\n\\nTu tarea es identificar los ficheros implicados en las pruebas, ordenarlos dentro de un directorio llamado custom-test. Dentro tendrás/crearás un subdirectorio para cada prueba donde moverás los scripts, los directorios de cada prueba correspondiente, renombrando los directorios con un nombre secuencial e identificativo de la prueba de tal manera que sea reconocible qué script y pruebas pertenecen a cada set de prueba, quedando así las ejecuciones de las pruebas ordenada y que se vean en similar orden.\"}]","labels":["system planning and architecture","code execution and simple fix"],"scores":[0.9790162522364264,0.020983747763573646]}[39m

  [95m[Nest] 30154  - [39m10/06/2026, 11:18:45 [95m  DEBUG[39m [38;5;3m[ConfidenceEngineService] [39m[95mConfidence=0.979, threshold=0.7, mode=plan, escalate=false[39m

  [32m[Nest] 30154  - [39m10/06/2026, 11:18:45 [32m    LOG[39m [38;5;3m[RouterService] [39m[32mPair "Gemma4-12B+DeepseekV4Flash": mode=plan, confidence=0.979 → using local local_medium (gemma4:12b-mlx)[39m

  [95m[Nest] 30154  - [39m10/06/2026, 11:18:45 [95m  DEBUG[39m [38;5;3m[OllamaProvider] [39m[95mCalling Ollama API for model gemma4:12b-mlx[39m

```

**Archivo**: `04-observabilidad/server-logs.json`

### 3.3 Métricas

```json
{
  "uptime": 355,
  "requests": {
    "total": 4,
    "byProvider": {
      "local_small": 2,
      "cloud_nvidia_deepseek": 1,
      "local_medium": 1
    },
    "byMode": {
      "direct": 3,
      "classifier": 1
    }
  },
  "escalations": {
    "total": 0,
    "rate": 0
  },
  "tokens": {
    "inputTotal": 886,
    "savedByContext": 0
  },
  "latency": {
    "avgMs": 88212
  },
  "errors": {
    "total": 0,
    "byProvider": {}
  }
}
```

---

## 4. Análisis de Respuestas

### 4.1 Control A: gemma4:12b-mlx (local)

| Atributo | Valor |
|---|---|
| **Modelo** | `gemma4:12b-mlx` (Ollama local) |
| **Latencia** | 70.7s |
| **Output** | 3918 chars |
| **Reasoning** | 2663 chars |

**Respuesta** (completa):
```
Como ingeniero de software experto en tooling y automatización, mi enfoque para esta tarea no es simplemente mover archivos manualmente, sino construir un **script de organización robusto** que pueda ejecutarse repetidamente sin errores, manteniendo la integridad de los datos.

Para resolver esto, aquí está el plan paso a paso y las herramientas necesarias:

### 1. Herramientas Necesarias (Stack Tecnológico)
*   **Lenguaje:** `Python 3.x` (Es el estándar para scripting de sistemas por su manejo nativo de rutas).
*   **Librerías estándar:**
    *   `pathlib`: Para manipulación de rutas de forma orientada a objetos (más seguro que `os.path`).
    *   `shutil`: Para mover y copiar archivos/directorios físicamente.
    *   `logging`: Para dejar un rastro de qué se movió y qué falló.
    *   `re`: Para identificar patrones en los nombres de los scripts y carpetas.

---

### 2. Plan de Ejecución (Algoritmo)

Para que la automatización sea exitosa, seguiré esta lógica:

#### Paso A: Identificación y Mapeo (Discovery Phase)
No podemos mover cosas sin saber qué pertenece a qué. El script debe:
1.  Escanear el directorio raíz buscando archivos con extensiones de script (ej: `.py`, `.sh`, `.js`).
2.  Identificar los directorios de resultados. *Nota técnica:* Aquí necesito definir una regla de asociación. Si el script se llama `test_login.py` y la carpeta es `results/login_output`, el script debe buscar coincidencias de strings.

#### Paso B: Estructuración (Preparation Phase)
1.  Crear el directorio raíz `custom-test`.
2.   Crear una lista única de "Sets de Pruebas". Cada set será un objeto con: `{script, carpeta_resultado, indice}`.

#### Paso C: Ejecución y Renombrado (Action Phase)
Para cada Set identificado:
1.   Crear el subdirectorio `custom-test/test_01`, `custom-test/test_02`, etc.
2.   Mover el script al nuevo directorio.
3.   Mover la carpeta de resultados al nuevo directorio y **renombrarla** siguiendo el patrón: `resultado_test_XX`.

---

### 3. Propuesta de Implementación (Pseudocódigo/Lógica)

Si tuviera que escribir el script ahora mismo, esta sería la estructura lógica:

```python
import pathlib
import shutil
import logging

# Configuración inicial
BASE_PATH = pathlib.Path("/Users/mamisho/dev/madame-agent")
TARGET_DIR = BASE_PATH / "custom-test"
SCRIPTS_EXTENSIONS = [".py", ".sh"]

def organize_tests():
    # 1. Crear directorio base si no existe
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    
    # 2. Identificar scripts y sus carpetas de resultados
    # Aquí aplicamos lógica de búsqueda: "Busca un script que tenga nombre similar a una carpeta"
    test_sets = [] 
    # ... lógica de escaneo aquí ...

    # 3. Procesar cada set
    for i, (script_path, result_path) in enumerate(test_sets, 1):
        # Crear subdirectorio secuencial: test_01, test_02...
        sub_dir = TARGET_DIR / f"test_{i:02d}"
        sub_dir.mkdir(parents=True, exist_ok=True)
        
        # Mover script
        shutil.move(str(script_path), str(sub_dir / script_path.name))
        
        # Mover y renombrar carpeta de resultados
        new_result_name = f"resultado_{i:02d}"
        dest_result_path = sub_dir / new_result_name
        
        shutil.move(str(result_path), str(dest_result_path))
        
        logging.info(f"Movido set {i} a {sub_dir}")

```

### 4. Consideraciones de Ingeniería (Edge Cases)
Para asegurar que la herramienta sea profesional, añadiré estas validaciones:
1.  **Dry Run Mode:** Una bandera `--dry-run` que imprima qué haría el script sin mover ningún archivo realmente (vital para no perder datos).
2.  **Collision Check:** Antes de mover, verificar si el destino ya existe para evitar sobreescrituras accidentales.
3.  **Logging:** Generar un archivo `organization_log.txt` indicando la ubicación original y la nueva de cada archivo.

**¿Quieres que proceda a escribir el script completo en Python para ejecutarlo en tu máquina?**
```

**Reasoning** (proceso de pensamiento):
```
Software Engineer expert in tooling and automation.
Organize test scripts and their output directories within a specific project folder (`/Users/mamisho/dev/madame-agent`).

        1.  Identify files involved in tests (scripts + result directories).
        2.  Create a `custom-test` directory.
        3.  Inside `custom-test`, create subdirectories for each test set.
        4.  Move scripts and their corresponding output folders into these subdirectories.
        5.  Rename the output directo...
```

### 4.2 Control B: deepseek-ai/deepseek-v4-flash (cloud)

| Atributo | Valor |
|---|---|
| **Modelo** | `deepseek-ai/deepseek-v4-flash` (NVIDIA cloud) |
| **Latencia** | 185.5s |
| **Output** | 2634 chars |
| **Reasoning** | 0 chars |

**Respuesta** (completa):
```
Voy a analizar el proyecto para identificar los archivos y directorios relacionados con las pruebas.

## Paso 1: Explorar la estructura del proyecto

```bash
cd /Users/mamisho/dev/madame-agent
find . -type f -name "*.sh" -o -type f -name "*.py" -o -type f -name "*.js" | grep -i test
```

## Paso 2: Identificar scripts de prueba y sus directorios de resultados

```bash
# Buscar scripts de prueba
find . -type f \( -name "*test*" -o -name "*prueba*" \) -exec ls -la {} \;

# Buscar directorios de resultados de pruebas
find . -type d \( -name "*result*" -o -name "*output*" -o -name "*test*" -o -name "*prueba*" \) -exec ls -la {} \;
```

## Paso 3: Analizar los scripts para entender qué directorios generan

```bash
# Revisar el contenido de los scripts de prueba
for script in $(find . -type f \( -name "*test*" -o -name "*prueba*" \) -exec ls {} \;); do
    echo "=== $script ==="
    head -50 "$script"
    echo ""
done
```

## Paso 4: Identificar la estructura completa

```bash
# Ver todos los directorios y archivos relevantes
find . -type d -maxdepth 3 | sort
```

Basado en el análisis, procedo a ejecutar las operaciones necesarias:

```bash
# Crear el directorio principal custom-test
mkdir -p custom-test

# Identificar y mover los scripts de prueba
# (Aquí asumiré nombres comunes, ajusta según lo que encuentres)
for script in $(find . -maxdepth 2 -type f \( -name "*test*.sh" -o -name "*prueba*.sh" -o -name "*test*.py" -o -name "*prueba*.py" \) 2>/dev/null); do
    echo "Script encontrado: $script"
done
```

## Paso 5: Ejecutar la reorganización

```bash
# Crear estructura de directorios para cada prueba
# Ejemplo: si encuentras script1.sh y script2.sh con sus directorios de resultados
mkdir -p custom-test/test-01
mkdir -p custom-test/test-02

# Mover scripts y directorios de resultados
# Ajusta los nombres según lo que encuentres
mv script1.sh custom-test/test-01/ 2>/dev/null || true
mv script2.sh custom-test/test-02/ 2>/dev/null || true

# Mover directorios de resultados
mv resultados_prueba1 custom-test/test-01/resultados 2>/dev/null || true
mv resultados_prueba2 custom-test/test-02/resultados 2>/dev/null || true
```

## Paso 6: Verificar la estructura final

```bash
echo "Estructura final de custom-test:"
find custom-test -type f -o -type d | sort
```

**Nota importante:** Necesito que me proporciones la salida de los primeros comandos para saber exactamente qué archivos y directorios existen en tu proyecto. Sin esa información, solo puedo darte la estructura genérica. Por favor, ejecuta los comandos de los Pasos 1-4 y comparte los resultados para que pueda hacer la reorganización precisa.
```

**Reasoning**:
```
...
```

### 4.3 Flujo real: Pair Gemma4-12B+DeepseekV4Flash

| Atributo | Valor |
|---|---|
| **Modelo pair** | `Gemma4-12B+DeepseekV4Flash` |
| **Provider final** | gemma4:12b-mlx (local) |
| **Latencia** | 88.2s |
| **Output** | 5046 chars |
| **Reasoning** | 3294 chars |

**Respuesta** (completa):
```
Como ingeniero de software experto en tooling y automatización, mi enfoque para esta tarea no es simplemente mover archivos manualmente, sino crear un **script de reorganización robusto** que asegure la integridad de los datos y proporcione una estructura predecible.

Para resolver esto, seguiré este plan paso a paso:

---

### Paso 1: Análisis y Definición de Reglas (Discovery)
Antes de mover cualquier archivo, necesito definir qué constituye un "script" y qué constituye un "resultado".
*   **Identificación de Scripts:** Buscaré archivos con extensiones específicas (ej. `.py`, `.sh`, `.js`) que no estén dentro de carpetas de librerías o entornos virtuales.
*   **Identificación de Resultados:** Buscaré directorios que hayan sido creados por la ejecución de esos scripts. 
*   **Relación Lógica:** Necesito una regla para asociar un script con su carpeta de resultados (ejemplo: si el script se llama `test_login.py`, buscaré carpetas que contengan la palabra `login`).

### Paso 2: Selección de Herramientas
Para esta tarea, utilizaré las siguientes herramientas:
1.  **Python 3:** Es la herramienta ideal por su manejo nativo de sistemas de archivos y facilidad para manejar lógica compleja.
2.  **Librería `pathlib`:** Para manipulación de rutas de forma orientada a objetos (más seguro que `os.path`).
3.  **Librería `shutil`:** Para mover y renombrar directorios manteniendo sus permisos.
4.  **Logging:** Para registrar cada movimiento realizado por seguridad (auditoría).

### Paso 3: Diseño de la Estructura de Destino
La estructura final será:
```text
/Users/mamisho/dev/madame-agent/custom-test/
├── test_01/
│   ├── script_original.py
│   └── resultado_01/  <-- (Renombrado secuencialmente)
├── test_02/
│   ├── otro_script.py
│   └── resultado_02/
...
```

### Paso 4: Ejecución del Script de Automatización
Diseñaré un script que realice las siguientes acciones automáticamente:

1.  **Escaneo:** Recorre el directorio raíz identificando los pares (Script + Carpeta de Resultado).
2.  **Creación de Base:** Crea la carpeta `custom-test`.
3.  **Iteración y Organización:**
    *   Crea una subcarpeta `test_XX` (donde XX es un contador).
    *   Mueve el script a esa subcarpeta.
    *   Identifica la carpeta de resultados asociada, la mueve a la subcarpeta y le cambia el nombre por `resultado_XX`.
4.  **Validación:** Verifica que los archivos se movieron correctamente y no hubo errores de permisos.

---

### Propuesta Técnica (Script de Automatización)

Si estuvieras listo para ejecutarlo, este sería el esquema del script que construiría para ti:

```python
import os
import shutil
from pathlib import Path
import logging

# Configuración inicial
BASE_DIR = Path("/Users/mamisho/dev/madame-agent")
TARGET_DIR = BASE_DIR / "custom-test"
LOG_FILE = TARGET_DIR / "reorganization.log"

# Configurar logs para auditoría
TARGET_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(filename=LOG_FILE, level=logging.INFO, 
                     format='%(asctime)s - %(message)s')

def organize_tests():
    # 1. Identificar scripts (ejemplo: archivos .py que no estén en custom-test)
    scripts = [f for f in BASE_DIR.glob("**/*.py") if TARGET_DIR not in f.parents]
    
    counter = 1
    
    for script_path in scripts:
        # Lógica para encontrar la carpeta de resultados asociada al script
        # Aquí definimos que la carpeta debe compartir parte del nombre del script
        script_name = script_path.stem
        results_dir = None
        
        for folder in BASE_DIR.iterdir():
            if folder.is_dir() and script_name in folder.name and TARGET_DIR not in folder.parents:
                results_dir = folder
                break
        
        # Crear estructura de destino
        test_set_dir = TARGET_DIR / f"test_{counter:02d}"
        test_set_dir.mkdir(parents=True, exist_ok=False) # Si existe, dará error para evitar sobreescritura
        
        try:
            # Mover Script
            shutil.move(str(script_path), str(test_set_dir / script_path.name))
            logging.info(f"Movido script: {script_path.name} -> {test_set_dir}")

            # Mover y Renombrar Carpeta de Resultados
            if results_dir:
                new_results_name = Path("resultado_{}{:02d}".format(counter))
                shutil.move(str(results_dir), str(test_set_dir / new_results_name))
                logging.info(f"Movido resultado: {results_dir.name} -> {new_results_name}")
            
            counter += 1
        except Exception as e:
            logging.error(f"Error procesando {script_path}: {e}")

if __name__ == "__main__":
    organize_tests()
```

### ¿Cómo proceder ahora?
Para ejecutar esto con éxito, necesito que me confirmes:
1.  **¿Qué extensiones tienen los scripts?** (ej. `.py`, `.sh`).
2.  **¿Cuál es la relación entre el nombre del script y la carpeta de resultados?** (Ejemplo: "¿La carpeta siempre contiene una palabra del nombre del script?").

Una vez me confirmes esto, puedo ajustar el script para que sea 100% preciso con tu entorno actual.
```

**Reasoning**:
```
Software Engineer expert in tooling and automation.
Organize test scripts and their output directories within a specific project structure (`/Users/mamisho/dev/madame-agent`).

        1.  Identify files involved in tests (scripts + result directories).
        2.  Create a `custom-test` directory.
        3.  Inside `custom-test`, create subdirectories for each test set.
        4.  Move scripts and their corresponding output directories into these subdirectories.
        5.  Rename the output ...
```

---

## 5. Análisis de Tooling / MCP / Capacidades Agénticas

### 5.1 Conciencia de herramientas por modelo

| Indicador | gemma4 | Deepseek | Pair |
|---|---|---|---|
| Menciona "tool"/"herramienta"/"comando" | ✅ | ✅ | ✅ |
| Operaciones de filesystem (mkdir/mv/cp) | ✅ | ✅ | ✅ |
| Reconoce scripts/archivos del proyecto | ✅ | ✅ | ✅ |
| Propone estructura de directorios | ✅ | ✅ | ✅ |
| Plan paso a paso | ✅ | ✅ | ✅ |
| Menciona MCP | ❌ | ❌ | ❌ |
| Identifica archivos específicos | ✅ | ✅ | ✅ |
| Nombrado secuencial | ✅ | ❌ | ✅ |
| Preserva originales/backup | ✅ | ❌ | ✅ |
| Descomposición en subtareas | ❌ | ❌ | ❌ |

### 5.2 Análisis cualitativo

**¿El modelo reconoce que necesita herramientas?**

**gemma4** (8/10 indicadores):
El modelo demostró ALTA conciencia de tooling. Reconoce la necesidad de operaciones de filesystem y estructura el plan adecuadamente.
  - Usa `mkdir`
  - Usa `find (buscar)`
  - Usa `Python`

**Deepseek** (6/10 indicadores):
El modelo tiene conciencia MODERADA de tooling. Identifica algunos aspectos pero no todos.
  - Usa `mkdir`
  - Usa `mv (mover)`
  - Usa `ls (listar)`
  - Usa `find (buscar)`
  - Usa `bash/sh`

**Pair** (8/10 indicadores):
El modelo demostró ALTA conciencia de tooling. Reconoce la necesidad de operaciones de filesystem y estructura el plan adecuadamente.
  - Usa `mkdir`
  - Usa `find (buscar)`
  - Usa `glob`
  - Usa `Python`

### 5.3 Limitación fundamental: API text-in/text-out

La API de madame-agent (`POST /v1/chat/completions`) es una API de chat
estándar. **NO soporta function calling, tool use, ni ejecución de código.**
El modelo solo puede generar texto de respuesta.

Consecuencias para tareas agénticas:
1. **El modelo no puede ejecutar tool calls** — solo puede describir un plan
2. **No hay ciclo de ejecución** — el agente no puede leer directorios,
   identificar archivos, ni moverlos
3. **La respuesta es estática** — el modelo adivina el estado del workspace
   basado en su conocimiento del prompt, no en observación real
4. **Sin herramientas, no hay agencia real** — el modelo es un "asesor",
   no un "agente"

Para que madame-agent soporte tareas agénticas reales, necesitaría:
- Function calling / tool definition (OpenAI-compatible)
- Un loop de ejecución (modelo → tool → resultado → modelo)
- Acceso al filesystem via tools (read, write, exec, glob)
- Posiblemente un sandbox de ejecución

### 5.4 Comparativa: prompt agéntico vs prompts anteriores

| Aspecto | Prompt simple ("decime HOLA") | Prompt complejo (cifrado) | Prompt agéntico (filesystem) |
|---|---|---|---|
| Clasificación esperada | execution | plan | plan o execution? |
| Tooling necesario | Ninguno | Ninguno | ALTO (read, write, exec) |
| El modelo puede ejecutar | Sí (responde texto) | Sí (analiza y responde) | NO (solo describe plan) |
| Valor de la respuesta | Bajo | Alto (análisis técnico) | Bajo (no puede ejecutar) |

---

## 6. Conclusiones

### 6.1 Veredicto por componente

| Componente | Funciona | Notas |
|---|---|---|
| Clasificador | ✅ | mode=plan para tarea agéntica |
| ConfidenceEngine | ✅ | confidence=0.979 vs 0.70 |
| Escalación | ✅ No escaló | De cisión del confidence engine |
| Ruteo pair | ✅ | Sin errores |
| Tool awareness (gemma4) | ✅ | Reconoce necesidad de herramientas |
| Tool awareness (Deepseek) | ✅ | Reconoce necesidad de herramientas |
| API soporta function calling | ❌ | Limitación de la plataforma |

### 6.2 Calidad de respuesta vs ruta

- **Mejor respuesta para este prompt**: gemma4 (local)
- **¿El modelo entendería qué hacer?**: La respuesta describe un plan que un
  operador humano podría seguir, pero el modelo NO puede ejecutarlo por sí mismo.

### 6.3 Issues detectados

1. **⚠️ API sin function calling**: madame-agent no soporta tool use. Para tareas
   agénticas reales, necesita implementar `tools` en el DTO y un loop de ejecución.

2. **⚠️ El modelo alucina el estado del workspace**: Sin herramientas de lectura
   de filesystem, el modelo solo puede inferir qué archivos existen basado en
   el prompt. No puede verificar.

3. **🔴 Bug de diseño en routeThroughPair()**:
   No escaló (ver bug doc del estudio anterior)

---

## 7. Archivos Generados

| Archivo | Ruta |
|---|---|
| Request gemma4 direct | `01-gemma4-direct/request.json` |
| Response gemma4 direct | `01-gemma4-direct/response.json` |
| Request Deepseek direct | `02-deepseek-direct/request.json` |
| Response Deepseek direct | `02-deepseek-direct/response.json` |
| Request pair | `03-pair-gemma4-deepseek/request.json` |
| Response pair | `03-pair-gemma4-deepseek/response.json` |
| Métricas | `04-observabilidad/metrics.json` |
| Logs servidor | `04-observabilidad/server-logs.json` |
| **Este informe** | `INFORME-AGENTES.md` |
