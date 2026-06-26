# Inyección Dinámica de Validadores (Harness / Hooks)

## Propuesta Pendiente
Implementar el sistema de inyección dinámica de validadores del Preparador (el mapa de hooks según el lenguaje). 

Actualmente, el `workflow.service.ts` inyecta un mapa de validadores (hooks) de manera estática y "hardcodeada" específicamente para TypeScript (`npx tsc --noEmit`).

**Objetivo:**
Modificar el Orquestador para que genere el mapa de validadores (`validationMap`) dinámicamente basándose en el reporte inicial del Preparador. El Preparador debe analizar el workspace (`package.json`, `composer.json`, `requirements.txt`, etc.) y determinar las herramientas de validación adecuadas (ej. `php -l`, `flake8`, `eslint`, etc.), de manera que el sistema sea verdaderamente agnóstico al lenguaje y stack.
