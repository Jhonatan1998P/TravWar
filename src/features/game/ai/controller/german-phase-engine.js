import { RESOURCE_FIELD_BUILDING_TYPES } from '../../core/data/constants.js';
import { getBuildingLevelData, getRaceTroops } from '../../core/data/lookups.js';
import { rebalanceVillageBudgetToRatio } from '../../state/worker/budget.js';
import { countCombatTroopsInVillages } from '../utils/AITroopUtils.js';
import {
    buildPrerequisiteResolverStepFromBlock,
    clonePhaseStep,
    createSharedPhaseOneCycleTargets,
    createSharedPhaseTwoCycleTargets,
    evaluateSharedPhaseOneInfrastructure,
    evaluateSharedPhaseTwoInfrastructure,
    createOrRefreshPhaseSubGoal,
    getCompletedTrainingCycles,
    getPhaseStepSignature,
    getQueuedTrainingMs,
    getConstructionMicroStepsForVillage,
    getRecruitmentMicroStepsByPriority,
    getSharedPhaseOneConstructionSteps,
    getSharedPhaseTwoConstructionSteps,
    handleCommonPhaseActionResult,
    isPhaseQueueAvailable,
    isPhaseResearchStepCompleted,
    getPhaseStepQueueType,
    isRecoverablePhaseBlockReason,
    normalizePhaseSubGoalKind,
    PHASE_SUBGOAL_CONFIG,
    PHASE_SUBGOAL_KIND,
    processPhaseActiveSubGoal,
    pickPhaseLaneResult,
    runPhaseLaneMatrix,
    runPriorityStepList,
    SHARED_PHASE_ONE_INFRASTRUCTURE_TARGETS,
    SHARED_PHASE_TWO_INFRASTRUCTURE_TARGETS,
    TRAINING_CYCLE_MS,
} from './phase-engine-common.js';

export const GERMAN_PHASE_IDS = Object.freeze({
    phase1: 'german_phase_1_economic_bootstrap',
    phase2: 'german_phase_2_basic_military_unlock',
    phase3: 'german_phase_3_sustained_mixed_production',
    phase4: 'german_phase_4_military_pressure_tech',
    phase5: 'german_phase_5_siege_expansion',
    phaseDone: 'german_phase_template_complete',
});

const HOSTILE_MOVEMENT_TYPES = new Set(['attack', 'raid']);
const FLOAT_EPSILON = 0.0001;

const PHASE_TEMPLATE_BY_DIFFICULTY = Object.freeze({
    Normal: {
        phase1: {
            ratio: { econ: 0.9, mil: 0.1 },
        },
        phase2: {
            ratio: { econ: 0.78, mil: 0.22 },
            recruitTargets: { offensiveInfantry: 90, scouts: 12 },
        },
        phase3: {
            ratio: { econ: 0.65, mil: 0.35 },
            armyBaseTarget: { offensiveInfantry: 300, scouts: 28 },
        },
        phase4: {
            ratio: { econ: 0.55, mil: 0.45 },
            recruitTargets: { offensiveInfantry: 520, offensiveCavalry: 55, scouts: 42 },
        },
        phase5: {
            ratio: { econ: 0.5, mil: 0.5 },
            recruitTargets: {
                offensiveInfantry: 900,
                offensiveCavalry: 130,
                siegeRams: 20,
                siegeCatapults: 8,
                scouts: 70,
                settlers: 3,
                chiefs: 0,
            },
        },
    },
    Dificil: {
        phase1: {
            ratio: { econ: 0.85, mil: 0.15 },
        },
        phase2: {
            ratio: { econ: 0.7, mil: 0.3 },
            recruitTargets: { offensiveInfantry: 125, scouts: 16 },
        },
        phase3: {
            ratio: { econ: 0.58, mil: 0.42 },
            armyBaseTarget: { offensiveInfantry: 400, scouts: 36 },
        },
        phase4: {
            ratio: { econ: 0.45, mil: 0.55 },
            recruitTargets: { offensiveInfantry: 680, offensiveCavalry: 80, scouts: 52 },
        },
        phase5: {
            ratio: { econ: 0.4, mil: 0.6 },
            recruitTargets: {
                offensiveInfantry: 1200,
                offensiveCavalry: 190,
                siegeRams: 32,
                siegeCatapults: 14,
                scouts: 95,
                settlers: 3,
                chiefs: 1,
            },
        },
    },
    Pesadilla: {
        phase1: {
            ratio: { econ: 0.8, mil: 0.2 },
        },
        phase2: {
            ratio: { econ: 0.65, mil: 0.35 },
            recruitTargets: { offensiveInfantry: 160, scouts: 20 },
        },
        phase3: {
            ratio: { econ: 0.5, mil: 0.5 },
            armyBaseTarget: { offensiveInfantry: 520, scouts: 44 },
        },
        phase4: {
            ratio: { econ: 0.35, mil: 0.65 },
            recruitTargets: { offensiveInfantry: 900, offensiveCavalry: 120, scouts: 64 },
        },
        phase5: {
            ratio: { econ: 0.3, mil: 0.7 },
            recruitTargets: {
                offensiveInfantry: 1600,
                offensiveCavalry: 280,
                siegeRams: 50,
                siegeCatapults: 24,
                scouts: 130,
                settlers: 3,
                chiefs: 1,
            },
        },
    },
});

const PHASE_ONE_EXIT_CONDITIONS = SHARED_PHASE_ONE_INFRASTRUCTURE_TARGETS;

const PHASE_ONE_PRIORITY = Object.freeze({
    mainBuildingTargetLevel: 5,
    emergencyDefenseTargetTroops: 40,
    defenseLookaheadMs: 180_000,
    minIdleLogIntervalMs: 20_000,
});

const PHASE_TWO_EXIT_CONDITIONS = SHARED_PHASE_TWO_INFRASTRUCTURE_TARGETS;

const PHASE_TWO_PRIORITY = Object.freeze({
    barracksTargetLevel: PHASE_TWO_EXIT_CONDITIONS.buildingLevels.barracks,
    resourceFieldsTargetLevel: PHASE_TWO_EXIT_CONDITIONS.resourceFieldsLevel,
    minIdleLogIntervalMs: 20_000,
});

const PHASE_THREE_EXIT = Object.freeze({
    minAverageResourceFieldLevel: 7,
});

const PHASE_THREE_PRIORITY = Object.freeze({
    smithyTargetLevel: 5,
    barracksTargetLevel: 8,
    academyTargetLevel: 5,
    resourceFieldsTargetLevel: 7,
    minIdleLogIntervalMs: 20_000,
});

const PHASE_FOUR_PRIORITY = Object.freeze({
    rallyPointTargetLevel: 5,
    stableTargetLevel: 5,
    workshopTargetLevel: 3,
    smithyTargetLevel: 8,
    barracksTargetLevel: 12,
    resourceFieldsTargetLevel: 8,
    storagePressureThreshold: 0.92,
    minIdleLogIntervalMs: 20_000,
});

const PHASE_FIVE_PRIORITY = Object.freeze({
    academyTargetLevel: 15,
    workshopTargetLevel: 10,
    smithyTargetLevel: 10,
    barracksTargetLevel: 15,
    stableTargetLevel: 10,
    marketplaceTargetLevel: 10,
    embassyTargetLevel: 1,
    palaceTargetLevel: 10,
    resourceFieldsTargetLevel: 9,
    storagePressureThreshold: 0.9,
    minIdleLogIntervalMs: 20_000,
});

const PHASE_SUBGOAL = Object.freeze({
    ...PHASE_SUBGOAL_CONFIG,
    baseRetryMs: 45_000,
    maxHistory: 24,
    logThrottleMs: 15_000,
    maxAttemptsBeforeReset: 16,
});

const PHASE_CYCLE_TARGETS_BY_DIFFICULTY = Object.freeze({
    Normal: {
        phase1: createSharedPhaseOneCycleTargets('offensiveInfantry', 10, 3),
        phase1Emergency: { defensiveInfantry: 3, total: 3 },
        phase2: createSharedPhaseTwoCycleTargets('offensiveInfantry', 'offensiveCavalry', 20, 5, 3),
        phase3: { total: 5, offensiveInfantry: 3, scout: 2 },
        phase4: { total: 5, offensiveInfantry: 2, offensiveCavalry: 2, scout: 1 },
        phase5: { total: 8, offensiveInfantry: 3, offensiveCavalry: 2, ram: 1, catapult: 1, scout: 1, expansion: 2 },
    },
    Dificil: {
        phase1: createSharedPhaseOneCycleTargets('offensiveInfantry', 10, 3),
        phase1Emergency: { defensiveInfantry: 4, total: 4 },
        phase2: createSharedPhaseTwoCycleTargets('offensiveInfantry', 'offensiveCavalry', 20, 5, 3),
        phase3: { total: 5, offensiveInfantry: 3, scout: 2 },
        phase4: { total: 5, offensiveInfantry: 2, offensiveCavalry: 2, scout: 1 },
        phase5: { total: 8, offensiveInfantry: 3, offensiveCavalry: 2, ram: 1, catapult: 1, scout: 1, expansion: 2 },
    },
    Pesadilla: {
        phase1: createSharedPhaseOneCycleTargets('offensiveInfantry', 10, 3),
        phase1Emergency: { defensiveInfantry: 5, total: 5 },
        phase2: createSharedPhaseTwoCycleTargets('offensiveInfantry', 'offensiveCavalry', 20, 5, 3),
        phase3: { total: 5, offensiveInfantry: 3, scout: 2 },
        phase4: { total: 5, offensiveInfantry: 2, offensiveCavalry: 2, scout: 1 },
        phase5: { total: 8, offensiveInfantry: 3, offensiveCavalry: 2, ram: 1, catapult: 1, scout: 1, expansion: 2 },
    },
});

const SUBGOAL_KIND = PHASE_SUBGOAL_KIND;

const MILITARY_CONSTRUCTION_TYPES = new Set([
    'rallyPoint',
    'barracks',
    'academy',
    'smithy',
    'stable',
    'workshop',
]);

const THREAT_OVERRIDE_LOG_THROTTLE_MS = 20_000;
const RESILIENCE_CONSTRUCTION_TYPES = new Set(['cityWall', 'warehouse', 'granary', 'mainBuilding', 'rallyPoint', 'barracks', 'academy', 'smithy', 'stable', 'workshop']);
const MEDIUM_ALLOWED_NON_MILITARY_TYPES = new Set(['warehouse', 'granary', 'mainBuilding']);
const HIGH_ALLOWED_NON_MILITARY_TYPES = new Set(['warehouse', 'granary', 'cityWall', 'mainBuilding']);
const CRITICAL_ALLOWED_NON_MILITARY_TYPES = new Set(['warehouse', 'granary', 'cityWall']);

function getDifficultyTemplate(difficulty) {
    return PHASE_TEMPLATE_BY_DIFFICULTY[difficulty] || PHASE_TEMPLATE_BY_DIFFICULTY.Pesadilla;
}

function getPhaseOneConfig(difficulty) {
    return getDifficultyTemplate(difficulty).phase1;
}

function getPhaseTwoConfig(difficulty) {
    return getDifficultyTemplate(difficulty).phase2;
}

function getPhaseThreeConfig(difficulty) {
    return getDifficultyTemplate(difficulty).phase3;
}

function getPhaseFourConfig(difficulty) {
    return getDifficultyTemplate(difficulty).phase4;
}

function getPhaseFiveConfig(difficulty) {
    return getDifficultyTemplate(difficulty).phase5;
}

function getCycleTargetsConfig(difficulty) {
    return PHASE_CYCLE_TARGETS_BY_DIFFICULTY[difficulty] || PHASE_CYCLE_TARGETS_BY_DIFFICULTY.Pesadilla;
}

function getCycleTargetForPhase(difficulty, phaseKey) {
    return getCycleTargetsConfig(difficulty)[phaseKey] || { total: 0 };
}

function createEmptyCycleProgress() {
    return {
        totalMs: 0,
        defensiveInfantryMs: 0,
        offensiveInfantryMs: 0,
        scoutMs: 0,
        offensiveCavalryMs: 0,
        ramMs: 0,
        catapultMs: 0,
        expansionMs: 0,
    };
}

function getPhaseBucketForUnitId(village, phaseKey, unitId) {
    const unit = getRaceTroops(village.race || 'germans').find(candidate => candidate.id === unitId);
    if (!unit) return null;

    if (phaseKey === 'phase1') {
        if (unit.type === 'infantry' && unit.role === 'offensive') return 'offensiveInfantryMs';
        if (unit.role === 'scout') return 'scoutMs';
        return null;
    }

    if (phaseKey === 'phase2') {
        if (unit.type === 'infantry' && unit.role === 'offensive') return 'offensiveInfantryMs';
        if (unit.type === 'cavalry' && unit.role === 'offensive') return 'offensiveCavalryMs';
        if (unit.role === 'scout') return 'scoutMs';
        return null;
    }

    if (phaseKey === 'phase3') {
        if (unit.type === 'infantry' && unit.role === 'offensive') return 'offensiveInfantryMs';
        if (unit.role === 'scout') return 'scoutMs';
        return null;
    }

    if (phaseKey === 'phase4') {
        if (unit.type === 'infantry' && unit.role === 'offensive') return 'offensiveInfantryMs';
        if (unit.type === 'cavalry' && unit.role === 'offensive') return 'offensiveCavalryMs';
        if (unit.role === 'scout') return 'scoutMs';
        return null;
    }

    if (phaseKey === 'phase5') {
        if (unit.type === 'infantry' && unit.role === 'offensive') return 'offensiveInfantryMs';
        if (unit.type === 'cavalry' && unit.role === 'offensive') return 'offensiveCavalryMs';
        if (unit.role === 'ram') return 'ramMs';
        if (unit.role === 'catapult') return 'catapultMs';
        if (unit.role === 'scout') return 'scoutMs';
        if (unit.type === 'settler' || unit.type === 'chief') return 'expansionMs';
    }

    return null;
}

export function recordGermanPhaseRecruitmentProgress({ phaseState, phaseKey, village, unitId, count, timePerUnit }) {
    const progress = getCycleProgressByPhase(phaseState, phaseKey);
    const bucket = getPhaseBucketForUnitId(village, phaseKey, unitId);
    const completedMs = getQueuedTrainingMs(count, timePerUnit);

    if (completedMs <= 0) return;

    progress.totalMs += completedMs;
    if (bucket) {
        progress[bucket] += completedMs;
    }
}

function msToCycles(ms) {
    return getCompletedTrainingCycles(ms, TRAINING_CYCLE_MS);
}

