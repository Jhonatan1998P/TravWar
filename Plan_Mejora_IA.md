# Plan de Mejora de IA - TravWar
## De IA Competente a Jugador Experto de Travian

**Fecha:** 2026-05-03  
**Versión:** 1.0  
**Autor:** OpenCode AI  
**Base de Análisis:** Repo TravWar (commit `88efea4`)

---

## 1. Diagnóstico Ejecutivo

TravWar cuenta con una arquitectura de IA sólida, bien modularizada y funcional, pero que opera como un **"jugador competente"** en lugar de un **"jugador experto de Travian"**. La diferencia está en las micro-decisiones defensivas (timing, snipes, detección de fakes), la macro ofensiva (coordinación de aterrizaje, farmlists, especialización de aldeas) y la gestión económica avanzada.

### 1.1 Fortalezas Actuales
- Motor de fases por tribu (Germano 5 fases ofensivas, Egipcio 5 fases defensivas).
- Sistema reactivo de defensa (`controller/reactive.js`) con dodge, refuerzos propios y contraataques.
- Sistema de contratos de combate (`villageCombatState`) que bloquea ofensiva bajo amenaza.
- Scouting inteligente con TTL adaptativo y re-espionaje prioritario.
- Motor de farming con ROI para oasis y raids a aldeas.
- Lógica de Némesis con selección, seguimiento y aniquilación.
- Gate de ataque estratégico con probabilidad y cooldown.
- Budget económico/militar separado con rebalancing.

### 1.2 Debilidades Críticas
1. **Defensa pasiva:** No snipea, no detecta fakes, no esconde recursos, no evacúa a aldeas propias.
2. **Ofensiva predecible:** Sin fake attacks, sin coordinación de aterrizaje, sin farmlists persistentes.
3. **Sin especialización de aldeas:** Toda aldea sigue la misma plantilla de fase.
4. **Arquetipos desconectados:** `rusher`, `boomer`, `turtle` no afectan a los motores de fase germano/egipcio.
5. **Sin gestión avanzada:** No celebra fiestas, no usa NPC trading, no garantiza colas 24/7.
6. **Némesis aleatorio:** No evalúa distancia, agrupación ni vulnerabilidad real.
7. **Dificultad hardcodeada:** Solo existe `Pesadilla`; no hay escalado real de dificultad.

---

## 2. Filosofía de Diseño

> **No reescribir desde cero.** Se aprovecha la arquitectura existente (`AIController.js`, `StrategicAI.js`, `controller/reactive.js`, motores de fase) e inyectan **capas de inteligencia expertas** que actúan como middleware sobre el flujo actual.

### Principios
1. **Mínima intrusión:** Cada mejora debe ser un módulo que se conecta a los hooks existentes (ciclos económico/militar, eventos reactivos, gates de ataque).
2. **Configurabilidad:** Todo parámetro experto debe ser ajustable por dificultad y arquetipo.
3. **Observabilidad:** Logging detallado para depurar decisiones expertas.
4. **Progresivo:** Implementación por sprints, validando cada módulo antes de pasar al siguiente.

---

## 3. Plan Detallado por Fases

---

### 🛡️ FASE 1: Defensa Experta (Prioridad CRÍTICA)

#### 1.1 Detección de Fakes
**Estado:** No implementado.  
**Descripción:** Clasificar cada movimiento entrante como `fake` o `hammer` para decidir si gastar recursos defensivos.

**Criterios de Fake:**
- 1 unidad total en el movimiento.
- Raid (no ataque) con menos de 5 unidades.
- Sin unidades de asedio (ariete/catapulta).
- Tiempo de viaje inconsistente con tropas de asedio.

**Comportamiento esperado:**
- Fakes: No dodge, no refuerzo, no esconder recursos. Solo loggear.
- Hammers: Activar protocolo de defensa completo.

**Archivos a modificar/crear:**
- `src/features/game/ai/controller/reactive.js` - Agregar `classifyIncomingMovement()` antes de `evaluateThreatAndChooseResponse()`.
- `src/features/game/ai/controller/reactive.js` - Modificar `chooseResponse()` para ignorar fakes.

