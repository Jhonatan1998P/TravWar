# Plan Maestro: Motor de IA Egipcia Defensiva por Fases

## Responsable y compromiso de ejecucion

- Responsable de ejecucion: este agente (OpenCode).
- Compromiso: implementar este plan completo de punta a punta.
- Regla de oro: no dejar doble cerebro macro activo.
- Regla de integracion: el motor egipcio debe convivir con `reactive.js` y con el arbitraje de `AIController.js`, no competir contra ellos.

## Objetivo general

Disenar e implementar un motor de IA especifico para la tribu egipcia, orientado a su identidad de:
- economia fuerte,
- defensa local e imperial muy solida,
- crecimiento estable,
- expansion segura y gradual,
- presion ofensiva limitada y contextual, nunca impulsiva.

El resultado esperado es una IA egipcia que:
- no intente jugar como germana,
- priorice supervivencia, infraestructura y resiliencia,
- sostenga aldeas con buena defensa,
- expanda de forma segura,
- adapte su macro cuando `reactive.js` detecte amenazas.

## Doctrina estrategica de tribus

Este plan asume la siguiente doctrina base del juego:

- Galos: defensivos.
- Egipcios: defensivos.
- Germanos: ofensivos.
- Hunos: ofensivos.
- Romanos: versatiles.

Impacto de esta doctrina:
- El motor macro de cada raza debe reflejar su identidad.
- `reactive.js` puede corregir segun contexto, pero no debe negar por defecto la identidad macro de la raza.
- Egipcios deben inclinarse a preservar infraestructura, sostener defensa, acumular valor economico y expandir con seguridad.

## Justificacion tecnica para Egipto

Los datos del juego ya describen a Egipto como una tribu de:
- constructores y economistas,
- unidades baratas o eficientes,
- defensa solida,
- crecimiento sostenido.

Ademas, su roster refuerza esta identidad:
- `slave_militia_egypt`: unidad barata, flexible y util en early.
- `ash_warden_egypt`: infanteria defensiva fuerte.
- `anhur_guard_egypt`: caballeria defensiva fuerte.
- `resheph_chariot_egypt`: unidad ofensiva potente, pero mas cara y tardia.
- `ram_egypt` y `catapult_egypt`: asedio disponible, pero no debe ser prioridad temprana.
- `settler_egypt` y `nomarch_egypt`: expansion posible, pero con enfoque seguro.

Conclusiones para la IA:
- No debe correr a Fase militar ofensiva como germanos.
- Debe sostener eco alta durante mas tiempo.
- Debe priorizar muro, almacenamiento, throughput defensivo y red de refuerzos.
- Debe expandir siempre, pero con intensidad menor y condiciones de seguridad mas duras que germanos.

## Alcance

Incluye:
- motor propio `egyptian-phase-engine.js`,
- fases macro especificas para Egipto,
- ratios eco/mil por dificultad,
- prioridades de construccion y reclutamiento defensivo,
- expansion segura presente en todos los perfiles egipcios,
- integracion con `AIController.js`,
- integracion con `reactive.js` por `villageCombatState`,
- validacion con escenarios y KPIs.

No incluye por ahora:
- rediseño del motor militar global,
- rework completo del sistema de personalidad legacy,
- cambios UI,
- cambios a stats de unidades o edificios.

## Arquitectura objetivo

### Capa 1: Motor reactivo tactico

Archivo involucrado:
- `src/features/game/ai/controller/reactive.js`

Responsabilidad:
- detectar amenazas,
- clasificar peligro,
- elegir dodge, hold, swarm defensivo, refuerzos o preservacion,
- publicar `villageCombatState`.

Para Egipto:
- el reactivo debe favorecer `hold` y `hold_with_reinforcements` mas a menudo que en razas ofensivas,
- el dodge total debe ser mas raro,
- el valor de muro, defensa local y defensa imperial debe pesar mas.

### Capa 2: Motor macro egipcio

Archivo nuevo propuesto:
- `src/features/game/ai/controller/egyptian-phase-engine.js`

Responsabilidad:
- definir fase activa por aldea,
- fijar ratio eco/mil,
- decidir prioridades de construccion,
- decidir prioridades de reclutamiento,
- sostener expansion gradual,
- reaccionar a amenaza compartida sin emitir movimientos tacticos.

