# Plan de implementacion IA: construccion, reclutamiento y budget ratio

## Contexto y objetivo

Este plan convierte la IA actual en una IA mas consistente con su budget ratio economico/militar, mas eficiente en reclutamiento y sin bloqueos falsos.

Objetivo principal:

- Hacer que la IA use el ratio economico/militar de forma uniforme en todos los flujos de recursos.
- Mejorar la velocidad de reclutamiento sin romper estabilidad economica.
- Reducir decisiones incorrectas de sub-objetivos por interpretaciones erradas de capacidad.

Resultado esperado:

- Menor desviacion del ratio objetivo por recurso.
- Mayor tropas/hora en fases media y tardia.
- Cero sub-objetivos de almacenamiento falsos por ratio temporal.

## Alcance exacto

Incluye:

- Reparto de recursos por ratio en: produccion, botin de retorno, comercio entrante, recursos iniciales.
- Rebalanceo inmediato cuando cambie `budgetRatio`.
- Correccion de logica de bloqueo en `AIGoalManager`.
- Ajuste del conteo de tropas por scope de objetivo (`per_village` vs `global`).
- Batch de reclutamiento adaptativo.
- Telemetria y validacion comparativa antes/despues.

No incluye:

- Cambios de balance general de unidades del juego.
- Rework de personalidad/arquetipos fuera de parametros de ratio y reclutamiento.
- Cambios de UI (solo logs/telemetria tecnica).

## Archivos impactados (planificados)

- `src/features/game/state/GameWorker.js`
- `src/features/game/engine/GameStateFactory.js`
- `src/features/game/engine/VillageProcessor.js`
- `src/features/game/ai/controller/economic.js`
- `src/features/game/ai/AIGoalManager.js`
- `src/features/game/ai/action-executor/recruitment.js`
- `src/features/game/ai/goal-manager/steps.js`
- `src/features/game/ai/AIController.js`

## Fase 0: linea base (antes de tocar logica)

Objetivo: medir estado actual para comparar mejoras.

Tareas:

1. Definir escenario de prueba minimo (1 aldea IA) y escenario ampliado (3+ aldeas IA).
2. Registrar metricas iniciales durante un intervalo fijo de simulacion.
3. Guardar baseline numerico para comparar.

Metricas baseline:

- Desviacion promedio de ratio por recurso (`abs(ratio_actual - ratio_objetivo)`).
- Tiempo ocioso de colas de construccion y reclutamiento.
- Tropas creadas por hora por tipo.
- Cantidad de sub-objetivos de almacenamiento disparados.

Criterio de cierre Fase 0:

- Baseline documentado en valores concretos para usar como referencia.

## Fase 1: unificar entradas de recursos con ratio real

Problema actual:

- Algunas entradas entran 50/50 fijo aunque el ratio activo sea distinto.

Implementacion:

1. Centralizar regla de reparto de entrada de recursos usando `budgetRatio` vigente.
2. Aplicar la misma regla en:
   - Botin al regresar tropas.
   - Comercio entrante.
   - Inicializacion de recursos IA.
3. Garantizar sincronizacion correcta de `resources.current = budget.econ + budget.mil`.

Ejemplo esperado:

- Ratio 0.80/0.20 y entrada de 1000 madera -> 800 econ y 200 mil.

Criterio de cierre Fase 1:

- Ningun flujo sigue partiendo 50/50 si existe `budgetRatio` activo.

## Fase 2: rebalanceo inmediato al cambiar ratio

Problema actual:

- Al cambiar ratio, el stock viejo queda desalineado y solo se corrige gradualmente con produccion futura.

Implementacion:

1. Detectar transicion de ratio (por ejemplo, desarrollo 1.0/0.0 a normal 0.35/0.65).
2. Repartir de inmediato el stock actual entre `budget.econ` y `budget.mil` segun el nuevo ratio.
3. Mantener invariantes:
   - No crear ni perder recursos.
   - Respetar limites de capacidad.
   - Evitar valores negativos.

Ejemplo esperado:

- Stock total hierro 10000 con ratio nuevo 0.35/0.65 -> 3500 econ y 6500 mil instantaneamente.