**Test de validación:** Enviar 1 tropa raid a IA; no debe reaccionar. Enviar 50 tropas attack; debe reaccionar.

---

#### 1.2 Sniping / Defensa Cronometrada (Timed Defense)
**Estado:** No implementado.  
**Descripción:** Enviar refuerzos desde aldeas propias para que lleguen **1-5 segundos antes** del impacto del ataque enemigo.

**Algoritmo propuesto:**
1. Detectar movimiento hostil con `arrivalTime` conocido.
2. Buscar aldeas propias con tropas defensivas disponibles.
3. Calcular `travelTime` desde cada aldea candidata.
4. Filtrar candidatas donde `arrivalTime - travelTime >= now + bufferMinimo` (ej. 5s).
5. Seleccionar la aldea más cercana que cumpla el timing.
6. Enviar refuerzo programado para que llegue en `arrivalTime - margenSeguro`.

**Comportamiento esperado:**
- La IA oculta sus tropas defensivas hasta el último segundo.
- Si hay múltiples ataques en la misma aldea, intenta snipear cada uno desde aldeas diferentes.
- Si no puede llegar a tiempo, fallback a dodge o hold.

**Archivos a modificar/crear:**
- `src/features/game/ai/controller/reactive.js` - Nuevo método `planSnipeTask()`.
- `src/features/game/ai/AIController.js` - Nuevo procesador `processSnipeTasks()` similar a `processDodgeTasks()`.
- `src/features/game/ai/controller/commands.js` - Verificar que `send_movement` soporta envío programado o inmediato.

**Test de validación:** IA debe enviar tropas defensivas desde Aldea B a Aldea A de forma que `arrivalTime` sea 2s antes del ataque enemigo.

---

#### 1.3 Escondite de Recursos
**Estado:** No implementado.  
**Descripción:** Ante un ataque real (no fake), enviar recursos vía mercaderes a otras aldeas propias para evitar saqueo.

**Algoritmo propuesto:**
1. Si `threatLevel` es `high` o `critical` y el movimiento NO es fake:
   - Calcular `resourcesAtRisk` = recursos actuales - capacidad del escondrijo (`cranny`).
   - Si `resourcesAtRisk > umbralMinimo` (ej. 500 de cada recurso):
     - Buscar aldea propia más cercana con capacidad de almacén disponible.
     - Enviar mercaderes con `send_merchants` transportando el excedente.

**Comportamiento esperado:**
- No enviar mercaderes si la aldea destino no tiene espacio.
- Priorizar aldeas con menor tiempo de viaje.
- Respetar cooldown de mercado para no spammear.

**Archivos a modificar/crear:**
- `src/features/game/ai/controller/reactive.js` - Nuevo método `planResourceEvacuation()`.
- `src/features/game/ai/AIController.js` - Hook en manejo de amenazas altas.

**Test de validación:** Aldea atacada con 10k recursos y cranny nivel 5; debe enviar ~8k recursos a otra aldea propia antes del impacto.

---

#### 1.4 Evacuación Estratégica (Dodge Mejorado)
**Estado:** Parcial (dodge a oasis aleatorios).  
**Descripción:** Cambiar el destino del dodge de "oasis aleatorio" a "aldea propia segura o oasis pre-seleccionado".

**Algoritmo propuesto:**
1. Mantener lista de `safeHavens`: aldeas propias sin amenazas activas, ordenadas por distancia.
2. Si no hay aldeas seguras cercanas, fallback a oasis aleatorio (comportamiento actual).
3. Si el juego lo permite, permitir "ghosting" temporal en aldea de tercero (confederación/aliado).

**Comportamiento esperado:**
- Tropas dodgeadas llegan a una aldea propia donde pueden ser reutilizadas para refuerzos o contraataques.
- No se pierden tropas en oasis donde pueden ser atacadas por bestias u otros jugadores.

**Archivos a modificar/crear:**
- `src/features/game/ai/controller/reactive.js` - Reemplazar lógica de `executeDodge()` para considerar `safeHavens`.

**Test de validación:** Dodge debe enviar tropas a aldea propia si existe dentro de 15 tiles; si no, a oasis.

---

