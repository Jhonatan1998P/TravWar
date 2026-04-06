import { gameData } from './GameData.js';

const DEFAULT_BEAST_DIFFICULTY = 1;

function getNatureUnitById(beastId) {
    return gameData.units.nature.troops.find(unit => unit.id === beastId) || null;
}

export function getBeastDifficultyFactor(beastId) {
    const factors = gameData.config.oasis.beastDifficultyFactors || {};
    const factor = factors[beastId];
    return Number.isFinite(factor) ? factor : DEFAULT_BEAST_DIFFICULTY;
}

export function getBeastUnitBountyValue(beastId) {
    const beastData = getNatureUnitById(beastId);
    if (!beastData) return 0;

    const multiplier = gameData.config.oasis.beastBountyMultiplier || 0;
    return beastData.upkeep * multiplier * getBeastDifficultyFactor(beastId);
}

export function calculateBeastBountyValue(beastCounts = {}) {
    let totalBounty = 0;

    for (const [beastId, count] of Object.entries(beastCounts)) {
        if (!count || count <= 0) continue;
        totalBounty += getBeastUnitBountyValue(beastId) * count;
    }

    return totalBounty;
}
