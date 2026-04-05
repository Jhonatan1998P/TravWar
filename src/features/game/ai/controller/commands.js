export function executeCommands({ commands, gameState, sendCommand, log }) {
    for (const command of commands) {
        const { comando, villageId, parametros } = command;
        const village = gameState.villages.find(candidate => candidate.id === villageId);
        if (!village) {
            log('warn', null, 'Comando Inválido', `Origin village ${villageId} not found.`, command, 'military');
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
                    log('warn', village, 'Comando Inválido', `Attempted ${comando} with 0 troops.`, command, 'military');
                    continue;
                }

                let missionType;
                if (comando === 'SPY') missionType = 'espionage';
                else if (comando === 'REINFORCE') missionType = 'reinforcement';
                else missionType = parametros.mision;

                const result = sendCommand('send_movement', {
                    originVillageId: villageId,
                    targetCoords: parametros.targetCoords,
                    troops: parametros.tropas,
                    missionType,
                });

                if (result.success) {
                    log('success', village, 'Comando Enviado', `${comando} order sent successfully.`, parametros, 'military');
                } else {
                    log('fail', village, 'Comando Fallido', `Worker rejected the ${comando} order. Reason: ${result.reason}`, result.details, 'military');
                }
                break;
            }
        }
    }
}
