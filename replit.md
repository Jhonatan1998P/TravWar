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

## Comandos de desarrollo
```bash
pnpm dev      # Inicia servidor Vite en puerto 5173/5000
```
