## Contexto actual (canonico)

Este documento consolida el estado vigente del trabajo de IA para **Egipcios** y **Germanos**, priorizando reglas activas y decisiones canonicas sin duplicacion.

## Goal

Consolidar y estabilizar la logica de IA por fases (Egipcios/Germanos), con reglas de presupuesto predecibles y una regla unica de proteccion de principiante basada en poblacion total por owner.

## Instructions

- Mantener ejecucion por lanes fija y subgoals con prioridad sobre flujo macro.
- No reintroducir rebalanceos eco/mil por timer, por `INSUFFICIENT_RESOURCES` ni por override de amenaza.
- Aplicar ajuste de ratio de presupuesto solo al entrar/cambiar de fase.
- Unificar proteccion de principiante con una sola constante de poblacion total por owner.
- Usar umbral de salida de proteccion en `250` habitantes (suma de todas las aldeas del owner).
- Permitir ataques hostiles (`attack`, `raid`, `espionage`) solo entre owners sin proteccion.
- Mantener logging legible y consistente para prestamos/intercambios y razones de rechazo.

## Discoveries

- La caida de capacidad militar observada no era perdida aleatoria de recursos: provenia de rebalanceos automaticos 70/30 en distintos puntos.
- Existian tres fuentes de rebalance no deseado: al entrar `wait_resources` por `INSUFFICIENT_RESOURCES`, en timer del phase engine egipcio y en timer global de `GameWorker`.
- La logica de proteccion estaba repartida entre estado (`player.isUnderProtection`) y calculos por poblacion en distintos lugares.
- Para decisiones de ataque, la fuente canonica debia ser el umbral por poblacion total.

## Accomplished

- **Presupuesto IA estabilizado (solo por fase):**
  - Eliminado rebalance por `INSUFFICIENT_RESOURCES` en engines egipcio y germano.
  - Eliminado rebalance periodico global en `GameWorker`.
  - Eliminada ruta legacy `applyDevelopmentBudgetMode(...)` en `AIController`.
  - Implementado ajuste por entrada de fase con `lastAppliedBudgetPhaseId`:
    - Egipcios: `applyPhaseRatioOnPhaseEntry(...)`.
    - Germanos: `ensurePhaseRatioOnEntry(...)`.

- **Logs de reclutamiento/presupuesto mejorados:**
  - Prestamo e intercambio ahora reportan `budget.mil final`.
  - El resumen compacto incluye `budget_mil_final=...`.

- **Proteccion de principiante unificada:**
  - `BEGINNER_PROTECTION_POPULATION_THRESHOLD` actualizado a `250`.
  - Validacion central en `send_movement` para hostiles:
    - `ATTACKER_UNDER_BEGINNER_PROTECTION`.
    - `TARGET_UNDER_BEGINNER_PROTECTION`.
  - Se removio la regla previa de bloqueo fijo "AI vs AI" y se reemplazo por regla universal de proteccion por poblacion.
  - `updatePlayerProtectionStatus()` mantiene salida de proteccion al superar umbral (sin reingreso automatico en esta version).
  - `AIController` mapea y registra las nuevas razones de rechazo.

- **Build:**
  - `npm run build` en verde despues de los cambios.

## Estado actual

- Codigo compila y reglas de ataque/proteccion quedaron centralizadas para hostiles en `worker/commands.js`.
- Rebalance de presupuesto restringido a cambios de fase.
- La proteccion de principiante depende del umbral unico de poblacion total (`250`) por owner.

## Relevant files / directories

- **Proteccion de principiante (regla canonica):**
  - `src/features/game/core/data/constants.js`
  - `src/features/game/state/worker/commands.js`
  - `src/features/game/state/GameWorker.js`

- **Presupuesto y motores de fase:**
  - `src/features/game/ai/controller/egyptian-phase-engine.js`
  - `src/features/game/ai/controller/german-phase-engine.js`
  - `src/features/game/state/worker/budget.js`

- **IA y logging de razones:**
  - `src/features/game/ai/AIController.js`
  - `src/features/game/ai/action-executor/recruitment.js`
  - `src/features/game/engine/VillageProcessor.js`

- **Documentacion:**
  - `docs/ai/contexto_actual.md`
  - `docs/ai/objetivos_fases_egipcios_germanos.md`

## Historial consolidado (resumen)

- Se conserva la convergencia previa a ejecucion determinista por lanes (`construction -> research -> upgrade -> recruitment`).
- Se mantienen correcciones previas de subgoals/prerequisitos y objetivos de fase egipcia (F1/F2).
- El foco actual canonico es: presupuesto estable por fase + proteccion de principiante universal por poblacion total.

---
