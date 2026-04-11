# Límite de 5 ataques por tanda a oasis IA

**Session ID:** ses_28b42c592ffeeBh6B331x2XC06
**Created:** 4/10/2026, 12:14:11 AM
**Updated:** 4/11/2026, 1:40:57 PM

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: bash**

---

## Assistant

**Tool: bash**

---

## Assistant

Listo, ya quedó aplicada la limitación por tandas para oasis exactamente como pediste.

- Implementé un **límite por lote** con constante configurable: `OASIS_RAID_BATCH_MAX_TARGETS = 5` en `src/features/game/ai/strategy/farming.js`.
- Ahora la IA **solo lanza hasta 5 ataques a oasis por tanda**; después **no envía más ataques a oasis** hasta que termine todo el ciclo (ida + regreso de tropas de oasis).
- La comprobación de bloqueo **solo considera movimientos de oasis** (no otros movimientos militares/comerciales), usando:
  - ataques/raids cuyo objetivo sea tile `oasis`
  - retornos etiquetados como provenientes de oasis
- Para poder distinguir bien los retornos, añadí contexto al movimiento de retorno en `src/features/game/engine/CombatEngine.js` (`payload.returnContext.sourceTileType`, coords y tipo de misión origen).
- Pasé al módulo de farmeo el estado de movimientos y resolver de tiles desde `src/features/game/ai/StrategicAI.js`, para que la validación use el mapa real y no mezcle otros movimientos.

Verificación:
- Ejecuté `npm run build` y compiló correctamente.

Si quieres, en el siguiente paso te lo dejo también centralizado en `AIConstants` para cambiar de 5 a 10 desde un único archivo global.

---

## User

hay alguna forma de hacer que la ia calcule la batalla con el simulador para saber cual es la mejor cantidad de tropas ofensivas a enviar a saquear oasis para obtener el mayor botin con menor perdida y poder obtener rentabilidad real? solo responde no hagas codigo

---

## Assistant

Sí, totalmente. De hecho es la forma correcta de hacerlo.

La IA puede usar el simulador como función de evaluación y optimizar así:

- Definir objetivo real: maximizar `rentabilidad = botín esperado - pérdidas esperadas - costo de viaje/tiempo`.
- Generar varias composiciones de tropas ofensivas candidatas (ligera, media, pesada, etc.).
- Simular cada composición contra el oasis (bestias actuales).
- Estimar para cada una:
  - botín bruto esperado (según bestias que mata y capacidad de carga),
  - valor de tropas perdidas,
  - costo logístico (distancia + tiempo de viaje),
  - botín neto / ROI.
- Elegir la composición con mejor ROI y además aplicar filtros:
  - pérdida máxima permitida,
  - mínimo de supervivencia,
  - no enviar si neto <= 0.
- Repetir en cada ciclo porque el oasis cambia (regeneración/presión/ataques previos).

Si quieres “rentabilidad real”, lo clave es incluir no solo bajas, sino también el **costo de oportunidad por tiempo de tropas fuera** y una **penalización de riesgo** cuando la simulación tiene alta incertidumbre. Eso evita que la IA elija ataques “teóricamente buenos” pero malos en práctica.

---

## User

ok pero ve si se puede hacer segun nuestro motor de batalal, simulador, tropas de la ia germana etc. y dame una respuesta mas seguida segun nuestra logica de juego

---

## Assistant

Sí, y según su lógica actual **ya están muy cerca** de eso.

En su motor, la ruta real hoy es esta: `StrategicAI.computeMilitaryTurn` -> `performOptimizedFarming` -> `calculateBestOasisRaidConfig` -> `simulateCombat` (que usa `CombatFormulas` con reglas de `raid`). Ahí ya se calcula para cada oasis un `rewardNet` con esta idea: **bounty de bestias muertas - valor de bajas - costo de viaje** (distancia + minutos), y solo se ataca si el neto es positivo. Además se ordena por rentabilidad y ahora ya tienen control por tandas de 5 oasis.

Donde todavía pueden afinar para que sea “rentabilidad real” de su juego:

- La selección de tropas es por 4 perfiles heurísticos (`ligera_rapida`, `media_equilibrada`, etc.), no una optimización completa; funciona bien, pero no siempre encuentra el óptimo global.
- El simulador militar que usa farmeo está simplificado (sin snapshot de mejoras de herrería en atacante), así que puede subestimar/sobreestimar pérdidas en algunas fases de IA germana.
- El neto actual valora bien bajas + viaje, pero no mete explícitamente costo de oportunidad estratégico (ej: dejar aldea débil para guerra/némesis), aunque parte de eso se controla por el gate militar y prioridades.

Conclusión: **sí se puede perfectamente con su motor actual y de hecho ya lo hacen en versión funcional**; lo que falta para llevarlo a “rentabilidad real premium” es pasar de heurística a optimización más fina y usar estado de combate completo (incluyendo upgrades) en la simulación de oasis.

---

## User

bien haz que el la ia calcule la batalla de forma precisa usando nuestro propio sistema de batalla de logica real de nuestro juego, luego que envie la cantidad de tropas con menor bajas posible segun el resultado de las simulaciones a los 5 objetivos por tanta que envia la ia. ademas asegurar que la ia escoja la la mejor unidad ofensiva para atacar oass y que tenga suficiente de esa unidad ofensiva para atacar oasis para la mayor rentabilidad de  los ataques segun las sinulaciones. ademas asegurate que lo robado por ataques a oasis, jugadores o a otras IAs se ha introducido al budget militar y no al economico, de esta manera too lo que la ia robe se inyectara directamente en su presupuesto militar para seguir invirtiendo en tropas.

---

## Assistant

**Tool: grep**

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: bash**

---

## Assistant

**Tool: bash**

---

## Assistant

Hecho. Ya lo dejé aplicado siguiendo la lógica real de su motor de combate y su flujo de IA.

- La IA de farmeo a oasis ahora simula con el modelo real de combate del juego (mismas fórmulas base de `CombatFormulas` para ataque, defensa, morale, proporciones inf/cav y pérdidas de `raid`), en vez de una aproximación simple, en `src/features/game/ai/strategy/farming.js`.
- Para oasis, ahora evalúa unidades **ofensivas puras** (infantería/caballería ofensiva), calcula cuál da mejor rentabilidad real y selecciona la cantidad con mejor resultado de simulación (rentabilidad neta alta con bajas mínimas como desempate), también en `src/features/game/ai/strategy/farming.js`.
- Se mantiene el control por tandas: máximo 5 objetivos oasis por lote y espera a que termine todo el ciclo ida/regreso antes de otro lote, validando solo movimientos de oasis (`src/features/game/ai/strategy/farming.js`, `src/features/game/engine/CombatEngine.js`).
- Conecté el contexto necesario desde la IA estratégica (owner/movimientos/tipo de tile/población atacante) para que la simulación sea coherente con estado real del juego en `src/features/game/ai/StrategicAI.js`.
- Todo recurso robado que vuelve por combate (oasis, jugadores, otras IAs) ahora entra directo al **budget militar** y no al económico, en `src/features/game/state/GameWorker.js` y `src/features/game/state/worker/budget.js`.

Verificación:
- Corrí `npm run build` y compiló correctamente.

Si quieres, el siguiente ajuste natural es agregar 2-3 constantes de balance para tunear agresividad (margen mínimo de ataque, escalones de tamaño de escuadra, peso de bajas en desempate) sin tocar lógica.

---

## User

bien vamos hacer un pequeño ajuste. sucede que ahora la IA manda todo en un solo ataque en un solo ciclo y esta bien pero no es lo, lo ideal es quebuse sus 5 ataques por ciclo, por ende la ia dividira el total de sus troopas por el numero de ataques que debe hacer por ciclo, de esta manera si la IA tiene 500 porras no anndaria 500 a un solo ataque sino que mandaria 100 a cada ataque, pero solo si calcula que gana mas de los recursos que pierde en las tropas muertas, sino calula que no gana mas entonces solamente descarta ese slot y divide sus tropas en 4 ataques y asi wucesivamente hasta que sea rentable. esto se debe apreciar en logs en la consola de forma precisa. cabe resaltar que se usa la constante de ataques por ciclo para nedir en cuanto dividir las tropas y asi evitar que se rompe el balnce si decido aumentar esta constante

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: bash**

---

## Assistant

**Tool: bash**

---

## Assistant

Perfecto, ya quedó ajustado con la lógica que pediste.