function getCycleProgressByPhase(phaseState, phaseKey) {
    if (!phaseState.phaseCycleProgress || typeof phaseState.phaseCycleProgress !== 'object') {
        phaseState.phaseCycleProgress = {};
    }

    if (!phaseState.phaseCycleProgress[phaseKey]) {
        phaseState.phaseCycleProgress[phaseKey] = createEmptyCycleProgress();
    }

    return phaseState.phaseCycleProgress[phaseKey];
}

function getCycleProgressSnapshot(phaseState, phaseKey) {
    const progress = getCycleProgressByPhase(phaseState, phaseKey);
    return {
        total: msToCycles(progress.totalMs),
        defensiveInfantry: msToCycles(progress.defensiveInfantryMs),
        offensiveInfantry: msToCycles(progress.offensiveInfantryMs),
        scout: msToCycles(progress.scoutMs),
        offensiveCavalry: msToCycles(progress.offensiveCavalryMs),
        ram: msToCycles(progress.ramMs),
        catapult: msToCycles(progress.catapultMs),
        expansion: msToCycles(progress.expansionMs),
    };
}

function evaluateCycleTargets(phaseState, difficulty, phaseKey) {
    const snapshot = getCycleProgressSnapshot(phaseState, phaseKey);
    const targets = getCycleTargetForPhase(difficulty, phaseKey);
    const ready = Object.entries(targets).every(([bucket, required]) => {
        if (!Number.isFinite(required) || required <= 0) return true;
        if (bucket === 'expansion') return true;
        return (snapshot[bucket] || 0) >= required;
    });
    return { ready, cycles: snapshot, targets };
}

export function getGermanPhaseCycleStatus(phaseState, difficulty, phaseKey) {
    const cycles = getCycleProgressSnapshot(phaseState, phaseKey);
    const targets = getCycleTargetForPhase(difficulty, phaseKey);
    return {
        completed: cycles.total || 0,
        max: targets.total || 0,
        cycles,
        targets,
    };
}

function resolveCycleBucketByUnit(village, unitId) {
    if (!unitId) return null;

    const unit = getRaceTroops(village.race || 'germans').find(candidate => candidate.id === unitId);
    if (!unit) return null;

    if (unit.type === 'infantry' && unit.role === 'defensive') return 'defensiveInfantryMs';
    if (unit.type === 'infantry' && unit.role === 'offensive') return 'offensiveInfantryMs';
    if (unit.role === 'scout') return 'scoutMs';
    if (unit.type === 'cavalry' && unit.role === 'offensive') return 'offensiveCavalryMs';
    if (unit.role === 'ram') return 'ramMs';
    if (unit.role === 'catapult') return 'catapultMs';
    if (unit.type === 'settler' || unit.type === 'chief') return 'expansionMs';
    return null;
}

function getActiveRecruitmentBuckets(village) {
    const earliestByBuilding = new Map();

    for (const job of village.recruitmentQueue || []) {
        if (!job?.buildingId || !job?.unitId) continue;
        const current = earliestByBuilding.get(job.buildingId);
        if (!current || (job.endTime || 0) < (current.endTime || 0)) {
            earliestByBuilding.set(job.buildingId, job);
        }
    }

    const activeBuckets = new Set();
    for (const job of earliestByBuilding.values()) {
        const bucket = resolveCycleBucketByUnit(village, job.unitId);
        if (bucket) activeBuckets.add(bucket);
    }

    return activeBuckets;
}

function estimateUnitsForCycles({ village, actionExecutor, unitType, cycles, gameSpeed }) {
    const resolvedCycles = Math.max(0, Math.floor(cycles || 0));
    if (resolvedCycles <= 0) return 0;

    const unitId = actionExecutor.resolveUnitId(unitType);
    if (!unitId) return 0;

    const unitData = getRaceTroops(village.race || 'germans').find(unit => unit.id === unitId);
    if (!unitData) return 0;

    const trainingBuildingType = actionExecutor.getTrainingBuildingForUnit(unitId);
    if (!trainingBuildingType) return 0;

    const trainingBuilding = village.buildings.find(building => building.type === trainingBuildingType);
    if (!trainingBuilding || trainingBuilding.level <= 0) return 0;

    const levelData = getBuildingLevelData(trainingBuilding.type, trainingBuilding.level);
    const timeFactor = levelData?.attribute?.trainingTimeFactor || 1;
    const normalizedSpeed = Math.max(gameSpeed || 1, 1);
    const singleUnitTimeMs = ((unitData.trainTime / timeFactor) / normalizedSpeed) * 1000;

    if (!Number.isFinite(singleUnitTimeMs) || singleUnitTimeMs <= 0) return 0;
    const cycleTimeMs = resolvedCycles * TRAINING_CYCLE_MS;
    return Math.max(1, Math.ceil(cycleTimeMs / singleUnitTimeMs));
}

function createTransition(fromPhaseId, toPhaseId, reason, at) {
    return {
        fromPhaseId,
        toPhaseId,
        reason,
        at,
    };
}

function getQueuedLevelsForBuilding(village, buildingId) {
    return village.constructionQueue.filter(job => job.buildingId === buildingId).length;
}

function getEffectiveBuildingLevel(village, building) {
    return (building.level || 0) + getQueuedLevelsForBuilding(village, building.id);
}

function getEffectiveBuildingTypeLevel(village, buildingType) {
    const buildings = village.buildings.filter(building => building.type === buildingType);
    if (buildings.length === 0) return 0;

    return Math.max(...buildings.map(building => getEffectiveBuildingLevel(village, building)));
}

function getResourceFieldStats(village) {
    const fields = village.buildings.filter(building => RESOURCE_FIELD_BUILDING_TYPES.includes(building.type));
    if (fields.length === 0) {
        return { average: 0, min: 0 };
    }

    const levels = fields.map(field => getEffectiveBuildingLevel(village, field));
    const total = levels.reduce((sum, level) => sum + level, 0);
    return {
        average: total / levels.length,
        min: Math.min(...levels),
    };
}

function evaluatePhaseOneExit(village, phaseState, difficulty) {
    const infraGate = evaluateSharedPhaseOneInfrastructure({
        village,
        getAverageResourceFieldLevel: candidateVillage => getResourceFieldStats(candidateVillage).average,
        getEffectiveBuildingLevel: getEffectiveBuildingTypeLevel,
        targets: PHASE_ONE_EXIT_CONDITIONS,
    });
    const cycleGate = evaluateCycleTargets(phaseState, difficulty, 'phase1');

    return {
        ready: infraGate.ready && cycleGate.ready,
        details: infraGate.details,
        cycles: cycleGate.cycles,
        cycleTargets: cycleGate.targets,
    };
}

function evaluatePhaseTwoExit(village, phaseState, difficulty) {
    const infraGate = evaluateSharedPhaseTwoInfrastructure({
        village,
        getAverageResourceFieldLevel: candidateVillage => getResourceFieldStats(candidateVillage).average,
        getEffectiveBuildingLevel: getEffectiveBuildingTypeLevel,
        targets: PHASE_TWO_EXIT_CONDITIONS,
    });
    const cycleGate = evaluateCycleTargets(phaseState, difficulty, 'phase2');
    const ready = infraGate.ready && cycleGate.ready;

    return {
        ready,
        details: infraGate.details,
        cycles: cycleGate.cycles,
        cycleTargets: cycleGate.targets,
    };
}

function hasPhaseFourStoragePressure(village) {
    const resourceKeys = ['wood', 'stone', 'iron', 'food'];
    return resourceKeys.some(resource => {
        const current = village.resources?.[resource]?.current || 0;
        const capacity = village.resources?.[resource]?.capacity || 0;
        if (capacity <= 0) return false;
        return (current / capacity) >= PHASE_FOUR_PRIORITY.storagePressureThreshold;
    });
}

function evaluatePhaseFourExit(village, phaseState, difficulty) {
    const cycleGate = evaluateCycleTargets(phaseState, difficulty, 'phase4');

    const ready = cycleGate.ready;

    return {
        ready,
        cycles: cycleGate.cycles,
        cycleTargets: cycleGate.targets,
    };
}

function getTotalUnitCountInVillageAndQueue(village, unitId) {
    const inVillage = village.unitsInVillage?.[unitId] || 0;
    const inQueue = (village.recruitmentQueue || [])
        .filter(job => job.unitId === unitId)
        .reduce((sum, job) => sum + (job.remainingCount ?? job.count ?? 0), 0);
    return inVillage + inQueue;
}

function getArmyBaseProgress(village, difficulty) {
    const phaseConfig = getPhaseThreeConfig(difficulty);
    const raceTroops = getRaceTroops(village.race || 'germans');

    const offensiveInfantryIds = raceTroops
        .filter(unit => unit.type === 'infantry' && unit.role === 'offensive')
        .map(unit => unit.id);
    const scoutIds = raceTroops
        .filter(unit => unit.role === 'scout')
        .map(unit => unit.id);

    const offensiveInfantry = offensiveInfantryIds.reduce(
        (sum, unitId) => sum + getTotalUnitCountInVillageAndQueue(village, unitId),
        0,
    );
    const scouts = scoutIds.reduce(
        (sum, unitId) => sum + getTotalUnitCountInVillageAndQueue(village, unitId),
        0,
    );

    const offensiveTarget = phaseConfig.armyBaseTarget.offensiveInfantry;
    const scoutsTarget = phaseConfig.armyBaseTarget.scouts;

    return {
        offensiveInfantry,
        scouts,
        offensiveTarget,
        scoutsTarget,
        ready: offensiveInfantry >= offensiveTarget && scouts >= scoutsTarget,
    };
}

function evaluatePhaseThreeExit(village, phaseState, difficulty) {
    const fieldStats = getResourceFieldStats(village);
    const cycleGate = evaluateCycleTargets(phaseState, difficulty, 'phase3');
    const ready = fieldStats.average >= PHASE_THREE_EXIT.minAverageResourceFieldLevel && cycleGate.ready;

    return {
        ready,
        fieldAverage: fieldStats.average,
        cycles: cycleGate.cycles,
        cycleTargets: cycleGate.targets,
    };
}

function hasPhaseFiveStoragePressure(village) {
    const resourceKeys = ['wood', 'stone', 'iron', 'food'];
    return resourceKeys.some(resource => {
        const current = village.resources?.[resource]?.current || 0;
        const capacity = village.resources?.[resource]?.capacity || 0;
        if (capacity <= 0) return false;
        return (current / capacity) >= PHASE_FIVE_PRIORITY.storagePressureThreshold;
    });
}

function getPhaseFiveArmyProgress(village, difficulty) {
    const phaseConfig = getPhaseFiveConfig(difficulty);
    const raceTroops = getRaceTroops(village.race || 'germans');

    const offensiveInfantryIds = raceTroops
        .filter(unit => unit.type === 'infantry' && unit.role === 'offensive')
        .map(unit => unit.id);
    const offensiveCavalryIds = raceTroops
        .filter(unit => unit.type === 'cavalry' && unit.role === 'offensive')
        .map(unit => unit.id);
    const ramIds = raceTroops
        .filter(unit => unit.role === 'ram')
        .map(unit => unit.id);
    const catapultIds = raceTroops
        .filter(unit => unit.role === 'catapult')
        .map(unit => unit.id);
    const scoutIds = raceTroops
        .filter(unit => unit.role === 'scout')
        .map(unit => unit.id);

    const offensiveInfantry = offensiveInfantryIds.reduce((sum, unitId) => sum + getTotalUnitCountInVillageAndQueue(village, unitId), 0);
    const offensiveCavalry = offensiveCavalryIds.reduce((sum, unitId) => sum + getTotalUnitCountInVillageAndQueue(village, unitId), 0);
    const siegeRams = ramIds.reduce((sum, unitId) => sum + getTotalUnitCountInVillageAndQueue(village, unitId), 0);
    const siegeCatapults = catapultIds.reduce((sum, unitId) => sum + getTotalUnitCountInVillageAndQueue(village, unitId), 0);
    const scouts = scoutIds.reduce((sum, unitId) => sum + getTotalUnitCountInVillageAndQueue(village, unitId), 0);

    const targets = phaseConfig.recruitTargets;
    const ready = offensiveInfantry >= targets.offensiveInfantry
        && offensiveCavalry >= targets.offensiveCavalry
        && siegeRams >= targets.siegeRams
        && siegeCatapults >= targets.siegeCatapults
        && scouts >= targets.scouts;

    return {
        offensiveInfantry,
        offensiveCavalry,
        siegeRams,
        siegeCatapults,
        scouts,
        targets,
        ready,
    };
}

function getPhaseFiveExpansionProgress(village, phaseState, difficulty) {
    const expansionTarget = getCycleTargetForPhase(difficulty, 'phase5').expansion || 0;
    const expansionCycles = getCycleProgressSnapshot(phaseState, 'phase5').expansion;
    const palaceLevel = getEffectiveBuildingTypeLevel(village, 'palace');
    const settlementsFounded = village.settlementsFounded || 0;

    const canTrainExpansion = palaceLevel >= PHASE_FIVE_PRIORITY.palaceTargetLevel;
    const cycleRequirementMet = expansionCycles >= expansionTarget;
    const expanded = settlementsFounded > 0;

    return {
        expansionCycles,
        expansionTarget,
        palaceLevel,
        settlementsFounded,
        canTrainExpansion,
        cycleRequirementMet,
        expanded,
        ready: expanded || (canTrainExpansion && cycleRequirementMet),
    };
}

function evaluatePhaseFiveExit(village, phaseState, difficulty) {
    const cycleGate = evaluateCycleTargets(phaseState, difficulty, 'phase5');
    const expansion = getPhaseFiveExpansionProgress(village, phaseState, difficulty);

    const dominanceReady = cycleGate.ready;

    const expansionReady = expansion.ready;

    return {
        ready: dominanceReady || expansionReady,
        dominanceReady,
        expansionReady,
        cycles: cycleGate.cycles,
        cycleTargets: cycleGate.targets,
        expansion,
    };
}

function getStepCostRequirement(village, step) {
    if (step.type === 'building') {
        const buildings = village.buildings.filter(building => building.type === step.buildingType);
        const candidateLevel = buildings.length > 0
            ? Math.min(...buildings.map(building => getEffectiveBuildingLevel(village, building))) + 1
            : 1;

        const levelData = getBuildingLevelData(step.buildingType, candidateLevel);
        if (!levelData?.cost) return null;
        return { ...levelData.cost };
    }

    if (step.type === 'resource_fields_level') {
        const fields = village.buildings
            .filter(building => RESOURCE_FIELD_BUILDING_TYPES.includes(building.type))
            .map(field => ({
                field,
                level: getEffectiveBuildingLevel(village, field),
            }))
            .sort((a, b) => a.level - b.level);

        const candidate = fields[0];
        if (!candidate) return {};
        const levelData = getBuildingLevelData(candidate.field.type, candidate.level + 1);
        if (!levelData?.cost) return null;
        return { ...levelData.cost };
    }

    return null;
}

