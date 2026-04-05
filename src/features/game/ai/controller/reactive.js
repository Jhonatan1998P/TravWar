import { gameData } from '../../core/GameData.js';
import { CombatFormulas } from '../../core/CombatFormulas.js';

function getSlowestUnitSpeed(troops, race) {
    let slowestSpeed = Infinity;
    for (const unitId in troops) {
        if (troops[unitId] <= 0) continue;
        const unitData = gameData.units[race].troops.find(unit => unit.id === unitId);
        if (unitData && unitData.stats.speed < slowestSpeed) {
            slowestSpeed = unitData.stats.speed;
        }
    }
    return slowestSpeed === Infinity ? 0 : slowestSpeed;
}

function calculateTravelTime(originCoords, targetCoords, slowestSpeed, troopSpeed) {
    if (slowestSpeed <= 0) return Infinity;
    const distance = Math.hypot(targetCoords.x - originCoords.x, targetCoords.y - originCoords.y);
    return ((distance / (slowestSpeed * troopSpeed)) * 3600) * 1000;
}

function executeDodge({ village, troopsToDodge, gameState, sendCommand, log }) {
    if (Object.keys(troopsToDodge).length === 0) {
        log('info', village, 'Dodge Maneuver Skipped', 'No troops specified to dodge.', null, 'military');
        return;
    }

    const nearbyOases = gameState.mapData.filter(tile => tile.type === 'oasis' && Math.hypot(tile.x - village.coords.x, tile.y - village.coords.y) <= 10);
    if (nearbyOases.length === 0) {
        log('fail', village, 'Dodge Maneuver', 'No nearby oases found to dodge troops.', null, 'military');
        return;
    }

    const targetOasis = nearbyOases[Math.floor(Math.random() * nearbyOases.length)];
    sendCommand('send_movement', {
        originVillageId: village.id,
        targetCoords: { x: targetOasis.x, y: targetOasis.y },
        troops: troopsToDodge,
        missionType: 'raid',
    });
    log('success', village, 'Dodge Maneuver', `Troops sent to raid oasis at (${targetOasis.x}|${targetOasis.y}) to avoid combat.`, { troops: troopsToDodge }, 'military');
}

function manageReinforcements({
    targetVillage,
    attackPower,
    ignoreTravelTime,
    gameState,
    ownerId,
    race,
    gameConfig,
    dodgeTasks,
    sendCommand,
    log,
}) {
    const raceUnits = gameData.units[race].troops;
    const getDefensiveTroops = units => {
        const defensive = {};
        for (const unitId in units) {
            if (raceUnits.find(unit => unit.id === unitId)?.role.includes('defensive')) {
                defensive[unitId] = units[unitId];
            }
        }
        return defensive;
    };

    const wallLevel = targetVillage.buildings.find(building => building.type === 'cityWall')?.level || 0;
    const localDefensePower = CombatFormulas.calculateDefensePoints(
        [{ troops: getDefensiveTroops(targetVillage.unitsInVillage), race, smithyUpgrades: targetVillage.smithy.upgrades }],
        { infantry: 0.5, cavalry: 0.5 },
        race,
        wallLevel,
        0,
    );

    const neededPower = attackPower * 1.1;
    const deficit = neededPower - localDefensePower;
    if (deficit <= 0) {
        log('info', targetVillage, 'Defensa Coordinada', 'La defensa local es suficiente.', null, 'military');
        return;
    }

    const myOtherVillages = gameState.villages.filter(village => village.ownerId === ownerId && village.id !== targetVillage.id);
    const potentialReinforcements = [];

    for (const village of myOtherVillages) {
        const defensiveTroops = getDefensiveTroops(village.unitsInVillage);
        if (Object.keys(defensiveTroops).length === 0) continue;

        const slowestSpeed = getSlowestUnitSpeed(defensiveTroops, race);
        const travelTime = calculateTravelTime(village.coords, targetVillage.coords, slowestSpeed, gameConfig.troopSpeed);
        if (!ignoreTravelTime && Date.now() + travelTime >= (targetVillage.arrivalTime || Date.now() + 999999)) continue;

        const power = CombatFormulas.calculateDefensePoints(
            [{ troops: defensiveTroops, race: village.race, smithyUpgrades: village.smithy.upgrades }],
            { infantry: 0.5, cavalry: 0.5 },
            village.race,
            wallLevel,
            0,
        );

        potentialReinforcements.push({ village, troops: defensiveTroops, power, travelTime });
    }

    potentialReinforcements.sort((a, b) => a.travelTime - b.travelTime);

    let accumulatedPower = 0;
    const reinforcementsToSend = [];
    for (const reinforcement of potentialReinforcements) {
        if (accumulatedPower >= deficit) break;
        reinforcementsToSend.push(reinforcement);
        accumulatedPower += reinforcement.power;
    }

    const totalProjectedDefense = localDefensePower + accumulatedPower;
    if (totalProjectedDefense >= attackPower) {
        log('success', targetVillage, 'Defensa Coordinada', `Enjambre activado. ${reinforcementsToSend.length} aldeas enviando ayuda. Poder Total: ${totalProjectedDefense.toFixed(0)} vs Ataque: ${attackPower.toFixed(0)}`, null, 'military');
        reinforcementsToSend.forEach(({ village, troops }) => {
            sendCommand('send_movement', {
                originVillageId: village.id,
                targetCoords: targetVillage.coords,
                troops,
                missionType: 'reinforcement',
            });
        });
    } else {
        log('warn', targetVillage, 'Defensa Coordinada Fallida', `Ni con todo el imperio (${totalProjectedDefense.toFixed(0)}) podemos parar el ataque (${attackPower.toFixed(0)}). Iniciando evacuación.`, null, 'military');
        dodgeTasks.set(targetVillage.id + Date.now(), {
            arrivalTime: targetVillage.arrivalTime,
            villageId: targetVillage.id,
            troops: targetVillage.unitsInVillage,
        });
    }
}

