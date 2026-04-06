import { RESOURCE_FIELD_BUILDING_TYPES } from '../../core/data/constants.js';
import { getBuildingData, getBuildingLevelData, getRaceTroops } from '../../core/data/lookups.js';

export function areResourceFieldsBalanced(village) {
    const fields = village.buildings.filter(building => RESOURCE_FIELD_BUILDING_TYPES.includes(building.type));
    if (fields.length === 0) return true;

    const effectiveLevels = fields.map(field => {
        const queuedUpgrades = village.constructionQueue.filter(job => job.buildingId === field.id).length;
        return field.level + queuedUpgrades;
    });

    return Math.min(...effectiveLevels) === Math.max(...effectiveLevels);
}

export function getStepCost({ step, village, gameState, race, actionExecutor }) {
    switch (step.type) {
        case 'building': {
            const buildingType = step.buildingType || actionExecutor.getResourceTypeFromStep(step);
            if (!buildingType) return {};
            const building = village.buildings.find(item => item.type === buildingType);
            const level = (building ? building.level : 0) + village.constructionQueue.filter(job => job.buildingType === buildingType).length;
            const levelData = getBuildingLevelData(buildingType, level + 1);
            return levelData?.cost || {};
        }
        case 'resource_fields_level': {
            let fields = village.buildings.filter(building => RESOURCE_FIELD_BUILDING_TYPES.includes(building.type));
            const resourceType = actionExecutor.getResourceTypeFromStep(step);
            if (resourceType) {
                fields = fields.filter(field => field.type === resourceType);
            }
            if (fields.length === 0) return {};

            const targetField = fields
                .map(field => {
                    const queuedUpgrades = village.constructionQueue.filter(job => job.buildingId === field.id).length;
                    return { field, effectiveLevel: field.level + queuedUpgrades };
                })
                .sort((a, b) => a.effectiveLevel - b.effectiveLevel)[0];

            const levelData = getBuildingLevelData(targetField.field.type, targetField.effectiveLevel + 1);
            return levelData?.cost || {};
        }
        case 'units': {
            const unitId = actionExecutor.resolveUnitId(step.unitType);
            const unitData = getRaceTroops(race).find(unit => unit.id === unitId);
            return unitData?.cost || {};
        }
        case 'research': {
            const unitId = actionExecutor.resolveUnitId(step.unitType);
            const unitData = getRaceTroops(race).find(unit => unit.id === unitId);
            return unitData?.research?.cost || {};
        }
        case 'upgrade': {
            const unitId = actionExecutor.resolveUnitId(step.unitType);
            const unitData = getRaceTroops(race).find(unit => unit.id === unitId);
            if (!unitData) return {};

            const currentLevel = village.smithy.upgrades[unitId] || 0;
            const cost = {};
            for (const resource in unitData.cost) {
                cost[resource] = Math.floor(unitData.cost[resource] * Math.pow(1.6, currentLevel + 1));
            }
            return cost;
        }
        case 'proportional_units': {
            const allUnitTypes = [step.baseUnit, ...step.proportions.map(proportion => proportion.unit)];
            let maxCost = {};
            let mostExpensiveUnitCost = 0;

            allUnitTypes.forEach(unitType => {
                const unitCost = getStepCost({ step: { type: 'units', unitType }, village, gameState, race, actionExecutor });
                const totalResourceCost = Object.values(unitCost).reduce((a, b) => a + b, 0);
                if (totalResourceCost > mostExpensiveUnitCost) {
                    mostExpensiveUnitCost = totalResourceCost;
                    maxCost = unitCost;
                }
            });

            return maxCost;
        }
        default:
            return {};
    }
}