function getStepCostEstimate(village, step) {
    const requirement = getStepCostRequirement(village, step);
    if (!requirement || typeof requirement !== 'object') return Number.POSITIVE_INFINITY;
    return Object.values(requirement).reduce((sum, value) => sum + (value || 0), 0);
}

function getUnitResourceRequirement(village, step) {
    const unitIdentifier = step?.unitId || step?.unitType;
    const unitData = getRaceTroops(village.race || 'germans').find(unit => unit.id === unitIdentifier);
    if (!unitData) return null;

    const requestedCount = step.type === 'units' && Number.isFinite(step.count) && step.count > 0
        ? Math.floor(step.count)
        : 1;
    const baseCost = step.type === 'research' && unitData.research?.cost
        ? unitData.research.cost
        : unitData.cost;
    if (!baseCost || typeof baseCost !== 'object') return null;

    return Object.fromEntries(
        Object.entries(baseCost).map(([resource, amount]) => [resource, Math.max(0, (amount || 0) * requestedCount)]),
    );
}

function hasAnyPositiveResource(pool) {
    return Object.values(pool || {}).some(value => Number(value) > 0);
}

function hasEstimatedResourcesForStep(village, step, subGoal = null) {
    if (!step) return true;

    const blockedNeededCost = subGoal?.latestDetails?.needed;
    if (blockedNeededCost && typeof blockedNeededCost === 'object') {
        const pool = getResourcePoolForStep(village, step);
        return hasResourcesForNeededCost(pool, blockedNeededCost);
    }

    if (step.type === 'building' || step.type === 'resource_fields_level') {
        const estimatedCost = getStepCostRequirement(village, step);
        if (!estimatedCost || typeof estimatedCost !== 'object') return false;
        const pool = getResourcePoolForKind(village, 'econ');
        return hasResourcesForNeededCost(pool, estimatedCost);
    }

    if (step.type === 'units' || step.type === 'research' || step.type === 'upgrade' || step.type === 'proportional_units') {
        const pool = getResourcePoolForStep(village, step);
        const requirement = getUnitResourceRequirement(village, step);
        if (requirement && typeof requirement === 'object') {
            return hasResourcesForNeededCost(pool, requirement);
        }
        return hasAnyPositiveResource(pool);
    }

    return true;
}

function cloneStep(step) {
    return clonePhaseStep(step);
}

function getStepSignature(step) {
    return getPhaseStepSignature(step);
}

function isRecoverableBlockReason(reason) {
    return isRecoverablePhaseBlockReason(reason);
}

function runStepList({
    steps,
    executeStep,
    noActionReason,
    shouldAttemptStep = null,
    stopOnRecoverableBlock = false,
    phaseState = null,
    phaseId = null,
    laneId = null,
}) {
    const normalizedSteps = Array.isArray(steps) ? steps.filter(Boolean) : [];
    const shouldUseRecruitmentPriority = String(laneId || '').includes('recruitment')
        && normalizedSteps.some(step => step?.type === 'units' || step?.type === 'proportional_units');
    const orderedSteps = shouldUseRecruitmentPriority
        ? getRecruitmentMicroStepsByPriority({ phaseState, phaseId, laneId, steps: normalizedSteps })
        : normalizedSteps;

    return runPriorityStepList({
        steps: orderedSteps,
        executeStep,
        noActionReason,
        shouldAttemptStep,
        stopOnRecoverableBlock,
    });
}

function runConstructionStepList({
    village,
    steps,
    executeStep,
    noActionReason,
    shouldAttemptStep = null,
    stopOnRecoverableBlock = false,
    phaseState = null,
    phaseId = null,
    laneId = null,
}) {
    const microSteps = getConstructionMicroStepsForVillage({
        village,
        steps,
        getEffectiveBuildingLevel: getEffectiveBuildingTypeLevel,
    });

    return runPriorityStepList({
        steps: microSteps,
        executeStep,
        noActionReason,
        shouldAttemptStep,
        stopOnRecoverableBlock,
    });
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

function isMilitaryConstructionStep(step) {
    return step?.type === 'building' && MILITARY_CONSTRUCTION_TYPES.has(step.buildingType);
}

function getMilitaryConstructionTargetsForPhase(phaseId) {
    if (phaseId === GERMAN_PHASE_IDS.phase2) {
        return [
            { buildingType: 'rallyPoint', level: PHASE_TWO_EXIT_CONDITIONS.buildingLevels.rallyPoint },
            { buildingType: 'barracks', level: PHASE_TWO_EXIT_CONDITIONS.buildingLevels.barracks },
            { buildingType: 'academy', level: PHASE_TWO_EXIT_CONDITIONS.buildingLevels.academy },
            { buildingType: 'smithy', level: PHASE_TWO_EXIT_CONDITIONS.buildingLevels.smithy },
            { buildingType: 'stable', level: PHASE_TWO_EXIT_CONDITIONS.buildingLevels.stable },
            { buildingType: 'workshop', level: PHASE_TWO_EXIT_CONDITIONS.buildingLevels.workshop },
        ];
    }

    if (phaseId === GERMAN_PHASE_IDS.phase3) {
        return [
            { buildingType: 'barracks', level: PHASE_THREE_PRIORITY.barracksTargetLevel },
            { buildingType: 'academy', level: PHASE_THREE_PRIORITY.academyTargetLevel },
            { buildingType: 'smithy', level: PHASE_THREE_PRIORITY.smithyTargetLevel },
        ];
    }

    if (phaseId === GERMAN_PHASE_IDS.phase4) {
        return [
            { buildingType: 'rallyPoint', level: PHASE_FOUR_PRIORITY.rallyPointTargetLevel },
            { buildingType: 'barracks', level: PHASE_FOUR_PRIORITY.barracksTargetLevel },
            { buildingType: 'smithy', level: PHASE_FOUR_PRIORITY.smithyTargetLevel },
            { buildingType: 'stable', level: PHASE_FOUR_PRIORITY.stableTargetLevel },
            { buildingType: 'workshop', level: PHASE_FOUR_PRIORITY.workshopTargetLevel },
        ];
    }

    if (phaseId === GERMAN_PHASE_IDS.phase5) {
        return [
            { buildingType: 'academy', level: PHASE_FIVE_PRIORITY.academyTargetLevel },
            { buildingType: 'barracks', level: PHASE_FIVE_PRIORITY.barracksTargetLevel },
            { buildingType: 'smithy', level: PHASE_FIVE_PRIORITY.smithyTargetLevel },
            { buildingType: 'stable', level: PHASE_FIVE_PRIORITY.stableTargetLevel },
            { buildingType: 'workshop', level: PHASE_FIVE_PRIORITY.workshopTargetLevel },
        ];
    }

    return [];
}

function resolveQueuedConstructionType(village, job) {
    if (job?.buildingType) return job.buildingType;
    const building = village.buildings.find(item => item.id === job?.buildingId);
    return building?.type || null;
}

function hasMilitaryConstructionInQueue(village) {
    return (village.constructionQueue || []).some(job => {
        const type = resolveQueuedConstructionType(village, job);
        return type ? MILITARY_CONSTRUCTION_TYPES.has(type) : false;
    });
}

function hasPendingMilitaryConstructionTarget(village, phaseId) {
    const targets = getMilitaryConstructionTargetsForPhase(phaseId);
    if (targets.length === 0) return false;

    return targets.some(target => getEffectiveBuildingTypeLevel(village, target.buildingType) < target.level);
}

function shouldPrioritizeMilitarySlot(phaseState, phaseId, village) {
    const maxSlots = village.maxConstructionSlots || 1;
    if (maxSlots < 2) return false;

    const queueLength = village.constructionQueue?.length || 0;
    const freeSlots = Math.max(0, maxSlots - queueLength);
    if (freeSlots !== 1) return false;

    if (hasMilitaryConstructionInQueue(village)) return false;

    const subGoalClass = phaseState.activeSubGoal?.priorityClass;
    if (subGoalClass === 'military_unlock') {
        return true;
    }

    return hasPendingMilitaryConstructionTarget(village, phaseId);
}

function createConstructionStepFilter({ phaseState, phaseId, village, log }) {
    const militarySlotReserved = shouldPrioritizeMilitarySlot(phaseState, phaseId, village);
    if (!militarySlotReserved) {
        return null;
    }

    if (Date.now() - (phaseState.lastConstructionReserveLogAt || 0) >= PHASE_SUBGOAL.logThrottleMs) {
        phaseState.lastConstructionReserveLogAt = Date.now();
        log(
            'info',
            village,
            'Macro Cola',
            'Reserva dinamica: se protege un slot de construccion para desbloqueo militar.',
            null,
            'economic',
        );
    }

    return step => isMilitaryConstructionStep(step);
}

function getBlockedStepPriorityClass(phaseId, step) {
    if (isMilitaryConstructionStep(step) && phaseId !== GERMAN_PHASE_IDS.phase1) {
        return 'military_unlock';
    }

    return 'general';
}

function getQueueTypeForStep(step) {
    return getPhaseStepQueueType(step);
}

function isQueueAvailable(village, queueType) {
    return isPhaseQueueAvailable(village, queueType);
}

function isBuildingStepCompleted(village, step) {
    if (!step) return true;

    if (step.type === 'building') {
        return getEffectiveBuildingTypeLevel(village, step.buildingType) >= (step.level || 1);
    }

    if (step.type === 'resource_fields_level') {
        return getResourceFieldStats(village).average >= (step.level || 1);
    }

    return false;
}

function isResearchStepCompleted(village, step) {
    return isPhaseResearchStepCompleted(village, step);
}

function getResourcePoolForKind(village, kind) {
    if (kind === 'mil') {
        return village.budget?.mil || {
            wood: village.resources?.wood?.current || 0,
            stone: village.resources?.stone?.current || 0,
            iron: village.resources?.iron?.current || 0,
            food: village.resources?.food?.current || 0,
        };
    }

    return village.budget?.econ || {
        wood: village.resources?.wood?.current || 0,
        stone: village.resources?.stone?.current || 0,
        iron: village.resources?.iron?.current || 0,
        food: village.resources?.food?.current || 0,
    };
}

function getResourcePoolForStep(village, step) {
    if (step?.type === 'units' || step?.type === 'proportional_units') {
        return getResourcePoolForKind(village, 'mil');
    }

    return getResourcePoolForKind(village, 'econ');
}

function hasResourcesForNeededCost(pool, neededCost) {
    if (!neededCost || typeof neededCost !== 'object') return false;
    return Object.entries(neededCost).every(([resource, required]) => {
        if (!Number.isFinite(required) || required <= 0) return true;
        return (pool?.[resource] || 0) >= required;
    });
}

function buildPrerequisiteSubGoalStep(village, blockedResult) {
    return buildPrerequisiteResolverStepFromBlock({
        village,
        blockedResult,
        getEffectiveBuildingLevel: getEffectiveBuildingTypeLevel,
    });
}

function resolveResearchUnitId(actionExecutor, identifier) {
    if (!identifier) return null;
    const resolved = actionExecutor?.resolveUnitId?.(identifier);
    return resolved || identifier;
}

function shouldEnqueueResearch(village, actionExecutor, identifier) {
    const unitId = resolveResearchUnitId(actionExecutor, identifier);
    if (!unitId) return false;

    if (village.research?.completed?.includes(unitId)) {
        return false;
    }

    if (village.research?.queue?.some(job => job.unitId === unitId)) {
        return false;
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
        cloneStep,
        getStepSignature,
        getQueueTypeForStep,
        isRecoverableBlockReason: isRecoverableBlockReason,
        buildResolverStep: buildPrerequisiteSubGoalStep,
        getBlockedStepPriorityClass,
        idPrefix: 'sg',
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
        cloneStep,
        getStepSignature,
        getQueueTypeForStep,
        isQueueAvailable,
        isResearchStepCompleted,
        isBuildingStepCompleted,
        buildResolverStep: buildPrerequisiteSubGoalStep,
        isRecoverableBlockReason: isRecoverableBlockReason,
        waitResourcesMode: 'hold_until_resources',
        hasResourcesForBlockedStep: hasEstimatedResourcesForStep,
    });
}

function sameRatio(currentRatio, targetRatio) {
    if (!currentRatio) return false;
    return Math.abs((currentRatio.econ || 0) - targetRatio.econ) <= FLOAT_EPSILON
        && Math.abs((currentRatio.mil || 0) - targetRatio.mil) <= FLOAT_EPSILON;
}

function normalizeVillageCombatState(villageCombatState, now = Date.now()) {
    if (!villageCombatState || typeof villageCombatState !== 'object') {
        return {
            threatLevel: 'none',
            shouldPauseEconomicConstruction: false,
            shouldBoostEmergencyRecruitment: false,
            sourceMovementIds: [],
        };
    }

    if (Number.isFinite(villageCombatState.expiresAt) && villageCombatState.expiresAt <= now) {
        return {
            threatLevel: 'none',
            shouldPauseEconomicConstruction: false,
            shouldBoostEmergencyRecruitment: false,
            sourceMovementIds: [],
        };
    }

    return {
        threatLevel: villageCombatState.threatLevel || 'none',
        shouldPauseEconomicConstruction: Boolean(villageCombatState.shouldPauseEconomicConstruction),
        shouldBoostEmergencyRecruitment: Boolean(villageCombatState.shouldBoostEmergencyRecruitment),
        sourceMovementIds: Array.isArray(villageCombatState.sourceMovementIds) ? villageCombatState.sourceMovementIds : [],
    };
}

function getThreatRatioAdjustment(threatLevel) {
    if (threatLevel === 'critical') return { econ: 0.2, mil: 0.8 };
    if (threatLevel === 'high') return { econ: 0.28, mil: 0.72 };
    if (threatLevel === 'medium') return { econ: 0.38, mil: 0.62 };
    return null;
}

function getThreatAllowedNonMilitarySet(threatLevel) {
    if (threatLevel === 'critical') return CRITICAL_ALLOWED_NON_MILITARY_TYPES;
    if (threatLevel === 'high') return HIGH_ALLOWED_NON_MILITARY_TYPES;
    if (threatLevel === 'medium') return MEDIUM_ALLOWED_NON_MILITARY_TYPES;
    return null;
}

