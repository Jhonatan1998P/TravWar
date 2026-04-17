import { RESOURCE_FIELD_BUILDING_TYPES } from '../../core/data/constants.js';
import {
    isResearchRequiredForUnitId,
    resolveResearchUnitIdForRace,
    resolveUnitIdForRace,
} from '../utils/AIUnitUtils.js';

export const PHASE_RECOVERABLE_BLOCK_REASONS = new Set([
    'PREREQUISITES_NOT_MET',
    'RESEARCH_REQUIRED',
    'INSUFFICIENT_RESOURCES',
    'QUEUE_FULL',
    'EXPANSION_BUILDING_LOW_LEVEL',
    'EXPANSION_SLOTS_FULL',
]);

export const TRAINING_CYCLE_MS = 3 * 60 * 1000;

export const SHARED_PHASE_ONE_INFRASTRUCTURE_TARGETS = Object.freeze({
    resourceFieldsLevel: 4,
    buildingLevels: Object.freeze({
        mainBuilding: 5,
        cityWall: 5,
        barracks: 5,
        warehouse: 6,
        granary: 6,
        embassy: 3,
        marketplace: 3,
        academy: 5,
        smithy: 3,
        stable: 3,
    }),
});

export const SHARED_PHASE_TWO_INFRASTRUCTURE_TARGETS = Object.freeze({
    resourceFieldsLevel: 6,
    buildingLevels: Object.freeze({
        mainBuilding: 10,
        palace: 10,
        embassy: 5,
        marketplace: 7,
        barracks: 10,
        academy: 10,
        stable: 7,
        smithy: 7,
        workshop: 3,
        rallyPoint: 5,
        warehouse: 10,
        granary: 10,
        grainMill: 3,
        cityWall: 10,
    }),
});

export function createSharedPhaseOneCycleTargets(primaryInfantryBucket, primaryCycles = 10, scoutCycles = 3) {
    const key = String(primaryInfantryBucket || '').trim();
    if (!key) return { total: 0 };

    const infantryTarget = Math.max(0, Math.floor(primaryCycles || 0));
    const scoutTarget = Math.max(0, Math.floor(scoutCycles || 0));

    return {
        total: infantryTarget + scoutTarget,
        [key]: infantryTarget,
        scout: scoutTarget,
    };
}

export function createSharedPhaseTwoCycleTargets(
    primaryInfantryBucket,
    primaryCavalryBucket,
    infantryCycles = 20,
    scoutCycles = 5,
    cavalryCycles = 3,
) {
    const infantryKey = String(primaryInfantryBucket || '').trim();
    const cavalryKey = String(primaryCavalryBucket || '').trim();
    if (!infantryKey || !cavalryKey) return { total: 0 };

    const infantryTarget = Math.max(0, Math.floor(infantryCycles || 0));
    const scoutTarget = Math.max(0, Math.floor(scoutCycles || 0));
    const cavalryTarget = Math.max(0, Math.floor(cavalryCycles || 0));

    return {
        total: infantryTarget + scoutTarget + cavalryTarget,
        [infantryKey]: infantryTarget,
        scout: scoutTarget,
        [cavalryKey]: cavalryTarget,
    };
}

export function getSharedPhaseOneConstructionSteps(targets = SHARED_PHASE_ONE_INFRASTRUCTURE_TARGETS) {
    const resourceFieldsLevel = Math.max(0, Number(targets?.resourceFieldsLevel || 0));
    const buildingLevels = targets?.buildingLevels || {};

    return [
        { type: 'resource_fields_level', level: resourceFieldsLevel },
        { type: 'building', buildingType: 'mainBuilding', level: Math.max(0, Number(buildingLevels.mainBuilding || 0)) },
        { type: 'building', buildingType: 'cityWall', level: Math.max(0, Number(buildingLevels.cityWall || 0)) },
        { type: 'building', buildingType: 'barracks', level: Math.max(0, Number(buildingLevels.barracks || 0)) },
        { type: 'building', buildingType: 'warehouse', level: Math.max(0, Number(buildingLevels.warehouse || 0)) },
        { type: 'building', buildingType: 'granary', level: Math.max(0, Number(buildingLevels.granary || 0)) },
        { type: 'building', buildingType: 'embassy', level: Math.max(0, Number(buildingLevels.embassy || 0)) },
        { type: 'building', buildingType: 'marketplace', level: Math.max(0, Number(buildingLevels.marketplace || 0)) },
        { type: 'building', buildingType: 'academy', level: Math.max(0, Number(buildingLevels.academy || 0)) },
        { type: 'building', buildingType: 'smithy', level: Math.max(0, Number(buildingLevels.smithy || 0)) },
        { type: 'building', buildingType: 'stable', level: Math.max(0, Number(buildingLevels.stable || 0)) },
    ].filter(step => Number.isFinite(step.level) && step.level > 0);
}

