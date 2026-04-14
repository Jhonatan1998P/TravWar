import {
    GERMAN_PHASE_IDS,
    getGermanPhaseCycleStatus,
    hydrateGermanPhaseState,
    serializeGermanPhaseStates,
} from '../../src/features/game/ai/controller/german-phase-engine.js';
import {
    EGYPTIAN_PHASE_IDS,
    getEgyptianPhaseCycleStatus,
    hydrateEgyptianPhaseState,
    serializeEgyptianPhaseStates,
} from '../../src/features/game/ai/controller/egyptian-phase-engine.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const checks = [];
const runCheck = (name, fn) => {
    try {
        fn();
        checks.push({ name, ok: true });
    } catch (error) {
        checks.push({ name, ok: false, error: error.message });
    }
};

runCheck('German hydrate migra phaseId, ciclos legacy y subgoal legacy', () => {
    const now = Date.now();
    const rawState = {
        activePhaseId: 'german_phase_3_pending',
        transitions: [
            { fromPhase: 'german_phase_2_pending', toPhase: 'german_phase_3_pending', reason: 'LEGACY', timestamp: now - 1000 },
        ],
        phaseCycleProgress: {
            phase_3: {
                total: 5,
                offensiveInfantry: 3,
                scout: 1,
            },
        },
        activeSubGoal: {
            type: 'queue',
            reason: 'QUEUE_FULL',
            phaseId: 'german_phase_3_pending',
            step: { type: 'units', unitType: 'offensive_infantry', count: 50 },
        },
        subGoalHistory: [
            {
                type: 'resources',
                reason: 'INSUFFICIENT_RESOURCES',
                phaseId: 'german_phase_2_pending',
                blockedStep: { type: 'building', buildingType: 'academy', level: 5 },
            },
        ],
    };

    const hydrated = hydrateGermanPhaseState(rawState, now);
    assert(hydrated.activePhaseId === GERMAN_PHASE_IDS.phase3, 'debe migrar a phase3 canonica');
    assert(hydrated.transitions.length === 1, 'debe normalizar transiciones legacy');
    assert(hydrated.activeSubGoal?.kind === 'wait_queue', 'debe normalizar kind legacy queue -> wait_queue');
    assert(hydrated.subGoalHistory.length === 1, 'debe preservar historial migrado');

    const cycleStatus = getGermanPhaseCycleStatus(hydrated, 'Pesadilla', 'phase3');
    assert(cycleStatus.completed === 5, 'debe convertir total legacy de ciclos a ms sin perder conteo');

    const serialized = serializeGermanPhaseStates(new Map([['v1', hydrated]]));
    assert(serialized.v1.schemaVersion === 2, 'debe serializar schemaVersion=2');
});

runCheck('Egyptian hydrate migra phaseId, ciclos legacy, KPI aliases y subgoal legacy', () => {
    const now = Date.now();
    const rawState = {
        activePhaseId: 'egyptian_phase_4_pending',
        transitions: [
            { fromPhase: 'egyptian_phase_3_pending', toPhase: 'egyptian_phase_4_pending', reason: 'LEGACY', timestamp: now - 1000 },
        ],
        phaseCycleProgress: {
            phase_4: { total: 6 },
        },
        activeSubGoal: {
            type: 'build',
            reason: 'PREREQUISITES_NOT_MET',
            phaseId: 'egyptian_phase_4_pending',
            blockedStep: { type: 'building', buildingType: 'stable', level: 5 },
        },
        phase2QueueSamples: 7,
        phase2QueueActiveSamples: 4,
        expansionScore: 88,
        defenseScore: 93,
        storagePressureSamples: [0.4, 0.8],
        kpiThreatCycles: 9,
        kpiStorageCritical: 3,
        kpiEmergencyCycles: 2,
    };

    const hydrated = hydrateEgyptianPhaseState(rawState, now);
    assert(hydrated.activePhaseId === EGYPTIAN_PHASE_IDS.phase4, 'debe migrar a phase4 canonica');
    assert(hydrated.transitions.length === 1, 'debe normalizar transiciones legacy');
    assert(hydrated.activeSubGoal?.kind === 'build_prerequisite', 'debe normalizar kind legacy build -> build_prerequisite');
    assert(hydrated.phase2MilitaryQueueSamples === 7, 'debe migrar alias phase2QueueSamples');
    assert(hydrated.phase2MilitaryQueueActiveSamples === 4, 'debe migrar alias phase2QueueActiveSamples');
    assert(hydrated.expansionReadinessScore === 88, 'debe migrar alias expansionScore');
    assert(hydrated.defenseReadinessScore === 93, 'debe migrar alias defenseScore');
    assert(hydrated.kpiThreatInterruptedCycles === 9, 'debe migrar alias kpiThreatCycles');
    assert(hydrated.kpiStoragePressureCriticalSamples === 3, 'debe migrar alias kpiStorageCritical');
    assert(hydrated.kpiEmergencyRecruitmentCycles === 2, 'debe migrar alias kpiEmergencyCycles');

    const cycleStatus = getEgyptianPhaseCycleStatus(hydrated, 'Pesadilla', 'phase4');
    assert(cycleStatus.completed === 6, 'debe convertir total legacy de ciclos a ms sin perder conteo');

    const serialized = serializeEgyptianPhaseStates(new Map([['v1', hydrated]]));
    assert(serialized.v1.schemaVersion === 2, 'debe serializar schemaVersion=2');
});

checks.forEach(check => {
    if (check.ok) {
        console.log(`OK   ${check.name}`);
        return;
    }
    console.log(`FAIL ${check.name}`);
    console.log(`     ${check.error}`);
});

const failed = checks.filter(check => !check.ok);
if (failed.length > 0) {
    console.error(`\nValidacion de compatibilidad de estado fallo (${failed.length}/${checks.length}).`);
    process.exit(1);
}

console.log(`\nValidacion de compatibilidad de estado aprobada (${checks.length}/${checks.length}).`);