### Capa 3: Orquestador central

Archivo involucrado:
- `src/features/game/ai/AIController.js`

Responsabilidad:
- enrutar germanos al motor germano y egipcios al motor egipcio,
- pasar `villageCombatState`,
- mantener locks y arbitraje,
- impedir contradicciones entre macro y reactivo.

## Principios de diseno para Egipto

- Defensa primero, pero sin caer en pasividad absoluta.
- Economia como fuente de superioridad estructural.
- Expansion presente desde el diseno, pero con seguridad.
- Presion ofensiva solo cuando la base defensiva este resuelta.
- Respuesta de amenaza graduada, no binaria.
- Determinismo: cada decision de fase debe ser explicable.
- Reutilizacion de utilidades del motor germano cuando aporte valor.
- Evitar duplicacion innecesaria de helpers comunes.

## Integracion con el sistema actual

El nuevo motor debe compenetrarse con el sistema existente asi:

1. `AIController.js`
- Si `race === 'egyptians'`, usar `runEgyptianEconomicPhaseCycle`.
- Mantener el mismo patron que ya existe con germanos.
- Persistir `egyptianPhaseState` por aldea.

2. `reactive.js`
- Seguir usando `villageCombatState`.
- No permitir que el macro emita movimientos tacticos.
- Solo ajustar prioridades macro en funcion del threat level.

3. Arbitraje central
- Mantener el mismo esquema de prioridad de comandos.
- Mantener `constructionEmergencyLockByVillage`.
- Mantener filtros por amenaza.

4. Expansion
- El macro egipcio debe preparar expansion por fases.
- El disparo real de colonizacion debe integrarse de forma compatible con la infraestructura actual de `settle_new_village` o con una ruta equivalente no legacy.

## Diferencias clave con el motor germano

El motor egipcio no debe ser una copia cosmetica del germano.

Diferencias obligatorias:
- ratios eco/mil mas economicos en early y mid,
- salida a militar ofensiva mas tardia,
- prioridad alta a muro y almacenamiento,
- prioridad mas fuerte a defensa imperial,
- expansion mas segura y menos agresiva,
- asedio y conquista como fase tardia condicional, no identidad central.

## Contrato minimo del estado por aldea

Archivo nuevo sugerido:
- se puede modelar igual que el estado germano, pero con su propio namespace persistente.

Estructura minima:
- `activePhaseId`
- `startedAt`
- `lastEvaluationAt`
- `transitions`
- `phaseCycleProgress`
- `activeSubGoal`
- `subGoalHistory`
- `lastThreatOverrideLogAt`
- `lastIdleLogAt`
- `lastConstructionReserveLogAt`
- `expansionReadinessScore`
- `defenseReadinessScore`
- `storagePressureHistory`
- `lastSafeExpansionCheckAt`

## Motor de fases egipcio

## Fase 1 - Eco Fortificada

### Objetivo
Estabilizar economia, almacenamiento y velocidad de construccion, con defensa minima urgente.

### Filosofia
Egipto debe despegar economicamente antes de comprometerse en masa a reclutamiento.

### Construccion prioritaria
1. campos de recursos mas rezagados,
2. `warehouse`,
3. `granary`,
4. `mainBuilding`,
5. `cityWall` solo si hay amenaza temprana o frontera peligrosa.

### Reclutamiento prioritario
1. nada o minimo,
2. `slave_militia_egypt` si hay urgencia,
3. `ash_warden_egypt` solo si ya hay prerequisitos y amenaza real.

### Ratio eco/mil sugerido
- Normal: `econ 0.92 / mil 0.08`
- Dificil: `econ 0.88 / mil 0.12`
- Pesadilla: `econ 0.84 / mil 0.16`

### Condiciones de salida
- promedio de campos >= 4,
- `warehouse >= 6`,
- `granary >= 6`,
- `mainBuilding >= 5`,
- al menos una base defensiva minima si hay hostilidad cercana.

### Ejemplo practico
- Aldea inicial sin barracks, campos 2-3, almacen casi lleno.
- Decision esperada: subir campos, `warehouse`, `granary`, `mainBuilding`.
- Decision no permitida: correr directo a `stable`, `workshop` o grandes tandas ofensivas.

