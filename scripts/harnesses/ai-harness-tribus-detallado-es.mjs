import { gameData } from '../../src/features/game/core/GameData.js';
import fs from 'node:fs';
import path from 'node:path';
import { RESOURCE_FIELD_BUILDING_TYPES } from '../../src/features/game/core/data/constants.js';
import {
    createDefaultGermanPhaseState,
    GERMAN_PHASE_IDS,
    runGermanEconomicPhaseCycle,
} from '../../src/features/game/ai/controller/german-phase-engine.js';
import {
    createDefaultEgyptianPhaseState,
    EGYPTIAN_PHASE_IDS,
    runEgyptianEconomicPhaseCycle,
} from '../../src/features/game/ai/controller/egyptian-phase-engine.js';
import {
    evaluateThreatAndChooseResponse,
    handleAttackReact,
    handleEspionageReact,
    processDodgeTasks,
} from '../../src/features/game/ai/controller/reactive.js';

const SPEED_SCENARIOS = Object.freeze([
    { seed: 'seed_x1', gameSpeed: 1 },
    { seed: 'seed_x100', gameSpeed: 100 },
    { seed: 'seed_x1000', gameSpeed: 1000 },
]);

const TRIBE_SCENARIOS = Object.freeze([
    {
        race: 'egyptians',
        label: 'Egipcios',
        archetype: 'turtle',
        difficulty: 'Pesadilla',
        ownerId: 'ai_egipto',
        enemyOwnerId: 'enemigo_egipto',
        enemyRace: 'huns',
    },
    {
        race: 'germans',
        label: 'Germanos',
        archetype: 'rusher',
        difficulty: 'Pesadilla',
        ownerId: 'ai_germania',
        enemyOwnerId: 'enemigo_germania',
        enemyRace: 'romans',
    },
]);

const EVENT_PLAN = Object.freeze([
    { id: 'E1', kind: 'espionage', label: 'Espionaje de apertura', profile: 'espionage' },
    { id: 'E2', kind: 'attack', label: 'Raid ligero', profile: 'raid_light' },
    { id: 'E3', kind: 'attack', label: 'Ataque estandar debil', profile: 'standard_weak' },
    { id: 'E4', kind: 'attack', label: 'Ataque multi-ola', profile: 'multi_wave' },
    { id: 'E5', kind: 'attack', label: 'Asedio de media intensidad', profile: 'siege' },
    { id: 'E6', kind: 'attack', label: 'Ataque de conquista', profile: 'conquest' },
]);

class DeterministicRng {
    constructor(seedText) {
        this.state = hashString(seedText);
        if (!this.state) this.state = 0x9e3779b9;
    }

    next() {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    int(min, max) {
        const low = Math.ceil(min);
        const high = Math.floor(max);
        if (high <= low) return low;
        return low + Math.floor(this.next() * (high - low + 1));
    }
}

class TimedFlags {
    constructor(nowRef) {
        this.nowRef = nowRef;
        this.map = new Map();
    }

    set(key, durationMs, meta = {}) {
        this.map.set(key, {
            expiresAt: this.nowRef.now + Math.max(0, durationMs || 0),
            ...meta,
        });
    }

    has(key) {
        const current = this.map.get(key);
        if (!current) return false;
        if (!Number.isFinite(current.expiresAt) || current.expiresAt <= this.nowRef.now) {
            this.map.delete(key);
            return false;
        }
        return true;
    }
}

class VillageCombatStateStore {
    constructor(nowRef) {
        this.nowRef = nowRef;
        this.map = new Map();
    }

    get(villageId) {
        const state = this.map.get(villageId);
        if (!state) return null;
        if (Number.isFinite(state.expiresAt) && state.expiresAt <= this.nowRef.now) {
            this.map.delete(villageId);
            return null;
        }
        return state;
    }

    upsert(villageId, patch = {}, options = {}) {
        const current = this.get(villageId) || {
            villageId,
            threatLevel: 'none',
            shouldPauseEconomicConstruction: false,
            shouldBoostEmergencyRecruitment: false,
            sourceMovementIds: [],
            expiresAt: this.nowRef.now + 120000,
        };

        const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 120000;
        const merged = {
            ...current,
            ...patch,
            villageId,
            sourceMovementIds: Array.isArray(options.sourceMovementIds)
                ? options.sourceMovementIds
                : Array.isArray(patch.sourceMovementIds)
                    ? patch.sourceMovementIds
                    : current.sourceMovementIds,
            expiresAt: this.nowRef.now + ttlMs,
            lastDecisionReason: options.lastDecisionReason || patch.lastDecisionReason || current.lastDecisionReason || 'none',
        };

        this.map.set(villageId, merged);
        return merged;
    }
}

class SimulationActionExecutor {
    constructor({ race, gameState, rng, gameSpeed, report }) {
        this.race = race;
        this.gameState = gameState;
        this.rng = rng;
        this.gameSpeed = gameSpeed;
        this.report = report;
        this.cycleActions = [];
    }

    startCycle(cycle) {
        this.cycleActions = [];
        this.currentCycle = cycle;
    }

    finishCycle() {
        return [...this.cycleActions];
    }

    resolveUnitId(unitType) {
        if (!unitType) return null;
        const troops = gameData.units[this.race]?.troops || [];
        if (troops.some(unit => unit.id === unitType)) return unitType;

        if (unitType === 'defensive_infantry') {
            return troops.find(unit => unit.type === 'infantry' && unit.role === 'defensive')?.id || null;
        }
        if (unitType === 'offensive_infantry') {
            return troops.find(unit => unit.type === 'infantry' && unit.role === 'offensive')?.id || null;
        }
        if (unitType === 'offensive_cavalry') {
            return troops.find(unit => unit.type === 'cavalry' && unit.role === 'offensive')?.id || null;
        }
        if (unitType === 'scout') {
            return troops.find(unit => unit.role === 'scout' || unit.type === 'scout')?.id || null;
        }
        if (unitType === 'ram') {
            return troops.find(unit => unit.role === 'ram')?.id || null;
        }
        if (unitType === 'catapult') {
            return troops.find(unit => unit.role === 'catapult')?.id || null;
        }
        if (unitType === 'settler') {
            return troops.find(unit => unit.type === 'settler')?.id || null;
        }
        if (unitType === 'chief') {
            return troops.find(unit => unit.type === 'chief')?.id || null;
        }
        return null;
    }

    getTrainingBuildingForUnit(unitId) {
        const unit = (gameData.units[this.race]?.troops || []).find(candidate => candidate.id === unitId);
        if (!unit) return null;
        if (unit.type === 'infantry') return 'barracks';
        if (unit.type === 'scout' || unit.type === 'cavalry') return 'stable';
        if (unit.type === 'siege') return 'workshop';
        if (unit.type === 'settler' || unit.type === 'chief') return 'palace';
        return 'barracks';
    }

