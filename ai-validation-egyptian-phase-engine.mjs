import {
    createDefaultEgyptianPhaseState,
    EGYPTIAN_PHASE_IDS,
    runEgyptianEconomicPhaseCycle,
} from './src/features/game/ai/controller/egyptian-phase-engine.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function createVillage({
    id = 'v1',
    ownerId = 'ai_egypt',
    race = 'egyptians',
    fieldLevel = 1,
    buildingLevels = {},
    unitsInVillage = {},
    recruitmentQueue = [],
    constructionQueue = [],
    population = 220,
    resources = null,
} = {}) {
    const buildings = [];
    const fieldTypes = ['woodcutter', 'clayPit', 'ironMine', 'cropland'];
    let fieldId = 1;

    fieldTypes.forEach(type => {
        for (let i = 0; i < 3; i += 1) {
            buildings.push({
                id: `f_${fieldId}`,
                type,
                level: fieldLevel,
            });
            fieldId += 1;
        }
    });

    const coreBuildings = [
        'mainBuilding',
        'warehouse',
        'granary',
        'cityWall',
        'rallyPoint',
        'barracks',
        'academy',
        'smithy',
        'stable',
        'marketplace',
        'embassy',
        'palace',
        'workshop',
    ];

    coreBuildings.forEach(type => {
        buildings.push({
            id: `b_${type}`,
            type,
            level: buildingLevels[type] || 0,
        });
    });

    const defaultResources = {
        wood: { current: 600, capacity: 2000 },
        stone: { current: 620, capacity: 2000 },
        iron: { current: 590, capacity: 2000 },
        food: { current: 650, capacity: 2000 },
    };

    return {
        id,
        ownerId,
        race,
        name: `Village-${id}`,
        coords: { x: 0, y: 0 },
        buildings,
        constructionQueue,
        recruitmentQueue,
        unitsInVillage,
        resources: resources || defaultResources,
        population: { current: population },
        budget: {
            econ: { wood: 2000, stone: 2000, iron: 2000, food: 2000 },
            mil: { wood: 2000, stone: 2000, iron: 2000, food: 2000 },
        },
        budgetRatio: { econ: 0.6, mil: 0.4 },
        maxConstructionSlots: 2,
        smithy: { upgrades: {} },
        research: { completed: [], queue: [] },
        reinforcements: [],
    };
}

function createGameState(village, extra = {}) {
    return {
        villages: [village, ...(extra.villages || [])],
        movements: extra.movements || [],
        players: extra.players || [
            { id: village.ownerId, race: village.race },
            { id: 'enemy_1', race: 'germans' },
        ],
        mapData: extra.mapData || [],
        startedAt: Date.now() - 90_000,
    };
}

class MockActionExecutor {
    constructor(mode = 'fail_all') {
        this.mode = mode;
        this.planSteps = [];
        this.goalActions = [];
    }

    executePlanStep(village, step, gameState) {
        this.planSteps.push(step);

        if (this.mode === 'success_first') {
            return { success: true, reason: 'MOCK_SUCCESS' };
        }

        return { success: false, reason: 'NO_CANDIDATE_FOUND' };
    }

    executeGoalAction(action, villages, gameState) {
        this.goalActions.push(action?.type || 'unknown');
    }
}

