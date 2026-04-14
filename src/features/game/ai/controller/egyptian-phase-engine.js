import { getRaceTroops } from '../../core/data/lookups.js';
import { BUDGET_RATIO_REBALANCE_INTERVAL_MS } from '../../core/data/constants.js';
import { rebalanceVillageBudgetToRatio } from '../../state/worker/budget.js';
import { resolveUnitIdForRace } from '../utils/AIUnitUtils.js';
import {
    buildPrerequisiteResolverStepFromBlock,
    clonePhaseStep,
    createPhaseTransition,
    getAverageResourceFieldLevel,
    getCompletedTrainingCycles,
    getPhaseStepSignature,
    createOrRefreshPhaseSubGoal,
    isPhaseQueueAvailable,
    isPhaseResearchStepCompleted,
    getQueuedTrainingMs,
    handleCommonPhaseActionResult,
    getBuildingTypeLevel,
    getDifficultyTemplate,
    getEffectiveBuildingTypeLevel,
    getPhaseStepQueueType,
    getQueueUptime,
    getUnitCountInVillageAndQueue,
    isRecoverablePhaseBlockReason,
    normalizePhaseSubGoalKind,
    PHASE_SUBGOAL_CONFIG,
    PHASE_SUBGOAL_KIND,
    processPhaseActiveSubGoal,
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
        phase1: { ratio: { econ: 0.92, mil: 0.08 } },
        phase2: { ratio: { econ: 0.8, mil: 0.2 } },
        phase3: { ratio: { econ: 0.72, mil: 0.28 } },
        phase4: { ratio: { econ: 0.64, mil: 0.36 } },
        phase5: { ratio: { econ: 0.6, mil: 0.4 } },
        phase6: { ratio: { econ: 0.54, mil: 0.46 } },
    },
    Dificil: {
        phase1: { ratio: { econ: 0.88, mil: 0.12 } },
        phase2: { ratio: { econ: 0.74, mil: 0.26 } },
        phase3: { ratio: { econ: 0.64, mil: 0.36 } },
        phase4: { ratio: { econ: 0.56, mil: 0.44 } },
        phase5: { ratio: { econ: 0.52, mil: 0.48 } },
        phase6: { ratio: { econ: 0.46, mil: 0.54 } },
    },
    Pesadilla: {
        phase1: { ratio: { econ: 0.84, mil: 0.16 } },
        phase2: { ratio: { econ: 0.68, mil: 0.32 } },
        phase3: { ratio: { econ: 0.56, mil: 0.44 } },
        phase4: { ratio: { econ: 0.48, mil: 0.52 } },
        phase5: { ratio: { econ: 0.45, mil: 0.55 } },
        phase6: { ratio: { econ: 0.4, mil: 0.6 } },
    },
});

const PHASE_ONE_EXIT = Object.freeze({
    minAverageResourceFieldLevel: 4,
    minWarehouseLevel: 6,
    minGranaryLevel: 6,
    minMainBuildingLevel: 5,
    minDefensiveUnitsWhenHostile: 20,
    minWallWhenHostile: 2,
});

const PHASE_TWO_EXIT = Object.freeze({
    minBarracksLevel: 1,
    minWallLevel: 5,
    militaryQueueUptimeTarget: 0.35,
    minSamples: 8,
});

