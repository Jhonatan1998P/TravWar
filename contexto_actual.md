# Contexto actual consolidado (IA por fases + estado de trabajo)

## 1) Objetivo principal
Corregir bloqueos en los motores por fases de **Germans** y **Egyptians** cuando una accion falla por prerequisitos (por ejemplo, reclutamiento sin investigacion), evitando ciclos de `NO_ACTION` y asegurando destrabe automatico con subgoals.

## 2) Requisito clave de arquitectura
- La solucion debe ser reutilizable entre motores por fases.
- Evitar logica duplicada entre motor germano y motor egipcio.
- Centralizar utilidades compartidas en `phase-engine-common.js`.

## 3) Alcance secundario ya implementado en esta etapa
- Modo POV de aldea IA en UI (ver perspectiva completa de la aldea IA activa sin cambiar ownership real).
- Mejoras de eficiencia de reclutamiento y comportamiento de ratio de asedio.
- Ajustes previos de timing/decision, incluyendo cambios vinculados a oasis.

## 4) Descubrimientos tecnicos relevantes
- `VillageProcessor.queueRecruitment` puede fallar por razones recuperables: `RESEARCH_REQUIRED`, `PREREQUISITES_NOT_MET`, `INSUFFICIENT_RESOURCES`, `QUEUE_FULL` y bloqueos asociados a expansion.
- El motor germano ya tenia mecanica de subgoal, pero con helpers locales duplicados.
- El motor egipcio tenia estado parcial (`activeSubGoal`) pero no el flujo anti-deadlock completo en ejecucion.
- Era necesario alinear ambos motores bajo una capa comun para bajar divergencia y mejorar mantenibilidad.

## 5) Cambios implementados

### 5.1 Capa comun reutilizable
Archivo: `src/features/game/ai/controller/phase-engine-common.js`

Se agrego/centralizo:
- `PHASE_RECOVERABLE_BLOCK_REASONS`
- `isRecoverablePhaseBlockReason`
- `clonePhaseStep`
- `runPriorityStepList`
- `getPhaseStepQueueType`
- `getNextExpansionPalaceLevel`
- `buildPrerequisiteResolverStepFromBlock`

Impacto:
- Una sola fuente de verdad para deteccion de bloqueos recuperables y resolucion de prerequisitos.

### 5.2 Motor egipcio (anti-bloqueo funcional)
Archivo: `src/features/game/ai/controller/egyptian-phase-engine.js`

Se implemento/activo:
- Creacion y refresh de `activeSubGoal` al detectar bloqueo recuperable.
- Procesamiento por ciclo del subgoal con reintento/backoff.
- Limpieza e historial al resolver subgoal o transicionar fase.
- Integracion de `handlePhaseActionResult` para disparo automatico de resolucion.

Impacto:
- Evita deadlocks de reclutamiento por investigacion/prerequisitos.

### 5.3 Motor germano (refactor contra capa comun)
Archivo: `src/features/game/ai/controller/german-phase-engine.js`

Se modifico:
- Reemplazo de helpers locales por utilidades de `phase-engine-common`.
- Sustitucion de checks hardcodeados por helper comun de razon recuperable.
- Ajuste final en `processActiveSubGoal` para usar validacion compartida de bloqueos.

Se elimino logica local duplicada:
- Set local de razones recuperables.
- Funciones equivalentes ya absorbidas por la capa comun.

Impacto:
- Menor divergencia entre motores y mantenimiento mas simple.

### 5.4 Alineacion de AIController
Archivo: `src/features/game/ai/AIController.js`

Se modifico:
- Paso de `gameSpeed` al ciclo economico egipcio.

Impacto:
- Retry/backoff de subgoals consistente con la velocidad real de juego.

## 6) Validaciones ejecutadas
- `npm run ai:validate:egyptian-phase-engine` -> OK (6/6).
- `npm run ai:harness:tribus:detallado` -> OK, reporte generado.
- Regresion ad-hoc en motores germano+egipcio para bloqueo `RESEARCH_REQUIRED` -> OK:
  - crea subgoal,
  - ejecuta resolver de investigacion,
  - retoma reclutamiento.

## 7) Estado de archivos modificados (workspace)

### 7.1 IA por fases y reclutamiento
- `src/features/game/ai/controller/phase-engine-common.js`
- `src/features/game/ai/controller/egyptian-phase-engine.js`
- `src/features/game/ai/controller/german-phase-engine.js`
- `src/features/game/ai/AIController.js`
- `src/features/game/ai/action-executor/recruitment.js`
- `src/features/game/ai/utils/AIUnitUtils.js`

### 7.2 POV/UI/estado (cambios acumulados)
- `src/features/game/state/GameWorker.js`
- `src/features/game/state/worker/movements.js`
- `src/features/game/ui/AttackPanelUI.js`
- `src/features/game/ui/BattleReportUI.js`
- `src/features/game/ui/BuildingInfoUI.js`
- `src/features/game/ui/MovementsUI.js`
- `src/features/game/ui/ReportListUI.js`
- `src/features/game/ui/TileInfoUI.js`
- `src/features/game/ui/UIMainManager.js`
- `src/features/game/ui/renderSelectors.js`
- `src/features/game/views/MapView.js`
- `src/features/game/views/ReportsView.js`

### 7.3 Reportes y sesion
- `reports/reporte-harness-tribus.md` (actualizado)
- `session-ses_27b5.md` (actualizado)
- `contexto_actual.md` (este archivo, actualizado)

## 8) Modificado / eliminado / borrado / guardado
- **Modificado:** todos los archivos listados en seccion 7.
- **Eliminado (logica):** duplicacion local en motor germano reemplazada por capa comun.
- **Borrado (archivos):** no se borraron archivos del repo en esta etapa.
- **Guardado/generado:** reporte de harness y actualizacion de contexto para handoff.

## 9) Nomenclatura de tribus para este proyecto
Usar esta forma en contexto tecnico y reportes: **Gauls, Germans, Romans, Huns, Egyptians**.

## 10) Handoff obligatorio para nuevo chat
Si un nuevo agente abre este archivo, debe confirmar contexto con este mensaje exacto:

`CONTEXTO_CARGADO: contexto_actual.md leido y entendido.`

Luego debe continuar desde el ultimo punto de validacion/regresion pendiente sin reabrir decisiones ya cerradas.
