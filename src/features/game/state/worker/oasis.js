import {
    getOasisSpeedMultiplier,
} from '../../core/data/constants.js';

function getWeightedRandomBeast(spawnTable, randomFunc = Math.random) {
    if (!spawnTable || spawnTable.length === 0) return null;

    const weights = spawnTable.map((_, index) => spawnTable.length - index);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let random = randomFunc() * totalWeight;

    for (let i = 0; i < spawnTable.length; i++) {
        random -= weights[i];
        if (random <= 0) {
            return spawnTable[i].unitId;
        }
    }

    return spawnTable[spawnTable.length - 1].unitId;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getOasisPressureConfig(gameData) {
    const oasisConfig = gameData.config.oasis || {};
    return {
        windowMinutes: oasisConfig.oasisPressureWindowMinutes || 60,
        attackRef: oasisConfig.oasisPressureAttackRef || 6,
        alpha: oasisConfig.oasisPressureAlpha || 0.6,
    };
}

function pruneOasisRecentAttacks(oasisState, currentTime, gameData) {
    if (!oasisState.pressure) {
        oasisState.pressure = { recentAttacks: [], current: 0 };
    }

    if (!Array.isArray(oasisState.pressure.recentAttacks)) {
        oasisState.pressure.recentAttacks = [];
    }

    const { windowMinutes } = getOasisPressureConfig(gameData);
    const windowMs = windowMinutes * 60 * 1000;
    oasisState.pressure.recentAttacks = oasisState.pressure.recentAttacks.filter(timestamp => (currentTime - timestamp) <= windowMs);
}

function calculateOasisPressure(oasisState, currentTime, gameData) {
    pruneOasisRecentAttacks(oasisState, currentTime, gameData);

    const { attackRef } = getOasisPressureConfig(gameData);
    const attacksRecent = oasisState.pressure.recentAttacks.length;
    const pressure = clamp(attacksRecent / Math.max(attackRef, 1), 0, 1);
    oasisState.pressure.current = pressure;
    return pressure;
}

function canRegenerateBeasts(tile) {
    return tile?.type === 'oasis' && Boolean(tile.state?.beasts) && tile.state.isClearedOnce === true;
}

export function registerOasisAttack({ tile, currentTime, gameData }) {
    if (!tile || tile.type !== 'oasis' || !tile.state) return;

    if (!tile.state.pressure) {
        tile.state.pressure = { recentAttacks: [], current: 0 };
    }
    if (!Array.isArray(tile.state.pressure.recentAttacks)) {
        tile.state.pressure.recentAttacks = [];
    }

    pruneOasisRecentAttacks(tile.state, currentTime, gameData);
    tile.state.pressure.recentAttacks.push(currentTime);
    calculateOasisPressure(tile.state, currentTime, gameData);
}

export function processOasisRegeneration({ gameState, currentTime, gameData, gameSpeed = 1, randomFunc = Math.random }) {
    const regenCycleMs = gameData.config.oasis.beastRegenCycleMinutes * 60 * 1000;
    if (currentTime - gameState.lastOasisRegenTime < regenCycleMs) {
        return;
    }

    const cyclesToProcess = Math.floor((currentTime - gameState.lastOasisRegenTime) / regenCycleMs);
    if (cyclesToProcess <= 0) return;

    const amountPerCycle = Math.floor((gameData.config.oasis.beastRegenAmount || 1) * getOasisSpeedMultiplier(gameSpeed));
    const { alpha } = getOasisPressureConfig(gameData);

    for (let cycle = 0; cycle < cyclesToProcess; cycle++) {
        gameState.mapData.forEach(tile => {
            // La regeneracion solo se desbloquea despues de la primera limpieza total.
            if (!canRegenerateBeasts(tile)) return;

            const pressure = calculateOasisPressure(tile.state, currentTime, gameData);
            const regenEff = amountPerCycle * (1 - (alpha * pressure));
            if (regenEff <= 0) return;

            let spawnsToProcess = Math.floor(regenEff);
            const fractionalPart = regenEff - spawnsToProcess;
            if (randomFunc() < fractionalPart) spawnsToProcess += 1;
            if (spawnsToProcess <= 0) return;

            const oasisTypeData = gameData.oasisTypes[tile.oasisType];
            if (!oasisTypeData) return;

            for (let spawnIndex = 0; spawnIndex < spawnsToProcess; spawnIndex++) {
                const beastToSpawn = getWeightedRandomBeast(oasisTypeData.beastSpawnTable, randomFunc);
                if (!beastToSpawn) continue;

                const spawnInfo = oasisTypeData.beastSpawnTable.find(spawn => spawn.unitId === beastToSpawn);
                if (!spawnInfo) continue;

                const currentAmount = tile.state.beasts[beastToSpawn] || 0;
                tile.state.beasts[beastToSpawn] = currentAmount + 1;
            }
        });
    }

    gameState.lastOasisRegenTime += cyclesToProcess * regenCycleMs;
}
