import { gameData } from '../../core/GameData.js';

const NON_COMBAT_ROLES = new Set(['conquest', 'colonization', 'scout']);

export function calculateDeployedTroops(villageId, gameState) {
    const deployedTroops = {};

    gameState.movements.forEach(movement => {
        if (movement.originVillageId !== villageId) return;
        for (const [unitId, count] of Object.entries(movement.payload.troops)) {
            deployedTroops[unitId] = (deployedTroops[unitId] || 0) + count;
        }
    });

    gameState.villages.forEach(village => {
        if (village.id === villageId) return;
        village.reinforcements.forEach(reinforcement => {
            if (reinforcement.fromVillageId !== villageId) return;
            for (const [unitId, count] of Object.entries(reinforcement.troops)) {
                deployedTroops[unitId] = (deployedTroops[unitId] || 0) + count;
            }
        });
    });

    return deployedTroops;
}

export function mergeTroops(troopsA, troopsB) {
    const merged = { ...troopsA };
    for (const [unitId, count] of Object.entries(troopsB)) {
        merged[unitId] = (merged[unitId] || 0) + count;
    }
    return merged;
}

export function countCombatTroopsInVillages(villages, race) {
    const raceTroops = gameData.units[race]?.troops || [];

    return villages.reduce((totalTroops, village) => {
        let villageTotal = 0;
        for (const [unitId, count] of Object.entries(village.unitsInVillage)) {
            const unitData = raceTroops.find(troop => troop.id === unitId);
            if (unitData && !NON_COMBAT_ROLES.has(unitData.role)) {
                villageTotal += count;
            }
        }
        return totalTroops + villageTotal;
    }, 0);
}
