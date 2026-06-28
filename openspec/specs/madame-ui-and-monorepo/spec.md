# Madame-Agent UI & Monorepo Specification

## Purpose

Transformar Madame-Agent en un ecosistema Monorepo (NestJS Backend, Angular Frontend, OpenCode Plugin) e introducir una interfaz gráfica independiente para gestionar la orquestación de agentes (Harness) y monitorizar las métricas de uso y costes (Stats). Implementar Clean Architecture y base de datos relacional (SQLite) para lograr persistencia.

## Requirements

### Requirement: Monorepo & Deployment Structure

El proyecto MUST organizarse como un monorepo gestionando tres aplicaciones principales: `backend`, `frontend`, y `opencode-plugin`. Al compilar, el backend NestJS MUST servir los ficheros estáticos de Angular (en producción) para que el ecosistema se despliegue en el puerto 3001. El plugin de OpenCode MUST instalar todas las dependencias cruzadas de manera transparente.

#### Scenario: Plugin Installation triggers full ecosystem setup
- GIVEN a user installs the `opencode-plugin`
- WHEN the installation script runs
- THEN the monorepo dependencies for backend and frontend are resolved, AND the backend process is prepared to run the full UI on port 3001

### Requirement: Database & Clean Architecture

El backend MUST implementar persistencia usando `SQLite` con el ORM `Sequelize`. La arquitectura MUST seguir el patrón "Clean Architecture" dividiendo la lógica en capas de `Domain` (Entidades, Interfaces), `Application` (Servicios, DTOs) e `Infrastructure` (Controladores, Repositorios Sequelize).

#### Scenario: Submitting a Custom Harness saves via Clean Architecture
- GIVEN the user creates a custom Harness via UI
- WHEN the HTTP request reaches the `harness.controller` (Infrastructure)
- THEN it delegates to the `HarnessService` (Application) which applies domain rules before persisting to SQLite (Infrastructure)

### Requirement: Harness Management

El sistema MUST tener un Harness "por defecto" inmutable. Los usuarios CAN crear copias customizadas. La creación de un nuevo Harness MUST requerir un nombre único (mínimo 8 caracteres sin caracteres especiales, máximo 25 caracteres sin espacios en los extremos). Solo un Harness CAN ser marcado como "activo" a la vez.

#### Scenario: Deleting the active Harness
- GIVEN the user has a custom Harness marked as active
- WHEN the user deletes this custom Harness
- THEN the system automatically falls back AND sets the "default" Harness as active

### Requirement: Graph Visualization & Real-Time State

El Frontend en Angular MUST renderizar la estructura del Harness como un Grafo/Diagrama. Los nodos MUST mostrar el alias del agente, proveedor y modelo. Los nodos MUST cambiar de color/efectos en tiempo real basándose en su estado (`idle`, `working`, `error`) e indicar la dirección del flujo.

#### Scenario: Subagent is processing a task
- GIVEN an orchestration flow is running
- WHEN the orchestrator delegates a task to the `QA` agent
- THEN the `QA` node on the graph visually highlights to indicate the `working` state, AND the flow direction arrow is animated

### Requirement: Agent Detail & Prompt Strategy

Al hacer clic en un nodo, se MUST desplegar un panel lateral para editar propiedades. El sistema MUST utilizar el **Patrón Strategy** en el `PromptService`. Para el Harness por defecto se lee desde disco (archivos `.md`). Para un Harness custom, se lee desde SQLite.

#### Scenario: Editing prompt in a custom harness
- GIVEN the user clicks on the `Planner` agent inside a custom Harness
- WHEN the user modifies the prompt text and saves
- THEN the `DatabasePromptStrategy` is used to persist the new prompt to SQLite for this specific Harness and Agent

### Requirement: Provider & Model Validation

El panel del agente MUST permitir la selección y adición de Proveedores y Modelos. Las API Keys MUST ser ofuscadas en las proyecciones de lectura. Antes de persistir un nuevo proveedor (e.g. un servidor Ollama en una IP externa), el sistema MUST intentar validar conectividad con el endpoint del proveedor.

#### Scenario: Adding a remote Ollama provider
- GIVEN the user configures a new Provider "My Remote Ollama" with `baseUrl: http://192.168.1.100:11434`
- WHEN the user clicks save
- THEN the backend performs a connectivity check (e.g. fetching `/api/tags`) AND only persists the ProviderConfig if successful

### Requirement: Execution Logging Persistence

El sistema MUST almacenar los logs de ejecución. Los logs MUST guardarse simultáneamente en archivos físicos segmentados por agente y persistirse en SQLite (relacionados por `sessionId`, `harnessId`, `modelId`, dividiendo fecha y hora, junto a un campo texto largo para el log). 

#### Scenario: Viewing global logs in real-time
- GIVEN an active session execution
- WHEN the user opens the global log panel in the Angular UI
- THEN the UI streams the aggregated real-time terminal output combining all active agent logs
