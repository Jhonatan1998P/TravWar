import { gameData } from '../../core/GameData.js';
import { getUnitTotalCost } from '../utils/AIUnitUtils.js';

const FARM_MAX_TROOPS = 30;
const FARM_MIN_RESOURCES = 200;
const FARM_FAIL_LIMIT = 3;
const FARM_FAST_INTERVAL_BASE_MS = 30 * 60 * 1000;
const FARM_DEFAULT_INTERVAL_BASE_MS = 60 * 60 * 1000;
const FARM_SLOW_INTERVAL_BASE_MS = 2 * 60 * 60 * 1000;
const FARM_INTERVAL_MIN_MS = 5 * 60 * 1000;
const FARM_BASE_MAX_DISTANCE = 35;
const FARM_MAX_DISTANCE_CAP = 80;

function countTroops(troops = {}) {
    return Object.values(troops).reduce((s, c) => s + (c || 0), 0);
}

function resolveFarmInterval(resourceTotal, gameSpeed) {
    const speed = Math.max(1, gameSpeed || 1);
    let base;
    if (resourceTotal >= 2000) base = FARM_FAST_INTERVAL_BASE_MS;
    else if (resourceTotal >= 800) base = FARM_DEFAULT_INTERVAL_BASE_MS;
    else base = FARM_SLOW_INTERVAL_BASE_MS;
    return Math.max(FARM_INTERVAL_MIN_MS, Math.round(base / speed));
}

function resolveMaxDistance(troopSpeed) {
    const speed = Math.max(1, troopSpeed || 1);
    return Math.min(FARM_MAX_DISTANCE_CAP, Math.round(FARM_BASE_MAX_DISTANCE * Math.sqrt(speed)));
}

export function updateFarmList(aiState, knownTargets, ownerId, myVillages, gameSpeed = 1, maxFarms = 25) {
    if (!Array.isArray(aiState.farmList)) aiState.farmList = [];
    const farmList = aiState.farmList;
    const existingMap = new Map(farmList.map(f => [f.targetId, f]));

    for (const target of knownTargets) {
        if (target.type !== 'village') continue;
        if (target.ownerId === ownerId || target.ownerId === 'nature') continue;
        if (!target.intel) continue;

        const intel = target.intel.payload || {};
        const troopCount = countTroops(intel.troops || {});
        const resources = intel.resources || {};
        const resourceTotal = (resources.wood || 0) + (resources.stone || 0)
            + (resources.iron || 0) + (resources.food || 0);

        if (existingMap.has(target.id)) {
            const entry = existingMap.get(target.id);
            entry.knownTroopCount = troopCount;
            entry.knownResourceTotal = resourceTotal;
            entry.farmIntervalMs = resolveFarmInterval(resourceTotal, gameSpeed);
            continue;
        }

        if (farmList.length >= maxFarms) continue;
        if (troopCount > FARM_MAX_TROOPS) continue;
        if (resourceTotal < FARM_MIN_RESOURCES) continue;

        const minDist = myVillages.reduce((min, v) => {
            const d = Math.hypot(v.coords.x - target.coords.x, v.coords.y - target.coords.y);
            return d < min ? d : min;
        }, Infinity);
        if (minDist > FARM_BASE_MAX_DISTANCE) continue;

        farmList.push({
            targetId: target.id,
            coords: { x: target.coords.x, y: target.coords.y },
            ownerId: target.ownerId,
            lastFarmedAt: 0,
            knownTroopCount: troopCount,
            knownResourceTotal: resourceTotal,
            farmIntervalMs: resolveFarmInterval(resourceTotal, gameSpeed),
            failCount: 0,
            addedAt: Date.now(),
        });
        existingMap.set(target.id, farmList[farmList.length - 1]);
    }

    const activeIds = new Set(knownTargets.map(t => t.id));
    aiState.farmList = farmList.filter(entry =>
        entry.failCount < FARM_FAIL_LIMIT
        && activeIds.has(entry.targetId)
        && entry.knownTroopCount <= FARM_MAX_TROOPS,
    );

    return aiState.farmList;
}

