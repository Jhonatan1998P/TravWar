import { gameData } from '../../core/GameData.js';
import { canAffordCost, getVillageBudget } from '../utils/AIBudgetUtils.js';
import { RESOURCE_FIELD_BUILDING_TYPES, RESOURCE_LABEL_TO_BUILDING_TYPE } from '../../core/data/constants.js';

export function getResourceTypeFromStep(step) {
    if (!step.resourceType) return null;
    return RESOURCE_LABEL_TO_BUILDING_TYPE[step.resourceType] || null;
}

function findConstructionCandidate(village, step) {
    if (step.type === 'building') {
        const building = village.buildings.find(item => item.type === step.buildingType);
        if (building && building.level < step.level) {
            return { building, type: step.buildingType };
        }
        if (!building) {
            const emptySlot = village.buildings.find(item => item.type === 'empty' && /^v[0-9]+/.test(item.id));
            if (emptySlot) {
                return { building: emptySlot, type: step.buildingType };
            }
        }
    }

    if (step.type === 'resource_fields_level') {
        const allFields = village.buildings.filter(building => RESOURCE_FIELD_BUILDING_TYPES.includes(building.type));

        const fieldsWithEffectiveLevel = allFields.map(field => {
            const queuedUpgrades = village.constructionQueue.filter(job => job.buildingId === field.id).length;
            return { ...field, effectiveLevel: field.level + queuedUpgrades };
        });

        const fieldsNeedingUpgrade = fieldsWithEffectiveLevel.filter(field => field.effectiveLevel < step.level);
        if (fieldsNeedingUpgrade.length > 0) {
            fieldsNeedingUpgrade.sort((a, b) => a.effectiveLevel - b.effectiveLevel);
            const bestCandidate = fieldsNeedingUpgrade[0];
            return { building: bestCandidate, type: bestCandidate.type };
        }
    }

    return null;
}

function formatConstructionMicroTrace(step, buildingName) {
    const trace = step?.microTrace;
    if (!trace || typeof trace !== 'object') return '';

    if (trace.kind === 'resource_fields_tier') {
        const tier = Math.max(0, Number(trace.nextTierLevel) || 0);
        const target = Math.max(0, Number(trace.targetLevel) || 0);
        return ` [MicroPaso: campos tier ${tier}/${target}]`;
    }

    if (trace.kind === 'building') {
        const currentLevel = Math.max(0, Number(trace.currentLevel) || 0);
        const nextLevel = Math.max(0, Number(trace.nextLevel) || 0);
        const targetLevel = Math.max(0, Number(trace.targetLevel) || 0);
        const label = buildingName || trace.buildingType || 'edificio';
        return ` [MicroPaso: ${label} ${currentLevel}->${nextLevel}/${targetLevel}]`;
    }

    return '';
}

export function manageConstructionForGoal({
    village,
    gameState,
    step,
    attemptUpgrade,
    attemptUpgradeDetailed,
    log,
}) {
    const candidate = findConstructionCandidate(village, step);
    if (!candidate) return { success: false, reason: 'NO_CANDIDATE_FOUND' };

    const buildingState = candidate.building;
    const targetLevel = (buildingState.level || 0) + village.constructionQueue.filter(job => job.buildingId === buildingState.id).length + 1;
    const buildingData = gameData.buildings[candidate.type];
    if (!buildingData) return { success: false, reason: 'INVALID_BUILDING_DATA' };

    const cost = buildingData.levels[targetLevel - 1]?.cost;
    if (!cost) return { success: false, reason: 'INVALID_LEVEL_DATA' };

    const econBudget = getVillageBudget(village, 'econ');
    if (!canAffordCost(cost, econBudget)) {
        return {
            success: false,
            reason: 'INSUFFICIENT_RESOURCES',
            details: {
                needed: { ...cost },
                available: {
                    wood: Number(econBudget.wood) || 0,
                    stone: Number(econBudget.stone) || 0,
                    iron: Number(econBudget.iron) || 0,
                    food: Number(econBudget.food) || 0,
                },
            },
        };
    }

    const buildingName = buildingData.name || 'Campo de Recurso';
    const upgradeResult = typeof attemptUpgradeDetailed === 'function'
        ? attemptUpgradeDetailed(village, candidate.building, candidate.type)
        : { success: Boolean(attemptUpgrade(village, candidate.building, candidate.type)) };

    if (upgradeResult?.success) {
        const microTrace = formatConstructionMicroTrace(step, buildingName);
        log('success', village, 'Construcción', `Iniciando mejora de ${buildingName} a Nivel ${targetLevel}.${microTrace}`);
        return { success: true };
    }

    return {
        success: false,
        reason: upgradeResult?.reason || 'QUEUE_FULL',
        details: upgradeResult?.details,
    };
}
