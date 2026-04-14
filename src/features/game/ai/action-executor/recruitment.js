import { gameData } from '../../core/GameData.js';
import { getMaxAffordableCount, getVillageBudget } from '../utils/AIBudgetUtils.js';

const PHASE_BATCH_CONFIG = {
    early: { basePct: 0.18, min: 5, max: 24 },
    mid: { basePct: 0.3, min: 10, max: 72 },
    late: { basePct: 0.45, min: 20, max: 140 },
};
const RECRUITMENT_CYCLE_MS = 3 * 60 * 1000;
const SIEGE_TARGET_RAM_RATIO = 0.7;

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

function getVillagesForGoalScope(allVillages, currentVillage, goalScope) {
    if (goalScope === 'per_village' || (typeof goalScope === 'string' && goalScope.startsWith('village_index:'))) {
        return [currentVillage];
    }
    return allVillages;
}

function getUnitsCountByIdsAcrossVillages(villages, unitIds) {
    if (!Array.isArray(unitIds) || unitIds.length === 0) return 0;
    return unitIds.reduce((sum, unitId) => sum + getTotalUnitCountAcrossVillages(villages, unitId), 0);
}

function getSiegeBalancerUnitId({ race, scopedVillages, resolveUnitId, fallbackUnitId }) {
    const raceTroops = gameData.units[race]?.troops || [];
    if (raceTroops.length === 0) return fallbackUnitId;

    const ramUnitId = resolveUnitId('ram');
    const catapultUnitId = resolveUnitId('catapult');
    if (!ramUnitId || !catapultUnitId) return fallbackUnitId;

    const currentRams = getUnitsCountByIdsAcrossVillages(scopedVillages, [ramUnitId]);
    const currentCatapults = getUnitsCountByIdsAcrossVillages(scopedVillages, [catapultUnitId]);
    const nextTotal = currentRams + currentCatapults + 1;

    const ramRatioIfRam = (currentRams + 1) / nextTotal;
    const ramRatioIfCatapult = currentRams / nextTotal;
    const errorIfRam = Math.abs(ramRatioIfRam - SIEGE_TARGET_RAM_RATIO);
    const errorIfCatapult = Math.abs(ramRatioIfCatapult - SIEGE_TARGET_RAM_RATIO);

    if (errorIfRam < errorIfCatapult) return ramUnitId;
    if (errorIfCatapult < errorIfRam) return catapultUnitId;
    return fallbackUnitId || ramUnitId;
}

