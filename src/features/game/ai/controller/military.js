import { countCombatTroopsInVillages } from '../utils/AITroopUtils.js';
import { MemoryManager } from '../index.js';

const MAX_PRIORITY_GOAL = 'MAX_PRIORITY_GOAL';
const MILITARY_ALLOWED_COMMANDS = new Set(['ATTACK', 'SPY', 'REINFORCE']);

function getTargetTile(gameState, targetCoords) {
    if (!targetCoords) return null;

    const tileKey = `${targetCoords.x}|${targetCoords.y}`;
    return gameState.spatialIndex.get(tileKey)
        || gameState.mapData.find(tile => tile.x === targetCoords.x && tile.y === targetCoords.y)
        || null;
}

function isMaxPriorityGoalCommand(command) {
    return command?.meta?.priority === MAX_PRIORITY_GOAL;
}

function isOasisRaidCommand(command, gameState) {
    if (command?.comando !== 'ATTACK') return false;
    if (command?.parametros?.mision !== 'raid') return false;

    const tile = getTargetTile(gameState, command.parametros.targetCoords);
    return tile?.type === 'oasis';
}

function isAllowedUnderBeginnerProtection(command, gameState) {
    return isOasisRaidCommand(command, gameState);
}

export function runMilitaryDecision({
    gameState,
    ownerId,
    race,
    archetype,
    personality,
    gameConfig,
    villageCombatStateByVillageId = {},
    strategicAI,
    executeCommands,
    log,
    reputationManager,
}) {
    log('info', null, 'INICIO_CICLO_MILITAR', 'Evaluando acciones militares (determinista).');

    const aiPlayerState = gameState.players.find(player => player.id === ownerId);
    if (!aiPlayerState) return null;

    const isUnderBeginnerProtection = Boolean(aiPlayerState.isUnderProtection);

    const myVillages = gameState.villages.filter(village => village.ownerId === ownerId);
    const totalPopulation = myVillages.reduce((sum, village) => sum + village.population.current, 0);
    const combatTroopCount = countCombatTroopsInVillages(myVillages, race);

    const requiredTroops = totalPopulation * 0.15;
    if (combatTroopCount < requiredTroops) {
        log('warn', null, 'Ciclo Militar Omitido', `Reagrupando fuerzas: tropas de combate (${combatTroopCount}) por debajo del umbral (${requiredTroops.toFixed(0)}).`, null, 'military');
        return null;
    }

    const memoryManager = new MemoryManager(gameState);
    const recentMemories = gameState.memory.log.filter(m => m.enemyPlayerId && m.enemyPlayerId !== 'nature');
    const baitingPlayers = new Set();
    recentMemories.forEach(memory => {
        if (memory.analysis === 'baiting_trap') {
            baitingPlayers.add(memory.enemyPlayerId);
        }
    });

    const reputationData = {};
    if (reputationManager) {
        const otherPlayers = gameState.players.filter(p => p.id !== ownerId && p.id !== 'nature');
        otherPlayers.forEach(player => {
            reputationData[player.id] = reputationManager.getReputation(ownerId, player.id);
        });
    }

    log('info', null, 'Strategic AI', 'Calculando utilidad de objetivos potenciales...', null, 'military');
    const gameSpeed = gameConfig.gameSpeed || 1;

    const response = strategicAI.computeMilitaryTurn(
        gameState,
        ownerId,
        race,
        archetype,
        personality,
        gameSpeed,
        gameConfig.troopSpeed || 1,
        {
            baitingPlayers: Array.from(baitingPlayers),
            reputationData,
            combatContractByVillage: villageCombatStateByVillageId,
        },
    );

    if (response.razonamiento) {
        log('goal', null, 'Razonamiento Estrategico', 'El general emitio el siguiente analisis:', response.razonamiento, 'military');
    }

    const rawCommands = response.comandos || [];
    const hasMaxPriorityGoal = rawCommands.some(isMaxPriorityGoalCommand);
    const farmBlockedByMaxPriority = response.telemetry?.militaryGate?.farmBlockedByMaxPriorityGoal || hasMaxPriorityGoal;

    let commandsToExecute = rawCommands;
    if (hasMaxPriorityGoal) {
        const filteredOutFarmCommands = rawCommands.filter(command => isOasisRaidCommand(command, gameState));
        if (filteredOutFarmCommands.length > 0) {
            commandsToExecute = rawCommands.filter(command => !isOasisRaidCommand(command, gameState));
        }

        if (farmBlockedByMaxPriority) {
            log(
                'info',
                null,
                'Gate Prioridad Máxima',
                'farm bloqueado por prioridad máxima.',
                {
                    maxPriorityCommands: rawCommands.filter(isMaxPriorityGoalCommand).length,
                    oasisFarmCommandsFiltered: filteredOutFarmCommands.length,
                },
                'military',
            );
        }
    }

    if (isUnderBeginnerProtection) {
        const blockedCommands = commandsToExecute.filter(command => !isAllowedUnderBeginnerProtection(command, gameState));
        if (blockedCommands.length > 0) {
            log(
                'info',
                null,
                'Gate Proteccion Principiante',
                `Proteccion activa: se bloquearon ${blockedCommands.length} comandos militares no-oasis. Solo se permite farm a oasis.`,
                null,
                'military',
            );
        }
        commandsToExecute = commandsToExecute.filter(command => isAllowedUnderBeginnerProtection(command, gameState));
    }

    const filteredMilitaryCommands = commandsToExecute.filter(command => MILITARY_ALLOWED_COMMANDS.has(command?.comando));
    const ignoredNonMilitaryCommands = commandsToExecute.length - filteredMilitaryCommands.length;

    if (ignoredNonMilitaryCommands > 0) {
        log(
            'warn',
            null,
            'Ciclo Militar Omitido',
            `Se ignoraron ${ignoredNonMilitaryCommands} comandos no militares en este ciclo. Reclutamiento y economia quedan en el ciclo economico.`,
            null,
            'military',
        );
    }

    if (filteredMilitaryCommands.length > 0) {
        log('success', null, 'Ordenes Recibidas', `Ejecutando ${filteredMilitaryCommands.length} comandos militares.`, filteredMilitaryCommands, 'military');
        executeCommands(filteredMilitaryCommands, gameState);
    } else {
        log('info', null, 'Sin Comandos', 'El general no emitio comandos en este ciclo.', null, 'military');
    }

    const gateTelemetry = response.telemetry?.militaryGate;
    if (gateTelemetry) {
        log(
            'info',
            null,
            'Gate Militar',
            `maxPrioridad=${gateTelemetry.hasMaxPriorityGoal ? 'si' : 'no'} ` +
            `bloqueado=${gateTelemetry.farmBlockedByMaxPriorityGoal ? 'si' : 'no'} ` +
            `reagrupando=${gateTelemetry.isMusteringForWar ? 'si' : 'no'} ` +
            `evalGranja=${gateTelemetry.farmEvaluationExecuted ? 'si' : 'no'}`,
            null,
            'military',
        );
    }

    const oasisTelemetry = response.telemetry?.oasisFarming;
    if (oasisTelemetry) {
        const avgRewardNet = Number.isFinite(oasisTelemetry.avgRewardNet)
            ? oasisTelemetry.avgRewardNet
            : (oasisTelemetry.attacksIssued > 0
                ? (oasisTelemetry.rewardNetSum / oasisTelemetry.attacksIssued)
                : 0);
        const lossToGross = Number.isFinite(oasisTelemetry.lossToGrossRatio)
            ? oasisTelemetry.lossToGrossRatio
            : (oasisTelemetry.rewardGrossSum > 0
                ? (oasisTelemetry.lossValueSum / oasisTelemetry.rewardGrossSum)
                : 0);
        const nonPositiveRate = Number.isFinite(oasisTelemetry.attackNonPositiveRate)
            ? oasisTelemetry.attackNonPositiveRate
            : (oasisTelemetry.attacksIssued > 0
                ? (oasisTelemetry.attacksIssuedNonPositive / oasisTelemetry.attacksIssued)
                : 0);

        log(
            'info',
            null,
            'Telemetría Oasis',
            `eval=${oasisTelemetry.evaluatedOases} pos=${oasisTelemetry.profitableOases} atk=${oasisTelemetry.attacksIssued} ` +
            `atk<=0=${oasisTelemetry.attacksIssuedNonPositive} npRate=${(nonPositiveRate * 100).toFixed(1)}% ` +
            `avgNet=${avgRewardNet.toFixed(0)} loss/gross=${lossToGross.toFixed(2)} unique=${oasisTelemetry.uniqueOasesAttacked}`,
            null,
            'military',
        );
    }

    return response.telemetry || null;
}
