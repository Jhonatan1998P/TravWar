function getTargetTile(gameState, targetCoords) {
    if (!targetCoords) return null;
    const key = `${targetCoords.x}|${targetCoords.y}`;
    return gameState.spatialIndex.get(key)
        || gameState.mapData.find(tile => tile.x === targetCoords.x && tile.y === targetCoords.y)
        || null;
}

function resolveMilitaryIntent(command, gameState, missionType) {
    if (command?.comando !== 'ATTACK') return 'strategic_attack';
    if (missionType !== 'raid') return 'strategic_attack';

    const targetTile = getTargetTile(gameState, command?.parametros?.targetCoords);
    if (targetTile?.type === 'oasis') {
        return 'farming';
    }

    return 'strategic_attack';
}

export function executeCommands({ commands, gameState, sendCommand, log }) {
    for (const command of commands) {
        const { comando, villageId, parametros } = command;
        const village = gameState.villages.find(candidate => candidate.id === villageId);
        if (!village) {
            log('warn', null, 'Comando Invalido', `Aldea origen ${villageId} no encontrada.`, command, 'military');
            continue;
        }

        switch (comando) {
            case 'ATTACK':
            case 'SPY':
            case 'REINFORCE': {
                const invalidTroops = !parametros.tropas ||
                    Object.keys(parametros.tropas).length === 0 ||
                    Object.values(parametros.tropas).every(quantity => quantity <= 0);

                if (invalidTroops) {
                    log('warn', village, 'Comando Invalido', `Intento de ${comando} con 0 tropas.`, command, 'military');
                    continue;
                }

                let missionType;
                if (comando === 'SPY') missionType = 'espionage';
                else if (comando === 'REINFORCE') missionType = 'reinforcement';
                else missionType = parametros.mision;

                const militaryIntent = resolveMilitaryIntent(command, gameState, missionType);

                const result = sendCommand('send_movement', {
                    originVillageId: villageId,
                    targetCoords: parametros.targetCoords,
                    troops: parametros.tropas,
                    missionType,
                    catapultTargets: parametros.catapultTargets || [],
                }, {
                    militaryIntent,
                });

                if (result.success) {
                    log('success', village, 'Comando Enviado', `Orden ${comando} enviada correctamente.`, parametros, 'military');
                } else {
                    log('fail', village, 'Comando Fallido', `Worker rechazo la orden ${comando}. Razon: ${result.reason}`, result.details, 'military');
                }
                break;
            }
        }
    }
}
