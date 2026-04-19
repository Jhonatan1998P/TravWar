import { gameData } from '../../core/GameData.js';
import { getMaxAffordableCount, getVillageBudget } from '../utils/AIBudgetUtils.js';

const PHASE_BATCH_CONFIG = {
    early: { basePct: 0.18, min: 5, max: 24 },
    mid: { basePct: 0.3, min: 10, max: 72 },
    late: { basePct: 0.45, min: 20, max: 140 },
};
const RECRUITMENT_CYCLE_MS = 3 * 60 * 1000;
const SIEGE_TARGET_RAM_RATIO = 0.7;
const EXCHANGE_RESOURCE_KEYS = ['wood', 'stone', 'iron', 'food'];
const RECRUITMENT_BUDGET_BORROW_PROBABILITY = 0.1;
const RECRUITMENT_BUDGET_BORROW_ECON_SHARE = 0.25;
const RECRUITMENT_EXCHANGE_PROBABILITY = 0.25;

function createEmptyRecruitmentExchangeKpi() {
    return {
        attempts: 0,
        activations: 0,
        skippedByProbability: 0,
        skippedNoEfficiencyGain: 0,
        skippedNoBudget: 0,
        totalPotentialUnitGain: 0,
        lastAttemptAt: null,
        lastActivationAt: null,
        byUnit: {},
    };
}

function getRecruitmentExchangeKpi(village) {
    if (!village || typeof village !== 'object') {
        return createEmptyRecruitmentExchangeKpi();
    }

    if (!village.aiRecruitmentExchangeKpi || typeof village.aiRecruitmentExchangeKpi !== 'object') {
        village.aiRecruitmentExchangeKpi = createEmptyRecruitmentExchangeKpi();
    }

    return village.aiRecruitmentExchangeKpi;
}

function getRecruitmentExchangeUnitKpi(kpi, unitId) {
    if (!kpi.byUnit || typeof kpi.byUnit !== 'object') {
        kpi.byUnit = {};
    }

    if (!kpi.byUnit[unitId]) {
        kpi.byUnit[unitId] = {
            attempts: 0,
            activations: 0,
            totalPotentialUnitGain: 0,
        };
    }

    return kpi.byUnit[unitId];
}

function getRecruitmentExchangeKpiSnapshot(kpi) {
    const attempts = Math.max(0, Number(kpi?.attempts) || 0);
    const activations = Math.max(0, Number(kpi?.activations) || 0);
    const totalPotentialUnitGain = Math.max(0, Number(kpi?.totalPotentialUnitGain) || 0);
    const activationRate = attempts > 0 ? (activations / attempts) : 0;

    return {
        attempts,
        activations,
        activationRate,
        totalPotentialUnitGain,
    };
}

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

function getRecruitmentExchangeProbability(difficulty) {
    return RECRUITMENT_EXCHANGE_PROBABILITY;
}

function getBudgetTotalResources(budget) {
    return EXCHANGE_RESOURCE_KEYS.reduce((sum, resource) => sum + Math.max(0, Number(budget?.[resource]) || 0), 0);
}

function getBudgetSnapshot(budget = {}) {
    return {
        wood: Math.max(0, Number(budget.wood) || 0),
        stone: Math.max(0, Number(budget.stone) || 0),
        iron: Math.max(0, Number(budget.iron) || 0),
        food: Math.max(0, Number(budget.food) || 0),
    };
}

function formatBudgetSnapshot(snapshot = {}) {
    return EXCHANGE_RESOURCE_KEYS
        .map(resource => `${resource}:${Math.floor(Math.max(0, Number(snapshot[resource]) || 0))}`)
        .join(', ');
}

function getUnitTotalCost(cost = {}) {
    return EXCHANGE_RESOURCE_KEYS.reduce((sum, resource) => sum + Math.max(0, Number(cost?.[resource]) || 0), 0);
}

function getMaxAffordableCountWithPerfectExchange(unitCost = {}, budget = {}) {
    const totalCost = getUnitTotalCost(unitCost);
    if (!Number.isFinite(totalCost) || totalCost <= 0) return 0;
    return Math.max(0, Math.floor(getBudgetTotalResources(budget) / totalCost));
}

function syncVillageBudgetToResources(village) {
    EXCHANGE_RESOURCE_KEYS.forEach(resource => {
        if (!village?.resources?.[resource]) return;
        village.resources[resource].current = (village.budget?.econ?.[resource] || 0) + (village.budget?.mil?.[resource] || 0);
    });
}