#### 1.5 Forward Defense
**Estado:** No implementado.  
**Descripción:** Pre-posicionar tropas defensivas en aldeas de frontera para reducir tiempos de reacción.

**Algoritmo propuesto:**
1. Identificar `frontierVillages`: aldeas propias con al menos 1 aldea enemiga o del némesis dentro de `searchRadius`.
2. Si una aldea interior tiene exceso de tropas defensivas (por encima de `minDefenseReservePoints`) y una aldea fronteriza tiene déficit:
   - Enviar refuerzo permanente a la fronteriza.
3. Mantener un pool mínimo de tropas defensivas en cada fronteriza.

**Comportamiento esperado:**
- Las aldeas más expuestas tienen más tropas defensivas estacionadas.
- Refuerzos desde aldeas interiores solo se envían si el forward defense no es suficiente.

**Archivos a modificar/crear:**
- `src/features/game/ai/StrategicAI.js` - Nuevo método `_manageForwardDefense()` llamado en cada ciclo militar.
- `src/features/game/ai/controller/reactive.js` - `manageReinforcements()` debe priorizar aldeas fronterizas.

**Test de validación:** Aldea fronteriza debe tener más tropas defensivas que una aldea interior comparable en infraestructura.

---

#### 1.6 Reparación Prioritaria Post-Asedio
**Estado:** No implementado.  
**Descripción:** Tras recibir daño de catapultas, priorizar reparar edificios clave por encima del plan de fases normal.

**Algoritmo propuesto:**
1. En el evento `movement_dispatched` o tras batalla, si edificios fueron dañados:
   - Crear `emergencySubGoal` con prioridad `military_unlock`.
   - Orden de prioridad: `cityWall` > `barracks` > `granary` > `warehouse` > `mainBuilding`.
2. El motor de fases debe procesar este subgoal antes que otros pasos de construcción.

**Comportamiento esperado:**
- Muralla dañada se reconstruye inmediatamente.
- No se deja el cuartel bajo nivel por falta de slots mientras hay recursos.

**Archivos a modificar/crear:**
- `src/features/game/ai/controller/german-phase-engine.js` y `egyptian-phase-engine.js` - Hooks post-batalla.
- `src/features/game/ai/controller/phase-engine-common.js` - Permitir subgoals de emergencia con prioridad máxima.

**Test de validación:** Tras daño de catapulta a muralla nivel 10, la IA debe ponerla en cola de construcción en el siguiente tick.

---

### ⚔️ FASE 2: Ofensiva Inteligente

#### 2.1 Fake Attacks / Feints
**Estado:** No implementado.  
**Descripción:** Enviar raids de 1 unidad (o pocos scouts) a múltiples aldeas enemigas junto con el ataque real para confundir la defensa enemiga.

**Algoritmo propuesto:**
1. Cuando se planea un ataque estratégico (némesis, asedio, etc.):
   - Identificar `decoyTargets`: aldeas enemigas cercanas al objetivo real (dentro de 5-10 tiles).
   - Para cada decoy, enviar 1 unidad de infantería barata (ej. `clubswinger` para germanos) en raid.
   - Sincronizar `arrivalTime` de fakes para que lleguen **antes o al mismo tiempo** que el ataque real.

**Comportamiento esperado:**
- El enemigo ve múltiples ataques y no sabe cuál es el real.
- Fakes usan unidades de bajo costo (no scouts, que son más valiosos).
- Si no hay unidades baratas disponibles, no se envían fakes.

**Archivos a modificar/crear:**
- `src/features/game/ai/StrategicAI.js` - Nuevo método `_planFakeAttacks(realAttackCmd)`.
- `src/features/game/ai/controller/commands.js` - Enviar múltiples movimientos.

**Test de validación:** Ataque real a aldea X; debe haber 2-4 raids de 1 unidad a aldeas vecinas de X con arrivalTime similar.

---

#### 2.2 Coordinación de Aterrizaje (Landing Time / Waves)
**Estado:** No implementado.  
**Descripción:** Sincronizar ataques desde múltiples aldeas para que lleguen en el mismo segundo contra el mismo objetivo.

