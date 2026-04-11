# Plan completo: Plantilla por fases para IA Germana (Normal, Dificil, Pesadilla)

## Responsable y compromiso de ejecucion

- Responsable de ejecucion: este agente (OpenCode).
- Compromiso: yo ejecutare este plan de punta a punta, incluyendo migracion y limpieza legacy total.
- Regla de oro: no se deja logica vieja activa en paralelo con el motor nuevo.

## Objetivo

Disenar e implementar una plantilla macro por fases para IA Germana que:

- construya economia y militar de forma precisa,
- transicione de manera estrategica y reproducible,
- funcione bien en velocidades extremas (incluyendo 5000x),
- elimine por completo residuos legacy que puedan romper el nuevo sistema.

## Alcance

Incluye:

- Plantilla de fases por dificultad (Normal, Dificil, Pesadilla).
- Estado persistente por aldea para fase activa y transiciones.
- Prioridades de construccion y reclutamiento por fase.
- Ratio eco/mil por fase con rebalanceo inmediato.
- Fallback anti-idle para evitar colas muertas.
- Plan de validacion por escenarios y metricas de exito.
- Eliminacion total de rutas legacy de decision macro.

No incluye:

- Rebalance global de costos de unidades/edificios.
- Cambios de UI no necesarios para logs/telemetria.

## Problema actual (diagnostico sintetico)

- La IA puede sentirse tosca en construccion, sobre todo a alta velocidad.
- El flujo macro no siempre encadena bien eco -> militar.
- Existen riesgos de comportamiento mixto cuando conviven reglas nuevas y legacy.

## Estrategia tecnica (enfoque)

Se implementara un motor de decision macro por capas:

1. Capa macro por fases (source of truth)
- Define que construir/reclutar en cada etapa.
- Define cuando cambiar de fase por estado real, no por tiempo fijo.

2. Capa de rol y prioridad
- Mantiene prioridades de construccion/reclutamiento por aldea y fase.
- Resuelve conflictos con una lista ordenada + fallback.

3. Capa reactiva/event-driven
- Dispara reevaluacion cuando se libera cola, se completa prerequisito o cambia contexto critico.

Regla critica:

- Solo una ruta macro activa al final: motor de fases. Sin doble cerebro.

## Plantilla concreta por fases (IA Germana)

Notas:

- Las condiciones de salida usan estado del juego (niveles, poblacion, actividad de cola).
- Los valores son iniciales y se calibraran con benchmark.

### Fase 1 - Arranque economico

Objetivo:

- Asegurar base de recursos y capacidad minima sin cuellos.

Construccion (prioridad):

1) campos de recursos rezagados,
2) warehouse/granary a nivel minimo operativo,
3) mainBuilding para acelerar upgrades.

Reclutamiento:

- Minimo o nulo (solo si hay defensa urgente).

Ratios por dificultad:

- Normal: eco 0.90 / mil 0.10
- Dificil: eco 0.85 / mil 0.15
- Pesadilla: eco 0.80 / mil 0.20

Salida de fase (ejemplo base):

- promedio campos >= 4
- warehouse >= 5 y granary >= 5

### Fase 2 - Desbloqueo militar basico

Objetivo:

- Activar economia + primer ciclo militar estable.

Construccion (prioridad):

1) rallyPoint,
2) barracks,
3) prerequisitos de investigacion/produccion.

Reclutamiento:

- ofensiva basica + scouts minimos.

Ratios por dificultad:

- Normal: eco 0.78 / mil 0.22
- Dificil: eco 0.70 / mil 0.30
- Pesadilla: eco 0.65 / mil 0.35

Salida de fase:

- barracks activo
- uptime de cola militar >= 40%

### Fase 3 - Produccion mixta sostenida

Objetivo:

- Mantener crecimiento economico mientras sube el throughput militar.

Construccion (prioridad):

1) campos por equilibrio,
2) smithy,
3) mejoras de barracks y soporte.

Reclutamiento:

- batch adaptativo con control de cola y urgencia.

Ratios por dificultad:

- Normal: eco 0.65 / mil 0.35
- Dificil: eco 0.58 / mil 0.42
- Pesadilla: eco 0.50 / mil 0.50

Salida de fase:

- promedio campos >= 7
- objetivo minimo de ejercito base alcanzado

### Fase 4 - Presion militar y tech

Objetivo:

- Convertir ventaja economica en presion militar sostenida.

Construccion (prioridad):

1) stable/workshop segun prerequisitos,
2) smithy upgrades relevantes,
3) storage solo si bloqueo real.

Reclutamiento:

- ofensiva principal + scout support.

Ratios por dificultad:

- Normal: eco 0.55 / mil 0.45
- Dificil: eco 0.45 / mil 0.55
- Pesadilla: eco 0.35 / mil 0.65

Salida de fase:

- produccion militar sostenida con cola activa estable

### Fase 5 - Asedio + expansion

Objetivo:

- Mantener dominio militar y habilitar expansion controlada.

Construccion (prioridad):

1) academy + edificios de asedio,
2) soporte logistico,
3) prerequisitos de expansion.

Reclutamiento:

- ofensiva + asedio + expansion conservadora (settler/chief controlado).

Ratios por dificultad:

- Normal: eco 0.50 / mil 0.50
- Dificil: eco 0.40 / mil 0.60
- Pesadilla: eco 0.30 / mil 0.70

Salida de fase:

- condicion de dominancia o expansion cumplida

## Ejemplos ilustrativos de comportamiento esperado

Ejemplo A (inicio duro, 5000x)

- Estado: campos bajos, storage justo, sin barracks.
- Decision esperada: Fase 1 mantiene foco eco + storage minimo; no fuerza militar prematuro.

