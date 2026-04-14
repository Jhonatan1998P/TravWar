## Goal

Completar y ajustar la convergencia entre los motores IA por fases de **Egyptians** y **Germans** para asegurar:

- Prioridad absoluta de bloqueos/subgoals sobre acciones macro.
- Presupuestos correctos por tipo de accion (economico vs militar).
- Salida por fases basada en ciclos de reclutamiento por tipo de unidad.
- Ejecucion en micro-pasos con round robin para evitar bloqueos por objetivos largos.
- Reutilizacion maxima entre motores, sin duplicidad.

## Instructions

- Priorizar bloqueos y subgoals por encima de construccion/reclutamiento/investigacion.
- Si hay bloqueo recuperable, activar subgoal inmediato y pausar decisiones economicas hasta resolver.
- `wait_resources` solo para `INSUFFICIENT_RESOURCES`; luego rebalance inmediato al ratio objetivo.
- Routing de presupuesto:
  - Reclutamiento -> `budget.mil`
  - Construccion/investigacion/herreria -> `budget.econ`
- Rebalance eco/mil en tiempo real fijo: `600000 ms` (independiente de `gameSpeed`).
- Reemplazar gates de uptime de cola por ciclos militares por fase y bucket de unidad.
- Implementar matrix de lanes con round robin y micro-pasos en ambos motores.
- Mantener arquitectura compartida para facilitar extension a futuras tribus.

## Discoveries

- Ya existia convergencia fuerte en runtime comun (`phase-engine-common.js`) para subgoals y ciclos base.
- Se detectaron casos donde objetivos combinados (construccion + reclutamiento) perdian bloqueos recuperables; corregido.
- Se detecto mezcla de prioridades y routing de presupuesto; corregido.
- Se incorporo scheduler por matriz de lanes (`construction -> research -> upgrade -> recruitment`) con round robin.
- Reclutamiento paso a `countMode: cycle_batch` para micro-pasos con minimo 1 ciclo.
- Por decision de producto, se eliminaron scripts de validacion/harness porque no aportaban decision operativa confiable.

## Accomplished

- **Prioridad de bloqueos y subgoals:**
  - Bloqueos/subgoals se atienden antes del flujo economico normal.
  - `wait_resources` restringido a `INSUFFICIENT_RESOURCES` y rebalance posterior inmediato.
- **Presupuestos corregidos por accion:**
  - Reclutamiento usa `mil`.
  - Construccion, investigacion y herreria usan `econ`.
- **Salida por fases basada en ciclos:**
  - Se removieron gates por uptime de cola en fases relevantes de Egyptians y Germans.
  - Se migraron a ciclos por bucket de unidad.
- **Micro-pasos + round robin compartidos:**
  - Nuevos helpers en `phase-engine-common.js`:
    - `getRoundRobinPhaseSteps`
    - `runPhaseLaneMatrix`
    - `pickPhaseLaneResult`
  - Ambos motores migrados a lane matrix por fase.
  - Reclutamiento ejecuta micro-pasos por ciclos (`cycle_batch`).
- **Fase 1 actualizada en ambos motores (requisito reciente):**
  - Infraestructura objetivo: `mainBuilding 5`, fields `4`, `cityWall 5`, `barracks 5`, `warehouse 6`, `granary 6`, `embassy 3`, `marketplace 3`, `academy 5`, `smithy 3`, `stable 3`.
  - Ciclos de salida:
    - Germans: `offensive_infantry 10` + `scout 3`
    - Egyptians: `defensive_infantry 10` + `scout 3`
  - Implementado con helpers compartidos para evitar duplicidad.
- **Documentacion funcional por fase:**
  - Nuevo documento `docs/ai/objetivos_fases_egipcios_germanos.md` con objetivos por fase, pasos y criterios de salida.
- **Limpieza de scripts de validacion/harness:**
  - Eliminados scripts en `scripts/validation/*` y `scripts/harnesses/*`.
  - `package.json` limpiado de comandos `ai:validate:*` y `ai:harness:*`.
  - `reports/sessions/session-ses_2776.md` y este contexto alineados con la decision operativa.

## Estado actual

- Fase 1 quedo cerrada con los requisitos nuevos aplicados en ambos motores.
- El siguiente bloque de trabajo es Fase 2 en ambos motores, manteniendo patron compartido y sin duplicidad.
- Persisten menciones historicas en algunos docs antiguos sobre validacion/harness (texto no operativo), potencialmente limpiables en una pasada posterior.

## Relevant files / directories

- **Motores y runtime compartido**
  - `src/features/game/ai/controller/phase-engine-common.js`
  - `src/features/game/ai/controller/egyptian-phase-engine.js`
  - `src/features/game/ai/controller/german-phase-engine.js`
- **Ejecucion y presupuesto**
  - `src/features/game/ai/action-executor/recruitment.js`
  - `src/features/game/engine/VillageProcessor.js`
  - `src/features/game/state/GameManager.js` (modificado en workspace)
- **Documentacion y sesion**
  - `docs/ai/contexto_actual.md`
  - `docs/ai/objetivos_fases_egipcios_germanos.md`
  - `reports/sessions/session-ses_2776.md`
- **Scripts/config limpiados**
  - `package.json`
  - `scripts/validation/*` (eliminado)
  - `scripts/harnesses/*` (eliminado)

---