function runCycle({ village, gameState, phaseState, threatContext, executor, difficulty = 'Pesadilla' }) {
    return runEgyptianEconomicPhaseCycle({
        village,
        gameState,
        phaseState,
        difficulty,
        villageCombatState: {
            threatLevel: threatContext.threatLevel,
            shouldPauseEconomicConstruction: Boolean(threatContext.shouldPauseEconomicConstruction),
            shouldBoostEmergencyRecruitment: Boolean(threatContext.shouldBoostEmergencyRecruitment),
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

runCheck('F1 amenaza baja evita reclutamiento innecesario', () => {
    const village = createVillage({
        fieldLevel: 3,
        buildingLevels: {
            warehouse: 4,
            granary: 4,
            mainBuilding: 4,
            cityWall: 0,
        },
    });
    const gameState = createGameState(village);
    const phaseState = createDefaultEgyptianPhaseState();
    phaseState.activePhaseId = EGYPTIAN_PHASE_IDS.phase1;

    const executor = new MockActionExecutor('fail_all');
    runCycle({
        village,
        gameState,
        phaseState,
        executor,
        threatContext: {
            threatLevel: 'low',
            shouldPauseEconomicConstruction: false,
            shouldBoostEmergencyRecruitment: false,
        },
    });

    const recruited = executor.planSteps.some(step => step?.type === 'units');
    assert(!recruited, 'fase 1 en amenaza baja no debe encolar reclutamiento defensivo por defecto');
});

runCheck('F2 transicion exige defensa + uptime de cola', () => {
    const village = createVillage({
        fieldLevel: 5,
        buildingLevels: {
            barracks: 3,
            cityWall: 5,
        },
        unitsInVillage: {
            ash_warden_egypt: 40,
            slave_militia_egypt: 15,
        },
        population: 240,
    });
    const gameState = createGameState(village);
    const phaseState = createDefaultEgyptianPhaseState();
    phaseState.activePhaseId = EGYPTIAN_PHASE_IDS.phase2;
    phaseState.phase2MilitaryQueueSamples = 8;
    phaseState.phase2MilitaryQueueActiveSamples = 4;

    const executor = new MockActionExecutor('fail_all');
    runCycle({
        village,
        gameState,
        phaseState,
        executor,
        threatContext: {
            threatLevel: 'low',
            shouldPauseEconomicConstruction: false,
            shouldBoostEmergencyRecruitment: false,
        },
    });

    assert(phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase3, 'fase 2 debe pasar a fase 3 al cumplir gates defensivos');
});

runCheck('F3 transicion exige madurez defensiva imperial', () => {
    const village = createVillage({
        fieldLevel: 7,
        buildingLevels: {
            cityWall: 8,
            academy: 4,
            smithy: 4,
            stable: 3,
        },
        unitsInVillage: {
            ash_warden_egypt: 72,
            sopdu_explorer_egypt: 8,
        },
    });
    const gameState = createGameState(village);
    const phaseState = createDefaultEgyptianPhaseState();
    phaseState.activePhaseId = EGYPTIAN_PHASE_IDS.phase3;
    phaseState.phase3DefensiveQueueSamples = 10;
    phaseState.phase3DefensiveQueueActiveSamples = 5;

    const executor = new MockActionExecutor('fail_all');
    runCycle({
        village,
        gameState,
        phaseState,
        executor,
        threatContext: {
            threatLevel: 'low',
            shouldPauseEconomicConstruction: false,
            shouldBoostEmergencyRecruitment: false,
        },
    });

    assert(phaseState.activePhaseId === EGYPTIAN_PHASE_IDS.phase4, 'fase 3 debe pasar a fase 4 con senales estables de red defensiva');
});

runCheck('F5 amenaza media filtra construcciones de expansion temprana', () => {
    const village = createVillage({
        fieldLevel: 8,
        buildingLevels: {
            cityWall: 11,
            marketplace: 6,
            stable: 4,
            warehouse: 12,
            granary: 12,
            palace: 0,
            embassy: 0,
        },
        unitsInVillage: {
            ash_warden_egypt: 100,
            sopdu_explorer_egypt: 14,
        },
    });
    const gameState = createGameState(village);
    const phaseState = createDefaultEgyptianPhaseState();
    phaseState.activePhaseId = EGYPTIAN_PHASE_IDS.phase5;

    const executor = new MockActionExecutor('success_first');
    runCycle({
        village,
        gameState,
        phaseState,
        executor,
        threatContext: {
            threatLevel: 'medium',
            shouldPauseEconomicConstruction: true,
            shouldBoostEmergencyRecruitment: false,
        },
    });

    const firstStep = executor.planSteps[0];
    assert(firstStep?.type === 'building', 'fase 5 con amenaza media debe iniciar con paso de construccion');
    assert(firstStep?.buildingType !== 'embassy' && firstStep?.buildingType !== 'palace', 'amenaza media debe omitir rush de embassy/palace');
});

runCheck('F5 amenaza alta bloquea ejecucion de expansion', () => {
    const village = createVillage({
        fieldLevel: 8,
        buildingLevels: {
            cityWall: 12,
            marketplace: 10,
            stable: 7,
            palace: 10,
            embassy: 1,
        },
        unitsInVillage: {
            ash_warden_egypt: 110,
            anhur_guard_egypt: 20,
            settler_egypt: 3,
        },
    });
    const gameState = createGameState(village);
    const phaseState = createDefaultEgyptianPhaseState();
    phaseState.activePhaseId = EGYPTIAN_PHASE_IDS.phase5;
    phaseState.lastSafeExpansionCheckAt = Date.now() - 90_000;

    const executor = new MockActionExecutor('fail_all');
    runCycle({
        village,
        gameState,
        phaseState,
        executor,
        threatContext: {
            threatLevel: 'high',
            shouldPauseEconomicConstruction: true,
            shouldBoostEmergencyRecruitment: true,
        },
    });

    assert(executor.goalActions.length === 0, 'amenaza alta debe bloquear ejecucion de colonizacion');
    assert((phaseState.kpiExpansionBlockedByThreat || 0) >= 1, 'amenaza alta debe incrementar KPI de expansion bloqueada');
});

runCheck('F5 amenaza baja permite expansion segura', () => {
    const village = createVillage({
        fieldLevel: 8,
        buildingLevels: {
            cityWall: 12,
            marketplace: 10,
            stable: 7,
            palace: 10,
            embassy: 1,
        },
        unitsInVillage: {
            ash_warden_egypt: 110,
            anhur_guard_egypt: 20,
            settler_egypt: 3,
        },
    });
    const gameState = createGameState(village);
    const phaseState = createDefaultEgyptianPhaseState();
    phaseState.activePhaseId = EGYPTIAN_PHASE_IDS.phase5;
    phaseState.lastSafeExpansionCheckAt = Date.now() - 90_000;

    const executor = new MockActionExecutor('fail_all');
    runCycle({
        village,
        gameState,
        phaseState,
        executor,
        threatContext: {
            threatLevel: 'low',
            shouldPauseEconomicConstruction: false,
            shouldBoostEmergencyRecruitment: false,
        },
    });

    assert(executor.goalActions.includes('settle_new_village'), 'amenaza baja con gates seguros debe disparar intento de colonizacion');
    assert((phaseState.kpiExpansionLaunches || 0) >= 1, 'gate exitoso en amenaza baja debe incrementar KPI de lanzamientos');
});

const failedChecks = checks.filter(check => !check.ok);
checks.forEach(check => {
    if (check.ok) {
        console.log(`OK   ${check.name}`);
    } else {
        console.error(`FALLO ${check.name} :: ${check.error}`);
    }
});

if (failedChecks.length > 0) {
    console.error(`\nValidacion del motor egipcio fallida (${failedChecks.length}/${checks.length}).`);
    process.exit(1);
}

console.log(`\nValidacion del motor egipcio aprobada (${checks.length}/${checks.length}).`);
