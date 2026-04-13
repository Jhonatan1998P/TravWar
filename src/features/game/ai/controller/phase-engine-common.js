import { RESOURCE_FIELD_BUILDING_TYPES } from '../../core/data/constants.js';

export function getDifficultyTemplate(templateByDifficulty, difficulty, fallbackKey = 'Pesadilla') {
    if (!templateByDifficulty || typeof templateByDifficulty !== 'object') return null;
    return templateByDifficulty[difficulty] || templateByDifficulty[fallbackKey] || null;
}

export function createPhaseTransition(from, to, reason, at) {
    return {
        from,
        to,
        reason,
        at,
        status: 'phase_transition',
    };
}

export function getBuildingByType(village, buildingType) {
    return village.buildings.find(building => building.type === buildingType) || null;
}

export function getBuildingTypeLevel(village, buildingType) {
    const building = getBuildingByType(village, buildingType);
    return building?.level || 0;
}

export function getEffectiveBuildingTypeLevel(village, buildingType) {
    const building = getBuildingByType(village, buildingType);
    if (!building) return 0;
    const queued = village.constructionQueue.filter(job => job.buildingId === building.id).length;
    return (building.level || 0) + queued;
}

export function getAverageResourceFieldLevel(village) {
    const fields = village.buildings.filter(building => RESOURCE_FIELD_BUILDING_TYPES.includes(building.type));
    if (fields.length === 0) return 0;
    const total = fields.reduce((sum, field) => sum + (field.level || 0), 0);
    return total / fields.length;
}

export function getUnitCountInVillageAndQueue(village, unitId) {
    const inVillage = village.unitsInVillage?.[unitId] || 0;
    const inQueue = village.recruitmentQueue
        .filter(job => job.unitId === unitId)
        .reduce((sum, job) => sum + (job.remainingCount ?? job.count ?? 0), 0);
    return inVillage + inQueue;
}

export function getQueueUptime(samples, active) {
    const normalizedSamples = Math.max(samples || 0, 0);
    const normalizedActive = Math.max(active || 0, 0);
    if (normalizedSamples <= 0) return 0;
    return normalizedActive / normalizedSamples;
}
