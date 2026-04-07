# Fase 6 - Comparacion baseline vs estado actual

Fuente baseline inicial (Fase 0 original):

- Referencia guardada en el plan (`docs/ai-budget-military-implementation-plan.md`).

Fuente estado actual:

- Ultima corrida de `npm run ai:baseline:phase0` en `docs/ai-phase0-baseline-results.json`.

## KPI por escenario

### Escenario A (1 IA)

- Ratio deviation avg: `0.64521` -> `0.00000` (mejora absoluta `-0.64521`).
- Construction idle rate: `0.85556` -> `0.86319` (cambio `+0.00763`, peor).
- Recruitment idle rate: `1.00000` -> `1.00000` (sin cambio).
- Troops/hour total: `0` -> `0` (sin cambio).

### Escenario B (3 IA)

- Ratio deviation avg: `0.62347` -> `0.00000` (mejora absoluta `-0.62347`).
- Construction idle rate: `0.90278` -> `0.88403` (cambio `-0.01875`, mejor).
- Recruitment idle rate: `1.00000` -> `1.00000` (sin cambio).
- Troops/hour total: `0` -> `0` (sin cambio).

### Escenario C (3 IA, stress ratio)

- Ratio deviation avg: `0.64448` -> `0.00000` (mejora absoluta `-0.64448`).
- Construction idle rate: `0.88935` -> `0.86759` (cambio `-0.02176`, mejor).
- Recruitment idle rate: `1.00000` -> `1.00000` (sin cambio).
- Troops/hour total: `0` -> `0` (sin cambio).

## Lectura ejecutiva

- KPI de ratio (< 0.02) queda ampliamente cumplido en los 3 escenarios.
- KPI de sub-objetivos falsos de storage sigue en `0`.
- KPI de throughput militar (+15%) no se valida con este baseline porque el throughput permanece en `0` tanto en baseline inicial como en estado actual.

## Recomendacion para cierre completo de KPI militar

- Ejecutar un benchmark dedicado de throughput militar con:
  - duracion mayor (>= 6h simuladas),
  - `gameSpeed` alto,
  - o estado inicial semilla con prerequisitos militares ya desbloqueados.
