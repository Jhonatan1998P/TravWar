# Plan IA: Farm Oasis Inteligente con Prioridad Militar (6 Fases)

## Objetivo

Lograr que la IA farmee oasis de forma rentable e inteligente, pero **solo cuando no exista un objetivo de ataque/saqueo de máxima prioridad**.

Reglas duras del sistema:

- Si hay objetivo `MAX_PRIORITY_GOAL`, **no** se ejecuta farm de oasis.
- La IA solo ataca oasis si `RewardNet > 0`.
- Oasis se ordenan por `RewardNet` descendente (empate: menor distancia).
- UI de jugador no debe mostrar ROI/Recomendaciones.

---

## Variables y fórmulas base

- `V_i`: valor por bestia `i`.
- `killed_i`: bestias estimadas (o reales) muertas.
- `RewardGross`: recompensa bruta por bajas de bestias.
- `LossValue`: costo de tropas propias perdidas.
- `TravelCost`: costo por distancia y tiempo de viaje.
- `RewardNet`: rendimiento neto.
- `Pressure_o`: presión reciente sobre oasis.

Fórmulas:

1. `V_i = upkeep_i * M_oasis * D_i`
2. `RewardGross = SUM(killed_i * V_i)`
3. `TravelCost = Distance * C_dist + TravelMinutes * C_time`
4. `RewardNet = RewardGross - LossValue - TravelCost`
5. `Pressure_o = clamp(AttacksRecent_o / AttackRef, 0, 1)`
6. `RegenEff = RegenBase * (1 - alpha * Pressure_o)`

Ejemplo simple:

- `RewardGross=12,000`, `LossValue=3,000`, `TravelCost=900`
- `RewardNet=12,000-3,000-900=8,100` -> objetivo válido

---

## Fase 1: Gate de prioridad máxima (bloqueo de farm)

### Objetivo

No permitir farm de oasis si existe objetivo militar crítico.

### Qué cambiar

1. Editar `src/features/game/ai/controller/military.js`:
   - Definir chequeo de `MAX_PRIORITY_GOAL` antes de `performOptimizedFarming`.
   - Si existe prioridad máxima, retornar sin comandos de farm.

2. Editar `src/features/game/ai/StrategicAI.js`:
   - En el pipeline militar, ejecutar farm solo si no hubo comandos críticos.

### Criterio de salida

- En logs: se ve explícito `farm bloqueado por prioridad máxima`.

### Ejemplo de decisión

- Hay ventana para ataque PvP crítico -> no se evalúan oasis.
- No hay objetivo crítico -> se habilita evaluación de oasis.

---

## Fase 2: Evaluación económica precisa por oasis

### Objetivo

Simular escuadras y obtener `RewardNet` por oasis.

### Qué cambiar

1. Editar `src/features/game/ai/strategy/farming.js`:
   - Mantener/ajustar generación de 3-4 escuadras candidatas.
   - Simular combate y extraer `defenderLosses`.
   - Calcular `RewardGross`, `LossValue`, `TravelCost`, `RewardNet`.

2. Reutilizar `src/features/game/core/OasisEconomy.js`:
   - Usar tabla única de valor por bestia para `RewardGross`.

3. Verificar parámetros en `src/features/game/core/data/config.js`:
   - `beastBountyMultiplier`, `beastDifficultyFactors`, `raidTravelCostPerDistance`, `raidTravelCostPerMinute`.

### Criterio de salida

- Cada oasis evaluado tiene una mejor escuadra y un `RewardNet` calculado.

### Ejemplo

- Escuadra A: `RewardNet=8100`
- Escuadra B: `RewardNet=5800`
- Se elige A.

---

## Fase 3: Selección estricta y orden inteligente de objetivos

### Objetivo

Atacar oasis solo rentables y en orden correcto.

### Qué cambiar

