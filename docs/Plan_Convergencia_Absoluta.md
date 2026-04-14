## User

bien como podemos resolver esto de forma profesional sin regresiones en ambos archivos?

---

## Assistant

Excelente enfoque. La forma profesional de resolverlo **sin regresiones** es hacer una convergencia por capas, no un “merge masivo” de los dos motores.

**Plan Profesional (seguro y sin romper)**

- **1) Congelar comportamiento actual con baseline**
  - Antes de refactor, generar “huella” de ambos motores con harness: transiciones de fase, razones de bloqueo, subgoals creados/resueltos, ciclos de reclutamiento, ratio eco/mil.
  - Archivos clave a comparar: `src/features/game/ai/controller/german-phase-engine.js` y `src/features/game/ai/controller/egyptian-phase-engine.js`.
  - Esto te da un contrato de no-regresión medible.

- **2) Definir contrato único del motor por fases**
  - Formalizar una interfaz común: entrada de ciclo, orden de ejecución, manejo de resultados, clasificación de errores recuperables, lifecycle de subgoals.
  - Ese contrato debe vivir en `src/features/game/ai/controller/phase-engine-common.js` (o un `phase-engine-runtime.js` nuevo).

- **3) Extraer runtime común, dejar “tribe config” separada**
  - Lo común (idéntico para ambos):  
    - pipeline de ciclo (subgoal activo -> emergencia -> prioridades -> fallback),  
    - manejo de `handlePhaseActionResult`,  
    - contabilidad de ciclos por ms (3m = 1 ciclo),  
    - creación/resolución de subgoals,  
    - resolver de prerequisitos/research/storage.
  - Lo específico de tribu: solo tablas/config (prioridades de construcción/reclutamiento, gates de transición, thresholds).

- **4) Migrar por bloques, no todo junto**
  - Primero unificar: subgoals + errores recuperables + ciclos.
  - Luego unificar: construcción/reclutamiento por prioridades.
  - Después: transiciones de fase y telemetría.
  - Cada bloque con tests verdes antes de pasar al siguiente.

- **5) Doble validación (clave anti-regresión)**
  - **Contract tests** compartidos para ambas tribus (mismos casos, resultados esperados por tribu).
  - **Scenario tests** de bloqueo real: `RESEARCH_REQUIRED`, `PREREQUISITES_NOT_MET`, `INSUFFICIENT_RESOURCES` por capacidad, `QUEUE_FULL`.
  - **Replay/harness determinista** con seed fija y comparación de KPIs entre versión vieja y nueva.

- **6) Compatibilidad de estado guardado**
  - Mantener migraciones en `hydrate/serialize` para evitar romper partidas (como el cambio `total -> totalMs` en ciclos).
  - Sin esto, aparecen regresiones “fantasma” al cargar saves antiguos.

- **7) Rollout controlado**
  - Activar runtime unificado detrás de feature flag por tribu.
  - Primero Egyptians (más reciente), luego Germans.
  - Si algo diverge en métricas, rollback rápido solo del flag.

**Resultado esperado**
- Un solo “motor” real compartido.
- Dos “plantillas de tribu” (Germans/Egyptians) con diferencias estratégicas, no estructurales.
- Menos bugs asimétricos y mantenimiento mucho más simple.

Si quieres, en el siguiente paso te propongo una matriz exacta de tests mínimos obligatorios (checklist de release) para declarar “convergencia segura” completada.

---

