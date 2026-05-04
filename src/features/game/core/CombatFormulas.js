// RUTA: js/core/CombatFormulas.js
import { gameData } from './GameData.js';

const SIEGE_CONSTANTS = {
    WALL_DURABILITY_FACTOR: 1.4,
    BASE_WALL_RESISTANCE: 10,
    BUILDING_DURABILITY_FACTOR: 1.65,
    BASE_BUILDING_RESISTANCE: 12,
};

function getWallBonus(race, level) {
    if (level <= 0) return 1.0;
    const base = {
        romans: 1.030,
        germans: 1.020,
        gauls: 1.025,
        huns: 1.020,
        egyptians: 1.033,
    };
    return Math.pow(base[race] || 1.0, level);
}

function getPalaceBonus(level) {
    if (level <= 0) return 0;
    return 2 * (level * level);
}

function getSmithyBonus(level) {
    if (level <= 0) return 1.0;
    const bonusPerLevel = 0.0075; 
    return 1.0 + (level * bonusPerLevel);
}

function getMoraleBonus(attackerPop, defenderPop) {
    if (attackerPop <= defenderPop) {
        return 1.0;
    }
    const ratio = attackerPop / defenderPop;
    const bonus = Math.pow(ratio, 0.2);
    return Math.min(1.5, bonus);
}

function calculateAttackPoints(troops, race, smithyUpgrades) {
    const raceData = gameData.units[race];
    if (!raceData) return { total: 0, infantry: 0, cavalry: 0, siege: 0 };

    let totalAttack = 0;
    let infantryAttack = 0;
    let cavalryAttack = 0;
    let siegeAttack = 0;

    for (const unitId in troops) {
        const count = troops[unitId];
        const unitData = raceData.troops.find(u => u.id === unitId);
        if (!unitData) continue;

        const smithyBonus = getSmithyBonus(smithyUpgrades[unitId] || 0);
        const unitAttack = unitData.stats.attack * count * smithyBonus;
        
        totalAttack += unitAttack;
        if (unitData.type === 'infantry' || unitData.type === 'scout') {
            infantryAttack += unitAttack;
        } else if (unitData.type === 'cavalry') {
            cavalryAttack += unitAttack;
        } else if (unitData.type === 'siege') { 
            siegeAttack += unitAttack;
        }
    }
    return { total: totalAttack, infantry: infantryAttack, cavalry: cavalryAttack, siege: siegeAttack };
}

function calculateDefensePoints(defendingContingents, attackerProportions, wallRace, wallLevel, palaceLevel, moraleBonus = 1.0) {
    let totalTroopDefense = 0;

    for (const contingent of defendingContingents) {
        const { troops, race, smithyUpgrades = {} } = contingent;
        const raceData = gameData.units[race];
        if (!raceData) continue;

        for (const unitId in troops) {
            const count = troops[unitId];
            const unitData = raceData.troops.find(u => u.id === unitId);
            if (!unitData) continue;

            const smithyBonus = getSmithyBonus(smithyUpgrades[unitId] || 0);
            const infDef = unitData.stats.defense.infantry * smithyBonus;
            const cavDef = unitData.stats.defense.cavalry * smithyBonus;
            
            const proportionalDefense = (infDef * attackerProportions.infantry) + (cavDef * attackerProportions.cavalry);
            totalTroopDefense += proportionalDefense * count;
        }
    }

    const wallBonus = getWallBonus(wallRace, wallLevel);
    const palaceBonus = getPalaceBonus(palaceLevel);

    return ((totalTroopDefense * wallBonus) + palaceBonus) * moraleBonus;
}


function calculateLosses(winnerPoints, loserPoints) {
    if (winnerPoints <= 0) return 1; 
    const ratio = loserPoints / winnerPoints;
    
    return Math.min(1, Math.pow(ratio, 1.5));
}

function calculateRaidWinnerLosses(winnerPoints, loserPoints) {
    if (winnerPoints <= 0) return 1;
    const normalLosses = Math.pow(loserPoints / winnerPoints, 1.5);
    return normalLosses / (1 + normalLosses);
}

function calculateSiegeEffectiveness(attackerPoints, defenderPoints) {
    if (attackerPoints <= defenderPoints) return 0;
    const ratio = attackerPoints / defenderPoints;
    return Math.min(1.0, Math.pow(ratio - 1, 0.5));
}

function calculateRamEffectiveness(attackerPoints, defenderPoints) {
    const ratio = attackerPoints / defenderPoints;
    if (ratio >= 1) {
        return Math.min(1.0, Math.pow(ratio - 1, 0.5));
    } else {
        return Math.max(0, (ratio - 0.5) * 0.4);
    }
}

function calculateWallDamage(ramCount, effectiveness, initialWallLevel) {
    if (ramCount <= 0 || effectiveness <= 0 || initialWallLevel <= 0) return 0;
    const demolitionPower = ramCount * effectiveness;
    const wallResistance = (initialWallLevel * SIEGE_CONSTANTS.WALL_DURABILITY_FACTOR) + SIEGE_CONSTANTS.BASE_WALL_RESISTANCE;
    const levelsDestroyed = Math.floor(demolitionPower / wallResistance);
    return Math.min(initialWallLevel, levelsDestroyed);
}

function calculateBuildingDamage(catapultCount, effectiveness, initialBuildingLevel) {
    if (catapultCount <= 0 || effectiveness <= 0 || initialBuildingLevel <= 0) return 0;
    const demolitionPower = catapultCount * effectiveness;
    const buildingResistance = (initialBuildingLevel * SIEGE_CONSTANTS.BUILDING_DURABILITY_FACTOR) + SIEGE_CONSTANTS.BASE_BUILDING_RESISTANCE;
    const levelsDestroyed = Math.floor(demolitionPower / buildingResistance);
    return Math.min(initialBuildingLevel, levelsDestroyed);
}

const ESPIONAGE_SMITHY_BONUS = {
    romans: 0.020,
    gauls: 0.020,
    germans: 0.0175,
    egyptians: 0.030,
    huns: 0.0175,
};

const PATKE_BASE = 35;
const PDEFE_BASE = 20;

function calculateEspionagePower(count, smithyLevel, race, mode) {
    const base = mode === 'attack' ? PATKE_BASE : PDEFE_BASE;
    const bonus = ESPIONAGE_SMITHY_BONUS[race] || 0.020;
    return count * base * (1 + smithyLevel * bonus);
}

function calculateEspionageOutcome(attackerCount, patkeTotal, defenderCount, pdefeTotal) {
    if (patkeTotal > pdefeTotal) {
        const survivors = Math.floor(attackerCount * (1 - pdefeTotal / patkeTotal));
        return { survivingAttackers: Math.max(0, survivors), survivingDefenders: 0 };
    } else if (pdefeTotal > patkeTotal) {
        const survivors = Math.floor(defenderCount * (1 - patkeTotal / pdefeTotal));
        return { survivingAttackers: 0, survivingDefenders: Math.max(0, survivors) };
    }
    return { survivingAttackers: 0, survivingDefenders: 0 };
}

export const CombatFormulas = {
    calculateAttackPoints,
    calculateDefensePoints,
    calculateLosses,
    calculateRaidWinnerLosses,
    getMoraleBonus,
    calculateSiegeEffectiveness,
    calculateRamEffectiveness,
    calculateWallDamage,
    calculateBuildingDamage,
    calculateEspionageOutcome,
    calculateEspionagePower,
    ESPIONAGE_SMITHY_BONUS,
    PATKE_BASE,
    PDEFE_BASE,
};