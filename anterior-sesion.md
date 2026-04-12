## User

---

## Assistant

## Goal

Definir y preparar la siguiente etapa del sistema de IA por razas, con foco en:
1) mejorar macroeconomía + infraestructura por arquetipo/raza, y  
2) diseñar un **motor propio egipcio defensivo** inspirado en el motor germano por fases, con expansión presente pero segura.

Además, el usuario pidió dejar un plan en `.md` muy detallado (6 fases, ejemplos prácticos, checklist) para que el agente lo implemente de forma precisa después.

## Instructions

- El usuario pidió explícitamente:
  - analizar el estado actual y viabilidad con `german-phase-engine.js` + `reactive.js`,
  - adoptar doctrina de tribus:
    - galos y egipcios = defensivos,
    - germanos y hunos = ofensivos,
    - romanos = versátiles,
  - crear un plan completo en archivo `.md` para motor egipcio defensivo,
  - incluir **6 fases**, ejemplos prácticos y checklist de progreso.
- Preferencia persistente: ejecución por fases claras, precisión alta, plan accionable para implementación directa por el agente.

## Discoveries

- El motor macro germano actual (`src/features/game/ai/controller/german-phase-engine.js`) está muy avanzado y parametrizado por dificultad; no está diseñado por arquetipo.
- Para germanos, `AIController` ya enruta al phase engine y evita fallback legacy macro.
- `reactive.js` sí usa arquetipo, pero también tiene sesgo por raza (germanos/hunos ofensivos por defecto), lo que puede requerir ajustes para reflejar mejor doctrina por raza.
- Existe infraestructura de arbitraje fuerte en `AIController.js`:
  - `villageCombatState` con TTL,
  - locks/cooldowns,
  - prioridad por capas y ventanas de comandos,
  - procesamiento diferido de `counterWindow`.
- En datos de unidades (`core/data/units.js`), Egipto está alineado con perfil eco/defensivo (defensores eficientes + economía), lo que valida el nuevo motor egipcio.
- La colonización (`missionType: 'settle'`) hoy aparece en acciones legacy de goals (`action-executor/goal-actions.js`), mientras que german-phase-engine maneja preparación de expansión por fases; esto sugiere que para Egipto habrá que definir ruta clara de ejecución de expansión (preparar + disparar) sin ambigüedad.

## Accomplished

1) **Análisis de viabilidad y arquitectura**  
- Se confirmó que crear un motor egipcio defensivo es técnica y estratégicamente viable y encaja con el sistema actual (macro por fases + reactive + arbitraje central).

2) **Definición de enfoque doctrinal por tribu**  
- Quedó asentada la guía solicitada por el usuario:
  - defensivos: galos/egipcios,
  - ofensivos: germanos/hunos,
  - versátil: romanos.

3) **Creación del plan maestro en `.md`**  
- Se creó el archivo:
  - `docs/plan-egyptian-defensive-phase-engine.md`
- Contiene:
  - objetivo, alcance, arquitectura e integración,
  - diferencias clave respecto al motor germano,
  - contrato de estado sugerido por aldea,
  - **6 fases completas** (F1–F6) con:
    - objetivos,
    - filosofía,
    - prioridades de construcción/reclutamiento,
    - ratios eco/mil por dificultad,
    - condiciones de salida,
    - ejemplos prácticos,
  - política de amenaza,
  - integración esperada con `reactive.js`,
  - estrategia de implementación técnica,
  - riesgos/mitigaciones,
  - Definition of Done,
  - checklist global + checklist por fase.

4) **Estado actual**
- Hecho: planificación/documentación completa del motor egipcio defensivo.
- Pendiente inmediato: empezar implementación del plan en código (nuevo engine + integración con controller + validación).

## Relevant files / directories

- **Nuevo plan creado**
  - `docs/plan-egyptian-defensive-phase-engine.md` ✅ (creado y completo)

- **Motores/Orquestación analizados para integración**
  - `src/features/game/ai/controller/german-phase-engine.js` (referencia base para diseño por fases)
  - `src/features/game/ai/controller/reactive.js` (acople táctico y sesgos por postura/raza)
  - `src/features/game/ai/AIController.js` (routing por raza, arbitraje central, estado táctico compartido)

- **Datos de juego usados para justificar diseño egipcio**
  - `src/features/game/core/data/units.js` (perfil y roster egipcio)
  - `src/features/game/core/data/lookups.js` (resolución de tropas/edificios)

- **Infraestructura de ejecución macro/acciones consultada**
  - `src/features/game/ai/AIActionExecutor.js`
  - `src/features/game/ai/action-executor/construction.js`
  - `src/features/game/ai/action-executor/recruitment.js`
  - `src/features/game/ai/action-executor/goal-actions.js` (ruta actual de `settle_new_village`)
  - `src/features/game/ai/controller/economic.js`
  - `src/features/game/state/worker/budget.js`
  - `src/features/game/state/GameWorker.js`
  - `src/features/game/ai/AIPersonality.js`
  - `src/features/game/ai/StrategicAI.js`

- **Docs de contexto leídas**
  - `docs/plan-integracion-reactive-german-phase-engine.md`
  - `docs/plan-plantilla-ia-germana-fases.md`
  - `docs/ai-phase7-validation-results.md`

---

