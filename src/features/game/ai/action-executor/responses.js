import { gameData } from '../../core/GameData.js';
import { CombatFormulas } from '../../core/CombatFormulas.js';

export function shouldEndDefensiveStance({ gameState, lastAttackerInfo, log }) {
    if (!lastAttackerInfo) return true;

    const attackerPlayerState = gameState.players.find(player => player.id === lastAttackerInfo.id);
    if (attackerPlayerState && attackerPlayerState.isUnderProtection) {
        log('info', null, 'Represalia Abortada', `El atacante ${lastAttackerInfo.id} está ahora bajo protección.`);
        return true;
    }

    const lastReport = gameState.reports.find(report => report.attacker.ownerId === lastAttackerInfo.id);
    if (lastReport && lastReport.summary.defender.lostUpkeep === 0) {
        log('info', null, 'Represalia Ignorada', 'El último ataque no causó daños. Saliendo de postura defensiva.');
        return true;
    }

    return false;
}

function buildRetaliationForce(village, race, requiredPower) {
    const forceToSend = {};
    let sentPower = 0;

    const sortedTroops = Object.entries(village.unitsInVillage)
        .map(([id, count]) => ({
            id,
            count,
            unitData: gameData.units[race].troops.find(unit => unit.id === id),
        }))
        .filter(item => item.unitData && item.unitData.stats.attack > 0)
        .sort((a, b) => (b.unitData.stats.attack / b.unitData.upkeep) - (a.unitData.stats.attack / a.unitData.upkeep));

    for (const item of sortedTroops) {
        if (sentPower >= requiredPower) break;
        const troopsToAdd = Math.min(item.count, Math.ceil((requiredPower - sentPower) / item.unitData.stats.attack));
        forceToSend[item.id] = (forceToSend[item.id] || 0) + troopsToAdd;
        sentPower += troopsToAdd * item.unitData.stats.attack;
    }

    return forceToSend;
}

export function executeDefensiveStance({
    villages,
    gameState,
    archetype,
    lastAttackerInfo,
    race,
    personality,
    manageRecruitmentForGoal,
    attemptUpgrade,
    sendCommand,
    log,
}) {
    const village = villages[0];
    log('info', village, 'Postura Defensiva', `Arquetipo '${archetype}'.`);

    if (archetype === 'turtle') {
        const wall = village.buildings.find(building => building.type === 'cityWall');
        if (wall && wall.level < 20 && attemptUpgrade(village, wall, 'cityWall')) {
            return;
        }

        manageRecruitmentForGoal(village, gameState, { type: 'units', unitType: 'defensive_infantry' });
        return;
    }

    manageRecruitmentForGoal(village, gameState, { type: 'units', unitType: 'offensive_infantry' });

    const myArmyPower = CombatFormulas.calculateAttackPoints(village.unitsInVillage, race, village.smithy.upgrades).total;
    const attackerPlayerState = gameState.players.find(player => player.id === lastAttackerInfo.id);
    const attackerVillage = gameState.villages.find(candidate => candidate.ownerId === lastAttackerInfo.id);
    if (!attackerVillage) return;

    const attackerRace = attackerPlayerState?.race || 'romans';
    const attackerSmithy = attackerVillage?.smithy.upgrades || {};
    const attackerArmyPower = CombatFormulas.calculateAttackPoints(lastAttackerInfo.army, attackerRace, attackerSmithy).total;

    if (myArmyPower > attackerArmyPower * personality.defensiveConfig.retaliationThreshold) {
        log('success', village, 'Represalia', `Fuerza suficiente reunida (Poder: ${myArmyPower.toFixed(0)}). ¡Contraatacando!`);

        const requiredPower = attackerArmyPower * 1.25;
        const forceToSend = buildRetaliationForce(village, race, requiredPower);

        sendCommand('send_movement', {
            originVillageId: village.id,
            targetCoords: attackerVillage.coords,
            troops: forceToSend,
            missionType: 'attack',
        });

        return true;
    }

    return false;
}
