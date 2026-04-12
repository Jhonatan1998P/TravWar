import { RESOURCE_FIELD_BUILDING_TYPES } from '../../core/data/constants.js';
import { getRaceTroops } from '../../core/data/lookups.js';
import { rebalanceVillageBudgetToRatio, BUDGET_REBALANCE_INTERVAL_GAME_MS } from '../../state/worker/budget.js';

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
});

const PHASE_FOUR_EXIT = Object.freeze({
    minWallLevel: 10,
    minMarketplaceLevel: 6,
    minStableLevel: 3,
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

const THREAT_LEVEL_BOOST = Object.freeze({
    none: 0,
    low: 0,
    medium: 0.06,
    high: 0.14,
    critical: 0.22,
});

const PHASE_IDLE_LOG_MS = 20_000;
const EXPANSION_CHECK_MS = 25_000;

function getDifficultyTemplate(difficulty) {
    return PHASE_TEMPLATE_BY_DIFFICULTY[difficulty] || PHASE_TEMPLATE_BY_DIFFICULTY.Pesadilla;
}

function createTransition(from, to, reason, now) {
    return {
        from,
        to,
        reason,
        at: now,
        status: 'phase_transition',
    };
}

function getBuilding(village, buildingType) {
    return village.buildings.find(building => building.type === buildingType) || null;
}

function getBuildingLevel(village, buildingType) {
    const building = getBuilding(village, buildingType);
    return building?.level || 0;
}

function getEffectiveBuildingLevel(village, buildingType) {
    const building = getBuilding(village, buildingType);
    if (!building) return 0;
    const queued = village.constructionQueue.filter(job => job.buildingId === building.id).length;
    return (building.level || 0) + queued;
}

function getAverageResourceFieldLevel(village) {
    const fields = village.buildings.filter(building => RESOURCE_FIELD_BUILDING_TYPES.includes(building.type));
    if (fields.length === 0) return 0;
    const total = fields.reduce((sum, field) => sum + (field.level || 0), 0);
    return total / fields.length;
}

function getUnitCount(village, unitId) {
    const inVillage = village.unitsInVillage?.[unitId] || 0;
    const inQueue = village.recruitmentQueue
        .filter(job => job.unitId === unitId)
        .reduce((sum, job) => sum + (job.remainingCount ?? job.count ?? 0), 0);
    return inVillage + inQueue;
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
    const template = getDifficultyTemplate(difficulty);
    const phaseConfig = template[phaseId] || template.phase6;
    const baseRatio = phaseConfig.ratio;
    const boost = THREAT_LEVEL_BOOST[threatContext.threatLevel] || 0;
    const mil = Math.min(0.85, baseRatio.mil + boost);
    const ratio = { econ: 1 - mil, mil };

    const rebalanceDue = !Number.isFinite(phaseState.lastBudgetRebalanceAt)
        || (now - phaseState.lastBudgetRebalanceAt) >= BUDGET_REBALANCE_INTERVAL_GAME_MS;
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

function tryConstructionPriority({ actionExecutor, village, gameState, options }) {
    for (const step of options) {
        const result = tryStep(actionExecutor, village, gameState, step);
        if (result?.success) return result;
        if (result?.reason === 'QUEUE_FULL') return result;
    }
    return { success: false, reason: 'NO_ACTION' };
}

function tryRecruitmentPriority({ actionExecutor, village, gameState, options }) {
    for (const step of options) {
        const result = tryStep(actionExecutor, village, gameState, step);
        if (result?.success) return result;
        if (result?.reason === 'QUEUE_FULL') return result;
    }
    return { success: false, reason: 'NO_ACTION' };
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
    phaseState.activePhaseId = to;
    phaseState.transitions.push(createTransition(from, to, reason, now));
    phaseState.activeSubGoal = null;
    log('success', village, 'Macro Egipcia', `Transicion ${from} -> ${to}.`, { reason }, 'economic');
}

function runThreatEmergencyBlock({ actionExecutor, village, gameState, threatContext }) {
    if (!threatContext.shouldBoostEmergencyRecruitment) {
        return { success: false, reason: 'NO_EMERGENCY' };
    }

    return tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        options: [
            { type: 'units', unitType: 'ash_warden_egypt', count: Infinity, queueTargetMinutes: 4 },
            { type: 'units', unitType: 'anhur_guard_egypt', count: Infinity, queueTargetMinutes: 3 },
            { type: 'units', unitType: 'slave_militia_egypt', count: Infinity, queueTargetMinutes: 3 },
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

function getQueueUptime(samples, active) {
    const normalizedSamples = Math.max(samples || 0, 0);
    const normalizedActive = Math.max(active || 0, 0);
    if (normalizedSamples <= 0) return 0;
    return normalizedActive / normalizedSamples;
}

function updatePhaseTwoQueueTelemetry(phaseState, village) {
    phaseState.phase2MilitaryQueueSamples = Math.max(0, phaseState.phase2MilitaryQueueSamples || 0) + 1;
    const hasMilitaryQueue = (village.recruitmentQueue || []).some(job => {
        if (!job?.unitId) return false;
        return job.unitId.includes('_egypt');
    });
    if (hasMilitaryQueue) {
        phaseState.phase2MilitaryQueueActiveSamples = Math.max(0, phaseState.phase2MilitaryQueueActiveSamples || 0) + 1;
    }
}

function evaluatePhaseTwoExit(village) {
    const barracks = getEffectiveBuildingLevel(village, 'barracks');
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    return barracks >= PHASE_TWO_EXIT.minBarracksLevel && wall >= PHASE_TWO_EXIT.minWallLevel;
}

function evaluatePhaseTwoQueueExit(phaseState) {
    const samples = Math.max(phaseState.phase2MilitaryQueueSamples || 0, 0);
    const active = Math.max(phaseState.phase2MilitaryQueueActiveSamples || 0, 0);
    if (samples < PHASE_TWO_EXIT.minSamples) return false;
    return getQueueUptime(samples, active) >= PHASE_TWO_EXIT.militaryQueueUptimeTarget;
}

function evaluatePhaseThreeExit(village) {
    const avgFields = getAverageResourceFieldLevel(village);
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    const academy = getEffectiveBuildingLevel(village, 'academy');
    const smithy = getEffectiveBuildingLevel(village, 'smithy');
    return avgFields >= PHASE_THREE_EXIT.minAverageResourceFieldLevel
        && wall >= PHASE_THREE_EXIT.minWallLevel
        && academy >= PHASE_THREE_EXIT.minAcademyLevel
        && smithy >= PHASE_THREE_EXIT.minSmithyLevel;
}

function evaluatePhaseFourExit(village, phaseState) {
    const wall = getEffectiveBuildingLevel(village, 'cityWall');
    const marketplace = getEffectiveBuildingLevel(village, 'marketplace');
    const stable = getEffectiveBuildingLevel(village, 'stable');
    const latestPressure = phaseState.storagePressureHistory?.[phaseState.storagePressureHistory.length - 1]?.value || 0;
    return wall >= PHASE_FOUR_EXIT.minWallLevel
        && marketplace >= PHASE_FOUR_EXIT.minMarketplaceLevel
        && stable >= PHASE_FOUR_EXIT.minStableLevel
        && latestPressure <= PHASE_FOUR_EXIT.maxStoragePressure
        && (phaseState.defenseReadinessScore || 0) >= PHASE_FOUR_EXIT.minDefenseReadinessScore;
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

function runPhaseOne({ village, gameState, actionExecutor, threatContext }) {
    if (isHighThreat(threatContext)) {
        const emergencyWall = tryConstructionPriority({
            actionExecutor,
            village,
            gameState,
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
        options: [
            { type: 'resource_fields_level', level: 4 },
            { type: 'building', buildingType: 'warehouse', level: 6 },
            { type: 'building', buildingType: 'granary', level: 6 },
            { type: 'building', buildingType: 'mainBuilding', level: 5 },
            { type: 'building', buildingType: 'cityWall', level: 3 },
        ],
    });
    if (construction.success) return construction;

    return tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        options: [
            { type: 'units', unitType: 'slave_militia_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase1 },
            { type: 'units', unitType: 'ash_warden_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase1 },
        ],
    });
}

function runPhaseTwo({ village, gameState, actionExecutor, threatContext }) {
    const construction = tryConstructionPriority({
        actionExecutor,
        village,
        gameState,
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
        options: [
            { type: 'units', unitType: 'slave_militia_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase2 },
            { type: 'units', unitType: 'ash_warden_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase2 },
            { type: 'units', unitType: 'sopdu_explorer_egypt', count: 8 },
        ],
    });
    if (recruitment.success) return recruitment;

    if (isHighThreat(threatContext)) {
        return tryConstructionPriority({
            actionExecutor,
            village,
            gameState,
            options: [{ type: 'building', buildingType: 'cityWall', level: 7 }],
        });
    }

    return recruitment;
}

function runPhaseThree({ village, gameState, actionExecutor }) {
    const construction = tryConstructionPriority({
        actionExecutor,
        village,
        gameState,
        options: [
            { type: 'building', buildingType: 'warehouse', level: 10 },
            { type: 'building', buildingType: 'granary', level: 10 },
            { type: 'building', buildingType: 'cityWall', level: 8 },
            { type: 'building', buildingType: 'barracks', level: 6 },
            { type: 'building', buildingType: 'academy', level: 4 },
            { type: 'building', buildingType: 'smithy', level: 4 },
            { type: 'building', buildingType: 'stable', level: 3 },
            { type: 'resource_fields_level', level: 6 },
        ],
    });
    if (construction.success) return construction;

    return tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        options: [
            { type: 'units', unitType: 'ash_warden_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase3 },
            { type: 'units', unitType: 'sopdu_explorer_egypt', count: 12 },
            { type: 'units', unitType: 'anhur_guard_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase3 },
        ],
    });
}

function runPhaseFour({ village, gameState, actionExecutor }) {
    const construction = tryConstructionPriority({
        actionExecutor,
        village,
        gameState,
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

    return tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        options: [
            { type: 'units', unitType: 'ash_warden_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase4 },
            { type: 'units', unitType: 'anhur_guard_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase4 },
            { type: 'units', unitType: 'sopdu_explorer_egypt', count: 16 },
            { type: 'units', unitType: 'khopesh_warrior_egypt', count: 40 },
        ],
    });
}

function canAttemptSafeExpansion({ threatContext, phaseState }) {
    const blockedByThreat = threatContext.threatLevel === 'high' || threatContext.threatLevel === 'critical';
    if (blockedByThreat) return false;
    return (phaseState.defenseReadinessScore || 0) >= 85;
}

function runPhaseFive({ village, gameState, actionExecutor, phaseState, now, threatContext }) {
    const construction = tryConstructionPriority({
        actionExecutor,
        village,
        gameState,
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

    const recruitment = tryRecruitmentPriority({
        actionExecutor,
        village,
        gameState,
        options: [
            { type: 'units', unitType: 'ash_warden_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase5 },
            { type: 'units', unitType: 'anhur_guard_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase5 },
            { type: 'units', unitType: 'settler_egypt', count: 3 },
            { type: 'units', unitType: 'nomarch_egypt', count: 1 },
            { type: 'units', unitType: 'resheph_chariot_egypt', count: 25 },
            { type: 'units', unitType: 'ram_egypt', count: 6 },
            { type: 'units', unitType: 'catapult_egypt', count: 3 },
        ],
    });
    if (recruitment.success) return recruitment;

    if ((now - phaseState.lastSafeExpansionCheckAt) >= EXPANSION_CHECK_MS && canAttemptSafeExpansion({ threatContext, phaseState })) {
        const villages = gameState.villages.filter(candidate => candidate.ownerId === village.ownerId);
        actionExecutor.executeGoalAction({ type: 'settle_new_village' }, villages, gameState);
        phaseState.lastSafeExpansionCheckAt = now;
        return { success: true, reason: 'EXPANSION_ATTEMPTED' };
    }

    return { success: false, reason: 'NO_ACTION' };
}

function runPhaseSix({ village, gameState, actionExecutor, phaseState, now, threatContext }) {
    const construction = tryConstructionPriority({
        actionExecutor,
        village,
        gameState,
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
        options: [
            { type: 'units', unitType: 'ash_warden_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase6 },
            { type: 'units', unitType: 'anhur_guard_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase6 },
            { type: 'units', unitType: 'resheph_chariot_egypt', count: Infinity, queueTargetMinutes: RECRUITMENT_QUEUE_TARGET_MINUTES_CONFIG.phase6 },
            { type: 'units', unitType: 'ram_egypt', count: Infinity, queueTargetMinutes: 2 },
            { type: 'units', unitType: 'catapult_egypt', count: Infinity, queueTargetMinutes: 2 },
        ],
    });
    if (recruitment.success) return recruitment;

    if ((now - phaseState.lastSafeExpansionCheckAt) >= EXPANSION_CHECK_MS && canAttemptSafeExpansion({ threatContext, phaseState })) {
        const villages = gameState.villages.filter(candidate => candidate.ownerId === village.ownerId);
        actionExecutor.executeGoalAction({ type: 'settle_new_village' }, villages, gameState);
        phaseState.lastSafeExpansionCheckAt = now;
        return { success: true, reason: 'EXPANSION_ATTEMPTED' };
    }

    return { success: false, reason: 'NO_ACTION' };
}

export function createDefaultEgyptianPhaseState(now = Date.now()) {
    return {
        activePhaseId: EGYPTIAN_PHASE_IDS.phase1,
        startedAt: now,
        lastEvaluationAt: now,
        transitions: [],
        phase2MilitaryQueueSamples: 0,
        phase2MilitaryQueueActiveSamples: 0,
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
    };
}

export function hydrateEgyptianPhaseState(rawState = null, now = Date.now()) {
    const fallback = createDefaultEgyptianPhaseState(now);
    if (!rawState || typeof rawState !== 'object') return fallback;

    return {
        activePhaseId: rawState.activePhaseId || fallback.activePhaseId,
        startedAt: Number.isFinite(rawState.startedAt) ? rawState.startedAt : fallback.startedAt,
        lastEvaluationAt: Number.isFinite(rawState.lastEvaluationAt) ? rawState.lastEvaluationAt : fallback.lastEvaluationAt,
        transitions: Array.isArray(rawState.transitions) ? rawState.transitions : [],
        phase2MilitaryQueueSamples: Number.isFinite(rawState.phase2MilitaryQueueSamples) ? rawState.phase2MilitaryQueueSamples : 0,
        phase2MilitaryQueueActiveSamples: Number.isFinite(rawState.phase2MilitaryQueueActiveSamples) ? rawState.phase2MilitaryQueueActiveSamples : 0,
        phaseCycleProgress: rawState.phaseCycleProgress && typeof rawState.phaseCycleProgress === 'object'
            ? rawState.phaseCycleProgress
            : {},
        activeSubGoal: rawState.activeSubGoal && typeof rawState.activeSubGoal === 'object' ? rawState.activeSubGoal : null,
        subGoalHistory: Array.isArray(rawState.subGoalHistory) ? rawState.subGoalHistory : [],
        lastThreatOverrideLogAt: Number.isFinite(rawState.lastThreatOverrideLogAt) ? rawState.lastThreatOverrideLogAt : 0,
        lastIdleLogAt: Number.isFinite(rawState.lastIdleLogAt) ? rawState.lastIdleLogAt : 0,
        lastConstructionReserveLogAt: Number.isFinite(rawState.lastConstructionReserveLogAt) ? rawState.lastConstructionReserveLogAt : 0,
        expansionReadinessScore: Number.isFinite(rawState.expansionReadinessScore) ? rawState.expansionReadinessScore : 0,
        defenseReadinessScore: Number.isFinite(rawState.defenseReadinessScore) ? rawState.defenseReadinessScore : 0,
        storagePressureHistory: Array.isArray(rawState.storagePressureHistory) ? rawState.storagePressureHistory : [],
        lastSafeExpansionCheckAt: Number.isFinite(rawState.lastSafeExpansionCheckAt) ? rawState.lastSafeExpansionCheckAt : 0,
        lastBudgetRebalanceAt: Number.isFinite(rawState.lastBudgetRebalanceAt) ? rawState.lastBudgetRebalanceAt : 0,
    };
}

export function serializeEgyptianPhaseStates(stateByVillageMap) {
    const serialized = {};
    for (const [villageId, state] of stateByVillageMap.entries()) {
        serialized[villageId] = {
            activePhaseId: state.activePhaseId,
            startedAt: state.startedAt,
            lastEvaluationAt: state.lastEvaluationAt,
            transitions: state.transitions,
            phase2MilitaryQueueSamples: state.phase2MilitaryQueueSamples,
            phase2MilitaryQueueActiveSamples: state.phase2MilitaryQueueActiveSamples,
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
        };
    }
    return serialized;
}

export function runEgyptianEconomicPhaseCycle({
    village,
    gameState,
    phaseState,
    difficulty,
    villageCombatState,
    actionExecutor,
    log,
}) {
    const now = Date.now();
    const threatContext = normalizeVillageCombatState(villageCombatState, now);
    phaseState.lastEvaluationAt = now;

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phaseDone) {
        return { handled: true, phaseState };
    }

    const phaseKey = phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase1 ? 'phase1'
        : phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase2 ? 'phase2'
            : phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase3 ? 'phase3'
                : phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase4 ? 'phase4'
                    : phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase5 ? 'phase5'
                        : 'phase6';

    applyPhaseRatio({ village, difficulty, phaseId: phaseKey, threatContext, phaseState, log, now });
    updateReadinessScores(phaseState, village, threatContext);

    const storagePressure = Math.max(
        (village.resources?.wood?.current || 0) / Math.max(village.resources?.wood?.capacity || 1, 1),
        (village.resources?.stone?.current || 0) / Math.max(village.resources?.stone?.capacity || 1, 1),
        (village.resources?.iron?.current || 0) / Math.max(village.resources?.iron?.capacity || 1, 1),
        (village.resources?.food?.current || 0) / Math.max(village.resources?.food?.capacity || 1, 1),
    );
    phaseState.storagePressureHistory = [...phaseState.storagePressureHistory.slice(-9), { at: now, value: storagePressure }];

    const emergency = runThreatEmergencyBlock({ actionExecutor, village, gameState, threatContext });
    if (emergency.success) return { handled: true, phaseState };

    let result = { success: false, reason: 'NO_ACTION' };

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase1) {
        if (evaluatePhaseOneExit(village, threatContext)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase1, EGYPTIAN_PHASE_IDS.phase2, now, 'PHASE_1_EXIT_CRITERIA_MET', log, village);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase1) {
            result = runPhaseOne({ village, gameState, actionExecutor, threatContext });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase2) {
        updatePhaseTwoQueueTelemetry(phaseState, village);
        if (evaluatePhaseTwoExit(village) && evaluatePhaseTwoQueueExit(phaseState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase2, EGYPTIAN_PHASE_IDS.phase3, now, 'PHASE_2_EXIT_CRITERIA_MET', log, village);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase2) {
            result = runPhaseTwo({ village, gameState, actionExecutor, threatContext });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase3) {
        if (evaluatePhaseThreeExit(village)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase3, EGYPTIAN_PHASE_IDS.phase4, now, 'PHASE_3_EXIT_CRITERIA_MET', log, village);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase3) {
            result = runPhaseThree({ village, gameState, actionExecutor });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase4) {
        if (evaluatePhaseFourExit(village, phaseState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase4, EGYPTIAN_PHASE_IDS.phase5, now, 'PHASE_4_EXIT_CRITERIA_MET', log, village);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase4) {
            result = runPhaseFour({ village, gameState, actionExecutor });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase5) {
        if (evaluatePhaseFiveExit(village, gameState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase5, EGYPTIAN_PHASE_IDS.phase6, now, 'PHASE_5_EXIT_CRITERIA_MET', log, village);
        }
        if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase5) {
            result = runPhaseFive({ village, gameState, actionExecutor, phaseState, now, threatContext });
        }
    }

    if (phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase6) {
        if (evaluatePhaseSixExit(village, gameState)) {
            transitionTo(phaseState, EGYPTIAN_PHASE_IDS.phase6, EGYPTIAN_PHASE_IDS.phaseDone, now, 'PHASE_6_EXIT_CRITERIA_MET', log, village);
            return { handled: true, phaseState };
        }
        result = runPhaseSix({ village, gameState, actionExecutor, phaseState, now, threatContext });
    }

    if (!result.success && !shouldThrottleIdleLog(phaseState, now)) {
        setIdleLogMark(phaseState, now);
        log('info', village, 'Macro Egipcia', 'Sin accion macro en este ciclo; esperando presupuesto, cola libre o prerequisitos.', null, 'economic');
    }

    return { handled: true, phaseState };
}