function maybeBorrowEconomicBudgetForRecruitment({ village, step, log }) {
    if (step?.allowBudgetBorrow === false) {
        return { applied: false, reason: 'BORROW_DISABLED' };
    }

    if (!village?.budget?.econ || !village?.budget?.mil) {
        return { applied: false, reason: 'NO_AI_BUDGET' };
    }

    const isCycleBatchStep = step?.countMode === 'cycle_batch';

    if (!isCycleBatchStep && Math.random() > RECRUITMENT_BUDGET_BORROW_PROBABILITY) {
        return {
            applied: false,
            reason: 'PROBABILITY_GATE',
            probability: RECRUITMENT_BUDGET_BORROW_PROBABILITY,
        };
    }

    const before = {
        econ: {
            wood: Number(village.budget.econ.wood) || 0,
            stone: Number(village.budget.econ.stone) || 0,
            iron: Number(village.budget.econ.iron) || 0,
            food: Number(village.budget.econ.food) || 0,
        },
        mil: {
            wood: Number(village.budget.mil.wood) || 0,
            stone: Number(village.budget.mil.stone) || 0,
            iron: Number(village.budget.mil.iron) || 0,
            food: Number(village.budget.mil.food) || 0,
        },
    };

    const moved = { wood: 0, stone: 0, iron: 0, food: 0 };
    let movedTotal = 0;

    EXCHANGE_RESOURCE_KEYS.forEach(resource => {
        const econAvailable = Math.max(0, Number(village.budget.econ[resource]) || 0);
        const transferAmount = econAvailable * RECRUITMENT_BUDGET_BORROW_ECON_SHARE;
        if (transferAmount <= 0) return;

        village.budget.econ[resource] = Math.max(0, econAvailable - transferAmount);
        village.budget.mil[resource] = Math.max(0, Number(village.budget.mil[resource]) || 0) + transferAmount;

        moved[resource] = transferAmount;
        movedTotal += transferAmount;
    });

    if (movedTotal <= 0) {
        return { applied: false, reason: 'NO_ECON_RESOURCES' };
    }

    syncVillageBudgetToResources(village);

    const economicBudgetFinal = getBudgetSnapshot(village.budget.econ);
    const militaryBudgetFinal = getBudgetSnapshot(village.budget.mil);
    const militaryBudgetFinalText = formatBudgetSnapshot(militaryBudgetFinal);

    if (typeof log === 'function') {
        const movedText = EXCHANGE_RESOURCE_KEYS
            .map(resource => `${resource}:+${(Number(moved[resource]) || 0).toFixed(1)}`)
            .join(', ');
        log(
            'info',
            village,
            'Prestamo Presupuesto',
            `Prestamo ECO->MIL activado (10%) para reclutamiento. Transferido: ${movedText}. budget.mil final: {${militaryBudgetFinalText}}.`,
            {
                probability: RECRUITMENT_BUDGET_BORROW_PROBABILITY,
                share: RECRUITMENT_BUDGET_BORROW_ECON_SHARE,
                moved,
                movedTotal,
                economicBudgetFinal,
                militaryBudgetFinal,
                before,
                after: {
                    econ: economicBudgetFinal,
                    mil: militaryBudgetFinal,
                },
            },
        );
    }

    return {
        applied: true,
        probability: RECRUITMENT_BUDGET_BORROW_PROBABILITY,
        share: RECRUITMENT_BUDGET_BORROW_ECON_SHARE,
        moved,
    };
}

