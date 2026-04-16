import { getBuildingLevelData, getRaceTroops } from '../../core/data/lookups.js';
import { RESOURCE_FIELD_BUILDING_TYPES } from '../../core/data/constants.js';
import { rebalanceVillageBudgetToRatio } from '../../state/worker/budget.js';
import { resolveUnitIdForRace } from '../utils/AIUnitUtils.js';
import {
    buildPrerequisiteResolverStepFromBlock,
    clonePhaseStep,
    createSharedPhaseOneCycleTargets,
    createPhaseTransition,
    evaluateSharedPhaseOneInfrastructure,
    evaluateSharedPhaseTwoInfrastructure,
    getAverageResourceFieldLevel,
    getCompletedTrainingCycles,
    getPhaseStepSignature,
    createOrRefreshPhaseSubGoal,
    isPhaseQueueAvailable,
    isPhaseResearchStepCompleted,
    getQueuedTrainingMs,
    getConstructionMicroStepsForVillage,
    handleCommonPhaseActionResult,
    getBuildingTypeLevel,
    getDifficultyTemplate,
    getEffectiveBuildingTypeLevel,
    getPhaseStepQueueType,
    getRecruitmentMicroStepsByPriority,
    pickPhaseLaneResult,
    getUnitCountInVillageAndQueue,
    isRecoverablePhaseBlockReason,
    normalizePhaseSubGoalKind,
    PHASE_SUBGOAL_CONFIG,
    PHASE_SUBGOAL_KIND,
    processPhaseActiveSubGoal,
    runPhaseLaneMatrix,
    runPriorityStepList,
    TRAINING_CYCLE_MS,
} from './phase-engine-common.js';

export const EGYPTIAN_PHASE_IDS = Object.freeze({
    phase1: 'egyptian_phase_1_fortified_economy',
    phase2: 'egyptian_phase_2_early_defensive_core',
    phase3: 'egyptian_phase_3_defensive_scaling',
    phase4: 'egyptian_phase_4_secure_expansion_setup',
    phase5: 'egyptian_phase_5_guarded_expansion_execution',
    phase6: 'egyptian_phase_6_resilient_late_control',
    phaseDone: 'egyptian_phase_template_complete',
});

const PHASE_TEMPLATE_BY_DIFFICULTY = Object.freeze({
    Normal: {
        phase1: { ratio: { econ: 0.7, mil: 0.3 } },
        phase2: { ratio: { econ: 0.65, mil: 0.35 } },
        phase3: { ratio: { econ: 0.72, mil: 0.28 } },
        phase4: { ratio: { econ: 0.64, mil: 0.36 } },
        phase5: { ratio: { econ: 0.6, mil: 0.4 } },
        phase6: { ratio: { econ: 0.54, mil: 0.46 } },
    },
    Dificil: {
        phase1: { ratio: { econ: 0.7, mil: 0.3 } },
        phase2: { ratio: { econ: 0.65, mil: 0.35 } },
        phase3: { ratio: { econ: 0.64, mil: 0.36 } },
        phase4: { ratio: { econ: 0.56, mil: 0.44 } },
        phase5: { ratio: { econ: 0.52, mil: 0.48 } },
        phase6: { ratio: { econ: 0.46, mil: 0.54 } },
    },
    Pesadilla: {
        phase1: { ratio: { econ: 0.7, mil: 0.3 } },
        phase2: { ratio: { econ: 0.65, mil: 0.35 } },
        phase3: { ratio: { econ: 0.56, mil: 0.44 } },
        phase4: { ratio: { econ: 0.48, mil: 0.52 } },
        phase5: { ratio: { econ: 0.45, mil: 0.55 } },
        phase6: { ratio: { econ: 0.4, mil: 0.6 } },
    },
});

const PHASE_ONE_EXIT = Object.freeze({
    resourceFieldsLevel: 4,
    buildingLevels: Object.freeze({
        mainBuilding: 5,
        cranny: 5,
        barracks: 3,
        academy: 3,
        warehouse: 10,
        granary: 10,
        cityWall: 5,
    }),
});

const PHASE_TWO_EXIT = Object.freeze({
    resourceFieldsLevel: 5,
    buildingLevels: Object.freeze({
        mainBuilding: 10,
        cranny: 10,
        barracks: 7,
        academy: 7,
        stable: 7,
        smithy: 7,
        cityWall: 10,
    }),
});

const PHASE_THREE_EXIT = Object.freeze({
    minAverageResourceFieldLevel: 7,
    minWallLevel: 8,
    minAcademyLevel: 4,
    minSmithyLevel: 4,
    minDefensiveCoreUnits: 70,
    minScouts: 8,
});

const PHASE_FOUR_EXIT = Object.freeze({
    minWallLevel: 10,
    minMarketplaceLevel: 6,
    minStableLevel: 3,
    minScouts: 12,
    minExpansionReadinessScore: 80,
    maxStoragePressure: 0.9,
    minDefenseReadinessScore: 95,
});

const PHASE_FIVE_EXIT = Object.freeze({
    minVillagesAfterExpansion: 2,
});

const PHASE_EXIT_CYCLE_TARGETS = Object.freeze({
    phase1: createSharedPhaseOneCycleTargets('defensiveInfantry', 2, 0),
    phase2: createSharedPhaseOneCycleTargets('defensiveInfantry', 15, 5),
    phase3: { total: 5, defensiveInfantry: 2, defensiveCavalry: 2, scout: 1 },
    phase4: { total: 5, defensiveInfantry: 1, defensiveCavalry: 1, offensiveInfantry: 2, scout: 1 },
    phase5: { total: 5, defensiveInfantry: 2, defensiveCavalry: 2, offensiveCavalry: 1 },
    phase6: { total: 8, defensiveInfantry: 2, defensiveCavalry: 2, offensiveCavalry: 2, siege: 1, scout: 1 },
});

const THREAT_MEDIUM_ALLOWED_CONSTRUCTION_TYPES = new Set([
    'warehouse',
    'granary',
    'mainBuilding',
    'cranny',
    'cityWall',
    'rallyPoint',
    'barracks',
    'academy',
    'smithy',
    'stable',
    'marketplace',
]);

const THREAT_HIGH_ALLOWED_CONSTRUCTION_TYPES = new Set([
    'warehouse',
    'granary',
    'mainBuilding',
    'cranny',
    'cityWall',
    'rallyPoint',
    'barracks',
    'academy',
    'smithy',
    'stable',
]);

const THREAT_CRITICAL_ALLOWED_CONSTRUCTION_TYPES = new Set([
    'warehouse',
    'granary',
    'cranny',
    'cityWall',
    'rallyPoint',
    'barracks',
    'academy',
    'smithy',
    'stable',
]);

const PHASE_IDLE_LOG_MS = 20_000;
const EXPANSION_CHECK_MS = 25_000;

const SUBGOAL_KIND = PHASE_SUBGOAL_KIND;
const PHASE_SUBGOAL = PHASE_SUBGOAL_CONFIG;

const getBuildingLevel = getBuildingTypeLevel;
const getEffectiveBuildingLevel = getEffectiveBuildingTypeLevel;
const getUnitCount = getUnitCountInVillageAndQueue;

function createEmptyCycleProgress() {
    return {
        totalMs: 0,
        defensiveInfantryMs: 0,
        defensiveCavalryMs: 0,
        offensiveInfantryMs: 0,
        offensiveCavalryMs: 0,
        scoutMs: 0,
        siegeMs: 0,
        expansionMs: 0,
    };
}

function normalizeCycleBucketMs(progress, key) {
    const source = progress && typeof progress === 'object' ? progress : {};
    const msKey = `${key}Ms`;

    if (Number.isFinite(source[msKey])) {
        return Math.max(0, Number(source[msKey]));
    }

    if (Number.isFinite(source[key])) {
        return Math.max(0, Number(source[key])) * TRAINING_CYCLE_MS;
    }

    return 0;
}

function normalizeCycleProgress(progress) {
    const safeProgress = progress && typeof progress === 'object' ? progress : {};
    const legacyTotalCycles = Number.isFinite(safeProgress.total)
        ? Math.max(0, Number(safeProgress.total))
        : 0;
    const totalMs = Number.isFinite(safeProgress.totalMs)
        ? Math.max(0, Number(safeProgress.totalMs))
        : Math.floor(legacyTotalCycles * TRAINING_CYCLE_MS);

    return {
        totalMs,
        defensiveInfantryMs: normalizeCycleBucketMs(safeProgress, 'defensiveInfantry'),
        defensiveCavalryMs: normalizeCycleBucketMs(safeProgress, 'defensiveCavalry'),
        offensiveInfantryMs: normalizeCycleBucketMs(safeProgress, 'offensiveInfantry'),
        offensiveCavalryMs: normalizeCycleBucketMs(safeProgress, 'offensiveCavalry'),
        scoutMs: normalizeCycleBucketMs(safeProgress, 'scout'),
        siegeMs: normalizeCycleBucketMs(safeProgress, 'siege'),
        expansionMs: normalizeCycleBucketMs(safeProgress, 'expansion'),
    };
}

function getEgyptianPhaseKey(phaseId) {
    if (phaseId === EGYPTIAN_PHASE_IDS.phase1) return 'phase1';
    if (phaseId === EGYPTIAN_PHASE_IDS.phase2) return 'phase2';
    if (phaseId === EGYPTIAN_PHASE_IDS.phase3) return 'phase3';
    if (phaseId === EGYPTIAN_PHASE_IDS.phase4) return 'phase4';
    if (phaseId === EGYPTIAN_PHASE_IDS.phase5) return 'phase5';
    if (phaseId === EGYPTIAN_PHASE_IDS.phase6) return 'phase6';
    return null;
}

function getCycleProgressByPhase(phaseState, phaseKey) {
    if (!phaseState.phaseCycleProgress || typeof phaseState.phaseCycleProgress !== 'object') {
        phaseState.phaseCycleProgress = {};
    }

    const rawProgress = phaseState.phaseCycleProgress[phaseKey];
    phaseState.phaseCycleProgress[phaseKey] = rawProgress
        ? normalizeCycleProgress(rawProgress)
        : createEmptyCycleProgress();

    return phaseState.phaseCycleProgress[phaseKey];
}