- Ahora la IA **intenta llenar 5 slots por ciclo** (constante `OASIS_RAID_BATCH_MAX_TARGETS`) y **divide tropas por slot** al simular (`total unidad ofensiva / slots`), en `src/features/game/ai/strategy/farming.js`.
- Si con 5 slots no da rentabilidad en todos, **descarta 1 slot y recalcula con 4**, luego 3, etc. hasta encontrar un lote totalmente rentable.
- La selección usa simulación de combate con su modelo real (`CombatFormulas`) y elige la **mejor unidad ofensiva** para oasis con mejor ROI y bajas mínimas como desempate.
- Se mantiene el gate de lote en curso (ida+vuelta de oasis): no lanza otro lote hasta terminar el actual.
- Agregué logs de consola precisos del proceso:
  - evaluación por slots (`5 -> 4 -> ...`),
  - confirmación del lote final,
  - unidad elegida y cantidad enviada por ataque.
- El build pasó correctamente (`npm run build`).

Referencias principales:
- `src/features/game/ai/strategy/farming.js`
- `src/features/game/ai/StrategicAI.js` (contexto para simulación/lote)
- `src/features/game/engine/CombatEngine.js` (contexto retorno oasis)
- `src/features/game/state/GameWorker.js` y `src/features/game/state/worker/budget.js` (botín a presupuesto militar)

Si quieres, en el siguiente paso te agrego un log-resumen por ciclo tipo: “slots objetivo, slots logrados, tropas totales comprometidas, ROI promedio”.

---

## User

procede de precisoo y rapido

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: bash**

---

## Assistant

Listo, procedí.

- Añadí el log-resumen por ciclo de lote oasis en `src/features/game/ai/strategy/farming.js`.
- Ahora verás en consola: `objetivoSlots`, `enviados`, `tropasComprometidas` y `avgNet`.
- Se mantiene toda la lógica de división dinámica 5→4→3... y selección rentable.
- Validado: `npm run build` exitoso.

---

## User

[IA ai_0] [Juego T+66577:02:25 @5000x] [Etapa EARLY] [Fase: Fase 2 - Desbloqueo militar basico] [Aldea IA 1 (-23|18)] [Razonamiento Estrategico] :: El general emitio el siguiente analisis:
1364c842-d2cc-48bf-a614-972696e47328:5 === DOCTRINA DE GUERRA PROFESIONAL (RUSHER) ===
[POLÍTICA] Nuevo Rival: player (Pob: 31).
[FARMEO ROI] Oasis -20|-10 descartado: sin escuadra viable.
[FARMEO ROI] Oasis -1|-1 descartado: sin escuadra viable.
[FARMEO ROI] Ranking oasis por RewardNet: -20|-11:16625 > 12|24:16573 > -21|-18:16568 > -15|-19:16553 > 15|11:16547
[FARMEO ROI] Aldea IA 1 -> Oasis (unidad_optima_clubswinger) (Net: 16625, Gross: 20616, Loss: 3750, Travel: 241, Dist: 29.2) genero ese log y solo envio un ataque y siempre de varias veces que ataca solo envia un ataque dime porque por favor

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: read**

---

## Assistant

Te pasa por **dos razones claras**, y la principal es que ese log no corresponde al código nuevo:

- En tu salida **no aparecen** logs nuevos como `[FARMEO LOTE] Evaluando lote oasis con X slots...` ni el resumen de ciclo; eso indica que estás corriendo una versión anterior.
- Además, en tu log sale `[Fase: ...]` (con `:`), pero en la versión actual el formato quedó distinto.  
- En esa versión vieja, el algoritmo rankea varios oasis, pero luego el primer ataque consume casi toda la tropa útil y los demás candidatos fallan por `hasTroops`, por eso termina saliendo **solo 1 ataque**.

Si ya levantaste cambios, entonces te falta recargar runtime:

1. Reinicia el servidor/proceso del juego.
2. Fuerza recarga completa del navegador (hard reload) para reiniciar el WebWorker.
3. Verifica que en consola aparezcan líneas `[FARMEO LOTE] ...`; si no aparecen, sigues en build viejo.

Con la versión nueva, si hay rentabilidad para 5, manda 5; si no, baja a 4/3/2/1 (de forma explícita en logs).

---

## User

estoy feliz porque lo hiciste bien y quedo como yo queria admas que ya obtuve 1 mes mas de chat gpt plus para seguir codeando

---