## Fase 2 - Nucleo Defensivo Temprano

### Objetivo
Desbloquear defensa estable y vision minima del entorno.

### Filosofia
Egipto empieza a militarizarse, pero para sostener, no para rushear.

### Construccion prioritaria
1. `rallyPoint`,
2. `barracks`,
3. `academy`,
4. `smithy`,
5. `cityWall`,
6. campos a promedio 5.

### Reclutamiento prioritario
1. `slave_militia_egypt` como volumen barato si hace falta,
2. `ash_warden_egypt` como columna principal,
3. `sopdu_explorer_egypt` como scouts minimos.

### Ratio eco/mil sugerido
- Normal: `econ 0.80 / mil 0.20`
- Dificil: `econ 0.74 / mil 0.26`
- Pesadilla: `econ 0.68 / mil 0.32`

### Condiciones de salida
- `barracks` activo,
- `cityWall >= 5`,
- uptime militar minima estable,
- minimo de defensa local util por poblacion o por aldea.

### Ejemplo practico
- Aldea con recursos estables, primer ataque enemigo detectado, poca defensa.
- Decision esperada: barracks, muro, infanteria defensiva, scouts basicos.
- Decision no permitida: meter catapultas o carros ofensivos demasiado pronto.

## Fase 3 - Defensa Imperial Sostenida

### Objetivo
Convertir la eco en una red real de defensa local e interaldea.

### Filosofia
El imperio egipcio debe poder resistir ataques medianos sin colapsar el progreso.

### Construccion prioritaria
1. campos a promedio 7,
2. `barracks` a throughput funcional,
3. `academy` y `smithy` a nivel operativo,
4. `cityWall` a nivel medio-alto,
5. `warehouse` y `granary` si hay presion real de capacidad,
6. `stable` para habilitar scouts y caballeria defensiva futura.

### Reclutamiento prioritario
1. `ash_warden_egypt`,
2. `sopdu_explorer_egypt`,
3. `anhur_guard_egypt` cuando el establo lo permita,
4. `slave_militia_egypt` solo como parche barato o masa ligera.

### Ratio eco/mil sugerido
- Normal: `econ 0.72 / mil 0.28`
- Dificil: `econ 0.64 / mil 0.36`
- Pesadilla: `econ 0.56 / mil 0.44`

### Condiciones de salida
- promedio de campos >= 7,
- defensa local e imperial suficientes para escenario medio,
- scouts operativos,
- cola defensiva sostenida,
- `cityWall` consolidado.

### Ejemplo practico
- Dos aldeas egipcias con ataques dispersos.
- Decision esperada: reforzar infanteria defensiva, subir muro, habilitar caballeria defensiva, mantener eco sana.
- Decision no permitida: saltar a asedio pesado sin haber asegurado red defensiva.

## Fase 4 - Resiliencia y Control Territorial

### Objetivo
Aumentar la robustez macro y la velocidad de respuesta del imperio.

### Filosofia
No se trata aun de dominar por choque ofensivo, sino por estructura superior.

### Construccion prioritaria
1. `cityWall` alto,
2. `stable` funcional,
3. `marketplace`,
4. `warehouse` y `granary` segun presion,
5. `mainBuilding` para throughput,
6. `smithy` para soporte de defensa,
7. `academy` para desbloqueos de mid game.

### Reclutamiento prioritario
1. `ash_warden_egypt`,
2. `anhur_guard_egypt`,
3. `sopdu_explorer_egypt`,
4. `khopesh_warrior_egypt` en proporcion pequena y controlada.

### Ratio eco/mil sugerido
- Normal: `econ 0.64 / mil 0.36`
- Dificil: `econ 0.56 / mil 0.44`
- Pesadilla: `econ 0.48 / mil 0.52`

### Condiciones de salida
- red defensiva madura,
- capacidad logistica estable,
- scouts y refuerzos efectivos,
- exceso de overflow economico reducido,
- readiness de expansion positiva.