function getCycleProgressSnapshot(phaseState, phaseKey) {
    const raw = getCycleProgressByPhase(phaseState, phaseKey);
    return {
        total: getCompletedTrainingCycles(raw.totalMs, TRAINING_CYCLE_MS),
        defensiveInfantry: getCompletedTrainingCycles(raw.defensiveInfantryMs, TRAINING_CYCLE_MS),
        defensiveCavalry: getCompletedTrainingCycles(raw.defensiveCavalryMs, TRAINING_CYCLE_MS),
        offensiveInfantry: getCompletedTrainingCycles(raw.offensiveInfantryMs, TRAINING_CYCLE_MS),
        offensiveCavalry: getCompletedTrainingCycles(raw.offensiveCavalryMs, TRAINING_CYCLE_MS),
        scout: getCompletedTrainingCycles(raw.scoutMs, TRAINING_CYCLE_MS),
        siege: getCompletedTrainingCycles(raw.siegeMs, TRAINING_CYCLE_MS),
        expansion: getCompletedTrainingCycles(raw.expansionMs, TRAINING_CYCLE_MS),
    };
}

function getCycleTargetForPhase(phaseKey) {
    return PHASE_EXIT_CYCLE_TARGETS[phaseKey] || { total: 0 };
}

function evaluateCycleTargets(phaseState, phaseKey) {
    const cycles = getCycleProgressSnapshot(phaseState, phaseKey);
    const targets = getCycleTargetForPhase(phaseKey);
    const ready = Object.entries(targets).every(([bucket, required]) => {
        if (!Number.isFinite(required) || required <= 0) return true;
        return (cycles[bucket] || 0) >= required;
    });

    return { ready, cycles, targets };
}

export function getEgyptianPhaseCycleStatus(phaseState, difficulty, phaseKey) {
    const cycles = getCycleProgressSnapshot(phaseState, phaseKey);
    const targets = getCycleTargetForPhase(phaseKey);
    return {
        completed: cycles.total || 0,
        max: Math.max(0, Number(targets.total) || 0),
        cycles,
        targets,
    };
}

function resolveCycleBucketByUnit(village, unitId) {
    if (!unitId) return null;

    const unit = getRaceTroops(village.race || 'egyptians').find(candidate => candidate.id === unitId);
    if (!unit) return null;

    if (unit.role === 'ram' || unit.role === 'catapult') return 'siegeMs';
    if (unit.role === 'scout') return 'scoutMs';
    if (unit.type === 'settler' || unit.type === 'chief' || unit.role === 'colonization' || unit.role === 'conquest') return 'expansionMs';
    if (unit.type === 'infantry' && (unit.role === 'defensive' || unit.role === 'versatile')) return 'defensiveInfantryMs';
    if (unit.type === 'cavalry' && (unit.role === 'defensive' || unit.role === 'versatile')) return 'defensiveCavalryMs';
    if (unit.type === 'infantry' && unit.role === 'offensive') return 'offensiveInfantryMs';
    if (unit.type === 'cavalry' && unit.role === 'offensive') return 'offensiveCavalryMs';

    return null;
}

function recordEgyptianPhaseRecruitmentProgress({ phaseState, phaseKey, village, unitId, count, timePerUnit }) {
    if (!phaseKey) return;
    if (!Number.isFinite(count) || count <= 0) return;
    if (!Number.isFinite(timePerUnit) || timePerUnit <= 0) return;

    const progress = getCycleProgressByPhase(phaseState, phaseKey);
    const bucket = resolveCycleBucketByUnit(village, unitId);
    const trainedMs = getQueuedTrainingMs(count, timePerUnit);
    if (trainedMs <= 0) return;
    progress.totalMs = Math.max(0, Number(progress.totalMs) || 0) + trainedMs;
    if (bucket) {
        progress[bucket] = Math.max(0, Number(progress[bucket]) || 0) + trainedMs;
    }
}

function registerRecruitmentCommitFromAction({ result, phaseState, phaseId, village, difficulty, log }) {
    if (!result?.success) return;
    if (!Number.isFinite(result.count) || result.count <= 0) return;
    if (!result.unitId) return;
    if (!Number.isFinite(result.timePerUnit) || result.timePerUnit <= 0) return;

    const phaseKey = getEgyptianPhaseKey(phaseId);
    if (!phaseKey) return;

    recordEgyptianPhaseRecruitmentProgress({
        phaseState,
        phaseKey,
        village,
        unitId: result.unitId,
        count: result.count,
        timePerUnit: result.timePerUnit,
    });

    if (typeof log === 'function') {
        const status = getEgyptianPhaseCycleStatus(phaseState, difficulty, phaseKey);
        const percent = status.max > 0 ? ((status.completed / status.max) * 100) : 0;
        log(
            'info',
            village,
            'Macro Reclutamiento',
            `Ciclos fase actual: ${status.completed}/${status.max} (${percent.toFixed(1)}%).`,
            null,
            'economic',
        );
    }
}

function getStepSignature(step) {
    return getPhaseStepSignature(step);
}

function isQueueAvailable(village, queueType) {
    return isPhaseQueueAvailable(village, queueType);
}

function isBuildingStepCompleted(village, step) {
    if (!step) return true;

    if (step.type === 'building') {
        return getEffectiveBuildingLevel(village, step.buildingType) >= (step.level || 1);
    }

    if (step.type === 'resource_fields_level') {
        return getAverageResourceFieldLevel(village) >= (step.level || 1);
    }

    return false;
}

function isResearchStepCompleted(village, step) {
    return isPhaseResearchStepCompleted(village, step);
}

function getResourcePoolForStep(village, step) {
    const fallbackPool = {
        wood: village.resources?.wood?.current || 0,
        stone: village.resources?.stone?.current || 0,
        iron: village.resources?.iron?.current || 0,
        food: village.resources?.food?.current || 0,
    };

    if (step?.type === 'units' || step?.type === 'proportional_units') {
        return village.budget?.mil || fallbackPool;
    }

    return village.budget?.econ || fallbackPool;
}

function hasResourcesForNeededCost(pool, neededCost) {
    if (!neededCost || typeof neededCost !== 'object') return false;
    return Object.entries(neededCost).every(([resource, required]) => {
        if (!Number.isFinite(required) || required <= 0) return true;
        return (pool?.[resource] || 0) >= required;
    });
}

function getQueuedLevelsForBuilding(village, buildingId) {
    return (village.constructionQueue || []).filter(job => job.buildingId === buildingId).length;
}

function getEstimatedConstructionCost(village, step) {
    if (!step) return null;

    if (step.type === 'building') {
        const nextLevel = Math.max(1, getEffectiveBuildingLevel(village, step.buildingType) + 1);
        const levelData = getBuildingLevelData(step.buildingType, nextLevel);
        if (!levelData?.cost) return null;
        return { ...levelData.cost };
    }

    if (step.type === 'resource_fields_level') {
        const candidate = (village.buildings || [])
            .filter(building => RESOURCE_FIELD_BUILDING_TYPES.includes(building.type))
            .map(building => ({
                building,
                effectiveLevel: (building.level || 0) + getQueuedLevelsForBuilding(village, building.id),
            }))
            .filter(entry => entry.effectiveLevel < (step.level || 1))
            .sort((a, b) => a.effectiveLevel - b.effectiveLevel)[0];

        if (!candidate) return {};
        const levelData = getBuildingLevelData(candidate.building.type, candidate.effectiveLevel + 1);
        if (!levelData?.cost) return null;
        return { ...levelData.cost };
    }

    return null;
}

function hasEstimatedResourcesForStep(village, step, subGoal = null) {
    if (!step) return true;

    const pool = getResourcePoolForStep(village, step);
    const blockedNeededCost = subGoal?.latestDetails?.needed;
    if (blockedNeededCost && typeof blockedNeededCost === 'object') {
        return hasResourcesForNeededCost(pool, blockedNeededCost);
    }

    if (step.type === 'building' || step.type === 'resource_fields_level') {
        const estimatedCost = getEstimatedConstructionCost(village, step);
        if (!estimatedCost || typeof estimatedCost !== 'object') return false;
        return hasResourcesForNeededCost(pool, estimatedCost);
    }

    if (step.type === 'units' || step.type === 'research' || step.type === 'upgrade' || step.type === 'proportional_units') {
        const unitId = step.unitId || getResolvedUnitId(village, step.unitType) || step.unitType;
        const unitData = getRaceTroops(village.race || 'egyptians').find(unit => unit.id === unitId);
        if (unitData) {
            const requestedCount = step.type === 'units' && Number.isFinite(step.count) && step.count > 0
                ? Math.floor(step.count)
                : 1;
            const baseCost = step.type === 'research' && unitData.research?.cost
                ? unitData.research.cost
                : unitData.cost;
            if (baseCost && typeof baseCost === 'object') {
                const estimatedCost = Object.fromEntries(
                    Object.entries(baseCost).map(([resource, amount]) => [resource, (amount || 0) * requestedCount]),
                );
                return hasResourcesForNeededCost(pool, estimatedCost);
            }
        }

        const total = Object.values(pool).reduce((sum, value) => sum + (value || 0), 0);
        return total > 0;
    }

    return true;
}

function pushSubGoalHistory(phaseState, record) {
    phaseState.subGoalHistory = Array.isArray(phaseState.subGoalHistory) ? phaseState.subGoalHistory : [];
    phaseState.subGoalHistory.push(record);
    if (phaseState.subGoalHistory.length > PHASE_SUBGOAL.maxHistory) {
        phaseState.subGoalHistory.shift();
    }
}

function clearActiveSubGoal(phaseState, now, village, log, message = null, status = 'resolved') {
    const activeSubGoal = phaseState.activeSubGoal;
    if (!activeSubGoal) return;

    pushSubGoalHistory(phaseState, {
        ...activeSubGoal,
        clearedAt: now,
        status,
    });

    if (message) {
        log('success', village, 'Macro SubGoal', message, null, 'economic');
    }

    phaseState.activeSubGoal = null;
}