Criterio de cierre Fase 2:

- Tras un cambio de ratio, la desviacion inicial baja inmediatamente a casi cero (salvo redondeo).

## Fase 3: corregir bloqueos falsos por capacidad vs budget

Problema actual:

- Si `mil=0` temporal, algunas evaluaciones lo tratan como falta de almacenamiento y generan sub-objetivos incorrectos.

Implementacion:

1. Separar dos causas de bloqueo:
   - Falta de recursos disponibles en budget actual.
   - Falta real de capacidad de almacenamiento.
2. En caso de budget temporal bajo, crear espera/ahorro correcto en vez de subir almacenes.
3. Mantener sub-objetivo de almacenamiento solo cuando el costo realmente excede capacidad viable.

Ejemplo esperado:

- Costo militar 600 hierro con `mil=0` no debe disparar `UPGRADE_WAREHOUSE`; debe esperar acumulacion/reasignacion.

Criterio de cierre Fase 3:

- Sub-objetivos de almacenamiento falsos por ratio temporal = 0 en pruebas.

## Fase 4: alinear reclutamiento con scope de objetivo

Problema actual:

- Objetivos `per_village` pueden cumplirse por tropas de otra aldea (conteo global), frenando reclutamiento local.

Implementacion:

1. Definir regla de conteo por scope:
   - `per_village` -> solo aldea actual.
   - `global` -> todas las aldeas del jugador.
2. Aplicar la misma regla en:
   - Verificacion de paso completado.
   - Calculo de necesidad al reclutar.
3. Mantener excepciones de unidades especiales solo donde aplique.

Ejemplo esperado:

- Meta `per_village` 300 lanceros en aldea A: aunque aldea B tenga 1000, A sigue hasta llegar a 300 propios.

Criterio de cierre Fase 4:

- No hay falsos positivos de objetivo completado por tropas de otra aldea en objetivos locales.

## Fase 5: batch de reclutamiento adaptativo

Problema actual:

- Batch fijo de 25% (min 5) puede ser demasiado conservador en momentos de abundancia.

Implementacion:

1. Definir batch dinamico con limites por fase:
   - Early: lotes pequenos para no ahogar economia.
   - Mid/Late: lotes mayores para maximizar throughput.
2. Factores para ajustar batch:
   - Recursos militares disponibles.
   - Tiempo de cola/ocupacion del edificio.
   - Distancia al objetivo de tropas.
3. Mantener guardas para no gastar por encima del budget militar.

Ejemplo esperado:

- En early puede reclutar 8-15 por tanda; en late subir a 40-120 si hay holgura.

Criterio de cierre Fase 5:

- Aumenta tropas/hora sin degradar estabilidad del budget economico.

## Fase 6: telemetria de control y criterio de exito

Implementacion:

1. Exponer indicadores por ciclo en logs/telemetria.
2. Comparar baseline vs estado final en mismo escenario.

KPI objetivo (meta minima):

- Desviacion ratio promedio por recurso < 0.02.
- Sub-objetivos de almacenamiento falsos = 0.
- Incremento de tropas/hora >= 15% en escenario de media escala.
- Sin aumento de rechazos por recursos insuficientes en construccion economica.

## Orden de ejecucion recomendado (minimo riesgo)

1. Fase 0
2. Fase 1
3. Fase 2
4. Fase 3
5. Fase 4
6. Fase 5
7. Fase 6

Razon:

- Primero consistencia de presupuesto, despues precision de decision, luego optimizacion de velocidad.

## Riesgos y mitigacion

- Riesgo: sobreajuste del batch y picos de gasto militar.
  - Mitigacion: limites superior/inferior y fallback conservador.
- Riesgo: desbalance por redondeo en rebalanceos repetidos.
  - Mitigacion: normalizacion por recurso al final de cada rebalanceo.
- Riesgo: cambios de scope rompen objetivos existentes.
  - Mitigacion: pruebas con metas `per_village` y `global` en paralelo.

## Plan de validacion funcional (simple)

Escenario A (1 aldea IA):

- Cambiar ratio varias veces y comprobar reparto inmediato.
- Ejecutar construccion y reclutamiento simultaneo.

