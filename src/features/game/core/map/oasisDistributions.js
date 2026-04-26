export const OASIS_TYPE_DISTRIBUTION = [
    { id: 'wood_25', weight: 18 },
    { id: 'clay_25', weight: 18 },
    { id: 'iron_25', weight: 18 },
    { id: 'wheat_25', weight: 24 },
    { id: 'wood_50', weight: 4 },
    { id: 'clay_50', weight: 4 },
    { id: 'iron_50', weight: 4 },
    { id: 'wheat_50', weight: 6 },
];

export const WHEAT_OASIS_DISTRIBUTION = [
    { id: 'wheat_25', weight: 75 },
    { id: 'wheat_50', weight: 25 },
];

export function getOasisDensityForMapSize(mapSize) {
    if (mapSize <= 18) return 0.085;
    if (mapSize <= 25) return 0.115;
    if (mapSize <= 35) return 0.135;
    return 0.15;
}

export function getOasisRulesForMapSize(mapSize) {
    return {
        density: getOasisDensityForMapSize(mapSize),
        minDistance: mapSize <= 18 ? 2 : 1,
        specialCropOasisRadius: 2,
        maxSpecialCropOasis: mapSize <= 18 ? 2 : 3,
    };
}
