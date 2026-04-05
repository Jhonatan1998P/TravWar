// RUTA: js/engine/GameWorker.js
import { gameData } from '../core/GameData.js';
import AIController from '../ai/AIController.js';
import { CombatEngine } from '../engine/CombatEngine.js';
import { VillageProcessor } from '../engine/VillageProcessor.js';
import { GameStateFactory } from '../engine/GameStateFactory.js';
import { AIPersonality } from '../ai/AIPersonality.js';

self.onerror = function(message, source, lineno, colno, error) {
    self.postMessage({
        type: 'worker:error',
        payload: {
            message: error.message,
            stack: error.stack,
            source: source,
            lineno: lineno,
            colno: colno
        }
    });
    return true; 
};

const LOG_MILITARY_DECISIONS = true;
const LOG_ECONOMIC_DECISIONS = false;
const LOG_MILITARY_DETAILS = false; 
const LOG_ECONOMIC_DETAILS = false;

const MAX_REPORTS = 20;
const PROTECTION_POPULATION_THRESHOLD = 1;
const MAX_MEMORY_ENTRIES = 200;
const mainInterval = 500;

let gameState = null;
let gameConfig = null;
let lastTick = 0;
let mainLoopInterval = null;
let sessionId = null;
let aiControllers = [];
let villageProcessors = [];

function _log(level, action, message, details = null) {
    const economicActions = [
        'Construcción', 'Construcción Fallida', 'Acción en Espera',
        'Cola Libre', 'Ahorro de Recursos', 'Ciclo Económico', 'Nuevo Objetivo economic'
    ];
    const militaryActions = [
        'Reclutamiento', 'Investigación', 'Herrería', 'Proportional Recruitment',
        'Reacción Ignorada', 'Evento Reactivo', 'Ciclo Militar Omitido', 'Consulta a General',
        'Razonamiento del General', 'Órdenes Recibidas', 'Sin Comandos', 'Error en Ciclo Militar',
        'Comando Inválido', 'Comando Enviado', 'Comando Fallido', 'Asesor Táctico',
        'Nuevo Objetivo military', 'Objetivo military Completado', 'Movimiento', 'Comercio'
    ];

    let logCategory = null;
    if (economicActions.includes(action)) logCategory = 'economic';
    else if (militaryActions.includes(action)) logCategory = 'military';

    const isDetailed = economicActions.concat(militaryActions).includes(action);

    if (logCategory === 'military') {
        if (!LOG_MILITARY_DECISIONS) return;
        if (isDetailed && !LOG_MILITARY_DETAILS) return;
    }
    if (logCategory === 'economic') {
        if (!LOG_ECONOMIC_DECISIONS) return;
        if (isDetailed && !LOG_ECONOMIC_DETAILS) return;
    }
    
    const ICONS = { info: '⚙️', success: '✅', fail: '❌', warn: '⚠️', goal: '🎯', error: '🔥' };
    const STYLES = { info: 'color: #6c757d;', success: 'color: #28a745; font-weight: bold;', fail: 'color: #dc3545;', warn: 'color: #ffc107;', error: 'color: #E91E63; font-weight: bold;' };

    console.log(`%c${ICONS[level] || '➡️'} [WORKER] [${action}] :: ${message}`, STYLES[level] || '');
    if (details) {
        console.log(details);
    }
}

function _getWeightedRandomBeast(spawnTable, randomFunc = Math.random) {
    if (!spawnTable || spawnTable.length === 0) return null;

    const weights = spawnTable.map((_, index) => spawnTable.length - index);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let random = randomFunc() * totalWeight;

    for (let i = 0; i < spawnTable.length; i++) {
        random -= weights[i];
        if (random <= 0) {
            return spawnTable[i].unitId;
        }
    }
    return spawnTable[spawnTable.length - 1].unitId;
}

function getActiveVillage() {
    if (!gameState || !gameState.activeVillageId) return null;
    return gameState.villages.find(v => v.id === gameState.activeVillageId);
}

