# Estado canónico IA Egipcios/Germanos

**Session ID:** ses_268a39e7fffeaDhPV5iV7jtdXR
**Created:** 4/16/2026, 5:35:07 PM
**Updated:** 4/16/2026, 10:47:49 PM

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

**Tool: grep**

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

**Tool: read**

**Tool: read**

---

## Assistant

**Tool: read**

---

## Assistant

**Tool: grep**

---

## Assistant

Listo, **ya quedaron aplicadas** las 5 fases para Germanos segun `docs/ai/esquema_fases_germanos.md`.

Cambios hechos (sencillo y claro):

- Se actualizaron las fases 1-5 en `src/features/game/ai/controller/german-phase-engine.js` con ratio fijo **65/35** en todas las dificultades.
- Se reemplazaron los objetivos de infraestructura por fase (construccion) para que coincidan con tu esquema.
- Se ajustaron los objetivos de reclutamiento por ciclos:
  - F2: `3 offensive_infantry` + `1 scout`
  - F3: `6 offensive_infantry` + `3 scout`
  - F4: `10 offensive_infantry` + `1 scout` + `2 offensive_cavalry`
  - F5: `20 offensive_infantry` + `3 scout` + `6 offensive_cavalry`
- Se configuraron los lanes de investigacion:
  - F1 `offensive_infantry`
  - F2 `scout`
  - F3 `scout`
  - F4 `offensive_cavalry`
  - F5 `ram` (ariete)
- Se agregaron los lanes de mejora (smithy):
  - F4: `offensive_infantry` a nivel 5
  - F5: `offensive_infantry` a nivel 10 y `offensive_cavalry` a nivel 5
- Se endurecio la salida de fase: ahora la transicion exige completar lo pedido por fase (infra + investigacion + mejoras + ciclos, segun corresponda).
- Se neutralizaron rutas fallback que metian comportamiento extra fuera del esquema (para mantenerlo alineado a lo que pediste).

Verificacion:
- `npm run build` en verde.

Nota corta:
- Se mantiene el bloque de **reclutamiento de emergencia por amenaza** (defensivo) cuando hay peligro real; eso es comportamiento de contingencia, no del plan base por fases.

---

## User

en el esquema de fases que te di no hay ninguna fase que encole defensas en ningun modo entonces porque no resppestas el esquema @docs/ai/esquema_fases_germanos.md tiene terminante prohibido hacer cosas que no te he pedido hacer. te pedi qque aplicaras al pie de la letra el esquema de germano y debes hacer eso, ni mas ni menos de lo que yo te haya pedido. No quiero que elimine la logica de reclutamiento en emergia solo qque no la metas al esquema aun ya que este esquema ira cambiando segun pruebas que yo valla haciendo hablo de pruebas reales

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

**Tool: bash**

---

## Assistant

**Tool: grep**

---

## Assistant

Tienes toda la razon. Me desvie ahi, perdon.

Ya lo corregi **al pie de la letra**:

- El esquema de `docs/ai/esquema_fases_germanos.md` queda como unico comportamiento activo de fases (sin meter defensa extra).
- **No elimine** la logica de emergencia; solo la deje **desactivada para este esquema**.
- Lo hice con flag en `src/features/game/ai/controller/german-phase-engine.js`:
  - `ENABLE_SCHEMA_THREAT_EMERGENCY_RECRUITMENT = false`
  - y las llamadas de emergencia en F2/F3/F4/F5 quedaron envueltas por ese flag.
- Build verificado: `npm run build` en verde.

Si quieres, siguiente paso te dejo ese flag documentado en `docs/ai/esquema_fases_germanos.md` para que tus pruebas reales queden trazables.

---

## User

bienn ahora elimina  todo los comportamientos por dificultad, la unica dificultad activa sera pesadilla para todas las tribus

---

## Assistant

**Tool: grep**

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

**Tool: grep**

---

## Assistant

**Tool: grep**

---

## Assistant

**Tool: bash**

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

**Tool: bash**

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

**Tool: apply_patch**

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

**Tool: bash**

---

## Assistant

**Tool: bash**

---

## Assistant

**Tool: grep**

**Tool: grep**

---

## Assistant

Hecho. Ya dejé **solo Pesadilla** como dificultad activa para todas las tribus.

Cambios aplicados:

- Forcé la dificultad global en `AIController`:
  - `src/features/game/ai/AIController.js:486` → `this._difficulty = 'Pesadilla'`.
- Eliminé variantes `Normal` y `Dificil` en plantillas de fase:
  - `src/features/game/ai/controller/german-phase-engine.js`
  - `src/features/game/ai/controller/egyptian-phase-engine.js`
- El helper común de dificultad ahora siempre usa fallback `Pesadilla`:
  - `src/features/game/ai/controller/phase-engine-common.js:772`.
- Quité comportamiento probabilístico por dificultad en reclutamiento:
  - `src/features/game/ai/action-executor/recruitment.js` (ahora usa una sola probabilidad fija de Pesadilla).