Escenario B (3 aldeas IA):

- Objetivos mixtos `per_village` y `global`.
- Comprobar que reclutamiento local no se frena por unidades de otras aldeas.

Escenario C (stress):

- Entradas frecuentes de botin/comercio y cambios de ratio seguidos.
- Verificar ausencia de sub-objetivos de almacenamiento falsos.

## Ejecucion real de Fase 0 (completada)

Comando ejecutado:

- `npm run ai:baseline:phase0`

Artefactos generados:

- `docs/ai-phase0-baseline-results.md`
- `docs/ai-phase0-baseline-results.json`

Resumen de baseline obtenido:

- Escenario A (1 IA): ratio deviation avg `0.64521`, idle construction `0.85556`, idle recruitment `1.0`, tropas/h `0`.
- Escenario B (3 IA): ratio deviation avg `0.62347`, idle construction `0.90278`, idle recruitment `1.0`, tropas/h `0`.
- Escenario C (3 IA + stress ratio): ratio deviation avg `0.64448`, idle construction `0.88935`, idle recruitment `1.0`, ratio shifts `8`, tropas/h `0`.

Lectura inicial de estos datos:

- La desviacion de ratio es alta (base clara para mejorar en Fase 1 y Fase 2).
- Reclutamiento no despega en este baseline corto porque la IA esta en fase temprana de desarrollo.
- Ya existe una referencia numerica consistente para medir mejora despues de implementar fases 1-6.

## Ejecucion real de Fase 1 (completada)

Cambios aplicados:

- Se centralizo la logica de reparto de ingresos en `src/features/game/state/worker/budget.js`.
- Botin de retorno ahora entra por ratio real (`budgetRatio`) en `src/features/game/state/GameWorker.js`.
- Comercio entrante ahora entra por ratio real (`budgetRatio`) en `src/features/game/state/GameWorker.js`.
- Inicializacion de aldeas IA ya no fuerza 50/50 en `src/features/game/engine/GameStateFactory.js`.
- Durante `init` del worker se normaliza el presupuesto IA con ratio de personalidad en `src/features/game/state/GameWorker.js`.
- En fundacion de nueva aldea IA se inicializa presupuesto con ratio activo en `src/features/game/state/GameWorker.js`.

Validacion ejecutada:

- Build OK: `npm run build`.

## Ejecucion real de Fase 2 (completada)

Cambios aplicados:

- Se agrego `rebalanceVillageBudgetToRatio(...)` en `src/features/game/state/worker/budget.js`.
- `initializeAIVillageBudget(...)` ahora reutiliza el mismo rebalanceo para mantener consistencia.
- Cuando cambia el modo estrategico (desarrollo o retorno a ratio por defecto), se rebalancea en el acto en `src/features/game/ai/controller/economic.js`.

Validacion ejecutada:

- Smoke test de invariantes (conservacion de total y reparto correcto por ratio) via Node.
- Build OK: `npm run build`.

## Ejecucion real de Fase 3 (completada)

Cambios aplicados:

- Se reemplazo la verificacion de capacidad "efectiva por ratio" por capacidad real de almacenamiento en `src/features/game/ai/AIGoalManager.js`.
- Ahora la decision distingue dos casos:
  - Bloqueo real de capacidad (`cost > resource.capacity`) -> sub-objetivo de `warehouse/granary`.
  - Falta de budget/recursos actuales con capacidad suficiente -> `SAVE_RESOURCES`.
- Se reutilizo un helper de budget para evitar duplicacion y mantener coherencia en chequeos de ahorro.

Impacto esperado:

- Evita crear upgrades de storage falsos cuando el ratio militar/economico temporal deja un budget en 0.

Validacion ejecutada:

- Build OK: `npm run build`.
- Simulacion de smoke general OK: `npm run ai:baseline:phase0`.

## Ejecucion real de Fase 4 (completada)

Cambios aplicados:

- Se alineo el conteo de tropas al `scope` del objetivo en `src/features/game/ai/goal-manager/steps.js`.
- Reglas ahora aplicadas:
  - `per_village` y `village_index:*` -> conteo solo de la aldea actual.
  - `global` -> conteo de todas las aldeas del jugador IA.