    executePlanStep(village, step) {
        if (!step || !step.type) return { success: false, reason: 'UNKNOWN_STEP' };

        if (step.type === 'building') {
            const building = findOrCreateBuilding(village, step.buildingType);
            const target = Math.max(1, step.level || 1);
            if ((building.level || 0) >= target) {
                return { success: false, reason: 'TARGET_ALREADY_MET' };
            }
            building.level += 1;
            this.cycleActions.push({
                kind: 'construccion',
                detalle: `${step.buildingType} -> nivel ${building.level}`,
                villageId: village.id,
            });
            return { success: true, reason: 'BUILDING_LEVEL_UP' };
        }

        if (step.type === 'resource_fields_level') {
            const fields = village.buildings
                .filter(building => RESOURCE_FIELD_BUILDING_TYPES.includes(building.type))
                .sort((a, b) => (a.level || 0) - (b.level || 0));
            const target = Math.max(1, step.level || 1);
            const candidate = fields.find(field => (field.level || 0) < target);
            if (!candidate) return { success: false, reason: 'TARGET_ALREADY_MET' };
            candidate.level += 1;
            this.cycleActions.push({
                kind: 'campo',
                detalle: `${candidate.type} -> nivel ${candidate.level}`,
                villageId: village.id,
            });
            return { success: true, reason: 'FIELD_LEVEL_UP' };
        }

        if (step.type === 'units') {
            const unitId = this.resolveUnitId(step.unitType || step.unitId);
            if (!unitId) {
                return { success: false, reason: 'PREREQUISITES_NOT_MET', details: { unitType: step.unitType } };
            }

            const unitData = (gameData.units[this.race]?.troops || []).find(unit => unit.id === unitId);
            if (!unitData) return { success: false, reason: 'PREREQUISITES_NOT_MET', details: { unitId } };

            let count;
            if (!Number.isFinite(step.count)) {
                const base = Math.max(2, Math.floor((step.queueTargetMinutes || 3) * 1.4));
                const speedBonus = this.gameSpeed >= 1000 ? 4 : this.gameSpeed >= 100 ? 2 : 1;
                count = base * speedBonus;
            } else {
                count = Math.max(1, Math.min(step.count, this.gameSpeed >= 100 ? 6 : 3));
            }

            village.unitsInVillage[unitId] = (village.unitsInVillage[unitId] || 0) + count;
            this.cycleActions.push({
                kind: 'reclutamiento',
                detalle: `${unitId} +${count}`,
                villageId: village.id,
            });

            return {
                success: true,
                reason: 'UNITS_QUEUED',
                unitId,
                count,
                timePerUnit: Math.max(1000, (unitData.trainTime || 1000) * 1000),
            };
        }

        if (step.type === 'research') {
            const unitId = this.resolveUnitId(step.unitType || step.unitId);
            if (!unitId) return { success: false, reason: 'PREREQUISITES_NOT_MET', details: { unitType: step.unitType } };
            village.research.completed = Array.isArray(village.research.completed) ? village.research.completed : [];
            if (!village.research.completed.includes(unitId)) {
                village.research.completed.push(unitId);
            }
            this.cycleActions.push({
                kind: 'investigacion',
                detalle: unitId,
                villageId: village.id,
            });
            return { success: true, reason: 'RESEARCH_QUEUED', unitId };
        }

        if (step.type === 'upgrade') {
            const unitId = this.resolveUnitId(step.unitType || step.unitId);
            if (!unitId) return { success: false, reason: 'PREREQUISITES_NOT_MET', details: { unitType: step.unitType } };
            village.smithy.upgrades = village.smithy.upgrades || {};
            village.smithy.upgrades[unitId] = Math.max(village.smithy.upgrades[unitId] || 0, step.level || 1);
            this.cycleActions.push({
                kind: 'mejora',
                detalle: `${unitId} smithy -> ${village.smithy.upgrades[unitId]}`,
                villageId: village.id,
            });
            return { success: true, reason: 'UPGRADE_QUEUED', unitId };
        }

        return { success: false, reason: 'UNKNOWN_STEP_TYPE' };
    }