function applyThreatAwareRatio({ village, baseRatio, phaseState, phaseLabel, threatContext, log, now }) {
    const threatLevel = threatContext?.threatLevel || 'none';
    const adjustment = getThreatRatioAdjustment(threatLevel);

    let finalRatio = { ...baseRatio };
    if (adjustment) {
        finalRatio = {
            econ: Math.min(finalRatio.econ, adjustment.econ),
            mil: Math.max(finalRatio.mil, adjustment.mil),
        };

        const ratioSum = finalRatio.econ + finalRatio.mil;
        if (ratioSum > 0) {
            finalRatio = {
                econ: finalRatio.econ / ratioSum,
                mil: finalRatio.mil / ratioSum,
            };
        }
    }

    if (sameRatio(village.budgetRatio, finalRatio)) {
        return;
    }

    village.budgetRatio = finalRatio;
    rebalanceVillageBudgetToRatio(village);

    const canLogThreat = now - (phaseState.lastThreatOverrideLogAt || 0) >= THREAT_OVERRIDE_LOG_THROTTLE_MS;
    if (!canLogThreat) return;

    phaseState.lastThreatOverrideLogAt = now;
    if (!adjustment) {
        log(
            'info',
            village,
            phaseLabel,
            `Ratio eco/mil aplicado: ${(finalRatio.econ * 100).toFixed(0)}%/${(finalRatio.mil * 100).toFixed(0)}%.`,
            null,
            'economic',
        );
        return;
    }

    log(
        'warn',
        village,
        `${phaseLabel} Threat Override`,
        `Amenaza ${threatLevel}: ratio temporal eco/mil ${(finalRatio.econ * 100).toFixed(0)}%/${(finalRatio.mil * 100).toFixed(0)}%.`,
        null,
        'economic',
    );
}

function composeStepFilters(...filters) {
    const activeFilters = filters.filter(filter => typeof filter === 'function');
    if (activeFilters.length === 0) return null;
    return step => activeFilters.every(filter => filter(step));
}

function createThreatConstructionFilter({ threatContext, phaseState, village, log, now }) {
    const threatLevel = threatContext?.threatLevel || 'none';
    if (threatLevel === 'none' || threatLevel === 'low') {
        return null;
    }

    const allowedNonMilitary = getThreatAllowedNonMilitarySet(threatLevel);
    const shouldPauseEconomic = Boolean(threatContext?.shouldPauseEconomicConstruction);
    const maxSlots = village.maxConstructionSlots || 1;
    const queueLength = village.constructionQueue?.length || 0;
    const freeSlots = Math.max(0, maxSlots - queueLength);

    const canLog = now - (phaseState.lastThreatOverrideLogAt || 0) >= THREAT_OVERRIDE_LOG_THROTTLE_MS;
    if (canLog) {
        phaseState.lastThreatOverrideLogAt = now;
        log(
            'warn',
            village,
            'Macro Threat Override',
            `Filtro de construccion por amenaza ${threatLevel} activado (freeSlots=${freeSlots}, pauseEco=${shouldPauseEconomic ? 'yes' : 'no'}).`,
            null,
            'economic',
        );
    }

    return step => {
        if (!step) return true;
        if (step.type !== 'building' && step.type !== 'resource_fields_level') return true;
        if (isMilitaryConstructionStep(step)) return true;

        if (step.type === 'resource_fields_level') {
            return !shouldPauseEconomic && threatLevel === 'medium';
        }

        const buildingType = step.buildingType;
        if (!buildingType) return true;

        if (RESILIENCE_CONSTRUCTION_TYPES.has(buildingType) && allowedNonMilitary?.has(buildingType)) {
            return true;
        }

        if (threatLevel === 'medium') {
            if (freeSlots <= 1) {
                return false;
            }
            return !shouldPauseEconomic;
        }

        if (threatLevel === 'high') {
            return allowedNonMilitary?.has(buildingType) || false;
        }

        if (threatLevel === 'critical') {
            return allowedNonMilitary?.has(buildingType) || false;
        }

        return true;
    };
}

function tryThreatEmergencyRecruitment({ village, gameState, actionExecutor, difficulty, threatContext }) {
    const threatLevel = threatContext?.threatLevel || 'none';
    const shouldBoost = Boolean(threatContext?.shouldBoostEmergencyRecruitment);
    if (!shouldBoost && threatLevel !== 'high' && threatLevel !== 'critical') {
        return { success: false, reason: 'THREAT_BOOST_NOT_REQUIRED' };
    }

    let cycles = 0;
    if (threatLevel === 'critical') cycles = 6;
    else if (threatLevel === 'high') cycles = 4;
    else if (threatLevel === 'medium') cycles = 2;
    else cycles = 1;

    const emergencyCount = estimateUnitsForCycles({
        village,
        actionExecutor,
        unitType: 'defensive_infantry',
        cycles,
        gameSpeed: 1,
    });

    if (emergencyCount <= 0) {
        return { success: false, reason: 'PREREQUISITES_NOT_MET', details: { unitType: 'defensive_infantry' } };
    }

    const emergencyStep = {
        type: 'units',
        unitType: 'defensive_infantry',
        count: emergencyCount,
    };

    const result = actionExecutor.executePlanStep(
        village,
        emergencyStep,
        gameState,
        { scope: 'per_village' },
    );

    return {
        ...result,
        step: cloneStep(emergencyStep),
    };
}

function ensurePhaseOneRatio({ village, difficulty, log, phaseState, threatContext, now }) {
    const phaseConfig = getPhaseOneConfig(difficulty);
    applyThreatAwareRatio({
        village,
        baseRatio: phaseConfig.ratio,
        phaseState,
        phaseLabel: `Macro Fase 1 (${difficulty})`,
        threatContext,
        log,
        now,
    });
}

function ensurePhaseTwoRatio({ village, difficulty, log, phaseState, threatContext, now }) {
    const phaseConfig = getPhaseTwoConfig(difficulty);
    applyThreatAwareRatio({
        village,
        baseRatio: phaseConfig.ratio,
        phaseState,
        phaseLabel: `Macro Fase 2 (${difficulty})`,
        threatContext,
        log,
        now,
    });
}

function ensurePhaseThreeRatio({ village, difficulty, log, phaseState, threatContext, now }) {
    const phaseConfig = getPhaseThreeConfig(difficulty);
    applyThreatAwareRatio({
        village,
        baseRatio: phaseConfig.ratio,
        phaseState,
        phaseLabel: `Macro Fase 3 (${difficulty})`,
        threatContext,
        log,
        now,
    });
}

function ensurePhaseFourRatio({ village, difficulty, log, phaseState, threatContext, now }) {
    const phaseConfig = getPhaseFourConfig(difficulty);
    applyThreatAwareRatio({
        village,
        baseRatio: phaseConfig.ratio,
        phaseState,
        phaseLabel: `Macro Fase 4 (${difficulty})`,
        threatContext,
        log,
        now,
    });
}

function ensurePhaseFiveRatio({ village, difficulty, log, phaseState, threatContext, now }) {
    const phaseConfig = getPhaseFiveConfig(difficulty);
    applyThreatAwareRatio({
        village,
        baseRatio: phaseConfig.ratio,
        phaseState,
        phaseLabel: `Macro Fase 5 (${difficulty})`,
        threatContext,
        log,
        now,
    });
}

function attemptConstructionStep({ village, gameState, step, actionExecutor }) {
    return actionExecutor.executePlanStep(village, step, gameState, { scope: 'per_village' });
}

function attemptRecruitmentStep({ village, gameState, step, actionExecutor }) {
    return actionExecutor.executePlanStep(village, step, gameState, { scope: 'per_village' });
}

function tryPhaseOnePriorityConstruction({ village, gameState, actionExecutor, phaseState, shouldAttemptConstructionStep = null }) {
    const prioritySteps = getSharedPhaseOneConstructionSteps(PHASE_ONE_EXIT_CONDITIONS);

    return runConstructionStepList({
        village,
        steps: prioritySteps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase1,
        laneId: 'phase1_priority_construction',
        executeStep: step => attemptConstructionStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_ACTION',
        shouldAttemptStep: shouldAttemptConstructionStep,
        stopOnRecoverableBlock: true,
    });
}

function tryPhaseOnePriorityRecruitment({ village, gameState, actionExecutor, phaseState }) {
    const steps = [
        createCycleMicroRecruitmentStep('offensive_infantry'),
        createCycleMicroRecruitmentStep('scout'),
    ];

    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase1,
        laneId: 'phase1_priority_recruitment',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_RECRUITMENT',
    });
}

function tryPhaseOneFallbackConstruction({ village, gameState, actionExecutor, phaseState, shouldAttemptConstructionStep = null }) {
    const resourceStats = getResourceFieldStats(village);
    const fallbackSteps = [
        { type: 'resource_fields_level', level: Math.max(1, resourceStats.min + 1) },
        { type: 'building', buildingType: 'warehouse', level: getEffectiveBuildingTypeLevel(village, 'warehouse') + 1 },
        { type: 'building', buildingType: 'granary', level: getEffectiveBuildingTypeLevel(village, 'granary') + 1 },
        { type: 'building', buildingType: 'mainBuilding', level: getEffectiveBuildingTypeLevel(village, 'mainBuilding') + 1 },
    ];

    fallbackSteps.sort((a, b) => getStepCostEstimate(village, a) - getStepCostEstimate(village, b));

    return runConstructionStepList({
        village,
        steps: fallbackSteps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase1,
        laneId: 'phase1_fallback_construction',
        executeStep: step => attemptConstructionStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_FALLBACK_ACTION',
        shouldAttemptStep: shouldAttemptConstructionStep,
        stopOnRecoverableBlock: true,
    });
}

function tryPhaseTwoPriorityConstruction({ village, gameState, actionExecutor, phaseState, shouldAttemptConstructionStep = null }) {
    const prioritySteps = getSharedPhaseTwoConstructionSteps(PHASE_TWO_EXIT_CONDITIONS);

    return runConstructionStepList({
        village,
        steps: prioritySteps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase2,
        laneId: 'phase2_priority_construction',
        executeStep: step => attemptConstructionStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_ACTION',
        shouldAttemptStep: shouldAttemptConstructionStep,
        stopOnRecoverableBlock: true,
    });
}

function tryPhaseTwoFallbackConstruction({ village, gameState, actionExecutor, phaseState, shouldAttemptConstructionStep = null }) {
    const resourceStats = getResourceFieldStats(village);
    const fallbackSteps = [
        { type: 'resource_fields_level', level: Math.max(PHASE_TWO_EXIT_CONDITIONS.resourceFieldsLevel, resourceStats.min + 1) },
        { type: 'building', buildingType: 'warehouse', level: getEffectiveBuildingTypeLevel(village, 'warehouse') + 1 },
        { type: 'building', buildingType: 'granary', level: getEffectiveBuildingTypeLevel(village, 'granary') + 1 },
        { type: 'building', buildingType: 'mainBuilding', level: getEffectiveBuildingTypeLevel(village, 'mainBuilding') + 1 },
    ];

    fallbackSteps.sort((a, b) => getStepCostEstimate(village, a) - getStepCostEstimate(village, b));

    return runConstructionStepList({
        village,
        steps: fallbackSteps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase2,
        laneId: 'phase2_fallback_construction',
        executeStep: step => attemptConstructionStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_FALLBACK_ACTION',
        shouldAttemptStep: shouldAttemptConstructionStep,
        stopOnRecoverableBlock: true,
    });
}

function tryPhaseThreePriorityConstruction({ village, gameState, actionExecutor, phaseState, shouldAttemptConstructionStep = null }) {
    const prioritySteps = [
        { type: 'resource_fields_level', level: PHASE_THREE_PRIORITY.resourceFieldsTargetLevel },
        { type: 'building', buildingType: 'smithy', level: PHASE_THREE_PRIORITY.smithyTargetLevel },
        { type: 'building', buildingType: 'barracks', level: PHASE_THREE_PRIORITY.barracksTargetLevel },
        { type: 'building', buildingType: 'academy', level: PHASE_THREE_PRIORITY.academyTargetLevel },
        { type: 'building', buildingType: 'mainBuilding', level: 10 },
    ];

    return runConstructionStepList({
        village,
        steps: prioritySteps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase3,
        laneId: 'phase3_priority_construction',
        executeStep: step => attemptConstructionStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_ACTION',
        shouldAttemptStep: shouldAttemptConstructionStep,
        stopOnRecoverableBlock: true,
    });
}

function tryPhaseThreeFallbackConstruction({ village, gameState, actionExecutor, phaseState, shouldAttemptConstructionStep = null }) {
    const resourceStats = getResourceFieldStats(village);
    const fallbackSteps = [
        { type: 'resource_fields_level', level: Math.max(PHASE_THREE_PRIORITY.resourceFieldsTargetLevel, resourceStats.min + 1) },
        { type: 'building', buildingType: 'warehouse', level: getEffectiveBuildingTypeLevel(village, 'warehouse') + 1 },
        { type: 'building', buildingType: 'granary', level: getEffectiveBuildingTypeLevel(village, 'granary') + 1 },
        { type: 'building', buildingType: 'mainBuilding', level: getEffectiveBuildingTypeLevel(village, 'mainBuilding') + 1 },
    ];

    fallbackSteps.sort((a, b) => getStepCostEstimate(village, a) - getStepCostEstimate(village, b));

    return runConstructionStepList({
        village,
        steps: fallbackSteps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase3,
        laneId: 'phase3_fallback_construction',
        executeStep: step => attemptConstructionStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_FALLBACK_ACTION',
        shouldAttemptStep: shouldAttemptConstructionStep,
        stopOnRecoverableBlock: true,
    });
}

function tryPhaseFourPriorityConstruction({ village, gameState, actionExecutor, phaseState, shouldAttemptConstructionStep = null }) {
    const prioritySteps = [
        { type: 'building', buildingType: 'rallyPoint', level: PHASE_FOUR_PRIORITY.rallyPointTargetLevel },
        { type: 'building', buildingType: 'stable', level: 1 },
        { type: 'building', buildingType: 'workshop', level: 1 },
        { type: 'building', buildingType: 'stable', level: PHASE_FOUR_PRIORITY.stableTargetLevel },
        { type: 'building', buildingType: 'workshop', level: PHASE_FOUR_PRIORITY.workshopTargetLevel },
        { type: 'building', buildingType: 'smithy', level: PHASE_FOUR_PRIORITY.smithyTargetLevel },
        { type: 'building', buildingType: 'barracks', level: PHASE_FOUR_PRIORITY.barracksTargetLevel },
        { type: 'resource_fields_level', level: PHASE_FOUR_PRIORITY.resourceFieldsTargetLevel },
    ];

    if (hasPhaseFourStoragePressure(village)) {
        prioritySteps.push(
            { type: 'building', buildingType: 'warehouse', level: getEffectiveBuildingTypeLevel(village, 'warehouse') + 1 },
            { type: 'building', buildingType: 'granary', level: getEffectiveBuildingTypeLevel(village, 'granary') + 1 },
        );
    }

    return runConstructionStepList({
        village,
        steps: prioritySteps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase4,
        laneId: 'phase4_priority_construction',
        executeStep: step => attemptConstructionStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_ACTION',
        shouldAttemptStep: shouldAttemptConstructionStep,
        stopOnRecoverableBlock: true,
    });
}

