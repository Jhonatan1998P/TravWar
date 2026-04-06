import { countCombatTroopsInVillages } from '../utils/AITroopUtils.js';
import { MemoryManager } from '../index.js';

const MAX_PRIORITY_GOAL = 'MAX_PRIORITY_GOAL';

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

export function runMilitaryDecision({
    gameState,
    ownerId,
    race,
    archetype,
    personality,
    gameConfig,
    strategicAI,
    executeCommands,
    log,
    reputationManager,
}) {
    log('info', null, 'INICIO_CICLO_MILITAR', 'Evaluating military actions (Deterministic).');

    const aiPlayerState = gameState.players.find(player => player.id === ownerId);
    if (!aiPlayerState) return null;

    if (aiPlayerState.isUnderProtection) {
        log('info', null, 'Ciclo Militar Omitido', 'AI is under beginner protection.', null, 'military');
        return null;
    }

    const myVillages = gameState.villages.filter(village => village.ownerId === ownerId);
    const totalPopulation = myVillages.reduce((sum, village) => sum + village.population.current, 0);
    const combatTroopCount = countCombatTroopsInVillages(myVillages, race);

    const requiredTroops = totalPopulation * 0.15;
    if (combatTroopCount < requiredTroops) {
        log('warn', null, 'Ciclo Militar Omitido', `Gathering forces. Combat troops (${combatTroopCount}) are below the required threshold (${requiredTroops.toFixed(0)}).`, null, 'military');
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

    log('info', null, 'Strategic AI', 'Computing utility scores for potential targets...', null, 'military');
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
        },
    );

    if (response.razonamiento) {
        log('goal', null, 'Razonamiento Estratégico', 'The General has issued the following analysis:', response.razonamiento, 'military');
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

    if (commandsToExecute.length > 0) {
        log('success', null, 'Órdenes Recibidas', `Executing ${commandsToExecute.length} military commands.`, commandsToExecute, 'military');
        executeCommands(commandsToExecute, gameState);
    } else {
        log('info', null, 'Sin Comandos', 'The AI General issued no commands this cycle.', null, 'military');
    }

    const gateTelemetry = response.telemetry?.militaryGate;
    if (gateTelemetry) {
        log(
            'info',
            null,
            'Gate Militar',
            `maxPriority=${gateTelemetry.hasMaxPriorityGoal ? 'yes' : 'no'} ` +
            `blocked=${gateTelemetry.farmBlockedByMaxPriorityGoal ? 'yes' : 'no'} ` +
            `mustering=${gateTelemetry.isMusteringForWar ? 'yes' : 'no'} ` +
            `farmEval=${gateTelemetry.farmEvaluationExecuted ? 'yes' : 'no'}`,
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