export function getSharedPhaseTwoConstructionSteps(targets = SHARED_PHASE_TWO_INFRASTRUCTURE_TARGETS) {
    const resourceFieldsLevel = Math.max(0, Number(targets?.resourceFieldsLevel || 0));
    const buildingLevels = targets?.buildingLevels || {};

    return [
        { type: 'resource_fields_level', level: resourceFieldsLevel },
        { type: 'building', buildingType: 'mainBuilding', level: Math.max(0, Number(buildingLevels.mainBuilding || 0)) },
        { type: 'building', buildingType: 'rallyPoint', level: Math.max(0, Number(buildingLevels.rallyPoint || 0)) },
        { type: 'building', buildingType: 'barracks', level: Math.max(0, Number(buildingLevels.barracks || 0)) },
        { type: 'building', buildingType: 'academy', level: Math.max(0, Number(buildingLevels.academy || 0)) },
        { type: 'building', buildingType: 'smithy', level: Math.max(0, Number(buildingLevels.smithy || 0)) },
        { type: 'building', buildingType: 'stable', level: Math.max(0, Number(buildingLevels.stable || 0)) },
        { type: 'building', buildingType: 'workshop', level: Math.max(0, Number(buildingLevels.workshop || 0)) },
        { type: 'building', buildingType: 'embassy', level: Math.max(0, Number(buildingLevels.embassy || 0)) },
        { type: 'building', buildingType: 'palace', level: Math.max(0, Number(buildingLevels.palace || 0)) },
        { type: 'building', buildingType: 'marketplace', level: Math.max(0, Number(buildingLevels.marketplace || 0)) },
        { type: 'building', buildingType: 'warehouse', level: Math.max(0, Number(buildingLevels.warehouse || 0)) },
        { type: 'building', buildingType: 'granary', level: Math.max(0, Number(buildingLevels.granary || 0)) },
        { type: 'building', buildingType: 'grainMill', level: Math.max(0, Number(buildingLevels.grainMill || 0)) },
        { type: 'building', buildingType: 'cityWall', level: Math.max(0, Number(buildingLevels.cityWall || 0)) },
    ].filter(step => Number.isFinite(step.level) && step.level > 0);
}

export function evaluateSharedPhaseOneInfrastructure({
    village,
    getAverageResourceFieldLevel,
    getEffectiveBuildingLevel,
    targets = SHARED_PHASE_ONE_INFRASTRUCTURE_TARGETS,
}) {
    const avgFields = Number(getAverageResourceFieldLevel?.(village) || 0);
    const buildingLevels = targets?.buildingLevels || {};

    const details = {
        resourceFieldsLevel: avgFields,
        mainBuilding: Number(getEffectiveBuildingLevel?.(village, 'mainBuilding') || 0),
        cranny: Number(getEffectiveBuildingLevel?.(village, 'cranny') || 0),
        cityWall: Number(getEffectiveBuildingLevel?.(village, 'cityWall') || 0),
        barracks: Number(getEffectiveBuildingLevel?.(village, 'barracks') || 0),
        warehouse: Number(getEffectiveBuildingLevel?.(village, 'warehouse') || 0),
        granary: Number(getEffectiveBuildingLevel?.(village, 'granary') || 0),
        embassy: Number(getEffectiveBuildingLevel?.(village, 'embassy') || 0),
        marketplace: Number(getEffectiveBuildingLevel?.(village, 'marketplace') || 0),
        academy: Number(getEffectiveBuildingLevel?.(village, 'academy') || 0),
        smithy: Number(getEffectiveBuildingLevel?.(village, 'smithy') || 0),
        stable: Number(getEffectiveBuildingLevel?.(village, 'stable') || 0),
    };

    const ready = details.resourceFieldsLevel >= (targets?.resourceFieldsLevel || 0)
        && details.mainBuilding >= (buildingLevels.mainBuilding || 0)
        && details.cranny >= (buildingLevels.cranny || 0)
        && details.cityWall >= (buildingLevels.cityWall || 0)
        && details.barracks >= (buildingLevels.barracks || 0)
        && details.warehouse >= (buildingLevels.warehouse || 0)
        && details.granary >= (buildingLevels.granary || 0)
        && details.embassy >= (buildingLevels.embassy || 0)
        && details.marketplace >= (buildingLevels.marketplace || 0)
        && details.academy >= (buildingLevels.academy || 0)
        && details.smithy >= (buildingLevels.smithy || 0)
        && details.stable >= (buildingLevels.stable || 0);

    return { ready, details, targets };
}

