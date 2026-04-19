function applyVillageUpdates(gameState, villageUpdates) {
    villageUpdates.forEach(update => {
        const village = gameState.villages.find(candidate => candidate.id === update.villageId);
        if (!village) return;

        if (update.changes.troopLosses) {
            update.changes.troopLosses.forEach(result => {
                for (const unitId in result.losses) {
                    if (result.id === village.id) {
                        if (village.unitsInVillage[unitId]) village.unitsInVillage[unitId] -= result.losses[unitId];
                    } else {
                        const reinforcement = village.reinforcements.find(item => item.fromVillageId === result.id);
                        if (reinforcement && reinforcement.troops[unitId]) reinforcement.troops[unitId] -= result.losses[unitId];
                    }
                }
            });
            village.reinforcements = village.reinforcements.filter(item => Object.values(item.troops).some(count => count > 0));
        }

        if (update.changes.plunder) {
            for (const resource in update.changes.plunder) {
                village.resources[resource].current -= update.changes.plunder[resource];
            }
        }

        if (update.changes.buildingLevel) {
            const building = village.buildings.find(candidate => candidate.id === update.changes.buildingLevel.buildingId);
            if (building) {
                building.level = update.changes.buildingLevel.newLevel;
                if (update.changes.buildingLevel.newType) {
                    building.type = update.changes.buildingLevel.newType;
                }
            }
        }
    });
}

function getHumanOwnerId(gameState) {
    const players = Array.isArray(gameState?.players) ? gameState.players : [];
    const explicitPlayer = players.find(player => player.id === 'player');
    if (explicitPlayer) return explicitPlayer.id;

    const firstHuman = players.find(player => !String(player.id || '').startsWith('ai_'));
    if (firstHuman) return firstHuman.id;

    return 'player';
}

function applyTileUpdates(gameState, tileUpdates) {
    tileUpdates.forEach(update => {
        const tile = gameState.mapData.find(candidate => candidate.x === update.coords.x && candidate.y === update.coords.y);
        if (!tile || !tile.state) return;

        if (update.changes.beastLosses) {
            for (const unitId in update.changes.beastLosses) {
                tile.state.beasts[unitId] -= update.changes.beastLosses[unitId];
                if (tile.state.beasts[unitId] < 0) tile.state.beasts[unitId] = 0;
            }
        }

        if (update.changes.enableRegeneration) {
            tile.state.isClearedOnce = true;
        }
    });
}

function processCombatMovement({
    movement,
    gameState,
    aiControllers,
    postMessage,
    createCombatEngine,
    updateAIProfiles,
    registerOasisAttack,
    maxReports,
    logMovement,
}) {
    const targetTile = gameState.spatialIndex.get(`${movement.targetCoords.x}|${movement.targetCoords.y}`);
    const combatEngine = createCombatEngine();
    const results = combatEngine.processMovement(movement);

    if (typeof logMovement === 'function') {
        logMovement(
            'info',
            'Combate',
            `Resolviendo ${movement.type} desde ${movement.originVillageId} hacia (${movement.targetCoords.x}|${movement.targetCoords.y}).`,
            null,
            { villageId: movement.originVillageId, ownerId: movement.ownerId },
        );
    }

    results.reportsToCreate.forEach(report => {
        gameState.reports.unshift(report);
        if (gameState.reports.filter(candidate => candidate.ownerId === report.ownerId).length > maxReports) {
            const lastReportIndex = gameState.reports
                .map((candidate, index) => ({ candidate, index }))
                .reverse()
                .find(item => item.candidate.ownerId === report.ownerId)?.index ?? -1;
            if (lastReportIndex !== -1) gameState.reports.splice(lastReportIndex, 1);
        }

        if (report.ownerId && gameState.unreadCounts[report.ownerId] !== undefined) {
            gameState.unreadCounts[report.ownerId] += 1;
        }

        const perspectiveOwnerId = getHumanOwnerId(gameState);
        if (report.ownerId === perspectiveOwnerId) {
            postMessage({ type: 'notify:battle_report', payload: { report, state: gameState } });
        }

        updateAIProfiles(report);

        if (typeof logMovement === 'function' && report.type && (report.type === 'attack' || report.type === 'raid' || report.type === 'espionage')) {
            logMovement(
                report.type === 'espionage' ? 'info' : 'success',
                report.type === 'espionage' ? 'Espionaje' : 'Ataque',
                `Reporte ${report.type}: ${report.attacker?.villageName || 'Origen'} -> ${report.defender?.villageName || 'Objetivo'} | ganador: ${report.winner || 'N/A'}`,
                report.summary || null,
                { ownerId: report.ownerId, villageId: report.originVillageId || movement.originVillageId },
            );
        }
    });

    results.movementsToCreate.forEach(newMovement => {
        gameState.movements.push(newMovement);
    });

    results.aiNotifications.forEach(notification => {
        const aiController = aiControllers.find(controller => controller.getOwnerId() === notification.targetAiId);
        if (aiController) {
            aiController.handleReactiveEvent(notification.type, notification.payload, gameState);
        }
    });

    applyVillageUpdates(gameState, results.stateChanges.villageUpdates || []);
    applyTileUpdates(gameState, results.stateChanges.tileUpdates || []);

    if ((movement.type === 'attack' || movement.type === 'raid') && targetTile?.type === 'oasis') {
        registerOasisAttack({ tile: targetTile, currentTime: movement.arrivalTime });
    }

    if (results.movementsToCreate.length > 0) {
        gameState.movements.sort((a, b) => a.arrivalTime - b.arrivalTime);
    }
}

export function processMovements({
    gameState,
    currentTime,
    aiControllers,
    postMessage,
    createCombatEngine,
    updateAIProfiles,
    registerOasisAttack,
    logMovement,
    maxReports = 20,
    handlers,
}) {
    while (gameState.movements.length > 0 && currentTime >= gameState.movements[0].arrivalTime) {
        const movement = gameState.movements.shift();

        if (typeof logMovement === 'function') {
            logMovement(
                'info',
                'Movimiento',
                `Procesando movimiento ${movement.type} -> (${movement.targetCoords?.x ?? '?'}|${movement.targetCoords?.y ?? '?'})`,
                null,
                { villageId: movement.originVillageId, ownerId: movement.ownerId },
            );
        }

        switch (movement.type) {
            case 'attack':
            case 'raid':
            case 'espionage':
                processCombatMovement({
                    movement,
                    gameState,
                    aiControllers,
                    postMessage,
                    createCombatEngine,
                    updateAIProfiles,
                    registerOasisAttack,
                    maxReports,
                    logMovement,
                });
                break;
            case 'reinforcement':
                handlers.reinforcement?.(movement);
                break;
            case 'settle':
                handlers.settle?.(movement);
                break;
            case 'return':
                handlers.return?.(movement);
                break;
            case 'trade':
                handlers.trade?.(movement);
                break;
            case 'trade_return':
                handlers.tradeReturn?.(movement);
                break;
        }
    }
}