function mainLoop() {
    if (!gameState) return;
    const currentTime = Date.now();
    try {
        villageProcessors.forEach(processor => {
            const notifications = processor.update(currentTime, lastTick);
            notifications.forEach(notification => self.postMessage(notification));
        });

        processMovements(currentTime);
        processOasisRegeneration(currentTime);
        updatePlayerProtectionStatus();

        aiControllers.forEach(controller => {
            controller.makeDecision(gameState);
        });

        aiControllers.forEach(controller => {
            const ownerId = controller.getOwnerId();
            gameState.aiState[ownerId] = controller.getState();
        });

        lastTick = currentTime;

        self.postMessage({
            type: 'gamestate:updated',
            payload: {
                state: gameState,
                lastTick: lastTick
            }
        });
    } catch (error) {
        _log('error', 'Main Loop', `CRITICAL ERROR in mainLoop: ${error.message}`, error.stack);
        
        self.postMessage({
            type: 'worker:error',
            payload: {
                message: `Error en mainLoop: ${error.message}`,
                stack: error.stack
            }
        });

        if (mainLoopInterval) clearInterval(mainLoopInterval);
    }
}

function updatePlayerProtectionStatus() {
    if (!gameState || !gameState.players) return;

    gameState.players.forEach(player => {
        if (player.isUnderProtection) {
            const totalPopulation = gameState.villages
                .filter(v => v.ownerId === player.id)
                .reduce((sum, v) => sum + v.population.current, 0);

            if (totalPopulation >= PROTECTION_POPULATION_THRESHOLD) {
                player.isUnderProtection = false;
                _log('info', 'Protección', `El jugador ${player.id} ha perdido la protección de principiante.`);
            }
        }
    });
}

function updateAIProfiles(report) {
    const isMyAttack = gameState.players.some(p => p.id === report.attacker.ownerId && p.id.startsWith('ai_'));
    const myOwnerId = isMyAttack ? report.attacker.ownerId : report.defender.ownerId;
    const enemyPlayerId = isMyAttack ? report.defender.ownerId : report.attacker.ownerId;

    if (!enemyPlayerId || enemyPlayerId === 'nature' || !myOwnerId || !myOwnerId.startsWith('ai_')) {
        return;
    }

    let profile = gameState.aiProfiles.get(enemyPlayerId) || {
        baitingScore: 0,
        defenseVolatility: 0,
        lastEspionageReport: null
    };

    if (isMyAttack && (report.type === 'attack' || report.type === 'raid')) {
        if (profile.lastEspionageReport) {
            const predictedDefense = profile.lastEspionageReport.payload.poder_defensivo_calculado || 0;
            const actualAttackPower = report.summary.attacker.attackPower;
            const wasVictoryPredicted = actualAttackPower > (predictedDefense * 1.2);
            const outcome = report.winner === report.attacker.playerName ? 'victory' : 'defeat';

            if (wasVictoryPredicted && outcome === 'defeat') {
                profile.baitingScore = (profile.baitingScore || 0) + 1;
            }
            profile.lastEspionageReport = null;
        }
    } else if (isMyAttack && report.type === 'espionage' && report.payload) {
        const newDefensePower = report.payload.poder_defensivo_calculado || 0;
        if (profile.lastEspionageReport) {
            const oldDefensePower = profile.lastEspionageReport.payload.poder_defensivo_calculado || 0;
            if (oldDefensePower > 100) {
                profile.defenseVolatility = Math.abs(newDefensePower - oldDefensePower) / oldDefensePower;
            } else {
                profile.defenseVolatility = 0;
            }
        }
        profile.lastEspionageReport = {
            time: report.time,
            payload: { poder_defensivo_calculado: newDefensePower }
        };
    }

    gameState.aiProfiles.set(enemyPlayerId, profile);
}

