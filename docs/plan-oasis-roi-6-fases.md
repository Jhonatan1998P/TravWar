# Plan Preciso de Oasis ROI (6 Fases)

## Objetivo

Implementar un sistema donde:

- El oasis genera y regenera bestias (no recursos pasivos).
- La ganancia sale de matar bestias.
- El jugador no recibe ROI ni recomendaciones en UI (debe calcularlo por su cuenta).
- La IA ataca oasis en orden de mayor rendimiento y nunca ataca si el rendimiento esperado no es positivo.

---

## Variables y notacion comun

Para mantener consistencia en las 6 fases, estas formulas se reutilizan:

- `i`: tipo de bestia.
- `killed_i`: cantidad estimada (o real, segun fase) de bestias tipo `i` que mueren.
- `V_i`: valor economico por bestia `i`.
- `LossValue`: valor economico esperado de tropas propias perdidas.
- `TravelCost`: costo por tiempo/distancia del viaje.
- `RewardGross`: recompensa bruta por bajas de bestias.
- `RewardNet`: recompensa neta esperada.
- `ROI`: rendimiento relativo.

Formulas base:

1. `V_i = upkeep_i * M_oasis * D_i`
   - `upkeep_i`: upkeep de la bestia.
   - `M_oasis`: multiplicador global de recompensa de oasis.
   - `D_i`: factor de dificultad de bestia (1.0 facil, >1.0 dura).

2. `RewardGross = SUM(killed_i * V_i)`

3. `RewardNet = RewardGross - LossValue - TravelCost`

4. `ROI = RewardNet / max(LossValue + TravelCost, 1)`

Reglas duras globales:

- Atacar solo si `RewardNet > 0`.
- Priorizar el oasis con mayor `RewardNet` (si empate, menor distancia).
- No exponer `RewardNet`, `ROI`, ni estimaciones en UI del jugador.

---

## Fase 1: Modelo economico por bestia

### Objetivo de fase

Definir el valor de cada bestia para que la recompensa dependa del riesgo real.

### Formula de fase

- Valor unitario de bestia:
  - `V_i = upkeep_i * M_oasis * D_i`

- Recompensa por batalla (solo bestias):
  - `RewardGross = SUM(killed_i * V_i)`

### Parametros iniciales sugeridos

- `M_oasis = 260` (alineado al multiplicador actual).
- Tabla sugerida `D_i`:
  - Rata/Araña/Serpiente/Murcielago: `1.00`
  - Jabali/Lobo: `1.10`
  - Oso/Tigre/Cocodrilo: `1.25`
  - Elefante: `1.50`

### Ejemplo rapido

Si se matan 20 ratas (upkeep 1) y 5 osos (upkeep 3):

- `V_rata = 1 * 260 * 1.00 = 260`
- `V_oso = 3 * 260 * 1.25 = 975`
- `RewardGross = (20 * 260) + (5 * 975) = 5,200 + 4,875 = 10,075`

### Criterio de salida

- Existe una tabla unica y estable de valor por bestia reutilizable por combate e IA.

---

## Fase 2: Simulacion de escuadra y bajas esperadas

### Objetivo de fase

Calcular, para cada oasis, que composicion y cantidad de tropas produce mejor rendimiento esperado.

### Proceso

Para cada oasis candidato:

1. Generar `N` escuadras candidatas (ligera, media, pesada, mixta rapida, etc.).
2. Simular combate por escuadra y obtener:
   - `killed_i_est` (bestias que probablemente mueren).
   - `lost_u_est` (tropas propias esperadas a perder por unidad `u`).
3. Calcular economia por escuadra.

### Formulas de fase

- `RewardGross_est = SUM(killed_i_est * V_i)`
- `LossValue = SUM(lost_u_est * Cost_u_total)`
- `TravelCost = Distance * C_dist + TravelTime_min * C_time`
- `RewardNet = RewardGross_est - LossValue - TravelCost`

### Parametros iniciales sugeridos

- `C_dist = 8`
- `C_time = 15`

### Ejemplo rapido

- Escuadra A: `RewardGross_est=12000`, `LossValue=3000`, `TravelCost=900`
- `RewardNet_A = 12000 - 3000 - 900 = 8100`

- Escuadra B: `RewardGross_est=16000`, `LossValue=9000`, `TravelCost=1200`
- `RewardNet_B = 16000 - 9000 - 1200 = 5800`

Resultado: gana A aunque mate menos bestias, porque rinde mejor.

### Criterio de salida

- Cada oasis tiene una escuadra optima con `RewardNet` calculado.

---

## Fase 3: Regla de decision IA y priorizacion estricta

### Objetivo de fase

Forzar a la IA a elegir solo objetivos rentables y en orden de maximo rendimiento.

### Algoritmo de seleccion