## Assistant

Que grande, me alegra un monton leer eso.  
Excelente feedback y muy buen ojo para balancear la IA, la dejaste con lógica de juego real.

Si quieres, en la próxima ronda te ayudo a dejar un mini “panel de métricas” de farmeo (ROI por ciclo, bajas totales, slots usados, unit mix) para tunearla todavía más rápido.

---

## User

bien ahora tengo una pregunta. que responderas basado en el codigo real de la ia generna rl cual revisaras y analizaras primero antes de responder. la pregunta es porqe la IA gemerna en pesadilla y en una velocidad de juego de 5000x solo grner por ciclo de desicion 225 porras teniendo suficiente recursos y budget militar para creqr mas tropas y siendo que cadaporrq se logra en 120ms 225 son 27-29s y no cumple el ciclo completo de 3min

---

## Assistant

**Tool: grep**

**Tool: read**

---

## Assistant

**Tool: grep**

**Tool: read**

---

## Assistant

**Tool: read**

**Tool: read**

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: glob**

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

Buena pregunta. Revisando el código real, pasa por diseño en **3 puntos**:

- En Fase 2 la meta sí está en 3 minutos de cola (`queueTargetMinutes: 3`) en `src/features/game/ai/controller/german-phase-engine.js:189` y `src/features/game/ai/controller/german-phase-engine.js:1734`.
- Pero el reclutamiento **no llena esos 3 min de una sola orden**: calcula `unitsNeededByQueue` y luego lo recorta por lote adaptativo en `src/features/game/ai/action-executor/recruitment.js:256` + `src/features/game/ai/action-executor/recruitment.js:292`.
- Ese lote adaptativo tiene topes (`PHASE_BATCH_CONFIG`) y se limita por fase/velocidad/queue pressure en `src/features/game/ai/action-executor/recruitment.js:4` y `src/features/game/ai/action-executor/recruitment.js:136`.

Por eso, aunque a 5000x una porra tarde ~120 ms (3 min = ~1500 porras si la cola estuviera vacía), el sistema mete tandas parciales (como ~225) y no todo el bloque de una vez.

Además, hay otra limitación estructural:

- El motor por fases corta el ciclo en la **primera acción exitosa** (`runStepList` + `handlePhaseActionResult`), o sea normalmente una sola orden por ciclo económico, en `src/features/game/ai/controller/german-phase-engine.js:778` y `src/features/game/ai/controller/german-phase-engine.js:2002`.
- Si en ese tick ya hizo una construcción exitosa, puede ni llegar a reclutar en ese mismo ciclo (`phase2_priority_construction` antes que `phase2_priority_recruitment`) en `src/features/game/ai/controller/german-phase-engine.js:2440` y `src/features/game/ai/controller/german-phase-engine.js:2459`.

Resumen corto: **no es falta de recursos**, es que la IA alemana está configurada para reclutar en tandas adaptativas + una acción exitosa por ciclo, no para rellenar 3 minutos de cola en un único comando.

---

## User

explicame de forma clara porque no entendi y vomo es eso de eclutamiento adaptativo. se claro y preciso 

---

## Assistant

Claro, en simple:

- La IA **quiere** tener 3 minutos de cola de cuartel.
- Pero cuando va a reclutar, **no mete todo lo que falta**.
- En vez de eso usa “reclutamiento adaptativo”: calcula un **lote parcial** (un porcentaje), con mínimos y máximos.
- Ese lote se limita por configuración (`PHASE_BATCH_CONFIG`) y por condiciones (urgencia, cola actual, velocidad).
- Resultado: aunque falten 1500 porras para 3 minutos, puede mandar solo 200-300 (ej. 225) en ese ciclo.

Qué significa “adaptativo”:
- “Adaptativo” = tamaño del lote **cambia dinámicamente**.
- Si hay mucha urgencia y recursos, sube.
- Si ya hay cola o presión, baja.
- Nunca pasa ciertos topes de min/max.

Y además:
- El motor de fase suele **cortar al primer éxito** del ciclo.
- Si ya hizo una acción (por ejemplo construcción), no sigue metiendo más reclutamientos en ese mismo ciclo.

Por eso ves 225 porras y no llenar los 3 minutos completos de una sola vez.

---

## User

bien dame mas detalles del reclutamiento adaptitvo en claro y simple becesito mas detalles vual es el max y min, entre otros