function createOrRefreshSubGoal({
    phaseState,
    phaseId,
    blockedResult,
    source,
    village,
    gameSpeed,
    log,
}) {
    return createOrRefreshPhaseSubGoal({
        phaseState,
        phaseId,
        blockedResult,
        source,
        village,
        gameSpeed,
        log,
        config: PHASE_SUBGOAL,
        subGoalKind: SUBGOAL_KIND,
        cloneStep: clonePhaseStep,
        getStepSignature,
        getQueueTypeForStep: getPhaseStepQueueType,
        isRecoverableBlockReason: isRecoverablePhaseBlockReason,
        buildResolverStep: (targetVillage, result) => buildPrerequisiteResolverStepFromBlock({
            village: targetVillage,
            blockedResult: result,
            getEffectiveBuildingLevel,
        }),
        idPrefix: 'eg_sg',
    });
}

function processActiveSubGoal({
    phaseState,
    village,
    gameState,
    actionExecutor,
    gameSpeed,
    log,
}) {
    return processPhaseActiveSubGoal({
        phaseState,
        village,
        gameState,
        actionExecutor,
        gameSpeed,
        log,
        config: PHASE_SUBGOAL,
        subGoalKind: SUBGOAL_KIND,
        cloneStep: clonePhaseStep,
        getStepSignature,
        getQueueTypeForStep: getPhaseStepQueueType,
        isQueueAvailable,
        isResearchStepCompleted,
        isBuildingStepCompleted,
        isRecoverableBlockReason: isRecoverablePhaseBlockReason,
        buildResolverStep: (targetVillage, blockedResult) => buildPrerequisiteResolverStepFromBlock({
            village: targetVillage,
            blockedResult,
            getEffectiveBuildingLevel,
        }),
        waitResourcesMode: 'hold_until_resources',
        hasResourcesForBlockedStep: hasEstimatedResourcesForStep,
    });
}

function handlePhaseActionResult({
    result,
    phaseState,
    phaseId,
    source,
    village,
    gameSpeed,
    log,
    onSuccess,
}) {
    return handleCommonPhaseActionResult({
        result,
        phaseState,
        phaseId,
        source,
        village,
        gameSpeed,
        onSuccess,
        createOrRefreshSubGoal: payload => createOrRefreshSubGoal({
            ...payload,
            log,
        }),
    });
}

function getResolvedUnitId(village, unitType) {
    return resolveUnitIdForRace(unitType, village.race || 'egyptians') || unitType;
}

function countRoleTroops(village, role) {
    const raceUnits = getRaceTroops(village.race || 'egyptians');
    const roleById = new Map(raceUnits.map(unit => [unit.id, unit.role]));
    return Object.entries(village.unitsInVillage || {}).reduce((sum, [unitId, count]) => {
        if ((count || 0) <= 0) return sum;
        if (roleById.get(unitId) !== role) return sum;
        return sum + count;
    }, 0);
}

function countRoleTroopsInQueue(village, roleSet) {
    const raceUnits = getRaceTroops(village.race || 'egyptians');
    const roleById = new Map(raceUnits.map(unit => [unit.id, unit.role]));

    return (village.recruitmentQueue || []).reduce((sum, job) => {
        const role = roleById.get(job?.unitId);
        if (!role || !roleSet.has(role)) return sum;
        return sum + (job.remainingCount ?? job.count ?? 0);
    }, 0);
}

function countDefensiveCoreUnits(village) {
    return countRoleTroops(village, 'defensive') + countRoleTroops(village, 'versatile');
}

function getScoutsCount(village) {
    return countRoleTroops(village, 'scout');
}

function isHighThreat(threatContext) {
    return threatContext.threatLevel === 'high' || threatContext.threatLevel === 'critical';
}

function normalizeVillageCombatState(villageCombatState, now) {
    if (!villageCombatState || typeof villageCombatState !== 'object') {
        return {
            threatLevel: 'none',
            shouldPauseEconomicConstruction: false,
            shouldBoostEmergencyRecruitment: false,
            expiresAt: now,
        };
    }

    const expiresAt = Number.isFinite(villageCombatState.expiresAt) ? villageCombatState.expiresAt : now;
    if (expiresAt <= now) {
        return {
            threatLevel: 'none',
            shouldPauseEconomicConstruction: false,
            shouldBoostEmergencyRecruitment: false,
            expiresAt: now,
        };
    }

    return {
        threatLevel: villageCombatState.threatLevel || 'none',
        shouldPauseEconomicConstruction: Boolean(villageCombatState.shouldPauseEconomicConstruction),
        shouldBoostEmergencyRecruitment: Boolean(villageCombatState.shouldBoostEmergencyRecruitment),
        expiresAt,
    };
}

function applyPhaseRatioOnPhaseEntry({ village, difficulty, phaseId, phaseState, log }) {
    const template = getDifficultyTemplate(PHASE_TEMPLATE_BY_DIFFICULTY, difficulty);
    const phaseConfig = template[phaseId] || template.phase6;
    const ratio = {
        econ: Number(phaseConfig?.ratio?.econ) || 0.5,
        mil: Number(phaseConfig?.ratio?.mil) || 0.5,
    };

    if (phaseState.lastAppliedBudgetPhaseId === phaseId) return;

    rebalanceVillageBudgetToRatio(village, ratio);
    phaseState.lastAppliedBudgetPhaseId = phaseId;

    log(
        'info',
        village,
        'Macro Egipcia',
        `Ratio presupuestario aplicado por fase ${Math.round(ratio.econ * 100)}/${Math.round(ratio.mil * 100)} (${phaseId}).`,
        null,
        'economic',
    );
}

function tryStep(actionExecutor, village, gameState, step) {
    return actionExecutor.executePlanStep(village, step, gameState, null);
}

function createCycleMicroRecruitmentStep(unitType, extra = {}) {
    return {
        type: 'units',
        unitType,
        countMode: 'cycle_batch',
        cycleCount: 1,
        allowBudgetBorrow: true,
        ...extra,
    };
}

function tryConstructionPriority({ actionExecutor, village, gameState, phaseState, phaseId, laneId = 'construction', options, shouldAttemptStep = null }) {
    const microOptions = getConstructionMicroStepsForVillage({
        village,
        steps: options,
        getEffectiveBuildingLevel,
    });

    return runPriorityStepList({
        steps: microOptions,
        executeStep: step => tryStep(actionExecutor, village, gameState, step),
        noActionReason: 'NO_ACTION',
        shouldAttemptStep,
        stopOnRecoverableBlock: true,
    });
}

function tryRecruitmentPriority({ actionExecutor, village, gameState, phaseState, phaseId, laneId = 'recruitment', options, shouldAttemptStep = null }) {
    const orderedOptions = getRecruitmentMicroStepsByPriority({
        phaseState,
        phaseId,
        laneId,
        steps: options,
    });

    return runPriorityStepList({
        steps: orderedOptions,
        executeStep: step => tryStep(actionExecutor, village, gameState, step),
        noActionReason: 'NO_ACTION',
        shouldAttemptStep,
        stopOnRecoverableBlock: true,
    });
}

function tryResearchPriority({ actionExecutor, village, gameState, options, shouldAttemptStep = null }) {
    return runPriorityStepList({
        steps: options,
        executeStep: step => {
            const result = tryStep(actionExecutor, village, gameState, step);
            if (result?.reason === 'ALREADY_RESEARCHED' || result?.reason === 'ALREADY_QUEUED') {
                return { success: false, reason: 'NO_ACTION' };
            }
            return result;
        },
        noActionReason: 'NO_ACTION',
        shouldAttemptStep,
        stopOnRecoverableBlock: true,
    });
}

function shouldThrottleIdleLog(phaseState, now) {
    if (!Number.isFinite(phaseState.lastIdleLogAt)) return false;
    return (now - phaseState.lastIdleLogAt) < PHASE_IDLE_LOG_MS;
}

function setIdleLogMark(phaseState, now) {
    phaseState.lastIdleLogAt = now;
}

function updateReadinessScores(phaseState, village, threatContext) {
    const avgFields = getAverageResourceFieldLevel(village);
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    const warehouse = getEffectiveBuildingLevel(village, 'warehouse');
    const granary = getEffectiveBuildingLevel(village, 'granary');
    const defensiveTroops = countRoleTroops(village, 'defensive');
    const imperialDefenseWeight = threatContext.threatLevel === 'high' || threatContext.threatLevel === 'critical' ? 1.1 : 1;

    phaseState.expansionReadinessScore = Math.max(
        0,
        Math.round((avgFields * 8) + (warehouse * 2) + (granary * 2) + (getBuildingLevel(village, 'palace') * 3)),
    );
    phaseState.defenseReadinessScore = Math.max(
        0,
        Math.round(((wall * 6) + (defensiveTroops * 0.6)) * imperialDefenseWeight),
    );
}

function transitionTo(phaseState, from, to, now, reason, log, village, difficulty) {
    if (phaseState.activeSubGoal) {
        clearActiveSubGoal(
            phaseState,
            now,
            village,
            log,
            'Subgoal descartado por cambio de fase.',
            'phase_transition',
        );
    }
    phaseState.activePhaseId = to;
    phaseState.transitions.push(createPhaseTransition(from, to, reason, now));

    const nextPhaseKey = getEgyptianPhaseKey(to);
    if (nextPhaseKey) {
        applyPhaseRatioOnPhaseEntry({
            village,
            difficulty,
            phaseId: nextPhaseKey,
            phaseState,
            log,
        });
    }

    log('success', village, 'Macro Egipcia', `Transicion ${from} -> ${to}.`, { reason }, 'economic');
}