Ejemplo B (transicion correcta)

- Estado: campos promedio 4+, warehouse/granary listos.
- Decision esperada: salta a Fase 2 y desbloquea barracks/rallyPoint antes de masa militar.

Ejemplo C (presion militar real)

- Estado: ya en Fase 3/4, presupuesto militar disponible.
- Decision esperada: batch adaptativo aumenta ritmo sin saturar cola ni romper eco.

Ejemplo D (falso bloqueo evitado)

- Estado: presupuesto militar bajo temporalmente, capacidad real suficiente.
- Decision esperada: guardar recursos, no crear upgrade de storage falso.

## Plan de eliminacion legacy (obligatorio)

Objetivo:

- Cero comportamiento residual que compita con el motor por fases.

Acciones:

1) Identificar rutas legacy macro activas
- objetivos/arquetipos antiguos que dicten macro sin fase,
- reglas de presupuesto antiguas fuera del motor de fases,
- caminos duplicados de construccion/reclutamiento.

2) Hard cutover por flag de migracion
- activar fase-engine como ruta principal,
- legacy en modo sombra temporal solo para comparar,
- remover modo sombra tras validacion.

3) Borrado definitivo
- eliminar llamadas, imports y ramas legacy,
- limpiar constantes/config no usadas,
- asegurar que AIController use solo la nueva ruta macro.

4) Verificacion de limpieza
- grep sin referencias activas a flujo macro legacy,
- decision principal con una unica ruta.

Regla de seguridad:

- No dejar fallback al motor legacy en produccion.

## Orden de ejecucion (secuencia real)

1. Definir datos de fases German por dificultad.
2. Integrar estado de fase por aldea y transiciones.
3. Enrutar construccion por fase + fallback anti-idle.
4. Enrutar reclutamiento por fase y scope correcto.
5. Integrar ratios por fase con rebalanceo inmediato.
6. Ejecutar pruebas en 1x, 100x, 1000x, 5000x.
7. Hard cutover al motor de fases.
8. Eliminar logica legacy residual.
9. Benchmark final y calibracion de thresholds.

## Riesgos y mitigacion

Riesgo 1: sobre-enfoque militar en early
- Mitigacion: gates estrictos de salida Fase 1 y minimos de eco.

Riesgo 2: colas vacias por priorizacion rigida
- Mitigacion: fallback anti-idle por valor util mas alto.

Riesgo 3: mezcla de rutas vieja/nueva
- Mitigacion: hard cutover + limpieza completa + verificacion por grep.

Riesgo 4: sobrecosto a 5000x
- Mitigacion: reevaluacion por eventos + cooldown escalado por velocidad.

## Validacion y metricas (criterio de exito)

Construccion:

- idle de cola construccion < 20% en early-mid.
- sin bucles de espera inutil.

Economia:

- desviacion de ratio objetivo por fase < 0.05.
- tiempo con recursos topados sin gasto util < 10%.

Militar:

- uptime de cola militar creciente desde Fase 2.
- tropas/hora > baseline en benchmark militar dedicado.

Calidad estrategica:

- transiciones de fase consistentes en misma seed.
- sin decisiones contradictorias entre ciclos consecutivos.

Legacy:

- cero referencias activas a ruta macro legacy en decision principal.

## Checklist de progreso (yo la ejecutare)

Estado global:

- [ ] Definir tabla final de fases German (Normal/Dificil/Pesadilla).
- [ ] Implementar estado persistente de fase por aldea.
- [ ] Implementar transiciones de fase por condiciones de estado.
- [ ] Integrar prioridades de construccion por fase.
- [ ] Integrar prioridades de reclutamiento por fase.
- [ ] Integrar fallback anti-idle de construccion y reclutamiento.
- [ ] Integrar ratio eco/mil por fase con rebalanceo inmediato.
- [ ] Validar comportamiento en 1x/100x/1000x/5000x.
- [ ] Ejecutar hard cutover al nuevo motor.
- [ ] Eliminar toda logica macro legacy residual.
- [ ] Verificar limpieza total (sin referencias activas legacy).
- [ ] Ejecutar benchmark final y ajustar thresholds.
- [ ] Publicar reporte final de resultados.

Checklist operativo detallado:

- [ ] Crear matriz de objetivos por fase y dificultad.
- [ ] Definir condiciones de entrada/salida exactas por fase.
- [ ] Mapear prioridades de edificios por fase (orden y fallback).
- [ ] Mapear prioridades de unidades por fase (orden y limites).
- [ ] Conectar evaluador de fase al ciclo economico.
- [ ] Conectar evaluador de fase al ciclo militar/reclutamiento.
- [ ] Ajustar decisionInterval/cooldowns en alta velocidad.
- [ ] Instrumentar telemetria de fase (entrada, salida, tiempo en fase).
- [ ] Instrumentar telemetria de colas (idle, uptime, bloqueos).
- [ ] Instrumentar telemetria de economia (ratio, overflow, topes).
- [ ] Instrumentar telemetria militar (tropas/hora, cola, rechazos).
- [ ] Ejecutar regression de comportamiento previo critico.
- [ ] Desactivar por completo rutas legacy en runtime.
- [ ] Borrar codigo legacy y limpiar dependencias no usadas.
- [ ] Cerrar con comparativa baseline vs final.

## Definicion de Done

El plan se considera completado cuando:

- toda la checklist global esta en [x],
- el nuevo motor por fases es la unica ruta macro activa,
- no quedan residuos legacy de macro-decision,
- las metricas objetivo se cumplen en pruebas de dificultad y velocidad,
- existe reporte final con evidencias y resultados.