export function handleEspionageReact({ movement, gameState, race, dodgeTasks, log }) {
    const targetVillage = gameState.villages.find(village => village.coords.x === movement.targetCoords.x && village.coords.y === movement.targetCoords.y);
    if (!targetVillage) return;

    const raceUnits = gameData.units[race].troops;
    const scoutUnit = raceUnits.find(unit => unit.type === 'scout');
    const hasScouts = scoutUnit && (targetVillage.unitsInVillage[scoutUnit.id] || 0) > 0;

    const troopsToDodge = {};
    if (hasScouts) {
        for (const unitId in targetVillage.unitsInVillage) {
            if (raceUnits.find(unit => unit.id === unitId)?.type !== 'scout') {
                troopsToDodge[unitId] = targetVillage.unitsInVillage[unitId];
            }
        }
        log('info', targetVillage, 'Counter-espionage', 'Espionage detected. Keeping scouts and dodging other troops.', { troopsToDodge }, 'military');
    } else {
        Object.assign(troopsToDodge, targetVillage.unitsInVillage);
        log('info', targetVillage, 'Counter-espionage', 'Espionage detected. No scouts to defend. Dodging all troops.', null, 'military');
    }

    if (Object.keys(troopsToDodge).length > 0) {
        dodgeTasks.set(movement.id, {
            arrivalTime: movement.arrivalTime,
            villageId: targetVillage.id,
            troops: troopsToDodge,
        });
    }
}