### Ejemplo practico
- El jugador enemigo empieza a presionar con raids y ataques medianos.
- Decision esperada: mas caballeria defensiva, mejor mercado, mejor storage, mejores refuerzos, algo de ofensiva limitada.
- Decision no permitida: gastar el grueso del presupuesto en carros ofensivos y asedio antes de estar listos.

## Fase 5 - Expansion Segura y Dominio Defensivo

### Objetivo
Expandir de forma constante y segura sin romper la defensa central.

### Filosofia
Toda tribu debe expandirse. Egipto tambien, pero con filtros de seguridad mas estrictos.

### Construccion prioritaria
1. `embassy`,
2. `palace`,
3. `marketplace`,
4. `warehouse` y `granary`,
5. `cityWall`,
6. `academy` a nivel de unlock necesario,
7. `stable` y `barracks` para mantener defensa.

### Reclutamiento prioritario
1. defensa base continua,
2. `settler_egypt`,
3. `nomarch_egypt` solo cuando ya exista dominio y seguridad,
4. ofensiva limitada para castigo contextual,
5. `ram_egypt` o `catapult_egypt` solo si la fase realmente los justifica.

### Ratio eco/mil sugerido
- Normal: `econ 0.60 / mil 0.40`
- Dificil: `econ 0.52 / mil 0.48`
- Pesadilla: `econ 0.45 / mil 0.55`

### Regla de expansion obligatoria
La expansion debe estar presente en todos los perfiles egipcios, pero con intensidad defensiva.
- Siempre debe existir progreso hacia `palace`, `settlers` o readiness de colonizacion.
- No debe ejecutarse colonizacion si la aldea origen esta en amenaza `high` o `critical`.
- No debe romper la defensa minima residual del imperio.
- Debe priorizar ubicaciones con buena sostenibilidad y seguridad.

### Condiciones de salida
- colonizacion ejecutada o lista segura de colonizacion,
- defensa imperial mantenida,
- base economica estable,
- no dependencia de una sola aldea.

### Ejemplo practico
- Aldea core con `palace 10`, buena defensa, sin amenaza alta, 3 colonos disponibles.
- Decision esperada: lanzar colonizacion.
- Decision no permitida: enviar colonos cuando la aldea core esta bajo ventana de amenaza importante.

## Fase 6 - Hardening, Calibracion y Ajuste Fino

### Objetivo
Cerrar el sistema con evidencia, telemetria y thresholds afinados.

### Filosofia
No basta con que funcione una vez. Debe ser estable, medible y coherente con la identidad egipcia.

### Trabajo de esta fase
1. validar early, mid y late,
2. validar comportamiento bajo amenaza,
3. validar no regresion del arbitraje,
4. validar expansion segura,
5. ajustar umbrales de eco/mil,
6. ajustar gates de expansion,
7. ajustar peso defensivo de `reactive.js` para egipcios.

### KPIs obligatorios
- tasa de defensa exitosa,
- tasa de hold con refuerzos exitoso,
- uptime de cola defensiva,
- tiempo con storage topado,
- tiempo en overflow no gastado,
- aldeas salvadas por red imperial,
- aldeas perdidas por infra insuficiente,
- expansiones lanzadas,
- expansiones seguras completadas,
- conflictos evitados por arbitraje,
- ciclos macro interrumpidos por amenaza.

### Ejemplo practico
- Tres seeds distintas, velocidades 1x, 100x y 1000x.
- Decision esperada: transiciones consistentes, defensa estable, expansion gradual y sin suicidios.
- Resultado no aceptable: build orders ofensivas prematuras, colonizacion insegura o muro ignorado.

## Politica de amenaza para Egipto

Lectura de `villageCombatState`:
- `low`: mantener macro casi normal.
- `medium`: subir prioridad de muro, storage y defensa.
- `high`: congelar eco no esencial, reforzar defensa.
- `critical`: modo crisis total, pausar expansion activa y priorizar supervivencia.

Reglas:
- El macro egipcio nunca emite dodge tactico.
- El macro egipcio si puede pausar infraestructura no esencial.
- El macro egipcio si puede empujar reclutamiento defensivo de emergencia.
- Bajo amenaza alta, expansion se prepara pero no se ejecuta.

## Integracion esperada con `reactive.js`

