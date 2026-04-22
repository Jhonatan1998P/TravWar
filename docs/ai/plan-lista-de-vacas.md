# Plan de Implementacion: Mecanica "Lista de Vacas"

## Supuestos base

- La **Lista de Vacas** sera global por jugador (owner), no por aldea, pero se ejecuta desde la aldea activa al enviar.
- La mision por defecto sera **`raid`** (asalto), ya que encaja mejor con el concepto de "vacas".
- El cooldown minimo se aplicara por combinacion **`origen + objetivo`**, para evitar spam al mismo target sin bloquear todos los envios globalmente.

---

## Fase 1. Modelo de datos y constantes globales

**Objetivo:** definir la mecanica de forma configurable y persistente.

**Archivos probables:**
- `src/features/game/core/data/constants.js`
- `src/features/game/engine/GameStateFactory.js`

### Que se define

- Limite de `5` listas por jugador.
- Limite de `100` objetivos por lista.
- Cooldown minimo de `30_000 ms`.
- Tipo de mision por defecto.
- Cantidad inicial `1`.
- Resolucion de "primera unidad de la tribu".

### Ejemplo de implementacion

```js
export const FARM_LIST_LIMITS = Object.freeze({
    maxListsPerOwner: 5,
    maxEntriesPerList: 100,
    minDispatchCooldownMs: 30_000,
    defaultUnitCount: 1,
    defaultMissionType: 'raid',
});

export function resolveDefaultFarmUnitId(race) {
    return gameData.units[race]?.troops?.[0]?.id || null;
}
```

### Ejemplo de estado persistido

```js
farmListsByOwnerId: {
    player: {
        lists: [
            {
                id: 'farm_list_1',
                name: 'Oasis cercanos',
                createdAt: 1710000000000,
                updatedAt: 1710000000000,
                entries: [
                    {
                        id: 'entry_1',
                        targetType: 'oasis',
                        targetCoords: { x: 3, y: -7 },
                        troops: { legionnaire: 1 },
                        lastDispatchAtByOrigin: {}
                    }
                ]
            }
        ]
    }
}
```

### Checklist Fase 1

- [x] Constantes globales creadas en un solo punto.
- [x] Estado `farmListsByOwnerId` nace en partida nueva.
- [x] Estado `farmListsByOwnerId` se hidrata al cargar partida guardada.
- [x] La unidad inicial sale siempre de la primera unidad real de la tribu.

---

## Fase 2. Comandos del worker y validaciones de negocio

**Objetivo:** mover toda la logica critica al worker, no a la UI.

**Archivos probables:**
- `src/features/game/state/GameWorker.js`
- `src/features/game/state/worker/commands.js`

### Comandos nuevos recomendados

- `farm_list_create`
- `farm_list_delete`
- `farm_list_rename`
- `farm_list_add_entry_from_tile`
- `farm_list_add_entry_by_coords`
- `farm_list_update_entry_troops`
- `farm_list_remove_entry`
- `farm_list_send_entries`

### Validaciones clave

- No permitir mas de `5` listas.
- No permitir mas de `100` entradas por lista.
- Coordenadas dentro del mapa y existentes.
- Solo `village` enemiga o `oasis`.
- Rechazar aldea propia.
- Rechazar duplicados en la misma lista.
- Aplicar cooldown antes de enviar.
- En envios multiples, procesar secuencialmente para que el consumo real de tropas afecte a las siguientes entradas.

### Ejemplo de resultado por lote

```js
{
    success: true,
    results: [
        { entryId: 'entry_1', success: true, movementId: '...' },
        { entryId: 'entry_2', success: false, reason: 'ENTRY_COOLDOWN' },
        { entryId: 'entry_3', success: false, reason: 'INSUFFICIENT_TROOPS' }
    ]
}
```

### Checklist Fase 2

- [x] Toda validacion vive en worker.
- [x] Las coordenadas invalidas fallan con razon clara.
- [x] No se pueden anadir oasis/aldeas propias.
- [x] El cooldown se cumple aunque el usuario manipule la UI.

---

## Fase 3. Alta desde mapa y modales de tile

**Objetivo:** permitir anadir vacas directamente desde mapa de forma fluida.

**Archivo principal:**
- `src/features/game/ui/TileInfoUI.js`

### UX propuesta

- En oasis o aldea no propia aparece boton `Anadir a Lista de Vacas`.
- Si no existe ninguna lista, se abre selector con creacion rapida.
- Si ya existen listas, se elige destino y se confirma.
- Si el target ya existe en esa lista, mostrar mensaje profesional y no duplicar.

### Ejemplo de flujo

```js
gameManager.sendCommand('farm_list_add_entry_from_tile', {
    ownerId: 'player',
    listId: 'farm_list_1',
    targetCoords: { x: 3, y: -7 }
});
```