const PHASE_THREE_EXIT = Object.freeze({
    minAverageResourceFieldLevel: 7,
    minWallLevel: 8,
    minAcademyLevel: 4,
    minSmithyLevel: 4,
    minDefensiveCoreUnits: 70,
    minScouts: 8,
    militaryQueueUptimeTarget: 0.4,
    minSamples: 10,
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

const RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG = Object.freeze({
    phase1: 2,
    phase2: 3,
    phase3: 4,
    phase4: 4,
    phase5: 4,
    phase6: 5,
});

const PHASE_CYCLE_TARGETS_BY_DIFFICULTY = Object.freeze({
    Normal: {
        phase1: { total: 12 },
        phase2: { total: 20 },
        phase3: { total: 30 },
        phase4: { total: 40 },
        phase5: { total: 52 },
        phase6: { total: 64 },
    },
    Dificil: {
        phase1: { total: 16 },
        phase2: { total: 26 },
        phase3: { total: 38 },
        phase4: { total: 50 },
        phase5: { total: 64 },
        phase6: { total: 78 },
    },
    Pesadilla: {
        phase1: { total: 20 },
        phase2: { total: 32 },
        phase3: { total: 46 },
        phase4: { total: 60 },
        phase5: { total: 76 },
        phase6: { total: 92 },
    },
});

const DEFERRED_SUBGOAL_BLOCK_REASONS = new Set([
    'PREREQUISITES_NOT_MET',
    'RESEARCH_REQUIRED',
    'EXPANSION_BUILDING_LOW_LEVEL',
    'EXPANSION_SLOTS_FULL',
]);

const THREAT_MEDIUM_ALLOWED_CONSTRUCTION_TYPES = new Set([
    'warehouse',
    'granary',
    'mainBuilding',
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
    'cityWall',
    'rallyPoint',
    'barracks',
    'academy',
    'smithy',
    'stable',
]);

const THREAT_LEVEL_BOOST = Object.freeze({
    none: 0,
    low: 0,
    medium: 0.06,
    high: 0.14,
    critical: 0.22,
});

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
    };
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

function getPhaseCycleTargets(difficulty, phaseKey) {
    const template = getDifficultyTemplate(PHASE_CYCLE_TARGETS_BY_DIFFICULTY, difficulty, 'Pesadilla') || {};
    return template[phaseKey] || { total: 0 };
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
    };
}

export function getEgyptianPhaseCycleStatus(phaseState, difficulty, phaseKey) {
    const cycles = getCycleProgressSnapshot(phaseState, phaseKey);
    const targets = getPhaseCycleTargets(difficulty, phaseKey);
    return {
        completed: cycles.total || 0,
        max: Math.max(0, Number(targets.total) || 0),
        cycles,
        targets,
    };
}