function tryPhaseFourFallbackConstruction({ village, gameState, actionExecutor, phaseState, shouldAttemptConstructionStep = null }) {
    const resourceStats = getResourceFieldStats(village);
    const fallbackSteps = [
        { type: 'resource_fields_level', level: Math.max(PHASE_FOUR_PRIORITY.resourceFieldsTargetLevel, resourceStats.min + 1) },
        { type: 'building', buildingType: 'mainBuilding', level: getEffectiveBuildingTypeLevel(village, 'mainBuilding') + 1 },
    ];

    if (hasPhaseFourStoragePressure(village)) {
        fallbackSteps.push(
            { type: 'building', buildingType: 'warehouse', level: getEffectiveBuildingTypeLevel(village, 'warehouse') + 1 },
            { type: 'building', buildingType: 'granary', level: getEffectiveBuildingTypeLevel(village, 'granary') + 1 },
        );
    }

    fallbackSteps.sort((a, b) => getStepCostEstimate(village, a) - getStepCostEstimate(village, b));

    return runConstructionStepList({
        village,
        steps: fallbackSteps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase4,
        laneId: 'phase4_fallback_construction',
        executeStep: step => attemptConstructionStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_FALLBACK_ACTION',
        shouldAttemptStep: shouldAttemptConstructionStep,
        stopOnRecoverableBlock: true,
    });
}

function tryPhaseFivePriorityConstruction({ village, gameState, actionExecutor, phaseState, shouldAttemptConstructionStep = null }) {
    const prioritySteps = [
        // 1) Academy + edificios de asedio
        { type: 'building', buildingType: 'academy', level: PHASE_FIVE_PRIORITY.academyTargetLevel },
        { type: 'building', buildingType: 'workshop', level: 1 },
        { type: 'building', buildingType: 'workshop', level: PHASE_FIVE_PRIORITY.workshopTargetLevel },
        { type: 'building', buildingType: 'smithy', level: PHASE_FIVE_PRIORITY.smithyTargetLevel },
        { type: 'building', buildingType: 'barracks', level: PHASE_FIVE_PRIORITY.barracksTargetLevel },
        { type: 'building', buildingType: 'stable', level: PHASE_FIVE_PRIORITY.stableTargetLevel },

        // 2) Soporte logistico
        { type: 'building', buildingType: 'marketplace', level: PHASE_FIVE_PRIORITY.marketplaceTargetLevel },
        { type: 'resource_fields_level', level: PHASE_FIVE_PRIORITY.resourceFieldsTargetLevel },
    ];

    // 3) Prerequisitos de expansion
    prioritySteps.push(
        { type: 'building', buildingType: 'embassy', level: PHASE_FIVE_PRIORITY.embassyTargetLevel },
        { type: 'building', buildingType: 'palace', level: PHASE_FIVE_PRIORITY.palaceTargetLevel },
    );

    if (hasPhaseFiveStoragePressure(village)) {
        prioritySteps.push(
            { type: 'building', buildingType: 'warehouse', level: getEffectiveBuildingTypeLevel(village, 'warehouse') + 1 },
            { type: 'building', buildingType: 'granary', level: getEffectiveBuildingTypeLevel(village, 'granary') + 1 },
        );
    }

    return runConstructionStepList({
        village,
        steps: prioritySteps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase5,
        laneId: 'phase5_priority_construction',
        executeStep: step => attemptConstructionStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_ACTION',
        shouldAttemptStep: shouldAttemptConstructionStep,
        stopOnRecoverableBlock: true,
    });
}

function tryPhaseFiveFallbackConstruction({ village, gameState, actionExecutor, phaseState, shouldAttemptConstructionStep = null }) {
    const resourceStats = getResourceFieldStats(village);
    const fallbackSteps = [
        { type: 'resource_fields_level', level: Math.max(PHASE_FIVE_PRIORITY.resourceFieldsTargetLevel, resourceStats.min + 1) },
        { type: 'building', buildingType: 'mainBuilding', level: getEffectiveBuildingTypeLevel(village, 'mainBuilding') + 1 },
        { type: 'building', buildingType: 'marketplace', level: getEffectiveBuildingTypeLevel(village, 'marketplace') + 1 },
        { type: 'building', buildingType: 'palace', level: Math.max(PHASE_FIVE_PRIORITY.palaceTargetLevel, getEffectiveBuildingTypeLevel(village, 'palace') + 1) },
    ];

    if (hasPhaseFiveStoragePressure(village)) {
        fallbackSteps.push(
            { type: 'building', buildingType: 'warehouse', level: getEffectiveBuildingTypeLevel(village, 'warehouse') + 1 },
            { type: 'building', buildingType: 'granary', level: getEffectiveBuildingTypeLevel(village, 'granary') + 1 },
        );
    }

    fallbackSteps.sort((a, b) => getStepCostEstimate(village, a) - getStepCostEstimate(village, b));

    return runConstructionStepList({
        village,
        steps: fallbackSteps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase5,
        laneId: 'phase5_fallback_construction',
        executeStep: step => attemptConstructionStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_FALLBACK_ACTION',
        shouldAttemptStep: shouldAttemptConstructionStep,
        stopOnRecoverableBlock: true,
    });
}

function hasUrgentDefenseNeed(village, gameState, gameSpeed) {
    const now = Date.now();
    const lookaheadMs = Math.max(15_000, Math.floor(PHASE_ONE_PRIORITY.defenseLookaheadMs / Math.max(gameSpeed || 1, 1)));

    const incomingHostiles = gameState.movements.filter(movement => {
        if (!HOSTILE_MOVEMENT_TYPES.has(movement.type)) return false;
        if (movement.ownerId === village.ownerId) return false;
        if (!movement.targetCoords) return false;
        if (movement.targetCoords.x !== village.coords.x || movement.targetCoords.y !== village.coords.y) return false;

        const eta = (movement.arrivalTime || now) - now;
        return eta >= 0 && eta <= lookaheadMs;
    });

    if (incomingHostiles.length === 0) {
        return false;
    }

    const combatTroops = countCombatTroopsInVillages([village], village.race);
    return combatTroops < PHASE_ONE_PRIORITY.emergencyDefenseTargetTroops;
}

function tryPhaseOneEmergencyRecruitment({ village, gameState, actionExecutor, gameSpeed, difficulty }) {
    if (!hasUrgentDefenseNeed(village, gameState, gameSpeed)) {
        return { success: false, reason: 'NO_DEFENSE_URGENCY' };
    }

    const emergencyCycles = getCycleTargetForPhase(difficulty, 'phase1Emergency').defensiveInfantry || 3;
    const emergencyCount = estimateUnitsForCycles({
        village,
        actionExecutor,
        unitType: 'defensive_infantry',
        cycles: emergencyCycles,
        gameSpeed,
    });
    if (emergencyCount <= 0) {
        return { success: false, reason: 'PREREQUISITES_NOT_MET', details: { unitType: 'defensive_infantry' } };
    }

    const emergencyStep = {
        type: 'units',
        unitType: 'defensive_infantry',
        count: emergencyCount,
    };

    const result = actionExecutor.executePlanStep(
        village,
        emergencyStep,
        gameState,
        { scope: 'per_village' },
    );

    return {
        ...result,
        step: cloneStep(emergencyStep),
    };
}

function tryPhaseTwoPriorityResearch({ village, gameState, actionExecutor, phaseState }) {
    const steps = [];

    if (shouldEnqueueResearch(village, actionExecutor, 'scout')) {
        steps.push({ type: 'research', unitType: 'scout' });
    }

    if (shouldEnqueueResearch(village, actionExecutor, 'offensive_cavalry')) {
        steps.push({ type: 'research', unitType: 'offensive_cavalry' });
    }

    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase2,
        laneId: 'phase2_priority_research',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_RESEARCH',
    });
}

function tryPhaseThreePriorityResearch({ village, gameState, actionExecutor, phaseState }) {
    const steps = [];

    if (shouldEnqueueResearch(village, actionExecutor, 'scout')) {
        steps.push({ type: 'research', unitType: 'scout' });
    }

    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase3,
        laneId: 'phase3_priority_research',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_RESEARCH',
    });
}

function tryPhaseFourPriorityResearch({ village, gameState, actionExecutor, phaseState }) {
    const steps = [];

    if (shouldEnqueueResearch(village, actionExecutor, 'scout')) {
        steps.push({ type: 'research', unitType: 'scout' });
    }

    if (shouldEnqueueResearch(village, actionExecutor, 'offensive_cavalry')) {
        steps.push({ type: 'research', unitType: 'offensive_cavalry' });
    }

    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase4,
        laneId: 'phase4_priority_research',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_RESEARCH',
    });
}

function tryPhaseFivePriorityResearch({ village, gameState, actionExecutor, phaseState }) {
    const raceTroops = getRaceTroops(village.race || 'germans');
    const chiefUnitId = raceTroops.find(unit => unit.type === 'chief')?.id || 'chief_german';
    const preferConquest = shouldPreferConquestExpansion(village);
    const steps = [];

    if (shouldEnqueueResearch(village, actionExecutor, 'ram')) {
        steps.push({ type: 'research', unitType: 'ram' });
    }

    if (shouldEnqueueResearch(village, actionExecutor, 'catapult')) {
        steps.push({ type: 'research', unitType: 'catapult' });
    }

    if (shouldEnqueueResearch(village, actionExecutor, 'offensive_cavalry')) {
        steps.push({ type: 'research', unitType: 'offensive_cavalry' });
    }

    if (preferConquest && shouldEnqueueResearch(village, actionExecutor, chiefUnitId)) {
        steps.push({ type: 'research', unitType: chiefUnitId });
    }

    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase5,
        laneId: 'phase5_priority_research',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_RESEARCH',
    });
}

function tryPhaseTwoPriorityRecruitment({ village, gameState, actionExecutor, phaseState }) {
    const steps = [
        createCycleMicroRecruitmentStep('offensive_infantry'),
        createCycleMicroRecruitmentStep('scout'),
        createCycleMicroRecruitmentStep('offensive_cavalry'),
    ];

    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase2,
        laneId: 'phase2_priority_recruitment',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_RECRUITMENT',
    });
}

function tryPhaseTwoFallbackRecruitment({ village, gameState, actionExecutor, phaseState }) {
    const steps = [
        createCycleMicroRecruitmentStep('offensive_infantry'),
        createCycleMicroRecruitmentStep('offensive_cavalry'),
        createCycleMicroRecruitmentStep('scout'),
    ];
    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase2,
        laneId: 'phase2_fallback_recruitment',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_FALLBACK_RECRUITMENT',
    });
}

function tryPhaseThreePriorityRecruitment({ village, gameState, actionExecutor, phaseState }) {
    const steps = [
        createCycleMicroRecruitmentStep('scout'),
        createCycleMicroRecruitmentStep('offensive_infantry'),
    ];

    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase3,
        laneId: 'phase3_priority_recruitment',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_RECRUITMENT',
    });
}

function tryPhaseThreeFallbackRecruitment({ village, gameState, actionExecutor, phaseState }) {
    const steps = [createCycleMicroRecruitmentStep('offensive_infantry')];
    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase3,
        laneId: 'phase3_fallback_recruitment',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_FALLBACK_RECRUITMENT',
    });
}

function tryPhaseFourPriorityRecruitment({ village, gameState, actionExecutor, phaseState }) {
    const steps = [
        createCycleMicroRecruitmentStep('offensive_infantry'),
        createCycleMicroRecruitmentStep('offensive_cavalry'),
        createCycleMicroRecruitmentStep('scout'),
    ];

    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase4,
        laneId: 'phase4_priority_recruitment',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_RECRUITMENT',
    });
}

function tryPhaseFourFallbackRecruitment({ village, gameState, actionExecutor, phaseState }) {
    const steps = [
        createCycleMicroRecruitmentStep('offensive_infantry'),
        createCycleMicroRecruitmentStep('offensive_cavalry'),
        createCycleMicroRecruitmentStep('scout'),
    ];

    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase4,
        laneId: 'phase4_fallback_recruitment',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_FALLBACK_RECRUITMENT',
    });
}

function shouldPreferConquestExpansion(village) {
    const palaceLevel = getEffectiveBuildingTypeLevel(village, 'palace');
    const workshopLevel = getEffectiveBuildingTypeLevel(village, 'workshop');
    const raceTroops = getRaceTroops(village.race || 'germans');

    const offensiveAndSiegeIds = raceTroops
        .filter(unit => unit.role === 'offensive' || unit.role === 'ram' || unit.role === 'catapult')
        .map(unit => unit.id);

    const offensiveAndSiegeCount = offensiveAndSiegeIds.reduce(
        (sum, unitId) => sum + getTotalUnitCountInVillageAndQueue(village, unitId),
        0,
    );

    return palaceLevel >= PHASE_FIVE_PRIORITY.palaceTargetLevel
        && workshopLevel >= PHASE_FIVE_PRIORITY.workshopTargetLevel
        && offensiveAndSiegeCount >= 250;
}

function tryPhaseFivePriorityRecruitment({ village, gameState, actionExecutor, phaseState }) {
    const raceTroops = getRaceTroops(village.race || 'germans');
    const chiefUnitId = raceTroops.find(unit => unit.type === 'chief')?.id || 'chief_german';
    const preferConquest = shouldPreferConquestExpansion(village);
    const expansionUnitPriority = preferConquest
        ? [chiefUnitId, 'settler']
        : ['settler', chiefUnitId];

    const steps = [
        createCycleMicroRecruitmentStep('offensive_infantry'),
        createCycleMicroRecruitmentStep('offensive_cavalry'),
        createCycleMicroRecruitmentStep('ram'),
        createCycleMicroRecruitmentStep('catapult'),
        createCycleMicroRecruitmentStep('scout'),
        ...expansionUnitPriority.map(unitType => ({
            ...createCycleMicroRecruitmentStep(unitType),
        })),
    ];

    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase5,
        laneId: 'phase5_priority_recruitment',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_PRIORITY_RECRUITMENT',
    });
}