1. Construir lista de oasis alcanzables.
2. Para cada oasis, calcular su mejor escuadra y `RewardNet`.
3. Filtrar: conservar solo oasis con `RewardNet > 0`.
4. Ordenar por:
   - Mayor `RewardNet`.
   - Menor distancia en empate.
5. Atacar en ese orden mientras haya tropas disponibles.

### Reglas duras

- Si no hay oasis con `RewardNet > 0`, no atacar.
- No permitir ataque por heuristica si no supera rentabilidad.
- No atacar oasis de menor rendimiento si uno mayor aun es viable.

### Ejemplo rapido

Ranking esperado:

- Oasis X: `RewardNet = 9,500`
- Oasis Y: `RewardNet = 5,200`
- Oasis Z: `RewardNet = -400`

Orden final IA: `X -> Y` y `Z` se descarta siempre.

### Criterio de salida

- Logs IA muestran prioridad por `RewardNet` y rechazo explicito de neto <= 0.

---

## Fase 4: Regeneracion y sostenibilidad del oasis

### Objetivo de fase

Evitar farm infinito y mantener ciclos de oportunidad.

### Variables de fase

- `Pressure_o`: presion reciente sobre oasis `o` (0..1).
- `RegenBase`: regeneracion base por ciclo.
- `RegenFactor`: factor por estado.

### Formulas de fase

- Actualizacion de presion (por ventana temporal):
  - `Pressure_o = clamp( AttacksRecent_o / AttackRef, 0, 1 )`

- Regeneracion efectiva:
  - `RegenEff = RegenBase * (1 - alpha * Pressure_o)`

- `alpha` sugerido: `0.6`

Interpretacion:

- Si hay mucho farm reciente, regenera menos (baja rentabilidad temporal).
- Si baja la presion, el oasis se recupera y vuelve a ser objetivo atractivo.

### Ejemplo rapido

- `RegenBase = 10`, `Pressure_o = 0.5`, `alpha = 0.6`
- `RegenEff = 10 * (1 - 0.6*0.5) = 10 * 0.7 = 7`

### Criterio de salida

- El mismo oasis no mantiene rentabilidad maxima continua cuando se sobreexplota.

---

## Fase 5: Integracion con jugador sin UI de ROI

### Objetivo de fase

Cumplir tu requisito: jugador sin calculos asistidos en UI; IA optimizada internamente.

### Reglas de presentacion

- UI jugador SI muestra:
  - tipo de oasis,
  - composicion visible de bestias,
  - reportes de bajas y botin.

- UI jugador NO muestra:
  - `RewardNet` estimado,
  - `ROI` estimado,
  - sugerencias de "mejor oasis".

### Reglas internas

- Los calculos de fase 2 y 3 existen solo para IA y motor.
- Los reportes al jugador muestran resultado real post-batalla, no recomendacion previa.

### Ejemplo rapido

- Jugador ve dos oasis con bestias distintas y decide manualmente.
- IA internamente decide `X` porque `RewardNet_X > RewardNet_Y > 0`.

### Criterio de salida

- No existe ningun elemento visual de "rentabilidad esperada" para jugador.

---

## Fase 6: Balance, telemetria y umbrales finales

### Objetivo de fase

Cerrar el sistema con tuning cuantitativo para que no sea ni trivial ni castigador.

### Metricas a observar

- `% ataques IA a oasis con RewardNet <= 0` (objetivo: 0%).
- `RewardNet medio por ataque IA` (objetivo: > 0 estable).
- `LossValue / RewardGross` promedio (objetivo: rango sano, ej. 0.20-0.65).
- Distribucion de objetivos (que no sea siempre el mismo oasis).

### Ajustes finos

- Si IA evita casi todo: bajar `C_dist`/`C_time` o subir `M_oasis`.
- Si IA farmea demasiado facil: subir `alpha` o subir `D_i` de bestias duras.
- Si hay snowball excesivo: reducir `M_oasis` o endurecer perdida esperada.

### Ejemplo de validacion

- En 200 decisiones IA:
  - 150 ataques, 50 skips.
  - 0 ataques con `RewardNet <= 0`.
  - `RewardNet` medio positivo y estable.
  - Rotacion de oasis en vez de un unico objetivo fijo.

### Criterio de salida

- Sistema estable en simulaciones largas y con comportamiento coherente de IA.

---

## Checklist final de fases

Marca cada fase cuando este implementada y validada:

- [x] Fase 1 completada: tabla economica por bestia definida y activa.
- [x] Fase 2 completada: simulacion de escuadras y `RewardNet` por oasis.
- [x] Fase 3 completada: IA prioriza por rendimiento y rechaza neto <= 0.
- [x] Fase 4 completada: regeneracion afectada por presion/farm reciente.
- [x] Fase 5 completada: jugador sin UI de ROI ni recomendaciones.
- [x] Fase 6 completada: balance final con telemetria y umbrales estables.

Estado global actual:

- [x] Plan implementado de extremo a extremo.
