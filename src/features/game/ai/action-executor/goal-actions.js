import { gameData } from '../../core/GameData.js';
import { CombatFormulas } from '../../core/CombatFormulas.js';
import { AI_SETTLEMENT_CONSTANTS } from '../config/AIConstants.js';
import { getUnitTotalCost } from '../utils/AIUnitUtils.js';
import { calculateBeastBountyValue } from '../../core/OasisEconomy.js';

export function findStrongestVillage(villages, race) {
    if (!villages || villages.length === 0) return null;

    let strongestVillage = null;
    let maxAttackPower = -1;
    for (const village of villages) {
        const attackPoints = CombatFormulas.calculateAttackPoints(village.unitsInVillage, race, village.smithy.upgrades);
        if (attackPoints.total > maxAttackPower) {
            maxAttackPower = attackPoints.total;
            strongestVillage = village;
        }
    }

    return strongestVillage || villages[0];
}

export function findBestSettlementLocation(myVillages, gameState) {
    const { maxSearchRadius, minDistanceFromExistingVillage } = AI_SETTLEMENT_CONSTANTS;
    const allVillageCoords = new Set(gameState.villages.map(village => `${village.coords.x}|${village.coords.y}`));
    const potentialSpots = [];

    for (const tile of gameState.mapData) {
        if (tile.type !== 'valley') continue;
        if (allVillageCoords.has(`${tile.x}|${tile.y}`)) continue;

        const distFromCapital = Math.hypot(tile.x - myVillages[0].coords.x, tile.y - myVillages[0].coords.y);
        if (distFromCapital > maxSearchRadius) continue;

        let isTooClose = false;
        for (const villageCoord of allVillageCoords) {
            const [vx, vy] = villageCoord.split('|').map(Number);
            if (Math.hypot(tile.x - vx, tile.y - vy) < minDistanceFromExistingVillage) {
                isTooClose = true;
                break;
            }
        }
        if (isTooClose) continue;

        let score = 0;
        if (tile.valleyType === '1-1-1-15') score += 1000;
        else if (tile.valleyType === '3-3-3-9') score += 500;

        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                if (dx === 0 && dy === 0) continue;
                const neighbor = gameState.mapData.find(candidate => candidate.x === tile.x + dx && candidate.y === tile.y + dy);
                if (neighbor && neighbor.type === 'oasis') {
                    const oasisDetails = gameData.oasisTypes[neighbor.oasisType];
                    if (oasisDetails.bonus.resource === 'food') score += 150;
                    else score += 75;
                }
            }
        }

        score -= (distFromCapital * 10) + (distFromCapital * distFromCapital * 0.5);
        if (score > 0) potentialSpots.push({ ...tile, score });
    }

    if (potentialSpots.length === 0) return null;
    potentialSpots.sort((a, b) => b.score - a.score);
    return potentialSpots[0];
}

export function executeFarmOases({ action, villages, gameState, race, sendCommand, log, troopSpeed = 1 }) {
    const { radius = 5, maxArmyPercentageToSend = 0.25 } = action;
    const village = findStrongestVillage(villages, race);
    if (!village) return;

    const totalArmy = village.unitsInVillage;
    const armyToFarm = {};
    for (const unitId in totalArmy) {
        armyToFarm[unitId] = Math.floor(totalArmy[unitId] * maxArmyPercentageToSend);
    }
    if (Object.keys(armyToFarm).length === 0) return;

    const farmableOases = gameState.mapData.filter(tile => {
        if (tile.type !== 'oasis' || !tile.state?.beasts) return false;
        const distance = Math.hypot(tile.x - village.coords.x, tile.y - village.coords.y);
        return distance <= radius && distance > 0;
    });
    if (farmableOases.length === 0) return;

    const attackerPower = CombatFormulas.calculateAttackPoints(armyToFarm, race, village.smithy.upgrades).total;
    const oasisConfig = gameData.config.oasis || {};
    const distanceCost = oasisConfig.raidTravelCostPerDistance || 8;
    const minuteCost = oasisConfig.raidTravelCostPerMinute || 15;
    const raceUnits = gameData.units[race]?.troops || [];

    let bestTarget = null;
    let bestRewardNet = -Infinity;
    for (const oasis of farmableOases) {
        const defenderTroops = oasis.state.beasts || {};
        const defenderPower = CombatFormulas.calculateDefensePoints([{ troops: defenderTroops, race: 'nature' }], { infantry: 0.5, cavalry: 0.5 }, 'nature', 0, 0);
        if (attackerPower <= 0 || defenderPower <= 0) continue;

        let attackerLossPercent = 0;
        let defenderLossPercent = 0;
        if (attackerPower > defenderPower) {
            attackerLossPercent = CombatFormulas.calculateRaidWinnerLosses(attackerPower, defenderPower);
            defenderLossPercent = 1.0 - attackerLossPercent;
        } else {
            attackerLossPercent = 1.0 - CombatFormulas.calculateRaidWinnerLosses(defenderPower, attackerPower);
            defenderLossPercent = 1.0 - attackerLossPercent;
        }

        const estimatedDefenderLosses = {};
        for (const [beastId, count] of Object.entries(defenderTroops)) {
            if (!count || count <= 0) continue;
            const lost = Math.min(count, Math.round(count * defenderLossPercent));
            if (lost > 0) estimatedDefenderLosses[beastId] = lost;
        }

        const rewardGross = calculateBeastBountyValue(estimatedDefenderLosses);

        let lossValue = 0;
        for (const [unitId, count] of Object.entries(armyToFarm)) {
            if (!count || count <= 0) continue;
            const unitData = raceUnits.find(unit => unit.id === unitId);
            if (!unitData) continue;
            const lost = Math.min(count, Math.round(count * attackerLossPercent));
            lossValue += getUnitTotalCost(unitData) * lost;
        }

        let slowestSpeed = Infinity;
        for (const [unitId, count] of Object.entries(armyToFarm)) {
            if (!count || count <= 0) continue;
            const unitData = raceUnits.find(unit => unit.id === unitId);
            if (!unitData) continue;
            if (unitData.stats.speed < slowestSpeed) slowestSpeed = unitData.stats.speed;
        }

        const distance = Math.hypot(oasis.x - village.coords.x, oasis.y - village.coords.y);
        const effectiveSpeed = Number.isFinite(slowestSpeed) ? Math.max(slowestSpeed * (troopSpeed || 1), 0.1) : 0.1;
        const travelMinutes = (distance / effectiveSpeed) * 60;
        const travelCost = (distance * distanceCost) + (travelMinutes * minuteCost);
        const rewardNet = rewardGross - lossValue - travelCost;

        if (rewardNet > bestRewardNet) {
            bestRewardNet = rewardNet;
            bestTarget = oasis;
        }
    }

    if (!bestTarget || bestRewardNet <= 0) {
        log('info', village, 'Farmeo de Oasis', 'Sin objetivos rentables: RewardNet <= 0 en todos los oasis del radio.');
        return;
    }

    log('success', village, 'Farmeo de Oasis', `Enviando ${maxArmyPercentageToSend * 100}% del ejército a saquear ${bestTarget.x}|${bestTarget.y} (RewardNet ${bestRewardNet.toFixed(0)}).`);
    sendCommand('send_movement', {
        originVillageId: village.id,
        targetCoords: { x: bestTarget.x, y: bestTarget.y },
        troops: armyToFarm,
        missionType: 'raid',
    });
}

