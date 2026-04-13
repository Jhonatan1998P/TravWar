export const RESOURCE_FIELD_BUILDING_TYPES = Object.freeze([
    'woodcutter',
    'clayPit',
    'ironMine',
    'cropland',
]);

export const RESOURCE_LABEL_TO_BUILDING_TYPE = Object.freeze({
    Wood: 'woodcutter',
    Clay: 'clayPit',
    Iron: 'ironMine',
    Wheat: 'cropland',
});

export const STORAGE_BUILDING_BY_RESOURCE = Object.freeze({
    food: 'granary',
    wood: 'warehouse',
    stone: 'warehouse',
    iron: 'warehouse',
});

export const BEGINNER_PROTECTION_POPULATION_THRESHOLD = 200;

export const OASIS_SPEED_MULTIPLIER_STEP = 50;
export const OASIS_BEAST_SCALING_MIN = 1;
export const OASIS_BEAST_SCALING_MAX = 100;

function clampInteger(value, min, max) {
    const numeric = Number.isFinite(Number(value)) ? Math.floor(Number(value)) : min;
    return Math.max(min, Math.min(max, numeric));
}

export function getOasisSpeedMultiplier(gameSpeed) {
    const safeSpeed = Math.max(1, clampInteger(gameSpeed, 1, Number.MAX_SAFE_INTEGER));
    const multiplier = Math.floor(safeSpeed / OASIS_SPEED_MULTIPLIER_STEP) + 1;
    return clampInteger(multiplier, OASIS_BEAST_SCALING_MIN, OASIS_BEAST_SCALING_MAX);
}

export function isUnderBeginnerProtectionByPopulation(totalPopulation) {
    return (Number(totalPopulation) || 0) < BEGINNER_PROTECTION_POPULATION_THRESHOLD;
}
