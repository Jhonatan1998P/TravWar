import {
    createDefaultGermanPhaseState,
    GERMAN_PHASE_IDS,
    getGermanPhaseCycleStatus,
    runGermanEconomicPhaseCycle,
} from '../../src/features/game/ai/controller/german-phase-engine.js';
import {
    createDefaultEgyptianPhaseState,
    EGYPTIAN_PHASE_IDS,
    getEgyptianPhaseCycleStatus,
    runEgyptianEconomicPhaseCycle,
} from '../../src/features/game/ai/controller/egyptian-phase-engine.js';
import { getTrainingBuildingForUnitId, resolveUnitIdForRace } from '../../src/features/game/ai/utils/AIUnitUtils.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function createVillage({
    id = 'v1',
    ownerId = 'ai_test',
    race = 'germans',
    fieldLevel = 6,
    buildingLevels = {},
    resources = null,
} = {}) {
    const buildings = [];
    const fieldTypes = ['woodcutter', 'clayPit', 'ironMine', 'cropland'];
    let fieldId = 1;

    fieldTypes.forEach(type => {
        for (let i = 0; i < 3; i += 1) {
            buildings.push({ id: `f_${fieldId}`, type, level: fieldLevel });
            fieldId += 1;
        }
    });

    const coreBuildings = [
        'mainBuilding',
        'warehouse',
        'granary',
        'rallyPoint',
        'barracks',
        'academy',
        'smithy',
        'stable',
        'workshop',
        'marketplace',
        'cityWall',
        'palace',
        'embassy',
    ];

    coreBuildings.forEach((type, index) => {
        buildings.push({
            id: `b_${index + 1}`,
            type,
            level: buildingLevels[type] ?? (type === 'workshop' ? 0 : 1),
        });
    });

    return {
        id,
        name: `${race}_village`,
        ownerId,
        race,
        coords: { x: 0, y: 0 },
        maxConstructionSlots: 2,
        maxRecruitmentSlots: 3,
        buildings,
        constructionQueue: [],
        recruitmentQueue: [],
        research: { completed: [], queue: [] },
        smithy: { queue: [], upgrades: {} },
        unitsInVillage: {},
        resources: resources || {
            wood: { current: 1200, capacity: 1600, production: 0 },
            stone: { current: 1200, capacity: 1600, production: 0 },
            iron: { current: 1200, capacity: 1600, production: 0 },
            food: { current: 1200, capacity: 1600, production: 0 },
        },
        budgetRatio: { econ: 0.5, mil: 0.5 },
        budget: {
            econ: { wood: 600, stone: 600, iron: 600, food: 600 },
            mil: { wood: 600, stone: 600, iron: 600, food: 600 },
        },
        population: { current: 250, max: 500, foodConsumption: 0 },
    };
}

function createGameState(village) {
    return {
        startedAt: Date.now(),
        villages: [village],
        aiState: {
            [village.ownerId]: {},
        },
    };
}

class MockActionExecutor {
    constructor(mode = 'fail_all', race = null) {
        this.mode = mode;
        this.race = race;
        this.planSteps = [];
    }

    resolveUnitId(identifier) {
        return resolveUnitIdForRace(identifier, this.race || 'germans') || identifier;
    }

    getTrainingBuildingForUnit(unitId) {
        return getTrainingBuildingForUnitId(unitId, this.race || 'germans') || 'barracks';
    }

