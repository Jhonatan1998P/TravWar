// RUTA: js/engine/GameWorker.js
import { gameData } from '../core/GameData.js';
import { AIController, AIPersonality } from '../ai/index.js';
import { CombatEngine } from '../engine/CombatEngine.js';
import { VillageProcessor } from '../engine/VillageProcessor.js';
import { GameStateFactory } from '../engine/GameStateFactory.js';
import { registerWorkerDiagnostics } from './worker/diagnostics.js';
import {
    processOasisRegeneration as processOasisRegenerationStep,
    registerOasisAttack as registerOasisAttackStep,
} from './worker/oasis.js';
import {
    handleSendMerchantsCommand as handleSendMerchantsCommandStep,
    handleSendMovementCommand as handleSendMovementCommandStep,
} from './worker/commands.js';
import { processMovements as processMovementsStep } from './worker/movements.js';
import { simulateOfflineProgress as simulateOfflineProgressStep } from './worker/offline.js';
import { addResourceIncomeToVillage, initializeAIVillageBudget } from './worker/budget.js';

registerWorkerDiagnostics(self);

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
    processMovementsStep({
        gameState,
        currentTime,
        aiControllers,
        maxReports: MAX_REPORTS,
        postMessage: message => self.postMessage(message),
        createCombatEngine: () => new CombatEngine(gameState),
        updateAIProfiles,
        registerOasisAttack: ({ tile, currentTime: attackTime }) => {
            registerOasisAttackStep({
                tile,
                currentTime: attackTime,
                gameData,
            });
        },
        handlers: {
            reinforcement: handleReinforcementArrival,
            settle: handleSettleArrival,
            return: handleReturnArrival,
            trade: handleTradeArrival,
            tradeReturn: handleTradeReturnArrival,
        },
    });
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

        initializeAIVillageBudget(newVillage, budgetConfig || originVillage.budgetRatio);
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
    
    for (const res of allLootKeys) {
        const bountyAmount = movement.payload.bounty?.[res] || 0;
        const plunderAmount = movement.payload.plunder?.[res] || 0;
        const totalAmount = bountyAmount + plunderAmount;

        if (totalAmount > 0) {
            addResourceIncomeToVillage(village, res, totalAmount);
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

    for (const res in movement.payload.resources) {
        const amount = movement.payload.resources[res];
        if (amount > 0) {
            addResourceIncomeToVillage(targetVillage, res, amount);
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
    processOasisRegenerationStep({
        gameState,
        currentTime,
        gameData,
    });
}

function simulateOfflineProgress(startTime, endTime) {
    simulateOfflineProgressStep({
        gameState,
        gameData,
        villageProcessors,
        processMovements,
        processOasisRegeneration,
        startTime,
        endTime,
    });
}

function handleSendMovementCommand(payload) {
    return handleSendMovementCommandStep({
        payload,
        gameState,
        gameConfig,
        gameData,
        aiControllers,
    });
}

function handleSendMerchantsCommand(payload) {
    return handleSendMerchantsCommandStep({
        payload,
        gameState,
        gameConfig,
        gameData,
    });
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
                initializeAIVillageBudget(village, budgetConfig);
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
