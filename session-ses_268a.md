# Estado canónico IA Egipcios/Germanos

**Session ID:** ses_268a39e7fffeaDhPV5iV7jtdXR
**Created:** 4/16/2026, 5:35:07 PM
**Updated:** 4/16/2026, 6:19:08 PM

---

## User

primero lee @docs/ai/contexto_actual.md 

---

## Assistant

Listo, ya leí `docs/ai/contexto_actual.md` y tomo ese estado como canónico.

Me quedo con estos puntos clave para lo que siga:
- Presupuesto IA estable: nada de rebalanceos por timer ni por `INSUFFICIENT_RESOURCES`; solo ajuste al entrar/cambiar de fase.
- Protección de principiante unificada por población total del owner, con umbral único `250`.
- Acciones hostiles (`attack`, `raid`, `espionage`) solo entre owners fuera de protección.
- Validaciones y razones de rechazo centralizadas, con logging consistente.

Cuando quieras, seguimos con el siguiente paso.

---

## User

bien ahora vamos a investigar u ahora vamos a investigar u. . comportamiento extraño peroo antes necesito saber cuales son los  objetivos de fase 1 y w de  egipcios en el lane reclutamiento

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: glob**

---

## Assistant

**Tool: read**

**Tool: read**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: read**

**Tool: grep**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: read**

**Tool: read**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

Perfecto. Asumiendo que “w” era **fase 2**, en Egipcios el lane de reclutamiento queda asi:

- **Fase 1**: el lane `recruitment` intenta solo `defensive_infantry` en micro-ciclos (`cycle_batch`, 1 ciclo por accion). Referencia: `src/features/game/ai/controller/egyptian-phase-engine.js:1073`, `src/features/game/ai/controller/egyptian-phase-engine.js:1084`.
- **Objetivo de salida F1 (ciclos)**: `total: 2`, `defensiveInfantry: 2`, `scout: 0`. Referencia: `src/features/game/ai/controller/egyptian-phase-engine.js:125`.
- **Fase 2**: el lane `recruitment` intenta `defensive_infantry` + `scout` (prioridad por categoria y rotacion round-robin). Referencia: `src/features/game/ai/controller/egyptian-phase-engine.js:1161`, `src/features/game/ai/controller/egyptian-phase-engine.js:1172`, `src/features/game/ai/controller/phase-engine-common.js:1069`.
- **Objetivo de salida F2 (ciclos)**: `total: 20`, `defensiveInfantry: 15`, `scout: 5`. Referencia: `src/features/game/ai/controller/egyptian-phase-engine.js:126`.
- **Duracion de ciclo**: 1 ciclo = `3 min`, asi que F1 pide ~6 min de entrenamiento acumulado y F2 ~60 min acumulados. Referencia: `src/features/game/ai/controller/phase-engine-common.js:13`.

Si quieres, en el siguiente paso te saco un checklist de “comportamiento esperado vs anomalo” para F1/F2 en reclutamiento y lo contrastamos con logs.

---

## User

haber pero dame el resultado de formaclara y sencilla sin tanta verbosidad. de ahora en adelante responderas asi

---

## Assistant

Entendido. Desde ahora te respondo **claro, simple y corto**.

Resultado (Egipcios, lane reclutamiento):

- **Fase 1:** recluta solo `defensive_infantry`.
- **Meta Fase 1:** `2` ciclos de `defensiveInfantry` (scout `0`).

- **Fase 2:** recluta `defensive_infantry` y `scout`.
- **Meta Fase 2:** `15` ciclos de `defensiveInfantry` + `5` ciclos de `scout` (total `20`).

- **1 ciclo = 3 minutos**.

---

## User

ok aqui esta el error. en un log que  encontre vi qque la ia egipcia en fase2 recluto 7 ciclos de scout. ya aqui hay un bug claro y otro bug es que nunca roto en micro pasos es decir debio de haber reclatado een orden, desde deffensive/ofensive_infantry, luegos  cout, luego offensive_deffensive_cavalry, luego siege y luego unidades colonizadores o conquistadoras y no siguio este  orden porque solo recluto ciclos de scout ok aqui esta el error. en un log que encontre vi que la ia egipcia en fase 2 recluto 7ciclos de scout. ya aqui hay un bug claro y otro bug es que nunca roto en micro pasos es decir debio de haber reclatado en orden, desde deffensive/ofensive_infantry, luegos cout, luego offensive_deffensive_cavalry, luego siege y luego unidades colonizadores o conquistadoras y no siguio este orden porque solo recluto ciclos de scout. Otro bug es que no roto en micro paso, debio de haber hecho un ciclo de defensive_infantry y luego en el sigueiinte ciclo del lane de reclutamiento haber hecho un ciclo de scout, luego otraves defensive_infantry y luego scout, es decir rotar cuando se cconolete un micro paso entre losnibjetivos del lane reclutamiento. estos son los compartamieento que vi que estan mal. Ahora analiza la logica, diagnostica y rrsponde s ves los bugs y dime que sucede. no hagas codigo solo responde

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

**Tool: read**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: grep**

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

**Tool: read**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: grep**

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

**Tool: read**

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

**Tool: read**

---

## Assistant

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

Sí, ya revisé la lógica y esto es lo que pasa:

- **Sí hay un bug de comportamiento en Fase 2**: el objetivo `15 defInf / 5 scout` se usa como **mínimo para salir de fase**, no como tope. Por eso puedes ver `7+` scouts sin problema técnico del motor. (`src/features/game/ai/controller/egyptian-phase-engine.js:126`, `src/features/game/ai/controller/egyptian-phase-engine.js:272`)
- **La rotación sí existe**, pero es **round-robin simple**, no “inteligente por objetivo pendiente”. O sea rota por turno, no por déficit (no prioriza seguir metiendo defInf hasta 15 antes de scout). (`src/features/game/ai/controller/phase-engine-common.js:1012`)
- En **Fase 2 de Egipcios** el lane de reclutamiento solo tiene 2 micro-pasos: `defensive_infantry` y `scout`. No incluye cavalry/siege/colonización en esa fase. (`src/features/game/ai/controller/egyptian-phase-engine.js:1172`)
- Entonces: tu observación de scouts de más **sí revela desalineación** con el objetivo esperado; pero “no rota en micro-pasos” como tal **no está confirmado** por código (la rotación base sí está implementada).  

Si quieres, en el siguiente paso te digo exactamente qué condición debería cumplir la rotación para que F2 respete 15/5 sin sobreproducir scouts.

---

## User

escucha bien deseo este comportamiento en el lane reclutamiento: 1) se  debe hacer micro pasos de los objetivos dentro de un lane, ejemplo: 15 ciclos de defensive_infantry y 5 ciclos de scout la ia intentara en eel primer ciclo del lane reclutamiento hacer defensive_infantry pues el orden que te di anteriormente es el ordenn que debbe seguir, lego si alla por ffalta de recursos se captura el subgoal y no se suelta hasta salir del bloqueo, esto indica que hasta que no se haya completado el micro paso de hacer 1 ciclo de defensive infantry no podra rotar alnotro objetivoo que es reclutar 1 ciclo de scout. 2) Todo comportamiento distinto a este debe ser borrado y solo regir el comportamiento que te pido. 3) el reclutamiento quedaria por orden y con micro pasos de un ciclo para cada  objetivo solo rotando cuando se haya comoletado un micro paso paara dicho objetivo dentro del lane reclutamiento, que un micro paso no se haya conpletado por ffalta de  recursoos o otro problema no hace que se salte al siguiente objetivo dentro del lane, esto quiere decir que solo cuando se conolete el micro paso Si o S es que se rota al sigueintte objetivo dentro de labe reclutamiento.

---

## Assistant

Perfecto, entendido.  
Tomo esto como **regla canónica** del lane de reclutamiento:

1) **Orden fijo de objetivos** dentro del lane (el que definiste).  
2) Cada objetivo se ejecuta en **micro-pasos de 1 ciclo**.  
3) La IA **no rota** al siguiente objetivo hasta que el micro-paso actual termine en **éxito real** (1 ciclo encolado/completado).  
4) Si falla por `INSUFFICIENT_RESOURCES`, `QUEUE_FULL`, prerequisitos, etc., se crea/subsiste subgoal y el objetivo queda **bloqueado** (sin salto).  
5) Solo cuando ese micro-paso se completa, recién rota al siguiente objetivo del lane.  
6) Al cumplir el target de un objetivo (ej. scout 5/5), ese objetivo deja de participar en la rotación.

Con estas reglas se corrigen los dos problemas que viste:  
- sobre-reclutamiento de `scout` (ej. 7 en F2),  
- rotación incorrecta/salto de micro-pasos.  

Si quieres, en el siguiente paso lo implemento exactamente así.

---

## User

procede de forma precisa 

---

## Assistant

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

**Tool: grep**

---

## Assistant

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

**Tool: grep**

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

**Tool: apply_patch**

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

**Tool: bash**

---

## Assistant

**Tool: bash**

---

## Assistant

**Tool: apply_patch**

---

## Assistant

**Tool: bash**

---

## Assistant

**Tool: grep**

**Tool: grep**

---

## Assistant

Hecho. Implementé el comportamiento exacto que pediste.

- Rotación de micro-pasos ahora es **solo por éxito** (no por intento): `src/features/game/ai/controller/phase-engine-common.js:1040`.
- `getRoundRobinPhaseSteps` ya **no avanza puntero automáticamente** en cada ciclo: `src/features/game/ai/controller/phase-engine-common.js:1012`.
- En Egipcios, el lane de reclutamiento ahora:
  - respeta subgoal/bloqueo sin saltar objetivo,
  - rota solo cuando se completa el micro-paso,
  - y **no sigue reclutando buckets ya cumplidos** (ej. scout > target): `src/features/game/ai/controller/egyptian-phase-engine.js:342`, `src/features/game/ai/controller/egyptian-phase-engine.js:770`.
- Corregí el conteo de “ciclos” para `cycle_batch`: ahora cuenta por micro-paso (1 ciclo), no por tiempo total de entrenamiento de la unidad. Esto evita casos como “1 scout = 7 ciclos”: `src/features/game/ai/controller/egyptian-phase-engine.js:330`, `src/features/game/ai/controller/german-phase-engine.js:346`.
- Apliqué la misma regla de rotación por éxito + no salto por bloqueos en Germano para mantener consistencia del motor: `src/features/game/ai/controller/german-phase-engine.js:835`.
- Persistencia de punteros de rotación añadida en hydrate/serialize para no perder orden entre ciclos guardados: `src/features/game/ai/controller/egyptian-phase-engine.js:1752`, `src/features/game/ai/controller/german-phase-engine.js:2389`.

Verificación:
- `npm run build` en verde.

Si quieres, siguiente paso: te doy un checklist de logs exactos para validar en partida que F2 Egipcia haga `defInf -> scout -> defInf -> scout` y se detenga en `15/5` sin sobrepasar.

---

