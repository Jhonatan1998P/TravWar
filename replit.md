# TravWar — Travian Browser Game Simulator

## Descripción
Simulador de juego de navegador tipo Travian con IA avanzada para múltiples facciones (Romanos, Germanos, Egipcios, Hunos). La IA gestiona economía, construcción, reclutamiento y combate reactivo.

## Stack
- **Frontend/Backend**: Vanilla JS ES modules + Vite
- **Sin framework UI** en capa de IA
- **Monorepo**: pnpm workspace

## Arquitectura IA

### Archivos principales
| Archivo | Descripción |
|---|---|
| `src/features/game/ai/AIController.js` | Controlador principal — ciclos económico y militar, reactive events |
| `src/features/game/ai/controller/reactive.js` | Lógica reactiva — detección de amenazas, dodge, refuerzos, contraataque |
| `src/features/game/ai/strategy/nemesis.js` | Selección inteligente de objetivo Némesis |
| `src/features/game/ai/AIPersonality.js` | Configuración de personalidades y arquetipos |
| `src/features/game/ai/action-executor/` | Ejecutores de acciones (construcción, goal-actions) |
| `src/features/game/ai/controller/phase-engine-common.js` | Motor de fases económicas compartido |

### Módulos reactivos en `reactive.js`
- `handleAttackReact` — reacción principal a ataques (detección de fakes integrada)
- `handleEspionageReact` — reacción a espionaje
- `processDodgeTasks` — ejecuta esquives programados (ahora usa aldeas propias seguras)
- `processReinforcementRecalls` — recall de refuerzos tras batalla
- `planResourceEvacuation` — evacúa recursos en riesgo vía mercaderes
- `evaluateThreatAndChooseResponse` — evaluación táctica completa
- `planSnipeTasks` — programa envío retardado de refuerzos para llegar instantes antes del ataque
- `processSnipeTasks` — despacha snipe tasks cuando llega su `dispatchAt`

## Mejoras IA implementadas (Sprint 1 — Plan_Mejora_IA.md)

### 1.1 Detección de Fakes
- `classifyIncomingMovement()` en `reactive.js`
- Criterios: 1 unidad, raid < 5 unidades, ataque ≤ 3 sin asedio, raid < 10 sin asedio
- Fakes → log + `villageCombatState.isFake=true` + cooldown; sin reacción defensiva

### 1.3 Escondite de Recursos (`planResourceEvacuation`)
- Exportada de `reactive.js`, llamada desde `AIController._handleAttackReact` en amenaza alta/crítica
- Calcula recursos en riesgo sobre capacidad del escondrijo (cranny)
- Envía mercaderes (`send_merchants`) a la aldea propia más cercana y segura
- Cooldown de 120s por aldea (`_merchantEvacuationCooldownByVillage`)

### 1.4 Evacuación a Aldeas Propias (Dodge Mejorado)
- `executeDodge` acepta parámetro `ownerId`
- Prioriza aldeas propias sin ataques enemigos entrantes (safeHavens), ordenadas por proximidad
- Fallback: oasis aleatorio en radio de 10 tiles (comportamiento original)
- `processDodgeTasks` pasa `ownerId` → `executeDodge`
- `AIController._processDodgeTasks` pasa `this._ownerId`

### 1.6 Reparación Prioritaria Post-Asedio
- `AIController._siegeArrivalPendingByVillage`: rastrea llegada de ataques de asedio
- `AIController._emergencyRepairTargetsByVillage`: cola de edificios a reparar
- `AIController._processEmergencyRepairs(gameState)`: llamado en cada ciclo de `makeDecision`
- Orden de prioridad: `cityWall > barracks > granary > warehouse > mainBuilding`

### 2.4 Némesis Inteligente (nemesis.js)
- Eliminado `Math.random()` para selección de objetivo
- `scoreNemesisCandidate()`: scoring por proximidad (35%), aldeas (15%), cluster (25%), población (10%), base (15%)
- `selectBestNemesisCandidate()`: elige el candidato con mayor score
- `reevaluateNemesis()`: abandona némesis si está demasiado lejos (>80 tiles) o demasiado atacada por otros (≥3 AIs)
- `getPlayerVillages()`: helper exportado

## Mejoras IA implementadas (Sprint 2 — Plan_Mejora_IA.md)

