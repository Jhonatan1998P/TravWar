## Goal

Completar la convergencia profesional entre los motores por fases de **Germans** y **Egyptians** para evitar bloqueos/deadlocks, unificar runtime compartido sin regresiones, corregir precisión de ciclos de reclutamiento, asegurar compatibilidad de estado guardado, y habilitar rollout controlado por feature flags. Además, dejar validaciones/harnesses finales en verde y actualizar contexto para handoff.

## Instructions

- El usuario pidió arreglos precisos y profesionales de bugs detectados en logs:
  - logs con `Etapa N/A` / `Fase Sin fase macro` en IA egipcia.
  - ciclos de reclutamiento mal contados (cada orden contaba como ciclo).
  - bloqueo por prerequisitos/recursos/almacenaje que debía resolverse con subgoals.
- El usuario exigió que el rebalance eco/mil use **constante fija real de 600000ms** (10 min) en `constants.js`, **independiente de gameSpeed**.
- El usuario pidió convergencia por plan (`docs/ai/Plan_Convergencia_Absoluta.md`) y avanzar por fases hasta cerrar:
  - Fase 3 (runtime común),
  - Fase 4 (migración por bloques),
  - Fase 6 (compatibilidad de estado),
  - Fase 7 (rollout por feature flags),
  - y agregar validación de `RESEARCH_REQUIRED` al contract común.
- Restricción explícita en un punto: “no hagas código, solo responde” para análisis; luego autorizó continuar implementando.
- Mantener nomenclatura de tribus: **Gauls, Germans, Romans, Huns, Egyptians**.
- Mantener handoff con `docs/ai/contexto_actual.md` actualizado y mensaje de carga obligatorio.

## Discoveries

- `VillageProcessor.queueRecruitment` devuelve razones recuperables clave: `RESEARCH_REQUIRED`, `PREREQUISITES_NOT_MET`, `INSUFFICIENT_RESOURCES`, `QUEUE_FULL`, etc.
- El cálculo de ciclos egipcios tenía bug estructural: usaba `ceil` + mínimo 1 ciclo por orden; debía ser acumulación en ms y ciclos completos por `floor(totalMs/180000)`.
- El worker de logs resolvía fase macro de forma incompleta para Egyptians, provocando `N/A`.
- El rebalance eco/mil estaba vinculado a tiempo de juego escalado; se corrigió a tiempo real fijo.
- En Egyptians había un caso de pérdida de bloqueo recuperable cuando construcción fallaba recuperable pero reclutamiento cerraba en no-acción; se corrigió merge de resultados.
- Se detectó necesidad de converger runtime subgoal en capa común y mantener diferencias como config estratégica por tribu.
- Se implementaron validaciones nuevas para compatibilidad de estado legacy y rollout por flags.

## Accomplished

- **Contexto/logs macro**:
  - Se corrigió resolución de fase/etapa para Egyptians y Germans en logs worker.
  - Se añadieron labels egipcias de fase macro.
- **Budget rebalance fijo**:
  - Se definió `BUDGET_RATIO_REBALANCE_INTERVAL_MS = 600000` en constantes globales.
  - Worker ahora rebalancea por tiempo real acumulado (online/offline), no por gameSpeed.
- **Ciclos de reclutamiento**:
  - Egyptians migró a acumulación en `totalMs` + `floor` para ciclos completos de 3 min.
  - Se agregó normalización legacy (`total` ciclos antiguos -> `totalMs`) para no romper estado.
- **Subgoals anti-deadlock**:
  - Se reforzó creación/proceso de subgoals recuperables en Egyptians.
  - Se resolvió bloqueo diferido en combinación construcción+reclutamiento.
  - Se agregó resolver de storage (`warehouse/granary`) para `INSUFFICIENT_RESOURCES` por capacidad.
- **Convergencia runtime (Fase 3/4)**:
  - En `phase-engine-common.js` se centralizó runtime de subgoals:
    - firma de step, disponibilidad de colas, completion research step,
    - creación/refresh de subgoal,
    - procesamiento activo de subgoal,
    - helpers comunes de ciclos y retry.
  - Ambos motores (German/Egyptian) delegan creación y proceso de subgoal a helpers comunes.