function recordEgyptianPhaseRecruitmentProgress({ phaseState, phaseKey, count, timePerUnit }) {
    if (!phaseKey) return;
    if (!Number.isFinite(count) || count <= 0) return;
    if (!Number.isFinite(timePerUnit) || timePerUnit <= 0) return;

    const progress = getCycleProgressByPhase(phaseState, phaseKey);
    const trainedMs = getQueuedTrainingMs(count, timePerUnit);
    if (trainedMs <= 0) return;
    progress.totalMs = Math.max(0, Number(progress.totalMs) || 0) + trainedMs;
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

function attachDeferredRecoverableBlock(successResult, blockedResult) {
    if (!successResult?.success) return successResult;
    if (!blockedResult || !isRecoverablePhaseBlockReason(blockedResult.reason)) return successResult;
    if (!DEFERRED_SUBGOAL_BLOCK_REASONS.has(blockedResult.reason)) return successResult;

    return {
        ...successResult,
        deferredRecoverableBlock: blockedResult,
    };
}

function mergeConstructionAndRecruitmentResult(construction, recruitment) {
    if (recruitment?.success) {
        return attachDeferredRecoverableBlock(recruitment, construction);
    }

    if (construction && isRecoverablePhaseBlockReason(construction.reason)) {
        return construction;
    }

    return recruitment;
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
        waitResourcesMode: 'retry_after_interval',
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

function applyPhaseRatio({ village, difficulty, phaseId, threatContext, phaseState, log, now }) {
    const template = getDifficultyTemplate(PHASE_TEMPLATE_BY_DIFFICULTY, difficulty);
    const phaseConfig = template[phaseId] || template.phase6;
    const baseRatio = phaseConfig.ratio;
    const boost = THREAT_LEVEL_BOOST[threatContext.threatLevel] || 0;
    const mil = Math.min(0.85, baseRatio.mil + boost);
    const ratio = { econ: 1 - mil, mil };

    const rebalanceDue = !Number.isFinite(phaseState.lastBudgetRebalanceAt)
        || (now - phaseState.lastBudgetRebalanceAt) >= BUDGET_RATIO_REBALANCE_INTERVAL_MS;
    if (!rebalanceDue) return;

    rebalanceVillageBudgetToRatio(village, ratio);
    phaseState.lastBudgetRebalanceAt = now;

    log(
        'info',
        village,
        'Macro Egipcia',
        `Ratio presupuestario aplicado ${Math.round(ratio.econ * 100)}/${Math.round(ratio.mil * 100)} (threat=${threatContext.threatLevel}).`,
        null,
        'economic',
    );
}

function tryStep(actionExecutor, village, gameState, step) {
    return actionExecutor.executePlanStep(village, step, gameState, null);
}

function tryConstructionPriority({ actionExecutor, village, gameState, options, shouldAttemptStep = null }) {
    return runPriorityStepList({
        steps: options,
        executeStep: step => tryStep(actionExecutor, village, gameState, step),
        noActionReason: 'NO_ACTION',
        shouldAttemptStep,
    });
}

function tryRecruitmentPriority({ actionExecutor, village, gameState, options, shouldAttemptStep = null }) {
    return runPriorityStepList({
        steps: options,
        executeStep: step => tryStep(actionExecutor, village, gameState, step),
        noActionReason: 'NO_ACTION',
        shouldAttemptStep,
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

function transitionTo(phaseState, from, to, now, reason, log, village) {
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
    log('success', village, 'Macro Egipcia', `Transicion ${from} -> ${to}.`, { reason }, 'economic');
}

function runThreatEmergencyBlock({ actionExecutor, village, gameState, threatContext }) {
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
        options: [
            { type: 'units', unitType: 'defensive_infantry', count: Infinity, queueTargetMinutes: 4 },
            { type: 'units', unitType: 'defensive_cavalry', count: Infinity, queueTargetMinutes: 3 },
            { type: 'units', unitType: 'offensive_infantry', count: Infinity, queueTargetMinutes: 3 },
        ],
    });
}

function evaluatePhaseOneExit(village, threatContext) {
    const avgFields = getAverageResourceFieldLevel(village);
    const warehouse = getEffectiveBuildingLevel(village, 'warehouse');
    const granary = getEffectiveBuildingLevel(village, 'granary');
    const mainBuilding = getEffectiveBuildingLevel(village, 'mainBuilding');
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    const defenders = countRoleTroops(village, 'defensive');

    const hostile = threatContext.threatLevel === 'medium' || threatContext.threatLevel === 'high' || threatContext.threatLevel === 'critical';
    const safeThreatGate = !hostile
        || wall >= PHASE_ONE_EXIT.minWallWhenHostile
        || defenders >= PHASE_ONE_EXIT.minDefensiveUnitsWhenHostile;

    return avgFields >= PHASE_ONE_EXIT.minAverageResourceFieldLevel
        && warehouse >= PHASE_ONE_EXIT.minWarehouseLevel
        && granary >= PHASE_ONE_EXIT.minGranaryLevel
        && mainBuilding >= PHASE_ONE_EXIT.minMainBuildingLevel
        && safeThreatGate;
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

function getMinimumPhaseTwoDefensiveCore(village) {
    const population = Math.max(0, village.population?.current || 0);
    return Math.max(30, Math.ceil(population / 9));
}

function evaluatePhaseTwoExit(village) {
    const barracks = getEffectiveBuildingLevel(village, 'barracks');
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    const defensiveCore = countDefensiveCoreUnits(village);
    const minDefensiveCore = getMinimumPhaseTwoDefensiveCore(village);

    return barracks >= PHASE_TWO_EXIT.minBarracksLevel
        && wall >= PHASE_TWO_EXIT.minWallLevel
        && defensiveCore >= minDefensiveCore;
}

function evaluatePhaseTwoQueueExit(phaseState) {
    const samples = Math.max(phaseState.phase2MilitaryQueueSamples || 0, 0);
    const active = Math.max(phaseState.phase2MilitaryQueueActiveSamples || 0, 0);
    if (samples < PHASE_TWO_EXIT.minSamples) return false;
    return getQueueUptime(samples, active) >= PHASE_TWO_EXIT.militaryQueueUptimeTarget;
}

function evaluatePhaseThreeQueueExit(phaseState) {
    const samples = Math.max(phaseState.phase3DefensiveQueueSamples || 0, 0);
    const active = Math.max(phaseState.phase3DefensiveQueueActiveSamples || 0, 0);
    if (samples < PHASE_THREE_EXIT.minSamples) return false;
    return getQueueUptime(samples, active) >= PHASE_THREE_EXIT.militaryQueueUptimeTarget;
}

function evaluatePhaseThreeExit(village, phaseState) {
    const avgFields = getAverageResourceFieldLevel(village);
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    const academy = getEffectiveBuildingLevel(village, 'academy');
    const smithy = getEffectiveBuildingLevel(village, 'smithy');
    const defensiveCore = countDefensiveCoreUnits(village);
    const scouts = getScoutsCount(village);
    const queueReady = evaluatePhaseThreeQueueExit(phaseState);

    return avgFields >= PHASE_THREE_EXIT.minAverageResourceFieldLevel
        && wall >= PHASE_THREE_EXIT.minWallLevel
        && academy >= PHASE_THREE_EXIT.minAcademyLevel
        && smithy >= PHASE_THREE_EXIT.minSmithyLevel
        && defensiveCore >= PHASE_THREE_EXIT.minDefensiveCoreUnits
        && scouts >= PHASE_THREE_EXIT.minScouts
        && queueReady;
}

function evaluatePhaseFourExit(village, phaseState) {
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    const marketplace = getEffectiveBuildingLevel(village, 'marketplace');
    const stable = getEffectiveBuildingLevel(village, 'stable');
    const scouts = getScoutsCount(village);
    const latestPressure = phaseState.storagePressureHistory?.[phaseState.storagePressureHistory.length - 1]?.value || 0;

    return wall >= PHASE_FOUR_EXIT.minWallLevel
        && marketplace >= PHASE_FOUR_EXIT.minMarketplaceLevel
        && stable >= PHASE_FOUR_EXIT.minStableLevel
        && scouts >= PHASE_FOUR_EXIT.minScouts
        && latestPressure <= PHASE_FOUR_EXIT.maxStoragePressure
        && (phaseState.defenseReadinessScore || 0) >= PHASE_FOUR_EXIT.minDefenseReadinessScore
        && (phaseState.expansionReadinessScore || 0) >= PHASE_FOUR_EXIT.minExpansionReadinessScore;
}

function evaluatePhaseFiveExit(village, gameState) {
    const myVillageCount = gameState.villages.filter(candidate => candidate.ownerId === village.ownerId).length;
    if (myVillageCount >= PHASE_FIVE_EXIT.minVillagesAfterExpansion) return true;
    return gameState.movements.some(movement => movement.ownerId === village.ownerId && movement.type === 'settle');
}

function evaluatePhaseSixExit(village, gameState) {
    const avgFields = getAverageResourceFieldLevel(village);
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    const defenders = countRoleTroops(village, 'defensive');
    const myVillageCount = gameState.villages.filter(candidate => candidate.ownerId === village.ownerId).length;
    return myVillageCount >= 3 && avgFields >= 8 && wall >= 12 && defenders >= 140;
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

function runPhaseOne({ village, gameState, actionExecutor, threatContext, constructionFilter, recruitmentFilter }) {
    if (isHighThreat(threatContext)) {
        const emergencyWall = tryConstructionPriority({
            actionExecutor,
            village,
            gameState,
            shouldAttemptStep: constructionFilter,
            options: [
                { type: 'building', buildingType: 'cityWall', level: 4 },
                { type: 'building', buildingType: 'warehouse', level: 8 },
                { type: 'building', buildingType: 'granary', level: 8 },
            ],
        });
        if (emergencyWall.success) return emergencyWall;
    }

    const construction = tryConstructionPriority({
        actionExecutor,
        village,
        gameState,
        shouldAttemptStep: constructionFilter,
        options: [
            { type: 'resource_fields_level', level: 4 },
            { type: 'building', buildingType: 'warehouse', level: 6 },
            { type: 'building', buildingType: 'granary', level: 6 },
            { type: 'building', buildingType: 'mainBuilding', level: 5 },
        ],
    });
    if (construction.success) return construction;

    if (threatContext.threatLevel === 'medium') {
        const mediumThreatWall = tryConstructionPriority({
            actionExecutor,
            village,
            gameState,
            shouldAttemptStep: constructionFilter,
            options: [{ type: 'building', buildingType: 'cityWall', level: 3 }],
        });
        if (mediumThreatWall.success) return mediumThreatWall;
    }

    const shouldRecruitMinimumDefense = threatContext.threatLevel === 'medium'
        || threatContext.threatLevel === 'high'
        || threatContext.threatLevel === 'critical'
        || threatContext.shouldBoostEmergencyRecruitment;

    if (!shouldRecruitMinimumDefense) {
        return { success: false, reason: 'NO_ACTION' };
    }

    const recruitment = tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        shouldAttemptStep: recruitmentFilter,
        options: [
            { type: 'units', unitType: 'defensive_infantry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase1 },
            { type: 'units', unitType: 'defensive_cavalry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase1 },
        ],
    });

    return mergeConstructionAndRecruitmentResult(construction, recruitment);
}

function runPhaseTwo({ village, gameState, actionExecutor, threatContext, constructionFilter, recruitmentFilter }) {
    const construction = tryConstructionPriority({
        actionExecutor,
        village,
        gameState,
        shouldAttemptStep: constructionFilter,
        options: [
            { type: 'building', buildingType: 'rallyPoint', level: 2 },
            { type: 'building', buildingType: 'barracks', level: 3 },
            { type: 'building', buildingType: 'academy', level: 2 },
            { type: 'building', buildingType: 'smithy', level: 2 },
            { type: 'building', buildingType: 'cityWall', level: 5 },
            { type: 'resource_fields_level', level: 5 },
        ],
    });
    if (construction.success) return construction;

    const recruitment = tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        shouldAttemptStep: recruitmentFilter,
        options: [
            { type: 'units', unitType: 'defensive_infantry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase2 },
            { type: 'units', unitType: 'defensive_cavalry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase2 },
            { type: 'units', unitType: 'scout', count: 8 },
        ],
    });
    const mergedRecruitment = mergeConstructionAndRecruitmentResult(construction, recruitment);
    if (mergedRecruitment.success) {
        return mergedRecruitment;
    }

    if (isHighThreat(threatContext)) {
        return tryConstructionPriority({
            actionExecutor,
            village,
            gameState,
            shouldAttemptStep: constructionFilter,
            options: [{ type: 'building', buildingType: 'cityWall', level: 7 }],
        });
    }

    return mergeConstructionAndRecruitmentResult(construction, recruitment);
}

function runPhaseThree({ village, gameState, actionExecutor, constructionFilter, recruitmentFilter }) {
    const construction = tryConstructionPriority({
        actionExecutor,
        village,
        gameState,
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
    });
    if (construction.success) return construction;

    const recruitment = tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        shouldAttemptStep: recruitmentFilter,
        options: [
            { type: 'units', unitType: 'defensive_infantry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase3 },
            { type: 'units', unitType: 'scout', count: 12 },
            { type: 'units', unitType: 'defensive_cavalry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase3 },
            { type: 'units', unitType: 'offensive_infantry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase3 },
        ],
    });

    return mergeConstructionAndRecruitmentResult(construction, recruitment);
}

function runPhaseFour({ village, gameState, actionExecutor, constructionFilter, recruitmentFilter }) {
    const construction = tryConstructionPriority({
        actionExecutor,
        village,
        gameState,
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
    });
    if (construction.success) return construction;

    const recruitment = tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        shouldAttemptStep: recruitmentFilter,
        options: [
            { type: 'units', unitType: 'defensive_infantry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase4 },
            { type: 'units', unitType: 'defensive_cavalry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase4 },
            { type: 'units', unitType: 'scout', count: 16 },
            { type: 'units', unitType: 'offensive_infantry', count: 40 },
        ],
    });

    return mergeConstructionAndRecruitmentResult(construction, recruitment);
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
    const construction = tryConstructionPriority({
        actionExecutor,
        village,
        gameState,
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
    });
    if (construction.success) return construction;

    const recruitmentOptions = [
        { type: 'units', unitType: 'defensive_infantry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase5 },
        { type: 'units', unitType: 'defensive_cavalry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase5 },
    ];

    if (shouldPreferConquestExpansion({ phaseState, threatContext, gameState, village })) {
        recruitmentOptions.push({ type: 'units', unitType: 'chief', count: 1 });
        recruitmentOptions.push({ type: 'units', unitType: 'settler', count: 3 });
    } else {
        recruitmentOptions.push({ type: 'units', unitType: 'settler', count: 3 });
        recruitmentOptions.push({ type: 'units', unitType: 'chief', count: 1 });
    }

    if (shouldEnableContextualOffense({ phaseState, threatContext, gameState, village })) {
        recruitmentOptions.push(
            { type: 'units', unitType: 'chief', count: 1 },
            { type: 'units', unitType: 'offensive_cavalry', count: 20 },
        );
    }

    if (shouldEnableContextualSiege({ phaseState, threatContext, gameState, village })) {
        recruitmentOptions.push(
            { type: 'units', unitType: 'ram', count: 6 },
            { type: 'units', unitType: 'catapult', count: 3 },
        );
    }

    const recruitment = tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        shouldAttemptStep: recruitmentFilter,
        options: recruitmentOptions,
    });
    const mergedRecruitment = mergeConstructionAndRecruitmentResult(construction, recruitment);
    if (mergedRecruitment.success) {
        return mergedRecruitment;
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

    return isRecoverablePhaseBlockReason(mergedRecruitment?.reason)
        ? mergedRecruitment
        : { success: false, reason: 'NO_ACTION' };
}

function runPhaseSix({ village, gameState, actionExecutor, phaseState, now, threatContext, constructionFilter, recruitmentFilter }) {
    const construction = tryConstructionPriority({
        actionExecutor,
        village,
        gameState,
        shouldAttemptStep: constructionFilter,
        options: [
            { type: 'building', buildingType: 'cityWall', level: 15 },
            { type: 'building', buildingType: 'smithy', level: 8 },
            { type: 'building', buildingType: 'workshop', level: 6 },
            { type: 'resource_fields_level', level: 9 },
        ],
    });
    if (construction.success) return construction;

    const recruitment = tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        shouldAttemptStep: recruitmentFilter,
        options: [
            { type: 'units', unitType: 'defensive_infantry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase6 },
            { type: 'units', unitType: 'defensive_cavalry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase6 },
            { type: 'units', unitType: 'offensive_cavalry', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase6 },
            { type: 'units', unitType: 'ram', count: Infinity, queueTargetMinutes: 2 },
            { type: 'units', unitType: 'catapult', count: Infinity, queueTargetMinutes: 2 },
        ],
    });
    const mergedRecruitment = mergeConstructionAndRecruitmentResult(construction, recruitment);
    if (mergedRecruitment.success) {
        return mergedRecruitment;
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

    return isRecoverablePhaseBlockReason(mergedRecruitment?.reason)
        ? mergedRecruitment
        : { success: false, reason: 'NO_ACTION' };
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
        lastBudgetRebalanceAt: 0,
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
        lastBudgetRebalanceAt: Number.isFinite(rawState.lastBudgetRebalanceAt) ? rawState.lastBudgetRebalanceAt : 0,
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
            lastBudgetRebalanceAt: state.lastBudgetRebalanceAt,
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

    applyPhaseRatio({ village, difficulty, phaseId: phaseKey, threatContext, phaseState, log, now });
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

    const emergency = runThreatEmergencyBlock({ actionExecutor, village, gameState, threatContext });
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
        if (evaluatePhaseOneExit(village, threatContext)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase1, EGYPTIAN_PHASE_IDS.phase2, now, 'PHASE_1_EXIT_CRITERIA_MET', log, village);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase1) {
            result = runPhaseOne({ village, gameState, actionExecutor, threatContext, constructionFilter, recruitmentFilter });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase2) {
        updatePhaseTwoQueueTelemetry(phaseState, village);
        if (evaluatePhaseTwoExit(village) && evaluatePhaseTwoQueueExit(phaseState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase2, EGYPTIAN_PHASE_IDS.phase3, now, 'PHASE_2_EXIT_CRITERIA_MET', log, village);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase2) {
            result = runPhaseTwo({ village, gameState, actionExecutor, threatContext, constructionFilter, recruitmentFilter });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase3) {
        updatePhaseThreeQueueTelemetry(phaseState, village);
        if (evaluatePhaseThreeExit(village, phaseState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase3, EGYPTIAN_PHASE_IDS.phase4, now, 'PHASE_3_EXIT_CRITERIA_MET', log, village);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase3) {
            result = runPhaseThree({ village, gameState, actionExecutor, constructionFilter, recruitmentFilter });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase4) {
        if (evaluatePhaseFourExit(village, phaseState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase4, EGYPTIAN_PHASE_IDS.phase5, now, 'PHASE_4_EXIT_CRITERIA_MET', log, village);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase4) {
            result = runPhaseFour({ village, gameState, actionExecutor, constructionFilter, recruitmentFilter });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase5) {
        if (evaluatePhaseFiveExit(village, gameState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase5, EGYPTIAN_PHASE_IDS.phase6, now, 'PHASE_5_EXIT_CRITERIA_MET', log, village);
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
        if (evaluatePhaseSixExit(village, gameState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase6, EGYPTIAN_PHASE_IDS.phaseDone, now, 'PHASE_6_EXIT_CRITERIA_MET', log, village);
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

    if (result.success && result.deferredRecoverableBlock) {
        createOrRefreshSubGoal({
            phaseState,
            phaseId: phaseState.activePhaseId,
            blockedResult: result.deferredRecoverableBlock,
            source: `egyptian_${phaseState.activePhaseId}_deferred_block`,
            village,
            gameSpeed,
            log,
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