---

## Assistant

Perfecto. Te lo explico **claro, simple y con números reales del código**.

**Qué es reclutamiento adaptativo**
- No recluta “todo lo posible” de golpe.
- Calcula un **tamaño de tanda (batch)** para cada orden.
- Ese batch depende de:
  - fase de la aldea (`early`, `mid`, `late`),
  - velocidad del juego,
  - urgencia de la meta,
  - recursos disponibles,
  - cuánto ya hay en cola.

Archivo: `src/features/game/ai/action-executor/recruitment.js`

---

**1) Min y Max base por fase**
Configuración real (`PHASE_BATCH_CONFIG`):
- `early`: basePct `0.18`, min `5`, max `24`
- `mid`: basePct `0.30`, min `10`, max `72`
- `late`: basePct `0.45`, min `20`, max `140`

---

**2) Cómo afecta la velocidad (5000x)**
Usa:

- `speedMultiplier = clamp(gameSpeed / 10, 1, 2.5)`

Con 5000x:
- `gameSpeed/10 = 500`, pero clamp lo deja en `2.5` (tope)

Luego:
- `min = round(minBase * sqrt(2.5))` (sqrt 2.5 ~ 1.58)
- `max = round(maxBase * 2.5)`

Queda así aprox:
- `early`: min 8, max 60
- `mid`: min 16, max 180
- `late`: min 32, max 350

---

**3) Cómo calcula el porcentaje dinámico (ratio)**
Empieza con `basePct` y ajusta:

`dynamicRatio = basePct + urgencia*0.22 + affordability*0.12 - queuePressure*0.2`

Después lo limita a:
- mínimo `0.12`
- máximo `0.8`

O sea: nunca recluta menos de 12% ni más de 80% del “affordable total” en una sola tanda.

---

**4) Ajustes extra del máximo**
- Si la cola está muy cargada (`queuePressure > 0.75`), reduce max a 70%.
- Si hay mucha urgencia (`>0.7`) y muchos recursos, puede subir el max a 125% del max de fase.

---

**5) Fórmula final de cuántas unidades manda**
- `batchSize = floor(effectiveAffordableTotal * dynamicRatio)`
- Luego lo recorta por:
  - min de fase,
  - max de fase,
  - affordability,
  - unitsNeeded.

Por eso no mete todo de una.

---

**6) Por qué ves 225 porras**
Porque 225 encaja exactamente en esta lógica:
- ejemplo: affordable 500 y ratio 45% -> 225.
- o affordable 300 y ratio 75% -> 225.
- y además dentro de topes de fase/velocidad.

---

**7) Extra importante**
Si la unidad es `settler` o `chief`, **siempre 1 por 1** (hardcoded).

---

Si quieres, en el siguiente paso te digo exactamente qué valor tocar para que la IA sí llene casi todo el objetivo de 3 minutos en cada orden (sin romper todo lo demás).

---

## User

ok dime por favor

---

## Assistant

Perfecto. Si quieres que llene casi toda la cola objetivo (3 min) en cada orden, toca esto en este orden:

- `src/features/game/ai/action-executor/recruitment.js` -> `PHASE_BATCH_CONFIG`
  - Sube `basePct` (clave principal).
  - Para tu caso agresivo en Pesadilla/5000x, pon algo tipo:
    - `early.basePct` de `0.18` a `0.60-0.80`
    - `mid.basePct` de `0.30` a `0.70-0.85`
    - `late.basePct` de `0.45` a `0.80-0.90`
- En el mismo archivo, función `calculateAdaptiveBatchSize`:
  - Sube el límite superior de `dynamicRatio` (ahora está en `0.8`).
  - Si quieres casi llenar siempre, súbelo a `0.95` o `1.0`.
- En `PHASE_BATCH_CONFIG`, sube también `max` por fase (porque ahora te puede recortar la tanda aunque haya recursos).
  - Especialmente `early.max` y `mid.max`, que son los que más te frenan al inicio.

Si además quieres que en **una sola decisión** pueda meter otra tanda más (y no esperar al siguiente ciclo), ya no es solo tuning:
- Eso depende del flujo del phase engine que corta tras primer éxito.
- Ahí tendrías que permitir múltiples acciones de reclutamiento por ciclo (cambio de lógica, no solo números).