function runThreatEmergencyBlock({ actionExecutor, village, gameState, phaseState, phaseId, threatContext }) {
    const highOrCritical = threatContext.threatLevel === 'high' || threatContext.threatLevel === 'critical';
    if (!threatContext.shouldBoostEmergencyRecruitment && !highOrCritical) {
        return { success: false, reason: 'NO_EMERGENCY' };
    }

    if (!highOrCritical) {
        const defensiveCore = countDefensiveCoreUnits(village);
        if (defensiveCore >= 50) {
            return { success: false, reason: 'NO_EMERGENCY' };
        }
    }

    if (threatContext.threatLevel === 'none' || threatContext.threatLevel === 'low') {
        return { success: false, reason: 'NO_EMERGENCY' };
    }

    return tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        phaseState,
        phaseId,
        laneId: `${phaseId}_threat_emergency_recruitment`,
        options: [
            createCycleMicroRecruitmentStep('defensive_infantry'),
            createCycleMicroRecruitmentStep('defensive_cavalry'),
            createCycleMicroRecruitmentStep('offensive_infantry'),
        ],
    });
}

function evaluatePhaseOneExit(village, phaseState) {
    const infraGate = evaluateSharedPhaseOneInfrastructure({
        village,
        getAverageResourceFieldLevel,
        getEffectiveBuildingLevel,
        targets: PHASE_ONE_EXIT,
    });
    const cycleGate = evaluateCycleTargets(phaseState, 'phase1');
    return infraGate.ready && cycleGate.ready;
}

function updatePhaseTwoQueueTelemetry(phaseState, village) {
    phaseState.phase2MilitaryQueueSamples = Math.max(0, phaseState.phase2MilitaryQueueSamples || 0) + 1;
    const activeQueueRoles = new Set(['defensive', 'versatile', 'scout']);
    const hasMilitaryQueue = countRoleTroopsInQueue(village, activeQueueRoles) > 0;
    if (hasMilitaryQueue) {
        phaseState.phase2MilitaryQueueActiveSamples = Math.max(0, phaseState.phase2MilitaryQueueActiveSamples || 0) + 1;
    }
}

function updatePhaseThreeQueueTelemetry(phaseState, village) {
    phaseState.phase3DefensiveQueueSamples = Math.max(0, phaseState.phase3DefensiveQueueSamples || 0) + 1;
    const activeQueueRoles = new Set(['defensive', 'versatile', 'scout']);
    const hasDefensiveQueue = countRoleTroopsInQueue(village, activeQueueRoles) > 0;
    if (hasDefensiveQueue) {
        phaseState.phase3DefensiveQueueActiveSamples = Math.max(0, phaseState.phase3DefensiveQueueActiveSamples || 0) + 1;
    }
}

function evaluatePhaseTwoExit(village, phaseState) {
    const infraGate = evaluateSharedPhaseTwoInfrastructure({
        village,
        getAverageResourceFieldLevel,
        getEffectiveBuildingLevel,
        targets: PHASE_TWO_EXIT,
    });
    const cycleGate = evaluateCycleTargets(phaseState, 'phase2');

    return infraGate.ready && cycleGate.ready;
}

function evaluatePhaseThreeExit(village, phaseState) {
    const avgFields = getAverageResourceFieldLevel(village);
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    const academy = getEffectiveBuildingLevel(village, 'academy');
    const smithy = getEffectiveBuildingLevel(village, 'smithy');
    const defensiveCore = countDefensiveCoreUnits(village);
    const scouts = getScoutsCount(village);
    const cycleGate = evaluateCycleTargets(phaseState, 'phase3');

    return avgFields >= PHASE_THREE_EXIT.minAverageResourceFieldLevel
        && wall >= PHASE_THREE_EXIT.minWallLevel
        && academy >= PHASE_THREE_EXIT.minAcademyLevel
        && smithy >= PHASE_THREE_EXIT.minSmithyLevel
        && defensiveCore >= PHASE_THREE_EXIT.minDefensiveCoreUnits
        && scouts >= PHASE_THREE_EXIT.minScouts
        && cycleGate.ready;
}

function evaluatePhaseFourExit(village, phaseState) {
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    const marketplace = getEffectiveBuildingLevel(village, 'marketplace');
    const stable = getEffectiveBuildingLevel(village, 'stable');
    const scouts = getScoutsCount(village);
    const latestPressure = phaseState.storagePressureHistory?.[phaseState.storagePressureHistory.length - 1]?.value || 0;

    const cycleGate = evaluateCycleTargets(phaseState, 'phase4');

    return wall >= PHASE_FOUR_EXIT.minWallLevel
        && marketplace >= PHASE_FOUR_EXIT.minMarketplaceLevel
        && stable >= PHASE_FOUR_EXIT.minStableLevel
        && scouts >= PHASE_FOUR_EXIT.minScouts
        && latestPressure <= PHASE_FOUR_EXIT.maxStoragePressure
        && (phaseState.defenseReadinessScore || 0) >= PHASE_FOUR_EXIT.minDefenseReadinessScore
        && (phaseState.expansionReadinessScore || 0) >= PHASE_FOUR_EXIT.minExpansionReadinessScore
        && cycleGate.ready;
}

function evaluatePhaseFiveExit(village, gameState, phaseState) {
    const cycleGate = evaluateCycleTargets(phaseState, 'phase5');
    const myVillageCount = gameState.villages.filter(candidate => candidate.ownerId === village.ownerId).length;
    if (myVillageCount >= PHASE_FIVE_EXIT.minVillagesAfterExpansion) return cycleGate.ready;
    return cycleGate.ready && gameState.movements.some(movement => movement.ownerId === village.ownerId && movement.type === 'settle');
}

function evaluatePhaseSixExit(village, gameState, phaseState) {
    const cycleGate = evaluateCycleTargets(phaseState, 'phase6');
    const avgFields = getAverageResourceFieldLevel(village);
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    const defenders = countRoleTroops(village, 'defensive');
    const myVillageCount = gameState.villages.filter(candidate => candidate.ownerId === village.ownerId).length;
    return myVillageCount >= 3 && avgFields >= 8 && wall >= 12 && defenders >= 140 && cycleGate.ready;
}

function createThreatConstructionFilter(threatContext) {
    const threatLevel = threatContext?.threatLevel || 'none';
    if (threatLevel === 'none' || threatLevel === 'low') return null;

    return step => {
        if (!step) return true;
        if (step.type !== 'building' && step.type !== 'resource_fields_level') return true;

        if (step.type === 'resource_fields_level') {
            return threatLevel === 'medium' && !threatContext.shouldPauseEconomicConstruction;
        }

        const type = step.buildingType;
        if (!type) return true;

        if (threatLevel === 'medium') {
            return THREAT_MEDIUM_ALLOWED_CONSTRUCTION_TYPES.has(type);
        }

        if (threatLevel === 'high') {
            return THREAT_HIGH_ALLOWED_CONSTRUCTION_TYPES.has(type);
        }

        return THREAT_CRITICAL_ALLOWED_CONSTRUCTION_TYPES.has(type);
    };
}

function createThreatRecruitmentFilter(village, threatContext) {
    const threatLevel = threatContext?.threatLevel || 'none';
    if (threatLevel === 'none' || threatLevel === 'low') return null;

    const raceUnits = getRaceTroops(village.race || 'egyptians');
    const unitById = new Map(raceUnits.map(unit => [unit.id, unit]));

    return step => {
        if (!step || step.type !== 'units') return true;

        const unit = unitById.get(getResolvedUnitId(village, step.unitType));
        if (!unit) return true;

        const role = unit.role;
        const type = unit.type;

        if (threatLevel === 'medium') {
            if (role === 'catapult' || role === 'ram') return false;
            return true;
        }

        if (threatLevel === 'high' || threatLevel === 'critical') {
            if (type === 'settler' || type === 'chief') return false;
            if (role === 'offensive' || role === 'catapult' || role === 'ram' || role === 'conquest' || role === 'colonization') {
                return false;
            }
            return role === 'defensive' || role === 'versatile' || role === 'scout';
        }

        return true;
    };
}

function runPhaseOne({ village, gameState, actionExecutor, phaseState, threatContext, constructionFilter, recruitmentFilter }) {
    const matrix = runPhaseLaneMatrix({
        phaseState,
        phaseId: EGYPTIAN_PHASE_IDS.phase1,
        laneMatrixId: 'phase1_lane_matrix',
        lanes: [
            {
                id: 'construction',
                source: 'egyptian_phase1_lane_construction',
                execute: () => {
                    const attempts = [];

                    if (isHighThreat(threatContext)) {
                        attempts.push(tryConstructionPriority({
                            actionExecutor,
                            village,
                            gameState,
                            phaseState,
                            phaseId: EGYPTIAN_PHASE_IDS.phase1,
                            laneId: 'phase1_emergency_construction',
                            shouldAttemptStep: constructionFilter,
                            options: [
                                { type: 'building', buildingType: 'cityWall', level: 4 },
                                { type: 'building', buildingType: 'warehouse', level: 8 },
                                { type: 'building', buildingType: 'granary', level: 8 },
                            ],
                        }));
                    }

                    attempts.push(tryConstructionPriority({
                        actionExecutor,
                        village,
                        gameState,
                        phaseState,
                        phaseId: EGYPTIAN_PHASE_IDS.phase1,
                        laneId: 'phase1_priority_construction',
                        shouldAttemptStep: constructionFilter,
                        options: [
                            { type: 'resource_fields_level', level: PHASE_ONE_EXIT.resourceFieldsLevel },
                            { type: 'building', buildingType: 'mainBuilding', level: PHASE_ONE_EXIT.buildingLevels.mainBuilding },
                            { type: 'building', buildingType: 'cranny', level: PHASE_ONE_EXIT.buildingLevels.cranny },
                            { type: 'building', buildingType: 'barracks', level: PHASE_ONE_EXIT.buildingLevels.barracks },
                            { type: 'building', buildingType: 'academy', level: PHASE_ONE_EXIT.buildingLevels.academy },
                            { type: 'building', buildingType: 'warehouse', level: PHASE_ONE_EXIT.buildingLevels.warehouse },
                            { type: 'building', buildingType: 'granary', level: PHASE_ONE_EXIT.buildingLevels.granary },
                            { type: 'building', buildingType: 'cityWall', level: PHASE_ONE_EXIT.buildingLevels.cityWall },
                        ],
                    }));

                    if (threatContext.threatLevel === 'medium') {
                        attempts.push(tryConstructionPriority({
                            actionExecutor,
                            village,
                            gameState,
                            phaseState,
                            phaseId: EGYPTIAN_PHASE_IDS.phase1,
                            laneId: 'phase1_medium_threat_construction',
                            shouldAttemptStep: constructionFilter,
                            options: [{ type: 'building', buildingType: 'cityWall', level: 3 }],
                        }));
                    }

                    return pickPhaseLaneResult(attempts, 'NO_ACTION');
                },
            },
            {
                id: 'research',
                source: 'egyptian_phase1_lane_research',
                execute: () => tryResearchPriority({
                    actionExecutor,
                    village,
                    gameState,
                    shouldAttemptStep: step => !isResearchStepCompleted(village, step),
                    options: [
                        { type: 'research', unitType: 'defensive_infantry' },
                    ],
                }),
            },
            {
                id: 'upgrade',
                source: 'egyptian_phase1_lane_upgrade',
                execute: () => ({ success: false, reason: 'NO_ACTION' }),
            },
            {
                id: 'recruitment',
                source: 'egyptian_phase1_lane_recruitment',
                execute: () => tryRecruitmentPriority({
                    actionExecutor,
                    village,
                    gameState,
                    phaseState,
                    phaseId: EGYPTIAN_PHASE_IDS.phase1,
                    laneId: 'phase1_priority_recruitment',
                    shouldAttemptStep: recruitmentFilter,
                    options: [
                        createCycleMicroRecruitmentStep('defensive_infantry'),
                    ],
                }),
            },
        ],
    });

    return matrix.handled ? matrix.result : { success: false, reason: 'NO_ACTION' };
}