function tryPhaseFiveFallbackRecruitment({ village, gameState, actionExecutor, phaseState }) {
    const raceTroops = getRaceTroops(village.race || 'germans');
    const chiefUnitId = raceTroops.find(unit => unit.type === 'chief')?.id || 'chief_german';
    const preferConquest = shouldPreferConquestExpansion(village);
    const expansionUnitPriority = preferConquest
        ? [chiefUnitId, 'settler']
        : ['settler', chiefUnitId];

    const steps = [
        createCycleMicroRecruitmentStep('offensive_infantry'),
        createCycleMicroRecruitmentStep('offensive_cavalry'),
        createCycleMicroRecruitmentStep('ram'),
        createCycleMicroRecruitmentStep('catapult'),
        createCycleMicroRecruitmentStep('scout'),
        ...expansionUnitPriority.map(unitType => createCycleMicroRecruitmentStep(unitType)),
    ];

    return runStepList({
        steps,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase5,
        laneId: 'phase5_fallback_recruitment',
        executeStep: step => attemptRecruitmentStep({ village, gameState, step, actionExecutor }),
        noActionReason: 'NO_FALLBACK_RECRUITMENT',
    });
}

function updatePhaseTwoQueueTelemetry(phaseState, village, deltaMs) {
    phaseState.phase2MilitaryQueueSamples = (phaseState.phase2MilitaryQueueSamples || 0) + 1;
    if ((village.recruitmentQueue?.length || 0) > 0) {
        phaseState.phase2MilitaryQueueActiveSamples = (phaseState.phase2MilitaryQueueActiveSamples || 0) + 1;
    }
}

function updatePhaseThreeQueueTelemetry(phaseState, village, deltaMs) {
}

function updatePhaseFourQueueTelemetry(phaseState, village, deltaMs) {
    phaseState.phase4MilitaryQueueSamples = (phaseState.phase4MilitaryQueueSamples || 0) + 1;

    if ((village.recruitmentQueue?.length || 0) > 0) {
        phaseState.phase4MilitaryQueueActiveSamples = (phaseState.phase4MilitaryQueueActiveSamples || 0) + 1;
        phaseState.phase4ConsecutiveActiveSamples = (phaseState.phase4ConsecutiveActiveSamples || 0) + 1;
        return;
    }

    phaseState.phase4ConsecutiveActiveSamples = 0;
}

function updatePhaseFiveQueueTelemetry(phaseState, village, deltaMs) {
    phaseState.phase5MilitaryQueueSamples = (phaseState.phase5MilitaryQueueSamples || 0) + 1;

    if ((village.recruitmentQueue?.length || 0) > 0) {
        phaseState.phase5MilitaryQueueActiveSamples = (phaseState.phase5MilitaryQueueActiveSamples || 0) + 1;
        phaseState.phase5ConsecutiveActiveSamples = (phaseState.phase5ConsecutiveActiveSamples || 0) + 1;
        return;
    }

    phaseState.phase5ConsecutiveActiveSamples = 0;
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
    const handling = handleCommonPhaseActionResult({
        result,
        phaseState,
        phaseId,
        source,
        village,
        gameSpeed,
        onSuccess,
        queueFullPriority: true,
        createOrRefreshSubGoal: payload => createOrRefreshSubGoal({
            ...payload,
            log,
        }),
    });

    if (
        result?.reason === 'INSUFFICIENT_RESOURCES'
        && phaseState.activeSubGoal?.kind === SUBGOAL_KIND.waitResources
        && village?.budgetRatio
    ) {
        rebalanceVillageBudgetToRatio(village, village.budgetRatio);
    }

    return handling;
}

function runAndHandlePhaseLaneMatrix({
    phaseState,
    phaseId,
    lanes,
    village,
    gameSpeed,
    log,
}) {
    const laneRun = runPhaseLaneMatrix({
        phaseState,
        phaseId,
        laneMatrixId: `${phaseId}_lane_matrix`,
        lanes,
    });

    if (!laneRun.handled) {
        return { terminal: false };
    }

    return handlePhaseActionResult({
        result: laneRun.result,
        phaseState,
        phaseId,
        source: laneRun.lane?.source || `${phaseId}_lane_action`,
        village,
        gameSpeed,
        log,
        onSuccess: laneRun.lane?.onSuccess,
    });
}

function registerRecruitmentCommitFromAction({ result, phaseState, phaseId, village, difficulty, log }) {
    if (!result?.success) return;
    if (!Number.isFinite(result.count) || result.count <= 0) return;
    if (!result.unitId) return;
    if (!Number.isFinite(result.timePerUnit) || result.timePerUnit <= 0) return;

    const phaseKey = phaseId === GERMAN_PHASE_IDS.phase1
        ? 'phase1'
        : phaseId === GERMAN_PHASE_IDS.phase2
            ? 'phase2'
            : phaseId === GERMAN_PHASE_IDS.phase3
                ? 'phase3'
                : phaseId === GERMAN_PHASE_IDS.phase4
                    ? 'phase4'
                    : phaseId === GERMAN_PHASE_IDS.phase5
                        ? 'phase5'
                        : phaseId;

    recordGermanPhaseRecruitmentProgress({
        phaseState,
        phaseKey,
        village,
        unitId: result.unitId,
        count: result.count,
        timePerUnit: result.timePerUnit,
    });

    if (typeof log === 'function') {
        const status = getGermanPhaseCycleStatus(phaseState, difficulty, phaseKey);
        const percent = status.max > 0 ? ((status.completed / status.max) * 100) : 0;
        log(
            'info',
            village,
            'Macro Reclutamiento',
            `Progreso ciclos fase: ${status.completed}/${status.max} (${percent.toFixed(1)}%).`,
            null,
            'economic',
        );
    }
}

function resetSubGoalOnPhaseTransition(phaseState, now) {
    if (!phaseState.activeSubGoal) return;
    pushSubGoalHistory(phaseState, {
        ...phaseState.activeSubGoal,
        clearedAt: now,
        status: 'phase_transition',
    });
    phaseState.activeSubGoal = null;
}

function transitionToPhaseTwo(phaseState, now, log, village) {
    resetSubGoalOnPhaseTransition(phaseState, now);
    phaseState.activePhaseId = GERMAN_PHASE_IDS.phase2;
    phaseState.phase2StartedAt = now;
    phaseState.phase2MilitaryQueueSamples = 0;
    phaseState.phase2MilitaryQueueActiveSamples = 0;
    getCycleProgressByPhase(phaseState, 'phase2');
    phaseState.phaseCycleProgress.phase2 = createEmptyCycleProgress();
    phaseState.transitions.push(
        createTransition(
            GERMAN_PHASE_IDS.phase1,
            GERMAN_PHASE_IDS.phase2,
            'PHASE_1_EXIT_CRITERIA_MET',
            now,
        ),
    );

    log(
        'success',
        village,
        'Macro Fase 1',
        'Fase 1 completada. Iniciando Fase 2 (desbloqueo militar basico).',
        null,
        'economic',
    );
}

function transitionToPhaseThree(phaseState, now, log, village) {
    resetSubGoalOnPhaseTransition(phaseState, now);
    phaseState.activePhaseId = GERMAN_PHASE_IDS.phase3;
    phaseState.phase3StartedAt = now;
    getCycleProgressByPhase(phaseState, 'phase3');
    phaseState.phaseCycleProgress.phase3 = createEmptyCycleProgress();
    phaseState.transitions.push(
        createTransition(
            GERMAN_PHASE_IDS.phase2,
            GERMAN_PHASE_IDS.phase3,
            'PHASE_2_EXIT_CRITERIA_MET',
            now,
        ),
    );

    log(
        'success',
        village,
        'Macro Fase 2',
        'Fase 2 completada. Iniciando Fase 3 (produccion mixta sostenida).',
        null,
        'economic',
    );
}

function transitionToPhaseFour(phaseState, now, exit, log, village) {
    resetSubGoalOnPhaseTransition(phaseState, now);
    phaseState.activePhaseId = GERMAN_PHASE_IDS.phase4;
    phaseState.phase4StartedAt = now;
    phaseState.phase4MilitaryQueueSamples = 0;
    phaseState.phase4MilitaryQueueActiveSamples = 0;
    phaseState.phase4ConsecutiveActiveSamples = 0;
    getCycleProgressByPhase(phaseState, 'phase4');
    phaseState.phaseCycleProgress.phase4 = createEmptyCycleProgress();
    phaseState.transitions.push(
        createTransition(
            GERMAN_PHASE_IDS.phase3,
            GERMAN_PHASE_IDS.phase4,
            'PHASE_3_EXIT_CRITERIA_MET',
            now,
        ),
    );

    log(
        'success',
        village,
        'Macro Fase 3',
        `Fase 3 completada: avgCampos=${exit.fieldAverage.toFixed(2)}, ciclos=${exit.cycles.total}/${exit.cycleTargets.total}, ofensiva=${exit.cycles.offensiveInfantry}/${exit.cycleTargets.offensiveInfantry || 0}, scouts=${exit.cycles.scout}/${exit.cycleTargets.scout || 0}. Iniciando Fase 4.`,
        null,
        'economic',
    );
}

function transitionToPhaseFive(phaseState, now, exit, log, village) {
    resetSubGoalOnPhaseTransition(phaseState, now);
    phaseState.activePhaseId = GERMAN_PHASE_IDS.phase5;
    phaseState.phase5StartedAt = now;
    phaseState.phase5MilitaryQueueSamples = 0;
    phaseState.phase5MilitaryQueueActiveSamples = 0;
    phaseState.phase5ConsecutiveActiveSamples = 0;
    getCycleProgressByPhase(phaseState, 'phase5');
    phaseState.phaseCycleProgress.phase5 = createEmptyCycleProgress();
    phaseState.transitions.push(
        createTransition(
            GERMAN_PHASE_IDS.phase4,
            GERMAN_PHASE_IDS.phase5,
            'PHASE_4_EXIT_CRITERIA_MET',
            now,
        ),
    );

    log(
        'success',
        village,
        'Macro Fase 4',
        `Fase 4 completada: ciclos=${exit.cycles.total}/${exit.cycleTargets.total}. Iniciando Fase 5.`,
        null,
        'economic',
    );
}

function transitionToDone(phaseState, now, exit, log, village) {
    resetSubGoalOnPhaseTransition(phaseState, now);
    phaseState.activePhaseId = GERMAN_PHASE_IDS.phaseDone;
    phaseState.transitions.push(
        createTransition(
            GERMAN_PHASE_IDS.phase5,
            GERMAN_PHASE_IDS.phaseDone,
            'PHASE_5_EXIT_CRITERIA_MET',
            now,
        ),
    );

    const completionMode = exit.expansionReady ? 'expansion' : 'dominancia';
    log(
        'success',
        village,
        'Macro Fase 5',
        `Fase 5 completada por ${completionMode}: ciclos=${exit.cycles.total}/${exit.cycleTargets.total}, aldeasFundadas=${exit.expansion.settlementsFounded}, ciclosExpansion=${exit.expansion.expansionCycles}/${exit.expansion.expansionTarget}.`,
        null,
        'economic',
    );
}

const GERMAN_LEGACY_PHASE_ID_MAP = Object.freeze({
    german_phase_2_pending: GERMAN_PHASE_IDS.phase2,
    german_phase_3_pending: GERMAN_PHASE_IDS.phase3,
    german_phase_4_pending: GERMAN_PHASE_IDS.phase4,
    german_phase_5_pending: GERMAN_PHASE_IDS.phase5,
    german_phase_done: GERMAN_PHASE_IDS.phaseDone,
    german_phase_template_done: GERMAN_PHASE_IDS.phaseDone,
});

const GERMAN_CYCLE_BUCKET_ALIAS = Object.freeze({
    defensiveInfantry: 'defensiveInfantryMs',
    offensiveInfantry: 'offensiveInfantryMs',
    offensiveCavalry: 'offensiveCavalryMs',
    scout: 'scoutMs',
    ram: 'ramMs',
    catapult: 'catapultMs',
    expansion: 'expansionMs',
});

function normalizeGermanPhaseId(rawPhaseId, fallbackPhaseId) {
    const normalized = GERMAN_LEGACY_PHASE_ID_MAP[rawPhaseId] || rawPhaseId;
    if (Object.values(GERMAN_PHASE_IDS).includes(normalized)) {
        return normalized;
    }
    return fallbackPhaseId;
}