**Algoritmo propuesto:**
1. Al planear un asalto multi-aldea:
   - Calcular `arrivalTimeDeseado` = `now + tiempoMaximoDeViaje`.
   - Para cada aldea atacante, calcular `delayNecesario` = `arrivalTimeDeseado - (now + travelTime)`.
   - Si `delayNecesario > 0`, el juego debe soportar envío programado/delay. Si no, enviar inmediatamente y aceptar dispersión.
   - Alternativa: enviar todos los movimientos para que el más lento llegue primero, y los demás se ajusten.

**Comportamiento esperado:**
- 2-4 aldeas atacan el mismo objetivo con arrivalTime diferencia < 2 segundos.
- Esto rompe snipes del enemigo que solo pueden defender 1 ataque a la vez.

**Archivos a modificar/crear:**
- `src/features/game/ai/StrategicAI.js` - `_planNemesisDestruction()` y `_planDoctrinalStrategicOffense()` deben considerar multi-village.
- `src/features/game/state/worker/commands.js` - Verificar soporte para `sendAt` o delay en movimientos.

**Test de validación:** Dos aldeas atacan objetivo X; arrivalTimes deben coincidir en ±1s.

---

#### 2.3 Farmlists Persistentes
**Estado:** No implementado.  
**Descripción:** Crear y mantener listas de granjas inactivas/debiles que se farmean sistemáticamente, no solo por scan de radio.

**Algoritmo propuesto:**
1. Cada vez que se obtiene intel de una aldea enemiga:
   - Si `troopCount == 0` y `population < umbralBajo` y `resourceTotal > umbralMinimo`:
     - Agregar a `farmList` con coordenadas, último loot estimado, y frecuencia óptima.
2. En cada ciclo militar, dedicar un % de tropas ofensivas a farmear `farmList`.
3. Rotar granjas para no sobre-farmear (si reporte muestra 0 recursos, reducir frecuencia).
4. Eliminar granjas que se vuelven activas (aparecen tropas) o muy lejanas.

**Comportamiento esperado:**
- IA tiene 10-50 granjas persistentes que farmea con raids automáticos cada 30-120 minutos.
- No gasta tiempo re-evaluando oasis/aldeas si ya tiene granjas probadas.
- Prioriza granjas con mejor ratio `loot / (travelTime * troopCost)`.

**Archivos a modificar/crear:**
- `src/features/game/ai/aiState/` o `MemoryManager.js` - Persistir `farmList` en `aiState`.
- `src/features/game/ai/StrategicAI.js` - Nuevo método `_runFarmListCycle()`.
- `src/features/game/ai/strategy/farming.js` - Integrar `farmList` con `performOptimizedFarming()`.

**Test de validación:** IA debe enviar raids repetidos a las mismas 5 aldeas inactivas cada ciclo militar.

---

#### 2.4 Némesis Inteligente
**Estado:** Implementado pero aleatorio.  
**Descripción:** Seleccionar némesis basado en métricas estratégicas, no aleatoriedad.

**Algoritmo propuesto:**
```javascript
scoreNemesisCandidate(candidate) {
  const dist = minDistanceToAnyMyVillage(candidate);
  const pop = candidate.population;
  const villages = candidate.villageCount;
  const clusterScore = howClusteredAreVillages(candidate); // más agrupado = mejor
  const allianceStrength = getAllianceStrength(candidate.allianceId); // más débil = mejor
  const farmableScore = countKnownInactiveVillages(candidate);

  return (
    (1000 / (dist + 1)) * 0.30 +       // cercanía (30%)
    (pop * 0.01) * 0.15 +              // población (15%)
    (villages * 10) * 0.15 +           // aldeas (15%)
    (clusterScore * 50) * 0.20 +       // agrupación (20%)
    (100 / (allianceStrength + 1)) * 0.10 + // alianza débil (10%)
    (farmableScore * 5) * 0.10         // granjas disponibles (10%)
  );
}
```

**Comportamiento esperado:**
- Némesis es un jugador cercano, con aldeas agrupadas, de alianza débil, con granjas inactivas.
- No elige al jugador más fuerte del mapa.
- Si el némesis actual se vuelve invencible o muy lejano tras expansión, re-evaluar.