- Se propago `goalScope` desde `AIGoalManager` hacia `isStepCompleted(...)`.
- Se ajusto reclutamiento para usar el mismo scope en `src/features/game/ai/action-executor/recruitment.js`.
- `AIActionExecutor` ahora pasa el objetivo activo al reclutamiento para que respete el scope del goal.

Impacto esperado:

- Evita falsos "objetivo cumplido" en metas `per_village` por tropas producidas en otra aldea.

Validacion ejecutada:

- Build OK: `npm run build`.
- Simulacion de smoke general OK: `npm run ai:baseline:phase0`.

## Ejecucion real de Fase 5 (completada)

Cambios aplicados:

- Se reemplazo batch fijo (25% + min 5) por batch adaptativo en `src/features/game/ai/action-executor/recruitment.js`.
- El nuevo batch usa:
  - fase de aldea (`early`, `mid`, `late`) segun promedio de campos y poblacion,
  - `gameSpeed` para escalar min/max de lote,
  - urgencia del objetivo,
  - asequibilidad real del budget militar,
  - presion de cola por edificio de entrenamiento.
- Para unidades de expansion (`settler`, `chief`) se fuerza reclutamiento conservador de 1 en 1.
- Se paso `gameSpeed` desde `src/features/game/ai/AIActionExecutor.js` al modulo de reclutamiento.

Impacto esperado:

- Mayor throughput en mid/late sin perder control de gasto en early.
- Menor riesgo de saturar colas por lotes sobredimensionados.

Validacion ejecutada:

- Build OK: `npm run build`.
- Simulacion de smoke general OK: `npm run ai:baseline:phase0`.

## Ejecucion real de Fase 6 (telemetria y comparativa)

Acciones ejecutadas:

- Telemetria de ratio, colas y throughput registrada en `docs/ai-phase0-baseline-results.json`.
- Comparativa baseline inicial vs estado actual documentada en `docs/ai-phase6-kpi-comparison.md`.

Resultado de validacion:

- KPI de desviacion de ratio cumplido (objetivo < 0.02, actual 0.0 en A/B/C).
- KPI de storage falso se mantiene en 0.
- KPI de throughput militar (+15%) no queda validado con este benchmark porque baseline y estado actual permanecen en 0 tropas/h.

Estado de Fase 6:

- Parcial: telemetria y comparacion completadas; cierre total de KPI militar pendiente de benchmark dedicado.

## Checklist de avance de implementacion (la usare para ejecutar)

Estado global:

- [x] Fase 0 completada (baseline medido)
- [x] Fase 1 completada (entradas unificadas)
- [x] Fase 2 completada (rebalanceo inmediato)
- [x] Fase 3 completada (bloqueos falsos corregidos)
- [x] Fase 4 completada (scope correcto)
- [x] Fase 5 completada (batch adaptativo)
- [ ] Fase 6 completada (KPI final validado)

Checklist operativo detallado:

- [x] Definir y guardar baseline numerico (A, B, C)
- [x] Implementar reparto por ratio en botin retorno
- [x] Implementar reparto por ratio en comercio entrante
- [x] Implementar inicializacion con ratio (no 50/50 fijo)
- [x] Implementar rebalanceo al cambiar `budgetRatio`
- [x] Verificar invariantes de presupuesto tras rebalanceo
- [x] Separar causa "falta de budget" vs "falta de capacidad"
- [x] Ajustar sub-objetivos para evitar upgrades de storage falsos
- [x] Aplicar conteo por scope en verificacion de pasos
- [x] Aplicar conteo por scope en calculo de reclutamiento
- [x] Definir formula de batch adaptativo con limites
- [x] Registrar telemetria de desviacion ratio y throughput
- [x] Comparar baseline vs final y documentar mejora

## Definicion de terminado (Done)

Se considera terminado cuando:

- Todas las fases esten marcadas.
- Los KPI minimos se cumplan en los escenarios A, B y C.
- No aparezcan regresiones criticas en construccion/reclutamiento.