Resumen práctico:
1) subir `basePct`,  
2) subir tope `dynamicRatio` (0.8 -> 0.95/1.0),  
3) subir `max` de fase.  

Con solo esos 3 cambios, ya verás que deja de mandar tandas pequeñas tipo 225 y se acerca mucho más al objetivo de 3 minutos por orden.

---

## User

bueno pero haz que meta todo lo que pueda meter en un solo ciclo hasta completar los 3 minutos del ciclo sinonlo mete lleno entonces se calcula el restante para elsiguente ciclo de reclutamiento y si se completa 1 ciclo. De esta manera se podran conoletar ciclos de forma precisa. ademas yo necesito saber en los logs de reclutamiento cuantos ciclos se  han conpletado y cuantos son los ciclos maximos de la fase actual de reclutamiento. 

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: bash**

---

## Assistant

**Tool: read**

**Tool: read**

**Tool: grep**

**Tool: grep**

---

## Assistant

Listo, ya lo implementé exactamente como pediste.

- Ahora la IA intenta **llenar de una vez** la cola objetivo de reclutamiento (3 minutos) cuando el paso es `queue_cycles`; si no alcanza por recursos, encola todo lo posible y el resto queda para el siguiente ciclo automáticamente por diferencia de cobertura.  
  - `src/features/game/ai/action-executor/recruitment.js:307`
- Mantiene la lógica adaptativa para otros casos, pero para cola por ciclos la prioridad ya es completar objetivo de cola en una orden.
  - `src/features/game/ai/action-executor/recruitment.js:295`
- Agregué log preciso de cobertura de cola por ciclos en cada orden de reclutamiento:
  - formato: `CiclosCola: antes->despues/objetivo`
  - `src/features/game/ai/action-executor/recruitment.js:336`
- Agregué telemetría/log por fase con progreso de ciclos completados vs máximos de fase actual (incluye desglose por tipo relevante: ofInf, scout, etc.).
  - helper exportado: `src/features/game/ai/controller/german-phase-engine.js:371`
  - log emitido: `src/features/game/ai/AIController.js:261`

Validación:
- Compilación OK con `npm run build`.

Si quieres, siguiente paso te agrego un log extra cuando se cumple exactamente el objetivo de ciclo (`QUEUE_TARGET_MET`) para que quede todavía más visible en consola.

---

## User

ahora necesito que te asegures de que por ejemplo si un ciclo de reclutamiento de 3 minutos son 3000 tropas y se encolaron 1500 eso indicaria que en ese ciclo militar de desicion se completo unun 50% de ciclo de reclutamiento de esta forma se rastrea vuanto falta para completar el ciclo de reclutamiento y para el proximo ciclo de desicion de reclutamiento se pueda completar 1 ciclo de reclutamiento. en resumidas cuentas no importa cuantos ciclos de desicion tome completsr 1 ciclo de reclutamiento de 3 min sino que se rastree y se calcule bien para asi poder compeltarse llde forma precisa los ciclos de reclutamiento que son muy importantes para dar salida de fases y que la ia avanze

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: bash**

---

## Assistant

Perfecto, ya quedó implementado como lo pediste: ahora se rastrea el avance **fraccional** del ciclo de reclutamiento de 3 minutos y ese avance se acumula entre decisiones hasta completar ciclos exactos para salida de fase.

- La IA ahora registra progreso de ciclo **al encolar reclutamiento exitoso** (no espera a que termine la unidad para contar progreso de fase), así si encolas 1500 de 3000, cuenta ~50% del ciclo.
- Cuando vuelve a decidir, calcula lo que falta y lo completa en siguientes decisiones, manteniendo precisión de ciclos acumulados.
- Evité doble conteo: antes se sumaba por notificación de unidades terminadas; ahora el conteo de progreso de fase está basado en el compromiso de cola.
- En logs de reclutamiento añadí cobertura de cola por ciclos: `CiclosCola: antes->despues/objetivo`.
- También añadí log explícito de progreso de fase: `Progreso ciclos fase: completados/max (%)`, para que veas avance real hacia los ciclos requeridos de salida de fase.

Archivos tocados:
- `src/features/game/ai/action-executor/recruitment.js`
- `src/features/game/ai/controller/german-phase-engine.js`
- `src/features/game/ai/AIController.js`

Validación:
- `npm run build` pasó correctamente.

---

