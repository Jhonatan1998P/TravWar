# Plan Maestro de Integracion: `reactive.js` + `german-phase-engine.js`

## Objetivo General

Disenar e implementar una arquitectura de combate reactivo y macroeconomico que permita que las IAs:

1. Defiendan bien cuando conviene defender.
2. Eviten perdidas inutiles cuando conviene preservar tropas.
3. Contraataquen con criterio cuando existe una ventana tactica real.
4. Mantengan coherencia con el motor de fases economico-militar sin generar ordenes contradictorias.

Este plan prioriza que `src/features/game/ai/controller/reactive.js` y `src/features/game/ai/controller/german-phase-engine.js` trabajen en conjunto sin estorbarse.

---

## Alcance y Principios de Diseno

### Alcance

- Integracion total entre reaccion tactica y macrogestion por fases.
- Soporte para perfiles ofensivos, defensivos e hibridos.
- Compatibilidad con ataques de IA y jugadores humanos.
- Soporte para raids, ataques estandar, asedio y conquista.

### Principios de diseno

- Separacion de responsabilidades:
  - `reactive.js`: decide respuestas tacticas inmediatas.
  - `german-phase-engine.js`: decide prioridades macro por fases.
  - `AIController.js`: arbitra, sincroniza y evita conflictos.
- Determinismo: la respuesta debe ser explicable por reglas y scores.
- Seguridad operativa: no emitir comandos incompatibles en la misma ventana de tiempo.
- Adaptabilidad: la postura no es fija solo por raza; debe ajustarse por contexto.
- Observabilidad: toda decision importante debe quedar en telemetria/log.

---

## Estado Actual (Diagnostico)

### Fortalezas existentes

- `german-phase-engine.js` ya gestiona fases, prioridades, subgoals y reclutamiento de emergencia inicial.
- `reactive.js` ya tiene base de `dodge`, `reinforcements`, `hold` y cierta represalia.
- `AIController.js` ya enruta eventos reactivos y ciclo de decision.

### Problemas actuales

- Falta un contrato compartido de amenaza/estado tactico por aldea.
- `reactive.js` y macrofases pueden actuar sin conocimiento mutuo.
- Falta un arbitraje central formal para resolver conflictos de ordenes.
- El dodge no esta suficientemente orientado por rol ofensivo/defensivo.
- El contraataque necesita filtros mas estrictos para evitar suicidios tacticos.

---

## Arquitectura Objetivo

### Capa 1: Motor Reactivo Tactico (`reactive.js`)

Responsable de:

- Detectar amenaza inminente y clasificarla.
- Evaluar poder atacante vs defensa local/imperial.
- Elegir respuesta tactica: `hold`, `reinforce`, `partial_dodge`, `full_dodge`, `counterattack`, `counterpressure`.
- Publicar estado tactico compartido con TTL.

### Capa 2: Motor Macrofases (`german-phase-engine.js`)

Responsable de:

- Continuidad de progreso economico/militar por fase.
- Ajustes temporales de prioridad segun amenaza compartida.
- Gestion de emergencia macro sin invadir decisiones de movimientos tacticos.

### Capa 3: Orquestador/Arbitro (`AIController.js`)

Responsable de:

- Mantener `villageCombatState` por aldea.
- Resolver prioridades entre capas.
- Aplicar locks/cooldowns para evitar spam y contradicciones.
- Consolidar telemetria final de decisiones.

---

## Contrato Compartido: `villageCombatState`

Cada aldea tendra un estado tactico compartido con estructura minima:

- `villageId`
- `threatLevel`: `none | low | medium | high | critical`
- `threatType`: `espionage | raid | attack | siege | conquest | mixed`
- `posture`: `offensive | defensive | hybrid`
- `preferredResponse`: `hold | reinforce | hold_with_reinforcements | partial_dodge | full_dodge | counterattack | counterpressure`
- `attackPowerEstimate`
- `localDefenseEstimate`
- `imperialDefenseEstimate`
- `canHoldLocally`
- `canHoldWithReinforcements`
- `shouldPreserveOffense`
- `shouldCounterattack`
- `shouldPauseEconomicConstruction`
- `shouldBoostEmergencyRecruitment`
- `counterWindowOpen`
- `counterWindowExpiresAt`
- `expiresAt`
- `sourceMovementIds`
- `lastDecisionReason`

Reglas:

- TTL corto (ej. 30-120s segun criticidad).
- Actualizacion incremental por nuevos movimientos.
- Expiracion limpia al terminar amenaza.