**Archivos a modificar/crear:**
- `src/features/game/ai/strategy/nemesis.js` - Reemplazar `Math.random()` por scoring.
- `src/features/game/ai/strategy/nemesis.js` - Agregar `reevaluateNemesis()` cada N ciclos.

**Test de validación:** Con 3 candidatos a némesis a distancias 10, 30, 50 tiles, debe elegir el de 10 tiles si el resto de scores es comparable.

---

#### 2.5 Especialización de Aldeas (Roles)
**Estado:** No implementado.  
**Descripción:** Diferenciar roles de aldea para optimizar economía y militar.

**Roles propuestos:**

| Rol | Descripción | Motor de Fase | Prioridad de Tropas |
|-----|-------------|---------------|---------------------|
| **Capital** | Cropper (9c/15c), economía pura, NPC trading, fiestas. | Fase económica agresiva, pocas tropas. | Defensivas mínimas. |
| **Hammer** | Producción masiva de tropas ofensivas, GB/GS si existe. | Fase militar agresiva, Great Barracks/Stable. | 100% ofensivas. |
| **Anvil** | Producción de tropas defensivas, envía refuerzos a otras aldeas. | Fase defensiva egipcia adaptada. | 100% defensivas. |
| **Support** | Mixta, produce recursos y tropas auxiliares. | Fase balanceada estándar. | Mixta según necesidad. |

**Asignación de roles:**
1. Aldea con más campos de cereal (o mejor producción) -> Capital.
2. Aldea con mayor potencial de cuartel/establo -> Hammer.
3. Aldea con buena muralla y posición central -> Anvil.
4. Resto -> Support.

**Comportamiento esperado:**
- Capital no envía tropas ofensivas; su ejército es mínimo.
- Hammer no gasta recursos en muralla ni defensivos; todo a tropas.
- Anvil no ataca; solo defiende y refuerza.

**Archivos a modificar/crear:**
- `src/features/game/ai/AIController.js` - Nuevo método `_assignVillageRoles()`.
- `src/features/game/ai/controller/german-phase-engine.js` / `egyptian-phase-engine.js` - Aceptar `villageRole` como parámetro.
- `src/features/game/ai/controller/tribe-phase-profiles/` - Crear perfiles `capital.profile.js`, `hammer.profile.js`, `anvil.profile.js`.

**Test de validación:** Capital debe tener ratio económico 80/20; Hammer 20/80.

---

#### 2.6 Gestión de Héroe (si existe)
**Estado:** Héroe no detectado en motor de juego.  
**Descripción:** Si el juego implementa héroes, enviarlos en hammers ofensivos, aventuras cuando seguro, y equipamiento según rol.

**Comportamiento esperado (futuro):**
- Héroe en aldea Hammer: equipamiento de ataque, acompaña hammers.
- Héroe en aldea Anvil: equipamiento de defensa, se queda para bonus.
- Aventuras: solo cuando no hay amenazas activas y el héroe está en aldea segura.

**Archivos a modificar/crear:**
- Pendiente a implementación de sistema de héroe en motor.

---

### 🏛️ FASE 3: Macro-Economía y Gestión Avanzada

#### 3.1 Colas 24/7
**Estado:** Parcial (recruitment adaptativo pero no garantizado).  
**Descripción:** Garantizar que cuartel, establo y taller nunca estén vacíos si hay recursos.

**Algoritmo propuesto:**
1. En cada tick económico, verificar `recruitmentQueue` de cada edificio militar.
2. Si la cola está vacía o termina en menos de `bufferTiempo` (ej. 60s):
   - Revisar si hay recursos (`budget.mil`) para el batch más pequeño (1 unidad).
   - Si sí, encolar inmediatamente.
   - Si no, intentar `budgetBorrow` o `budgetExchange`.
3. Para aldeas Hammer: considerar Great Barracks / Great Stable si existen y hay recursos.

**Comportamiento esperado:**
- Cuartel nivel 20 en Hammer siempre tiene al menos 1 tropa en cola.
- No hay "tiempo muerto" de producción por falta de micro-gestión.

**Archivos a modificar/crear:**
- `src/features/game/ai/action-executor/recruitment.js` - Nuevo método `ensureQueueNeverEmpty()`.
- `src/features/game/ai/controller/german-phase-engine.js` - Llamar después del lane de reclutamiento.

