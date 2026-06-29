# Rediseño de Arquitectura del Módulo Harness

Este documento detalla el plan de implementación para la reestructuración del módulo `Harness` en `madame-agent`, migrando hacia una arquitectura hexagonal/limpia (DDD) inspirada en la aplicación de referencia.

## 1. Diseño de Entidades de Base de Datos (Infraestructura / Persistencia)
- `HarnessEntity`: `id`, `code`, `name`, `description`. Relaciones: `HasMany(AgentEntity)`, `HasMany(EdgeEntity)`.
- `AgentEntity`: `id`, `code`, `name`, `description`, `role`, `prompt`, `harnessId`, `modelId`. Relaciones: `BelongsTo(HarnessEntity)`, `BelongsTo(ModelEntity)`.
- `ModelEntity`: `id`, `code`, `name`, `description`, `providerId`. Relaciones: `BelongsTo(ProviderEntity)`, `HasMany(AgentEntity)`.
- `ProviderEntity`: `id`, `code`, `name`, `apiKey`, `baseUrl`. Relaciones: `HasMany(ModelEntity)`.
- `EdgeEntity`: `id`, `harnessId`, `sourceAgentId`, `targetAgentId`, `type` (unidireccional, bidireccional), `condition`. Relaciones: `BelongsTo(HarnessEntity)`.

## 2. Capa de Dominio (`domain`)
- **Modelos (`domain/models/`)**: Interfaces fuertemente tipadas como `IHarness`, `IAgent`, `IModel`, `IProvider`, `IEdge`.
- **Repositorios (`domain/repositories/`)**: Interfaces de acceso a datos (ej. `IHarnessRepository`, `IAgentRepository`), para abstraer el uso directo de Sequelize.

## 3. Capa de Aplicación (`application`)
- **DTOs (`application/dtos/`)**: Clases con validaciones (`class-validator`) para peticiones de entrada (Create, Update) y salidas de respuestas al cliente.
- **Mapeadores (`application/mappers/`)**: Interfaz base `EntityMapper<Entity, DTO>` en el `core`. Clases impl para transformar Entidades a DTOs y a Modelos de Dominio.
- **Servicios (`application/services/`)**: La lógica de negocio principal para manejar arneses, agentes y relaciones.

## 4. Capa de Infraestructura (`infra`)
- **HTTP (`infra/http/`)**: Controladores REST para exponer CRUD endpoints de cada entidad respectiva (Harness, Agent, Model, Provider, Edge).
- **Persistencia (`infra/persistence/`)**: 
  - Declaración de las entidades de base de datos (`entities/`).
  - Implementaciones reales de los repositorios (`repositories/impl/`) inyectando Sequelize.

## 5. Mejora y Tipado en WorkflowService (Plan)

Actualmente `workflow.service.ts` utiliza un tipo `any` para el parámetro `pair`:
```typescript
async executeWorkflow(
    request: ChatCompletionRequest,
    pair: any,
  ):
```
**Análisis y Plan:**
- **Tipado del Parámetro (`pair`)**: Se debe definir una Interfaz o DTO (`IWorkflowHarness`, `WorkflowContext` o `ResolvedHarnessDTO`) que contenga la información resuelta necesaria para la orquestación (Harness ID, Agentes involucrados y la información de la petición).
- **Tipos de Nodos (Edge)**: Basándonos en la aplicación de referencia `app-medicines`, se utilizará la entidad `EdgeEntity` para gestionar el grafo de ejecución. 
  - Propósitos:
    - **UI**: Proveer la topología gráfica del sistema multiagente (nodos y aristas) para ser renderizada en el frontend.
    - **Enrutamiento (Backend)**: El `Orchestrator` usará el grafo (`EdgeEntity`) para saber a quién delegar.
  - Tipos de `Edge`:
    - `unidireccional`: El flujo pasa de A -> B y termina allí (o sigue a C).
    - `bidireccional`: El flujo puede ir A -> B y B -> A (útil para orquestadores interactivos donde el mensaje navega en ambas direcciones).
- **Ejecución**: *Aún no implementado*. Queda registrado aquí para su próxima fase de desarrollo, la cual implicará sustituir el tipo `any`, e implementar la lógica de lectura y travesía de grafos a partir de `EdgeEntity`.