---

## Modelo de Postura de Combate

### Postura base

- `offensive`: germanos, hunos, arquetipo rusher, composicion ofensiva dominante.
- `defensive`: turtle, composicion defensiva dominante.
- `hybrid`: boomer, romanos no-rusher, composicion mixta.

### Ajuste dinamico

La postura final se corrige por:

- Composicion real de tropas en la aldea.
- Fase macro actual.
- Tipo de amenaza.
- ETA del ataque.
- Refuerzos disponibles y tiempo de llegada.
- Valor estrategico de la aldea.

---

## Taxonomia de Amenazas

- `espionage`
- `light_raid`
- `standard_attack`
- `siege_attack`
- `conquest_attack`
- `multi_wave_attack`

Clasificacion minima recomendada:

- Si hay unidades de catapulta/ariete -> al menos `siege_attack`.
- Si hay unidades de conquista/chief/settler en contexto de conquista -> `conquest_attack`.
- Multiples movimientos contra misma aldea en ventana corta -> `multi_wave_attack`.

---

## Matriz de Decision Tactica

### IA ofensiva

#### `light_raid`

- Mantener `hold` si costo de reaccion > perdida esperada.
- `partial_dodge` si hay riesgo de exponer stack ofensivo valioso.
- Evitar `swarm` innecesario.

#### `standard_attack`

- `hold` si defensa local gana con margen.
- `partial_dodge/full_dodge` si perderia fuerte y refuerzos no alcanzan.
- `counterpressure/counterattack` solo con ventana valida y defensa minima preservada.

#### `siege_attack` / `conquest_attack`

- Prioridad: preservar ofensiva + activos estrategicos.
- `swarm` solo si probabilidad real de sostener defensa.
- Si no hay opcion, `full_dodge` y abrir `counterWindow`.

### IA defensiva

#### `light_raid`

- `hold` por defecto.
- Evitar microcostes innecesarios.

#### `standard_attack`

- `hold` si local alcanza.
- `hold_with_reinforcements` si imperial alcanza.
- `partial_dodge/full_dodge` solo en derrota clara.

#### `siege_attack` / `conquest_attack`

- Priorizar `swarm_defense`.
- Evacuar solo si defensa total proyectada es insuficiente.

### IA hibrida

Resolver con score:

- `defenseScore`
- `preservationScore`
- `counterScore`

Elegir respuesta de mayor score con restricciones de seguridad.

---

## Dodge Inteligente por Rol

### `partial_dodge` ofensivo

Orden de salida sugerido:

1. ofensiva infanteria
2. ofensiva caballeria
3. asedio propio
4. scouts
5. settlers/chief

Mantener en aldea:

- guarnicion minima
- tropas defensivas si aportan hold parcial

### `partial_dodge` defensivo

Sacar solo activos de alto valor no defensivo:

- settlers/chief
- scouts no criticos
- ofensivas que no aportan hold

Mantener:

- bloque defensivo local
- refuerzos utiles

### `full_dodge`

Permitir solo si:

- derrota clara incluso con refuerzos,
- perdida esperada alta,
- no compromete objetivo estrategico mayor.

---

## Contraataque Inteligente

### Tipos

- `counterpressure`: castigo limitado y seguro.
- `counterattack`: ataque directo con oportunidad real.
- `punitive_siege`: solo en superioridad clara.

### Restricciones obligatorias

- No romper defensa minima residual.
- No actuar si amenaza critica sigue activa.
- Requerir objetivo identificado y vulnerable.
- Respetar cooldown de represalia.

### Ventana de contraataque (`counterWindow`)

- Se abre tras evasion/defensa exitosa en escenarios validos.
- TTL corto.
- Al expirar, se cancela prioridad de represalia.

---

## Integracion con `german-phase-engine.js` (sin interferencia)

`german-phase-engine.js` debe leer `villageCombatState` al inicio del ciclo.

### Politica por nivel de amenaza

#### `low`

- flujo macro normal.

#### `medium`

- mantener fase, pero con preferencia leve a desbloqueo militar.
- evitar gastar ultimo slot en eco puro si hay riesgo.

#### `high`

- reservar slot para militar/resiliencia si aplica.
- habilitar reclutamiento de emergencia temporal.
- reducir acciones macro no criticas.

#### `critical`

- modo crisis temporal:
  - priorizar defensa estructural y reclutamiento emergencia,
  - pausar temporalmente acciones macro no esenciales,
  - nunca emitir dodge desde macro (eso queda en `reactive.js`).