**Test de validación:** Cola de cuartel vacía + recursos suficientes -> debe encolar 1 unidad en el siguiente tick.

---

#### 3.2 NPC Trading
**Estado:** No implementado.  
**Descripción:** Convertir excedentes de un recurso en recursos faltantes vía NPC trading (si el juego lo permite).

**Algoritmo propuesto:**
1. Si un recurso excede `capacidad * 0.9` y otro recurso está por debajo de `capacidad * 0.3`:
   - Usar NPC para equilibrar (ej. exceso de madera -> hierro/comida).
2. Priorizar NPC cuando hay cola de tropas/detención bloqueada por un recurso faltante.

**Comportamiento esperado:**
- No se desperdicia producción por almacén lleno.
- Colas de tropas no se detienen por desbalance de recursos.

**Archivos a modificar/crear:**
- Pendiente a implementación de mecánica de NPC en motor.

---

#### 3.3 Celebraciones (Fiestas)
**Estado:** No implementado.  
**Descripción:** Gestionar fiestas pequeñas y grandes para puntos de cultura y slots de expansión.

**Algoritmo propuesto:**
1. Si aldea Capital tiene edificio `townHall`:
   - Mantener fiesta pequeña activa siempre que `culturePoints < nextExpansionSlot`.
   - Fiesta grande cuando se acerque un slot crítico y haya recursos de sobra.
2. Aldeas Support pueden celebrar fiestas pequeñas periódicamente.

**Comportamiento esperado:**
- Capital genera cultura constantemente para expandir.
- No se gasta en fiestas si hay amenazas críticas o economía en recuperación.

**Archivos a modificar/crear:**
- Pendiente a implementación de mecánica de fiestas en motor.

---

#### 3.4 Mercado Dinámico (Inter-Aldea)
**Estado:** Parcial (`executeRebalanceResources`).  
**Descripción:** Enviar recursos entre aldeas propias automáticamente para equilibrar déficits.

**Algoritmo propuesto:**
1. Cada tick económico:
   - Identificar aldeas con excedente de recurso X (> 70% capacidad).
   - Identificar aldeas con déficit de recurso X (< 30% capacidad) y cola de construcción/reclutamiento bloqueada.
   - Emparejar origen-destino minimizando distancia.
   - Enviar mercaderes con `send_merchants`.

**Comportamiento esperado:**
- Hammer no se queda sin hierro porque la Capital le envía.
- Capital no se queda sin madera/piedra porque las Support le envían excedentes.

**Archivos a modificar/crear:**
- `src/features/game/ai/action-executor/goal-actions.js` - Mejorar `executeRebalanceResources()`.
- `src/features/game/ai/AIController.js` - Hook en ciclo económico.

**Test de validación:** Aldea A con 10k madera, Aldea B con 0 madera y cola bloqueada -> mercaderes deben moverse de A a B.

---

### 🏗️ FASE 4: Arquitectura, Dificultad y Arquetipos

#### 4.1 Conexión Arquetipos ↔ Motor de Fase
**Estado:** Desconectado.  
**Descripción:** Los arquetipos (`rusher`, `boomer`, `turtle`) deben influir en el perfil de fase seleccionado.

**Algoritmo propuesto:**
```javascript
resolvePhaseProfile(race, archetype) {
  if (race === 'germans') {
    if (archetype === 'turtle') return GERMAN_DEFENSIVE_PROFILE;
    if (archetype === 'boomer') return GERMAN_BALANCED_PROFILE;
    return GERMAN_OFFENSIVE_PROFILE; // rusher / default
  }
  if (race === 'egyptians') {
    if (archetype === 'rusher') return EGYPTIAN_OFFENSIVE_PROFILE;
    return EGYPTIAN_DEFENSIVE_PROFILE; // turtle / boomer / default
  }
  // ... otras tribus
}
```

**Perfiles necesarios:**
- `germans.defensive.profile.js` (enfoque en muralla, tropas defensivas, menos carga ofensiva).
- `germans.balanced.profile.js` (mixto, salida de fase 1 más lenta pero más segura).
- `egyptians.offensive.profile.js` (sorprendente: egipcios con establo temprano y presión media).