- Ajuste menor de texto interno (“Normal” -> “Base”) sin impacto de lógica:
  - `src/features/game/ai/strategy/scouting.js:76`.

Verificación:
- `npm run build` en verde.

---

## User

bien vinun error gravisimo, en la ia germana se ordeno investigar offensive_infantry y mando hacer lucchadores de porras pero las porras no se investigan porque ya virnen investigadas desde el inicio de la aldea, ademas se supone que eso eestaba arreglando ya que siempre se elije el mejor tipo d unidad en precio, calidad, mantenimiento. por ejemplo para el defensive_infantry fue ash warden. ademas me duele saber que este comportamiento esta en la ia egipcia pero no en la germana cuando se supone que se tenia que evitar duplicidad de una misma funcion que debrian tener ambos motores de ia

---

## Assistant

**Tool: grep**

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

**Tool: apply_patch**

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

**Tool: grep**

**Tool: grep**

---

## Assistant

**Tool: bash**

---

## Assistant

**Tool: bash**

---

## Assistant

Totalmente de acuerdo: ese era un bug real y grave.  
Ya lo corregí de forma centralizada (sin duplicar lógica por motor).

Qué pasaba:
- La IA germana usaba el **resolver de reclutamiento** también para investigación.
- Para `offensive_infantry` eso resolvía a `clubswinger` (porra), que tiene `research.time = 0` (ya desbloqueado), y por eso intentaba investigar algo no investigable.

Qué corregí:
- Creé un resolver compartido de investigación: `resolveResearchUnitIdForRace(...)` en `src/features/game/ai/utils/AIUnitUtils.js`.
- Ahora investigación y reclutamiento usan resoluciones distintas:
  - Reclutamiento germano `offensive_infantry` => `clubswinger` (se mantiene).
  - Investigación germana `offensive_infantry` => `axeman` (correcto).
- Lo conecté en el ejecutor común para **todas las tribus**:
  - `src/features/game/ai/AIActionExecutor.js`
- También ajusté la verificación común de pasos de research:
  - `src/features/game/ai/controller/phase-engine-common.js`
- Y el motor germano ahora arma pasos de research con `unitId` ya resuelto correctamente:
  - `src/features/game/ai/controller/german-phase-engine.js`

Validación:
- `npm run build` OK.
- Prueba directa de resolver:
  - `recruit offensive_infantry (germans) => clubswinger`
  - `research offensive_infantry (germans) => axeman`

Si quieres, en el siguiente paso te dejo un mini checklist de logs para confirmar esto en partida real en 2-3 minutos.

---

## User

el motor germano esta muy grave, nisiquiera avanza de de fase al cumplir con todos los objetivos de fase 1, no tiene lo de intercambiar recursos ni pedir prestado del budget economico como lo tiene la ia egipcia y te pedi no duplicaciion es indica que estas caracteristias deben etar validad para ambas ia germana y egipcia porque hay tanto codifo desigual? responde

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

**Tool: grep**

---

## Assistant

Sí, tienes razón: hay una inconsistencia fuerte y te explico exacto qué pasa.

- **Bug real de avance de fase (Germano F1):** la salida de fase valida `researchReady` con `resolveUnitIdForRace('offensive_infantry')`, que en germanos da `clubswinger` (porra), pero esa unidad no se investiga (`time=0`). Entonces `researchReady` queda falso y no transiciona.  
  - `src/features/game/ai/controller/german-phase-engine.js:559`  
  - `src/features/game/ai/controller/german-phase-engine.js:564`  
  - `src/features/game/ai/controller/german-phase-engine.js:609`

- **Sobre préstamo/intercambio:** sí existe en motor común (no solo egipcios), pero solo corre cuando hay paso de reclutamiento ejecutándose.  
  - `src/features/game/ai/action-executor/recruitment.js:643` (préstamo ECO->MIL)  
  - `src/features/game/ai/action-executor/recruitment.js:649` (intercambio MIL)  
  - En Fase 1 germana el lane reclutamiento es “Nada”, por eso ahí no lo ves.

- **Por qué hay código desigual:** porque el motor germano quedó con validaciones y helpers propios (p. ej. research gate) que no quedaron totalmente alineados con el flujo compartido; eso rompe la regla de no duplicación funcional.

- **Estado actual:** ya se corrigió el resolver para investigación en ejecución de pasos, pero **faltó conectarlo también en la validación de salida de fase germana**. Ese es el hueco que te está bloqueando F1.

Si quieres, en el siguiente paso te lo dejo totalmente unificado (misma función canónica para research en ambos motores: enqueue + completion + phase-exit).

---

## User

bien entonces alinea el motor germano con el motor egipcio que esta mas avanzado y es mas global. recuerda que esto es necesario para los nuevos motores de ia. es decir necesitamos 0 duplicidad y mucha reutilizacion de codigo no es profesional hacer las mismaa 100 lineas de codifodifdififfo n todos los archivos que hacerlo soolo en un archivo centralizado y luego ser utilizada por 5 archivos

---

## Assistant

---