export function evaluateSharedPhaseTwoInfrastructure({
    village,
    getAverageResourceFieldLevel,
    getEffectiveBuildingLevel,
    targets = SHARED_PHASE_TWO_INFRASTRUCTURE_TARGETS,
}) {
    const avgFields = Number(getAverageResourceFieldLevel?.(village) || 0);
    const buildingLevels = targets?.buildingLevels || {};

    const details = {
        resourceFieldsLevel: avgFields,
        mainBuilding: Number(getEffectiveBuildingLevel?.(village, 'mainBuilding') || 0),
        cranny: Number(getEffectiveBuildingLevel?.(village, 'cranny') || 0),
        palace: Number(getEffectiveBuildingLevel?.(village, 'palace') || 0),
        embassy: Number(getEffectiveBuildingLevel?.(village, 'embassy') || 0),
        marketplace: Number(getEffectiveBuildingLevel?.(village, 'marketplace') || 0),
        barracks: Number(getEffectiveBuildingLevel?.(village, 'barracks') || 0),
        academy: Number(getEffectiveBuildingLevel?.(village, 'academy') || 0),
        stable: Number(getEffectiveBuildingLevel?.(village, 'stable') || 0),
        smithy: Number(getEffectiveBuildingLevel?.(village, 'smithy') || 0),
        workshop: Number(getEffectiveBuildingLevel?.(village, 'workshop') || 0),
        rallyPoint: Number(getEffectiveBuildingLevel?.(village, 'rallyPoint') || 0),
        warehouse: Number(getEffectiveBuildingLevel?.(village, 'warehouse') || 0),
        granary: Number(getEffectiveBuildingLevel?.(village, 'granary') || 0),
        grainMill: Number(getEffectiveBuildingLevel?.(village, 'grainMill') || 0),
        cityWall: Number(getEffectiveBuildingLevel?.(village, 'cityWall') || 0),
    };

    const ready = details.resourceFieldsLevel >= (targets?.resourceFieldsLevel || 0)
        && details.mainBuilding >= (buildingLevels.mainBuilding || 0)
        && details.cranny >= (buildingLevels.cranny || 0)
        && details.palace >= (buildingLevels.palace || 0)
        && details.embassy >= (buildingLevels.embassy || 0)
        && details.marketplace >= (buildingLevels.marketplace || 0)
        && details.barracks >= (buildingLevels.barracks || 0)
        && details.academy >= (buildingLevels.academy || 0)
        && details.stable >= (buildingLevels.stable || 0)
        && details.smithy >= (buildingLevels.smithy || 0)
        && details.workshop >= (buildingLevels.workshop || 0)
        && details.rallyPoint >= (buildingLevels.rallyPoint || 0)
        && details.warehouse >= (buildingLevels.warehouse || 0)
        && details.granary >= (buildingLevels.granary || 0)
        && details.grainMill >= (buildingLevels.grainMill || 0)
        && details.cityWall >= (buildingLevels.cityWall || 0);

    return { ready, details, targets };
}

export function evaluatePhaseInfrastructureTargets({
    village,
    getAverageResourceFieldLevel,
    getEffectiveBuildingLevel,
    targets,
}) {
    const normalizedTargets = targets && typeof targets === 'object' ? targets : {};
    const buildingTargets = normalizedTargets.buildingLevels && typeof normalizedTargets.buildingLevels === 'object'
        ? normalizedTargets.buildingLevels
        : {};

    const avgFields = Number(getAverageResourceFieldLevel?.(village) || 0);
    const fieldTarget = Math.max(0, Number(normalizedTargets.resourceFieldsLevel || 0));
    const details = {
        resourceFieldsLevel: avgFields,
    };

    let ready = avgFields >= fieldTarget;

    for (const [buildingType, levelRaw] of Object.entries(buildingTargets)) {
        const requiredLevel = Math.max(0, Number(levelRaw) || 0);
        const currentLevel = Number(getEffectiveBuildingLevel?.(village, buildingType) || 0);
        details[buildingType] = currentLevel;
        if (requiredLevel > 0 && currentLevel < requiredLevel) {
            ready = false;
        }
    }

    return {
        ready,
        details,
        targets: {
            resourceFieldsLevel: fieldTarget,
            buildingLevels: { ...buildingTargets },
        },
    };
}

export const PHASE_SUBGOAL_KIND = Object.freeze({
    buildPrerequisite: 'build_prerequisite',
    researchPrerequisite: 'research_prerequisite',
    waitQueue: 'wait_queue',
    waitResources: 'wait_resources',
});

export const PHASE_SUBGOAL_CONFIG = Object.freeze({
    baseRetryMs: 30_000,
    minRetryMs: 2_000,
    logThrottleMs: 20_000,
    maxAttemptsBeforeReset: 8,
    maxHistory: 40,
});

const SUBGOAL_KIND_ALIASES = Object.freeze({
    build: PHASE_SUBGOAL_KIND.buildPrerequisite,
    build_prereq: PHASE_SUBGOAL_KIND.buildPrerequisite,
    research: PHASE_SUBGOAL_KIND.researchPrerequisite,
    research_prereq: PHASE_SUBGOAL_KIND.researchPrerequisite,
    queue: PHASE_SUBGOAL_KIND.waitQueue,
    wait_queue: PHASE_SUBGOAL_KIND.waitQueue,
    resources: PHASE_SUBGOAL_KIND.waitResources,
    wait_resources: PHASE_SUBGOAL_KIND.waitResources,
});

export function getCompletedTrainingCycles(ms, cycleMs = TRAINING_CYCLE_MS) {
    return Math.floor(Math.max(0, Number(ms) || 0) / Math.max(1, Number(cycleMs) || TRAINING_CYCLE_MS));
}

export function getQueuedTrainingMs(count, timePerUnit) {
    if (!Number.isFinite(count) || count <= 0) return 0;
    if (!Number.isFinite(timePerUnit) || timePerUnit <= 0) return 0;
    return Math.max(0, Math.floor(count * timePerUnit));
}

export function getSubGoalRetryIntervalMs(gameSpeed, config = PHASE_SUBGOAL_CONFIG) {
    const normalizedSpeed = Math.max(Number(gameSpeed) || 1, 1);
    return Math.max(config.minRetryMs, Math.floor(config.baseRetryMs / normalizedSpeed));
}

export function getPhaseStepSignature(step) {
    if (!step) return 'step:none';
    if (step.type === 'building') return `building:${step.buildingType || 'unknown'}:${step.level || 0}`;
    if (step.type === 'resource_fields_level') return `resource_fields:${step.level || 0}`;
    if (step.type === 'units') return `units:${step.unitType || 'unknown'}:${step.count ?? 'n/a'}`;
    if (step.type === 'research') return `research:${step.unitType || step.unitId || 'unknown'}`;
    if (step.type === 'upgrade') return `upgrade:${step.unitType || 'unknown'}:${step.level || 0}`;
    return `${step.type || 'unknown'}:generic`;
}