**Archivos a modificar/crear:**
- `src/features/game/ai/controller/tribe-phase-profiles/` - Nuevos perfiles.
- `src/features/game/ai/controller/german-phase-engine.js` - Usar `resolvePhaseProfile()`.
- `src/features/game/ai/AIPersonality.js` - Asegurar que `archetype` se propague.

**Test de validación:** Germano con archetype `turtle` debe construir muralla antes que establo, y reclutar `spearman` defensivo.

---

#### 4.2 Memoria a Largo Plazo de Enemigos
**Estado:** Parcial (`MemoryManager` detecta `baiting_trap`).  
**Descripción:** Registrar y modelar patrones de cada jugador enemigo.

**Datos a registrar por enemigo:**
- Horarios de actividad (rangos de tiempo donde ataca/espía).
- Composición típica de ejército (infantería vs caballería).
- Frecuencia de fakes vs ataques reales.
- Patrón de dodge (¿siempre envía a oasis norte? ¿evacúa?).
- Alianzas y comportamiento diplomático.

**Uso:**
- Predicción de ataques ("Jugador X suele atacar entre las 02:00-04:00").
- Counter-intel ("Jugador Y nunca defiende con caballería" -> enviar solo infantería).

**Archivos a modificar/crear:**
- `src/features/game/ai/MemoryManager.js` - Expandir con `EnemyBehaviorModel`.
- `src/features/game/ai/StrategicAI.js` - Consultar memoria antes de planear ataques.

**Test de validación:** Tras 3 ataques de infantería del mismo enemigo, la IA debe preferir defender con `praetorian` (anti-inf) en lugar de `legionnaire`.

---

#### 4.3 Dificultad Real (Fácil / Medio / Difícil / Pesadilla)
**Estado:** Hardcodeado a `Pesadilla`.  
**Descripción:** Implementar escalado real de dificultad.

**Parámetros escalables:**

| Parámetro | Fácil | Medio | Difícil | Pesadilla |
|-----------|-------|-------|---------|-----------|
| `decisionInterval` | 15s | 8s | 4s | 2s |
| `strategicAttackGate.baseProbability` | 0.05 | 0.08 | 0.10 | 0.15 |
| `strategicAttackGate.maxProbability` | 0.20 | 0.30 | 0.40 | 0.50 |
| `nemesisBonus` | 0.02 | 0.05 | 0.08 | 0.10 |
| `fakeDetection.enabled` | false | false | true | true |
| `sniping.enabled` | false | false | true | true |
| `landingCoordination.enabled` | false | false | false | true |
| `farmList.maxTargets` | 5 | 10 | 15 | 25 |
| `budgetBorrow.probability` | 0.05 | 0.10 | 0.15 | 0.20 |
| `phaseCycleTargets.multiplier` | 0.5x | 0.75x | 1.0x | 1.25x |
| `reactive.dodge.aggressiveness` | 0.3 | 0.5 | 0.7 | 0.9 |

**Archivos a modificar/crear:**
- `src/features/game/ai/AIPersonality.js` - Definir templates por dificultad.
- `src/features/game/ai/AIController.js` - Usar `this._difficulty` real (quitar hardcodeo).
- Todos los módulos expertos deben consultar `difficultyConfig` antes de activarse.

**Test de validación:** En dificultad Fácil, IA no debe snipear ni detectar fakes; en Pesadilla, sí.

---

## 4. Roadmap de Implementación

### Sprint 1: Defensa Básica Experta (1-2 semanas)
- [ ] 1.1 Detección de Fakes
- [ ] 1.3 Escondite de Recursos
- [ ] 1.4 Evacuación Estratégica (Dodge a aldeas propias)
- [ ] 1.6 Reparación Prioritaria Post-Asedio

### Sprint 2: Defensa Avanzada (2-3 semanas)
- [ ] 1.2 Sniping básico (1 origen -> 1 objetivo)
- [ ] 1.5 Forward Defense básico
- [ ] 1.2 Sniping avanzado (múltiples orígenes)