export function handleAttackReact({
    movement,
    gameState,
    race,
    archetype,
    ownerId,
    gameConfig,
    dodgeTasks,
    sendCommand,
    log,
}) {
    const targetVillage = gameState.villages.find(village => village.coords.x === movement.targetCoords.x && village.coords.y === movement.targetCoords.y);
    if (!targetVillage) return;

    const attackerRace = gameState.players.find(player => player.id === movement.ownerId)?.race || 'romans';
    const attackerVillage = gameState.villages.find(village => village.id === movement.originVillageId);
    const attackerSmithy = attackerVillage?.smithy.upgrades || {};
    const attackPower = CombatFormulas.calculateAttackPoints(movement.payload.troops, attackerRace, attackerSmithy).total;

    const hasSiege = Object.keys(movement.payload.troops).some(unitId => gameData.units[attackerRace].troops.find(unit => unit.id === unitId)?.role === 'catapult');
    const hasConquest = Object.keys(movement.payload.troops).some(unitId => gameData.units[attackerRace].troops.find(unit => unit.id === unitId)?.role === 'conquest');

    if (hasSiege || hasConquest) {
        if (archetype === 'rusher') {
            log('warn', targetVillage, 'Siege Reaction (Rusher)', 'Siege attack detected! Launching punitive counter-attack.', movement, 'military');
            const mySiegeUnits = {};
            const raceUnits = gameData.units[race].troops;
            const catapult = raceUnits.find(unit => unit.role === 'catapult');
            const ram = raceUnits.find(unit => unit.role === 'ram');
            if (catapult) mySiegeUnits[catapult.id] = targetVillage.unitsInVillage[catapult.id] || 0;
            if (ram) mySiegeUnits[ram.id] = targetVillage.unitsInVillage[ram.id] || 0;

            if (Object.values(mySiegeUnits).some(count => count > 0) && attackerVillage) {
                sendCommand('send_movement', {
                    originVillageId: targetVillage.id,
                    targetCoords: attackerVillage.coords,
                    troops: mySiegeUnits,
                    missionType: 'attack',
                    catapultTargets: ['warehouse', 'granary'],
                });
            }
        }

        log('warn', targetVillage, 'Siege Reaction', 'Siege attack detected! Organizing Swarm Defense.', movement, 'military');
        manageReinforcements({
            targetVillage,
            attackPower,
            ignoreTravelTime: true,
            gameState,
            ownerId,
            race,
            gameConfig,
            dodgeTasks,
            sendCommand,
            log,
        });
        return;
    }

    if (attackPower < targetVillage.population.current) {
        const localDefensePower = CombatFormulas.calculateDefensePoints(
            [{ troops: targetVillage.unitsInVillage, race, smithyUpgrades: targetVillage.smithy.upgrades }],
            { infantry: 0.5, cavalry: 0.5 },
            race,
            targetVillage.buildings.find(building => building.type === 'cityWall')?.level || 0,
            0,
        );
        if (localDefensePower > attackPower) {
            log('info', targetVillage, 'Local Defense', `Weak attack (${attackPower.toFixed(0)}) vs Local defense (${localDefensePower.toFixed(0)}). Holding position.`, null, 'military');
        } else {
            log('warn', targetVillage, 'Tactical Evasion', `Weak attack (${attackPower.toFixed(0)}) but stronger than local defense (${localDefensePower.toFixed(0)}). Evading.`, null, 'military');
            dodgeTasks.set(movement.id, { arrivalTime: movement.arrivalTime, villageId: targetVillage.id, troops: targetVillage.unitsInVillage });
        }
        return;
    }

    if (archetype === 'rusher') {
        log('info', targetVillage, 'Reaction (Rusher)', 'Rusher archetype: Evading attack to preserve offensive force.', null, 'military');
        dodgeTasks.set(movement.id, { arrivalTime: movement.arrivalTime, villageId: targetVillage.id, troops: targetVillage.unitsInVillage });
        return;
    }

    log('info', targetVillage, 'Reaction (Defensive)', 'Boomer/Turtle archetype: Organizing Swarm Defense.', null, 'military');
    manageReinforcements({
        targetVillage,
        attackPower,
        ignoreTravelTime: false,
        gameState,
        ownerId,
        race,
        gameConfig,
        dodgeTasks,
        sendCommand,
        log,
    });
}

export function processDodgeTasks({ gameState, dodgeTasks, dodgeTimeThresholdMs, sendCommand, log }) {
    if (dodgeTasks.size === 0) return;
    const now = Date.now();

    for (const [movementId, task] of dodgeTasks.entries()) {
        if (task.arrivalTime - now >= dodgeTimeThresholdMs) continue;

        const village = gameState.villages.find(candidate => candidate.id === task.villageId);
        if (village) {
            log('warn', village, 'Executing Dodge', `Imminent hostile movement (${((task.arrivalTime - now) / 1000).toFixed(1)}s). Dodging troops.`, task.troops, 'military');
            executeDodge({ village, troopsToDodge: task.troops, gameState, sendCommand, log });
        }
        dodgeTasks.delete(movementId);
    }
}

export function processReinforcementRecalls({ gameState, reinforcementTasks, sendCommand, log }) {
    const now = Date.now();
    const activeTasks = [];

    for (const task of reinforcementTasks) {
        if (now < task.expiryTime) {
            activeTasks.push(task);
            continue;
        }

        log('info', null, 'Reinforcement Recall', 'Initiating recall of reinforcement troops post-battle.', task, 'military');
        for (const reinforcement of task.reinforcements) {
            const reinforcedVillage = gameState.villages.find(village => village.id === reinforcement.to);
            if (!reinforcedVillage) continue;

            const reinforcementData = reinforcedVillage.reinforcements.find(entry => entry.fromVillageId === reinforcement.from);
            if (!reinforcementData || Object.keys(reinforcementData.troops).length === 0) continue;

            const originVillage = gameState.villages.find(village => village.id === reinforcement.from);
            if (!originVillage) continue;

            sendCommand('send_movement', {
                originVillageId: reinforcedVillage.id,
                targetCoords: originVillage.coords,
                troops: reinforcementData.troops,
                missionType: 'reinforcement',
            });
        }
    }

    return activeTasks;
}