function getResourcePoolSnapshotForStep(village, step) {
    const fallbackPool = {
        wood: Number(village?.resources?.wood?.current) || 0,
        stone: Number(village?.resources?.stone?.current) || 0,
        iron: Number(village?.resources?.iron?.current) || 0,
        food: Number(village?.resources?.food?.current) || 0,
    };

    const isMilitaryBudgetStep = step?.type === 'units' || step?.type === 'proportional_units';
    const budgetPool = isMilitaryBudgetStep
        ? (village?.budget?.mil || null)
        : (village?.budget?.econ || null);
    const sourcePool = budgetPool || fallbackPool;

    return {
        wood: Number(sourcePool.wood) || 0,
        stone: Number(sourcePool.stone) || 0,
        iron: Number(sourcePool.iron) || 0,
        food: Number(sourcePool.food) || 0,
    };
}

function getMissingResourceMap(needed, available) {
    if (!needed || typeof needed !== 'object') return null;
    const resources = ['wood', 'stone', 'iron', 'food'];
    const missing = {};

    resources.forEach(resource => {
        const need = Math.max(0, Number(needed[resource]) || 0);
        const have = Math.max(0, Number(available?.[resource]) || 0);
        if (need > have) {
            missing[resource] = Math.ceil(need - have);
        }
    });

    return Object.keys(missing).length > 0 ? missing : {};
}

function formatResourceMap(resources) {
    if (!resources || typeof resources !== 'object') return null;
    const parts = ['wood', 'stone', 'iron', 'food']
        .filter(resource => Number.isFinite(Number(resources[resource])) && Number(resources[resource]) > 0)
        .map(resource => `${resource}:${Math.floor(Number(resources[resource]))}`);
    return parts.length > 0 ? parts.join(', ') : null;
}

export function isPhaseQueueAvailable(village, queueType) {
    if (queueType === 'construction') {
        return (village.constructionQueue?.length || 0) < (village.maxConstructionSlots || 1);
    }
    if (queueType === 'research') {
        return (village.research?.queue?.length || 0) === 0;
    }
    if (queueType === 'smithy') {
        return (village.smithy?.queue?.length || 0) === 0;
    }
    if (queueType === 'recruitment') {
        return true;
    }
    return true;
}

export function isPhaseResearchStepCompleted(village, step) {
    if (!step) return true;
    const race = village?.race || '';
    const resolvedResearchUnitId = resolveResearchUnitIdForRace(step.unitId || step.unitType, race);
    if (resolvedResearchUnitId && !isResearchRequiredForUnitId(resolvedResearchUnitId, race)) {
        return true;
    }

    const candidates = [
        resolvedResearchUnitId,
        step.unitId,
        step.unitType,
        resolveUnitIdForRace(step.unitId, race),
        resolveUnitIdForRace(step.unitType, race),
    ].filter(Boolean);

    if (candidates.length === 0) return false;

    const completed = Array.isArray(village?.research?.completed) ? village.research.completed : [];
    return candidates.some(unitId => completed.includes(unitId));
}

export function resolvePhaseRequirementUnitId(village, identifier) {
    if (!identifier) return null;
    const race = village?.race || '';
    return resolveResearchUnitIdForRace(identifier, race)
        || resolveUnitIdForRace(identifier, race)
        || identifier;
}

export function isPhaseResearchRequirementMet(village, identifier) {
    const unitId = resolvePhaseRequirementUnitId(village, identifier);
    if (!unitId) return false;

    const race = village?.race || '';
    if (!isResearchRequiredForUnitId(unitId, race)) {
        return true;
    }

    const completed = Array.isArray(village?.research?.completed) ? village.research.completed : [];
    return completed.includes(unitId);
}

export function isPhaseUpgradeRequirementMet(village, identifier, targetLevel) {
    const requiredLevel = Math.max(0, Number(targetLevel) || 0);
    if (requiredLevel <= 0) return true;

    const race = village?.race || '';
    const unitId = resolveUnitIdForRace(identifier, race) || identifier;
    if (!unitId) return false;

    return (village?.smithy?.upgrades?.[unitId] || 0) >= requiredLevel;
}

export function normalizePhaseSubGoalKind(kind, subGoalKind = PHASE_SUBGOAL_KIND) {
    if (kind && Object.values(subGoalKind).includes(kind)) {
        return kind;
    }

    if (!kind) return subGoalKind.waitResources;

    return SUBGOAL_KIND_ALIASES[kind] || subGoalKind.waitResources;
}