function runPhaseTwo({ village, gameState, actionExecutor, phaseState, threatContext, constructionFilter, recruitmentFilter }) {
    const matrix = runPhaseLaneMatrix({
        phaseState,
        phaseId: EGYPTIAN_PHASE_IDS.phase2,
        laneMatrixId: 'phase2_lane_matrix',
        lanes: [
            {
                id: 'construction',
                source: 'egyptian_phase2_lane_construction',
                execute: () => {
                    const attempts = [
                        tryConstructionPriority({
                            actionExecutor,
                            village,
                            gameState,
                            phaseState,
                            phaseId: EGYPTIAN_PHASE_IDS.phase2,
                            laneId: 'phase2_priority_construction',
                            shouldAttemptStep: constructionFilter,
                            options: [
                                { type: 'resource_fields_level', level: PHASE_TWO_EXIT.resourceFieldsLevel },
                                { type: 'building', buildingType: 'cranny', level: PHASE_TWO_EXIT.buildingLevels.cranny },
                                { type: 'building', buildingType: 'barracks', level: PHASE_TWO_EXIT.buildingLevels.barracks },
                                { type: 'building', buildingType: 'academy', level: PHASE_TWO_EXIT.buildingLevels.academy },
                                { type: 'building', buildingType: 'stable', level: PHASE_TWO_EXIT.buildingLevels.stable },
                                { type: 'building', buildingType: 'smithy', level: PHASE_TWO_EXIT.buildingLevels.smithy },
                                { type: 'building', buildingType: 'mainBuilding', level: PHASE_TWO_EXIT.buildingLevels.mainBuilding },
                                { type: 'building', buildingType: 'cityWall', level: PHASE_TWO_EXIT.buildingLevels.cityWall },
                            ],
                        }),
                    ];

                    if (isHighThreat(threatContext)) {
                        attempts.push(tryConstructionPriority({
                            actionExecutor,
                            village,
                            gameState,
                            phaseState,
                            phaseId: EGYPTIAN_PHASE_IDS.phase2,
                            laneId: 'phase2_high_threat_construction',
                            shouldAttemptStep: constructionFilter,
                            options: [{ type: 'building', buildingType: 'cityWall', level: PHASE_TWO_EXIT.buildingLevels.cityWall }],
                        }));
                    }

                    return pickPhaseLaneResult(attempts, 'NO_ACTION');
                },
            },
            {
                id: 'research',
                source: 'egyptian_phase2_lane_research',
                execute: () => tryResearchPriority({
                    actionExecutor,
                    village,
                    gameState,
                    shouldAttemptStep: step => !isResearchStepCompleted(village, step),
                    options: [
                        { type: 'research', unitType: 'scout' },
                    ],
                }),
            },
            {
                id: 'upgrade',
                source: 'egyptian_phase2_lane_upgrade',
                execute: () => ({ success: false, reason: 'NO_ACTION' }),
            },
            {
                id: 'recruitment',
                source: 'egyptian_phase2_lane_recruitment',
                execute: () => tryRecruitmentPriority({
                    actionExecutor,
                    village,
                    gameState,
                    phaseState,
                    phaseId: EGYPTIAN_PHASE_IDS.phase2,
                    laneId: 'phase2_priority_recruitment',
                    shouldAttemptStep: recruitmentFilter,
                    options: [
                        createCycleMicroRecruitmentStep('defensive_infantry'),
                        createCycleMicroRecruitmentStep('scout'),
                    ],
                }),
            },
        ],
    });

    return matrix.handled ? matrix.result : { success: false, reason: 'NO_ACTION' };
}

function runPhaseThree({ village, gameState, actionExecutor, phaseState, constructionFilter, recruitmentFilter }) {
    const matrix = runPhaseLaneMatrix({
        phaseState,
        phaseId: EGYPTIAN_PHASE_IDS.phase3,
        laneMatrixId: 'phase3_lane_matrix',
        lanes: [
            {
                id: 'construction',
                source: 'egyptian_phase3_lane_construction',
                execute: () => tryConstructionPriority({
                    actionExecutor,
                    village,
                    gameState,
                    phaseState,
                    phaseId: EGYPTIAN_PHASE_IDS.phase3,
                    laneId: 'phase3_priority_construction',
                    shouldAttemptStep: constructionFilter,
                    options: [
                        { type: 'building', buildingType: 'warehouse', level: 10 },
                        { type: 'building', buildingType: 'granary', level: 10 },
                        { type: 'building', buildingType: 'cityWall', level: 8 },
                        { type: 'building', buildingType: 'barracks', level: 6 },
                        { type: 'building', buildingType: 'academy', level: 4 },
                        { type: 'building', buildingType: 'smithy', level: 4 },
                        { type: 'building', buildingType: 'stable', level: 3 },
                        { type: 'resource_fields_level', level: 7 },
                    ],
                }),
            },
            {
                id: 'research',
                source: 'egyptian_phase3_lane_research',
                execute: () => ({ success: false, reason: 'NO_ACTION' }),
            },
            {
                id: 'upgrade',
                source: 'egyptian_phase3_lane_upgrade',
                execute: () => ({ success: false, reason: 'NO_ACTION' }),
            },
            {
                id: 'recruitment',
                source: 'egyptian_phase3_lane_recruitment',
                execute: () => tryRecruitmentPriority({
                    actionExecutor,
                    village,
                    gameState,
                    phaseState,
                    phaseId: EGYPTIAN_PHASE_IDS.phase3,
                    laneId: 'phase3_priority_recruitment',
                    shouldAttemptStep: recruitmentFilter,
                    options: [
                        createCycleMicroRecruitmentStep('defensive_infantry'),
                        createCycleMicroRecruitmentStep('scout'),
                        createCycleMicroRecruitmentStep('defensive_cavalry'),
                        createCycleMicroRecruitmentStep('offensive_infantry'),
                    ],
                }),
            },
        ],
    });

    return matrix.handled ? matrix.result : { success: false, reason: 'NO_ACTION' };
}

function runPhaseFour({ village, gameState, actionExecutor, phaseState, constructionFilter, recruitmentFilter }) {
    const matrix = runPhaseLaneMatrix({
        phaseState,
        phaseId: EGYPTIAN_PHASE_IDS.phase4,
        laneMatrixId: 'phase4_lane_matrix',
        lanes: [
            {
                id: 'construction',
                source: 'egyptian_phase4_lane_construction',
                execute: () => tryConstructionPriority({
                    actionExecutor,
                    village,
                    gameState,
                    phaseState,
                    phaseId: EGYPTIAN_PHASE_IDS.phase4,
                    laneId: 'phase4_priority_construction',
                    shouldAttemptStep: constructionFilter,
                    options: [
                        { type: 'building', buildingType: 'cityWall', level: 10 },
                        { type: 'building', buildingType: 'stable', level: 5 },
                        { type: 'building', buildingType: 'marketplace', level: 8 },
                        { type: 'building', buildingType: 'warehouse', level: 12 },
                        { type: 'building', buildingType: 'granary', level: 12 },
                        { type: 'building', buildingType: 'mainBuilding', level: 10 },
                        { type: 'building', buildingType: 'smithy', level: 6 },
                        { type: 'building', buildingType: 'academy', level: 8 },
                    ],
                }),
            },
            {
                id: 'research',
                source: 'egyptian_phase4_lane_research',
                execute: () => ({ success: false, reason: 'NO_ACTION' }),
            },
            {
                id: 'upgrade',
                source: 'egyptian_phase4_lane_upgrade',
                execute: () => ({ success: false, reason: 'NO_ACTION' }),
            },
            {
                id: 'recruitment',
                source: 'egyptian_phase4_lane_recruitment',
                execute: () => tryRecruitmentPriority({
                    actionExecutor,
                    village,
                    gameState,
                    phaseState,
                    phaseId: EGYPTIAN_PHASE_IDS.phase4,
                    laneId: 'phase4_priority_recruitment',
                    shouldAttemptStep: recruitmentFilter,
                    options: [
                        createCycleMicroRecruitmentStep('defensive_infantry'),
                        createCycleMicroRecruitmentStep('defensive_cavalry'),
                        createCycleMicroRecruitmentStep('scout'),
                        createCycleMicroRecruitmentStep('offensive_infantry'),
                    ],
                }),
            },
        ],
    });

    return matrix.handled ? matrix.result : { success: false, reason: 'NO_ACTION' };
}