### Checklist Fase 3

- [x] Boton visible solo para oasis o aldeas no propias.
- [x] Si no hay listas, se puede crear una desde el modal.
- [x] Si ya hay listas, se puede escoger a cual anadir.
- [x] Se bloquean duplicados en la misma lista.

---

## Fase 4. Gestion completa en Plaza de Reuniones

**Objetivo:** que la Plaza de Reuniones sea el centro de administracion de listas.

**Archivos principales:**
- `src/features/game/ui/BuildingInfoUI.js`
- `src/features/game/ui/renderSelectors.js`

### Implementacion recomendada

- Cuando `this.#viewingType === 'rallyPoint'`, mostrar una pestana o bloque `Lista de Vacas`.
- Desde ahi:
  - Crear/renombrar/eliminar listas.
  - Ver contador `n/100`.
  - Anadir por coordenadas.
  - Seleccionar entradas.
  - Editar tropas por entrada.
  - Enviar seleccionadas.

### Nota tecnica importante

`selectBuildingInfoPanelSignature(...)` hoy no contempla esta nueva data. Si no se amplia con una firma de listas, el panel no rerenderizara correctamente al crear/editar listas.

### Ejemplo de firma

```js
return [
    'visible',
    activeVillage.id,
    resourceSignature(activeVillage.resources),
    farmListsSignature(state.farmListsByOwnerId?.[perspectiveOwnerId]?.lists || [])
].join(':');
```

### Checklist Fase 4

- [x] La Plaza de Reuniones muestra la seccion `Lista de Vacas`.
- [x] Se pueden crear hasta 5 listas.
- [x] Se pueden anadir objetivos por coordenadas validas.
- [x] Se puede editar el preset de tropas por entrada.
- [x] El panel rerenderiza al instante tras CRUD.

---

## Fase 5. Motor de envio, feedback y cooldown profesional

**Objetivo:** que "seleccionar y enviar" funcione con feedback real, no optimista.

**Archivos probables:**
- `src/features/game/state/GameWorker.js`
- `src/features/game/state/GameManager.js`
- `src/features/game/ui/BuildingInfoUI.js`
- `src/features/game/ui/AttackPanelUI.js` (opcional, si se reutilizan ayudas visuales)

### Punto tecnico clave

`gameManager.sendCommand(...)` actualmente es fire-and-forget. Para esta mecanica conviene agregar una respuesta del worker tipo `farm_list:command_result` o `farm_list:send_result` para informar:

- enviados con exito
- entradas en cooldown
- tropas insuficientes
- target protegido
- target ya invalido

### Ejemplo

```js
self.postMessage({
    type: 'farm_list:send_result',
    payload: {
        listId,
        originVillageId,
        results
    }
});
```

### Checklist Fase 5

- [x] El envio muestra resultado real por entrada.
- [x] El cooldown de 30s bloquea correctamente.
- [x] En envios multiples, el consumo de tropas afecta a las siguientes entradas.
- [x] El usuario ve errores claros sin abrir consola.

---

## Fase 6. QA, balance y endurecimiento final

**Objetivo:** cerrar la feature con calidad de produccion.

### Validaciones finales

- Crear la primera lista desde mapa.
- Crear lista desde Plaza de Reuniones.
- Anadir aldea enemiga por coordenadas.
- Anadir oasis por coordenadas.
- Rechazar coordenadas fuera de mapa.
- Rechazar terreno baldio.
- Rechazar aldea propia.
- Respetar maximo 5 listas.
- Respetar maximo 100 entradas por lista.
- Preset inicial `primera unidad x1`.
- Editar tropas por entrada y persistir tras reload.
- Enviar una entrada.
- Enviar varias entradas.
- Reintentar antes de 30s y recibir bloqueo correcto.
- Confirmar que sigue guardando/cargando desde `localStorage`.

### Checklist Fase 6

- [x] No hay regresiones en mapa, worker ni rally point.
- [x] La persistencia sobrevive a recarga.
- [x] Los limites configurables funcionan.
- [x] El flujo completo se siente profesional y consistente.

---

## Checklist final por fase

- [x] Fase 1 cerrada: modelo y constantes.
- [x] Fase 2 cerrada: comandos y validaciones worker.
- [x] Fase 3 cerrada: alta desde mapa.
- [x] Fase 4 cerrada: gestion en Plaza de Reuniones.
- [x] Fase 5 cerrada: envio real con feedback y cooldown.
- [x] Fase 6 cerrada: QA, persistencia y pulido.

---

## Decision base para implementacion

- Listas globales por jugador.
- Mision por defecto `raid`.
- Cooldown configurable por `origen/objetivo`.