- **Compatibilidad de estado (Fase 6)**:
  - Hydrate/serialize robustecidos para ambos motores:
    - normalización de `phaseId` legacy,
    - normalización de `transitions`,
    - migración de ciclos legacy a ms,
    - normalización de subgoals legacy (`kind/type` aliases),
    - aliases legacy de métricas/KPI (especialmente egipcio),
    - `schemaVersion: 2` al serializar.
- **Rollout por feature flags (Fase 7)**:
  - Se agregaron flags globales para phase engine por tribu (`germans`, `egyptians`, `all`).
  - `AIController` resuelve flags y decide PhaseEngine vs GoalManager fallback por raza.
  - Logs de decisión muestran macro engine efectivo según rollout.
- **Contract tests / harnesses**:
  - Contract común agregado y ampliado; incluye:
    - `PREREQUISITES_NOT_MET`,
    - `QUEUE_FULL`,
    - `INSUFFICIENT_RESOURCES` por capacidad,
    - ciclos por bloques completos de 3 minutos,
    - **nuevo: `RESEARCH_REQUIRED` crea subgoal de investigación** para ambas tribus.
  - Harness determinista de replay por seed.
  - Validación de compatibilidad de estado.
  - Validación de rollout flags.
- **Ejecuciones finales en verde**:
  - `ai:validate:phase-contract` ✅ 5/5
  - `ai:validate:phase-state-compat` ✅ 2/2
  - `ai:validate:phase-rollout-flags` ✅ 4/4
  - `ai:validate:egyptian-phase-engine` ✅ 8/8
  - `ai:harness:phase-replay` ✅
  - `ai:harness:tribus:detallado` ✅
  - `build` ✅ (warning no bloqueante de chunk size)
- **Estado plan**:
  - Estimación comunicada: ~95% completo.
  - Pendiente principal: formalizar baseline pre/post versionado (Fase 1 estricta) con huella histórica comparable.

## Relevant files / directories

- **Plan/contexto/reportes**
  - `docs/ai/Plan_Convergencia_Absoluta.md` (referencia de fases del plan)
  - `docs/ai/contexto_actual.md` (actualizado e hidratado para handoff)
  - `reports/reporte-harness-tribus.md` (actualizado)
  - `reports/reporte-convergencia-fases.md` (nuevo, replay determinista)

- **Motores por fases / capa común**
  - `src/features/game/ai/controller/phase-engine-common.js` (centralización runtime común de subgoals/ciclos/handlers)
  - `src/features/game/ai/controller/german-phase-engine.js` (delegación al runtime común + compat legacy + schemaVersion 2)
  - `src/features/game/ai/controller/egyptian-phase-engine.js` (delegación al runtime común + correcciones ciclos/subgoals + compat legacy + schemaVersion 2)

- **Orquestación AI / rollout**
  - `src/features/game/ai/AIController.js` (feature flags rollout por tribu, fallback GoalManager, logs macro)
  - `src/features/game/core/data/constants.js` (constante rebalance fija + flags rollout resolver)

- **Worker / budget / logging**
  - `src/features/game/state/GameWorker.js` (contexto de fase correcto + rebalance real-time)
  - `src/features/game/state/worker/budget.js` (usa intervalo global fijo)

- **Validación y harnesses**
  - `scripts/validation/ai-validation-egyptian-phase-engine.mjs` (regresiones egipcias ampliadas)
  - `scripts/validation/ai-validation-phase-engine-contract.mjs` (contract común, incluye `RESEARCH_REQUIRED`)
  - `scripts/validation/ai-validation-phase-state-compat.mjs` (nuevo, compatibilidad hydrate/serialize legacy)
  - `scripts/validation/ai-validation-phase-rollout-flags.mjs` (nuevo, rollout flags)
  - `scripts/harnesses/ai-harness-phase-replay-deterministic.mjs` (nuevo)
  - `scripts/harnesses/ai-harness-tribus-detallado-es.mjs` (harness detallado por tribus)
  - `package.json` (scripts nuevos de validación/harness)

- **Otros archivos tocados en el workspace durante la sesión**
  - `src/features/game/ai/action-executor/recruitment.js`
  - `src/features/game/ai/utils/AIUnitUtils.js`
  - `session-ses_27b5.md` (eliminado)
  - `reports/sessions/session-ses_2776.md` (nuevo/actualizado)

---