export function createOrRefreshPhaseSubGoal({
    phaseState,
    phaseId,
    blockedResult,
    source,
    village,
    gameSpeed,
    log,
    config = PHASE_SUBGOAL_CONFIG,
    subGoalKind = PHASE_SUBGOAL_KIND,
    cloneStep = clonePhaseStep,
    getStepSignature = getPhaseStepSignature,
    getQueueTypeForStep = getPhaseStepQueueType,
    isRecoverableBlockReason = isRecoverablePhaseBlockReason,
    buildResolverStep = null,
    getBlockedStepPriorityClass = null,
    idPrefix = 'sg',
}) {
    if (!blockedResult || !isRecoverableBlockReason(blockedResult.reason)) {
        return false;
    }

    const now = Date.now();
    const retryMs = getSubGoalRetryIntervalMs(gameSpeed, config);
    const resolverStep = typeof buildResolverStep === 'function'
        ? buildResolverStep(village, blockedResult)
        : null;
    const queueType = getQueueTypeForStep(blockedResult.step);
    const priorityClass = typeof getBlockedStepPriorityClass === 'function'
        ? (getBlockedStepPriorityClass(phaseId, blockedResult.step) || 'general')
        : undefined;

    let kind;
    if (blockedResult.reason === 'QUEUE_FULL') {
        kind = subGoalKind.waitQueue;
    } else if (resolverStep) {
        kind = resolverStep.type === 'research'
            ? subGoalKind.researchPrerequisite
            : subGoalKind.buildPrerequisite;
    } else if (blockedResult.reason === 'INSUFFICIENT_RESOURCES') {
        kind = subGoalKind.waitResources;
    } else {
        return false;
    }

    const signature = `${phaseId}|${kind}|${blockedResult.reason}|${getStepSignature(blockedResult.step)}|${getStepSignature(resolverStep)}`;
    const existing = phaseState.activeSubGoal;
    if (existing?.signature === signature && existing.phaseId === phaseId) {
        existing.updatedAt = now;
        existing.blockedStep = cloneStep(blockedResult.step);
        existing.resolverStep = resolverStep;
        existing.reason = blockedResult.reason;
        existing.latestDetails = blockedResult.details || existing.latestDetails || null;
        existing.queueType = queueType || existing.queueType;
        if (priorityClass) {
            existing.priorityClass = priorityClass;
        }
        if (existing.kind === subGoalKind.waitResources || existing.kind === subGoalKind.waitQueue) {
            existing.nextAttemptAt = now + retryMs;
        }
        return true;
    }

    phaseState.activeSubGoal = {
        id: `${idPrefix}_${now}_${Math.random().toString(36).slice(2, 7)}`,
        signature,
        kind,
        phaseId,
        source,
        reason: blockedResult.reason,
        createdAt: now,
        updatedAt: now,
        nextAttemptAt: now,
        attempts: 0,
        lastLogAt: 0,
        blockedStep: cloneStep(blockedResult.step),
        resolverStep,
        queueType,
        latestDetails: blockedResult.details || null,
        ...(priorityClass ? { priorityClass } : {}),
    };

    const resolverText = resolverStep
        ? `resolver=${getStepSignature(resolverStep)}`
        : `espera=${kind}`;
    if (typeof log === 'function') {
        log(
            'warn',
            village,
            'Macro SubGoal',
            `Bloqueo detectado (${blockedResult.reason}) en ${source}. Activando subgoal ${kind} (${resolverText}).`,
            null,
            'economic',
        );
    }

    return true;
}

