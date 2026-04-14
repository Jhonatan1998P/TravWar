import { gameData } from '../../core/GameData.js';

const NON_COMBAT_TYPES = new Set(['settler', 'chief', 'scout']);
const SIEGE_ROLES = new Set(['ram', 'catapult']);

const TRAINING_BUILDING_BY_TYPE = Object.freeze({
    infantry: 'barracks',
    scout: 'barracks',
    cavalry: 'stable',
    siege: 'workshop',
    settler: 'palace',
    chief: 'palace',
});

function getTroopsForRace(race) {
    return gameData.units[race]?.troops || [];
}

export function getUnitTotalCost(unitData) {
    if (!unitData?.cost) return 0;
    return (unitData.cost.wood || 0) + (unitData.cost.stone || 0) + (unitData.cost.iron || 0) + (unitData.cost.food || 0);
}

function getUpkeep(unitData) {
    return Math.max(1, Number(unitData?.upkeep) || 1);
}

function getTrainTime(unitData) {
    return Math.max(1, Number(unitData?.trainTime) || 1);
}

function getOffensiveQuality(unitData) {
    const attack = Number(unitData?.stats?.attack) || 0;
    const speed = Number(unitData?.stats?.speed) || 0;
    return attack + (speed * 0.8);
}

function getDefensiveQuality(unitData) {
    const defenseInf = Number(unitData?.stats?.defense?.infantry) || 0;
    const defenseCav = Number(unitData?.stats?.defense?.cavalry) || 0;
    const speed = Number(unitData?.stats?.speed) || 0;
    return (((defenseInf * 0.55) + (defenseCav * 0.45)) + (speed * 0.5));
}

function getEconomicPenalty(unitData) {
    const totalCost = Math.max(1, getUnitTotalCost(unitData));
    const upkeep = getUpkeep(unitData);
    const trainTime = getTrainTime(unitData);
    return totalCost * (1 + (upkeep * 0.35)) * (1 + (trainTime / 10000));
}

function getEfficiencyScore(unitData, qualityFn) {
    const quality = qualityFn(unitData);
    if (quality <= 0) return 0;
    return quality / getEconomicPenalty(unitData);
}

export function resolveUnitIdForRace(identifier, race) {
    const troops = getTroopsForRace(race);
    if (troops.length === 0 || !identifier) return undefined;

    const directMatch = troops.find(t => t.id === identifier);
    if (directMatch) return directMatch.id;

    const findBestUnit = (filterFn, scoreFn) => {
        const candidates = troops.filter(filterFn);
        if (candidates.length === 0) return undefined;
        if (candidates.length === 1) return candidates[0].id;
        return candidates.reduce((best, current) => scoreFn(current) > scoreFn(best) ? current : best).id;
    };

    const findBestByRolePriority = (unitType, primaryRoles, secondaryRoles, scoreFn) => {
        const primary = findBestUnit(
            troop => troop.type === unitType && primaryRoles.includes(troop.role),
            scoreFn,
        );
        if (primary) return primary;

        const secondary = findBestUnit(
            troop => troop.type === unitType && secondaryRoles.includes(troop.role),
            scoreFn,
        );
        if (secondary) return secondary;

        return findBestUnit(troop => troop.type === unitType, scoreFn);
    };

    const defensiveScore = troop => getEfficiencyScore(troop, getDefensiveQuality);
    const offensiveScore = troop => getEfficiencyScore(troop, getOffensiveQuality);

    switch (identifier) {
        case 'defensive_infantry':
            return findBestByRolePriority('infantry', ['defensive'], ['versatile'], defensiveScore);
        case 'offensive_infantry':
            return findBestByRolePriority('infantry', ['offensive'], ['versatile'], offensiveScore);
        case 'defensive_cavalry':
            return findBestByRolePriority('cavalry', ['defensive'], ['versatile'], defensiveScore);
        case 'offensive_cavalry':
            return findBestByRolePriority('cavalry', ['offensive'], ['versatile'], offensiveScore);
        case 'siege':
            return troops.find(t => t.type === 'siege')?.id;
        case 'ram':
            return troops.find(t => t.type === 'siege' && t.id.includes('ram'))?.id;
        case 'catapult':
            return troops.find(t => t.type === 'siege' && (t.id.includes('catapult') || t.id.includes('trebuchet')))?.id;
        case 'settler':
            return troops.find(t => t.type === 'settler')?.id;
        case 'chief':
            return troops.find(t => t.type === 'chief')?.id;
        case 'scout':
            return troops.find(t => t.type === 'scout')?.id;
        default:
            return troops.find(t => t.id === identifier)?.id;
    }
}

export function getTrainingBuildingForUnitId(unitId, race) {
    const unitData = getTroopsForRace(race).find(unit => unit.id === unitId);
    if (!unitData) return null;
    return TRAINING_BUILDING_BY_TYPE[unitData.type] || null;
}

export function filterNonCombatTroopsInPlace(troops, race) {
    const raceUnits = getTroopsForRace(race);
    for (const unitId of Object.keys(troops)) {
        const unit = raceUnits.find(u => u.id === unitId);
        if (!unit || NON_COMBAT_TYPES.has(unit.type)) {
            delete troops[unitId];
        }
    }
}

export function extractSiegeTroops(troops, race) {
    const raceUnits = getTroopsForRace(race);
    const siegeTroops = {};

    for (const [unitId, count] of Object.entries(troops)) {
        const unit = raceUnits.find(u => u.id === unitId);
        if (unit && SIEGE_ROLES.has(unit.role)) {
            siegeTroops[unitId] = count;
        }
    }

    return siegeTroops;
}

export function consumeForceTroops(force, troopsUsed) {
    for (const [unitId, count] of Object.entries(troopsUsed)) {
        if (force.troops[unitId]) force.troops[unitId] -= count;
        if (force.combatTroops[unitId]) force.combatTroops[unitId] -= count;
        if (force.siegeTroops[unitId]) force.siegeTroops[unitId] -= count;
    }
}