1. Editar `src/features/game/ai/strategy/farming.js`:
   - Filtrar `RewardNet <= 0`.
   - Ordenar oasis por `RewardNet DESC`, empate por `distance ASC`.
   - Emitir ataques en ese orden hasta agotar tropas disponibles.

2. Editar `src/features/game/ai/action-executor/goal-actions.js`:
   - Alinear lógica alternativa de farm para respetar `RewardNet > 0`.

### Criterio de salida

- Cero ataques a oasis con neto no positivo.

### Ejemplo

- Oasis A `9500`, Oasis B `5200`, Oasis C `-400`
- Orden: `A -> B`; `C` descartado.

---

## Fase 4: Control de sobre-farm y sostenibilidad

### Objetivo

Evitar que la IA abuse de un solo oasis permanentemente.

### Qué cambiar

1. Editar `src/features/game/state/GameWorker.js`:
   - Registrar ataques recientes por oasis.
   - Aplicar presión y regeneración efectiva con `RegenEff`.

2. Editar `src/features/game/engine/GameStateFactory.js`:
   - Inicializar/migrar estado `pressure` en oasis para partidas nuevas/cargadas.

3. Config en `src/features/game/core/data/config.js`:
   - `oasisPressureWindowMinutes`, `oasisPressureAttackRef`, `oasisPressureAlpha`, `beastRegenCycleMinutes`, `beastRegenAmount`.

### Criterio de salida

- Al atacar repetidamente el mismo oasis, su rentabilidad cae temporalmente.

### Ejemplo

- `AttackRef=6`, `alpha=0.6`, `RegenBase=1`
- Con 6 ataques recientes: `Pressure=1` -> `RegenEff=0.4` (40% regen).

---

## Fase 5: Integración limpia para jugador (sin ROI en UI)

### Objetivo

Mantener cálculos en IA/motor sin asistencia de rentabilidad al jugador.

### Qué cambiar

1. Editar `src/features/game/ui/BattleReportUI.js`:
   - Sanitizar campos analíticos (`rewardNet`, `roi`, recomendaciones, etc.).

2. Revisar UI de mapa/ataque/reportes:
   - `src/features/game/ui/TileInfoUI.js`
   - `src/features/game/ui/AttackPanelUI.js`
   - `src/features/game/ui/BattleReportUI.js`

### Criterio de salida

- No existe ningún cálculo de ROI/ranking/recomendación visible para jugador.

### Ejemplo

- Jugador ve bestias, bajas y botín real; no ve “mejor oasis”.

---

## Fase 6: Telemetría, umbrales y validación final

### Objetivo

Medir comportamiento y ajustar balance final sin romper reglas duras.

### Qué cambiar

1. Editar `src/features/game/ai/strategy/farming.js`:
   - Emitir telemetría por ciclo: evaluados, positivos, rechazados, ataques, sumas net/gross/loss/travel.

2. Editar `src/features/game/ai/controller/military.js`:
   - Loguear KPIs por ciclo militar.

3. Editar `src/features/game/ai/AIController.js`:
   - Acumular telemetría histórica y mostrar KPIs en `getDecisionLog()`.

### KPIs objetivo

- `% ataques oasis con RewardNet <= 0` -> `0%`
- `RewardNet promedio` -> positivo estable
- `LossValue / RewardGross` -> rango sano (ej. `0.20-0.65`)
- Rotación de oasis -> evitar monopolio de un único target

### Criterio de salida

- En simulaciones largas, reglas se cumplen y comportamiento es estable.

---

## Checklist de avance

- [x] Fase 1: Gate de prioridad máxima activo.
- [x] Fase 2: Evaluación económica por oasis implementada.
- [x] Fase 3: Selección estricta (`RewardNet > 0`) y orden correcto.
- [x] Fase 4: Presión/regeneración anti sobre-farm activa.
- [x] Fase 5: UI sin ROI/recomendaciones para jugador.
- [x] Fase 6: Telemetría/KPIs y validación final estable.

Estado global:

- [ ] Plan completo implementado y validado en simulación larga.