function processMovements(currentTime) {
    while (gameState.movements.length > 0 && currentTime >= gameState.movements[0].arrivalTime) {
        const movement = gameState.movements.shift();
        
        switch(movement.type) {
            case 'attack':
            case 'raid':
            case 'espionage': {
                const combatEngine = new CombatEngine(gameState);
                const results = combatEngine.processMovement(movement);

                results.reportsToCreate.forEach(report => {
                    gameState.reports.unshift(report);
                    if (gameState.reports.filter(r => r.ownerId === report.ownerId).length > MAX_REPORTS) {
                        const reportIds = gameState.reports.map(r => r.id);
                        const lastReportIndex = reportIds.lastIndexOf(r => r.ownerId === report.ownerId);
                        if(lastReportIndex !== -1) gameState.reports.splice(lastReportIndex, 1);
                    }
                    
                    if (report.ownerId && gameState.unreadCounts[report.ownerId] !== undefined) {
                        gameState.unreadCounts[report.ownerId]++;
                    }
                    
                    if (report.ownerId === 'player') {
                        self.postMessage({ type: 'notify:battle_report', payload: { report, state: gameState } });
                    }
                    
                    updateAIProfiles(report);
                });

                results.movementsToCreate.forEach(newMovement => {
                    gameState.movements.push(newMovement);
                });
                
                results.aiNotifications.forEach(notification => {
                    const aiController = aiControllers.find(c => c.getOwnerId() === notification.targetAiId);
                    if (aiController) {
                        aiController.handleReactiveEvent(notification.type, notification.payload, gameState);
                    }
                });

                results.stateChanges.villageUpdates.forEach(update => {
                    const village = gameState.villages.find(v => v.id === update.villageId);
                    if (!village) return;

                    if (update.changes.troopLosses) {
                        update.changes.troopLosses.forEach(result => {
                            for (const unitId in result.losses) {
                                if (result.id === village.id) {
                                    if (village.unitsInVillage[unitId]) village.unitsInVillage[unitId] -= result.losses[unitId];
                                } else {
                                    const reinforcement = village.reinforcements.find(r => r.fromVillageId === result.id);
                                    if (reinforcement && reinforcement.troops[unitId]) reinforcement.troops[unitId] -= result.losses[unitId];
                                }
                            }
                        });
                        village.reinforcements = village.reinforcements.filter(r => Object.values(r.troops).some(count => count > 0));
                    }
                    if (update.changes.plunder) {
                        for(const res in update.changes.plunder) {
                            village.resources[res].current -= update.changes.plunder[res];
                        }
                    }
                    if (update.changes.buildingLevel) {
                        const building = village.buildings.find(b => b.id === update.changes.buildingLevel.buildingId);
                        if (building) {
                            building.level = update.changes.buildingLevel.newLevel;
                            if (update.changes.buildingLevel.newType) {
                                building.type = update.changes.buildingLevel.newType;
                            }
                        }
                    }
                });

                results.stateChanges.tileUpdates.forEach(update => {
                    const tile = gameState.mapData.find(t => t.x === update.coords.x && t.y === update.coords.y);
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

                if (results.movementsToCreate.length > 0) {
                    gameState.movements.sort((a, b) => a.arrivalTime - b.arrivalTime);
                }
                break;
            }
            case 'reinforcement':
                handleReinforcementArrival(movement);
                break;
            case 'settle':
                handleSettleArrival(movement);
                break;
            case 'return':
                handleReturnArrival(movement);
                break;
            case 'trade':
                handleTradeArrival(movement);
                break;
            case 'trade_return':
                handleTradeReturnArrival(movement);
                break;
        }
    }
}

function handleSettleArrival(movement) {
    const { originVillageId, targetCoords, payload } = movement;
    const originVillage = gameState.villages.find(v => v.id === originVillageId);
    const targetTileIndex = gameState.mapData.findIndex(t => t.x === targetCoords.x && t.y === targetCoords.y);
    const targetTile = gameState.mapData[targetTileIndex];

    if (!originVillage || !targetTile || targetTile.type !== 'valley') {
        handleSendMovementCommand({
            originVillageId: originVillageId,
            targetCoords: originVillage.coords,
            troops: payload.troops,
            missionType: 'return'
        });
        return;
    }
    
    originVillage.settlementsFounded = (originVillage.settlementsFounded || 0) + 1;

    const factory = new GameStateFactory(gameConfig);
    const newVillage = factory.createVillageObject(`v_${Date.now()}`, 'Nueva Aldea', originVillage.race, originVillage.ownerId, targetCoords, targetTile.valleyType);
    
    let bonusToPass = 1;
    let budgetConfig = null;

    if (originVillage.ownerId.startsWith('ai_')) {
        const aiController = aiControllers.find(c => c.getOwnerId() === originVillage.ownerId);
        if (aiController) {
            const personality = aiController.getPersonality();
            bonusToPass = personality.bonusMultiplier || 1;
            budgetConfig = personality.buildRatio; // Pasamos el ratio de presupuesto
        }
    }
    
    const newProcessor = new VillageProcessor(newVillage, gameConfig, gameState.alliance.bonuses, bonusToPass, budgetConfig);
    newProcessor.update(Date.now(), Date.now());
    villageProcessors.push(newProcessor);

    gameState.villages.push(newVillage);
    gameState.mapData[targetTileIndex] = { 
        x: targetCoords.x, y: targetCoords.y, type: 'village', villageId: newVillage.id, ownerId: originVillage.ownerId, race: originVillage.race 
    };

    const report = {
        id: `rep-${Date.now()}`, ownerId: originVillage.ownerId, type: 'settlement_success', time: Date.now(), originVillageId: originVillageId,
        newVillageName: `${newVillage.name} (${newVillage.coords.x}|${newVillage.coords.y})`, newVillageCoords: newVillage.coords
    };
    gameState.reports.unshift(report);
    if (gameState.unreadCounts[originVillage.ownerId] !== undefined) {
        gameState.unreadCounts[originVillage.ownerId]++;
    }
}

function handleReturnArrival(movement) {
    const village = gameState.villages.find(v => v.id === movement.originVillageId);
    if (!village) return;

    for (const unitId in movement.payload.troops) {
        village.unitsInVillage[unitId] = (village.unitsInVillage[unitId] || 0) + movement.payload.troops[unitId];
    }
    
    const allLootKeys = new Set([
        ...Object.keys(movement.payload.bounty || {}),
        ...Object.keys(movement.payload.plunder || {})
    ]);
    
    // Si es IA, el botín se reparte 50/50 en sus presupuestos
    const isAI = village.ownerId.startsWith('ai_') && village.budget;

    for (const res of allLootKeys) {
        const bountyAmount = movement.payload.bounty?.[res] || 0;
        const plunderAmount = movement.payload.plunder?.[res] || 0;
        const totalAmount = bountyAmount + plunderAmount;

        if (totalAmount > 0) {
            if (isAI) {
                const half = totalAmount / 2;
                village.budget.econ[res] = Math.min(village.resources[res].capacity, village.budget.econ[res] + half);
                village.budget.mil[res] = Math.min(village.resources[res].capacity, village.budget.mil[res] + half);
                village.resources[res].current = village.budget.econ[res] + village.budget.mil[res];
            } else {
                const resourceData = village.resources[res];
                resourceData.current = Math.min(resourceData.capacity, resourceData.current + totalAmount);
            }
        }
    }
}

function handleReinforcementArrival(movement) {
    const targetVillage = gameState.villages.find(v => v.coords.x === movement.targetCoords.x && v.coords.y === movement.targetCoords.y);
    if (!targetVillage) return;

    const originVillage = gameState.villages.find(v => v.id === movement.originVillageId);
    if (!originVillage) return;

    const existingReinforcement = targetVillage.reinforcements.find(r => r.fromVillageId === movement.originVillageId);
    if (existingReinforcement) {
        for (const unitId in movement.payload.troops) {
            existingReinforcement.troops[unitId] = (existingReinforcement.troops[unitId] || 0) + movement.payload.troops[unitId];
        }
    } else {
        targetVillage.reinforcements.push({
            fromVillageId: movement.originVillageId,
            race: originVillage.race,
            troops: movement.payload.troops,
            smithyUpgradesSnapshot: { ...(originVillage.smithy.upgrades || {}) }
        });
    }
}

function handleTradeArrival(movement) {
    const targetVillage = gameState.villages.find(v => v.coords.x === movement.targetCoords.x && v.coords.y === movement.targetCoords.y);
    if (!targetVillage) return;

    // Si es IA, el comercio entrante se reparte 50/50 (o según lógica de rebalanceo, pero 50/50 es seguro)
    const isAI = targetVillage.ownerId.startsWith('ai_') && targetVillage.budget;

    for (const res in movement.payload.resources) {
        const amount = movement.payload.resources[res];
        if (amount > 0) {
            if (isAI) {
                const half = amount / 2;
                targetVillage.budget.econ[res] = Math.min(targetVillage.resources[res].capacity, targetVillage.budget.econ[res] + half);
                targetVillage.budget.mil[res] = Math.min(targetVillage.resources[res].capacity, targetVillage.budget.mil[res] + half);
                targetVillage.resources[res].current = targetVillage.budget.econ[res] + targetVillage.budget.mil[res];
            } else {
                const resourceData = targetVillage.resources[res];
                resourceData.current = Math.min(resourceData.capacity, resourceData.current + amount);
            }
        }
    }
    
    const originVillage = gameState.villages.find(v => v.id === movement.originVillageId);
    if (!originVillage) return;

    const returnTravelTime = movement.arrivalTime - movement.startTime;
    const now = Date.now();
    
    const returnMovement = {
        id: `${now}-mov-trade_return-${originVillage.id}`, type: 'trade_return', ownerId: movement.ownerId, originVillageId: movement.originVillageId,
        targetCoords: { x: originVillage.coords.x, y: originVillage.coords.y }, payload: { merchants: movement.payload.merchants },
        startTime: now, arrivalTime: now + returnTravelTime,
    };
    
    gameState.movements.push(returnMovement);
    gameState.movements.sort((a, b) => a.arrivalTime - b.arrivalTime);
}

function handleTradeReturnArrival(movement) {}

function processOasisRegeneration(currentTime) {
    const regenCycleMs = (Math.random() * (gameData.config.oasis.beastRegenCycleMinutes * 60 * 1000)) + (60 * 1000);
    if (currentTime - gameState.lastOasisRegenTime < regenCycleMs) {
        return;
    }

    const cyclesToProcess = Math.floor((currentTime - gameState.lastOasisRegenTime) / regenCycleMs);
    if (cyclesToProcess <= 0) return;

    const amountPerCycle = gameData.config.oasis.beastRegenAmount;

    for (let i = 0; i < cyclesToProcess; i++) {
        gameState.mapData.forEach(tile => {
            if (tile.type !== 'oasis' || !tile.state?.beasts || !tile.state.isClearedOnce) return;

            const oasisTypeData = gameData.oasisTypes[tile.oasisType];
            if (!oasisTypeData) return;

            const beastToSpawn = _getWeightedRandomBeast(oasisTypeData.beastSpawnTable);
            if (!beastToSpawn) return;
            
            const spawnInfo = oasisTypeData.beastSpawnTable.find(s => s.unitId === beastToSpawn);
            if (!spawnInfo) return;

            const currentAmount = tile.state.beasts[beastToSpawn] || 0;
            if (currentAmount < spawnInfo.max) {
                tile.state.beasts[beastToSpawn] = Math.min(spawnInfo.max, currentAmount + amountPerCycle);
            }
        });
    }

    gameState.lastOasisRegenTime += cyclesToProcess * regenCycleMs;
}

function simulateOfflineProgress(startTime, endTime) {
    let currentTime = startTime;
    
    const allVillageJobs = gameState.villages.flatMap(v => [
        ...v.constructionQueue.map(j => ({ ...j, eventType: 'construction' })), 
        ...v.recruitmentQueue.map(j => ({ ...j, eventType: 'recruitment' })),
        ...v.research.queue.map(j => ({ ...j, eventType: 'research' })),
        ...v.smithy.queue.map(j => ({ ...j, eventType: 'smithy' }))
    ]);
    
    const allMovementsAsJobs = gameState.movements.map(m => ({ ...m, endTime: m.arrivalTime, eventType: 'movement' }));
    
    const oasisRegenJobs = [];
    const regenCycleMs = gameData.config.oasis.beastRegenCycleMinutes * 60 * 1000;
    let nextRegenTime = gameState.lastOasisRegenTime + regenCycleMs;
    while(nextRegenTime < endTime) {
        if (nextRegenTime > startTime) {
            oasisRegenJobs.push({ endTime: nextRegenTime, eventType: 'oasis_regen' });
        }
        nextRegenTime += regenCycleMs;
    }

    const allJobs = [...allVillageJobs, ...allMovementsAsJobs, ...oasisRegenJobs].sort((a, b) => (a.endTime || a.arrivalTime) - (b.endTime || b.arrivalTime));

    for (const job of allJobs) {
        const jobEndTime = job.endTime || job.arrivalTime;
        if (jobEndTime > endTime) break;

        const elapsedSeconds = (jobEndTime - currentTime) / 1000;
        if (elapsedSeconds > 0) {
            villageProcessors.forEach(p => p.update(jobEndTime, currentTime));
        }

        if (job.eventType === 'oasis_regen') {
            processOasisRegeneration(jobEndTime);
        } else {
            processMovements(jobEndTime);
        }
        
        currentTime = jobEndTime;
    }

    const remainingElapsedSeconds = (endTime - currentTime) / 1000;
    if (remainingElapsedSeconds > 0) {
        villageProcessors.forEach(p => p.update(endTime, currentTime));
        processOasisRegeneration(endTime);
    }
}

function handleSendMovementCommand(payload) {
    const { originVillageId, targetCoords, troops, missionType, catapultTargets } = payload;
    const village = gameState.villages.find(v => v.id === originVillageId);
    if (!village) return { success: false, reason: 'VILLAGE_NOT_FOUND' };

    if (missionType === 'espionage') {
        const raceTroops = gameData.units[village.race].troops;
        for (const unitId in troops) {
            const unitData = raceTroops.find(t => t.id === unitId);
            if (!unitData || unitData.type !== 'scout') {
                return { success: false, reason: 'INVALID_TROOPS_FOR_ESPIONAGE' };
            }
        }
    }

    for (const unitId in troops) {
        const count = troops[unitId];
        if (count <= 0 || (village.unitsInVillage[unitId] || 0) < count) {
            return { success: false, reason: 'INSUFFICIENT_TROOPS', details: { needed: troops, available: village.unitsInVillage } };
        }
    }

    if (missionType === 'settle') {
        const settlerUnitId = Object.keys(troops).find(id => gameData.units[village.race].troops.find(t => t.id === id)?.type === 'settler');
        if (!settlerUnitId || troops[settlerUnitId] < 3) {
            return { success: false, reason: 'INSUFFICIENT_SETTLERS', details: { needed: 3, available: troops[settlerUnitId] || 0 } };
        }
        const settlementsFoundedByThisVillage = village.settlementsFounded || 0;
        let requiredPop = 0;
        if (settlementsFoundedByThisVillage === 0) requiredPop = 150;
        else if (settlementsFoundedByThisVillage === 1) requiredPop = 300;
        else if (settlementsFoundedByThisVillage === 2) requiredPop = 600;
        else return { success: false, reason: 'MAX_SETTLEMENTS_REACHED' };
        
        if (village.population.current < requiredPop) {
            return { success: false, reason: 'INSUFFICIENT_POPULATION', details: { needed: requiredPop, available: village.population.current } };
        }
        const settlementCost = gameData.config.settlement.cost;
        // Verificación de costes para colonizar (usa budget económico si es IA)
        const isAI = village.ownerId.startsWith('ai_') && village.budget;
        const availableRes = isAI ? village.budget.econ : village.resources;
        const currentRes = isAI ? availableRes : { wood: availableRes.wood.current, stone: availableRes.stone.current, iron: availableRes.iron.current, food: availableRes.food.current };

        for (const res in settlementCost) {
            if (currentRes[res] < settlementCost[res]) {
                return { success: false, reason: 'INSUFFICIENT_RESOURCES', details: { needed: settlementCost, available: currentRes } };
            }
        }
        for (const res in settlementCost) {
            if (isAI) {
                village.budget.econ[res] -= settlementCost[res];
                village.resources[res].current = village.budget.econ[res] + village.budget.mil[res];
            } else {
                village.resources[res].current -= settlementCost[res];
            }
        }
    }

    let slowestSpeed = Infinity;
    for (const unitId in troops) {
        const unitData = gameData.units[village.race].troops.find(u => u.id === unitId);
        if (unitData.stats.speed < slowestSpeed) slowestSpeed = unitData.stats.speed;
    }
    if (slowestSpeed === Infinity) return { success: false, reason: 'NO_VALID_UNITS' };

    const distance = Math.hypot(targetCoords.x - village.coords.x, targetCoords.y - village.coords.y);
    const travelTimeMs = ((distance / (slowestSpeed * gameConfig.troopSpeed)) * 3600) * 1000;
    const startTime = Date.now();

    for (const unitId in troops) {
        village.unitsInVillage[unitId] -= troops[unitId];
    }

    const newMovement = {
        id: `${startTime}-mov-${village.id}`, type: missionType, ownerId: village.ownerId, originVillageId: village.id,
        targetCoords, payload: { troops, catapultTargets: catapultTargets || [] }, startTime, arrivalTime: startTime + travelTimeMs,
    };
    gameState.movements.push(newMovement);
    gameState.movements.sort((a, b) => a.arrivalTime - b.arrivalTime);

    const targetTile = gameState.mapData.find(t => t.x === targetCoords.x && t.y === targetCoords.y);
    if (targetTile && targetTile.type === 'village' && targetTile.ownerId.startsWith('ai_') && targetTile.ownerId !== village.ownerId) {
        const targetAIController = aiControllers.find(c => c.getOwnerId() === targetTile.ownerId);
        if (targetAIController) {
            const hostileTypes = ['attack', 'raid', 'espionage'];
            if (hostileTypes.includes(missionType)) {
                targetAIController.handleReactiveEvent('movement_dispatched', newMovement, gameState);
            }
        }
    }

    return { success: true };
}

function handleSendMerchantsCommand(payload) {
    const { originVillageId, targetCoords, resources } = payload;
    const village = gameState.villages.find(v => v.id === originVillageId);
    if (!village) return { success: false, reason: 'VILLAGE_NOT_FOUND' };

    const marketplace = village.buildings.find(b => b.type === 'marketplace');
    if (!marketplace || marketplace.level === 0) return { success: false, reason: 'MARKETPLACE_REQUIRED' };

    const merchantData = gameData.units[village.race].troops.find(t => t.type === 'merchant');
    if (!merchantData) return { success: false, reason: 'NO_MERCHANT_UNIT_FOR_RACE' };

    const merchantCount = gameData.buildings.marketplace.levels[marketplace.level - 1].attribute.merchantCapacity;
    const totalCapacity = merchantCount * merchantData.stats.capacity;
    const totalSent = Object.values(resources).reduce((sum, val) => sum + val, 0);

    if (totalSent > totalCapacity) return { success: false, reason: 'MERCHANT_CAPACITY_EXCEEDED', details: { sent: totalSent, capacity: totalCapacity } };
    
    // Verificación de recursos para comercio (usa budget económico si es IA)
    const isAI = village.ownerId.startsWith('ai_') && village.budget;
    const availableRes = isAI ? village.budget.econ : village.resources;
    const currentRes = isAI ? availableRes : { wood: availableRes.wood.current, stone: availableRes.stone.current, iron: availableRes.iron.current, food: availableRes.food.current };

    for (const res in resources) {
        if (currentRes[res] < resources[res]) return { success: false, reason: 'INSUFFICIENT_RESOURCES', details: { needed: resources, available: currentRes } };
    }
    for (const res in resources) {
        if (isAI) {
            village.budget.econ[res] -= resources[res];
            village.resources[res].current = village.budget.econ[res] + village.budget.mil[res];
        } else {
            village.resources[res].current -= resources[res];
        }
    }
    
    const distance = Math.hypot(targetCoords.x - village.coords.x, targetCoords.y - village.coords.y);
    const travelTimeMs = ((distance / (merchantData.stats.speed * gameConfig.troopSpeed)) * 3600) * 1000;
    const startTime = Date.now();

    gameState.movements.push({
        id: `${startTime}-mov-trade-${village.id}`, type: 'trade', ownerId: village.ownerId, originVillageId: village.id, targetCoords,
        payload: { resources, merchants: Math.ceil(totalSent / merchantData.stats.capacity) },
        startTime, arrivalTime: startTime + travelTimeMs
    });
    gameState.movements.sort((a, b) => a.arrivalTime - b.arrivalTime);
    return { success: true };
}

function handleAICommand(commandType, payload) {
    const villageId = payload.villageId || getActiveVillage()?.id;
    if (!villageId) return { success: false, reason: 'NO_VILLAGE_ID' };

    const processor = villageProcessors.find(p => p.getVillageId() === villageId);
    if (!processor) return { success: false, reason: 'PROCESSOR_NOT_FOUND' };
    
    let result;
    switch (commandType) {
        case 'upgrade_building':
            result = processor.queueBuildingUpgrade(payload);
            _log(result.success ? 'success' : 'fail', 'Construcción', `IA: ${result.success ? 'Encolado' : 'Rechazado'}. Razón: ${result.reason || 'N/A'}`);
            return result;
        case 'recruit_units':
            result = processor.queueRecruitment(payload);
            _log(result.success ? 'success' : 'fail', 'Reclutamiento', `IA: ${result.success ? 'Encolado' : 'Rechazado'}. Razón: ${result.reason || 'N/A'}`);
            return result;
        case 'research_unit':
            result = processor.queueResearch(payload);
            _log(result.success ? 'success' : 'fail', 'Investigación', `IA: ${result.success ? 'Encolado' : 'Rechazado'}. Razón: ${result.reason || 'N/A'}`);
            return result;
        case 'upgrade_unit':
            result = processor.queueSmithyUpgrade(payload);
            _log(result.success ? 'success' : 'fail', 'Herrería', `IA: ${result.success ? 'Encolado' : 'Rechazado'}. Razón: ${result.reason || 'N/A'}`);
            return result;
        case 'send_movement':
            result = handleSendMovementCommand(payload);
            _log(result.success ? 'success' : 'fail', 'Movimiento', `IA: ${result.success ? 'Enviado' : 'Rechazado'}. Razón: ${result.reason || 'N/A'}`);
            return result;
        case 'send_merchants':
            result = handleSendMerchantsCommand(payload);
            _log(result.success ? 'success' : 'fail', 'Comercio', `IA: ${result.success ? 'Enviado' : 'Rechazado'}. Razón: ${result.reason || 'N/A'}`);
            return result;
    }
    return { success: false, reason: 'UNKNOWN_COMMAND' };
}

self.onmessage = function(event) {
    const { type, payload } = event.data;
    if (!gameConfig && type !== 'init') return;

    if (type === 'init') {
        gameConfig = payload.config;
        sessionId = payload.sessionId;
        const now = Date.now();
        
        const factory = new GameStateFactory(gameConfig);
        gameState = payload.savedState 
            ? factory.loadAndValidate(payload.savedState, sessionId)
            : factory.create(sessionId);

        aiControllers = [];
        villageProcessors = [];
        
        const personalityName = 'Pesadilla';
        const personality = AIPersonality[personalityName];
        const aiBonus = personality.bonusMultiplier || 1;

        gameState.villages.forEach(village => {
            let bonusToPass = 1;
            let budgetConfig = null;
            
            if (village.ownerId.startsWith('ai_')) {
                bonusToPass = aiBonus;
                budgetConfig = personality.buildRatio;
            }
            
            const processor = new VillageProcessor(village, gameConfig, gameState.alliance.bonuses, bonusToPass, budgetConfig);
            villageProcessors.push(processor);
        });

        const savedLastTick = payload.savedState?.lastTick || now;
        if (now > savedLastTick) {
            simulateOfflineProgress(savedLastTick, now);
        }
        lastTick = now;
        
        const aiPlayers = gameState.players.filter(p => p.id.startsWith('ai_'));
    
        if (!personality || !personality.archetypes) {
            _log('error', 'Init AI', `No se pudo encontrar la personalidad '${personalityName}' o sus arquetipos.`);
            return;
        }
        const availableArchetypes = Object.keys(personality.archetypes);
        if (availableArchetypes.length === 0) {
            _log('error', 'Init AI', `No se encontraron arquetipos en la personalidad '${personalityName}'.`);
            return;
        }

        aiPlayers.forEach((player, index) => {
            const archetype = availableArchetypes[index % availableArchetypes.length];
            _log('info', 'Init AI', `Asignando IA ${player.id} con personalidad '${personalityName}' y arquetipo: ${archetype}`);

            const aiPlayerState = gameState.aiState[player.id] || {};
            gameState.aiState[player.id] = aiPlayerState;
            
            const controller = new AIController(player.id, personality, player.race, archetype, handleAICommand, gameConfig);
            controller.init(gameState, aiPlayerState);
            aiControllers.push(controller);
        });

        if (mainLoopInterval) clearInterval(mainLoopInterval);
        mainLoopInterval = setInterval(mainLoop, mainInterval);

        self.postMessage({ type: 'gamestate:initialized', payload: { state: gameState, lastTick: lastTick } });
        return;
    }

    if (!gameState) return;
    
    const villageId = payload?.villageId || gameState.activeVillageId;
    const processor = villageProcessors.find(p => p.getVillageId() === villageId);

    switch (type) {
        case 'get_latest_state':
            self.postMessage({ type: 'gamestate:updated', payload: { state: gameState, lastTick: lastTick } });
            break;
        case 'upgrade_building':
            if (processor) processor.queueBuildingUpgrade(payload);
            break;
        case 'cancel_construction':
            if (processor) processor.cancelBuilding(payload);
            break;
        case 'recruit_units':
            if (processor) processor.queueRecruitment(payload);
            break;
        case 'research_unit':
            if (processor) processor.queueResearch(payload);
            break;
        case 'upgrade_unit':
            if (processor) processor.queueSmithyUpgrade(payload);
            break;
        case 'rename_village':
            if (processor) processor.rename(payload.newName);
            break;
        case 'send_movement':
            handleSendMovementCommand(payload);
            break;
        case 'send_merchants':
            handleSendMerchantsCommand(payload);
            break;
        case 'switch_village':
            if (payload && payload.villageId) gameState.activeVillageId = payload.villageId;
            break;
        case 'mark_reports_as_read':
            if (gameState.unreadCounts) gameState.unreadCounts['player'] = 0;
            break;
        case 'delete_report':
            if (payload.reportId) {
                const index = gameState.reports.findIndex(r => r.id === payload.reportId);
                if (index !== -1) gameState.reports.splice(index, 1);
            }
            break;
        case 'download_ai_log': {
            const aiController = aiControllers.find(c => c.getOwnerId() === payload.aiId);
            if (aiController) {
                const logContent = aiController.getDecisionLog();
                self.postMessage({ type: 'ai_log_content', payload: { logContent, aiId: payload.aiId } });
            }
            break;
        }
    }
};