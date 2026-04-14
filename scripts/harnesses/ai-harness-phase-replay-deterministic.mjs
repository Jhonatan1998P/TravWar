import fs from 'node:fs';
import path from 'node:path';
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

function mulberry32(seed) {
    let t = seed >>> 0;
    return function next() {
        t += 0x6D2B79F5;
        let value = t;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function createVillage({ race, ownerId, fieldLevel = 6 }) {
    const buildings = [];
    const fieldTypes = ['woodcutter', 'clayPit', 'ironMine', 'cropland'];
    let fieldId = 1;

    fieldTypes.forEach(type => {
        for (let i = 0; i < 3; i += 1) {
            buildings.push({ id: `f_${fieldId}`, type, level: fieldLevel });
            fieldId += 1;
        }
    });

    const core = {
        mainBuilding: 6,
        warehouse: 8,
        granary: 8,
        rallyPoint: 3,
        barracks: 5,
        academy: 4,
        smithy: 4,
        stable: 3,
        workshop: 2,
        marketplace: 6,
        cityWall: 7,
        palace: 6,
        embassy: 1,
    };

    Object.entries(core).forEach(([type, level], index) => {
        buildings.push({ id: `b_${index + 1}`, type, level });
    });

    return {
        id: `${race}_v1`,
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
        resources: {
            wood: { current: 1500, capacity: 2200, production: 0 },
            stone: { current: 1500, capacity: 2200, production: 0 },
            iron: { current: 1500, capacity: 2200, production: 0 },
            food: { current: 1500, capacity: 2200, production: 0 },
        },
        budgetRatio: { econ: 0.5, mil: 0.5 },
        budget: {
            econ: { wood: 750, stone: 750, iron: 750, food: 750 },
            mil: { wood: 750, stone: 750, iron: 750, food: 750 },
        },
        population: { current: 280, max: 900, foodConsumption: 0 },
    };
}

class DeterministicActionExecutor {
    constructor(rng, race) {
        this.rng = rng;
        this.race = race;
        this.goalActions = 0;
    }

    resolveUnitId(identifier) {
        return resolveUnitIdForRace(identifier, this.race || 'germans') || identifier;
    }

    getTrainingBuildingForUnit(unitId) {
        return getTrainingBuildingForUnitId(unitId, this.race || 'germans') || 'barracks';
    }

    executePlanStep(village, step) {
        const roll = this.rng();

        if (step?.type === 'building') {
            if (roll < 0.08) {
                return { success: false, reason: 'PREREQUISITES_NOT_MET', details: { required: { academy: 5 } } };
            }
            if (roll < 0.16) {
                return {
                    success: false,
                    reason: 'INSUFFICIENT_RESOURCES',
                    details: {
                        needed: {
                            wood: (village.resources?.wood?.capacity || 0) + 300,
                            stone: 10,
                            iron: 10,
                            food: 10,
                        },
                    },
                };
            }

            const building = village.buildings.find(candidate => candidate.type === step.buildingType);
            if (building) {
                const target = Math.max(1, Number(step.level) || 1);
                building.level = Math.min(20, Math.max(building.level || 0, target));
            }

            return { success: true, reason: 'SIM_BUILD_OK' };
        }

        if (step?.type === 'resource_fields_level') {
            if (roll < 0.12) {
                return {
                    success: false,
                    reason: 'INSUFFICIENT_RESOURCES',
                    details: {
                        needed: {
                            wood: (village.resources?.wood?.capacity || 0) + 300,
                            stone: 10,
                            iron: 10,
                            food: 10,
                        },
                    },
                };
            }

            const target = Math.max(1, Number(step.level) || 1);
            for (const building of village.buildings) {
                if (['woodcutter', 'clayPit', 'ironMine', 'cropland'].includes(building.type)) {
                    building.level = Math.min(20, Math.max(building.level || 0, target));
                }
            }
            return { success: true, reason: 'SIM_FIELDS_OK' };
        }

        if (step?.type === 'research') {
            if (roll < 0.1) return { success: false, reason: 'QUEUE_FULL' };
            const unitId = resolveUnitIdForRace(step.unitType || step.unitId, village.race) || step.unitType || step.unitId;
            if (unitId && !village.research.completed.includes(unitId)) {
                village.research.completed.push(unitId);
            }
            return { success: true, reason: 'SIM_RESEARCH_OK', unitId };
        }

        if (step?.type === 'units') {
            if (roll < 0.1) return { success: false, reason: 'QUEUE_FULL' };
            if (roll < 0.2) {
                return {
                    success: false,
                    reason: 'INSUFFICIENT_RESOURCES',
                    details: {
                        needed: {
                            wood: (village.resources?.wood?.capacity || 0) + 250,
                            stone: 10,
                            iron: 10,
                            food: 10,
                        },
                    },
                };
            }

            const unitId = resolveUnitIdForRace(step.unitType, village.race) || step.unitType || 'unknown_unit';
            const count = 1 + Math.floor(this.rng() * 4);
            const timePerUnit = 30_000 + Math.floor(this.rng() * 30_000);
            village.unitsInVillage[unitId] = (village.unitsInVillage[unitId] || 0) + count;

            return {
                success: true,
                reason: 'SIM_RECRUIT_OK',
                unitId,
                count,
                timePerUnit,
            };
        }

        return { success: false, reason: 'NO_CANDIDATE_FOUND' };
    }

    executeGoalAction() {
        this.goalActions += 1;
    }
}

function withDeterministicClockAndRandom(seed, runner) {
    const originalNow = Date.now;
    const originalRandom = Math.random;
    const random = mulberry32(seed);
    let now = 1_700_000_000_000;

    Date.now = () => now;
    Math.random = () => random();

    try {
        return runner({
            advanceMs: ms => {
                now += Math.max(0, Number(ms) || 0);
            },
        });
    } finally {
        Date.now = originalNow;
        Math.random = originalRandom;
    }
}

function buildThreatContext(roll) {
    const threatLevel = roll < 0.72
        ? 'low'
        : roll < 0.88
            ? 'medium'
            : roll < 0.96
                ? 'high'
                : 'critical';

    return {
        threatLevel,
        shouldPauseEconomicConstruction: threatLevel === 'high' || threatLevel === 'critical',
        shouldBoostEmergencyRecruitment: threatLevel === 'high' || threatLevel === 'critical',
        sourceMovementIds: [],
        expiresAt: Date.now() + 60_000,
    };
}

function getGermanPhaseKey(phaseId) {
    if (phaseId === GERMAN_PHASE_IDS.phase1) return 'phase1';
    if (phaseId === GERMAN_PHASE_IDS.phase2) return 'phase2';
    if (phaseId === GERMAN_PHASE_IDS.phase3) return 'phase3';
    if (phaseId === GERMAN_PHASE_IDS.phase4) return 'phase4';
    if (phaseId === GERMAN_PHASE_IDS.phase5) return 'phase5';
    return null;
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

function runDeterministicRound({ seed, cycles = 120 }) {
    return withDeterministicClockAndRandom(seed, ({ advanceMs }) => {
        const germanRng = mulberry32((seed * 31) + 101);
        const egyptRng = mulberry32((seed * 31) + 202);

        const germanVillage = createVillage({ race: 'germans', ownerId: 'ai_german_det' });
        const egyptVillage = createVillage({ race: 'egyptians', ownerId: 'ai_egypt_det' });

        const germanState = createDefaultGermanPhaseState(Date.now());
        germanState.activePhaseId = GERMAN_PHASE_IDS.phase3;

        const egyptState = createDefaultEgyptianPhaseState(Date.now());
        egyptState.activePhaseId = EGYPTIAN_PHASE_IDS.phase3;

        const germanGameState = {
            startedAt: Date.now(),
            villages: [germanVillage],
            aiState: { [germanVillage.ownerId]: {} },
        };

        const egyptGameState = {
            startedAt: Date.now(),
            villages: [egyptVillage],
            aiState: { [egyptVillage.ownerId]: {} },
        };

        const germanExecutor = new DeterministicActionExecutor(germanRng, 'germans');
        const egyptExecutor = new DeterministicActionExecutor(egyptRng, 'egyptians');

        for (let cycle = 0; cycle < cycles; cycle += 1) {
            advanceMs(5_000);

            for (const resource of ['wood', 'stone', 'iron', 'food']) {
                germanVillage.resources[resource].current = Math.min(
                    germanVillage.resources[resource].capacity,
                    germanVillage.resources[resource].current + 35 + Math.floor(germanRng() * 25),
                );
                egyptVillage.resources[resource].current = Math.min(
                    egyptVillage.resources[resource].capacity,
                    egyptVillage.resources[resource].current + 35 + Math.floor(egyptRng() * 25),
                );
            }

            runGermanEconomicPhaseCycle({
                village: germanVillage,
                gameState: germanGameState,
                phaseState: germanState,
                difficulty: 'Pesadilla',
                gameSpeed: 1,
                villageCombatState: buildThreatContext(germanRng()),
                actionExecutor: germanExecutor,
                log: () => {},
            });

            runEgyptianEconomicPhaseCycle({
                village: egyptVillage,
                gameState: egyptGameState,
                phaseState: egyptState,
                difficulty: 'Pesadilla',
                gameSpeed: 1,
                villageCombatState: buildThreatContext(egyptRng()),
                actionExecutor: egyptExecutor,
                log: () => {},
            });
        }

        const germanPhaseKey = getGermanPhaseKey(germanState.activePhaseId);
        const egyptPhaseKey = getEgyptianPhaseKey(egyptState.activePhaseId);

        const germanCycleStatus = germanPhaseKey
            ? getGermanPhaseCycleStatus(germanState, 'Pesadilla', germanPhaseKey)
            : { completed: 0, max: 0 };
        const egyptCycleStatus = egyptPhaseKey
            ? getEgyptianPhaseCycleStatus(egyptState, 'Pesadilla', egyptPhaseKey)
            : { completed: 0, max: 0 };

        return {
            seed,
            cycles,
            german: {
                activePhaseId: germanState.activePhaseId,
                transitions: germanState.transitions.length,
                subGoalHistory: germanState.subGoalHistory.length,
                activeSubGoalKind: germanState.activeSubGoal?.kind || null,
                recruitmentCycles: {
                    completed: germanCycleStatus.completed,
                    max: germanCycleStatus.max,
                },
                goalActions: germanExecutor.goalActions,
            },
            egyptian: {
                activePhaseId: egyptState.activePhaseId,
                transitions: egyptState.transitions.length,
                subGoalHistory: egyptState.subGoalHistory.length,
                activeSubGoalKind: egyptState.activeSubGoal?.kind || null,
                recruitmentCycles: {
                    completed: egyptCycleStatus.completed,
                    max: egyptCycleStatus.max,
                },
                goalActions: egyptExecutor.goalActions,
            },
        };
    });
}

const baselineA = runDeterministicRound({ seed: 1337, cycles: 140 });
const baselineB = runDeterministicRound({ seed: 1337, cycles: 140 });
const alternateSeed = runDeterministicRound({ seed: 7331, cycles: 140 });

const deterministicMatch = JSON.stringify(baselineA) === JSON.stringify(baselineB);
if (!deterministicMatch) {
    console.error('FAIL deterministic replay mismatch with same seed.');
    process.exit(1);
}

const reportPath = path.join(process.cwd(), 'reports', 'reporte-convergencia-fases.md');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

const lines = [
    '# Reporte de convergencia por replay determinista',
    '',
    `- deterministic_same_seed: ${deterministicMatch ? 'OK' : 'FAIL'}`,
    `- seed_base: ${baselineA.seed}`,
    `- seed_alterno: ${alternateSeed.seed}`,
    `- ciclos: ${baselineA.cycles}`,
    '',
    '## Snapshot seed base',
    '```json',
    JSON.stringify(baselineA, null, 2),
    '```',
    '',
    '## Snapshot seed alterno',
    '```json',
    JSON.stringify(alternateSeed, null, 2),
    '```',
];

fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');

console.log('OK   Replay determinista consistente para ambos motores.');
console.log(`INFO Reporte generado en: ${reportPath}`);