function getOptimalRaidUnit(force, raceUnits) {
    const smithyUpgrades = force.village?.smithy?.upgrades || {};
    let best = null;
    let bestScore = -Infinity;

    for (const unitId in force.combatTroops) {
        const count = force.combatTroops[unitId] || 0;
        if (count < 5) continue;
        const unitData = raceUnits.find(u => u.id === unitId);
        if (!unitData) continue;
        if (unitData.role !== 'offensive') continue;
        if (unitData.type === 'siege') continue;
        const totalCost = getUnitTotalCost(unitData);
        if (totalCost <= 0) continue;
        const smithyBonus = 1 + ((smithyUpgrades[unitId] || 0) * 0.0075);
        const effectiveAttack = (unitData.stats?.attack || 0) * smithyBonus;
        if (effectiveAttack <= 0) continue;
        const attackPerCost = effectiveAttack / totalCost;
        if (attackPerCost > bestScore) {
            bestScore = attackPerCost;
            best = { unitId, unitData, count, effectiveAttack, attackPerCost };
        }
    }
    return best;
}

function calcRaidCount(optUnit, knownTroopCount) {
    if (knownTroopCount <= 0) {
        return Math.min(optUnit.count, 10);
    }
    const attackNeeded = knownTroopCount * 4;
    const unitsNeeded = Math.max(5, Math.ceil(attackNeeded / optUnit.effectiveAttack) + 3);
    return Math.min(optUnit.count, unitsNeeded);
}

export function runFarmListCycle({
    farmList,
    forces,
    gameState,
    ownerId,
    race,
    gameSpeed = 1,
    troopSpeed = 1,
    consumeTroops,
    hasActiveAttackFn,
}) {
    const commands = [];
    const logs = [];
    const now = Date.now();

    if (!farmList || farmList.length === 0) return { commands, logs };

    const effectiveMaxDist = resolveMaxDistance(troopSpeed);
    const raceUnits = gameData.units[race]?.troops || [];

    const due = farmList.filter(entry => now >= entry.lastFarmedAt + entry.farmIntervalMs);
    if (due.length === 0) return { commands, logs };

    due.sort((a, b) => {
        const aDue = now - (a.lastFarmedAt + a.farmIntervalMs);
        const bDue = now - (b.lastFarmedAt + b.farmIntervalMs);
        if (bDue !== aDue) return bDue - aDue;
        return b.knownResourceTotal - a.knownResourceTotal;
    });

    let farmedCount = 0;

    for (const farmEntry of due) {
        if (hasActiveAttackFn && hasActiveAttackFn(gameState, farmEntry.targetId, ownerId)) continue;

        const viableForces = forces
            .map(force => ({
                force,
                dist: Math.hypot(
                    force.village.coords.x - farmEntry.coords.x,
                    force.village.coords.y - farmEntry.coords.y,
                ),
                optUnit: getOptimalRaidUnit(force, raceUnits),
            }))
            .filter(e => e.optUnit !== null && e.dist <= effectiveMaxDist)
            .sort((a, b) => {
                const scoreA = a.optUnit.attackPerCost - a.dist * 0.01;
                const scoreB = b.optUnit.attackPerCost - b.dist * 0.01;
                return scoreB - scoreA;
            });

        if (viableForces.length === 0) continue;

        const { force, optUnit, dist } = viableForces[0];
        const raidCount = calcRaidCount(optUnit, farmEntry.knownTroopCount);
        if (raidCount <= 0) continue;

        const raidSquad = { [optUnit.unitId]: raidCount };

        commands.push({
            comando: 'ATTACK',
            villageId: force.village.id,
            parametros: {
                targetCoords: farmEntry.coords,
                tropas: raidSquad,
                mision: 'raid',
            },
            meta: { farmList: true, farmTargetId: farmEntry.targetId },
        });

        consumeTroops(force, raidSquad);
        farmEntry.lastFarmedAt = now;
        farmedCount++;

        const intervalMin = Math.round(farmEntry.farmIntervalMs / 60000);
        logs.push(
            `[FARMLIST] ${force.village.name} -> (${farmEntry.coords.x}|${farmEntry.coords.y}) ` +
            `[${raidCount}x${optUnit.unitId} atk/cost=${optUnit.attackPerCost.toFixed(2)}] ` +
            `dist=${dist.toFixed(0)} res=${farmEntry.knownResourceTotal} ` +
            `intervalo=${intervalMin}min (${gameSpeed}x velocidad).`,
        );
    }

    if (farmedCount > 0) {
        logs.push(
            `[FARMLIST] ${farmedCount} granjas atacadas | maxDist=${effectiveMaxDist} tiles | ` +
            `gameSpeed=${gameSpeed}x troopSpeed=${troopSpeed}x | total lista: ${farmList.length}.`,
        );
    }

    return { commands, logs };
}