export function isStepCompleted({ step, village, gameState, ownerId, actionExecutor }) {
    if (!step) return false;
    const allVillages = gameState.villages.filter(candidate => candidate.ownerId === ownerId);

    switch (step.type) {
        case 'building': {
            const building = village.buildings.find(item => item.type === step.buildingType);
            return building && building.level >= step.level;
        }

        case 'resource_fields_level': {
            let fields = village.buildings.filter(building => /^[wcif]/.test(building.id));
            const resourceType = actionExecutor.getResourceTypeFromStep(step);
            if (resourceType) fields = fields.filter(field => field.type === resourceType);
            if (fields.length === 0 && step.level > 0) return false;
            return fields.every(field => field.level >= step.level);
        }

        case 'units': {
            const unitId = actionExecutor.resolveUnitId(step.unitType);
            if (!unitId) return false;

            const settlerId = actionExecutor.resolveUnitId('settler');
            const chiefId = actionExecutor.resolveUnitId('chief');

            if (unitId === settlerId || unitId === chiefId) {
                const totalInThisVillage = (village.unitsInVillage[unitId] || 0) +
                    village.recruitmentQueue
                        .filter(job => job.unitId === unitId)
                        .reduce((queueSum, job) => queueSum + (job.remainingCount ?? job.count ?? 0), 0);
                return totalInThisVillage >= step.count;
            }

            const totalInAllVillages = allVillages.reduce((sum, candidate) => sum + (candidate.unitsInVillage[unitId] || 0), 0);
            const totalInAllQueues = allVillages.reduce((sum, candidate) => {
                return sum + candidate.recruitmentQueue
                    .filter(job => job.unitId === unitId)
                    .reduce((queueSum, job) => queueSum + (job.remainingCount ?? job.count ?? 0), 0);
            }, 0);
            return (totalInAllVillages + totalInAllQueues) >= step.count;
        }

        case 'research': {
            const researchUnitId = actionExecutor.resolveUnitId(step.unitType);
            if (!researchUnitId) return false;
            return village.research.completed.includes(researchUnitId);
        }

        case 'upgrade': {
            const upgradeUnitId = actionExecutor.resolveUnitId(step.unitType);
            if (!upgradeUnitId) return false;
            return (village.smithy.upgrades[upgradeUnitId] || 0) >= step.level;
        }

        case 'proportional_units': {
            const { baseUnit, proportions, baseTarget } = step;
            const baseUnitId = actionExecutor.resolveUnitId(baseUnit);
            if (!baseUnitId) return true;

            const getTotalUnitCount = unitId => {
                const totalInVillages = allVillages.reduce((sum, candidate) => sum + (candidate.unitsInVillage[unitId] || 0), 0);
                const totalInQueue = allVillages.reduce((sum, candidate) => {
                    return sum + candidate.recruitmentQueue
                        .filter(job => job.unitId === unitId)
                        .reduce((queueSum, job) => queueSum + (job.remainingCount ?? job.count ?? 0), 0);
                }, 0);
                return totalInVillages + totalInQueue;
            };

            if (getTotalUnitCount(baseUnitId) < baseTarget) return false;

            for (const proportion of proportions) {
                const proportionalUnitId = actionExecutor.resolveUnitId(proportion.unit);
                if (!proportionalUnitId) continue;

                const targetCount = Math.floor(baseTarget * (proportion.ratio / 100));
                if (getTotalUnitCount(proportionalUnitId) < targetCount) return false;
            }
            return true;
        }

        default:
            return false;
    }
}

export function getPrerequisites({ step, village, failureContext = {}, race, actionExecutor }) {
    const requirements = { buildings: {}, research: {} };
    const raceTroops = getRaceTroops(race);

    if (failureContext.reason === 'RESEARCH_REQUIRED' && failureContext.unitId) {
        requirements.research[failureContext.unitId] = true;
    }

    const mergeRequirements = reqs => {
        if (!reqs) return;
        for (const reqType in reqs) {
            requirements.buildings[reqType] = Math.max(requirements.buildings[reqType] || 0, reqs[reqType]);
        }
    };

    switch (step.type) {
        case 'building': {
            const buildingData = getBuildingData(step.buildingType);
            const level = (village.buildings.find(building => building.type === step.buildingType)?.level || 0) + 1;
            const levelData = buildingData?.levels[level - 1];
            mergeRequirements(levelData?.requires);
            mergeRequirements(buildingData?.requires);
            break;
        }
        case 'research': {
            const unitId = actionExecutor.resolveUnitId(step.unitType);
            const unitData = raceTroops.find(unit => unit.id === unitId);
            mergeRequirements(unitData?.research?.requires);
            break;
        }
        case 'upgrade': {
            const unitId = actionExecutor.resolveUnitId(step.unitType);
            const unitData = raceTroops.find(unit => unit.id === unitId);
            const nextUpgradeLevel = (village.smithy.upgrades[unitId] || 0) + 1;

            requirements.buildings.smithy = Math.max(requirements.buildings.smithy || 0, nextUpgradeLevel);
            if (unitData?.research?.time > 0) {
                requirements.research[unitId] = true;
            }
            break;
        }
        case 'proportional_units':
        case 'units': {
            const unitIdentifier = failureContext.unitId || step.baseUnit || step.unitType;
            const unitId = raceTroops.some(unit => unit.id === unitIdentifier)
                ? unitIdentifier
                : actionExecutor.resolveUnitId(unitIdentifier);
            const unitData = raceTroops.find(unit => unit.id === unitId);
            if (unitData) {
                if (unitData.research?.time > 0) {
                    requirements.research[unitId] = true;
                }
                mergeRequirements(unitData.research?.requires);
                const trainingBuilding = actionExecutor.getTrainingBuildingForUnit(unitId);
                if (trainingBuilding) {
                    requirements.buildings[trainingBuilding] = Math.max(requirements.buildings[trainingBuilding] || 0, 1);
                }
            }
            break;
        }
    }

    return requirements;
}