function shouldEnableContextualOffense({ phaseState, threatContext, gameState, village }) {
    if (threatContext.threatLevel !== 'none' && threatContext.threatLevel !== 'low') return false;
    const myVillageCount = gameState.villages.filter(candidate => candidate.ownerId === village.ownerId).length;
    return myVillageCount >= 2 && (phaseState.defenseReadinessScore || 0) >= 110;
}

function shouldEnableContextualSiege({ phaseState, threatContext, gameState, village }) {
    if (threatContext.threatLevel !== 'none' && threatContext.threatLevel !== 'low') return false;
    const myVillageCount = gameState.villages.filter(candidate => candidate.ownerId === village.ownerId).length;
    return myVillageCount >= 3 && (phaseState.defenseReadinessScore || 0) >= 130;
}

function shouldPreferConquestExpansion({ phaseState, threatContext, gameState, village }) {
    if (threatContext.threatLevel !== 'none' && threatContext.threatLevel !== 'low') return false;
    const myVillageCount = gameState.villages.filter(candidate => candidate.ownerId === village.ownerId).length;
    const palaceLevel = getEffectiveBuildingLevel(village, 'palace');
    return myVillageCount >= 2 && palaceLevel >= 12 && (phaseState.defenseReadinessScore || 0) >= 115;
}

function canAttemptSafeExpansion({ threatContext, phaseState, village }) {
    const blockedByThreat = threatContext.threatLevel === 'high' || threatContext.threatLevel === 'critical';
    if (blockedByThreat) return false;

    const settlerUnitId = getResolvedUnitId(village, 'settler');
    const settlersReady = settlerUnitId ? getUnitCount(village, settlerUnitId) >= 3 : false;
    if (!settlersReady) return false;

    const defensiveCore = countDefensiveCoreUnits(village);
    if (defensiveCore < 80) return false;

    const latestPressure = phaseState.storagePressureHistory?.[phaseState.storagePressureHistory.length - 1]?.value || 0;
    if (latestPressure > 0.95) return false;

    return (phaseState.defenseReadinessScore || 0) >= 85;
}

function runPhaseFive({
    village,
    gameState,
    actionExecutor,
    phaseState,
    now,
    threatContext,
    constructionFilter,
    recruitmentFilter,
}) {
    const matrix = runPhaseLaneMatrix({
        phaseState,
        phaseId: EGYPTIAN_PHASE_IDS.phase5,
        laneMatrixId: 'phase5_lane_matrix',
        lanes: [
            {
                id: 'construction',
                source: 'egyptian_phase5_lane_construction',
                execute: () => tryConstructionPriority({
                    actionExecutor,
                    village,
                    gameState,
                    phaseState,
                    phaseId: EGYPTIAN_PHASE_IDS.phase5,
                    laneId: 'phase5_priority_construction',
                    shouldAttemptStep: constructionFilter,
                    options: [
                        { type: 'building', buildingType: 'embassy', level: 1 },
                        { type: 'building', buildingType: 'palace', level: 10 },
                        { type: 'building', buildingType: 'marketplace', level: 10 },
                        { type: 'building', buildingType: 'warehouse', level: 14 },
                        { type: 'building', buildingType: 'granary', level: 14 },
                        { type: 'building', buildingType: 'cityWall', level: 12 },
                        { type: 'building', buildingType: 'academy', level: 10 },
                        { type: 'building', buildingType: 'stable', level: 7 },
                        { type: 'building', buildingType: 'barracks', level: 8 },
                    ],
                }),
            },
            {
                id: 'research',
                source: 'egyptian_phase5_lane_research',
                execute: () => ({ success: false, reason: 'NO_ACTION' }),
            },
            {
                id: 'upgrade',
                source: 'egyptian_phase5_lane_upgrade',
                execute: () => ({ success: false, reason: 'NO_ACTION' }),
            },
            {
                id: 'recruitment',
                source: 'egyptian_phase5_lane_recruitment',
                execute: () => {
                    const recruitmentOptions = [
                        createCycleMicroRecruitmentStep('defensive_infantry'),
                        createCycleMicroRecruitmentStep('defensive_cavalry'),
                    ];

                    if (shouldPreferConquestExpansion({ phaseState, threatContext, gameState, village })) {
                        recruitmentOptions.push(createCycleMicroRecruitmentStep('chief'));
                        recruitmentOptions.push(createCycleMicroRecruitmentStep('settler'));
                    } else {
                        recruitmentOptions.push(createCycleMicroRecruitmentStep('settler'));
                        recruitmentOptions.push(createCycleMicroRecruitmentStep('chief'));
                    }

                    if (shouldEnableContextualOffense({ phaseState, threatContext, gameState, village })) {
                        recruitmentOptions.push(
                            createCycleMicroRecruitmentStep('chief'),
                            createCycleMicroRecruitmentStep('offensive_cavalry'),
                        );
                    }

                    if (shouldEnableContextualSiege({ phaseState, threatContext, gameState, village })) {
                        recruitmentOptions.push(
                            createCycleMicroRecruitmentStep('ram'),
                            createCycleMicroRecruitmentStep('catapult'),
                        );
                    }

                    return tryRecruitmentPriority({
                        actionExecutor,
                        village,
                        gameState,
                        phaseState,
                        phaseId: EGYPTIAN_PHASE_IDS.phase5,
                        laneId: 'phase5_priority_recruitment',
                        shouldAttemptStep: recruitmentFilter,
                        options: recruitmentOptions,
                    });
                },
            },
        ],
    });

    if (matrix.handled) {
        return matrix.result;
    }

    if ((now - phaseState.lastSafeExpansionCheckAt) >= EXPANSION_CHECK_MS) {
        phaseState.kpiExpansionAttempts = Math.max(0, phaseState.kpiExpansionAttempts || 0) + 1;

        if (threatContext.threatLevel === 'high' || threatContext.threatLevel === 'critical') {
            phaseState.kpiExpansionBlockedByThreat = Math.max(0, phaseState.kpiExpansionBlockedByThreat || 0) + 1;
        }

        if (canAttemptSafeExpansion({ threatContext, phaseState, village })) {
            const villages = gameState.villages.filter(candidate => candidate.ownerId === village.ownerId);
            actionExecutor.executeGoalAction({ type: 'settle_new_village' }, villages, gameState);
            phaseState.lastSafeExpansionCheckAt = now;
            phaseState.kpiExpansionLaunches = Math.max(0, phaseState.kpiExpansionLaunches || 0) + 1;
            return { success: true, reason: 'EXPANSION_ATTEMPTED' };
        }

        phaseState.lastSafeExpansionCheckAt = now;
    }

    return { success: false, reason: 'NO_ACTION' };
}

function runPhaseSix({ village, gameState, actionExecutor, phaseState, now, threatContext, constructionFilter, recruitmentFilter }) {
    const matrix = runPhaseLaneMatrix({
        phaseState,
        phaseId: EGYPTIAN_PHASE_IDS.phase6,
        laneMatrixId: 'phase6_lane_matrix',
        lanes: [
            {
                id: 'construction',
                source: 'egyptian_phase6_lane_construction',
                execute: () => tryConstructionPriority({
                    actionExecutor,
                    village,
                    gameState,
                    phaseState,
                    phaseId: EGYPTIAN_PHASE_IDS.phase6,
                    laneId: 'phase6_priority_construction',
                    shouldAttemptStep: constructionFilter,
                    options: [
                        { type: 'building', buildingType: 'cityWall', level: 15 },
                        { type: 'building', buildingType: 'smithy', level: 8 },
                        { type: 'building', buildingType: 'workshop', level: 6 },
                        { type: 'resource_fields_level', level: 9 },
                    ],
                }),
            },
            {
                id: 'research',
                source: 'egyptian_phase6_lane_research',
                execute: () => ({ success: false, reason: 'NO_ACTION' }),
            },
            {
                id: 'upgrade',
                source: 'egyptian_phase6_lane_upgrade',
                execute: () => ({ success: false, reason: 'NO_ACTION' }),
            },
            {
                id: 'recruitment',
                source: 'egyptian_phase6_lane_recruitment',
                execute: () => tryRecruitmentPriority({
                    actionExecutor,
                    village,
                    gameState,
                    phaseState,
                    phaseId: EGYPTIAN_PHASE_IDS.phase6,
                    laneId: 'phase6_priority_recruitment',
                    shouldAttemptStep: recruitmentFilter,
                    options: [
                        createCycleMicroRecruitmentStep('defensive_infantry'),
                        createCycleMicroRecruitmentStep('defensive_cavalry'),
                        createCycleMicroRecruitmentStep('offensive_cavalry'),
                        createCycleMicroRecruitmentStep('ram'),
                        createCycleMicroRecruitmentStep('catapult'),
                    ],
                }),
            },
        ],
    });

    if (matrix.handled) {
        return matrix.result;
    }

    if ((now - phaseState.lastSafeExpansionCheckAt) >= EXPANSION_CHECK_MS) {
        phaseState.kpiExpansionAttempts = Math.max(0, phaseState.kpiExpansionAttempts || 0) + 1;

        if (threatContext.threatLevel === 'high' || threatContext.threatLevel === 'critical') {
            phaseState.kpiExpansionBlockedByThreat = Math.max(0, phaseState.kpiExpansionBlockedByThreat || 0) + 1;
        }

        if (canAttemptSafeExpansion({ threatContext, phaseState, village })) {
            const villages = gameState.villages.filter(candidate => candidate.ownerId === village.ownerId);
            actionExecutor.executeGoalAction({ type: 'settle_new_village' }, villages, gameState);
            phaseState.lastSafeExpansionCheckAt = now;
            phaseState.kpiExpansionLaunches = Math.max(0, phaseState.kpiExpansionLaunches || 0) + 1;
            return { success: true, reason: 'EXPANSION_ATTEMPTED' };
        }

        phaseState.lastSafeExpansionCheckAt = now;
    }

    return { success: false, reason: 'NO_ACTION' };
}

