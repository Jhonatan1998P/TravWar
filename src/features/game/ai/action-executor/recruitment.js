import { gameData } from '../../core/GameData.js';
import { getMaxAffordableCount, getVillageBudget } from '../utils/AIBudgetUtils.js';

function getTotalUnitCountAcrossVillages(villages, unitId) {
    if (!unitId) return 0;

    const totalInVillages = villages.reduce((sum, village) => sum + (village.unitsInVillage[unitId] || 0), 0);
    const totalInQueue = villages.reduce((sum, village) => {
        return sum + village.recruitmentQueue
            .filter(job => job.unitId === unitId)
            .reduce((queueSum, job) => queueSum + (job.remainingCount ?? job.count ?? 0), 0);
    }, 0);

    return totalInVillages + totalInQueue;
}

export function manageProportionalRecruitment({
    village,
    gameState,
    step,
    activeGoal,
    ownerId,
    resolveUnitId,
    manageRecruitmentForGoal,
    log,
}) {
    const { baseUnit, proportions, baseTarget } = step;
    const allMyVillages = gameState.villages.filter(candidate => candidate.ownerId === ownerId);

    const unitCycle = [baseUnit, ...proportions.map(proportion => proportion.unit)];
    activeGoal.proportionalUnitPointer = activeGoal.proportionalUnitPointer ?? 0;

    const initialPointer = activeGoal.proportionalUnitPointer;
    let unitIsComplete = true;

    while (unitIsComplete) {
        const currentUnitId = resolveUnitId(unitCycle[activeGoal.proportionalUnitPointer]);
        const baseUnitId = resolveUnitId(baseUnit);

        let targetCount;
        if (currentUnitId === baseUnitId) {
            targetCount = baseTarget;
        } else {
            const proportion = proportions.find(item => resolveUnitId(item.unit) === currentUnitId);
            targetCount = proportion ? Math.floor(baseTarget * (proportion.ratio / 100)) : 0;
        }

        const currentCount = getTotalUnitCountAcrossVillages(allMyVillages, currentUnitId);
        if (currentCount >= targetCount) {
            activeGoal.proportionalUnitPointer = (activeGoal.proportionalUnitPointer + 1) % unitCycle.length;
            if (activeGoal.proportionalUnitPointer === initialPointer) {
                return { success: true };
            }
        } else {
            unitIsComplete = false;
        }
    }

    const unitToRecruitIdentifier = unitCycle[activeGoal.proportionalUnitPointer];
    const result = manageRecruitmentForGoal(village, gameState, {
        type: 'units',
        unitType: unitToRecruitIdentifier,
        count: Infinity,
    });

    if (result.success) {
        log('success', village, 'Proportional Recruitment', `Encolando tanda de ${result.count}x ${result.unitId} (25% Budget).`);
        activeGoal.proportionalUnitPointer = (activeGoal.proportionalUnitPointer + 1) % unitCycle.length;
        return { success: true };
    }

    return result;
}

export function manageRecruitmentForGoal({
    village,
    gameState,
    step,
    ownerId,
    race,
    resolveUnitId,
    getTrainingBuildingForUnit,
    sendCommand,
    log,
}) {
    const unitId = resolveUnitId(step.unitType);
    if (!unitId) return { success: false, reason: 'INVALID_UNIT_ID' };

    const unitData = gameData.units[race].troops.find(troop => troop.id === unitId);
    if (!unitData) return { success: false, reason: 'INVALID_UNIT_DATA' };

    const trainingBuildingType = getTrainingBuildingForUnit(unitId);
    const trainingBuilding = village.buildings.find(building => building.type === trainingBuildingType);
    if (!trainingBuilding || trainingBuilding.level === 0) {
        return { success: false, reason: 'PREREQUISITES_NOT_MET', building: trainingBuildingType };
    }

    const allVillages = gameState.villages.filter(candidate => candidate.ownerId === ownerId);
    const unitsOwned = getTotalUnitCountAcrossVillages(allVillages, unitId);

    const targetAmount = step.count === Infinity ? 9999999 : step.count;
    const unitsNeeded = targetAmount - unitsOwned;
    if (unitsNeeded <= 0) return { success: true };

    const militaryBudget = getVillageBudget(village, 'mil');
    const maxAffordableTotal = getMaxAffordableCount(unitData.cost, militaryBudget);
    const effectiveAffordableTotal = Number.isFinite(maxAffordableTotal) ? maxAffordableTotal : unitsNeeded;
    if (effectiveAffordableTotal <= 0) {
        return { success: false, reason: 'INSUFFICIENT_RESOURCES' };
    }

    const batchPercentage = 0.25;
    const minBatchFloor = 5;

    let batchSize = Math.floor(effectiveAffordableTotal * batchPercentage);
    batchSize = Math.max(batchSize, minBatchFloor);
    batchSize = Math.min(batchSize, effectiveAffordableTotal);

    const countToTrain = Math.min(unitsNeeded, batchSize);
    if (countToTrain <= 0) return { success: false, reason: 'INSUFFICIENT_RESOURCES' };

    const result = sendCommand('recruit_units', {
        buildingId: trainingBuilding.id,
        unitId,
        count: countToTrain,
        villageId: village.id,
    });

    if (result.success) {
        log('success', village, 'Reclutamiento', `Orden para ${countToTrain}x ${unitId} enviada (Max posible: ${effectiveAffordableTotal}, Batch: 25%).`);
        return { success: true, count: countToTrain, unitId };
    }

    log('fail', village, 'Reclutamiento', `Orden para ${countToTrain}x ${unitId} rechazada. Razón: ${result.reason}`, result.details);
    return { success: false, reason: result.reason, unitId: result.details?.unitId || unitId };
}