    executePlanStep(village, step) {
        this.planSteps.push(step);

        if (this.mode === 'prereq_block') {
            if (step?.type === 'building' || step?.type === 'resource_fields_level') {
                return {
                    success: false,
                    reason: 'PREREQUISITES_NOT_MET',
                    details: { required: { academy: 5 } },
                };
            }
            return { success: false, reason: 'NO_CANDIDATE_FOUND' };
        }

        if (this.mode === 'queue_full_on_units') {
            if (step?.type === 'building' || step?.type === 'resource_fields_level') {
                return { success: false, reason: 'NO_CANDIDATE_FOUND' };
            }
            if (step?.type === 'units') {
                return { success: false, reason: 'QUEUE_FULL' };
            }
            return { success: false, reason: 'NO_CANDIDATE_FOUND' };
        }

        if (this.mode === 'storage_block') {
            const needed = {
                wood: (village.resources?.wood?.capacity || 0) + 700,
                stone: 10,
                iron: 10,
                food: 10,
            };

            if (step?.type === 'building' || step?.type === 'resource_fields_level' || step?.type === 'units') {
                return {
                    success: false,
                    reason: 'INSUFFICIENT_RESOURCES',
                    details: { needed },
                };
            }

            return { success: false, reason: 'NO_CANDIDATE_FOUND' };
        }

        if (this.mode === 'research_required_on_units') {
            if (step?.type === 'building' || step?.type === 'resource_fields_level') {
                return { success: false, reason: 'NO_CANDIDATE_FOUND' };
            }

            if (step?.type === 'units') {
                const unitId = resolveUnitIdForRace(step.unitType, village.race) || step.unitType || 'unknown_unit';
                return {
                    success: false,
                    reason: 'RESEARCH_REQUIRED',
                    unitId,
                    details: {
                        unitId,
                    },
                };
            }

            return { success: false, reason: 'NO_CANDIDATE_FOUND' };
        }

        if (this.mode === 'recruit_partial_success') {
            if (step?.type === 'building' || step?.type === 'resource_fields_level') {
                return { success: false, reason: 'NO_CANDIDATE_FOUND' };
            }

            if (step?.type === 'units') {
                const unitId = resolveUnitIdForRace(step.unitType, village.race) || step.unitType || 'unknown_unit';
                return {
                    success: true,
                    reason: 'MOCK_RECRUIT_PARTIAL',
                    unitId,
                    count: 1,
                    timePerUnit: 10_000,
                };
            }
        }

        return { success: false, reason: 'NO_CANDIDATE_FOUND' };
    }

    executeGoalAction() {}
}

function runGermanCycle({ village, gameState, phaseState, executor }) {
    return runGermanEconomicPhaseCycle({
        village,
        gameState,
        phaseState,
        difficulty: 'Pesadilla',
        gameSpeed: 1,
        villageCombatState: {
            threatLevel: 'low',
            shouldPauseEconomicConstruction: false,
            shouldBoostEmergencyRecruitment: false,
            sourceMovementIds: [],
            expiresAt: Date.now() + 60_000,
        },
        actionExecutor: executor,
        log: () => {},
    });
}