const EGYPTIAN_LEGACY_PHASE_ID_MAP = Object.freeze({
    egyptian_phase_1_pending: EGYPTIAN_PHASE_IDS.phase1,
    egyptian_phase_2_pending: EGYPTIAN_PHASE_IDS.phase2,
    egyptian_phase_3_pending: EGYPTIAN_PHASE_IDS.phase3,
    egyptian_phase_4_pending: EGYPTIAN_PHASE_IDS.phase4,
    egyptian_phase_5_pending: EGYPTIAN_PHASE_IDS.phase5,
    egyptian_phase_6_pending: EGYPTIAN_PHASE_IDS.phase6,
    egyptian_phase_done: EGYPTIAN_PHASE_IDS.phaseDone,
    egyptian_phase_template_done: EGYPTIAN_PHASE_IDS.phaseDone,
});

function normalizeEgyptianPhaseId(rawPhaseId, fallbackPhaseId) {
    const normalized = EGYPTIAN_LEGACY_PHASE_ID_MAP[rawPhaseId] || rawPhaseId;
    if (Object.values(EGYPTIAN_PHASE_IDS).includes(normalized)) {
        return normalized;
    }
    return fallbackPhaseId;
}

function normalizeEgyptianTransition(record) {
    if (!record || typeof record !== 'object') return null;

    const from = normalizeEgyptianPhaseId(
        record.from || record.fromPhase || record.phaseFrom,
        null,
    );
    const to = normalizeEgyptianPhaseId(
        record.to || record.toPhase || record.phaseTo,
        null,
    );
    if (!from || !to) return null;

    return {
        from,
        to,
        reason: record.reason || record.cause || 'UNKNOWN',
        at: Number.isFinite(record.at) ? record.at : Number.isFinite(record.timestamp) ? record.timestamp : Date.now(),
        status: record.status || 'phase_transition',
    };
}

function normalizeEgyptianTransitions(rawTransitions) {
    if (!Array.isArray(rawTransitions)) return [];
    return rawTransitions
        .map(normalizeEgyptianTransition)
        .filter(Boolean);
}

function normalizeEgyptianPhaseCycleProgress(rawProgress) {
    const source = rawProgress && typeof rawProgress === 'object' ? rawProgress : {};
    const aliases = {
        phase1: ['phase1', 'phase_1'],
        phase2: ['phase2', 'phase_2'],
        phase3: ['phase3', 'phase_3'],
        phase4: ['phase4', 'phase_4'],
        phase5: ['phase5', 'phase_5'],
        phase6: ['phase6', 'phase_6'],
    };

    const normalized = {};
    for (const phaseKey of Object.keys(aliases)) {
        const sourceEntry = source[aliases[phaseKey].find(key => key in source)];
        normalized[phaseKey] = normalizeCycleProgress(sourceEntry);
    }
    return normalized;
}

function normalizeEgyptianSubGoalRecord(rawSubGoal, fallbackPhaseId) {
    if (!rawSubGoal || typeof rawSubGoal !== 'object') return null;

    const blockedStep = clonePhaseStep(rawSubGoal.blockedStep || rawSubGoal.step || null);
    const resolverStep = clonePhaseStep(rawSubGoal.resolverStep || rawSubGoal.resolver || null);
    const kind = normalizePhaseSubGoalKind(rawSubGoal.kind || rawSubGoal.type, SUBGOAL_KIND);
    const phaseId = normalizeEgyptianPhaseId(rawSubGoal.phaseId, fallbackPhaseId);
    const reason = rawSubGoal.reason || rawSubGoal.blockReason || 'UNKNOWN';
    const queueType = rawSubGoal.queueType || getPhaseStepQueueType(blockedStep || resolverStep);
    const createdAt = Number.isFinite(rawSubGoal.createdAt) ? rawSubGoal.createdAt : Date.now();

    return {
        id: rawSubGoal.id || `eg_sg_${createdAt}_${Math.random().toString(36).slice(2, 7)}`,
        signature: rawSubGoal.signature || `${phaseId}|${kind}|${reason}|${getStepSignature(blockedStep)}|${getStepSignature(resolverStep)}`,
        kind,
        phaseId,
        source: rawSubGoal.source || 'hydrated',
        reason,
        createdAt,
        updatedAt: Number.isFinite(rawSubGoal.updatedAt) ? rawSubGoal.updatedAt : createdAt,
        nextAttemptAt: Number.isFinite(rawSubGoal.nextAttemptAt) ? rawSubGoal.nextAttemptAt : createdAt,
        attempts: Math.max(0, Math.floor(Number(rawSubGoal.attempts) || 0)),
        lastLogAt: Number.isFinite(rawSubGoal.lastLogAt) ? rawSubGoal.lastLogAt : 0,
        blockedStep,
        resolverStep,
        queueType,
        latestDetails: rawSubGoal.latestDetails || rawSubGoal.details || null,
    };
}

function normalizeStoragePressureHistory(rawHistory) {
    if (!Array.isArray(rawHistory)) return [];
    return rawHistory
        .map(entry => {
            if (Number.isFinite(entry)) {
                return { at: Date.now(), value: Math.max(0, Number(entry)) };
            }
            if (!entry || typeof entry !== 'object') return null;
            const value = Number(entry.value);
            if (!Number.isFinite(value)) return null;
            return {
                at: Number.isFinite(entry.at) ? entry.at : Date.now(),
                value: Math.max(0, value),
            };
        })
        .filter(Boolean)
        .slice(-20);
}

export function createDefaultEgyptianPhaseState(now = Date.now()) {
    return {
        activePhaseId: EGYPTIAN_PHASE_IDS.phase1,
        startedAt: now,
        lastEvaluationAt: now,
        transitions: [],
        phase2MilitaryQueueSamples: 0,
        phase2MilitaryQueueActiveSamples: 0,
        phase3DefensiveQueueSamples: 0,
        phase3DefensiveQueueActiveSamples: 0,
        phaseCycleProgress: {},
        activeSubGoal: null,
        subGoalHistory: [],
        lastThreatOverrideLogAt: 0,
        lastIdleLogAt: 0,
        lastConstructionReserveLogAt: 0,
        expansionReadinessScore: 0,
        defenseReadinessScore: 0,
        storagePressureHistory: [],
        lastSafeExpansionCheckAt: 0,
        lastAppliedBudgetPhaseId: null,
        kpiThreatInterruptedCycles: 0,
        kpiStoragePressureCriticalSamples: 0,
        kpiExpansionAttempts: 0,
        kpiExpansionLaunches: 0,
        kpiExpansionBlockedByThreat: 0,
        kpiEmergencyRecruitmentCycles: 0,
    };
}

export function hydrateEgyptianPhaseState(rawState = null, now = Date.now()) {
    const fallback = createDefaultEgyptianPhaseState(now);
    if (!rawState || typeof rawState !== 'object') return fallback;

    const normalizedPhaseId = normalizeEgyptianPhaseId(rawState.activePhaseId, fallback.activePhaseId);
    const normalizedCycleProgress = normalizeEgyptianPhaseCycleProgress(rawState.phaseCycleProgress);
    const normalizedActiveSubGoal = normalizeEgyptianSubGoalRecord(rawState.activeSubGoal, normalizedPhaseId);
    const normalizedSubGoalHistory = Array.isArray(rawState.subGoalHistory)
        ? rawState.subGoalHistory
            .map(entry => normalizeEgyptianSubGoalRecord(entry, normalizedPhaseId))
            .filter(Boolean)
        : [];

    return {
        activePhaseId: normalizedPhaseId,
        startedAt: Number.isFinite(rawState.startedAt) ? rawState.startedAt : fallback.startedAt,
        lastEvaluationAt: Number.isFinite(rawState.lastEvaluationAt) ? rawState.lastEvaluationAt : fallback.lastEvaluationAt,
        transitions: normalizeEgyptianTransitions(rawState.transitions),
        phase2MilitaryQueueSamples: Number.isFinite(rawState.phase2MilitaryQueueSamples)
            ? rawState.phase2MilitaryQueueSamples
            : Number.isFinite(rawState.phase2QueueSamples)
                ? rawState.phase2QueueSamples
                : 0,
        phase2MilitaryQueueActiveSamples: Number.isFinite(rawState.phase2MilitaryQueueActiveSamples)
            ? rawState.phase2MilitaryQueueActiveSamples
            : Number.isFinite(rawState.phase2QueueActiveSamples)
                ? rawState.phase2QueueActiveSamples
                : 0,
        phase3DefensiveQueueSamples: Number.isFinite(rawState.phase3DefensiveQueueSamples)
            ? rawState.phase3DefensiveQueueSamples
            : Number.isFinite(rawState.phase3QueueSamples)
                ? rawState.phase3QueueSamples
                : 0,
        phase3DefensiveQueueActiveSamples: Number.isFinite(rawState.phase3DefensiveQueueActiveSamples)
            ? rawState.phase3DefensiveQueueActiveSamples
            : Number.isFinite(rawState.phase3QueueActiveSamples)
                ? rawState.phase3QueueActiveSamples
                : 0,
        phaseCycleProgress: normalizedCycleProgress,
        activeSubGoal: normalizedActiveSubGoal,
        subGoalHistory: normalizedSubGoalHistory,
        lastThreatOverrideLogAt: Number.isFinite(rawState.lastThreatOverrideLogAt) ? rawState.lastThreatOverrideLogAt : 0,
        lastIdleLogAt: Number.isFinite(rawState.lastIdleLogAt) ? rawState.lastIdleLogAt : 0,
        lastConstructionReserveLogAt: Number.isFinite(rawState.lastConstructionReserveLogAt) ? rawState.lastConstructionReserveLogAt : 0,
        expansionReadinessScore: Number.isFinite(rawState.expansionReadinessScore)
            ? rawState.expansionReadinessScore
            : Number.isFinite(rawState.expansionScore)
                ? rawState.expansionScore
                : 0,
        defenseReadinessScore: Number.isFinite(rawState.defenseReadinessScore)
            ? rawState.defenseReadinessScore
            : Number.isFinite(rawState.defenseScore)
                ? rawState.defenseScore
                : 0,
        storagePressureHistory: normalizeStoragePressureHistory(rawState.storagePressureHistory || rawState.storagePressureSamples),
        lastSafeExpansionCheckAt: Number.isFinite(rawState.lastSafeExpansionCheckAt) ? rawState.lastSafeExpansionCheckAt : 0,
        lastAppliedBudgetPhaseId:
            typeof rawState.lastAppliedBudgetPhaseId === 'string'
                ? rawState.lastAppliedBudgetPhaseId
                : null,
        kpiThreatInterruptedCycles: Number.isFinite(rawState.kpiThreatInterruptedCycles)
            ? rawState.kpiThreatInterruptedCycles
            : Number.isFinite(rawState.kpiThreatCycles)
                ? rawState.kpiThreatCycles
                : 0,
        kpiStoragePressureCriticalSamples: Number.isFinite(rawState.kpiStoragePressureCriticalSamples)
            ? rawState.kpiStoragePressureCriticalSamples
            : Number.isFinite(rawState.kpiStorageCritical)
                ? rawState.kpiStorageCritical
                : 0,
        kpiExpansionAttempts: Number.isFinite(rawState.kpiExpansionAttempts) ? rawState.kpiExpansionAttempts : 0,
        kpiExpansionLaunches: Number.isFinite(rawState.kpiExpansionLaunches) ? rawState.kpiExpansionLaunches : 0,
        kpiExpansionBlockedByThreat: Number.isFinite(rawState.kpiExpansionBlockedByThreat) ? rawState.kpiExpansionBlockedByThreat : 0,
        kpiEmergencyRecruitmentCycles: Number.isFinite(rawState.kpiEmergencyRecruitmentCycles)
            ? rawState.kpiEmergencyRecruitmentCycles
            : Number.isFinite(rawState.kpiEmergencyCycles)
                ? rawState.kpiEmergencyCycles
                : 0,
    };
}

