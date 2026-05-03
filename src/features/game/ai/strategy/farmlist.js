import { gameData } from '../../core/GameData.js';
import { getUnitTotalCost } from '../utils/AIUnitUtils.js';

const FARM_MAX_TROOPS = 30;
const FARM_MIN_RESOURCES = 200;
const FARM_FAIL_LIMIT = 3;
const FARM_FAST_INTERVAL_MS = 30 * 60 * 1000;
const FARM_DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const FARM_SLOW_INTERVAL_MS = 2 * 60 * 60 * 1000;
const FARM_MAX_DISTANCE = 35;

function countTroops(troops = {}) {
    return Object.values(troops).reduce((s, c) => s + (c || 0), 0);
}

function resolveFarmInterval(resourceTotal) {
    if (resourceTotal >= 2000) return FARM_FAST_INTERVAL_MS;
    if (resourceTotal >= 800) return FARM_DEFAULT_INTERVAL_MS;
    return FARM_SLOW_INTERVAL_MS;
}

export function updateFarmList(aiState, knownTargets, ownerId, myVillages, maxFarms = 25) {
    if (!Array.isArray(aiState.farmList)) aiState.farmList = [];
    const farmList = aiState.farmList;
    const existingMap = new Map(farmList.map(f => [f.targetId, f]));
    const now = Date.now();

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
            entry.farmIntervalMs = resolveFarmInterval(resourceTotal);
            continue;
        }

        if (farmList.length >= maxFarms) continue;
        if (troopCount > FARM_MAX_TROOPS) continue;
        if (resourceTotal < FARM_MIN_RESOURCES) continue;

        const minDist = myVillages.reduce((min, v) => {
            const d = Math.hypot(v.coords.x - target.coords.x, v.coords.y - target.coords.y);
            return d < min ? d : min;
        }, Infinity);
        if (minDist > FARM_MAX_DISTANCE) continue;

        farmList.push({
            targetId: target.id,
            coords: { x: target.coords.x, y: target.coords.y },
            ownerId: target.ownerId,
            lastFarmedAt: 0,
            knownTroopCount: troopCount,
            knownResourceTotal: resourceTotal,
            farmIntervalMs: resolveFarmInterval(resourceTotal),
            failCount: 0,
            addedAt: now,
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

function getCheapOffensiveUnit(force, raceUnits) {
    let best = null;
    let lowestCost = Infinity;
    for (const unitId in force.combatTroops) {
        const count = force.combatTroops[unitId] || 0;
        if (count < 5) continue;
        const unitData = raceUnits.find(u => u.id === unitId);
        if (!unitData) continue;
        if (unitData.role !== 'offensive') continue;
        if (unitData.type === 'siege') continue;
        const cost = getUnitTotalCost(unitData);
        if (cost > 0 && cost < lowestCost) {
            lowestCost = cost;
            best = { unitId, unitData, count };
        }
    }
    return best;
}

export function runFarmListCycle({
    farmList,
    forces,
    gameState,
    ownerId,
    race,
    consumeTroops,
    hasActiveAttackFn,
}) {
    const commands = [];
    const logs = [];
    const now = Date.now();

    if (!farmList || farmList.length === 0) return { commands, logs };

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
                cheapUnit: getCheapOffensiveUnit(force, raceUnits),
            }))
            .filter(e => e.cheapUnit !== null)
            .sort((a, b) => a.dist - b.dist);

        if (viableForces.length === 0) continue;

        const { force, cheapUnit, dist } = viableForces[0];
        if (dist > 40) continue;

        const raidCount = Math.min(
            cheapUnit.count,
            Math.max(5, farmEntry.knownTroopCount * 2 + 5),
        );
        const raidSquad = { [cheapUnit.unitId]: raidCount };

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

        logs.push(
            `[FARMLIST] ${force.village.name} -> (${farmEntry.coords.x}|${farmEntry.coords.y}) ` +
            `[${raidCount}x${cheapUnit.unitId}] dist=${dist.toFixed(0)} res=${farmEntry.knownResourceTotal}.`,
        );
    }

    if (farmedCount > 0) {
        logs.push(`[FARMLIST] ${farmedCount} granjas atacadas. Total en lista: ${farmList.length}.`);
    }

    return { commands, logs };
}