export function processPhaseActiveSubGoal({
    phaseState,
    village,
    gameState,
    actionExecutor,
    gameSpeed,
    log,
    config = PHASE_SUBGOAL_CONFIG,
    subGoalKind = PHASE_SUBGOAL_KIND,
    cloneStep = clonePhaseStep,
    getStepSignature = getPhaseStepSignature,
    getQueueTypeForStep = getPhaseStepQueueType,
    isQueueAvailable = isPhaseQueueAvailable,
    isResearchStepCompleted = isPhaseResearchStepCompleted,
    isBuildingStepCompleted,
    buildResolverStep,
    isRecoverableBlockReason = isRecoverablePhaseBlockReason,
    waitResourcesMode = 'hold_until_resources',
    hasResourcesForBlockedStep = null,
}) {
    const subGoal = phaseState.activeSubGoal;
    if (!subGoal) {
        return { handled: false };
    }

    const now = Date.now();
    if (subGoal.phaseId !== phaseState.activePhaseId) {
        clearPhaseActiveSubGoal({
            phaseState,
            now,
            village,
            log,
            message: 'Subgoal descartado por cambio de fase.',
            status: 'phase_changed',
            config,
        });
        return { handled: false };
    }

    if (subGoal.kind === subGoalKind.waitQueue) {
        const queueFree = isQueueAvailable(village, subGoal.queueType);
        if (queueFree) {
            clearPhaseActiveSubGoal({
                phaseState,
                now,
                village,
                log,
                message: `Subgoal de cola resuelto (${subGoal.queueType}).`,
                config,
            });
            return { handled: false };
        }

        subGoal.nextAttemptAt = now + getSubGoalRetryIntervalMs(gameSpeed, config);
        if (now - (subGoal.lastLogAt || 0) >= config.logThrottleMs) {
            subGoal.lastLogAt = now;
            log(
                'info',
                village,
                'Macro SubGoal',
                `Subgoal activo ${subGoal.kind}. Esperando liberacion de cola (${subGoal.queueType}).`,
                null,
                'economic',
            );
        }
        return { handled: true };
    }

    if (subGoal.kind === subGoalKind.waitResources) {
        const neededResources = subGoal?.latestDetails?.needed && typeof subGoal.latestDetails.needed === 'object'
            ? subGoal.latestDetails.needed
            : null;
        const availableResources = getResourcePoolSnapshotForStep(village, subGoal.blockedStep);
        const missingResources = getMissingResourceMap(neededResources, availableResources);
        const neededText = formatResourceMap(neededResources);
        const availableText = formatResourceMap(availableResources);
        const missingText = formatResourceMap(missingResources);

        if (waitResourcesMode === 'retry_after_interval') {
            if (now < subGoal.nextAttemptAt) {
                return { handled: true };
            }

            clearPhaseActiveSubGoal({
                phaseState,
                now,
                village,
                log,
                message: 'Reintentando objetivo bloqueado por recursos.',
                status: 'retry_after_wait_resources',
                config,
            });
            return { handled: false };
        }

        const hasResources = typeof hasResourcesForBlockedStep === 'function'
            ? hasResourcesForBlockedStep(village, subGoal.blockedStep, subGoal)
            : false;
        if (hasResources) {
            const resolvedMessage = neededText
                ? `Subgoal de ahorro resuelto: recursos exactos disponibles para ${getStepSignature(subGoal.blockedStep)}.`
                : 'Subgoal de ahorro resuelto: recursos disponibles para reintentar.';

            clearPhaseActiveSubGoal({
                phaseState,
                now,
                village,
                log,
                message: resolvedMessage,
                config,
            });
            return { handled: false };
        }

        if (now < subGoal.nextAttemptAt) {
            return { handled: true };
        }

        subGoal.nextAttemptAt = now + getSubGoalRetryIntervalMs(gameSpeed, config);
        if (now - (subGoal.lastLogAt || 0) >= config.logThrottleMs) {
            subGoal.lastLogAt = now;
            log(
                'info',
                village,
                'Macro SubGoal',
                neededText
                    ? `Esperando recursos para ${getStepSignature(subGoal.blockedStep)}. WAIT_RESOURCES CHECK -> necesario{${neededText}} disponible{${availableText || '0'}} faltante{${missingText || '0'}}.`
                    : `Esperando recursos para ${getStepSignature(subGoal.blockedStep)}.`,
                neededText
                    ? {
                        needed: neededResources,
                        available: availableResources,
                        missing: missingResources,
                    }
                    : null,
                'economic',
            );
        }
        return { handled: true };
    }

    const resolverStep = subGoal.resolverStep;
    const completed = subGoal.kind === subGoalKind.researchPrerequisite
        ? isResearchStepCompleted(village, resolverStep)
        : isBuildingStepCompleted(village, resolverStep);

    if (completed) {
        clearPhaseActiveSubGoal({
            phaseState,
            now,
            village,
            log,
            message: `Subgoal resuelto: ${getStepSignature(resolverStep)}.`,
            config,
        });
        return { handled: false };
    }

    if (now < subGoal.nextAttemptAt) {
        return { handled: true };
    }

    const result = actionExecutor.executePlanStep(village, resolverStep, gameState, { scope: 'per_village' });
    subGoal.attempts = (subGoal.attempts || 0) + 1;
    subGoal.updatedAt = now;
    subGoal.nextAttemptAt = now + getSubGoalRetryIntervalMs(gameSpeed, config);

    if (result.success || result.reason === 'QUEUE_FULL') {
        if (result.reason === 'QUEUE_FULL') {
            subGoal.kind = subGoalKind.waitQueue;
            subGoal.queueType = getQueueTypeForStep(resolverStep);
            subGoal.reason = 'QUEUE_FULL';
            subGoal.blockedStep = cloneStep(resolverStep);
            subGoal.resolverStep = null;
            subGoal.latestDetails = result.details || null;
        }
        return { handled: true };
    }

    if (result.reason === 'INSUFFICIENT_RESOURCES') {
        subGoal.kind = subGoalKind.waitResources;
        subGoal.reason = 'INSUFFICIENT_RESOURCES';
        subGoal.blockedStep = cloneStep(resolverStep);
        subGoal.resolverStep = null;
        subGoal.latestDetails = result.details || null;
        return { handled: true };
    }

    if (isRecoverableBlockReason(result.reason)) {
        const nestedResolver = typeof buildResolverStep === 'function'
            ? buildResolverStep(village, {
                ...result,
                step: resolverStep,
            })
            : null;
        if (nestedResolver) {
            subGoal.resolverStep = nestedResolver;
            subGoal.kind = nestedResolver.type === 'research'
                ? subGoalKind.researchPrerequisite
                : subGoalKind.buildPrerequisite;
            subGoal.reason = result.reason;
            subGoal.latestDetails = result.details || null;

            if (now - (subGoal.lastLogAt || 0) >= config.logThrottleMs) {
                subGoal.lastLogAt = now;
                log(
                    'info',
                    village,
                    'Macro SubGoal',
                    `Subgoal activo ${subGoal.kind}. Bloqueo encadenado detectado; nuevo resolver ${getStepSignature(nestedResolver)}.`,
                    result.details || null,
                    'economic',
                );
            }
            return { handled: true };
        }
    }

    if (now - (subGoal.lastLogAt || 0) >= config.logThrottleMs) {
        subGoal.lastLogAt = now;
        log(
            'info',
            village,
            'Macro SubGoal',
            `Subgoal activo ${subGoal.kind}. Intento ${subGoal.attempts} sin resolver; ultimo rechazo: ${result.reason || 'UNKNOWN'}.`,
            result.details || null,
            'economic',
        );
    }

    return { handled: true };
}

export function pushPhaseSubGoalHistory(phaseState, record, config = PHASE_SUBGOAL_CONFIG) {
    phaseState.subGoalHistory = Array.isArray(phaseState.subGoalHistory) ? phaseState.subGoalHistory : [];
    phaseState.subGoalHistory.push(record);
    if (phaseState.subGoalHistory.length > config.maxHistory) {
        phaseState.subGoalHistory.shift();
    }
}

