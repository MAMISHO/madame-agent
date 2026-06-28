# Software Design Document (SDD): Madame-Agent UI & Monorepo

## 1. Introducción
### 1.1 Propósito
El propósito de este documento es definir la arquitectura, diseño de datos y especificaciones técnicas para la transición de **Madame-Agent** hacia un ecosistema Monorepo. Este cambio incluirá un backend robusto con persistencia en base de datos, una nueva interfaz gráfica independiente (Frontend en Angular) y la unificación del plugin de OpenCode.

### 1.2 Alcance
- **Monorepo**: Unificación de código (`apps/backend`, `apps/frontend`, `apps/opencode-plugin`) mediante Nx o NPM Workspaces.
- **Backend (NestJS)**: Adopción de Clean Architecture, SQLite + Sequelize, y endpoints para estadísticas y orquestación.
- **Frontend (Angular)**: Interfaz basada en paneles (Enyo Mochi Design), renderizado de grafos para la orquestación (Harness), gestión de prompts y visualización de costes.
- **Opencode Plugin**: Configuración de empaquetado para instalar el ecosistema completo desde OpenCode.

---

## 2. Arquitectura del Sistema
El sistema se estructurará bajo los principios de **Clean Architecture**, dividiendo responsabilidades en capas estrictas dentro de cada módulo.

### 2.1 Diagrama de Monorepo
```text
/madame-agent (Root)
 ├── package.json (Workspace)
 ├── apps/
 │    ├── backend/ (NestJS - Puerto 3001)
 │    ├── frontend/ (Angular - Interfaz Web)
 │    └── opencode-plugin/ (Plugin de conexión TUI)
 └── libs/ (Opcional: shared types/interfaces)
```

### 2.2 Clean Architecture (Backend)
Cada módulo (ej. `madame-stats`, `madame-harness`) contendrá:
- **Domain**: Interfaces, Entidades de negocio, Value Objects.
- **Application**: Servicios, Casos de Uso, DTOs y Patrones de diseño (ej. Strategy).
- **Infrastructure**: Controladores REST/WS, Repositorios (Sequelize), y Adaptadores externos.

---

## 3. Modelo de Datos (Esquema SQLite)

### 3.1 Entidades Principales
- **Harness**: Define un conjunto de agentes orquestados.
  - `id` (UUID), `name` (String, min 8, max 25, Unique), `isDefault` (Boolean), `isActive` (Boolean).
- **AgentConfig**: Configuración específica de un agente dentro de un Harness.
  - `id` (UUID), `harnessId` (FK), `role` (String), `prompt` (Text), `providerId` (String), `modelName` (String).
- **ProviderConfig**: Gestor de conexiones LLM.
  - `id` (String), `name` (String), `apiKey` (String - Obfuscated), `baseUrl` (String - Para Ollama local/remoto).
- **ExecutionLog**: Registro en tiempo real de la actividad.
  - `id` (UUID), `sessionId` (String), `harnessId` (FK), `modelName` (String), `executionDate` (Date), `executionTime` (Time), `log` (LongText).

---

## 4. Especificaciones de Componentes

### 4.1 Módulo Madame-Harness
**Lógica de Negocio**:
- **Creación**: Al crear un custom Harness, se copia la estructura de nodos del `default`. El `default` es inmutable e indeleble.
- **Selección**: Solo puede haber un Harness `isActive: true`. Si se elimina el activo, se asigna `default` automáticamente.
- **Prompt Strategy**: Se aplicará el Patrón Strategy. `FilePromptStrategy` para el default (lee `.md`) y `DatabasePromptStrategy` para custom (lee SQLite).
- **Conectividad de Modelos**: Antes de persistir un proveedor o modelo custom (incluyendo Ollama en otra IP), el backend validará la conectividad realizando una consulta de estado o `/v1/models`.

### 4.2 Interfaz Gráfica (Angular Frontend)
**Estética**: Basada en Enyo Mochi, con paneles laterales fluidos, bordes redondeados, Dark Mode primario y alta densidad de información.

**Visor de Grafo (Diagrama)**:
- Nodos renderizados con: Alias del Agente, Proveedor y Modelo.
- **Estados Visuales**: Hover para ver detalles expandidos; Click abre el panel lateral (Agent Detail Panel).
- **Feedback en Tiempo Real**: Animación de bordes, flechas de flujo y códigos de color (`Idle`, `Working`, `Error`, `Completed`) basados en streams bidireccionales.

**Panel de Agente (Agent Detail Panel)**:
- Formulario de edición de Prompts (textarea grande).
- Dropdowns para selección de Provider y Modelo, con opción a añadir custom endpoints (ej. Ollama remoto).

**Consola de Logs Global**:
- Panel inferior desplegable que refleja el `stdout`/`stderr` de todo el workflow (similar a la terminal de OpenCode).

### 4.3 Módulo Madame-Stats
- Panel de resumen financiero y analítico.
- Agrupación jerárquica de costes y tokens: Por `Sesión` > `Harness` > `Agentes` > `Modelos`.

---

## 5. Decisiones de Diseño y Dudas Abiertas (Q&A)
1. **Monorepo Tooling**: Definir si se usará Nx (para aprovechar caché y CI) o npm workspaces (más ligero).
2. **Despliegue en Producción**: Decidir si el frontend compilado se servirá a través del propio NestJS (`ServeStaticModule`) para exponer una sola aplicación.
3. **Eventos Real-Time**: Evaluar la migración a `Socket.io` (WebSockets) en lugar del actual SSE para la bidireccionalidad de eventos visuales del grafo.
4. **Validación de API Keys**: Establecer si la validación de proveedores "custom" sin endpoints estándar se hará con un "Hello World" o si se restringirá a la API oficial.