function runEgyptianCycle({ village, gameState, phaseState, executor }) {
    return runEgyptianEconomicPhaseCycle({
        village,
        gameState,
        phaseState,
        difficulty: 'Pesadilla',
        gameSpeed: 1,
        villageCombatState: {
            threatLevel: 'low',
            shouldPauseEconomicConstruction: false,
            shouldBoostEmergencyRecruitment: false,
            expiresAt: Date.now() + 60_000,
        },
        actionExecutor: executor,
        log: () => {},
    });
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

runCheck('Contract PREREQUISITES_NOT_MET crea subgoal en ambos motores', () => {
    const germanVillage = createVillage({ race: 'germans', ownerId: 'ai_g' });
    const germanGameState = createGameState(germanVillage);
    const germanState = createDefaultGermanPhaseState();
    germanState.activePhaseId = GERMAN_PHASE_IDS.phase3;
    runGermanCycle({
        village: germanVillage,
        gameState: germanGameState,
        phaseState: germanState,
        executor: new MockActionExecutor('prereq_block', 'germans'),
    });

    assert(Boolean(germanState.activeSubGoal), 'german debe activar subgoal recuperable');
    assert(germanState.activeSubGoal.reason === 'PREREQUISITES_NOT_MET', 'german debe preservar reason PREREQUISITES_NOT_MET');
    assert(germanState.activeSubGoal.resolverStep?.buildingType === 'academy', 'german debe resolver prerequisito academy');

    const egyptVillage = createVillage({ race: 'egyptians', ownerId: 'ai_e' });
    const egyptGameState = createGameState(egyptVillage);
    const egyptState = createDefaultEgyptianPhaseState();
    egyptState.activePhaseId = EGYPTIAN_PHASE_IDS.phase3;
    runEgyptianCycle({
        village: egyptVillage,
        gameState: egyptGameState,
        phaseState: egyptState,
        executor: new MockActionExecutor('prereq_block', 'egyptians'),
    });

    assert(Boolean(egyptState.activeSubGoal), 'egypt debe activar subgoal recuperable');
    assert(egyptState.activeSubGoal.reason === 'PREREQUISITES_NOT_MET', 'egypt debe preservar reason PREREQUISITES_NOT_MET');
    assert(egyptState.activeSubGoal.resolverStep?.buildingType === 'academy', 'egypt debe resolver prerequisito academy');
});

runCheck('Contract QUEUE_FULL crea wait_queue en ambos motores', () => {
    const germanVillage = createVillage({ race: 'germans', ownerId: 'ai_g2' });
    const germanGameState = createGameState(germanVillage);
    const germanState = createDefaultGermanPhaseState();
    germanState.activePhaseId = GERMAN_PHASE_IDS.phase3;
    runGermanCycle({
        village: germanVillage,
        gameState: germanGameState,
        phaseState: germanState,
        executor: new MockActionExecutor('queue_full_on_units', 'germans'),
    });

    assert(Boolean(germanState.activeSubGoal), 'german debe activar subgoal por cola llena');
    assert(germanState.activeSubGoal.kind === 'wait_queue', 'german debe pasar a wait_queue');

    const egyptVillage = createVillage({ race: 'egyptians', ownerId: 'ai_e2' });
    const egyptGameState = createGameState(egyptVillage);
    const egyptState = createDefaultEgyptianPhaseState();
    egyptState.activePhaseId = EGYPTIAN_PHASE_IDS.phase3;
    runEgyptianCycle({
        village: egyptVillage,
        gameState: egyptGameState,
        phaseState: egyptState,
        executor: new MockActionExecutor('queue_full_on_units', 'egyptians'),
    });

    assert(Boolean(egyptState.activeSubGoal), 'egypt debe activar subgoal por cola llena');
    assert(egyptState.activeSubGoal.kind === 'wait_queue', 'egypt debe pasar a wait_queue');
});

runCheck('Contract INSUFFICIENT_RESOURCES por capacidad crea resolver de almacenamiento', () => {
    const germanVillage = createVillage({ race: 'germans', ownerId: 'ai_g3' });
    const germanGameState = createGameState(germanVillage);
    const germanState = createDefaultGermanPhaseState();
    germanState.activePhaseId = GERMAN_PHASE_IDS.phase3;
    runGermanCycle({
        village: germanVillage,
        gameState: germanGameState,
        phaseState: germanState,
        executor: new MockActionExecutor('storage_block', 'germans'),
    });

    assert(Boolean(germanState.activeSubGoal), 'german debe activar subgoal por recursos');
    assert(germanState.activeSubGoal.resolverStep?.buildingType === 'warehouse', 'german debe resolver con warehouse');

    const egyptVillage = createVillage({ race: 'egyptians', ownerId: 'ai_e3' });
    const egyptGameState = createGameState(egyptVillage);
    const egyptState = createDefaultEgyptianPhaseState();
    egyptState.activePhaseId = EGYPTIAN_PHASE_IDS.phase3;
    runEgyptianCycle({
        village: egyptVillage,
        gameState: egyptGameState,
        phaseState: egyptState,
        executor: new MockActionExecutor('storage_block', 'egyptians'),
    });

    assert(Boolean(egyptState.activeSubGoal), 'egypt debe activar subgoal por recursos');
    assert(egyptState.activeSubGoal.resolverStep?.buildingType === 'warehouse', 'egypt debe resolver con warehouse');
});

runCheck('Contract ciclos: solo bloques completos de 3 minutos', () => {
    const germanVillage = createVillage({ race: 'germans', ownerId: 'ai_g4' });
    const germanGameState = createGameState(germanVillage);
    const germanState = createDefaultGermanPhaseState();
    germanState.activePhaseId = GERMAN_PHASE_IDS.phase3;
    runGermanCycle({
        village: germanVillage,
        gameState: germanGameState,
        phaseState: germanState,
        executor: new MockActionExecutor('recruit_partial_success', 'germans'),
    });
    const germanStatus = getGermanPhaseCycleStatus(germanState, 'Pesadilla', 'phase3');
    assert(germanStatus.completed === 0, 'german no debe contar 10s como ciclo completo');

    const egyptVillage = createVillage({ race: 'egyptians', ownerId: 'ai_e4' });
    const egyptGameState = createGameState(egyptVillage);
    const egyptState = createDefaultEgyptianPhaseState();
    egyptState.activePhaseId = EGYPTIAN_PHASE_IDS.phase3;
    runEgyptianCycle({
        village: egyptVillage,
        gameState: egyptGameState,
        phaseState: egyptState,
        executor: new MockActionExecutor('recruit_partial_success', 'egyptians'),
    });
    const egyptStatus = getEgyptianPhaseCycleStatus(egyptState, 'Pesadilla', 'phase3');
    assert(egyptStatus.completed === 0, 'egypt no debe contar 10s como ciclo completo');
});

runCheck('Contract RESEARCH_REQUIRED crea subgoal de investigacion en ambos motores', () => {
    const germanVillage = createVillage({ race: 'germans', ownerId: 'ai_g5' });
    const germanGameState = createGameState(germanVillage);
    const germanState = createDefaultGermanPhaseState();
    germanState.activePhaseId = GERMAN_PHASE_IDS.phase3;
    runGermanCycle({
        village: germanVillage,
        gameState: germanGameState,
        phaseState: germanState,
        executor: new MockActionExecutor('research_required_on_units', 'germans'),
    });

    assert(Boolean(germanState.activeSubGoal), 'german debe activar subgoal por RESEARCH_REQUIRED');
    assert(germanState.activeSubGoal.reason === 'RESEARCH_REQUIRED', 'german debe preservar reason RESEARCH_REQUIRED');
    assert(germanState.activeSubGoal.kind === 'research_prerequisite', 'german debe crear subgoal research_prerequisite');
    assert(germanState.activeSubGoal.resolverStep?.type === 'research', 'german debe resolver via step de investigacion');

    const egyptVillage = createVillage({ race: 'egyptians', ownerId: 'ai_e5' });
    const egyptGameState = createGameState(egyptVillage);
    const egyptState = createDefaultEgyptianPhaseState();
    egyptState.activePhaseId = EGYPTIAN_PHASE_IDS.phase3;
    runEgyptianCycle({
        village: egyptVillage,
        gameState: egyptGameState,
        phaseState: egyptState,
        executor: new MockActionExecutor('research_required_on_units', 'egyptians'),
    });

    assert(Boolean(egyptState.activeSubGoal), 'egypt debe activar subgoal por RESEARCH_REQUIRED');
    assert(egyptState.activeSubGoal.reason === 'RESEARCH_REQUIRED', 'egypt debe preservar reason RESEARCH_REQUIRED');
    assert(egyptState.activeSubGoal.kind === 'research_prerequisite', 'egypt debe crear subgoal research_prerequisite');
    assert(egyptState.activeSubGoal.resolverStep?.type === 'research', 'egypt debe resolver via step de investigacion');
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
    console.error(`\nValidacion de contrato de motores fallo (${failed.length}/${checks.length}).`);
    process.exit(1);
}

console.log(`\nValidacion de contrato de motores aprobada (${checks.length}/${checks.length}).`);