export function clearPhaseActiveSubGoal({
    phaseState,
    now,
    village,
    log,
    message = null,
    status = 'resolved',
    config = PHASE_SUBGOAL_CONFIG,
}) {
    const activeSubGoal = phaseState.activeSubGoal;
    if (!activeSubGoal) return;

    pushPhaseSubGoalHistory(phaseState, {
        ...activeSubGoal,
        clearedAt: now,
        status,
    }, config);

    if (message) {
        log('success', village, 'Macro SubGoal', message, null, 'economic');
    }

    phaseState.activeSubGoal = null;
}

export function handleCommonPhaseActionResult({
    result,
    phaseState,
    phaseId,
    source,
    village,
    gameSpeed,
    onSuccess,
    createOrRefreshSubGoal,
    queueFullPriority = false,
}) {
    if (!result) return { terminal: false };

    if (result.success) {
        if (typeof onSuccess === 'function') {
            onSuccess(result);
        }
        return { terminal: true };
    }

    if (queueFullPriority && result.reason === 'QUEUE_FULL' && typeof createOrRefreshSubGoal === 'function') {
        createOrRefreshSubGoal({
            phaseState,
            phaseId,
            blockedResult: result,
            source,
            village,
            gameSpeed,
        });
        return { terminal: true };
    }

    if (typeof createOrRefreshSubGoal !== 'function') {
        return { terminal: false };
    }

    const subGoalCreated = createOrRefreshSubGoal({
        phaseState,
        phaseId,
        blockedResult: result,
        source,
        village,
        gameSpeed,
    });

    return {
        terminal: Boolean(subGoalCreated),
    };
}