export function serializeEgyptianPhaseStates(stateByVillageMap) {
    const serialized = {};
    for (const [villageId, state] of stateByVillageMap.entries()) {
        serialized[villageId] = {
            schemaVersion: 2,
            activePhaseId: state.activePhaseId,
            startedAt: state.startedAt,
            lastEvaluationAt: state.lastEvaluationAt,
            transitions: state.transitions,
            phase2MilitaryQueueSamples: state.phase2MilitaryQueueSamples,
            phase2MilitaryQueueActiveSamples: state.phase2MilitaryQueueActiveSamples,
            phase3DefensiveQueueSamples: state.phase3DefensiveQueueSamples,
            phase3DefensiveQueueActiveSamples: state.phase3DefensiveQueueActiveSamples,
            phaseCycleProgress: state.phaseCycleProgress,
            activeSubGoal: state.activeSubGoal,
            subGoalHistory: state.subGoalHistory,
            lastThreatOverrideLogAt: state.lastThreatOverrideLogAt,
            lastIdleLogAt: state.lastIdleLogAt,
            lastConstructionReserveLogAt: state.lastConstructionReserveLogAt,
            expansionReadinessScore: state.expansionReadinessScore,
            defenseReadinessScore: state.defenseReadinessScore,
            storagePressureHistory: state.storagePressureHistory,
            lastSafeExpansionCheckAt: state.lastSafeExpansionCheckAt,
            lastAppliedBudgetPhaseId: state.lastAppliedBudgetPhaseId,
            kpiThreatInterruptedCycles: state.kpiThreatInterruptedCycles,
            kpiStoragePressureCriticalSamples: state.kpiStoragePressureCriticalSamples,
            kpiExpansionAttempts: state.kpiExpansionAttempts,
            kpiExpansionLaunches: state.kpiExpansionLaunches,
            kpiExpansionBlockedByThreat: state.kpiExpansionBlockedByThreat,
            kpiEmergencyRecruitmentCycles: state.kpiEmergencyRecruitmentCycles,
        };
    }
    return serialized;
}

export function runEgyptianEconomicPhaseCycle({
    village,
    gameState,
    phaseState,
    difficulty,
    gameSpeed = 1,
    villageCombatState,
    actionExecutor,
    log,
}) {
    const now = Date.now();
    const threatContext = normalizeVillageCombatState(villageCombatState, now);
    phaseState.lastEvaluationAt = now;

    if (threatContext.threatLevel === 'medium' || threatContext.threatLevel === 'high' || threatContext.threatLevel === 'critical') {
        phaseState.kpiThreatInterruptedCycles = Math.max(0, phaseState.kpiThreatInterruptedCycles || 0) + 1;
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phaseDone) {
        return { handled: true, phaseState };
    }

    const phaseKey = getEgyptianPhaseKey(phaseState.activePhaseId) || 'phase6';

    applyPhaseRatioOnPhaseEntry({ village, difficulty, phaseId: phaseKey, phaseState, log });
    updateReadinessScores(phaseState, village, threatContext);
    const constructionFilter = createThreatConstructionFilter(threatContext);
    const recruitmentFilter = createThreatRecruitmentFilter(village, threatContext);

    const storagePressure = Math.max(
        (village.resources?.wood?.current || 0) / Math.max(village.resources?.wood?.capacity || 1, 1),
        (village.resources?.stone?.current || 0) / Math.max(village.resources?.stone?.capacity || 1, 1),
        (village.resources?.iron?.current || 0) / Math.max(village.resources?.iron?.capacity || 1, 1),
        (village.resources?.food?.current || 0) / Math.max(village.resources?.food?.capacity || 1, 1),
    );
    phaseState.storagePressureHistory = [...phaseState.storagePressureHistory.slice(-9), { at: now, value: storagePressure }];
    if (storagePressure >= 0.9) {
        phaseState.kpiStoragePressureCriticalSamples = Math.max(0, phaseState.kpiStoragePressureCriticalSamples || 0) + 1;
    }

    const activeSubGoalResult = processActiveSubGoal({
        phaseState,
        village,
        gameState,
        actionExecutor,
        gameSpeed,
        log,
    });
    if (activeSubGoalResult.handled) {
        return { handled: true, phaseState };
    }

    const emergency = runThreatEmergencyBlock({
        actionExecutor,
        village,
        gameState,
        phaseState,
        phaseId: phaseState.activePhaseId,
        threatContext,
    });
    const emergencyHandling = handlePhaseActionResult({
        result: emergency,
        phaseState,
        phaseId: phaseState.activePhaseId,
        source: 'egyptian_threat_emergency_recruitment',
        village,
        gameSpeed,
        log,
        onSuccess: successResult => registerRecruitmentCommitFromAction({
            result: successResult,
            phaseState,
            phaseId: phaseState.activePhaseId,
            village,
            difficulty,
            log,
        }),
    });
    if (emergency.success) {
        phaseState.kpiEmergencyRecruitmentCycles = Math.max(0, phaseState.kpiEmergencyRecruitmentCycles || 0) + 1;
    }
    if (emergencyHandling.terminal) {
        return { handled: true, phaseState };
    }

    let result = { success: false, reason: 'NO_ACTION' };

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase1) {
        if (evaluatePhaseOneExit(village, phaseState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase1, EGYPTIAN_PHASE_IDS.phase2, now, 'PHASE_1_EXIT_CRITERIA_MET', log, village, difficulty);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase1) {
            result = runPhaseOne({ village, gameState, actionExecutor, phaseState, threatContext, constructionFilter, recruitmentFilter });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase2) {
        updatePhaseTwoQueueTelemetry(phaseState, village);
        if (evaluatePhaseTwoExit(village, phaseState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase2, EGYPTIAN_PHASE_IDS.phase3, now, 'PHASE_2_EXIT_CRITERIA_MET', log, village, difficulty);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase2) {
            result = runPhaseTwo({ village, gameState, actionExecutor, phaseState, threatContext, constructionFilter, recruitmentFilter });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase3) {
        updatePhaseThreeQueueTelemetry(phaseState, village);
        if (evaluatePhaseThreeExit(village, phaseState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase3, EGYPTIAN_PHASE_IDS.phase4, now, 'PHASE_3_EXIT_CRITERIA_MET', log, village, difficulty);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase3) {
            result = runPhaseThree({ village, gameState, actionExecutor, phaseState, constructionFilter, recruitmentFilter });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase4) {
        if (evaluatePhaseFourExit(village, phaseState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase4, EGYPTIAN_PHASE_IDS.phase5, now, 'PHASE_4_EXIT_CRITERIA_MET', log, village, difficulty);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase4) {
            result = runPhaseFour({ village, gameState, actionExecutor, phaseState, constructionFilter, recruitmentFilter });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase5) {
        if (evaluatePhaseFiveExit(village, gameState, phaseState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase5, EGYPTIAN_PHASE_IDS.phase6, now, 'PHASE_5_EXIT_CRITERIA_MET', log, village, difficulty);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase5) {
            result = runPhaseFive({
                village,
                gameState,
                actionExecutor,
                phaseState,
                now,
                threatContext,
                constructionFilter,
                recruitmentFilter,
            });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase6) {
        if (evaluatePhaseSixExit(village, gameState, phaseState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase6, EGYPTIAN_PHASE_IDS.phaseDone, now, 'PHASE_6_EXIT_CRITERIA_MET', log, village, difficulty);
            return { handled: true, phaseState };
        }
        result = runPhaseSix({
            village,
            gameState,
            actionExecutor,
            phaseState,
            now,
            threatContext,
            constructionFilter,
            recruitmentFilter,
        });
    }

    const actionHandling = handlePhaseActionResult({
        result,
        phaseState,
        phaseId: phaseState.activePhaseId,
        source: `egyptian_${phaseState.activePhaseId}_action`,
        village,
        gameSpeed,
        log,
        onSuccess: successResult => registerRecruitmentCommitFromAction({
            result: successResult,
            phaseState,
            phaseId: phaseState.activePhaseId,
            village,
            difficulty,
            log,
        }),
    });
    if (actionHandling.terminal) {
        return { handled: true, phaseState };
    }

    if (!result.success && !shouldThrottleIdleLog(phaseState, now)) {
        setIdleLogMark(phaseState, now);
        log('info', village, 'Macro Egipcia', 'Sin accion macro en este ciclo; esperando presupuesto, cola libre o prerequisitos.', null, 'economic');
    }

    return { handled: true, phaseState };
}