function resolveRecruitmentUnitId({ step, race, resolveUnitId, scopedVillages }) {
    const requestedUnitId = resolveUnitId(step.unitType);
    if (!requestedUnitId) return undefined;

    const raceTroops = gameData.units[race]?.troops || [];
    const requestedUnit = raceTroops.find(unit => unit.id === requestedUnitId);
    if (!requestedUnit) return requestedUnitId;

    const wantsSiegeByIdentifier = step.unitType === 'ram' || step.unitType === 'catapult' || step.unitType === 'siege';
    const wantsSiegeByRole = requestedUnit.role === 'ram' || requestedUnit.role === 'catapult';
    if (!wantsSiegeByIdentifier && !wantsSiegeByRole) return requestedUnitId;

    return getSiegeBalancerUnitId({
        race,
        scopedVillages,
        resolveUnitId,
        fallbackUnitId: requestedUnitId,
    });
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getAverageResourceFieldLevel(village) {
    const resourceFields = village.buildings.filter(building => /^[wcif]/.test(building.id));
    if (resourceFields.length === 0) return 0;
    const totalLevels = resourceFields.reduce((sum, building) => sum + (building.level || 0), 0);
    return totalLevels / resourceFields.length;
}

function getVillagePhase(village) {
    const avgFields = getAverageResourceFieldLevel(village);
    const population = village.population?.current || 0;

    if (avgFields < 5 || population < 120) return 'early';
    if (avgFields < 10 || population < 500) return 'mid';
    return 'late';
}

function getQueuedUnitsForBuilding(village, buildingId) {
    return village.recruitmentQueue
        .filter(job => job.buildingId === buildingId)
        .reduce((sum, job) => sum + (job.remainingCount ?? job.count ?? 0), 0);
}

function getRecruitmentQueueTailEndTime(village, buildingId) {
    const now = Date.now();
    let tailEnd = now;

    village.recruitmentQueue
        .filter(job => job.buildingId === buildingId)
        .forEach(job => {
            const remainingUnits = Math.max(0, (job.remainingCount ?? job.count ?? 0) - 1);
            const unitTime = job.timePerUnit || 0;
            const jobTailEnd = (job.endTime || now) + (remainingUnits * unitTime);
            if (jobTailEnd > tailEnd) tailEnd = jobTailEnd;
        });

    return tailEnd;
}

function getQueueCoverageMs(village, buildingId) {
    const now = Date.now();
    const tailEnd = getRecruitmentQueueTailEndTime(village, buildingId);
    return Math.max(0, tailEnd - now);
}

function getSingleUnitTrainingTimeMs(village, trainingBuilding, unitData, gameSpeed) {
    if (!trainingBuilding || !unitData) return 0;

    const levelData = gameData.buildings[trainingBuilding.type]?.levels?.[Math.max(0, (trainingBuilding.level || 1) - 1)];
    const timeFactor = levelData?.attribute?.trainingTimeFactor || 1;
    const speed = Math.max(gameSpeed || 1, 1);

    return ((unitData.trainTime / timeFactor) / speed) * 1000;
}

function getPhaseBatchConfig(village, gameSpeed) {
    const phase = getVillagePhase(village);
    const baseConfig = PHASE_BATCH_CONFIG[phase];
    const speedMultiplier = clamp((gameSpeed || 1) / 10, 1, 2.5);

    return {
        phase,
        basePct: baseConfig.basePct,
        min: Math.max(1, Math.round(baseConfig.min * Math.sqrt(speedMultiplier))),
        max: Math.max(1, Math.round(baseConfig.max * speedMultiplier)),
    };
}

function calculateAdaptiveBatchSize({
    village,
    unitData,
    trainingBuildingId,
    targetAmount,
    unitsNeeded,
    effectiveAffordableTotal,
    gameSpeed,
}) {
    if (unitsNeeded <= 0 || effectiveAffordableTotal <= 0) {
        return { batchSize: 0, phase: 'early', ratio: 0, queueUnits: 0 };
    }

    if (unitData.type === 'settler' || unitData.type === 'chief') {
        const oneByOne = Math.min(1, unitsNeeded, effectiveAffordableTotal);
        return { batchSize: oneByOne, phase: 'special', ratio: 1, queueUnits: 0 };
    }

    const phaseConfig = getPhaseBatchConfig(village, gameSpeed);
    const queueUnits = getQueuedUnitsForBuilding(village, trainingBuildingId);

    const urgency = targetAmount === Infinity
        ? 1
        : clamp(unitsNeeded / Math.max(targetAmount, 1), 0, 1);

    const affordability = clamp(effectiveAffordableTotal / Math.max(unitsNeeded, 1), 0, 1);
    const queuePressure = clamp(queueUnits / Math.max(phaseConfig.max * 3, 1), 0, 1);

    let dynamicRatio = phaseConfig.basePct
        + (urgency * 0.22)
        + (affordability * 0.12)
        - (queuePressure * 0.2);

    dynamicRatio = clamp(dynamicRatio, 0.12, 0.8);

    let dynamicMax = phaseConfig.max;
    if (queuePressure > 0.75) {
        dynamicMax = Math.max(1, Math.floor(dynamicMax * 0.7));
    }
    if (urgency > 0.7 && effectiveAffordableTotal > phaseConfig.max * 2) {
        dynamicMax = Math.max(dynamicMax, Math.floor(phaseConfig.max * 1.25));
    }

    let batchSize = Math.floor(effectiveAffordableTotal * dynamicRatio);
    batchSize = Math.max(batchSize, phaseConfig.min);
    batchSize = Math.min(batchSize, dynamicMax);
    batchSize = Math.min(batchSize, effectiveAffordableTotal, unitsNeeded);

    return {
        batchSize,
        phase: phaseConfig.phase,
        ratio: dynamicRatio,
        queueUnits,
    };
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
    const scopedVillages = getVillagesForGoalScope(allMyVillages, village, activeGoal?.scope);

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

        const currentCount = getTotalUnitCountAcrossVillages(scopedVillages, currentUnitId);
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
    }, activeGoal);

    if (result.success) {
        const mode = result.batchMeta?.phase || 'adaptive';
        const ratioPct = Math.round((result.batchMeta?.ratio || 0) * 100);
        log('success', village, 'Proportional Recruitment', `Encolando tanda de ${result.count}x ${result.unitId} (${mode}, ${ratioPct}%).`);
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
    goalScope,
    gameSpeed = 1,
}) {
    const allVillages = gameState.villages.filter(candidate => candidate.ownerId === ownerId);
    const scopedVillages = getVillagesForGoalScope(allVillages, village, goalScope);

    const unitId = resolveRecruitmentUnitId({
        step,
        race,
        resolveUnitId,
        scopedVillages,
    });
    if (!unitId) return { success: false, reason: 'INVALID_UNIT_ID' };

    const unitData = gameData.units[race].troops.find(troop => troop.id === unitId);
    if (!unitData) return { success: false, reason: 'INVALID_UNIT_DATA' };

    const trainingBuildingType = getTrainingBuildingForUnit(unitId);
    const trainingBuilding = village.buildings.find(building => building.type === trainingBuildingType);
    if (!trainingBuilding || trainingBuilding.level === 0) {
        return { success: false, reason: 'PREREQUISITES_NOT_MET', building: trainingBuildingType };
    }

    const unitsOwned = getTotalUnitCountAcrossVillages(scopedVillages, unitId);

    const queueTargetMinutes = Number.isFinite(step.queueTargetMinutes)
        ? Math.max(0, step.queueTargetMinutes)
        : 0;
    const queueTargetMs = queueTargetMinutes * 60 * 1000;
    let unitsNeededByQueue = 0;
    let queueCoverageMs = 0;
    let singleUnitTimeMs = 0;
    const isOpenEndedTarget = step.countMode === 'queue_cycles'
        || step.count === Infinity
        || !Number.isFinite(step.count);

    if (queueTargetMs > 0) {
        queueCoverageMs = getQueueCoverageMs(village, trainingBuilding.id);
        singleUnitTimeMs = getSingleUnitTrainingTimeMs(village, trainingBuilding, unitData, gameSpeed);

        if (singleUnitTimeMs > 0 && queueCoverageMs < queueTargetMs) {
            unitsNeededByQueue = Math.ceil((queueTargetMs - queueCoverageMs) / singleUnitTimeMs);
        }

        if (unitsNeededByQueue <= 0 && isOpenEndedTarget) {
            return {
                success: true,
                reason: 'QUEUE_TARGET_MET',
                unitId,
                queueCoverageMs,
                queueTargetMs,
            };
        }
    }

    const targetAmount = isOpenEndedTarget ? Number.POSITIVE_INFINITY : Math.max(0, step.count);
    const unitsNeededByTarget = Number.isFinite(targetAmount)
        ? (targetAmount - unitsOwned)
        : Number.POSITIVE_INFINITY;
    const unitsNeeded = queueTargetMs > 0
        ? (isOpenEndedTarget ? unitsNeededByQueue : Math.max(unitsNeededByQueue, unitsNeededByTarget))
        : unitsNeededByTarget;

    if (unitsNeeded <= 0) return { success: true };

    const militaryBudget = getVillageBudget(village, 'mil');
    const maxAffordableTotal = getMaxAffordableCount(unitData.cost, militaryBudget);
    const effectiveAffordableTotal = Number.isFinite(maxAffordableTotal) ? maxAffordableTotal : unitsNeeded;
    if (effectiveAffordableTotal <= 0) {
        return { success: false, reason: 'INSUFFICIENT_RESOURCES' };
    }

    const batchPlan = calculateAdaptiveBatchSize({
        village,
        unitData,
        trainingBuildingId: trainingBuilding.id,
        targetAmount,
        unitsNeeded,
        effectiveAffordableTotal,
        gameSpeed,
    });

    let batchSize = batchPlan.batchSize;

    if (queueTargetMs > 0 && unitsNeededByQueue > 0) {
        batchSize = Math.min(unitsNeededByQueue, effectiveAffordableTotal);
    }

    const countToTrain = Math.min(unitsNeeded, batchSize);
    if (countToTrain <= 0) return { success: false, reason: 'INSUFFICIENT_RESOURCES' };

    const result = sendCommand('recruit_units', {
        buildingId: trainingBuilding.id,
        unitId,
        count: countToTrain,
        villageId: village.id,
    });

    if (result.success) {
        const ratioPct = Math.round((batchPlan.ratio || 0) * 100);
        const queueInfo = Number.isFinite(batchPlan.queueUnits) ? `, Queue:${batchPlan.queueUnits}` : '';
        const queueTargetInfo = queueTargetMinutes > 0 ? `, QueueTarget:${queueTargetMinutes}m` : '';
        const queueCoverageBeforeCycles = queueCoverageMs > 0
            ? (queueCoverageMs / RECRUITMENT_CYCLE_MS)
            : 0;
        const queueCoverageAfterMs = queueCoverageMs + (countToTrain * (singleUnitTimeMs || 0));
        const queueCoverageAfterCycles = queueCoverageAfterMs > 0
            ? (queueCoverageAfterMs / RECRUITMENT_CYCLE_MS)
            : 0;
        const queueCoverageTargetCycles = queueTargetMs > 0
            ? (queueTargetMs / RECRUITMENT_CYCLE_MS)
            : 0;

        const queueCycleInfo = queueTargetMs > 0
            ? `, CiclosCola:${queueCoverageBeforeCycles.toFixed(2)}->${queueCoverageAfterCycles.toFixed(2)}/${queueCoverageTargetCycles.toFixed(2)}`
            : '';

        log('success', village, 'Reclutamiento', `Orden para ${countToTrain}x ${unitId} enviada (Max:${effectiveAffordableTotal}, Mode:${batchPlan.phase}, Batch:${ratioPct}%${queueInfo}${queueTargetInfo}${queueCycleInfo}).`);
        return {
            success: true,
            count: countToTrain,
            unitId,
            timePerUnit: singleUnitTimeMs,
            batchMeta: batchPlan,
        };
    }

    log('fail', village, 'Reclutamiento', `Orden para ${countToTrain}x ${unitId} rechazada. Razón: ${result.reason}`, result.details);
    return { success: false, reason: result.reason, unitId: result.details?.unitId || unitId };
}