export function getDifficultyTemplate(templateByDifficulty, difficulty, fallbackKey = 'Pesadilla') {
    if (!templateByDifficulty || typeof templateByDifficulty !== 'object') return null;
    return templateByDifficulty[fallbackKey] || null;
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

export function getEffectiveBuildingLevelById(village, buildingId) {
    if (!village || !buildingId) return 0;
    const building = village.buildings.find(candidate => candidate.id === buildingId);
    if (!building) return 0;
    const queued = (village.constructionQueue || []).filter(job => job.buildingId === building.id).length;
    return (building.level || 0) + queued;
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

export function getMinEffectiveResourceFieldLevel(village) {
    const fields = village?.buildings?.filter(building => RESOURCE_FIELD_BUILDING_TYPES.includes(building.type)) || [];
    if (fields.length === 0) return 0;
    const effectiveLevels = fields.map(field => getEffectiveBuildingLevelById(village, field.id));
    return Math.min(...effectiveLevels);
}

export function prioritizeMainAndFieldsConstructionSteps(steps) {
    const normalized = Array.isArray(steps) ? steps.filter(Boolean) : [];
    const main = normalized.filter(step => step.type === 'building' && step.buildingType === 'mainBuilding');
    const fields = normalized.filter(step => step.type === 'resource_fields_level');
    const rest = normalized.filter(step => !((step.type === 'building' && step.buildingType === 'mainBuilding') || step.type === 'resource_fields_level'));
    return [...fields, ...main, ...rest];
}

export function getConstructionMicroStepsForVillage({
    village,
    steps,
    getEffectiveBuildingLevel = getEffectiveBuildingTypeLevel,
}) {
    const normalized = Array.isArray(steps) ? steps.filter(Boolean) : [];
    const microSteps = [];

    for (const step of normalized) {
        if (step.type === 'building') {
            const targetLevel = Math.max(0, Number(step.level || 0));
            if (targetLevel <= 0) continue;
            const currentLevel = Math.max(0, Number(getEffectiveBuildingLevel(village, step.buildingType)) || 0);
            if (currentLevel >= targetLevel) continue;
            const nextLevel = Math.min(targetLevel, currentLevel + 1);

            microSteps.push({
                ...step,
                level: nextLevel,
                microTrace: {
                    kind: 'building',
                    buildingType: step.buildingType,
                    currentLevel,
                    nextLevel,
                    targetLevel,
                },
            });
            continue;
        }

        if (step.type === 'resource_fields_level') {
            const targetLevel = Math.max(0, Number(step.level || 0));
            if (targetLevel <= 0) continue;
            const minEffectiveLevel = Math.max(0, Number(getMinEffectiveResourceFieldLevel(village)) || 0);
            if (minEffectiveLevel >= targetLevel) continue;
            const nextTierLevel = Math.min(targetLevel, minEffectiveLevel + 1);

            microSteps.push({
                ...step,
                level: nextTierLevel,
                microTrace: {
                    kind: 'resource_fields_tier',
                    currentMinLevel: minEffectiveLevel,
                    nextTierLevel,
                    targetLevel,
                },
            });
            continue;
        }

        microSteps.push(step);
    }

    const prioritized = prioritizeMainAndFieldsConstructionSteps(microSteps);
    const fieldsStep = prioritized.find(step => step.type === 'resource_fields_level');

    if (fieldsStep) {
        const minEffectiveFieldsLevel = Math.max(0, Number(getMinEffectiveResourceFieldLevel(village)) || 0);
        const fieldsTargetLevel = Math.max(0, Number(fieldsStep.level || 0));

        if (minEffectiveFieldsLevel < fieldsTargetLevel) {
            return [{ ...fieldsStep }];
        }
    }

    return prioritized;
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

export function pickPhaseLaneResult(results, noActionReason = 'NO_ACTION') {
    let firstNonNoAction = null;

    for (const result of results || []) {
        if (!result) continue;

        if (result.success || result.reason === 'QUEUE_FULL' || isRecoverablePhaseBlockReason(result.reason)) {
            return result;
        }

        if (!firstNonNoAction && result.reason && result.reason !== noActionReason) {
            firstNonNoAction = result;
        }
    }

    return firstNonNoAction || { success: false, reason: noActionReason };
}

export function runPhaseLaneMatrix({
    phaseState,
    phaseId,
    lanes,
    laneMatrixId = 'lane_matrix',
    noActionReason = 'NO_ACTION',
}) {
    const normalizedLanes = Array.isArray(lanes)
        ? lanes.filter(lane => lane && typeof lane.execute === 'function')
        : [];

    if (normalizedLanes.length === 0) {
        return { handled: false, result: { success: false, reason: noActionReason }, lane: null };
    }

    const orderedLanes = normalizedLanes;

    for (const lane of orderedLanes) {
        const result = lane.execute() || { success: false, reason: noActionReason };
        if (result.success || result.reason === 'QUEUE_FULL' || isRecoverablePhaseBlockReason(result.reason)) {
            return { handled: true, result, lane };
        }
    }

    return { handled: false, result: { success: false, reason: noActionReason }, lane: null };
}

export function getRoundRobinPhaseSteps({
    phaseState,
    phaseId,
    laneId,
    steps,
}) {
    const orderedSteps = Array.isArray(steps) ? steps.filter(Boolean) : [];
    if (orderedSteps.length <= 1) return orderedSteps;

    if (!phaseState || typeof phaseState !== 'object') return orderedSteps;
    if (!phaseId || !laneId) return orderedSteps;

    if (!phaseState.roundRobinPointers || typeof phaseState.roundRobinPointers !== 'object') {
        phaseState.roundRobinPointers = {};
    }

    const pointerKey = `${phaseId}:${laneId}`;
    const rawPointer = Number(phaseState.roundRobinPointers[pointerKey] || 0);
    const normalizedPointer = ((rawPointer % orderedSteps.length) + orderedSteps.length) % orderedSteps.length;

    if (normalizedPointer === 0) return orderedSteps;

    return [
        ...orderedSteps.slice(normalizedPointer),
        ...orderedSteps.slice(0, normalizedPointer),
    ];
}

export function advanceRoundRobinPhasePointer({
    phaseState,
    phaseId,
    laneId,
    steps,
    completedStep = null,
}) {
    const orderedSteps = Array.isArray(steps) ? steps.filter(Boolean) : [];
    if (orderedSteps.length <= 1) return;
    if (!phaseState || typeof phaseState !== 'object') return;
    if (!phaseId || !laneId) return;

    if (!phaseState.roundRobinPointers || typeof phaseState.roundRobinPointers !== 'object') {
        phaseState.roundRobinPointers = {};
    }

    const pointerKey = `${phaseId}:${laneId}`;
    const rawPointer = Number(phaseState.roundRobinPointers[pointerKey] || 0);
    const normalizedPointer = ((rawPointer % orderedSteps.length) + orderedSteps.length) % orderedSteps.length;

    const completedSignature = getPhaseStepSignature(completedStep);
    const completedIndex = completedSignature
        ? orderedSteps.findIndex(step => getPhaseStepSignature(step) === completedSignature)
        : -1;
    const currentIndex = completedIndex >= 0 ? completedIndex : normalizedPointer;

    phaseState.roundRobinPointers[pointerKey] = (currentIndex + 1) % orderedSteps.length;
}

function getRecruitmentStepCategory(step) {
    const raw = String(step?.unitType || step?.unitId || '').toLowerCase();
    if (!raw) return 'unknown';

    if (raw.includes('settler') || raw.includes('chief') || raw.includes('colon') || raw.includes('conquest')) {
        return 'expansion';
    }

    if (raw.includes('ram') || raw.includes('catapult') || raw.includes('siege')) {
        return 'siege';
    }

    if (raw.includes('scout') || raw.includes('spy')) {
        return 'scout';
    }

    if (raw.includes('cavalry') || raw.includes('horse')) {
        return 'cavalry';
    }

    if (raw.includes('infantry') || raw.includes('axe') || raw.includes('spear') || raw.includes('club') || raw.includes('sword')) {
        return 'infantry';
    }

    return 'unknown';
}

export function getRecruitmentMicroStepsByPriority({
    phaseState,
    phaseId,
    laneId = 'recruitment',
    steps,
}) {
    const normalized = Array.isArray(steps) ? steps.filter(Boolean) : [];
    if (normalized.length <= 1) return normalized;

    const categoryOrder = ['infantry', 'scout', 'cavalry', 'siege', 'expansion', 'unknown'];
    const grouped = new Map(categoryOrder.map(category => [category, []]));

    normalized.forEach(step => {
        const category = getRecruitmentStepCategory(step);
        if (!grouped.has(category)) grouped.set(category, []);
        grouped.get(category).push(step);
    });

    const sortedByPriority = categoryOrder.flatMap(category => grouped.get(category) || []);

    return getRoundRobinPhaseSteps({
        phaseState,
        phaseId,
        laneId,
        steps: sortedByPriority,
    });
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