function maybeExchangeMilitaryBudgetForRecruitment({ village, unitData, difficulty, log }) {
    const now = Date.now();
    const kpi = getRecruitmentExchangeKpi(village);
    const unitKpi = getRecruitmentExchangeUnitKpi(kpi, unitData?.id || 'unknown');
    kpi.attempts += 1;
    unitKpi.attempts += 1;
    kpi.lastAttemptAt = now;

    if (!village?.budgetRatio || !village?.budget?.mil || !unitData?.cost) {
        kpi.skippedNoBudget += 1;
        return { applied: false, reason: 'NO_AI_BUDGET' };
    }

    const probability = getRecruitmentExchangeProbability(difficulty);
    if (probability <= 0 || Math.random() > probability) {
        kpi.skippedByProbability += 1;
        return { applied: false, reason: 'PROBABILITY_GATE', probability };
    }

    const currentBudget = village.budget.mil;
    const beforeBudgetSnapshot = {
        wood: Number(currentBudget.wood) || 0,
        stone: Number(currentBudget.stone) || 0,
        iron: Number(currentBudget.iron) || 0,
        food: Number(currentBudget.food) || 0,
    };
    const currentMax = getMaxAffordableCount(unitData.cost, currentBudget);
    const exchangeMax = getMaxAffordableCountWithPerfectExchange(unitData.cost, currentBudget);
    if (!Number.isFinite(exchangeMax) || exchangeMax <= 0 || exchangeMax <= currentMax) {
        kpi.skippedNoEfficiencyGain += 1;
        return {
            applied: false,
            reason: 'NO_EFFICIENCY_GAIN',
            probability,
            currentMax,
            exchangeMax,
        };
    }

    const redistributedBudget = {
        wood: 0,
        stone: 0,
        iron: 0,
        food: 0,
    };

    let allocated = 0;
    EXCHANGE_RESOURCE_KEYS.forEach(resource => {
        const perUnitCost = Math.max(0, Number(unitData.cost?.[resource]) || 0);
        const value = perUnitCost * exchangeMax;
        redistributedBudget[resource] = value;
        allocated += value;
    });

    const totalBudget = getBudgetTotalResources(currentBudget);
    const remaining = Math.max(0, totalBudget - allocated);
    const preferredResource = EXCHANGE_RESOURCE_KEYS
        .slice()
        .sort((a, b) => (unitData.cost?.[b] || 0) - (unitData.cost?.[a] || 0))[0] || 'wood';
    redistributedBudget[preferredResource] += remaining;

    EXCHANGE_RESOURCE_KEYS.forEach(resource => {
        village.budget.mil[resource] = redistributedBudget[resource];
    });
    syncVillageBudgetToResources(village);
    const militaryBudgetFinal = getBudgetSnapshot(village.budget.mil);
    const militaryBudgetFinalText = formatBudgetSnapshot(militaryBudgetFinal);

    const gain = Math.max(0, exchangeMax - Math.max(0, currentMax));
    kpi.activations += 1;
    kpi.totalPotentialUnitGain += gain;
    kpi.lastActivationAt = now;
    unitKpi.activations += 1;
    unitKpi.totalPotentialUnitGain += gain;

    if (typeof log === 'function') {
        const snapshot = getRecruitmentExchangeKpiSnapshot(kpi);
        log(
            'info',
            village,
            'Reclutamiento',
            `Intercambio tactico activado para ${unitData.id}: ${Math.max(0, currentMax)} -> ${exchangeMax} unidades potenciales (+${gain}). budget.mil final: {${militaryBudgetFinalText}}. KPI ${snapshot.activations}/${snapshot.attempts} (${(snapshot.activationRate * 100).toFixed(1)}%), ganancia total +${snapshot.totalPotentialUnitGain}.`,
            {
                difficulty,
                probability,
                before: beforeBudgetSnapshot,
                after: militaryBudgetFinal,
                militaryBudgetFinal,
                kpi: snapshot,
            },
        );
    }

    return {
        applied: true,
        probability,
        currentMax,
        exchangeMax,
    };
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
    difficulty = 'Pesadilla',
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
    const singleUnitTimeMs = getSingleUnitTrainingTimeMs(village, trainingBuilding, unitData, gameSpeed);
    const cycleBatchCount = step.countMode === 'cycle_batch'
        ? Math.max(1, Math.floor(step.cycleCount || 1))
        : 0;
    const isOpenEndedTarget = step.countMode === 'queue_cycles'
        || step.count === Infinity
        || !Number.isFinite(step.count);

    if (queueTargetMs > 0) {
        queueCoverageMs = getQueueCoverageMs(village, trainingBuilding.id);

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
    let unitsNeeded = queueTargetMs > 0
        ? (isOpenEndedTarget ? unitsNeededByQueue : Math.max(unitsNeededByQueue, unitsNeededByTarget))
        : unitsNeededByTarget;

    if (cycleBatchCount > 0) {
        if (!Number.isFinite(singleUnitTimeMs) || singleUnitTimeMs <= 0) {
            return { success: false, reason: 'INVALID_UNIT_DATA' };
        }
        const cycleDurationRealMs = cycleBatchCount * RECRUITMENT_CYCLE_MS;
        unitsNeeded = Math.max(1, Math.ceil(cycleDurationRealMs / singleUnitTimeMs));
    }

    if (unitsNeeded <= 0) return { success: true };

    maybeBorrowEconomicBudgetForRecruitment({
        village,
        step,
        log,
    });

    maybeExchangeMilitaryBudgetForRecruitment({
        village,
        unitData,
        difficulty,
        log,
    });

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

    if (cycleBatchCount > 0 && effectiveAffordableTotal >= unitsNeeded) {
        batchSize = unitsNeeded;
    }

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
        const committedRealMs = Math.max(0, countToTrain * (singleUnitTimeMs || 0));
        const committedRealSec = committedRealMs / 1000;
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

        const cycleBatchInfo = cycleBatchCount > 0
            ? (() => {
                const targetCycleMs = cycleBatchCount * RECRUITMENT_CYCLE_MS;
                const cyclePct = targetCycleMs > 0 ? (committedRealMs / targetCycleMs) * 100 : 0;
                return `, CicloReal:${committedRealSec.toFixed(2)}s/${(targetCycleMs / 1000).toFixed(2)}s (${cyclePct.toFixed(1)}%), UnidadesObjetivo:${unitsNeeded}`;
            })()
            : '';

        log('success', village, 'Reclutamiento', `Orden para ${countToTrain}x ${unitId} enviada (Max:${effectiveAffordableTotal}, Mode:${batchPlan.phase}, Batch:${ratioPct}%${queueInfo}${queueTargetInfo}${queueCycleInfo}${cycleBatchInfo}).`);
        return {
            success: true,
            count: countToTrain,
            unitId,
            timePerUnit: singleUnitTimeMs,
            committedRealMs,
            cycleBatchCount,
            batchMeta: batchPlan,
        };
    }

    log('fail', village, 'Reclutamiento', `Orden para ${countToTrain}x ${unitId} rechazada. Razón: ${result.reason}`, result.details);
    return { success: false, reason: result.reason, unitId: result.details?.unitId || unitId };
}