### Sprint 3: Ofensiva Inteligente (2-3 semanas)
- [ ] 2.1 Fake Attacks
- [ ] 2.3 Farmlists Persistentes
- [ ] 2.4 Némesis Inteligente

### Sprint 4: Coordinación y Macro (2-3 semanas)
- [ ] 2.2 Landing Time Coordination
- [ ] 3.1 Colas 24/7
- [ ] 3.4 Mercado Dinámico

### Sprint 5: Especialización y Arquitectura (3-4 semanas)
- [ ] 2.5 Especialización de Aldeas (Capital/Hammer/Anvil/Support)
- [ ] 4.1 Conexión Arquetipos ↔ Phase Engine
- [ ] 4.3 Dificultad Real

### Sprint 6: Inteligencia Predictiva (2-3 semanas)
- [ ] 4.2 Memoria a Largo Plazo
- [ ] 2.6 Gestión de Héroe (si aplica)
- [ ] 3.2 NPC Trading (si aplica)
- [ ] 3.3 Celebraciones (si aplica)

**Estimación total:** 12-18 semanas de desarrollo iterativo.

---

## 5. Métricas de Éxito

### Defensa
- [ ] % de fakes detectados correctamente > 90%.
- [ ] % de ataques reales donde se activó defensa > 95%.
- [ ] Tiempo promedio de snipe antes del impacto: 2-5s.
- [ ] Recursos salvados por escondite vs saqueo: > 70%.

### Ofensiva
- [ ] Fakes enviados junto a cada ataque estratégico: 2-4.
- [ ] Coordinación de landing time: ±2s para ataques multi-aldea.
- [ ] Granjas persistentes activas: 10-50 según fase.
- [ ] Tiempo medio para eliminar némesis: reducir en 30% vs aleatorio.

### Económica
- [ ] Tiempo de cola vacía en Hammer: < 1% del tiempo.
- [ ] Ratio económico respetado según rol de aldea: desviación < 5%.

---

## 6. Archivos Clave del Proyecto (Referencia)

| Archivo | Rol |
|---------|-----|
| `src/features/game/ai/AIController.js` | Orquestador central, ciclo de decisión, contratos de combate. |
| `src/features/game/ai/StrategicAI.js` | General militar: nemesis, farming, scouting, asedios, gates. |
| `src/features/game/ai/controller/reactive.js` | Cerebro defensivo: dodge, refuerzos, contraataques, evaluación de amenaza. |
| `src/features/game/ai/controller/german-phase-engine.js` | Motor de fase germano (5 fases ofensivas). |
| `src/features/game/ai/controller/egyptian-phase-engine.js` | Motor de fase egipcio (5 fases defensivas). |
| `src/features/game/ai/controller/phase-engine-common.js` | Infraestructura compartida de fases: subgoals, colas, pasos. |
| `src/features/game/ai/strategy/farming.js` | Farming optimizado con ROI para oasis. |
| `src/features/game/ai/strategy/nemesis.js` | Selección y gestión de némesis. |
| `src/features/game/ai/strategy/scouting.js` | Espionaje inteligente con TTLs. |
| `src/features/game/ai/action-executor/recruitment.js` | Reclutamiento adaptativo, budget borrow. |
| `src/features/game/ai/action-executor/construction.js` | Gestión de colas de construcción. |
| `src/features/game/ai/MemoryManager.js` | Registro de batallas y detección de trampas. |
| `src/features/game/core/CombatFormulas.js` | Fórmulas de combate, muralla, asedio. |
| `src/features/game/engine/CombatEngine.js` | Resolutor de batallas. |
| `src/features/game/state/worker/commands.js` | Handler de comandos del juego (movimientos, comercio). |
| `src/features/game/ai/AIPersonality.js` | Personalidades y arquetipos. |

---

## 7. Notas Finales

Este plan está diseñado para transformar a la IA de TravWar de un **"bot competente"** a un **"jugador veterano de Travian"**. La clave está en la iteración: cada sprint debe incluir pruebas, ajuste de parámetros y validación contra comportamiento humano.

**Próximo paso recomendado:** Definir la prioridad del primer sprint con el equipo y comenzar con la **1.1 Detección de Fakes**, ya que es la base de toda la defensa experta.

---
*Fin del documento.*