Ajustes futuros recomendados:
- Egipcios deben tender mas a `hold` y `hold_with_reinforcements`.
- El score defensivo de muro, defensa local y defensa imperial debe tener mas peso.
- `shouldPreserveOffense` debe influir menos que en germanos o hunos.
- `counterattack` en egipcios debe ser mas raro y mas seguro.
- `full_dodge` en egipcios debe exigir derrota mucho mas clara.

## Estrategia de implementacion tecnica

Orden recomendado:
1. disenar archivo `egyptian-phase-engine.js`,
2. extraer helpers comunes reutilizables desde el motor germano solo si la duplicacion empieza a ser costosa,
3. agregar estado persistente egipcio en `AIController.js`,
4. enrutar `race === 'egyptians'` al nuevo motor,
5. validar build,
6. crear harness de validacion egipcia,
7. calibrar thresholds.

## Riesgos y mitigaciones

Riesgo: copiar demasiado del motor germano y heredar sesgo ofensivo.
Mitigacion: redefinir ratios, exits, prioridades y expansion gates.

Riesgo: demasiada inversion defensiva y bloqueo de expansion.
Mitigacion: expansion obligatoria desde diseno, con intensidad segura.

Riesgo: doble ruta de colonizacion.
Mitigacion: definir una sola ruta oficial para Egipto y eliminar ambiguedad.

Riesgo: `reactive.js` pise la identidad egipcia.
Mitigacion: ajustar ponderaciones defensivas por raza.

Riesgo: exceso de almacenamiento sin throughput militar suficiente.
Mitigacion: medir overflow, cola y tiempos muertos en Fase 6.

## Definicion de hecho

Se considera completado cuando:
1. Egipto usa un motor macro propio por fases.
2. Su comportamiento es claramente defensivo y economico.
3. La expansion existe y se ejecuta con seguridad.
4. El motor se integra bien con `reactive.js`.
5. No hay contradicciones con el arbitraje central.
6. Los KPIs muestran identidad egipcia coherente y estable.

## Checklist de implementacion

### Estado global
- [ ] Definir constantes y fases del motor egipcio.
- [ ] Crear `egyptian-phase-engine.js`.
- [ ] Modelar estado persistente egipcio por aldea.
- [ ] Integrar hidrata/serializa en `AIController.js`.
- [ ] Enrutar `race === 'egyptians'` al motor nuevo.
- [ ] Definir ratios eco/mil por dificultad.
- [ ] Definir prioridades de construccion por fase.
- [ ] Definir prioridades de reclutamiento por fase.
- [ ] Integrar expansion segura.
- [ ] Integrar threat override por `villageCombatState`.
- [ ] Validar build.
- [ ] Crear harness de validacion egipcia.
- [ ] Ajustar `reactive.js` para sesgo defensivo egipcio.
- [ ] Ejecutar calibracion final.
- [ ] Documentar resultados.

### Fase 1
- [ ] Configurar ratios de eco fortificada.
- [ ] Configurar exits de campos y storage.
- [ ] Configurar reclutamiento de emergencia minima.
- [ ] Validar que no se desbloquea militar agresiva demasiado pronto.

### Fase 2
- [ ] Priorizar barracks, academy, smithy y muro.
- [ ] Priorizar `slave_militia_egypt`, `ash_warden_egypt` y scouts.
- [ ] Validar estabilidad defensiva temprana.

### Fase 3
- [ ] Integrar defensa imperial sostenida.
- [ ] Integrar `anhur_guard_egypt`.
- [ ] Ajustar throughput defensivo sin romper eco.

### Fase 4
- [ ] Integrar resiliencia de storage y mercado.
- [ ] Ajustar red de refuerzos.
- [ ] Introducir ofensiva limitada contextual.

### Fase 5
- [ ] Integrar readiness de expansion.
- [ ] Integrar settlers y palace.
- [ ] Definir regla segura de lanzamiento de colonizacion.
- [ ] Validar que expansion no rompe defensa minima.

### Fase 6
- [ ] Crear KPIs y escenarios de validacion.
- [ ] Afinar thresholds de eco/mil.
- [ ] Afinar thresholds de expansion segura.
- [ ] Afinar sesgo defensivo reactivo.
- [ ] Cerrar reporte final.