### 1.2 Sniping — Envío Cronometrado de Refuerzos
- `planSnipeTasks()` en `reactive.js`: detecta aldeas propias con tropas defensivas capaces de llegar con ventana de 2–25 segundos antes del impacto. Programa el `dispatchAt = arrivalTime - travelTime - 2s`.
- `processSnipeTasks()` en `reactive.js`: en cada tick de `makeDecision`, despacha las tareas cuyo `dispatchAt <= now`. Valida que el ataque siga activo y que las tropas estén disponibles.
- `AIController._snipeTasks = new Map()` — almacén de tareas de snipe con clave `${originVillageId}:${targetVillageId}`.
- `AIController._processSnipeTasks(gameState)` — llamado en `makeDecision` junto a `processDodgeTasks`.
- Hook en `_handleAttackReact`: si el combatState es real (no fake) y la respuesta no es dodge, se llama `planSnipeTasks` automáticamente.
- Condición de activación: `threatLevel >= medium` y `preferredResponse` distinto de `full_dodge`/`partial_dodge`.

### 1.5 Defensa Avanzada de Frontera (Forward Defense)
- `AIController._manageForwardDefense(gameState)` — llamado al inicio de cada ciclo militar (`_processMilitaryDecision`).
- Define "aldeas frontera": propias con enemigos a ≤ 30 tiles.
- Envía el 25% del superávit defensivo de aldeas interiores a cada aldea frontera sub-defendida (< 150 tropas defensivas).
- Cooldown de 10 min por aldea frontera (`_forwardDefenseCooldownByVillage`) para evitar spam.
- No actúa si la aldea frontera o la fuente están bajo amenaza activa.

## Mejoras IA implementadas (Sprint 3 — Plan_Mejora_IA.md)

### 2.1 Ataques Falsos (Fake Attacks)
- `StrategicAI._planFakeAttacks({ realTargetCoords, forces, gameState, ownerId, race, maxFakes })` — genera 2-3 raids de 1 unidad de infantería ofensiva barata hacia aldeas enemigas a ≤ 10 tiles del objetivo real.
- Se activa automáticamente cuando se confirma un ataque nemesis (post `_planNemesisDestruction`) y cuando se confirma una ofensiva doctrinal (post `_planDoctrinalStrategicOffense`).
- La unidad elegida: infantería ofensiva más barata disponible con mínimo `maxFakes` en stock.
- Los comandos van marcados con `meta: { isFakeAttack: true }` para trazabilidad en logs.

### 2.3 Farmlists Persistentes
- Nuevo archivo: `src/features/game/ai/strategy/farmlist.js`
- `updateFarmList(aiState, knownTargets, ownerId, myVillages, maxFarms = 25)` — escanea objetivos conocidos con intel fresco, añade villages con ≤ 30 tropas y ≥ 200 recursos dentro de 35 tiles. Actualiza `aiState.farmList[]` en cada ciclo. Elimina entradas con `failCount ≥ 3` o que ganaron tropas.
- `runFarmListCycle({ farmList, forces, gameState, gameSpeed, troopSpeed, ... })` — para cada granja vencida su intervalo, selecciona la unidad ofensiva con mejor ratio `ataque/coste` (no la más barata), con bonus de herrería aplicado. Cantidad enviada: `max(10, ceil(defensaConocida * 4 / efectividad) + 3)`.
- **Escala con velocidad de juego**: `farmIntervalMs = base / gameSpeed` (mínimo 5 min). A 10x la velocidad los recursos se acumulan 10x más rápido → re-farmeo 10x más frecuente.
- **Escala con velocidad de tropas**: `maxDist = min(80, 35 * sqrt(troopSpeed))`. Tropas más rápidas pueden farmear más lejos en el mismo tiempo.
- Fuerza seleccionada: la de mayor `attackPerCost - dist * 0.01` (preferencia por eficiencia sobre proximidad pura).
- `StrategicAI._runFarmListCycle(...)` — wrapper en StrategicAI, recibe y propaga `gameSpeed` + `troopSpeed`.
- `updateFarmList` llamado justo después de `_scanAndClassifyTargets`; recibe `gameSpeed` para re-calcular intervalos con intel fresco.
- Persistencia: la lista vive en `aiState.farmList` (por jugador IA), sobrevive entre ciclos.

## Comandos de desarrollo
```bash
pnpm dev      # Inicia servidor Vite en puerto 5173/5000
```
