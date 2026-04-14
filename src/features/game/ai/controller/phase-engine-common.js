import { RESOURCE_FIELD_BUILDING_TYPES } from '../../core/data/constants.js';

export const PHASE_RECOVERABLE_BLOCK_REASONS = new Set([
    'PREREQUISITES_NOT_MET',
    'RESEARCH_REQUIRED',
    'INSUFFICIENT_RESOURCES',
    'QUEUE_FULL',
    'EXPANSION_BUILDING_LOW_LEVEL',
    'EXPANSION_SLOTS_FULL',
]);

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

export function clonePhaseStep(step) {
    if (!step || typeof step !== 'object') return null;
    return { ...step };
}

export function isRecoverablePhaseBlockReason(reason) {
    return PHASE_RECOVERABLE_BLOCK_REASONS.has(reason);
}

export function runPriorityStepList({
    steps,
    executeStep,
    noActionReason = 'NO_ACTION',
    shouldAttemptStep = null,
    stopOnRecoverableBlock = false,
}) {
    let firstBlocking = null;

    for (const step of steps || []) {
        if (typeof shouldAttemptStep === 'function' && !shouldAttemptStep(step)) {
            continue;
        }

        const result = executeStep(step) || { success: false, reason: 'UNKNOWN_ERROR' };
        const enriched = {
            ...result,
            step: clonePhaseStep(step),
        };

        if (enriched.success || enriched.reason === 'QUEUE_FULL') {
            return enriched;
        }

        if (isRecoverablePhaseBlockReason(enriched.reason)) {
            if (!firstBlocking) {
                firstBlocking = enriched;
            }

            if (stopOnRecoverableBlock) {
                return enriched;
            }
        }
    }

    if (firstBlocking) {
        return firstBlocking;
    }

    return { success: false, reason: noActionReason };
}

export function getPhaseStepQueueType(step) {
    if (!step) return 'unknown';
    if (step.type === 'building' || step.type === 'resource_fields_level') return 'construction';
    if (step.type === 'research') return 'research';
    if (step.type === 'upgrade') return 'smithy';
    if (step.type === 'units' || step.type === 'proportional_units') return 'recruitment';
    return 'unknown';
}

export function getNextExpansionPalaceLevel(currentEffectivePalaceLevel) {
    const current = Math.max(0, Number(currentEffectivePalaceLevel) || 0);
    if (current < 10) return 10;
    if (current < 15) return 15;
    if (current < 20) return 20;
    return 20;
}

export function buildPrerequisiteResolverStepFromBlock({
    village,
    blockedResult,
    getEffectiveBuildingLevel,
}) {
    const required = blockedResult?.details?.required;
    if (required && typeof required === 'object') {
        const [buildingType, level] = Object.entries(required)[0] || [];
        if (buildingType) {
            return {
                type: 'building',
                buildingType,
                level: Number(level) || 1,
            };
        }
    }

    if (typeof blockedResult?.building === 'string') {
        return {
            type: 'building',
            buildingType: blockedResult.building,
            level: 1,
        };
    }

    if (blockedResult?.reason === 'EXPANSION_BUILDING_LOW_LEVEL' || blockedResult?.reason === 'EXPANSION_SLOTS_FULL') {
        const palaceLevel = typeof getEffectiveBuildingLevel === 'function'
            ? getEffectiveBuildingLevel(village, 'palace')
            : 0;
        return {
            type: 'building',
            buildingType: 'palace',
            level: getNextExpansionPalaceLevel(palaceLevel),
        };
    }

    if (blockedResult?.reason === 'RESEARCH_REQUIRED') {
        const unitId = blockedResult?.details?.unitId || blockedResult?.unitId;
        if (!unitId) return null;
        return {
            type: 'research',
            unitType: unitId,
            unitId,
        };
    }

    if (blockedResult?.reason === 'INSUFFICIENT_RESOURCES') {
        const needed = blockedResult?.details?.needed;
        if (needed && typeof needed === 'object') {
            const capacityByResource = {
                wood: village?.resources?.wood?.capacity || 0,
                stone: village?.resources?.stone?.capacity || 0,
                iron: village?.resources?.iron?.capacity || 0,
                food: village?.resources?.food?.capacity || 0,
            };

            const requiresGranary = Number(needed.food || 0) > Number(capacityByResource.food || 0);
            const requiresWarehouse = ['wood', 'stone', 'iron'].some(resourceType => Number(needed[resourceType] || 0) > Number(capacityByResource[resourceType] || 0));

            if (requiresGranary || requiresWarehouse) {
                const storageType = requiresGranary ? 'granary' : 'warehouse';
                const currentLevel = typeof getEffectiveBuildingLevel === 'function'
                    ? getEffectiveBuildingLevel(village, storageType)
                    : 0;
                return {
                    type: 'building',
                    buildingType: storageType,
                    level: Math.max(1, currentLevel + 1),
                };
            }
        }
    }

    return null;
}