### Regla de frontera entre motores

- `reactive.js` decide movimientos tacticos.
- `german-phase-engine.js` solo reordena macro.
- Ambos se coordinan via estado compartido + arbitraje.

---

## Arbitraje Central en `AIController.js`

### Prioridades de ejecucion

1. `reactive_critical`
2. `reactive_high`
3. `macro_emergency`
4. `macro_normal`
5. `reactive_low`

### Locks y cooldowns

- `movementLockByVillage`
- `reactionCooldownByMovement`
- `counterattackCooldownByVillage`
- `constructionEmergencyLockByVillage`

Reglas:

- Si hay dodge programado, macro no debe emitir movimiento incompatible.
- Si hay lock de emergencia, no alternar ordenes opuestas entre ticks.
- Evitar spam de refuerzos y contraataques duplicados.

---

## Evaluacion de Poder y Probabilidad

El evaluador tactico debe considerar:

- poder atacante real por composicion,
- mejoras de herreria,
- muralla,
- defensa local,
- defensa imperial alcanzable por ETA,
- severidad de perdidas esperadas,
- multi-oleada y simultaneidad.

Salida minima:

- `projectedLocalOutcome`
- `projectedEmpireOutcome`
- `projectedLossSeverity`
- `survivalProbability`

---

## Valor Estrategico de Aldea

Asignar `strategicValueScore` por aldea usando:

- si es capital/core,
- presencia de infra clave (academy/workshop/palace),
- presencia de settlers/chief,
- stack ofensivo principal,
- posicion fronteriza,
- rol productivo.

Impacto:

- aldea de alto valor: mayor umbral para abandonar defensa,
- aldea de bajo valor: mas permisiva con preservacion de ejercito,
- aldea con stack ofensivo: priorizar preservar capacidad ofensiva.

---

## Estados Tacticos Persistentes de Corta Duracion

- `underRaidPressure`
- `underSiegePressure`
- `counterWindowOpen`
- `preserveOffenseMode`
- `empireDefenseMode`

Estos estados modifican temporalmente la toma de decisiones macro y reactiva.

---

## Telemetria y Observabilidad

### Log por decision reactiva

- amenaza detectada,
- postura final,
- estimaciones de combate,
- respuesta elegida,
- razon de descarte de alternativas,
- resultado final.

### KPIs obligatorios

- tasa de defensas exitosas,
- tasa de evasiones exitosas,
- perdidas ofensivas evitadas,
- contraataques lanzados,
- contraataques rentables,
- aldeas perdidas por decision,
- conflictos evitados por arbitraje,
- ciclos macro interrumpidos por amenaza.

---

## Implementacion por Fases (Roadmap Tecnico)

## Fase 1 - Infraestructura compartida

1. Crear estructura `villageCombatState` en `AIController`.
2. Helpers de lectura/escritura/expiracion.
3. Agregar locks/cooldowns base por aldea/movimiento.

Entregable:

- Estado tactico persistente funcionando sin cambiar aun la logica principal.

## Fase 2 - Refactor del motor reactivo

1. Extraer clasificacion de amenazas.
2. Extraer resolucion de postura.
3. Extraer evaluador de poder local/imperial.
4. Crear `evaluateThreatAndChooseResponse`.
5. Hacer que `handleAttackReact` consuma esa salida.

Entregable:

- Decision reactiva centralizada y deterministicamente reproducible.

## Fase 3 - Dodge inteligente

1. Clasificar tropas por rol y valor.
2. Implementar `partial_dodge` por postura.
3. Mantener guarnicion minima configurable.
4. Evitar dodge total salvo condiciones estrictas.

Entregable:

- Preservacion de tropas ofensivas sin colapsar defensa cuando no corresponde.

## Fase 4 - Contraataque robusto

1. Crear logica de `counterWindow`.
2. Aplicar filtros duros para elegibilidad.
3. Limitar fuerza comprometida por seguridad.
4. Integrar cooldown de represalia.

Entregable:

- Contraataque util, no impulsivo.

## Fase 5 - Integracion con macrofases germanas

1. Leer estado tactico en `runGermanEconomicPhaseCycle`.
2. Activar modo `macro_threat_override` segun nivel.
3. Ajustar prioridades macro temporalmente (sin romper fases).
4. Extender emergencia de reclutamiento para fases 2-5 por senal compartida.

Entregable:

- `reactive.js` y `german-phase-engine.js` acoplados por contrato, sin interferencia.

## Fase 6 - Arbitraje final y estabilidad

1. Aplicar prioridad de capas en `AIController`.
2. Rechazar/posponer comandos incompatibles.
3. Endurecer expiracion de locks y estados.

Entregable:

- Cero ordenes contradictorias en la misma ventana tactica.

## Fase 7 - Validacion, ajustes y hardening

1. Escenarios de prueba ofensivos/defensivos/hibridos.
2. Escenarios de asedio/conquista/multi-wave.
3. Verificar no regresion de macrofases sin amenaza.
4. Afinar umbrales usando KPIs.

Entregable:

- Sistema estable y calibrado con evidencia.

---

## Escenarios de Prueba de Aceptacion

### Ofensiva (germanos/hunos/rusher)

- Ataque medio: preservar stack ofensivo + reaccion coherente.
- Asedio: evitar suicidio defensivo, abrir ventana de castigo.
- Raid menor: no sobrerreaccionar.

### Defensiva (turtle/aldea defensiva)

- Ataque medio: hold o hold con refuerzos.
- Asedio: swarm si hay opcion real.
- Sin opcion: evacuacion controlada.

### Hibrida (romanos/boomer)

- Contextual segun score de defensa/preservacion/contraataque.

### Compatibilidad macro

- Sin amenaza: fases siguen igual.
- Amenaza media/alta: ajustes temporales y retorno automatico al flujo base.

---

## Riesgos y Mitigaciones

- Riesgo: sobreajuste por raza.
  - Mitigacion: postura dinamica por contexto.
- Riesgo: spam de comandos.
  - Mitigacion: locks + cooldowns + arbitraje.
- Riesgo: macro bloqueada por amenaza leve.
  - Mitigacion: politicas graduadas por threat level.
- Riesgo: contraataques suicidas.
  - Mitigacion: filtros de elegibilidad estrictos y defensa minima.

---

## Definicion de Hecho (Definition of Done)

Se considera completado cuando:

1. `reactive.js` decide tactica con evaluador unico y postura dinamica.
2. `german-phase-engine.js` consume estado de amenaza y ajusta macro temporalmente.
3. `AIController.js` arbitra sin contradicciones de comandos.
4. Dodge y contraataque son inteligentes y medibles.
5. KPIs muestran mejora frente al comportamiento previo.
6. No hay regresiones en flujo de fases sin amenaza.

---

## Checklist de Avance de Implementacion (OpenCode)

Estado actual: Fase 7 completada. Integracion validada y endurecida.

- [x] Fase 1 completada: estructura `villageCombatState` + TTL + helpers.
- [x] Fase 1 completada: locks y cooldowns base en `AIController.js`.
- [x] Fase 2 completada: clasificador de amenazas central en `reactive.js`.
- [x] Fase 2 completada: resolvedor de postura dinamica por aldea.
- [x] Fase 2 completada: evaluador local/imperial de defensa.
- [x] Fase 2 completada: funcion unificada `evaluateThreatAndChooseResponse`.
- [x] Fase 3 completada: `partial_dodge` por rol y por postura.
- [x] Fase 3 completada: guarnicion minima configurable.
- [x] Fase 3 completada: restricciones de `full_dodge` activas.
- [x] Fase 4 completada: `counterWindow` implementada.
- [x] Fase 4 completada: filtros anti-suicidio de contraataque.
- [x] Fase 4 completada: cooldown de represalia funcional.
- [x] Fase 5 completada: lectura de amenaza en `german-phase-engine.js`.
- [x] Fase 5 completada: `macro_threat_override` por niveles.
- [x] Fase 5 completada: emergencia extendida a fases 2-5.
- [x] Fase 6 completada: arbitraje central de prioridad de comandos.
- [x] Fase 6 completada: bloqueo de comandos incompatibles.
- [x] Fase 7 completada: pruebas de ofensiva/defensiva/hibrida.
- [x] Fase 7 completada: pruebas de asedio/conquista/multi-wave.
- [x] Fase 7 completada: verificacion de no regresion en macrofases.
- [x] Fase 7 completada: ajustes por KPIs y logs.

### Registro de progreso operativo

- [x] Inicio de implementacion confirmado.
- [x] Fase activa actual identificada.
- [x] Entregable de fase documentado.
- [x] Riesgos detectados y mitigados en fase activa.
- [x] Validacion de fase aprobada antes de avanzar.
