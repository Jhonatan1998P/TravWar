const STORAGE_SPEED_DIVISOR = 20;

const MERCHANT_BASE_CAPACITY_BY_RACE = Object.freeze({
    gauls: 2000,
    germans: 1000,
    romans: 1500,
    egyptians: 3000,
});

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function getCapacitySpeedMultiplier(gameSpeed) {
    const speed = Math.max(1, toNumber(gameSpeed, 1));
    return Math.max(1, Math.floor(speed / STORAGE_SPEED_DIVISOR));
}

export function scaleCapacityByGameSpeed(baseCapacity, gameSpeed) {
    const base = Math.max(0, toNumber(baseCapacity, 0));
    return base * getCapacitySpeedMultiplier(gameSpeed);
}

export function getBaseMerchantCapacityByRace(race, fallbackCapacity = 0) {
    const normalizedRace = String(race || '').toLowerCase();
    if (normalizedRace in MERCHANT_BASE_CAPACITY_BY_RACE) {
        return MERCHANT_BASE_CAPACITY_BY_RACE[normalizedRace];
    }
    return Math.max(0, toNumber(fallbackCapacity, 0));
}

export function getScaledMerchantCapacityPerUnit(race, gameSpeed, fallbackCapacity = 0) {
    const baseCapacity = getBaseMerchantCapacityByRace(race, fallbackCapacity);
    return Math.floor(scaleCapacityByGameSpeed(baseCapacity, gameSpeed));
}

export function getScaledCrannyCapacity(baseHidingCapacity, race, gameSpeed) {
    const base = Math.max(0, toNumber(baseHidingCapacity, 0));
    const raceAdjustedBase = String(race || '').toLowerCase() === 'gauls' ? (base * 2) : base;
    return Math.floor(scaleCapacityByGameSpeed(raceAdjustedBase, gameSpeed));
}