function normalizeGermanTransition(record) {
    if (!record || typeof record !== 'object') return null;

    const from = normalizeGermanPhaseId(
        record.from || record.fromPhase || record.phaseFrom,
        null,
    );
    const to = normalizeGermanPhaseId(
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

function normalizeGermanTransitions(rawTransitions) {
    if (!Array.isArray(rawTransitions)) return [];
    return rawTransitions
        .map(normalizeGermanTransition)
        .filter(Boolean);
}

function normalizeGermanCycleProgressEntry(rawEntry) {
    const normalized = createEmptyCycleProgress();
    if (!rawEntry || typeof rawEntry !== 'object') {
        return normalized;
    }

    for (const key of Object.keys(normalized)) {
        normalized[key] = Math.max(0, Number(rawEntry[key]) || 0);
    }

    const legacyTotalCycles = Number(rawEntry.total);
    if (Number.isFinite(legacyTotalCycles) && legacyTotalCycles > 0 && normalized.totalMs <= 0) {
        normalized.totalMs = Math.floor(legacyTotalCycles * TRAINING_CYCLE_MS);
    }

    for (const [legacyKey, bucketKey] of Object.entries(GERMAN_CYCLE_BUCKET_ALIAS)) {
        const value = Number(rawEntry[legacyKey]);
        if (Number.isFinite(value) && value > 0 && normalized[bucketKey] <= 0) {
            normalized[bucketKey] = Math.floor(value * TRAINING_CYCLE_MS);
        }
    }

    if (normalized.totalMs <= 0) {
        const bucketMs = Object.entries(normalized)
            .filter(([key]) => key !== 'totalMs')
            .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
        normalized.totalMs = Math.max(0, bucketMs);
    }

    return normalized;
}

function normalizeGermanPhaseCycleProgress(rawProgress) {
    const source = rawProgress && typeof rawProgress === 'object' ? rawProgress : {};
    const aliases = {
        phase2: ['phase2', 'phase_2'],
        phase3: ['phase3', 'phase_3'],
        phase4: ['phase4', 'phase_4'],
        phase5: ['phase5', 'phase_5'],
    };

    return {
        phase2: normalizeGermanCycleProgressEntry(source[aliases.phase2.find(key => key in source)]),
        phase3: normalizeGermanCycleProgressEntry(source[aliases.phase3.find(key => key in source)]),
        phase4: normalizeGermanCycleProgressEntry(source[aliases.phase4.find(key => key in source)]),
        phase5: normalizeGermanCycleProgressEntry(source[aliases.phase5.find(key => key in source)]),
    };
}

function normalizeGermanSubGoalRecord(rawSubGoal, fallbackPhaseId) {
    if (!rawSubGoal || typeof rawSubGoal !== 'object') return null;

    const blockedStep = cloneStep(rawSubGoal.blockedStep || rawSubGoal.step || null);
    const resolverStep = cloneStep(rawSubGoal.resolverStep || rawSubGoal.resolver || null);
    const kind = normalizePhaseSubGoalKind(rawSubGoal.kind || rawSubGoal.type, SUBGOAL_KIND);
    const phaseId = normalizeGermanPhaseId(rawSubGoal.phaseId, fallbackPhaseId);
    const reason = rawSubGoal.reason || rawSubGoal.blockReason || 'UNKNOWN';
    const queueType = rawSubGoal.queueType || getQueueTypeForStep(blockedStep || resolverStep);
    const createdAt = Number.isFinite(rawSubGoal.createdAt) ? rawSubGoal.createdAt : Date.now();

    return {
        id: rawSubGoal.id || `sg_${createdAt}_${Math.random().toString(36).slice(2, 7)}`,
        signature: rawSubGoal.signature || `${phaseId}|${kind}|${reason}|${getStepSignature(blockedStep)}|${getStepSignature(resolverStep)}`,
        kind,
        phaseId,
        source: rawSubGoal.source || 'hydrated',
        reason,
        priorityClass: rawSubGoal.priorityClass || 'general',
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

export function createDefaultGermanPhaseState(now = Date.now()) {
    return {
        activePhaseId: GERMAN_PHASE_IDS.phase1,
        startedAt: now,
        lastEvaluationAt: now,
        lastIdleLogAt: 0,
        lastConstructionReserveLogAt: 0,
        lastThreatOverrideLogAt: 0,
        transitions: [],
        phase1CompletedAt: null,
        phase2StartedAt: null,
        phase3StartedAt: null,
        phase4StartedAt: null,
        phase5StartedAt: null,
        phase2MilitaryQueueSamples: 0,
        phase2MilitaryQueueActiveSamples: 0,
        phase4MilitaryQueueSamples: 0,
        phase4MilitaryQueueActiveSamples: 0,
        phase4ConsecutiveActiveSamples: 0,
        phase5MilitaryQueueSamples: 0,
        phase5MilitaryQueueActiveSamples: 0,
        phase5ConsecutiveActiveSamples: 0,
        phaseCycleProgress: {
            phase2: createEmptyCycleProgress(),
            phase3: createEmptyCycleProgress(),
            phase4: createEmptyCycleProgress(),
            phase5: createEmptyCycleProgress(),
        },
        activeSubGoal: null,
        subGoalHistory: [],
    };
}

export function hydrateGermanPhaseState(rawState = null, now = Date.now()) {
    const fallback = createDefaultGermanPhaseState(now);
    if (!rawState || typeof rawState !== 'object') return fallback;

    const normalizedPhaseId = normalizeGermanPhaseId(rawState.activePhaseId, fallback.activePhaseId);
    const normalizedCycleProgress = normalizeGermanPhaseCycleProgress(rawState.phaseCycleProgress);
    const normalizedActiveSubGoal = normalizeGermanSubGoalRecord(rawState.activeSubGoal, normalizedPhaseId);
    const normalizedSubGoalHistory = Array.isArray(rawState.subGoalHistory)
        ? rawState.subGoalHistory
            .map(entry => normalizeGermanSubGoalRecord(entry, normalizedPhaseId))
            .filter(Boolean)
        : [];

    return {
        activePhaseId: normalizedPhaseId,
        startedAt: Number.isFinite(rawState.startedAt) ? rawState.startedAt : fallback.startedAt,
        lastEvaluationAt: Number.isFinite(rawState.lastEvaluationAt) ? rawState.lastEvaluationAt : fallback.lastEvaluationAt,
        lastIdleLogAt: Number.isFinite(rawState.lastIdleLogAt) ? rawState.lastIdleLogAt : 0,
        lastConstructionReserveLogAt: Number.isFinite(rawState.lastConstructionReserveLogAt) ? rawState.lastConstructionReserveLogAt : 0,
        lastThreatOverrideLogAt: Number.isFinite(rawState.lastThreatOverrideLogAt) ? rawState.lastThreatOverrideLogAt : 0,
        transitions: normalizeGermanTransitions(rawState.transitions),
        phase1CompletedAt: Number.isFinite(rawState.phase1CompletedAt) ? rawState.phase1CompletedAt : null,
        phase2StartedAt: Number.isFinite(rawState.phase2StartedAt) ? rawState.phase2StartedAt : null,
        phase3StartedAt: Number.isFinite(rawState.phase3StartedAt) ? rawState.phase3StartedAt : null,
        phase4StartedAt: Number.isFinite(rawState.phase4StartedAt) ? rawState.phase4StartedAt : null,
        phase5StartedAt: Number.isFinite(rawState.phase5StartedAt) ? rawState.phase5StartedAt : null,
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
        phase4MilitaryQueueSamples: Number.isFinite(rawState.phase4MilitaryQueueSamples)
            ? rawState.phase4MilitaryQueueSamples
            : Number.isFinite(rawState.phase4QueueSamples)
                ? rawState.phase4QueueSamples
                : 0,
        phase4MilitaryQueueActiveSamples: Number.isFinite(rawState.phase4MilitaryQueueActiveSamples)
            ? rawState.phase4MilitaryQueueActiveSamples
            : Number.isFinite(rawState.phase4QueueActiveSamples)
                ? rawState.phase4QueueActiveSamples
                : 0,
        phase4ConsecutiveActiveSamples: Number.isFinite(rawState.phase4ConsecutiveActiveSamples) ? rawState.phase4ConsecutiveActiveSamples : 0,
        phase5MilitaryQueueSamples: Number.isFinite(rawState.phase5MilitaryQueueSamples)
            ? rawState.phase5MilitaryQueueSamples
            : Number.isFinite(rawState.phase5QueueSamples)
                ? rawState.phase5QueueSamples
                : 0,
        phase5MilitaryQueueActiveSamples: Number.isFinite(rawState.phase5MilitaryQueueActiveSamples)
            ? rawState.phase5MilitaryQueueActiveSamples
            : Number.isFinite(rawState.phase5QueueActiveSamples)
                ? rawState.phase5QueueActiveSamples
                : 0,
        phase5ConsecutiveActiveSamples: Number.isFinite(rawState.phase5ConsecutiveActiveSamples) ? rawState.phase5ConsecutiveActiveSamples : 0,
        phaseCycleProgress: normalizedCycleProgress,
        activeSubGoal: normalizedActiveSubGoal,
        subGoalHistory: normalizedSubGoalHistory,
    };
}

export function serializeGermanPhaseStates(stateByVillageMap) {
    const serialized = {};
    for (const [villageId, state] of stateByVillageMap.entries()) {
        serialized[villageId] = {
            schemaVersion: 2,
            activePhaseId: state.activePhaseId,
            startedAt: state.startedAt,
            lastEvaluationAt: state.lastEvaluationAt,
            lastIdleLogAt: state.lastIdleLogAt,
            lastConstructionReserveLogAt: state.lastConstructionReserveLogAt,
            lastThreatOverrideLogAt: state.lastThreatOverrideLogAt,
            transitions: state.transitions,
            phase1CompletedAt: state.phase1CompletedAt,
            phase2StartedAt: state.phase2StartedAt,
            phase3StartedAt: state.phase3StartedAt,
            phase4StartedAt: state.phase4StartedAt,
            phase5StartedAt: state.phase5StartedAt,
            phase2MilitaryQueueSamples: state.phase2MilitaryQueueSamples,
            phase2MilitaryQueueActiveSamples: state.phase2MilitaryQueueActiveSamples,
            phase4MilitaryQueueSamples: state.phase4MilitaryQueueSamples,
            phase4MilitaryQueueActiveSamples: state.phase4MilitaryQueueActiveSamples,
            phase4ConsecutiveActiveSamples: state.phase4ConsecutiveActiveSamples,
            phase5MilitaryQueueSamples: state.phase5MilitaryQueueSamples,
            phase5MilitaryQueueActiveSamples: state.phase5MilitaryQueueActiveSamples,
            phase5ConsecutiveActiveSamples: state.phase5ConsecutiveActiveSamples,
            phaseCycleProgress: state.phaseCycleProgress,
            activeSubGoal: state.activeSubGoal,
            subGoalHistory: state.subGoalHistory,
        };
    }
    return serialized;
}

export function runGermanEconomicPhaseCycle({
    village,
    gameState,
    phaseState,
    difficulty,
    gameSpeed,
    villageCombatState,
    actionExecutor,
    log,
}) {
    const now = Date.now();
    const threatContext = normalizeVillageCombatState(villageCombatState, now);
    const previousEvaluationAt = Number.isFinite(phaseState.lastEvaluationAt) ? phaseState.lastEvaluationAt : now;
    const evaluationDeltaMs = Math.max(0, now - previousEvaluationAt);
    phaseState.lastEvaluationAt = now;

    if (phaseState.activePhaseId === GERMAN_PHASE_IDS.phaseDone) {
        return { handled: true, phaseState };
    }

    if (phaseState.activePhaseId === GERMAN_PHASE_IDS.phase1) {
        ensurePhaseOneRatio({ village, difficulty, log, phaseState, threatContext, now });

        const exit = evaluatePhaseOneExit(village, phaseState, difficulty);
        if (exit.ready) {
            phaseState.phase1CompletedAt = now;
            transitionToPhaseTwo(phaseState, now, log, village);
        }
    }

    if (phaseState.activePhaseId === GERMAN_PHASE_IDS.phase1) {
        const phaseOneThreatFilter = createThreatConstructionFilter({
            threatContext,
            phaseState,
            village,
            log,
            now,
        });

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

        const phaseOneLaneHandling = runAndHandlePhaseLaneMatrix({
            phaseState,
            phaseId: GERMAN_PHASE_IDS.phase1,
            village,
            gameSpeed,
            log,
            lanes: [
                {
                    id: 'construction',
                    source: 'phase1_lane_construction',
                    execute: () => pickPhaseLaneResult([
                        tryPhaseOnePriorityConstruction({
                            village,
                            gameState,
                            actionExecutor,
                            phaseState,
                            shouldAttemptConstructionStep: phaseOneThreatFilter,
                        }),
                        tryPhaseOneFallbackConstruction({
                            village,
                            gameState,
                            actionExecutor,
                            phaseState,
                            shouldAttemptConstructionStep: phaseOneThreatFilter,
                        }),
                    ], 'NO_ACTION'),
                },
                {
                    id: 'research',
                    source: 'phase1_lane_research',
                    execute: () => ({ success: false, reason: 'NO_ACTION' }),
                },
                {
                    id: 'upgrade',
                    source: 'phase1_lane_upgrade',
                    execute: () => ({ success: false, reason: 'NO_ACTION' }),
                },
                {
                    id: 'recruitment',
                    source: 'phase1_lane_recruitment',
                    onSuccess: successResult => registerRecruitmentCommitFromAction({
                        result: successResult,
                        phaseState,
                        phaseId: GERMAN_PHASE_IDS.phase1,
                        village,
                        difficulty,
                        log,
                    }),
                    execute: () => tryPhaseOnePriorityRecruitment({
                        village,
                        gameState,
                        actionExecutor,
                        phaseState,
                    }),
                },
            ],
        });

        if (phaseOneLaneHandling.terminal) {
            return { handled: true, phaseState };
        }

        const canLogIdle = now - phaseState.lastIdleLogAt >= PHASE_ONE_PRIORITY.minIdleLogIntervalMs;
        if (canLogIdle) {
            phaseState.lastIdleLogAt = now;
            log(
                'info',
                village,
                'Macro Fase 1',
                'Sin accion en este ciclo: esperando presupuesto/cola libre para prioridad o fallback.',
                null,
                'economic',
            );
        }

        return { handled: true, phaseState };
    }

    if (phaseState.activePhaseId !== GERMAN_PHASE_IDS.phase2) {
        if (phaseState.activePhaseId !== GERMAN_PHASE_IDS.phase3) {
            if (phaseState.activePhaseId !== GERMAN_PHASE_IDS.phase4) {
                if (phaseState.activePhaseId !== GERMAN_PHASE_IDS.phase5) {
                    return { handled: false, phaseState };
                }
            }
        }
    }

    if (phaseState.activePhaseId === GERMAN_PHASE_IDS.phase2) {
        ensurePhaseTwoRatio({ village, difficulty, log, phaseState, threatContext, now });
        updatePhaseTwoQueueTelemetry(phaseState, village, evaluationDeltaMs);
        const phaseTwoConstructionReserveFilter = createConstructionStepFilter({
            phaseState,
            phaseId: GERMAN_PHASE_IDS.phase2,
            village,
            log,
        });
        const phaseTwoThreatFilter = createThreatConstructionFilter({
            threatContext,
            phaseState,
            village,
            log,
            now,
        });
        const phaseTwoConstructionFilter = composeStepFilters(phaseTwoConstructionReserveFilter, phaseTwoThreatFilter);

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

        const phase2Exit = evaluatePhaseTwoExit(village, phaseState, difficulty);
        if (phase2Exit.ready) {
            transitionToPhaseThree(phaseState, now, log, village);
        }

        if (phaseState.activePhaseId === GERMAN_PHASE_IDS.phase2) {
            const phaseTwoEmergencyRecruitmentResult = tryThreatEmergencyRecruitment({
                village,
                gameState,
                actionExecutor,
                difficulty,
                threatContext,
            });
            const phaseTwoEmergencyRecruitmentHandling = handlePhaseActionResult({
                result: phaseTwoEmergencyRecruitmentResult,
                phaseState,
                phaseId: GERMAN_PHASE_IDS.phase2,
                source: 'phase2_threat_emergency_recruitment',
                village,
                gameSpeed,
                log,
                onSuccess: successResult => registerRecruitmentCommitFromAction({
                    result: successResult,
                    phaseState,
                    phaseId: GERMAN_PHASE_IDS.phase2,
                    village,
                    difficulty,
                    log,
                }),
            });
            if (phaseTwoEmergencyRecruitmentHandling.terminal) {
                return { handled: true, phaseState };
            }

            const phaseTwoLaneHandling = runAndHandlePhaseLaneMatrix({
                phaseState,
                phaseId: GERMAN_PHASE_IDS.phase2,
                village,
                gameSpeed,
                log,
                lanes: [
                    {
                        id: 'construction',
                        source: 'phase2_lane_construction',
                        execute: () => pickPhaseLaneResult([
                            tryPhaseTwoPriorityConstruction({
                                village,
                                gameState,
                                actionExecutor,
                                phaseState,
                                shouldAttemptConstructionStep: phaseTwoConstructionFilter,
                            }),
                            tryPhaseTwoFallbackConstruction({
                                village,
                                gameState,
                                actionExecutor,
                                phaseState,
                                shouldAttemptConstructionStep: phaseTwoConstructionFilter,
                            }),
                        ], 'NO_ACTION'),
                    },
                    {
                        id: 'research',
                        source: 'phase2_lane_research',
                        execute: () => tryPhaseTwoPriorityResearch({ village, gameState, actionExecutor, phaseState }),
                    },
                    {
                        id: 'upgrade',
                        source: 'phase2_lane_upgrade',
                        execute: () => ({ success: false, reason: 'NO_ACTION' }),
                    },
                    {
                        id: 'recruitment',
                        source: 'phase2_lane_recruitment',
                        onSuccess: successResult => registerRecruitmentCommitFromAction({
                            result: successResult,
                            phaseState,
                            phaseId: GERMAN_PHASE_IDS.phase2,
                            village,
                            difficulty,
                            log,
                        }),
                        execute: () => pickPhaseLaneResult([
                            tryPhaseTwoPriorityRecruitment({ village, gameState, actionExecutor, phaseState }),
                            tryPhaseTwoFallbackRecruitment({ village, gameState, actionExecutor, phaseState }),
                        ], 'NO_ACTION'),
                    },
                ],
            });

            if (phaseTwoLaneHandling.terminal) {
                return { handled: true, phaseState };
            }

            const canLogPhaseTwoIdle = now - phaseState.lastIdleLogAt >= PHASE_TWO_PRIORITY.minIdleLogIntervalMs;
            if (canLogPhaseTwoIdle) {
                phaseState.lastIdleLogAt = now;
                log(
                    'info',
                    village,
                    'Macro Fase 2',
                    'Sin accion en este ciclo: esperando presupuesto/cola libre para desbloqueo militar basico.',
                    null,
                    'economic',
                );
            }

            return { handled: true, phaseState };
        }
    }

    if (phaseState.activePhaseId === GERMAN_PHASE_IDS.phase3) {
        ensurePhaseThreeRatio({ village, difficulty, log, phaseState, threatContext, now });
        updatePhaseThreeQueueTelemetry(phaseState, village, evaluationDeltaMs);
        const phaseThreeConstructionReserveFilter = createConstructionStepFilter({
            phaseState,
            phaseId: GERMAN_PHASE_IDS.phase3,
            village,
            log,
        });
        const phaseThreeThreatFilter = createThreatConstructionFilter({
            threatContext,
            phaseState,
            village,
            log,
            now,
        });
        const phaseThreeConstructionFilter = composeStepFilters(phaseThreeConstructionReserveFilter, phaseThreeThreatFilter);

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

        const phase3Exit = evaluatePhaseThreeExit(village, phaseState, difficulty);
        if (phase3Exit.ready) {
            transitionToPhaseFour(phaseState, now, phase3Exit, log, village);
        }

        if (phaseState.activePhaseId === GERMAN_PHASE_IDS.phase3) {
            const phaseThreeEmergencyRecruitmentResult = tryThreatEmergencyRecruitment({
                village,
                gameState,
                actionExecutor,
                difficulty,
                threatContext,
            });
            const phaseThreeEmergencyRecruitmentHandling = handlePhaseActionResult({
                result: phaseThreeEmergencyRecruitmentResult,
                phaseState,
                phaseId: GERMAN_PHASE_IDS.phase3,
                source: 'phase3_threat_emergency_recruitment',
                village,
                gameSpeed,
                log,
                onSuccess: successResult => registerRecruitmentCommitFromAction({
                    result: successResult,
                    phaseState,
                    phaseId: GERMAN_PHASE_IDS.phase3,
                    village,
                    difficulty,
                    log,
                }),
            });
            if (phaseThreeEmergencyRecruitmentHandling.terminal) {
                return { handled: true, phaseState };
            }

            const phaseThreeLaneHandling = runAndHandlePhaseLaneMatrix({
                phaseState,
                phaseId: GERMAN_PHASE_IDS.phase3,
                village,
                gameSpeed,
                log,
                lanes: [
                    {
                        id: 'construction',
                        source: 'phase3_lane_construction',
                        execute: () => pickPhaseLaneResult([
                            tryPhaseThreePriorityConstruction({
                                village,
                                gameState,
                                actionExecutor,
                                phaseState,
                                shouldAttemptConstructionStep: phaseThreeConstructionFilter,
                            }),
                            tryPhaseThreeFallbackConstruction({
                                village,
                                gameState,
                                actionExecutor,
                                phaseState,
                                shouldAttemptConstructionStep: phaseThreeConstructionFilter,
                            }),
                        ], 'NO_ACTION'),
                    },
                    {
                        id: 'research',
                        source: 'phase3_lane_research',
                        execute: () => tryPhaseThreePriorityResearch({ village, gameState, actionExecutor, phaseState }),
                    },
                    {
                        id: 'upgrade',
                        source: 'phase3_lane_upgrade',
                        execute: () => ({ success: false, reason: 'NO_ACTION' }),
                    },
                    {
                        id: 'recruitment',
                        source: 'phase3_lane_recruitment',
                        onSuccess: successResult => registerRecruitmentCommitFromAction({
                            result: successResult,
                            phaseState,
                            phaseId: GERMAN_PHASE_IDS.phase3,
                            village,
                            difficulty,
                            log,
                        }),
                        execute: () => pickPhaseLaneResult([
                            tryPhaseThreePriorityRecruitment({ village, gameState, actionExecutor, phaseState }),
                            tryPhaseThreeFallbackRecruitment({ village, gameState, actionExecutor, phaseState }),
                        ], 'NO_ACTION'),
                    },
                ],
            });

            if (phaseThreeLaneHandling.terminal) {
                return { handled: true, phaseState };
            }

            const canLogPhaseThreeIdle = now - phaseState.lastIdleLogAt >= PHASE_THREE_PRIORITY.minIdleLogIntervalMs;
            if (canLogPhaseThreeIdle) {
                phaseState.lastIdleLogAt = now;
                log(
                    'info',
                    village,
                    'Macro Fase 3',
                    'Sin accion en este ciclo: esperando presupuesto/cola libre para produccion mixta sostenida.',
                    null,
                    'economic',
                );
            }

            return { handled: true, phaseState };
        }
    }

    if (phaseState.activePhaseId === GERMAN_PHASE_IDS.phase4) {
        ensurePhaseFourRatio({ village, difficulty, log, phaseState, threatContext, now });
        updatePhaseFourQueueTelemetry(phaseState, village, evaluationDeltaMs);
        const phaseFourConstructionReserveFilter = createConstructionStepFilter({
            phaseState,
            phaseId: GERMAN_PHASE_IDS.phase4,
            village,
            log,
        });
        const phaseFourThreatFilter = createThreatConstructionFilter({
            threatContext,
            phaseState,
            village,
            log,
            now,
        });
        const phaseFourConstructionFilter = composeStepFilters(phaseFourConstructionReserveFilter, phaseFourThreatFilter);

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

        const phase4Exit = evaluatePhaseFourExit(village, phaseState, difficulty);
        if (phase4Exit.ready) {
            transitionToPhaseFive(phaseState, now, phase4Exit, log, village);
        }

        if (phaseState.activePhaseId === GERMAN_PHASE_IDS.phase4) {
            const phaseFourEmergencyRecruitmentResult = tryThreatEmergencyRecruitment({
                village,
                gameState,
                actionExecutor,
                difficulty,
                threatContext,
            });
            const phaseFourEmergencyRecruitmentHandling = handlePhaseActionResult({
                result: phaseFourEmergencyRecruitmentResult,
                phaseState,
                phaseId: GERMAN_PHASE_IDS.phase4,
                source: 'phase4_threat_emergency_recruitment',
                village,
                gameSpeed,
                log,
                onSuccess: successResult => registerRecruitmentCommitFromAction({
                    result: successResult,
                    phaseState,
                    phaseId: GERMAN_PHASE_IDS.phase4,
                    village,
                    difficulty,
                    log,
                }),
            });
            if (phaseFourEmergencyRecruitmentHandling.terminal) {
                return { handled: true, phaseState };
            }

            const phaseFourLaneHandling = runAndHandlePhaseLaneMatrix({
                phaseState,
                phaseId: GERMAN_PHASE_IDS.phase4,
                village,
                gameSpeed,
                log,
                lanes: [
                    {
                        id: 'construction',
                        source: 'phase4_lane_construction',
                        execute: () => pickPhaseLaneResult([
                            tryPhaseFourPriorityConstruction({
                                village,
                                gameState,
                                actionExecutor,
                                phaseState,
                                shouldAttemptConstructionStep: phaseFourConstructionFilter,
                            }),
                            tryPhaseFourFallbackConstruction({
                                village,
                                gameState,
                                actionExecutor,
                                phaseState,
                                shouldAttemptConstructionStep: phaseFourConstructionFilter,
                            }),
                        ], 'NO_ACTION'),
                    },
                    {
                        id: 'research',
                        source: 'phase4_lane_research',
                        execute: () => tryPhaseFourPriorityResearch({ village, gameState, actionExecutor, phaseState }),
                    },
                    {
                        id: 'upgrade',
                        source: 'phase4_lane_upgrade',
                        execute: () => ({ success: false, reason: 'NO_ACTION' }),
                    },
                    {
                        id: 'recruitment',
                        source: 'phase4_lane_recruitment',
                        onSuccess: successResult => registerRecruitmentCommitFromAction({
                            result: successResult,
                            phaseState,
                            phaseId: GERMAN_PHASE_IDS.phase4,
                            village,
                            difficulty,
                            log,
                        }),
                        execute: () => pickPhaseLaneResult([
                            tryPhaseFourPriorityRecruitment({ village, gameState, actionExecutor, phaseState }),
                            tryPhaseFourFallbackRecruitment({ village, gameState, actionExecutor, phaseState }),
                        ], 'NO_ACTION'),
                    },
                ],
            });

            if (phaseFourLaneHandling.terminal) {
                return { handled: true, phaseState };
            }

            const canLogPhaseFourIdle = now - phaseState.lastIdleLogAt >= PHASE_FOUR_PRIORITY.minIdleLogIntervalMs;
            if (canLogPhaseFourIdle) {
                phaseState.lastIdleLogAt = now;
                log(
                    'info',
                    village,
                    'Macro Fase 4',
                    'Sin accion en este ciclo: esperando presupuesto/cola libre para presion militar y tech.',
                    null,
                    'economic',
                );
            }

            return { handled: true, phaseState };
        }
    }

    if (phaseState.activePhaseId !== GERMAN_PHASE_IDS.phase5) {
        return { handled: false, phaseState };
    }

    ensurePhaseFiveRatio({ village, difficulty, log, phaseState, threatContext, now });
    updatePhaseFiveQueueTelemetry(phaseState, village, evaluationDeltaMs);
    const phaseFiveConstructionReserveFilter = createConstructionStepFilter({
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase5,
        village,
        log,
    });
    const phaseFiveThreatFilter = createThreatConstructionFilter({
        threatContext,
        phaseState,
        village,
        log,
        now,
    });
    const phaseFiveConstructionFilter = composeStepFilters(phaseFiveConstructionReserveFilter, phaseFiveThreatFilter);

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

    const phase5Exit = evaluatePhaseFiveExit(village, phaseState, difficulty);
    if (phase5Exit.ready) {
        transitionToDone(phaseState, now, phase5Exit, log, village);
        return { handled: true, phaseState };
    }

    const phaseFiveEmergencyRecruitmentResult = tryThreatEmergencyRecruitment({
        village,
        gameState,
        actionExecutor,
        difficulty,
        threatContext,
    });
    const phaseFiveEmergencyRecruitmentHandling = handlePhaseActionResult({
        result: phaseFiveEmergencyRecruitmentResult,
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase5,
        source: 'phase5_threat_emergency_recruitment',
        village,
        gameSpeed,
        log,
        onSuccess: successResult => registerRecruitmentCommitFromAction({
            result: successResult,
            phaseState,
            phaseId: GERMAN_PHASE_IDS.phase5,
            village,
            difficulty,
            log,
        }),
    });
    if (phaseFiveEmergencyRecruitmentHandling.terminal) {
        return { handled: true, phaseState };
    }

    const phaseFiveLaneHandling = runAndHandlePhaseLaneMatrix({
        phaseState,
        phaseId: GERMAN_PHASE_IDS.phase5,
        village,
        gameSpeed,
        log,
        lanes: [
            {
                id: 'construction',
                source: 'phase5_lane_construction',
                execute: () => pickPhaseLaneResult([
                    tryPhaseFivePriorityConstruction({
                        village,
                        gameState,
                        actionExecutor,
                        phaseState,
                        shouldAttemptConstructionStep: phaseFiveConstructionFilter,
                    }),
                    tryPhaseFiveFallbackConstruction({
                        village,
                        gameState,
                        actionExecutor,
                        phaseState,
                        shouldAttemptConstructionStep: phaseFiveConstructionFilter,
                    }),
                ], 'NO_ACTION'),
            },
            {
                id: 'research',
                source: 'phase5_lane_research',
                execute: () => tryPhaseFivePriorityResearch({ village, gameState, actionExecutor, phaseState }),
            },
            {
                id: 'upgrade',
                source: 'phase5_lane_upgrade',
                execute: () => ({ success: false, reason: 'NO_ACTION' }),
            },
            {
                id: 'recruitment',
                source: 'phase5_lane_recruitment',
                onSuccess: successResult => registerRecruitmentCommitFromAction({
                    result: successResult,
                    phaseState,
                    phaseId: GERMAN_PHASE_IDS.phase5,
                    village,
                    difficulty,
                    log,
                }),
                execute: () => pickPhaseLaneResult([
                    tryPhaseFivePriorityRecruitment({ village, gameState, actionExecutor, phaseState }),
                    tryPhaseFiveFallbackRecruitment({ village, gameState, actionExecutor, phaseState }),
                ], 'NO_ACTION'),
            },
        ],
    });

    if (phaseFiveLaneHandling.terminal) {
        return { handled: true, phaseState };
    }

    const canLogPhaseFiveIdle = now - phaseState.lastIdleLogAt >= PHASE_FIVE_PRIORITY.minIdleLogIntervalMs;
    if (canLogPhaseFiveIdle) {
        phaseState.lastIdleLogAt = now;
        log(
            'info',
            village,
            'Macro Fase 5',
            'Sin accion en este ciclo: esperando presupuesto/cola libre para asedio y expansion.',
            null,
            'economic',
        );
    }

    return { handled: true, phaseState };
}