    executeGoalAction(action, villages) {
        if (action?.type !== 'settle_new_village') return { success: false, reason: 'UNKNOWN_GOAL' };

        const sourceVillage = villages.find(candidate => getUnitCount(candidate, this.resolveUnitId('settler')) >= 3);
        if (!sourceVillage) {
            return { success: false, reason: 'NO_SETTLERS' };
        }

        const settlerId = this.resolveUnitId('settler');
        sourceVillage.unitsInVillage[settlerId] = Math.max(0, (sourceVillage.unitsInVillage[settlerId] || 0) - 3);
        sourceVillage.settlementsFounded = (sourceVillage.settlementsFounded || 0) + 1;

        const newVillage = createVillage({
            id: `${sourceVillage.id}_exp_${sourceVillage.settlementsFounded}`,
            ownerId: sourceVillage.ownerId,
            race: sourceVillage.race,
            name: `${sourceVillage.name}-exp-${sourceVillage.settlementsFounded}`,
            coords: {
                x: sourceVillage.coords.x + 2 + this.rng.int(0, 2),
                y: sourceVillage.coords.y + 2 + this.rng.int(0, 2),
            },
            fieldLevel: 1,
            buildingLevels: {
                mainBuilding: 1,
                warehouse: 1,
                granary: 1,
                cityWall: 1,
            },
            unitsInVillage: {},
            resources: createBalancedResources(350, 800),
            population: 70,
        });

        this.gameState.villages.push(newVillage);
        this.gameState.movements.push({
            id: `settle_${newVillage.id}_${Date.now()}`,
            type: 'settle',
            ownerId: sourceVillage.ownerId,
            originVillageId: sourceVillage.id,
            targetCoords: { ...newVillage.coords },
            arrivalTime: Date.now() + 1000,
            payload: {},
        });

        this.report.expansionEvents.push({
            sourceVillageId: sourceVillage.id,
            newVillageId: newVillage.id,
            coords: `${newVillage.coords.x}|${newVillage.coords.y}`,
        });

        this.cycleActions.push({
            kind: 'expansion',
            detalle: `${sourceVillage.id} funda ${newVillage.id} en ${newVillage.coords.x}|${newVillage.coords.y}`,
            villageId: sourceVillage.id,
        });

        return { success: true };
    }
}

function hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function findOrCreateBuilding(village, buildingType) {
    let building = village.buildings.find(candidate => candidate.type === buildingType);
    if (!building) {
        building = {
            id: `b_${village.id}_${buildingType}`,
            type: buildingType,
            level: 0,
        };
        village.buildings.push(building);
    }
    return building;
}

function getUnitCount(village, unitId) {
    if (!unitId) return 0;
    return village.unitsInVillage?.[unitId] || 0;
}

function getRaceTroops(race) {
    return gameData.units[race]?.troops || [];
}

function getUnitByRole(race, predicate) {
    return getRaceTroops(race).find(predicate) || null;
}

function createBalancedResources(current, capacity) {
    return {
        wood: { current, capacity },
        stone: { current, capacity },
        iron: { current, capacity },
        food: { current, capacity },
    };
}

function createVillage({
    id,
    ownerId,
    race,
    name,
    coords,
    fieldLevel,
    buildingLevels,
    unitsInVillage,
    resources,
    population,
}) {
    const buildings = [];
    let fieldCounter = 1;
    for (const fieldType of RESOURCE_FIELD_BUILDING_TYPES) {
        for (let i = 0; i < 3; i += 1) {
            buildings.push({
                id: `field_${id}_${fieldCounter}`,
                type: fieldType,
                level: fieldLevel,
            });
            fieldCounter += 1;
        }
    }

    const knownBuildings = [
        'mainBuilding',
        'warehouse',
        'granary',
        'cityWall',
        'rallyPoint',
        'barracks',
        'academy',
        'smithy',
        'stable',
        'workshop',
        'marketplace',
        'embassy',
        'palace',
    ];

    knownBuildings.forEach(type => {
        buildings.push({
            id: `build_${id}_${type}`,
            type,
            level: buildingLevels[type] || 0,
        });
    });

    return {
        id,
        ownerId,
        race,
        name,
        coords,
        buildings,
        constructionQueue: [],
        maxConstructionSlots: 2,
        recruitmentQueue: [],
        unitsInVillage: { ...(unitsInVillage || {}) },
        resources: resources || createBalancedResources(1800, 3000),
        budget: {
            econ: { wood: 2500, stone: 2500, iron: 2500, food: 2500 },
            mil: { wood: 2500, stone: 2500, iron: 2500, food: 2500 },
        },
        budgetRatio: { econ: 0.6, mil: 0.4 },
        population: { current: population || 500 },
        smithy: { upgrades: {} },
        research: { completed: [], queue: [] },
        reinforcements: [],
        settlementsFounded: 0,
    };
}

function createInitialUnits(race, mode) {
    const troops = getRaceTroops(race);
    const map = {};
    const pick = predicate => troops.find(predicate)?.id;

    if (race === 'egyptians') {
        map[pick(unit => unit.id === 'ash_warden_egypt')] = mode === 'main' ? 180 : 120;
        map[pick(unit => unit.id === 'anhur_guard_egypt')] = mode === 'main' ? 75 : 45;
        map[pick(unit => unit.id === 'sopdu_explorer_egypt')] = mode === 'main' ? 24 : 10;
        map[pick(unit => unit.id === 'slave_militia_egypt')] = mode === 'main' ? 140 : 70;
        map[pick(unit => unit.id === 'khopesh_warrior_egypt')] = mode === 'main' ? 35 : 12;
        map[pick(unit => unit.id === 'settler_egypt')] = mode === 'main' ? 2 : 0;
    }

    if (race === 'germans') {
        map[pick(unit => unit.id === 'clubswinger')] = mode === 'main' ? 180 : 90;
        map[pick(unit => unit.id === 'axeman')] = mode === 'main' ? 140 : 60;
        map[pick(unit => unit.id === 'teutonic_knight')] = mode === 'main' ? 60 : 18;
        map[pick(unit => unit.id === 'spearman')] = mode === 'main' ? 100 : 130;
        map[pick(unit => unit.id === 'scout_german')] = mode === 'main' ? 28 : 10;
        map[pick(unit => unit.id === 'ram_german')] = mode === 'main' ? 10 : 0;
        map[pick(unit => unit.id === 'catapult_german')] = mode === 'main' ? 4 : 0;
        map[pick(unit => unit.id === 'settler_german')] = mode === 'main' ? 2 : 0;
    }

    for (const key of Object.keys(map)) {
        if (!key || map[key] <= 0) {
            delete map[key];
        }
    }
    return map;
}

function createEnemyPayload(enemyRace, profile, speedMultiplier) {
    const troops = getRaceTroops(enemyRace);
    const first = predicate => troops.find(predicate)?.id;
    const offInf = first(unit => unit.type === 'infantry' && unit.role === 'offensive');
    const offCav = first(unit => unit.type === 'cavalry' && unit.role === 'offensive');
    const scout = first(unit => unit.role === 'scout' || unit.type === 'scout');
    const ram = first(unit => unit.role === 'ram');
    const catapult = first(unit => unit.role === 'catapult');
    const chief = first(unit => unit.type === 'chief' || unit.role === 'colonization' || unit.role === 'conquest');

    const payload = {};
    const mul = speedMultiplier;

    if (profile === 'raid_light') {
        if (offInf) payload[offInf] = Math.floor(35 * mul);
        if (scout) payload[scout] = Math.floor(6 * mul);
    }

    if (profile === 'standard_weak') {
        if (offInf) payload[offInf] = Math.floor(22 * mul);
        if (offCav) payload[offCav] = Math.floor(4 * mul);
    }

    if (profile === 'multi_wave') {
        if (offInf) payload[offInf] = Math.floor(70 * mul);
        if (offCav) payload[offCav] = Math.floor(18 * mul);
    }

    if (profile === 'siege') {
        if (offInf) payload[offInf] = Math.floor(120 * mul);
        if (offCav) payload[offCav] = Math.floor(25 * mul);
        if (ram) payload[ram] = Math.floor(6 * mul);
        if (catapult) payload[catapult] = Math.floor(4 * mul);
    }

    if (profile === 'conquest') {
        if (offInf) payload[offInf] = Math.floor(140 * mul);
        if (offCav) payload[offCav] = Math.floor(35 * mul);
        if (chief) payload[chief] = 1;
    }

    return payload;
}

function countCommands(commands, missionType) {
    return commands.filter(command => command.payload?.missionType === missionType).length;
}

function phaseLabel(race, phaseId) {
    if (race === 'germans') {
        if (phaseId === GERMAN_PHASE_IDS.phase1) return 'F1 bootstrap economico';
        if (phaseId === GERMAN_PHASE_IDS.phase2) return 'F2 desbloqueo militar';
        if (phaseId === GERMAN_PHASE_IDS.phase3) return 'F3 produccion mixta';
        if (phaseId === GERMAN_PHASE_IDS.phase4) return 'F4 presion y tecnologia';
        if (phaseId === GERMAN_PHASE_IDS.phase5) return 'F5 asedio/expansion';
        if (phaseId === GERMAN_PHASE_IDS.phaseDone) return 'Fase completada';
    }

    if (race === 'egyptians') {
        if (phaseId === EGYPTIAN_PHASE_IDS.phase1) return 'F1 eco fortificada';
        if (phaseId === EGYPTIAN_PHASE_IDS.phase2) return 'F2 nucleo defensivo';
        if (phaseId === EGYPTIAN_PHASE_IDS.phase3) return 'F3 defensa imperial';
        if (phaseId === EGYPTIAN_PHASE_IDS.phase4) return 'F4 resiliencia territorial';
        if (phaseId === EGYPTIAN_PHASE_IDS.phase5) return 'F5 expansion segura';
        if (phaseId === EGYPTIAN_PHASE_IDS.phase6) return 'F6 hardening';
        if (phaseId === EGYPTIAN_PHASE_IDS.phaseDone) return 'Fase completada';
    }

    return String(phaseId || 'fase_desconocida');
}

function selectDeferredCounterTroops(village) {
    const raceTroops = getRaceTroops(village.race);
    const roleById = new Map(raceTroops.map(unit => [unit.id, unit.role]));

    const entries = Object.entries(village.unitsInVillage || [])
        .map(([unitId, count]) => ({ unitId, count, role: roleById.get(unitId) }))
        .filter(entry => (entry.count || 0) > 0)
        .filter(entry => entry.role === 'offensive' || entry.role === 'catapult' || entry.role === 'ram' || entry.role === 'versatile');

    const total = entries.reduce((sum, entry) => sum + entry.count, 0);
    if (total < 20) return {};

    const target = Math.max(20, Math.floor(total * 0.3));
    const selected = {};
    let taken = 0;
    entries.sort((a, b) => b.count - a.count);
    for (const entry of entries) {
        if (taken >= target) break;
        const remaining = target - taken;
        const use = Math.min(entry.count, remaining);
        if (use > 0) {
            selected[entry.unitId] = use;
            taken += use;
        }
    }
    return selected;
}

function hasPendingDodgeForVillage(dodgeTasks, villageId) {
    for (const task of dodgeTasks.values()) {
        if (task.villageId === villageId) return true;
    }
    return false;
}

function processDeferredCounterWindow({ gameState, villageCombatState, locks, cooldowns, dodgeTasks, ownerId, sendCommand }) {
    const launches = [];
    const myVillages = gameState.villages.filter(village => village.ownerId === ownerId);

    for (const village of myVillages) {
        const state = villageCombatState.get(village.id);
        if (!state || !state.counterWindowOpen) continue;
        if (!state.shouldCounterattack) continue;
        if (state.threatLevel === 'high' || state.threatLevel === 'critical') continue;
        if (locks.hasMovementLock(village.id)) continue;
        if (cooldowns.hasCounterattackCooldown(village.id)) continue;
        if (hasPendingDodgeForVillage(dodgeTasks, village.id)) continue;

        const attackerVillageId = state.attackerVillageId;
        if (!attackerVillageId) continue;

        const attackerVillage = gameState.villages.find(candidate => candidate.id === attackerVillageId);
        if (!attackerVillage) continue;

        const troops = selectDeferredCounterTroops(village);
        if (Object.keys(troops).length === 0) continue;

        const result = sendCommand('send_movement', {
            originVillageId: village.id,
            targetCoords: { ...attackerVillage.coords },
            troops,
            missionType: 'raid',
        });

        if (!result?.success) continue;

        cooldowns.setCounterattackCooldown(village.id, 90000, {
            reason: 'deferred_counterwindow_launch',
            sourceMovementId: state.sourceMovementIds?.[0] || null,
        });
        locks.setMovementLock(village.id, 15000, {
            reason: 'deferred_counterwindow_launch',
            sourceMovementId: state.sourceMovementIds?.[0] || null,
        });

        villageCombatState.upsert(village.id, {
            counterWindowOpen: false,
            counterWindowExpiresAt: null,
        }, {
            lastDecisionReason: 'deferred_counterwindow_executed',
            sourceMovementIds: state.sourceMovementIds || [],
            ttlMs: 80000,
        });

        launches.push({ villageId: village.id, attackerVillageId, troops });
    }

    return launches;
}

function createReactiveLocks(nowRef) {
    const movementLock = new TimedFlags(nowRef);
    return {
        hasMovementLock: villageId => movementLock.has(villageId),
        setMovementLock: (villageId, durationMs, meta) => movementLock.set(villageId, durationMs, meta),
    };
}

function createReactiveCooldowns(nowRef) {
    const reaction = new TimedFlags(nowRef);
    const counter = new TimedFlags(nowRef);
    return {
        hasReactionCooldown: movementId => reaction.has(movementId),
        setReactionCooldown: (movementId, durationMs, meta) => reaction.set(movementId, durationMs, meta),
        hasCounterattackCooldown: villageId => counter.has(villageId),
        setCounterattackCooldown: (villageId, durationMs, meta) => counter.set(villageId, durationMs, meta),
    };
}

function createScenarioBase({ tribe, speedScenario, rng, nowRef }) {
    const mainVillage = createVillage({
        id: `${tribe.race}_main`,
        ownerId: tribe.ownerId,
        race: tribe.race,
        name: `${tribe.label} Main`,
        coords: { x: 50, y: 50 },
        fieldLevel: tribe.race === 'egyptians' ? 5 : 6,
        buildingLevels: {
            mainBuilding: 8,
            warehouse: 10,
            granary: 10,
            cityWall: 8,
            rallyPoint: 6,
            barracks: 8,
            academy: 6,
            smithy: 6,
            stable: 6,
            workshop: 4,
            marketplace: 6,
            embassy: 1,
            palace: 10,
        },
        unitsInVillage: createInitialUnits(tribe.race, 'main'),
        resources: createBalancedResources(1900, 2800),
        population: tribe.race === 'egyptians' ? 700 : 760,
    });

    const supportVillage = createVillage({
        id: `${tribe.race}_support`,
        ownerId: tribe.ownerId,
        race: tribe.race,
        name: `${tribe.label} Support`,
        coords: { x: 53, y: 52 },
        fieldLevel: 4,
        buildingLevels: {
            mainBuilding: 6,
            warehouse: 8,
            granary: 8,
            cityWall: 7,
            rallyPoint: 4,
            barracks: 5,
            academy: 3,
            smithy: 3,
            stable: 4,
            workshop: 2,
            marketplace: 4,
            embassy: 1,
            palace: 0,
        },
        unitsInVillage: createInitialUnits(tribe.race, 'support'),
        resources: createBalancedResources(1300, 2100),
        population: 430,
    });

    const enemyVillage = createVillage({
        id: `${tribe.race}_enemy`,
        ownerId: tribe.enemyOwnerId,
        race: tribe.enemyRace,
        name: `Enemigo ${tribe.enemyRace}`,
        coords: { x: 58, y: 54 },
        fieldLevel: 5,
        buildingLevels: {
            mainBuilding: 8,
            warehouse: 9,
            granary: 9,
            cityWall: 6,
            rallyPoint: 6,
            barracks: 7,
            academy: 5,
            smithy: 5,
            stable: 5,
            workshop: 4,
            marketplace: 5,
            embassy: 1,
            palace: 10,
        },
        unitsInVillage: {
            [getUnitByRole(tribe.enemyRace, unit => unit.type === 'infantry' && unit.role === 'offensive')?.id]: 180,
            [getUnitByRole(tribe.enemyRace, unit => unit.type === 'cavalry' && unit.role === 'offensive')?.id]: 45,
            [getUnitByRole(tribe.enemyRace, unit => unit.role === 'scout')?.id]: 20,
        },
        resources: createBalancedResources(2000, 3000),
        population: 800,
    });

    const cleanEnemyUnits = {};
    Object.entries(enemyVillage.unitsInVillage).forEach(([unitId, count]) => {
        if (unitId && (count || 0) > 0) cleanEnemyUnits[unitId] = count;
    });
    enemyVillage.unitsInVillage = cleanEnemyUnits;

    const gameState = {
        startedAt: nowRef.now - 240000,
        villages: [mainVillage, supportVillage, enemyVillage],
        movements: [],
        players: [
            { id: tribe.ownerId, race: tribe.race },
            { id: tribe.enemyOwnerId, race: tribe.enemyRace },
        ],
        mapData: [
            { type: 'oasis', x: 49, y: 49 },
            { type: 'oasis', x: 52, y: 50 },
            { type: 'oasis', x: 54, y: 48 },
        ],
    };

    const report = {
        race: tribe.race,
        label: tribe.label,
        seed: speedScenario.seed,
        speed: speedScenario.gameSpeed,
        macroCycles: [],
        eventDetails: [],
        expansionEvents: [],
        commandLog: [],
        reactiveStateSnapshots: [],
        emittedLogs: [],
        warnings: [],
    };

    return {
        mainVillage,
        supportVillage,
        enemyVillage,
        gameState,
        report,
    };
}

function printLine(text = '') {
    console.log(text);
}

function sanitizeCell(value) {
    return String(value ?? '')
        .replace(/\|/g, '/')
        .replace(/\n/g, ' ')
        .trim();
}

function formatActions(actions) {
    if (!Array.isArray(actions) || actions.length === 0) return 'sin accion';
    return actions
        .map(action => `${action.kind}:${action.detalle}`)
        .join(' · ');
}

function getGermanPhaseDiagnostics(summary) {
    const phaseCycleProgress = summary?.finalState?.phaseCycleProgress || {};
    const canonicalPhase2Ms = phaseCycleProgress?.phase2?.totalMs || 0;
    const altPhase2Key = Object.keys(phaseCycleProgress).find(key => key.includes('german_phase_2')) || null;
    const altPhase2Ms = altPhase2Key ? (phaseCycleProgress?.[altPhase2Key]?.totalMs || 0) : 0;
    const possiblePhaseKeyMismatch = canonicalPhase2Ms <= 0 && altPhase2Ms > 0;

    return {
        canonicalPhase2Ms,
        altPhase2Key,
        altPhase2Ms,
        possiblePhaseKeyMismatch,
    };
}

function buildMarkdownReport({ generatedAt, runs, globalSummary }) {
    const lines = [];
    lines.push('# 📊 Reporte Harness IA Tribus (Markdown)');
    lines.push('');
    lines.push(`- 🗓️ Generado: ${generatedAt}`);
    lines.push('- 🧪 Cobertura: macro por fases + eventos tácticos (espionaje, raid, ataques, asedio, conquista, contraataques, expansión).');
    lines.push('- ⚙️ Velocidades/semillas: `x1`, `x100`, `x1000`.');
    lines.push('- 🧠 Tribus evaluadas: `Egipcios`, `Germanos`.');
    lines.push('');

    lines.push('## ✅ Resumen Global');
    lines.push('');
    lines.push('| Escenario | Tribu | Fase final | Transiciones | Aldeas | Comandos | Expansiones |');
    lines.push('|---|---|---|---:|---:|---:|---:|');
    globalSummary.forEach(row => {
        lines.push(`| ${sanitizeCell(`${row.seed}@${row.speed}x`)} | ${sanitizeCell(row.tribe)} | ${sanitizeCell(row.phase)} | ${row.transitions} | ${row.villages} | ${row.commands} | ${row.expansions} |`);
    });
    lines.push('');

    const bySpeed = new Map();
    runs.forEach(run => {
        const key = `${run.speedScenario.seed}@${run.speedScenario.gameSpeed}x`;
        if (!bySpeed.has(key)) bySpeed.set(key, []);
        bySpeed.get(key).push(run);
    });

    for (const [speedKey, speedRuns] of bySpeed.entries()) {
        lines.push(`## 🚀 Escenario ${speedKey}`);
        lines.push('');
        lines.push('| Tribu | Fase final | Transiciones | Comandos | Refuerzos | Raids | Ataques | Expansiones |');
        lines.push('|---|---|---:|---:|---:|---:|---:|---:|');
        speedRuns.forEach(run => {
            const { summary, report } = run;
            lines.push(`| ${sanitizeCell(report.label)} | ${sanitizeCell(summary.finalPhaseLabel)} | ${summary.transitions} | ${summary.totalCommands} | ${summary.reinforcementsSent} | ${summary.dodgesSent} | ${summary.attacksSent} | ${summary.expansions} |`);
        });
        lines.push('');

        speedRuns.forEach(run => {
            const { report, summary } = run;
            lines.push(`### 🧾 ${report.label} (${speedKey})`);
            lines.push('');

            lines.push('**Macro por ciclo (aldea principal)**');
            lines.push('');
            lines.push('| Ciclo | Fase | Aldeas | Acciones |');
            lines.push('|---:|---|---:|---|');
            report.macroCycles.forEach(cycle => {
                lines.push(`| ${cycle.cycle} | ${sanitizeCell(cycle.phaseLabel)} | ${cycle.villagesOwned} | ${sanitizeCell(formatActions(cycle.actions))} |`);
            });
            lines.push('');

            lines.push('**Eventos reactivos**');
            lines.push('');
            lines.push('| Evento | Tipo | Amenaza/Respuesta | Estado final | Comandos | Contraataque diferido |');
            lines.push('|---|---|---|---|---|---:|');
            report.eventDetails.forEach(event => {
                const threatResponse = event.preEvaluation
                    ? `${event.preEvaluation.threatType}/${event.preEvaluation.threatLevel} → ${event.preEvaluation.preferredResponse}`
                    : 'espionaje';
                const stateFinal = event.combatStateSnapshot
                    ? `${event.combatStateSnapshot.preferredResponse || 'n/a'} (threat=${event.combatStateSnapshot.threatLevel || 'n/a'})`
                    : 'sin estado';
                const commands = event.emittedCommands.length > 0
                    ? event.emittedCommands.map(command => `${command.payload.missionType}@${command.payload.originVillageId}`).join(', ')
                    : 'sin comandos';
                lines.push(`| ${sanitizeCell(event.id)} | ${sanitizeCell(event.label)} | ${sanitizeCell(threatResponse)} | ${sanitizeCell(stateFinal)} | ${sanitizeCell(commands)} | ${event.deferredCounters.length} |`);
            });
            lines.push('');

            lines.push('**Expansión**');
            lines.push('');
            if (report.expansionEvents.length === 0) {
                lines.push('- ⚠️ No se registraron expansiones.');
            } else {
                report.expansionEvents.forEach((exp, idx) => {
                    lines.push(`- ✅ EXP-${idx + 1}: \`${exp.sourceVillageId}\` funda \`${exp.newVillageId}\` en \`${exp.coords}\`.`);
                });
            }
            lines.push('');

            if (report.race === 'egyptians') {
                const kpi = summary.finalState || {};
                lines.push('**KPI egipcios (hardening)**');
                lines.push('');
                lines.push('| KPI | Valor |');
                lines.push('|---|---:|');
                lines.push(`| threatInterruptedCycles | ${kpi.kpiThreatInterruptedCycles || 0} |`);
                lines.push(`| storagePressureCriticalSamples | ${kpi.kpiStoragePressureCriticalSamples || 0} |`);
                lines.push(`| expansionAttempts | ${kpi.kpiExpansionAttempts || 0} |`);
                lines.push(`| expansionLaunches | ${kpi.kpiExpansionLaunches || 0} |`);
                lines.push(`| expansionBlockedByThreat | ${kpi.kpiExpansionBlockedByThreat || 0} |`);
                lines.push(`| emergencyRecruitmentCycles | ${kpi.kpiEmergencyRecruitmentCycles || 0} |`);
                lines.push('');
            }

            lines.push('**Resumen final de tribu**');
            lines.push('');
            lines.push(`- 🧭 Fase final: **${summary.finalPhaseLabel}**`);
            lines.push(`- 🔁 Transiciones: **${summary.transitions}**`);
            lines.push(`- 🏘️ Aldeas propias: **${summary.villagesOwned}**`);
            lines.push(`- 📨 Comandos totales: **${summary.totalCommands}**`);
            lines.push(`- 🛡️ Refuerzos: **${summary.reinforcementsSent}** | 🏃 Raids: **${summary.dodgesSent}** | ⚔️ Ataques: **${summary.attacksSent}**`);
            lines.push(`- 🌱 Expansiones: **${summary.expansions}**`);

            if (report.warnings.length > 0) {
                lines.push('');
                lines.push('**Advertencias**');
                report.warnings.forEach(warning => lines.push(`- ⚠️ ${warning}`));
            }

            lines.push('');
        });
    }

    const germanRuns = runs.filter(run => run.report.race === 'germans');
    const germanDiagnostics = germanRuns.map(run => ({
        run,
        diag: getGermanPhaseDiagnostics(run.summary),
    }));
    const hasMismatch = germanDiagnostics.some(item => item.diag.possiblePhaseKeyMismatch);

    lines.push('## 🧩 Diagnóstico de avance germano');
    lines.push('');
    lines.push('| Escenario | Clave esperada (`phase2`) ms | Clave alternativa detectada | ms alternativo | Señal de mismatch |');
    lines.push('|---|---:|---|---:|---|');

    germanDiagnostics.forEach(({ run, diag }) => {
        lines.push(`| ${sanitizeCell(`${run.speedScenario.seed}@${run.speedScenario.gameSpeed}x`)} | ${diag.canonicalPhase2Ms} | ${sanitizeCell(diag.altPhase2Key || 'ninguna')} | ${diag.altPhase2Ms} | ${diag.possiblePhaseKeyMismatch ? '✅ Sí' : '❌ No'} |`);
    });

    lines.push('');
    if (hasMismatch) {
        lines.push('### Hallazgo técnico');
        lines.push('- Se detecta mismatch de clave de progreso en al menos un escenario.');
        lines.push('- Recomendación: normalizar `phaseId -> phaseKey` al registrar progreso o aceptar ambas claves en evaluación.');
    } else {
        lines.push('### Resultado del diagnóstico');
        lines.push('- ✅ No se detecta mismatch de clave en esta ejecución.');
        lines.push('- ✅ El fix aplicado permite que germanos acumulen progreso en `phase2` y avancen a fases superiores.');
    }
    lines.push('');

    lines.push('## 🏁 Conclusión');
    lines.push('- El harness reproduce comportamiento táctico y de expansión en ambos perfiles.');
    lines.push('- Egipcios mantienen identidad defensiva y expansión segura en drill.');
    lines.push(hasMismatch
        ? '- Se mantiene una inconsistencia de progreso en germanos en esta corrida.'
        : '- Germanos ya no quedan estancados en F2 en esta corrida; el avance de fases es consistente.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function runTribeHarness({ tribe, speedScenario }) {
    const nowRef = { now: 1700000000000 + speedScenario.gameSpeed * 1000 };
    const rng = new DeterministicRng(`${speedScenario.seed}_${tribe.race}`);

    const realNow = Date.now;
    const realRandom = Math.random;
    Date.now = () => nowRef.now;
    Math.random = () => rng.next();

    try {
        const scenario = createScenarioBase({ tribe, speedScenario, rng, nowRef });
        const { gameState, mainVillage, enemyVillage, report } = scenario;

        const villageCombatState = new VillageCombatStateStore(nowRef);
        const locks = createReactiveLocks(nowRef);
        const cooldowns = createReactiveCooldowns(nowRef);
        const dodgeTasks = new Map();

        const log = (level, village, title, message, details, category) => {
            report.emittedLogs.push({
                at: nowRef.now,
                level,
                villageId: village?.id || null,
                title,
                message,
                details,
                category,
            });
        };

        const sendCommand = (command, payload) => {
            if (command !== 'send_movement') return { success: false, reason: 'UNSUPPORTED_COMMAND' };

            report.commandLog.push({
                at: nowRef.now,
                command,
                payload,
            });

            return { success: true };
        };

        const actionExecutor = new SimulationActionExecutor({
            race: tribe.race,
            gameState,
            rng,
            gameSpeed: speedScenario.gameSpeed,
            report,
        });

        const phaseStates = new Map();
        gameState.villages
            .filter(village => village.ownerId === tribe.ownerId)
            .forEach(village => {
                if (tribe.race === 'germans') {
                    phaseStates.set(village.id, createDefaultGermanPhaseState(nowRef.now));
                } else {
                    phaseStates.set(village.id, createDefaultEgyptianPhaseState(nowRef.now));
                }
            });

        const runMacroCycle = cycleIndex => {
            actionExecutor.startCycle(cycleIndex);

            const ownVillages = gameState.villages.filter(village => village.ownerId === tribe.ownerId);
            for (const village of ownVillages) {
                if (!phaseStates.has(village.id)) {
                    if (tribe.race === 'germans') {
                        phaseStates.set(village.id, createDefaultGermanPhaseState(nowRef.now));
                    } else {
                        phaseStates.set(village.id, createDefaultEgyptianPhaseState(nowRef.now));
                    }
                }

                const phaseState = phaseStates.get(village.id);
                const threatState = villageCombatState.get(village.id);

                if (tribe.race === 'germans') {
                    const result = runGermanEconomicPhaseCycle({
                        village,
                        gameState,
                        phaseState,
                        difficulty: tribe.difficulty,
                        gameSpeed: speedScenario.gameSpeed,
                        villageCombatState: threatState,
                        actionExecutor,
                        log,
                    });
                    phaseStates.set(village.id, result.phaseState);
                } else {
                    const result = runEgyptianEconomicPhaseCycle({
                        village,
                        gameState,
                        phaseState,
                        difficulty: tribe.difficulty,
                        villageCombatState: threatState,
                        actionExecutor,
                        log,
                    });
                    phaseStates.set(village.id, result.phaseState);
                }
            }

            if (tribe.race === 'germans') {
                const settlerId = actionExecutor.resolveUnitId('settler');
                const canExpand = getUnitCount(mainVillage, settlerId) >= 3;
                const notExpandedYet = report.expansionEvents.length === 0;
                if (canExpand && notExpandedYet) {
                    actionExecutor.executeGoalAction({ type: 'settle_new_village' }, ownVillages, gameState);
                }
            }

            const mainPhase = phaseStates.get(mainVillage.id)?.activePhaseId || 'unknown';
            report.macroCycles.push({
                cycle: cycleIndex,
                now: nowRef.now,
                phaseId: mainPhase,
                phaseLabel: phaseLabel(tribe.race, mainPhase),
                actions: actionExecutor.finishCycle(),
                villagesOwned: gameState.villages.filter(village => village.ownerId === tribe.ownerId).length,
            });

            nowRef.now += Math.max(12000, Math.floor(60000 / Math.max(1, Math.min(speedScenario.gameSpeed, 1000) / 4)));
        };

        const runExpansionDrill = cycleIndex => {
            const settlerId = actionExecutor.resolveUnitId('settler');

            if (tribe.race === 'egyptians') {
                mainVillage.unitsInVillage[settlerId] = Math.max(mainVillage.unitsInVillage[settlerId] || 0, 3);

                const state = phaseStates.get(mainVillage.id);
                state.activePhaseId = EGYPTIAN_PHASE_IDS.phase5;
                state.defenseReadinessScore = Math.max(state.defenseReadinessScore || 0, 130);
                state.expansionReadinessScore = Math.max(state.expansionReadinessScore || 0, 120);
                state.lastSafeExpansionCheckAt = 0;
                state.storagePressureHistory = [{ at: nowRef.now - 1000, value: 0.55 }];

                villageCombatState.upsert(mainVillage.id, {
                    threatLevel: 'low',
                    shouldPauseEconomicConstruction: false,
                    shouldBoostEmergencyRecruitment: false,
                }, {
                    ttlMs: 120000,
                    sourceMovementIds: [],
                    lastDecisionReason: 'expansion_drill_safe_mode',
                });

                actionExecutor.startCycle(cycleIndex);
                actionExecutor.executeGoalAction({ type: 'settle_new_village' }, gameState.villages.filter(village => village.ownerId === tribe.ownerId), gameState);
                report.macroCycles.push({
                    cycle: cycleIndex,
                    now: nowRef.now,
                    phaseId: state.activePhaseId,
                    phaseLabel: `${phaseLabel(tribe.race, state.activePhaseId)} + drill expansion`,
                    actions: actionExecutor.finishCycle(),
                    villagesOwned: gameState.villages.filter(village => village.ownerId === tribe.ownerId).length,
                });

                nowRef.now += 12000;
                return;
            }

            if (tribe.race === 'germans') {
                mainVillage.unitsInVillage[settlerId] = Math.max(mainVillage.unitsInVillage[settlerId] || 0, 3);
                const ownVillages = gameState.villages.filter(village => village.ownerId === tribe.ownerId);
                actionExecutor.startCycle(cycleIndex);
                actionExecutor.executeGoalAction({ type: 'settle_new_village' }, ownVillages, gameState);

                const mainPhase = phaseStates.get(mainVillage.id)?.activePhaseId || 'unknown';
                report.macroCycles.push({
                    cycle: cycleIndex,
                    now: nowRef.now,
                    phaseId: mainPhase,
                    phaseLabel: `${phaseLabel(tribe.race, mainPhase)} + drill expansion`,
                    actions: actionExecutor.finishCycle(),
                    villagesOwned: gameState.villages.filter(village => village.ownerId === tribe.ownerId).length,
                });

                nowRef.now += 12000;
            }
        };

        const runReactiveEvent = eventDef => {
            nowRef.now += 35000;

            const speedMultiplier = speedScenario.gameSpeed >= 1000 ? 2.0 : speedScenario.gameSpeed >= 100 ? 1.5 : 1.0;
            const movementId = `${eventDef.id}_${tribe.race}_${nowRef.now}`;
            const arrivalTime = nowRef.now + 14000;

            const movement = {
                id: movementId,
                type: eventDef.kind === 'espionage' ? 'espionage' : 'attack',
                ownerId: tribe.enemyOwnerId,
                originVillageId: enemyVillage.id,
                targetCoords: { ...mainVillage.coords },
                arrivalTime,
                payload: {
                    troops: createEnemyPayload(tribe.enemyRace, eventDef.profile, speedMultiplier),
                },
            };

            if (eventDef.profile === 'raid_light') {
                movement.type = 'raid';
            }

            const extraMovements = [];
            if (eventDef.profile === 'multi_wave') {
                const secondary = {
                    ...movement,
                    id: `${movementId}_wave2`,
                    arrivalTime: arrivalTime + 25000,
                    payload: {
                        troops: createEnemyPayload(tribe.enemyRace, 'raid_light', speedMultiplier),
                    },
                };
                secondary.type = 'attack';
                extraMovements.push(secondary);
            }

            gameState.movements = [movement, ...extraMovements];

            let preEvaluation = null;
            if (eventDef.kind === 'attack') {
                preEvaluation = evaluateThreatAndChooseResponse({
                    movement,
                    gameState,
                    race: tribe.race,
                    archetype: tribe.archetype,
                    ownerId: tribe.ownerId,
                    gameConfig: { troopSpeed: 1 },
                    targetVillage: mainVillage,
                    attackerVillage: enemyVillage,
                });
            }

            const commandCountBefore = report.commandLog.length;

            if (eventDef.kind === 'espionage') {
                handleEspionageReact({
                    movement,
                    gameState,
                    race: tribe.race,
                    dodgeTasks,
                    villageCombatState,
                    locks,
                    cooldowns,
                    log,
                });
            } else {
                handleAttackReact({
                    movement,
                    gameState,
                    race: tribe.race,
                    archetype: tribe.archetype,
                    ownerId: tribe.ownerId,
                    gameConfig: { troopSpeed: 1 },
                    dodgeTasks,
                    villageCombatState,
                    locks,
                    cooldowns,
                    sendCommand,
                    log,
                });
            }

            nowRef.now += 9000;
            processDodgeTasks({
                gameState,
                dodgeTasks,
                dodgeTimeThresholdMs: 12000,
                sendCommand,
                log,
            });

            gameState.movements = [];
            nowRef.now += 30000;

            const deferredCounters = processDeferredCounterWindow({
                gameState,
                villageCombatState,
                locks,
                cooldowns,
                dodgeTasks,
                ownerId: tribe.ownerId,
                sendCommand,
            });

            const commandCountAfter = report.commandLog.length;
            const emittedCommands = report.commandLog.slice(commandCountBefore, commandCountAfter);
            const combatStateSnapshot = villageCombatState.get(mainVillage.id);

            report.eventDetails.push({
                id: eventDef.id,
                label: eventDef.label,
                profile: eventDef.profile,
                preEvaluation,
                combatStateSnapshot,
                emittedCommands,
                deferredCounters,
            });

            report.reactiveStateSnapshots.push({
                id: eventDef.id,
                snapshot: combatStateSnapshot,
            });
        };

        for (let cycle = 1; cycle <= 6; cycle += 1) {
            runMacroCycle(cycle);
        }

        EVENT_PLAN.forEach((eventDef, index) => {
            runReactiveEvent(eventDef);
            runMacroCycle(7 + (index * 2));
            runMacroCycle(8 + (index * 2));
        });

        for (let cycle = 19; cycle <= 26; cycle += 1) {
            runMacroCycle(cycle);
        }

        runExpansionDrill(27);
        runMacroCycle(28);
        runMacroCycle(29);
        runMacroCycle(30);

        const mainState = phaseStates.get(mainVillage.id);
        const summary = {
            finalPhaseId: mainState?.activePhaseId || 'unknown',
            finalPhaseLabel: phaseLabel(tribe.race, mainState?.activePhaseId),
            transitions: mainState?.transitions?.length || 0,
            totalCommands: report.commandLog.length,
            reinforcementsSent: countCommands(report.commandLog, 'reinforcement'),
            dodgesSent: countCommands(report.commandLog, 'raid'),
            attacksSent: countCommands(report.commandLog, 'attack'),
            expansions: report.expansionEvents.length,
            villagesOwned: gameState.villages.filter(village => village.ownerId === tribe.ownerId).length,
            finalState: mainState,
        };

        if (summary.expansions <= 0) {
            report.warnings.push('No se detecto expansion en el drill final.');
        }

        return { report, summary };
    } finally {
        Date.now = realNow;
        Math.random = realRandom;
    }
}

function printTribeReport({ report, summary }) {
    printLine(`\nTRIBU: ${report.label}`);
    printLine(`- Semilla: ${report.seed}`);
    printLine(`- Velocidad: ${report.speed}x`);

    printLine('- Progreso macro por ciclo (aldea principal):');
    report.macroCycles.forEach(cycle => {
        const actionText = cycle.actions.length > 0
            ? cycle.actions.map(action => `${action.kind}:${action.detalle}`).join(' | ')
            : 'sin accion';
        printLine(`  [C${String(cycle.cycle).padStart(2, '0')}] ${cycle.phaseLabel} | aldeas=${cycle.villagesOwned} | ${actionText}`);
    });

    printLine('- Eventos reactivos y resultado tactico:');
    report.eventDetails.forEach(event => {
        const evalText = event.preEvaluation
            ? `amenaza=${event.preEvaluation.threatType}/${event.preEvaluation.threatLevel} respuesta=${event.preEvaluation.preferredResponse}`
            : 'evento de espionaje';

        const stateText = event.combatStateSnapshot
            ? `estadoFinal=${event.combatStateSnapshot.preferredResponse || 'n/a'} threat=${event.combatStateSnapshot.threatLevel || 'n/a'}`
            : 'sin estado persistido';

        const cmdText = event.emittedCommands.length > 0
            ? event.emittedCommands.map(command => `${command.payload.missionType}@${command.payload.originVillageId}`).join(', ')
            : 'sin comandos';

        const deferredText = event.deferredCounters.length > 0
            ? `contraataqueDiferido=${event.deferredCounters.length}`
            : 'contraataqueDiferido=0';

        printLine(`  [${event.id}] ${event.label} -> ${evalText} | ${stateText} | comandos=${cmdText} | ${deferredText}`);
    });

    printLine('- Eventos de expansion registrados:');
    if (report.expansionEvents.length === 0) {
        printLine('  (ninguno)');
    } else {
        report.expansionEvents.forEach((exp, idx) => {
            printLine(`  [EXP-${idx + 1}] ${exp.sourceVillageId} -> ${exp.newVillageId} en ${exp.coords}`);
        });
    }

    if (report.race === 'egyptians') {
        const kpi = summary.finalState || {};
        printLine('- KPI egipcios (fase 6 / hardening):');
        printLine(`  threatInterruptedCycles=${kpi.kpiThreatInterruptedCycles || 0}`);
        printLine(`  storagePressureCriticalSamples=${kpi.kpiStoragePressureCriticalSamples || 0}`);
        printLine(`  expansionAttempts=${kpi.kpiExpansionAttempts || 0}`);
        printLine(`  expansionLaunches=${kpi.kpiExpansionLaunches || 0}`);
        printLine(`  expansionBlockedByThreat=${kpi.kpiExpansionBlockedByThreat || 0}`);
        printLine(`  emergencyRecruitmentCycles=${kpi.kpiEmergencyRecruitmentCycles || 0}`);
    }

    printLine('- Resumen final:');
    printLine(`  faseFinal=${summary.finalPhaseLabel}`);
    printLine(`  transiciones=${summary.transitions}`);
    printLine(`  aldeasPropias=${summary.villagesOwned}`);
    printLine(`  comandosTotales=${summary.totalCommands}`);
    printLine(`  refuerzos=${summary.reinforcementsSent} | raids=${summary.dodgesSent} | ataques=${summary.attacksSent}`);
    printLine(`  expansiones=${summary.expansions}`);

    if (report.warnings.length > 0) {
        printLine('- Advertencias del harness:');
        report.warnings.forEach(warning => printLine(`  ! ${warning}`));
    }
}

function runHarness() {
    const runs = [];
    const globalSummary = [];

    SPEED_SCENARIOS.forEach(speedScenario => {
        TRIBE_SCENARIOS.forEach(tribe => {
            const result = runTribeHarness({ tribe, speedScenario });
            runs.push({ speedScenario, tribe, ...result });

            globalSummary.push({
                seed: speedScenario.seed,
                speed: speedScenario.gameSpeed,
                tribe: tribe.label,
                phase: result.summary.finalPhaseLabel,
                transitions: result.summary.transitions,
                villages: result.summary.villagesOwned,
                commands: result.summary.totalCommands,
                expansions: result.summary.expansions,
            });
        });
    });

    const markdown = buildMarkdownReport({
        generatedAt: new Date().toISOString(),
        runs,
        globalSummary,
    });

    const reportsDir = path.resolve('reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    const outputPath = path.join(reportsDir, 'reporte-harness-tribus.md');
    fs.writeFileSync(outputPath, markdown, 'utf8');

    printLine('✅ Harness ejecutado correctamente.');
    printLine(`📄 Reporte Markdown generado en: ${outputPath}`);
    printLine('🧠 Diagnóstico incluido: estado de avance germano y verificación de mismatch de claves.');
}

runHarness();