export function executeRebalanceResources({ action, villages, sendCommand, log }) {
    if (villages.length < 2) return;

    const { threshold = 0.9 } = action;
    let sourceVillage = null;
    let destVillage = null;
    let resourceToSend = null;
    let maxSurplus = -1;
    let maxDeficit = -1;

    for (const village of villages) {
        for (const resource in village.resources) {
            const ratio = village.resources[resource].current / village.resources[resource].capacity;
            if (ratio > threshold && ratio > maxSurplus) {
                maxSurplus = ratio;
                sourceVillage = village;
                resourceToSend = resource;
            }
        }
    }
    if (!sourceVillage) return;

    for (const village of villages) {
        if (village.id === sourceVillage.id) continue;
        const ratio = village.resources[resourceToSend].current / village.resources[resourceToSend].capacity;
        const deficit = 1 - ratio;
        if (deficit > maxDeficit) {
            maxDeficit = deficit;
            destVillage = village;
        }
    }

    if (!sourceVillage || !destVillage) return;

    const amountToSend = Math.floor(sourceVillage.resources[resourceToSend].current - (sourceVillage.resources[resourceToSend].capacity * threshold));
    if (amountToSend <= 0) return;

    log('success', sourceVillage, 'Rebalanceo de Recursos', `Enviando ${amountToSend} de ${resourceToSend} a ${destVillage.name}.`);
    sendCommand('send_merchants', {
        originVillageId: sourceVillage.id,
        targetCoords: destVillage.coords,
        resources: { [resourceToSend]: amountToSend },
    });
}

export function executeSettleNewVillage({
    villages,
    gameState,
    ownerId,
    resolveUnitId,
    sendCommand,
    log,
}) {
    if (gameState.movements.some(movement => movement.ownerId === ownerId && movement.type === 'settle')) {
        log('info', null, 'Colonización', 'Ya hay una misión de colonización en curso. Esperando...');
        return;
    }

    const settlerUnitId = resolveUnitId('settler');
    const settlerVillage = villages.find(village => (village.unitsInVillage[settlerUnitId] || 0) >= 3);
    if (!settlerVillage) {
        log('fail', null, 'Colonización', 'No se puede colonizar: No se encontró ninguna aldea con 3 colonos.');
        return;
    }

    const targetLocation = findBestSettlementLocation(villages, gameState);
    if (!targetLocation) {
        log('warn', null, 'Colonización', 'No se pudo encontrar una ubicación adecuada para colonizar.');
        return;
    }

    log('success', settlerVillage, 'Colonización', `Objetivo fijado en ${targetLocation.x}|${targetLocation.y} (Puntuación: ${targetLocation.score.toFixed(0)}). Enviando colonos.`);
    sendCommand('send_movement', {
        originVillageId: settlerVillage.id,
        targetCoords: { x: targetLocation.x, y: targetLocation.y },
        troops: { [settlerUnitId]: 3 },
        missionType: 'settle',
    });
}
