// RUTA: js/ai/AIController.js
import ReputationManager from './ReputationManager.js';
import AIGoalManager from './AIGoalManager.js';
import AIActionExecutor from './AIActionExecutor.js';
import StrategicAI from './StrategicAI.js';
import { AI_CONTROLLER_CONSTANTS } from './config/AIConstants.js';
import { gameData } from '../core/GameData.js';
import { resolvePhaseEngineRolloutFlags } from '../core/data/constants.js';
import { executeCommands } from './controller/commands.js';
import { handleAttackReact, handleEspionageReact, processDodgeTasks, processReinforcementRecalls, evaluateThreatAndChooseResponse, planResourceEvacuation, planSnipeTasks, processSnipeTasks } from './controller/reactive.js';
import { runMilitaryDecision } from './controller/military.js';
import { getHunDefenseAdvice, getHunAttackAdvice, getHunDeepSeekStatus } from './hun/hun-combat-advisor.js';
import {
    createDefaultGermanPhaseState,
    GERMAN_PHASE_IDS,
    getGermanPhaseCycleStatus,
    hydrateGermanPhaseState,
    runGermanEconomicPhaseCycle,
    serializeGermanPhaseStates,
} from './controller/german-phase-engine.js';
import {
    createDefaultEgyptianPhaseState,
    EGYPTIAN_PHASE_IDS,
    getEgyptianPhaseCycleStatus,
    hydrateEgyptianPhaseState,
    runEgyptianEconomicPhaseCycle,
    serializeEgyptianPhaseStates,
} from './controller/egyptian-phase-engine.js';

const PHASE_LABELS_BY_RACE = Object.freeze({
    germans: {
        [GERMAN_PHASE_IDS.phase1]: 'Fase 1 - Arranque economico',
        [GERMAN_PHASE_IDS.phase2]: 'Fase 2 - Desbloqueo militar basico',
        [GERMAN_PHASE_IDS.phase3]: 'Fase 3 - Produccion mixta sostenida',
        [GERMAN_PHASE_IDS.phase4]: 'Fase 4 - Presion militar y tecnologia',
        [GERMAN_PHASE_IDS.phase5]: 'Fase 5 - Asedio y expansion',
        [GERMAN_PHASE_IDS.phaseDone]: 'Plantilla completada',
    },
    egyptians: {
        [EGYPTIAN_PHASE_IDS.phase1]: 'Fase 1 - Eco Fortificada',
        [EGYPTIAN_PHASE_IDS.phase2]: 'Fase 2 - Nucleo Defensivo Temprano',
        [EGYPTIAN_PHASE_IDS.phase3]: 'Fase 3 - Escalado Defensivo',
        [EGYPTIAN_PHASE_IDS.phase4]: 'Fase 4 - Preparacion Expansion Segura',
        [EGYPTIAN_PHASE_IDS.phase5]: 'Fase 5 - Expansion Custodiada',
        [EGYPTIAN_PHASE_IDS.phase6]: 'Fase 5 - Expansion Custodiada (legacy)',
        [EGYPTIAN_PHASE_IDS.phaseDone]: 'Plantilla completada',
    },
});

const STAGE_LABELS = Object.freeze({
    early: 'EARLY',
    mid: 'MID',
    late: 'LATE',
    unknown: 'N/A',
});

const ACTION_LABELS = Object.freeze({
    INICIO_CICLO_GESTION: 'Inicio Ciclo Gestion',
    INICIO_CICLO_MILITAR: 'Inicio Ciclo Militar',
    StrategicAI: 'Analisis Estrategico',
    'Strategic AI': 'Analisis Estrategico',
    'Razonamiento Estrategico': 'Analisis del General',
    'Razonamiento del General': 'Analisis del General',
    'Sin Comandos': 'Sin Ordenes',
    'Comando Invalido': 'Comando Invalido',
    'Comando Inválido': 'Comando Invalido',
    'Comando Enviado': 'Comando Enviado',
    'Comando Fallido': 'Comando Fallido',
    'Error en Ciclo Militar': 'Error Ciclo Militar',
    'Ciclo Militar Omitido': 'Ciclo Militar Omitido',
    'Evento Reactivo': 'Evento Reactivo',
    'Reactive Cooldown': 'Cooldown Reactivo',
    'Reactive Lock': 'Bloqueo Reactivo',
    'Reactive Fallback': 'Fallback Reactivo',
    'Counter Reaction': 'Reaccion de Contraataque',
    'Counter Action': 'Accion de Contraataque',
    'Counter Window': 'Ventana de Contraataque',
    'Counter-espionage': 'Contraespionaje',
    'Executing Dodge': 'Ejecucion de Esquiva',
    'Dodge Maneuver': 'Maniobra de Esquiva',
    'Dodge Maneuver Skipped': 'Esquiva Omitida',
    'Defensa Coordinada': 'Defensa Coordinada',
    'Defensa Coordinada Fallida': 'Defensa Coordinada Fallida',
    'Local Defense': 'Defensa Local',
    'Tactical Evasion': 'Evasion Tactica',
    'Reinforcement Recall': 'Retiro de Refuerzos',
    'Ajuste Estratégico': 'Ajuste Estrategico',
    'Ahorro de Recursos': 'Espera de Recursos',
    'Acción de Objetivo': 'Accion de Objetivo',
    'Objetivo military Completado': 'Objetivo Militar Completado',
    'Nuevo Objetivo military': 'Nuevo Objetivo Militar',
    'Objetivo economic Completado': 'Objetivo Economico Completado',
    'Nuevo Objetivo economic': 'Nuevo Objetivo Economico',
    'Farmeo de Oasis': 'Farmeo de Oasis',
    'Rebalanceo de Recursos': 'Rebalanceo de Recursos',
    'Colonización': 'Colonizacion',
    'Construcción': 'Construccion',
    'Investigación': 'Investigacion',
    'Herrería': 'Herreria',
    'Movimiento': 'Movimiento',
    'Comercio': 'Comercio',
    'Presupuesto Ciclo': 'Presupuesto Ciclo',
    'Prestamo Presupuesto': 'Prestamo Presupuesto',
});

const LOG_CATEGORY_LABELS = Object.freeze({
    economic: 'ECO',
    military: 'MIL',
    general: 'GEN',
});

const REASON_LABELS = Object.freeze({
    INSUFFICIENT_RESOURCES: 'recursos insuficientes',
    PREREQUISITES_NOT_MET: 'prerequisitos no cumplidos',
    QUEUE_FULL: 'cola ocupada',
    NO_ACTION: 'sin accion',
    NO_PRIORITY_ACTION: 'sin accion prioritaria',
    NO_PRIORITY_RECRUITMENT: 'sin reclutamiento prioritario',
    NO_FALLBACK_ACTION: 'sin accion de fallback',
    NO_CANDIDATE_FOUND: 'sin candidato valido',
    BUILDING_NOT_FOUND: 'edificio no encontrado',
    INVALID_UNIT_DATA: 'datos de unidad invalidos',
    INVALID_LEVEL_DATA: 'nivel invalido',
    INVALID_BUILDING_DATA: 'datos de edificio invalidos',
    UNKNOWN_COMMAND: 'comando desconocido',
    PROCESSOR_NOT_FOUND: 'procesador no encontrado',
    NO_VILLAGE_ID: 'aldea no definida',
    ROMAN_RESOURCE_QUEUE_FULL: 'cola romana de recursos llena',
    ROMAN_INFRA_QUEUE_FULL: 'cola romana de infraestructura llena',
    RESEARCH_REQUIRED: 'investigacion requerida',
    ALREADY_RESEARCHED: 'ya investigado',
    ALREADY_QUEUED: 'ya en cola',
    MAX_LEVEL_REACHED: 'nivel maximo alcanzado',
    EXPANSION_BUILDING_LOW_LEVEL: 'edificio de expansion insuficiente',
    EXPANSION_SLOTS_FULL: 'sin slots de expansion',
    THREAT_BOOST_NOT_REQUIRED: 'sin amenaza que requiera boost',
    PROBABILITY_GATE: 'no activo por probabilidad',
    NO_EFFICIENCY_GAIN: 'sin mejora de eficiencia',
    ATTACKER_UNDER_BEGINNER_PROTECTION: 'atacante bajo proteccion de principiante',
    TARGET_UNDER_BEGINNER_PROTECTION: 'objetivo bajo proteccion de principiante',
});

const COMBAT_STATE_TTL_BY_THREAT_LEVEL_MS = Object.freeze({
    none: 30000,
    low: 45000,
    medium: 60000,
    high: 90000,
    critical: 120000,
});

const DEFAULT_COMBAT_STATE_TTL_MS = 60000;

const BASE_LOCK_DURATIONS_MS = Object.freeze({
    movementLockByVillage: 15000,
    reactionCooldownByMovement: 20000,
    counterattackCooldownByVillage: 45000,
    constructionEmergencyLockByVillage: 30000,
    strategicCommitmentByVillage: 60000,
    strategicCommitmentHighValueByVillage: 90000,
});

const COMMAND_LAYER_PRIORITY = Object.freeze({
    reactive_dodge_reinforce: 60,
    reactive_local_defense: 50,
    reactive_counterattack: 40,
    strategic_attack: 30,
    strategic_farming: 20,
    macro_emergency: 35,
    macro_normal: 25,
    reactive_critical: 60,
    reactive_high: 60,
    reactive_low: 40,
});

const COMMAND_WINDOW_TTL_MS = 12000;
const OFFENSIVE_MISSION_TYPES = new Set(['attack', 'raid', 'espionage', 'conquest']);

const DECISION_SPEED_MIN = 1;
const ECONOMIC_INTERVAL_MIN_MS = 1000;
const ECONOMIC_INTERVAL_MAX_MS = 300000;
const MILITARY_INTERVAL_MIN_MS = 30000;
const MILITARY_INTERVAL_MAX_MS = 300000;
const ECONOMIC_SPEED_DIVISOR = 5;
const MILITARY_SPEED_DIVISOR = 500;

const MILITARY_CONSTRUCTION_TYPES = new Set([
    'rallyPoint',
    'barracks',
    'academy',
    'smithy',
    'stable',
    'workshop',
    'cityWall',
]);

function getCombatStateTtlMs(threatLevel, ttlOverrideMs = null) {
    if (Number.isFinite(ttlOverrideMs) && ttlOverrideMs > 0) {
        return ttlOverrideMs;
    }

    return COMBAT_STATE_TTL_BY_THREAT_LEVEL_MS[threatLevel] || DEFAULT_COMBAT_STATE_TTL_MS;
}

function createDefaultVillageCombatState(villageId, now = Date.now()) {
    return {
        villageId,
        threatLevel: 'none',
        threatType: 'mixed',
        intelFresh: false,
        lastIntelAt: null,
        posture: 'hybrid',
        preferredResponse: 'hold',
        offenseSuppressed: false,
        reservedTroops: {},
        attackPowerEstimate: 0,
        localDefenseEstimate: 0,
        imperialDefenseEstimate: 0,
        canHoldLocally: false,
        canHoldWithReinforcements: false,
        shouldPreserveOffense: false,
        shouldCounterattack: false,
        shouldPauseEconomicConstruction: false,
        shouldBoostEmergencyRecruitment: false,
        attackerVillageId: null,
        shouldRescoutAttacker: false,
        rescoutReason: null,
        counterWindowOpen: false,
        counterWindowExpiresAt: null,
        counterDecisionState: 'none',
        counterDecisionReason: null,
        counterDecisionAt: null,
        expiresAt: now + DEFAULT_COMBAT_STATE_TTL_MS,
        sourceMovementIds: [],
        lastDecisionReason: 'initialized',
    };
}

function mapEntriesFromPersistedMap(persistedMap) {
    if (!persistedMap) return [];
    if (Array.isArray(persistedMap)) return persistedMap;
    if (typeof persistedMap === 'object') return Object.entries(persistedMap);
    return [];
}

function sanitizeSourceMovementIds(sourceMovementIds) {
    if (!Array.isArray(sourceMovementIds)) return [];
    return [...new Set(sourceMovementIds.filter(Boolean))];
}

function countTroopsInMap(troops = {}) {
    if (!troops || typeof troops !== 'object') return 0;
    return Object.values(troops).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getStageFromPhaseId(phaseId) {
    if (phaseId === GERMAN_PHASE_IDS.phase1 || phaseId === GERMAN_PHASE_IDS.phase2) return 'early';
    if (phaseId === GERMAN_PHASE_IDS.phase3 || phaseId === GERMAN_PHASE_IDS.phase4) return 'mid';
    if (phaseId === GERMAN_PHASE_IDS.phase5 || phaseId === GERMAN_PHASE_IDS.phaseDone) return 'late';
    if (phaseId === EGYPTIAN_PHASE_IDS.phase1 || phaseId === EGYPTIAN_PHASE_IDS.phase2) return 'early';
    if (phaseId === EGYPTIAN_PHASE_IDS.phase3 || phaseId === EGYPTIAN_PHASE_IDS.phase4) return 'mid';
    if (phaseId === EGYPTIAN_PHASE_IDS.phase5 || phaseId === EGYPTIAN_PHASE_IDS.phaseDone) return 'late';
    if (phaseId === EGYPTIAN_PHASE_IDS.phase6) return 'late';
    return 'unknown';
}

function getPhaseLabel(race, phaseId) {
    const labels = PHASE_LABELS_BY_RACE[race] || {};
    return labels[phaseId] || 'Fase no definida';
}

const PHASE_KEY_BY_RACE = Object.freeze({
    germans: Object.freeze({
        [GERMAN_PHASE_IDS.phase1]: 'phase1',
        [GERMAN_PHASE_IDS.phase2]: 'phase2',
        [GERMAN_PHASE_IDS.phase3]: 'phase3',
        [GERMAN_PHASE_IDS.phase4]: 'phase4',
        [GERMAN_PHASE_IDS.phase5]: 'phase5',
    }),
    egyptians: Object.freeze({
        [EGYPTIAN_PHASE_IDS.phase1]: 'phase1',
        [EGYPTIAN_PHASE_IDS.phase2]: 'phase2',
        [EGYPTIAN_PHASE_IDS.phase3]: 'phase3',
        [EGYPTIAN_PHASE_IDS.phase4]: 'phase4',
        [EGYPTIAN_PHASE_IDS.phase5]: 'phase5',
        [EGYPTIAN_PHASE_IDS.phase6]: 'phase5',
    }),
});

const PHASE_DONE_ID_BY_RACE = Object.freeze({
    germans: GERMAN_PHASE_IDS.phaseDone,
    egyptians: EGYPTIAN_PHASE_IDS.phaseDone,
});

const PHASE_CYCLE_STATUS_RESOLVER_BY_RACE = Object.freeze({
    germans: getGermanPhaseCycleStatus,
    egyptians: getEgyptianPhaseCycleStatus,
});

const PHASE_CYCLE_DETAIL_MAP_BY_RACE = Object.freeze({
    germans: Object.freeze([
        ['offensiveInfantry', 'ofInf'],
        ['offensiveCavalry', 'ofCav'],
        ['defensiveInfantry', 'defInf'],
        ['scout', 'scout'],
        ['ram', 'ram'],
        ['catapult', 'cata'],
        ['expansion', 'exp'],
    ]),
    egyptians: Object.freeze([
        ['defensiveInfantry', 'defInf'],
        ['defensiveCavalry', 'defCav'],
        ['offensiveInfantry', 'ofInf'],
        ['offensiveCavalry', 'ofCav'],
        ['scout', 'scout'],
        ['siege', 'siege'],
        ['expansion', 'exp'],
    ]),
});

const PHASE_CYCLE_SKIP_KEYS_BY_RACE = Object.freeze({
    germans: Object.freeze(['phase1']),
    egyptians: Object.freeze([]),
});

function getPhaseKeyForRace(race, phaseId) {
    return PHASE_KEY_BY_RACE[race]?.[phaseId] || null;
}

function shouldSkipPhaseCycleLogForRace(race, phaseKey) {
    return (PHASE_CYCLE_SKIP_KEYS_BY_RACE[race] || []).includes(phaseKey);
}

function formatPhaseCycleDetail(cycleStatus, detailMap = []) {
    return (detailMap || [])
        .filter(([key]) => (cycleStatus?.targets?.[key] || 0) > 0)
        .map(([key, label]) => `${label}:${cycleStatus?.cycles?.[key] || 0}/${cycleStatus?.targets?.[key] || 0}`)
        .join(' | ');
}

function createDefaultOasisTelemetry() {
    return {
        militaryCycles: 0,
        cyclesFarmEvaluated: 0,
        cyclesFarmBlockedByMaxPriority: 0,
        cyclesMusteringForWar: 0,
        farmEvaluationRate: 0,
        farmBlockedRate: 0,
        decisions: 0,
        evaluatedOases: 0,
        profitableOases: 0,
        rejectedNoSquad: 0,
        rejectedNonPositive: 0,
        attacksIssued: 0,
        attacksIssuedNonPositive: 0,
        rewardNetSum: 0,
        rewardGrossSum: 0,
        lossValueSum: 0,
        travelCostSum: 0,
        skippedCyclesNoProfitable: 0,
        uniqueOasesAttacked: 0,
        oasisAttackHistogram: {},
        attackNonPositiveRate: 0,
        avgRewardNet: 0,
        avgLossToGross: 0,
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getEconomicDecisionIntervalMs(gameSpeed) {
    const speed = Math.max(DECISION_SPEED_MIN, Number(gameSpeed) || DECISION_SPEED_MIN);
    const rawInterval = 300000 / (speed / ECONOMIC_SPEED_DIVISOR);
    return Math.round(clamp(rawInterval, ECONOMIC_INTERVAL_MIN_MS, ECONOMIC_INTERVAL_MAX_MS));
}

function getMilitaryDecisionIntervalMs(gameSpeed) {
    const speed = Math.max(DECISION_SPEED_MIN, Number(gameSpeed) || DECISION_SPEED_MIN);
    const rawInterval = 300000 / (speed / MILITARY_SPEED_DIVISOR);
    return Math.round(clamp(rawInterval, MILITARY_INTERVAL_MIN_MS, MILITARY_INTERVAL_MAX_MS));
}

function normalizeReasonCode(reason) {
    if (!reason) return null;
    const code = String(reason).trim();
    const label = REASON_LABELS[code];
    return label ? `${code} (${label})` : code;
}

function normalizeReasonCodesInText(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, token => normalizeReasonCode(token) || token);
}

function formatResourceBag(resources) {
    if (!resources || typeof resources !== 'object') return null;
    const keys = ['wood', 'stone', 'iron', 'food'];
    const parts = keys
        .filter(resource => Number.isFinite(Number(resources[resource])))
        .map(resource => `${resource}:${Math.floor(Number(resources[resource]))}`);
    return parts.length > 0 ? parts.join(', ') : null;
}

function normalizeBudgetBag(resources) {
    return {
        wood: Math.max(0, Number(resources?.wood) || 0),
        stone: Math.max(0, Number(resources?.stone) || 0),
        iron: Math.max(0, Number(resources?.iron) || 0),
        food: Math.max(0, Number(resources?.food) || 0),
    };
}

function toCoordsText(coords) {
    if (!coords || typeof coords !== 'object') return null;
    const x = Number(coords.x);
    const y = Number(coords.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return `${Math.floor(x)}|${Math.floor(y)}`;
}

function getDetailReason(details) {
    if (!details || typeof details !== 'object') return null;
    return details.reason
        || details?.result?.reason
        || details?.payload?.result?.reason
        || null;
}

function buildAiLogDetailSummary(details) {
    if (details === null || details === undefined) return null;
    if (typeof details === 'string') {
        const normalized = normalizeReasonCodesInText(details).trim();
        return normalized || null;
    }

    if (typeof details !== 'object') {
        return String(details);
    }

    const parts = [];
    const reasonText = normalizeReasonCode(getDetailReason(details));
    if (reasonText) parts.push(`motivo=${reasonText}`);

    const needed = details.needed || details?.result?.details?.needed || details?.payload?.result?.details?.needed;
    const available = details.available || details?.result?.details?.available || details?.payload?.result?.details?.available;
    const required = details.required || details?.result?.details?.required || details?.payload?.result?.details?.required;
    const missing = details.missing || details?.result?.details?.missing || details?.payload?.result?.details?.missing;
    const moved = details.moved || details?.result?.details?.moved || details?.payload?.result?.details?.moved;
    const militaryBudgetFinal = details.militaryBudgetFinal
        || details?.after?.mil
        || details?.after?.military
        || (
            details?.after
            && Number.isFinite(Number(details.after.wood))
            && Number.isFinite(Number(details.after.stone))
            && Number.isFinite(Number(details.after.iron))
            && Number.isFinite(Number(details.after.food))
                ? details.after
                : null
        );

    const neededText = formatResourceBag(needed);
    if (neededText) parts.push(`necesario={${neededText}}`);

    const availableText = formatResourceBag(available);
    if (availableText) parts.push(`disponible={${availableText}}`);

    const missingText = formatResourceBag(missing);
    if (missingText) parts.push(`faltante={${missingText}}`);

    const movedText = formatResourceBag(moved);
    if (movedText) parts.push(`prestamo={${movedText}}`);

    if (Number.isFinite(Number(details.share))) {
        parts.push(`porcentaje_prestamo=${Math.round(Number(details.share) * 100)}%`);
    }

    if (Number.isFinite(Number(details.probability))) {
        parts.push(`probabilidad=${Math.round(Number(details.probability) * 100)}%`);
    }

    if (Number.isFinite(Number(details.movedTotal))) {
        parts.push(`prestamo_total=${Math.floor(Number(details.movedTotal))}`);
    }

    const militaryBudgetFinalText = formatResourceBag(militaryBudgetFinal);
    if (militaryBudgetFinalText) {
        parts.push(`budget_mil_final={${militaryBudgetFinalText}}`);
    }

    if (required && typeof required === 'object') {
        const reqText = Object.entries(required)
            .map(([key, value]) => `${key}:${value}`)
            .join(', ');
        if (reqText) parts.push(`prereq={${reqText}}`);
    }

    const unitId = details.unitId || details?.payload?.unitId || details?.result?.details?.unitId;
    if (unitId) parts.push(`unidad=${unitId}`);

    const buildingType = details.buildingType || details.building || details?.payload?.buildingType || details?.payload?.buildingId;
    if (buildingType) parts.push(`edificio=${buildingType}`);

    const villageId = details.villageId || details?.payload?.villageId;
    if (villageId) parts.push(`aldea=${villageId}`);

    const movementId = details.movementId || details?.payload?.movementId;
    if (movementId) parts.push(`mov=${movementId}`);

    const targetCoords = details.targetCoords || details?.payload?.targetCoords;
    const coordsText = toCoordsText(targetCoords);
    if (coordsText) parts.push(`objetivo=${coordsText}`);

    if (parts.length > 0) return parts.join(' | ');

    const keys = Object.keys(details).slice(0, 6);
    return keys.length > 0 ? `detalle={${keys.join(', ')}}` : null;
}

class AIController {
    _ownerId;
    _personality;
    _race;
    _archetype;
    _difficulty;
    _sendCommandRaw;
    _sendCommand;
    _gameConfig;

    _isThinkingEconomic = false;
    _isThinkingMilitary = false;
    _lastEconomicDecisionTime = 0;
    _economicDecisionInterval;
    _lastMilitaryDecisionTime = 0;
    _militaryDecisionInterval;
    
    _reputationManager;
    _goalManager;
    _actionExecutor;
    _strategicAI;
    _reinforcementTasks = [];
    _dodgeTasks = new Map();
    _oasisTelemetry = createDefaultOasisTelemetry();
    _germanPhaseStates = new Map();
    _egyptianPhaseStates = new Map();
    _villageCombatState = new Map();
    _movementLockByVillage = new Map();
    _reactionCooldownByMovement = new Map();
    _counterattackCooldownByVillage = new Map();
    _constructionEmergencyLockByVillage = new Map();
    _strategicCommitmentByVillage = new Map();
    _commandWindowByVillage = new Map();
    _lastKnownGameState = null;
    _phaseEngineRollout = resolvePhaseEngineRolloutFlags(null);
    _siegeArrivalPendingByVillage = new Map();
    _emergencyRepairTargetsByVillage = new Map();
    _merchantEvacuationCooldownByVillage = new Map();
    _snipeTasks = new Map();
    _forwardDefenseCooldownByVillage = new Map();

    constructor(ownerId, personality, race, archetype, sendCommandCallback, gameConfig, difficulty = 'Pesadilla') {
        this._ownerId = ownerId;
        this._personality = personality;
        this._race = race;
        this._archetype = archetype;
        this._difficulty = 'Pesadilla';
        this._sendCommandRaw = sendCommandCallback;
        this._sendCommand = this._dispatchCommand.bind(this);
        this._gameConfig = gameConfig;
        this._phaseEngineRollout = resolvePhaseEngineRolloutFlags(this._gameConfig);

        this._strategicAI = new StrategicAI();

        const gameSpeed = this._gameConfig?.gameSpeed || DECISION_SPEED_MIN;
        this._economicDecisionInterval = getEconomicDecisionIntervalMs(gameSpeed);
        this._militaryDecisionInterval = getMilitaryDecisionIntervalMs(gameSpeed);
        
        this._actionExecutor = new AIActionExecutor(this);
        const isPhaseRace = this._race === 'germans' || this._race === 'egyptians';
        const phaseEngineEnabled = this._isPhaseEngineEnabledForRace(this._race);
        this._goalManager = (!isPhaseRace || !phaseEngineEnabled)
            ? new AIGoalManager(this, this._actionExecutor)
            : null;
    }

    getDecisionLog() {
        const state = this.getState();
        const goalInfo = state.goalState || {};
        const villageCount = Object.keys(goalInfo).length;
        const totalEconGoals = Object.values(goalInfo).reduce((sum, v) => sum + (v.economicGoalStack?.length || 0), 0);
        const totalMilGoals = Object.values(goalInfo).reduce((sum, v) => sum + (v.militaryGoalStack?.length || 0), 0);
        const dodgeTaskCount = state.dodgeTasks?.length || 0;
        const reinforcementTaskCount = state.reinforcementTasks?.length || 0;
        const villageCombatStateCount = state.villageCombatState?.length || 0;
        const movementLockCount = state.movementLockByVillage?.length || 0;
        const reactionCooldownCount = state.reactionCooldownByMovement?.length || 0;
        const oasisTelemetry = state.oasisTelemetry || this._oasisTelemetry;

        return [
            `=== AI Decision Log: ${this._ownerId} ===`,
            `Race: ${this._race} | Archetype: ${this._archetype}`,
            `Personality: ${this._difficulty}`,
            `Macro engine: ${this._getMacroEngineLabel()}`,
            `Villages managed: ${villageCount}`,
            `Active economic goals: ${totalEconGoals}`,
            `Active military goals: ${totalMilGoals}`,
            `Pending dodge tasks: ${dodgeTaskCount}`,
            `Pending reinforcement recalls: ${reinforcementTaskCount}`,
            `Active village combat states: ${villageCombatStateCount}`,
            `Active movement locks: ${movementLockCount} | Reaction cooldowns: ${reactionCooldownCount}`,
            `Oasis gate: cycles=${oasisTelemetry.militaryCycles || 0}, farmEval=${oasisTelemetry.cyclesFarmEvaluated || 0}, blockedMax=${oasisTelemetry.cyclesFarmBlockedByMaxPriority || 0}, mustering=${oasisTelemetry.cyclesMusteringForWar || 0}, blockRate=${((oasisTelemetry.farmBlockedRate || 0) * 100).toFixed(1)}%`,
            `Oasis telemetry: decisions=${oasisTelemetry.decisions}, eval=${oasisTelemetry.evaluatedOases}, atk=${oasisTelemetry.attacksIssued}, atk<=0=${oasisTelemetry.attacksIssuedNonPositive}`,
            `Oasis KPIs: npRate=${((oasisTelemetry.attackNonPositiveRate || 0) * 100).toFixed(1)}%, avgNet=${Math.round(oasisTelemetry.avgRewardNet || 0)}, loss/gross=${(oasisTelemetry.avgLossToGross || 0).toFixed(2)}, unique=${oasisTelemetry.uniqueOasesAttacked}, skipNoProfit=${oasisTelemetry.skippedCyclesNoProfitable}`,
            `Last economic decision: ${new Date(this._lastEconomicDecisionTime).toISOString()}`,
            `Last military decision: ${new Date(this._lastMilitaryDecisionTime).toISOString()}`,
            `Economic interval: ${this._economicDecisionInterval}ms`,
            `Military interval: ${this._militaryDecisionInterval}ms`,
            `--- Goal Details ---`,
            ...Object.entries(goalInfo).map(([villageId, vState]) =>
                `[${villageId}] Econ: ${vState.economicGoalStack?.map(g => g.id).join(', ') || 'none'} | Mil: ${vState.militaryGoalStack?.map(g => g.id).join(', ') || 'none'}`
            ),
            `=== End Log ===`
        ].join('\n');
    }

    log(level, village, action, message, details, category = null) {
        const LEVEL_TAGS = {
            info: 'INFO',
            success: 'OK',
            fail: 'FAIL',
            warn: 'WARN',
            goal: 'SPECIAL',
            error: 'ERROR',
        };
        const STYLES = {
            info: 'color: #6c757d;',
            success: 'color: #28a745; font-weight: bold;',
            fail: 'color: #dc3545;',
            warn: 'color: #ffc107;',
            goal: 'color: #6f42c1; font-weight: bold;',
            error: 'color: #E91E63; font-weight: bold;',
        };
        const SPECIAL_ACTION_STYLES = {
            'Macro SubGoal': 'color: #8e44ad; font-weight: 700;',
            'Presupuesto Ciclo': 'color: #0c8599; font-weight: 700;',
            'Inicio Ciclo Gestion': 'color: #1d4ed8; font-weight: 700;',
            'Inicio Ciclo Militar': 'color: #0d9488; font-weight: 700;',
            'Macro Egipcia': 'color: #b45309; font-weight: 700;',
            'Macro Germana': 'color: #7c2d12; font-weight: 700;',
            'Macro Fases': 'color: #4c1d95; font-weight: 700;',
            'Macro Reclutamiento': 'color: #9a3412; font-weight: 700;',
            'Prestamo Presupuesto': 'color: #06b6d4; font-weight: 800;',
        };

        const logVillage = village || this._resolvePrimaryVillage();
        const context = this._buildLogContext(logVillage, category);
        const normalizedAction = ACTION_LABELS[action] || action;
        const categoryLabel = LOG_CATEGORY_LABELS[context.category] || LOG_CATEGORY_LABELS.general;
        const normalizedMessage = normalizeReasonCodesInText(message);
        const detailSummary = buildAiLogDetailSummary(details);
        const levelTag = LEVEL_TAGS[level] || 'INFO';
        const baseStyle = STYLES[level] || STYLES.info;
        const specialStyle = SPECIAL_ACTION_STYLES[normalizedAction] || '';
        const finalStyle = `${baseStyle}${specialStyle ? ` ${specialStyle}` : ''}`;

        console.log(
            `%c[${levelTag}] [IA ${this._ownerId}] [${categoryLabel}] [Juego ${context.gameTime}] [Etapa ${context.stage}] [${context.phase}] [${context.villageLabel}] [${normalizedAction}] :: ${normalizedMessage}`,
            finalStyle,
        );

        if (detailSummary) {
            console.log(`   ↳ ${detailSummary}`);
        }

        if (details && (level === 'warn' || level === 'error')) {
            console.debug('[IA raw details]', details);
        }
    }

    getOwnerId() { return this._ownerId; }
    getRace() { return this._race; }
    getArchetype() { return this._archetype; }
    getDifficulty() { return this._difficulty; }
    getPersonality() { return this._personality; }
    getGameConfig() { return this._gameConfig; }
    getSendCommand() { return this._getCommandSender({ sourceLayer: 'macro' }); }
    getActionExecutor() { return this._actionExecutor; }
    getGoalManager() { return this._goalManager; }

    _isPhaseEngineEnabledForRace(race = this._race) {
        if (race === 'germans') return this._phaseEngineRollout.germans !== false;
        if (race === 'egyptians') return this._phaseEngineRollout.egyptians !== false;
        return false;
    }

    _getMacroEngineLabel() {
        const isPhaseRace = this._race === 'germans' || this._race === 'egyptians';
        if (!isPhaseRace) {
            return 'GoalManager legacy';
        }

        return this._isPhaseEngineEnabledForRace(this._race)
            ? 'PhaseEngine (rollout activo)'
            : 'GoalManager legacy (rollout desactivado)';
    }

    _getPhaseStateMapForRace(race) {
        if (race === 'germans') return this._germanPhaseStates;
        if (race === 'egyptians') return this._egyptianPhaseStates;
        return null;
    }

    _shouldDeferMilitaryByGermanPhase(gameState) {
        if (this._race !== 'germans' || !this._isPhaseEngineEnabledForRace('germans')) {
            return false;
        }

        const myVillages = (gameState?.villages || []).filter(village => village.ownerId === this._ownerId);
        if (myVillages.length === 0) {
            return false;
        }

        return myVillages.some(village => !this._germanPhaseStates.has(village.id));
    }

    handleGameNotification(notification, gameState) {
        this._lastKnownGameState = gameState;

        if ((this._race !== 'germans' && this._race !== 'egyptians') || !notification || !notification.type) {
            return;
        }

        if (notification.type !== 'recruitment:finished') {
            return;
        }

        if (!this._isPhaseEngineEnabledForRace(this._race)) {
            return;
        }

        const payload = notification.payload || {};
        const village = gameState?.villages?.find(candidate => candidate.id === payload.villageId);
        if (!village) return;

        const phaseStateMap = this._getPhaseStateMapForRace(this._race);
        if (!phaseStateMap) return;

        const phaseState = phaseStateMap.get(village.id);
        if (!phaseState || !phaseState.activePhaseId) return;

        if (phaseState.activePhaseId === PHASE_DONE_ID_BY_RACE[this._race]) return;

        const phaseKey = getPhaseKeyForRace(this._race, phaseState.activePhaseId);
        if (!phaseKey || shouldSkipPhaseCycleLogForRace(this._race, phaseKey)) return;

        const statusResolver = PHASE_CYCLE_STATUS_RESOLVER_BY_RACE[this._race];
        if (typeof statusResolver !== 'function') return;

        const cycleStatus = statusResolver(phaseState, this._difficulty, phaseKey);
        const detail = formatPhaseCycleDetail(cycleStatus, PHASE_CYCLE_DETAIL_MAP_BY_RACE[this._race]);
        const percent = cycleStatus.max > 0
            ? ((cycleStatus.completed / cycleStatus.max) * 100).toFixed(1)
            : '0.0';

        this.log(
            'info',
            village,
            'Macro Reclutamiento',
            `Ciclos fase actual: ${cycleStatus.completed}/${cycleStatus.max} (${percent}%)${detail ? ` | ${detail}` : ''}.`,
            null,
            'economic',
        );
    }

    _resolvePrimaryVillage() {
        if (!this._lastKnownGameState?.villages) return null;
        return this._lastKnownGameState.villages.find(village => village.ownerId === this._ownerId) || null;
    }

    _buildLogContext(village, category) {
        const now = Date.now();
        const startedAt = this._lastKnownGameState?.startedAt || now;
        const gameSpeed = Math.max(this._gameConfig?.gameSpeed || 1, 1);
        const elapsedRealMs = Math.max(0, now - startedAt);
        const elapsedGameMs = elapsedRealMs * gameSpeed;

        let phaseId = null;
        if (village && this._germanPhaseStates.has(village.id)) {
            phaseId = this._germanPhaseStates.get(village.id)?.activePhaseId || null;
        } else if (village && this._egyptianPhaseStates.has(village.id)) {
            phaseId = this._egyptianPhaseStates.get(village.id)?.activePhaseId || null;
        }

        const stageKey = getStageFromPhaseId(phaseId);
        const phaseLabel = phaseId ? getPhaseLabel(this._race, phaseId) : 'Sin fase macro';

        return {
            gameTime: `T+${formatDuration(elapsedGameMs)} @${gameSpeed}x`,
            stage: STAGE_LABELS[stageKey] || STAGE_LABELS.unknown,
            phase: `Fase: ${phaseLabel}`,
            villageLabel: village ? `${village.name} (${village.coords.x}|${village.coords.y})` : 'Global',
            category: category || 'general',
        };
    }

    _resolveVillageBudgetRatio(village) {
        const econRatio = Number(village?.budgetRatio?.econ);
        const milRatio = Number(village?.budgetRatio?.mil);
        if (Number.isFinite(econRatio) && Number.isFinite(milRatio)) {
            return {
                econ: Math.max(0, econRatio),
                mil: Math.max(0, milRatio),
            };
        }

        return {
            econ: 0.5,
            mil: 0.5,
        };
    }

    _logBudgetSnapshotForCycle(cycleType, villages) {
        const isEconomicCycle = cycleType === 'economic';
        const budgetKind = isEconomicCycle ? 'econ' : 'mil';
        const category = isEconomicCycle ? 'economic' : 'military';
        const cycleLabel = isEconomicCycle ? 'ECO' : 'MIL';

        (villages || []).forEach(village => {
            const ratio = this._resolveVillageBudgetRatio(village);
            const budgetPool = normalizeBudgetBag(village?.budget?.[budgetKind]);
            const ratioText = `${Math.round((ratio.econ || 0) * 100)}/${Math.round((ratio.mil || 0) * 100)}`;
            const budgetText = formatResourceBag(budgetPool) || 'wood:0, stone:0, iron:0, food:0';

            this.log(
                'info',
                village,
                'Presupuesto Ciclo',
                `[${cycleLabel}] ratio E/M ${ratioText} | budget.${budgetKind} {${budgetText}}`,
                null,
                category,
            );
        });
    }

    init(gameState, aiPlayerState) {
        this._lastKnownGameState = gameState;
        this._reputationManager = new ReputationManager(gameState.diplomacy);

        if (this._goalManager) {
            const goalState = aiPlayerState.goalState || {};
            this._goalManager.init(gameState, goalState);
        }
        
        this._actionExecutor.init(this._reputationManager);
        
        const now = Date.now();
        this._lastEconomicDecisionTime = aiPlayerState.lastEconomicDecisionTime || now;
        this._lastMilitaryDecisionTime = aiPlayerState.lastMilitaryDecisionTime || now;
        this._reinforcementTasks = aiPlayerState.reinforcementTasks || [];
        this._dodgeTasks = new Map(aiPlayerState.dodgeTasks || []);
        this._oasisTelemetry = this._ensureOasisTelemetryDefaults(aiPlayerState.oasisTelemetry);
        this._villageCombatState = this._hydrateVillageCombatStateMap(aiPlayerState.villageCombatState);
        this._movementLockByVillage = this._hydrateTimedFlagMap(aiPlayerState.movementLockByVillage);
        this._reactionCooldownByMovement = this._hydrateTimedFlagMap(aiPlayerState.reactionCooldownByMovement);
        this._counterattackCooldownByVillage = this._hydrateTimedFlagMap(aiPlayerState.counterattackCooldownByVillage);
        this._constructionEmergencyLockByVillage = this._hydrateTimedFlagMap(aiPlayerState.constructionEmergencyLockByVillage);
        this._strategicCommitmentByVillage = this._hydrateTimedFlagMap(aiPlayerState.strategicCommitmentByVillage);

        if (this._race === 'germans') {
            const persistedPhaseState = aiPlayerState.germanPhaseState || {};
            const myVillages = gameState.villages.filter(village => village.ownerId === this._ownerId);
            this._germanPhaseStates = new Map();

            myVillages.forEach(village => {
                this._germanPhaseStates.set(
                    village.id,
                    hydrateGermanPhaseState(persistedPhaseState[village.id]),
                );
            });
        } else if (this._race === 'egyptians') {
            const persistedPhaseState = aiPlayerState.egyptianPhaseState || {};
            const myVillages = gameState.villages.filter(village => village.ownerId === this._ownerId);
            this._egyptianPhaseStates = new Map();

            myVillages.forEach(village => {
                this._egyptianPhaseStates.set(
                    village.id,
                    hydrateEgyptianPhaseState(persistedPhaseState[village.id]),
                );
            });
        }

        gameState.villages
            .filter(village => village.ownerId === this._ownerId)
            .forEach(village => this._ensureVillageCombatState(village.id));

        this._expireReactiveCoordinationState();
    }
    
    getState() {
        this._expireReactiveCoordinationState();

        const goalState = this._goalManager ? this._goalManager.getState() : {};
        return {
            goalState: goalState,
            lastEconomicDecisionTime: this._lastEconomicDecisionTime,
            lastMilitaryDecisionTime: this._lastMilitaryDecisionTime,
            reinforcementTasks: this._reinforcementTasks,
            dodgeTasks: Array.from(this._dodgeTasks.entries()),
            oasisTelemetry: this._oasisTelemetry,
            germanPhaseState: serializeGermanPhaseStates(this._germanPhaseStates),
            egyptianPhaseState: serializeEgyptianPhaseStates(this._egyptianPhaseStates),
            villageCombatState: Array.from(this._villageCombatState.entries()),
            movementLockByVillage: Array.from(this._movementLockByVillage.entries()),
            reactionCooldownByMovement: Array.from(this._reactionCooldownByMovement.entries()),
            counterattackCooldownByVillage: Array.from(this._counterattackCooldownByVillage.entries()),
            constructionEmergencyLockByVillage: Array.from(this._constructionEmergencyLockByVillage.entries()),
            strategicCommitmentByVillage: Array.from(this._strategicCommitmentByVillage.entries()),
            phaseEngineRollout: { ...this._phaseEngineRollout },
        };
    }

    _hydrateVillageCombatStateMap(persistedMap) {
        const now = Date.now();
        const hydratedMap = new Map();

        mapEntriesFromPersistedMap(persistedMap).forEach(([villageId, persistedState]) => {
            if (!villageId || !persistedState || typeof persistedState !== 'object') return;

            const baseState = createDefaultVillageCombatState(villageId, now);
            const mergedState = {
                ...baseState,
                ...persistedState,
                villageId,
                sourceMovementIds: sanitizeSourceMovementIds(persistedState.sourceMovementIds),
            };

            const ttlMs = getCombatStateTtlMs(mergedState.threatLevel);
            const expiresAt = Number.isFinite(mergedState.expiresAt)
                ? mergedState.expiresAt
                : now + ttlMs;

            if (expiresAt <= now) return;

            hydratedMap.set(villageId, {
                ...mergedState,
                expiresAt,
            });
        });

        return hydratedMap;
    }

    _hydrateTimedFlagMap(persistedMap) {
        const now = Date.now();
        const hydratedMap = new Map();

        mapEntriesFromPersistedMap(persistedMap).forEach(([key, persistedEntry]) => {
            if (!key || !persistedEntry || typeof persistedEntry !== 'object') return;
            if (!Number.isFinite(persistedEntry.expiresAt) || persistedEntry.expiresAt <= now) return;

            hydratedMap.set(key, {
                ...persistedEntry,
                expiresAt: persistedEntry.expiresAt,
            });
        });

        return hydratedMap;
    }

    _ensureVillageCombatState(villageId, now = Date.now()) {
        const currentState = this._villageCombatState.get(villageId);
        if (currentState && Number.isFinite(currentState.expiresAt) && currentState.expiresAt > now) {
            return currentState;
        }

        const nextState = createDefaultVillageCombatState(villageId, now);
        this._villageCombatState.set(villageId, nextState);
        return nextState;
    }

    getVillageCombatState(villageId) {
        const now = Date.now();
        const currentState = this._villageCombatState.get(villageId);
        if (!currentState) return null;
        if (!Number.isFinite(currentState.expiresAt) || currentState.expiresAt <= now) {
            this._villageCombatState.delete(villageId);
            return null;
        }

        return currentState;
    }

    upsertVillageCombatState(villageId, partialState = {}, options = {}) {
        const now = options.now || Date.now();
        const baseState = this._ensureVillageCombatState(villageId, now);
        const sourceMovementIds = sanitizeSourceMovementIds([
            ...(baseState.sourceMovementIds || []),
            ...(partialState.sourceMovementIds || []),
            ...(options.sourceMovementIds || []),
        ]);

        const mergedState = {
            ...baseState,
            ...partialState,
            villageId,
            sourceMovementIds,
        };

        const ttlMs = getCombatStateTtlMs(mergedState.threatLevel, options.ttlMs);
        mergedState.expiresAt = now + ttlMs;

        if (options.lastDecisionReason) {
            mergedState.lastDecisionReason = options.lastDecisionReason;
        }

        this._villageCombatState.set(villageId, mergedState);
        return mergedState;
    }

    clearVillageCombatState(villageId) {
        this._villageCombatState.delete(villageId);
    }

    _setTimedFlag(flagMap, key, durationMs, metadata = {}) {
        if (!key) return null;

        const now = Date.now();
        const ttlMs = Math.max(1000, Number.isFinite(durationMs) ? durationMs : 0);
        const entry = {
            key,
            createdAt: now,
            expiresAt: now + ttlMs,
            reason: metadata.reason || null,
            sourceMovementId: metadata.sourceMovementId || null,
        };

        flagMap.set(key, entry);
        return entry;
    }

    _getActiveTimedFlag(flagMap, key, now = Date.now()) {
        const entry = flagMap.get(key);
        if (!entry) return null;
        if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) {
            flagMap.delete(key);
            return null;
        }

        return entry;
    }

    _cleanupTimedFlagMap(flagMap, now = Date.now()) {
        for (const [key, entry] of flagMap.entries()) {
            if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) {
                flagMap.delete(key);
            }
        }
    }

    setMovementLockForVillage(villageId, durationMs = BASE_LOCK_DURATIONS_MS.movementLockByVillage, metadata = {}) {
        return this._setTimedFlag(this._movementLockByVillage, villageId, durationMs, metadata);
    }

    getMovementLockForVillage(villageId) {
        return this._getActiveTimedFlag(this._movementLockByVillage, villageId);
    }

    hasMovementLockForVillage(villageId) {
        return Boolean(this.getMovementLockForVillage(villageId));
    }

    setReactionCooldownForMovement(movementId, durationMs = BASE_LOCK_DURATIONS_MS.reactionCooldownByMovement, metadata = {}) {
        return this._setTimedFlag(this._reactionCooldownByMovement, movementId, durationMs, metadata);
    }

    getReactionCooldownForMovement(movementId) {
        return this._getActiveTimedFlag(this._reactionCooldownByMovement, movementId);
    }

    hasReactionCooldownForMovement(movementId) {
        return Boolean(this.getReactionCooldownForMovement(movementId));
    }

    setCounterattackCooldownForVillage(villageId, durationMs = BASE_LOCK_DURATIONS_MS.counterattackCooldownByVillage, metadata = {}) {
        return this._setTimedFlag(this._counterattackCooldownByVillage, villageId, durationMs, metadata);
    }

    getCounterattackCooldownForVillage(villageId) {
        return this._getActiveTimedFlag(this._counterattackCooldownByVillage, villageId);
    }

    hasCounterattackCooldownForVillage(villageId) {
        return Boolean(this.getCounterattackCooldownForVillage(villageId));
    }

    setConstructionEmergencyLockForVillage(villageId, durationMs = BASE_LOCK_DURATIONS_MS.constructionEmergencyLockByVillage, metadata = {}) {
        return this._setTimedFlag(this._constructionEmergencyLockByVillage, villageId, durationMs, metadata);
    }

    getConstructionEmergencyLockForVillage(villageId) {
        return this._getActiveTimedFlag(this._constructionEmergencyLockByVillage, villageId);
    }

    hasConstructionEmergencyLockForVillage(villageId) {
        return Boolean(this.getConstructionEmergencyLockForVillage(villageId));
    }

    setStrategicCommitmentForVillage(villageId, durationMs = BASE_LOCK_DURATIONS_MS.strategicCommitmentByVillage, metadata = {}) {
        return this._setTimedFlag(this._strategicCommitmentByVillage, villageId, durationMs, metadata);
    }

    getStrategicCommitmentForVillage(villageId) {
        return this._getActiveTimedFlag(this._strategicCommitmentByVillage, villageId);
    }

    hasStrategicCommitmentForVillage(villageId) {
        return Boolean(this.getStrategicCommitmentForVillage(villageId));
    }

    _expireReactiveCoordinationState() {
        const now = Date.now();

        for (const [villageId, state] of this._villageCombatState.entries()) {
            if (!state || !Number.isFinite(state.expiresAt) || state.expiresAt <= now) {
                this._villageCombatState.delete(villageId);
            }
        }

        this._cleanupTimedFlagMap(this._movementLockByVillage, now);
        this._cleanupTimedFlagMap(this._reactionCooldownByMovement, now);
        this._cleanupTimedFlagMap(this._counterattackCooldownByVillage, now);
        this._cleanupTimedFlagMap(this._constructionEmergencyLockByVillage, now);
        this._cleanupTimedFlagMap(this._strategicCommitmentByVillage, now);

        for (const [villageId, windowState] of this._commandWindowByVillage.entries()) {
            if (!windowState || !Number.isFinite(windowState.expiresAt) || windowState.expiresAt <= now) {
                this._commandWindowByVillage.delete(villageId);
            }
        }
    }

    _getCommandSender(context = {}) {
        return (commandType, payload, overrideContext = {}) => this._sendCommand(commandType, payload, { ...context, ...overrideContext });
    }

    _inferVillageIdFromCommand(commandType, payload = {}) {
        if (!payload || typeof payload !== 'object') return null;
        if (payload.villageId) return payload.villageId;
        if (payload.originVillageId) return payload.originVillageId;

        if (commandType === 'send_movement' && payload.originVillageId) {
            return payload.originVillageId;
        }

        return null;
    }

    _classifyCommandCategory(commandType) {
        if (commandType === 'send_movement') return 'movement';
        if (commandType === 'upgrade_building') return 'construction';
        if (commandType === 'research_unit') return 'research';
        if (commandType === 'upgrade_unit') return 'smithy';
        if (commandType === 'recruit_units') return 'recruitment';
        if (commandType === 'send_merchants') return 'economic_trade';
        return 'other';
    }

    _isOffensiveMovementCommand(commandType, payload = {}) {
        if (commandType !== 'send_movement') return false;
        const missionType = payload?.missionType;
        return OFFENSIVE_MISSION_TYPES.has(missionType);
    }

    _resolveMovementIntent(commandType, payload = {}, context = {}) {
        if (commandType !== 'send_movement') return 'none';

        const missionType = payload?.missionType;
        const sourceLayer = context.sourceLayer || 'macro';

        if (missionType === 'reinforcement') {
            return sourceLayer === 'reactive' ? 'reactive_reinforce' : 'macro_reinforce';
        }

        if (!this._isOffensiveMovementCommand(commandType, payload)) {
            return 'neutral_movement';
        }

        if (sourceLayer === 'reactive') {
            if (context.reactiveIntent === 'dodge') return 'reactive_dodge';
            if (context.reactiveIntent === 'counter') return 'reactive_counter';
            if (context.reactiveIntent === 'reinforce') return 'reactive_reinforce';
            return 'reactive_offense';
        }

        if (sourceLayer === 'military') {
            return context.militaryIntent === 'farming'
                ? 'strategic_farming'
                : 'strategic_attack';
        }

        return 'macro_offense';
    }

    _hasReservedTroops(villageCombatState) {
        return countTroopsInMap(villageCombatState?.reservedTroops || {}) > 0;
    }

    _countReservedTroopsCommitted(outgoingTroops = {}, reservedTroops = {}) {
        let overlap = 0;
        for (const [unitId, count] of Object.entries(outgoingTroops || {})) {
            if (!reservedTroops || !reservedTroops[unitId]) continue;
            overlap += Math.min(Math.max(0, Number(count) || 0), Math.max(0, Number(reservedTroops[unitId]) || 0));
        }
        return overlap;
    }

    _isCriticalReactiveThreat(combatState) {
        if (!combatState) return false;
        if (combatState.threatLevel === 'critical') return true;
        return combatState.threatType === 'conquest_attack' || combatState.threatType === 'siege_attack';
    }

    _buildVillageCombatContractSnapshot(villageIds = []) {
        const contract = {};
        const uniqueIds = [...new Set((villageIds || []).filter(Boolean))];

        uniqueIds.forEach(villageId => {
            const state = this.getVillageCombatState(villageId);
            if (!state) return;

            contract[villageId] = {
                threatLevel: state.threatLevel || 'none',
                threatType: state.threatType || 'mixed',
                intelFresh: Boolean(state.intelFresh),
                lastIntelAt: Number.isFinite(Number(state.lastIntelAt)) ? Number(state.lastIntelAt) : null,
                preferredResponse: state.preferredResponse || 'hold',
                offenseSuppressed: Boolean(state.offenseSuppressed),
                reservedTroops: { ...(state.reservedTroops || {}) },
                counterWindowOpen: Boolean(state.counterWindowOpen),
                attackerVillageId: state.attackerVillageId || null,
                shouldRescoutAttacker: Boolean(state.shouldRescoutAttacker),
                rescoutReason: state.rescoutReason || null,
            };
        });

        return contract;
    }

    _resolveLayerPriority(villageId, context = {}) {
        if (context.layerPriority && COMMAND_LAYER_PRIORITY[context.layerPriority]) {
            return context.layerPriority;
        }

        const sourceLayer = context.sourceLayer || 'macro';
        if (sourceLayer === 'reactive') {
            const combatState = villageId ? this.getVillageCombatState(villageId) : null;
            if (!combatState) return 'reactive_counterattack';

            const response = combatState.preferredResponse;
            if (response === 'partial_dodge' || response === 'full_dodge' || response === 'hold_with_reinforcements' || response === 'reinforce') {
                return 'reactive_dodge_reinforce';
            }
            if (response === 'hold') {
                return 'reactive_local_defense';
            }
            if (response === 'counterattack' || response === 'counterpressure') {
                return 'reactive_counterattack';
            }

            if (combatState.threatLevel === 'critical' || combatState.threatLevel === 'high') {
                return 'reactive_dodge_reinforce';
            }

            return 'reactive_counterattack';
        }

        if (sourceLayer === 'macro') {
            const combatState = villageId ? this.getVillageCombatState(villageId) : null;
            if (
                combatState &&
                (combatState.threatLevel === 'high' || combatState.threatLevel === 'critical' || combatState.shouldPauseEconomicConstruction)
            ) {
                return 'macro_emergency';
            }
            return 'macro_normal';
        }

        if (sourceLayer === 'military') {
            return context.militaryIntent === 'farming'
                ? 'strategic_farming'
                : 'strategic_attack';
        }

        return 'macro_normal';
    }

    _hasPendingDodgeForVillage(villageId) {
        for (const task of this._dodgeTasks.values()) {
            if (task?.villageId === villageId) return true;
        }
        return false;
    }

    _isConstructionCommandAllowedUnderEmergency(commandType, payload = {}, priorityLayer, villageId) {
        if (commandType !== 'upgrade_building') return true;

        if (!villageId) return true;
        const lock = this.getConstructionEmergencyLockForVillage(villageId);
        const combatState = this.getVillageCombatState(villageId);
        const underEmergency = Boolean(lock) || Boolean(combatState?.shouldPauseEconomicConstruction);
        if (!underEmergency) return true;

        const buildingType = payload.buildingType;
        if (buildingType && MILITARY_CONSTRUCTION_TYPES.has(buildingType)) {
            return true;
        }

        return COMMAND_LAYER_PRIORITY[priorityLayer] >= COMMAND_LAYER_PRIORITY.macro_emergency;
    }

    _isCommandCompatibleWithWindow(villageId, commandType, payload, context, nextCategory, nextPriorityScore, now) {
        const windowState = this._commandWindowByVillage.get(villageId);
        if (!windowState || windowState.expiresAt <= now) {
            return {
                compatible: true,
                reason: 'no_active_window',
                currentIntent: null,
                nextIntent: null,
            };
        }

        const sameCategory = windowState.category === nextCategory;
        if (!sameCategory) {
            return {
                compatible: true,
                reason: 'different_category',
                currentIntent: windowState.movementIntent || null,
                nextIntent: null,
            };
        }

        if (nextCategory === 'movement') {
            const nextIntent = this._resolveMovementIntent(commandType, payload, context);
            const currentIntent = windowState.movementIntent || 'unknown';
            const sameLayer = windowState.sourceLayer === (context.sourceLayer || 'macro');

            const sameIntent = currentIntent === nextIntent;
            const compatibleStrategicBurst = sameLayer
                && currentIntent === 'strategic_attack'
                && nextIntent === 'strategic_attack';
            const compatibleReactiveDefenseChain = sameLayer
                && currentIntent === 'reactive_reinforce'
                && nextIntent === 'reactive_reinforce';

            if (sameIntent || compatibleStrategicBurst || compatibleReactiveDefenseChain) {
                return {
                    compatible: true,
                    reason: sameIntent ? 'same_movement_intent' : 'compatible_movement_intent',
                    currentIntent,
                    nextIntent,
                };
            }

            return {
                compatible: false,
                reason: 'movement_intent_conflict',
                currentIntent,
                nextIntent,
            };
        }

        return {
            compatible: nextPriorityScore >= windowState.priorityScore,
            reason: 'priority_check',
            currentIntent: windowState.movementIntent || null,
            nextIntent: null,
        };
    }

    _setCommandWindow(villageId, category, priorityScore, layerPriority, sourceLayer, movementIntent = null, targetCoords = null) {
        if (!villageId || !category) return;
        const now = Date.now();
        this._commandWindowByVillage.set(villageId, {
            category,
            priorityScore,
            layerPriority,
            sourceLayer,
            movementIntent,
            targetCoords,
            createdAt: now,
            expiresAt: now + COMMAND_WINDOW_TTL_MS,
        });
    }

    _dispatchCommand(commandType, payload = {}, context = {}) {
        this._expireReactiveCoordinationState();

        const villageId = this._inferVillageIdFromCommand(commandType, payload);
        const sourceLayer = context.sourceLayer || 'macro';
        const layerPriority = this._resolveLayerPriority(villageId, context);
        const priorityScore = COMMAND_LAYER_PRIORITY[layerPriority] || COMMAND_LAYER_PRIORITY.macro_normal;
        const category = this._classifyCommandCategory(commandType);
        const movementIntent = this._resolveMovementIntent(commandType, payload, context);
        const now = Date.now();

        if (category === 'movement' && villageId && sourceLayer !== 'reactive' && this._isOffensiveMovementCommand(commandType, payload)) {
            const village = this._lastKnownGameState?.villages?.find(candidate => candidate.id === villageId) || null;
            const combatState = this.getVillageCombatState(villageId);
            const hasPendingDodge = this._hasPendingDodgeForVillage(villageId);
            const movementLock = this.getMovementLockForVillage(villageId);
            const hasHighThreat = combatState?.threatLevel === 'high' || combatState?.threatLevel === 'critical';
            const hasReservedTroops = this._hasReservedTroops(combatState);
            const reservedTroopsCommitted = this._countReservedTroopsCommitted(payload?.troops || {}, combatState?.reservedTroops || {});
            const offenseSuppressed = Boolean(combatState?.offenseSuppressed);
            const counterWindowOpen = Boolean(combatState?.counterWindowOpen);

            if (hasPendingDodge || movementLock || hasHighThreat || offenseSuppressed || counterWindowOpen || reservedTroopsCommitted > 0) {
                this.log('warn', village, 'Arbitraje Central', 'Comando ofensivo bloqueado por contrato de combate reactivo.', {
                    villageId,
                    commandType,
                    missionType: payload?.missionType || null,
                    movementIntent,
                    layerPriority,
                    sourceLayer,
                    hasPendingDodge,
                    movementLockReason: movementLock?.reason || null,
                    threatLevel: combatState?.threatLevel || 'none',
                    preferredResponse: combatState?.preferredResponse || 'hold',
                    offenseSuppressed,
                    counterWindowOpen,
                    reservedTroopsPresent: hasReservedTroops,
                    reservedTroopsCommitted,
                    reservedTroopsCount: countTroopsInMap(combatState?.reservedTroops || {}),
                }, 'military');
                return {
                    success: false,
                    reason: 'AI_ARBITRATION_OFFENSE_SUPPRESSED_BY_REACTIVE',
                    details: {
                        villageId,
                        commandType,
                        missionType: payload?.missionType || null,
                        movementIntent,
                        layerPriority,
                        sourceLayer,
                        hasPendingDodge,
                        movementLockReason: movementLock?.reason || null,
                        threatLevel: combatState?.threatLevel || 'none',
                        preferredResponse: combatState?.preferredResponse || 'hold',
                        offenseSuppressed,
                        counterWindowOpen,
                        reservedTroopsPresent: hasReservedTroops,
                        reservedTroopsCommitted,
                        reservedTroopsCount: countTroopsInMap(combatState?.reservedTroops || {}),
                    },
                };
            }
        }

        if (category === 'movement' && villageId && sourceLayer === 'reactive' && this._isOffensiveMovementCommand(commandType, payload) && context.reactiveIntent === 'counter') {
            const village = this._lastKnownGameState?.villages?.find(candidate => candidate.id === villageId) || null;
            const strategicCommitment = this.getStrategicCommitmentForVillage(villageId);
            const combatState = this.getVillageCombatState(villageId);
            const criticalThreat = this._isCriticalReactiveThreat(combatState);

            if (strategicCommitment && !criticalThreat) {
                this.log('warn', village, 'Arbitraje Central', 'Counter reactivo bloqueado por compromiso ofensivo estrategico activo.', {
                    villageId,
                    commandType,
                    missionType: payload?.missionType || null,
                    movementIntent,
                    layerPriority,
                    sourceLayer,
                    reactiveIntent: context.reactiveIntent || null,
                    strategicCommitReason: strategicCommitment.reason || null,
                    strategicCommitExpiresAt: strategicCommitment.expiresAt || null,
                    threatLevel: combatState?.threatLevel || 'none',
                    threatType: combatState?.threatType || 'mixed',
                }, 'military');
                return {
                    success: false,
                    reason: 'AI_ARBITRATION_COUNTER_BLOCKED_BY_STRATEGIC_COMMIT',
                    details: {
                        villageId,
                        commandType,
                        missionType: payload?.missionType || null,
                        movementIntent,
                        layerPriority,
                        sourceLayer,
                        reactiveIntent: context.reactiveIntent || null,
                        strategicCommitReason: strategicCommitment.reason || null,
                        strategicCommitExpiresAt: strategicCommitment.expiresAt || null,
                        threatLevel: combatState?.threatLevel || 'none',
                        threatType: combatState?.threatType || 'mixed',
                    },
                };
            }
        }

        if (!this._isConstructionCommandAllowedUnderEmergency(commandType, payload, layerPriority, villageId)) {
            const village = this._lastKnownGameState?.villages?.find(candidate => candidate.id === villageId) || null;
            this.log('warn', village, 'Arbitraje Central', 'Comando bloqueado: constructionEmergencyLock activo.', {
                villageId,
                commandType,
                layerPriority,
                sourceLayer,
            }, 'economic');
            return {
                success: false,
                reason: 'AI_ARBITRATION_CONSTRUCTION_EMERGENCY_LOCK',
                details: { villageId, commandType, layerPriority, sourceLayer },
            };
        }

        const windowCompatibility = villageId
            ? this._isCommandCompatibleWithWindow(villageId, commandType, payload, context, category, priorityScore, now)
            : { compatible: true };

        if (villageId && !windowCompatibility.compatible) {
            const village = this._lastKnownGameState?.villages?.find(candidate => candidate.id === villageId) || null;
            this.log('warn', village, 'Arbitraje Central', 'Comando bloqueado por conflicto en ventana tactica activa.', {
                villageId,
                commandType,
                layerPriority,
                sourceLayer,
                category,
                movementIntent,
                windowReason: windowCompatibility.reason || 'unknown',
                currentIntent: windowCompatibility.currentIntent || null,
                nextIntent: windowCompatibility.nextIntent || null,
            }, 'military');
            return {
                success: false,
                reason: 'AI_ARBITRATION_PRIORITY_SUPERSEDED',
                details: {
                    villageId,
                    commandType,
                    layerPriority,
                    sourceLayer,
                    category,
                    movementIntent,
                    windowReason: windowCompatibility.reason || 'unknown',
                    currentIntent: windowCompatibility.currentIntent || null,
                    nextIntent: windowCompatibility.nextIntent || null,
                },
            };
        }

        const result = this._sendCommandRaw(commandType, payload);
        if (result?.success && villageId) {
            this._setCommandWindow(villageId, category, priorityScore, layerPriority, sourceLayer, movementIntent, payload?.targetCoords || null);

            if (
                category === 'movement'
                && sourceLayer === 'military'
                && this._isOffensiveMovementCommand(commandType, payload)
                && context.militaryIntent !== 'farming'
                && (payload?.missionType === 'attack' || payload?.missionType === 'conquest')
            ) {
                const strategicDurationMs = context.strategicPriority === 'high_value'
                    ? BASE_LOCK_DURATIONS_MS.strategicCommitmentHighValueByVillage
                    : BASE_LOCK_DURATIONS_MS.strategicCommitmentByVillage;
                this.setStrategicCommitmentForVillage(villageId, strategicDurationMs, {
                    reason: context.strategicPriority === 'high_value'
                        ? 'strategic_high_value_commit'
                        : `strategic_attack_commit:${context.strategicTargetType || 'generic'}`,
                    sourceMovementId: null,
                });
            }
        }

        return result;
    }

    _selectDeferredCounterTroops(village, ratio = 0.2, minTroops = 6) {
        const raceUnits = gameData.units[village.race]?.troops || [];
        const troopEntries = [];

        for (const [unitId, count] of Object.entries(village.unitsInVillage || {})) {
            if ((count || 0) <= 0) continue;
            const unitData = raceUnits.find(unit => unit.id === unitId);
            if (!unitData) continue;
            const isOffensive = unitData.role === 'offensive' || unitData.role === 'catapult' || unitData.role === 'ram' || unitData.role === 'versatile';
            if (!isOffensive) continue;

            troopEntries.push({ unitId, count, role: unitData.role || 'unknown' });
        }

        troopEntries.sort((a, b) => {
            const rank = role => {
                if (role === 'catapult' || role === 'ram') return 0;
                if (role === 'offensive') return 1;
                if (role === 'versatile') return 2;
                return 3;
            };
            return rank(a.role) - rank(b.role);
        });

        const totalCandidateTroops = troopEntries.reduce((sum, entry) => sum + entry.count, 0);
        if (totalCandidateTroops < minTroops) return {};

        const target = Math.max(minTroops, Math.floor(totalCandidateTroops * ratio));
        const selected = {};
        let picked = 0;

        for (const entry of troopEntries) {
            if (picked >= target) break;
            const remaining = target - picked;
            const take = Math.min(entry.count, remaining);
            if (take > 0) {
                selected[entry.unitId] = take;
                picked += take;
            }
        }

        return selected;
    }

    _processCounterWindows(gameState) {
        const sender = this._getCommandSender({ sourceLayer: 'reactive', layerPriority: 'reactive_counterattack', reactiveIntent: 'counter' });
        const myVillages = gameState.villages.filter(village => village.ownerId === this._ownerId);

        for (const village of myVillages) {
            const state = this.getVillageCombatState(village.id);
            if (!state || !state.counterWindowOpen) continue;
            if (Number.isFinite(state.counterWindowExpiresAt) && state.counterWindowExpiresAt <= Date.now()) {
                this.upsertVillageCombatState(village.id, {
                    counterWindowOpen: false,
                    counterWindowExpiresAt: null,
                    counterDecisionState: 'none',
                    counterDecisionReason: 'counter_window_expired',
                    counterDecisionAt: Date.now(),
                }, {
                    lastDecisionReason: 'counter_window_expired',
                });
                continue;
            }

            if (!state.shouldCounterattack) continue;
            if (state.threatLevel === 'high' || state.threatLevel === 'critical') continue;
            if (this.hasCounterattackCooldownForVillage(village.id)) continue;
            if (this.hasMovementLockForVillage(village.id)) continue;
            if (this._hasPendingDodgeForVillage(village.id)) continue;

            const attackerVillageId = state.attackerVillageId;
            if (!attackerVillageId) continue;
            const attackerVillage = gameState.villages.find(candidate => candidate.id === attackerVillageId);
            if (!attackerVillage || attackerVillage.ownerId === this._ownerId) continue;

            const troops = this._selectDeferredCounterTroops(village);
            if (!troops || Object.keys(troops).length === 0) continue;

            const result = sender('send_movement', {
                originVillageId: village.id,
                targetCoords: { ...attackerVillage.coords },
                troops,
                missionType: 'raid',
            }, {
                reactiveIntent: 'counter',
            });

            if (!result?.success) {
                if (result?.reason === 'AI_ARBITRATION_COUNTER_BLOCKED_BY_STRATEGIC_COMMIT') {
                    this.upsertVillageCombatState(village.id, {
                        counterWindowOpen: false,
                        counterWindowExpiresAt: null,
                        counterDecisionState: 'none',
                        counterDecisionReason: 'deferred_blocked_by_strategic_commit',
                        counterDecisionAt: Date.now(),
                    }, {
                        lastDecisionReason: 'deferred_counter_blocked_by_strategic_commit',
                    });
                }
                continue;
            }

            this.setCounterattackCooldownForVillage(village.id, 90000, {
                reason: 'deferred_counterwindow_launch',
                sourceMovementId: state.sourceMovementIds?.[0] || null,
            });
            this.setMovementLockForVillage(village.id, 15000, {
                reason: 'deferred_counterwindow_launch',
                sourceMovementId: state.sourceMovementIds?.[0] || null,
            });
            this.upsertVillageCombatState(village.id, {
                counterWindowOpen: false,
                counterWindowExpiresAt: null,
                counterDecisionState: 'deferred_executed',
                counterDecisionReason: 'deferred_counterwindow_executed',
                counterDecisionAt: Date.now(),
            }, {
                lastDecisionReason: 'deferred_counterwindow_executed',
            });

            this.log('success', village, 'Counter Window', 'Contraataque diferido lanzado desde ventana tactica.', {
                attackerVillageId,
                troops,
            }, 'military');
        }
    }

    _ensureGermanPhaseState(villageId) {
        if (!this._germanPhaseStates.has(villageId)) {
            this._germanPhaseStates.set(villageId, createDefaultGermanPhaseState());
        }

        return this._germanPhaseStates.get(villageId);
    }

    _ensureEgyptianPhaseState(villageId) {
        if (!this._egyptianPhaseStates.has(villageId)) {
            this._egyptianPhaseStates.set(villageId, createDefaultEgyptianPhaseState());
        }

        return this._egyptianPhaseStates.get(villageId);
    }

    _updateOasisTelemetry(cycleTelemetry) {
        if (!cycleTelemetry) return;

        this._oasisTelemetry = this._ensureOasisTelemetryDefaults(this._oasisTelemetry);

        this._oasisTelemetry.decisions += 1;
        this._oasisTelemetry.evaluatedOases += cycleTelemetry.evaluatedOases || 0;
        this._oasisTelemetry.profitableOases += cycleTelemetry.profitableOases || 0;
        this._oasisTelemetry.rejectedNoSquad += cycleTelemetry.rejectedNoSquad || 0;
        this._oasisTelemetry.rejectedNonPositive += cycleTelemetry.rejectedNonPositive || 0;
        this._oasisTelemetry.attacksIssued += cycleTelemetry.attacksIssued || 0;
        this._oasisTelemetry.attacksIssuedNonPositive += cycleTelemetry.attacksIssuedNonPositive || 0;
        this._oasisTelemetry.rewardNetSum += cycleTelemetry.rewardNetSum || 0;
        this._oasisTelemetry.rewardGrossSum += cycleTelemetry.rewardGrossSum || 0;
        this._oasisTelemetry.lossValueSum += cycleTelemetry.lossValueSum || 0;
        this._oasisTelemetry.travelCostSum += cycleTelemetry.travelCostSum || 0;
        if (cycleTelemetry.noProfitableCycle) this._oasisTelemetry.skippedCyclesNoProfitable += 1;

        (cycleTelemetry.attackedOasisIds || []).forEach(oasisId => {
            this._oasisTelemetry.oasisAttackHistogram[oasisId] = (this._oasisTelemetry.oasisAttackHistogram[oasisId] || 0) + 1;
        });

        this._oasisTelemetry.uniqueOasesAttacked = Object.keys(this._oasisTelemetry.oasisAttackHistogram).length;

        const totalAttacks = Math.max(this._oasisTelemetry.attacksIssued, 0);
        this._oasisTelemetry.attackNonPositiveRate = totalAttacks > 0
            ? this._oasisTelemetry.attacksIssuedNonPositive / totalAttacks
            : 0;

        this._oasisTelemetry.avgRewardNet = totalAttacks > 0
            ? this._oasisTelemetry.rewardNetSum / totalAttacks
            : 0;

        this._oasisTelemetry.avgLossToGross = this._oasisTelemetry.rewardGrossSum > 0
            ? this._oasisTelemetry.lossValueSum / this._oasisTelemetry.rewardGrossSum
            : 0;
    }

    _updateMilitaryGateTelemetry(gateTelemetry, hasOasisFarmingTelemetry = false) {
        this._oasisTelemetry = this._ensureOasisTelemetryDefaults(this._oasisTelemetry);
        this._oasisTelemetry.militaryCycles += 1;

        if (gateTelemetry?.farmEvaluationExecuted || (!gateTelemetry && hasOasisFarmingTelemetry)) {
            this._oasisTelemetry.cyclesFarmEvaluated += 1;
        }
        if (gateTelemetry?.farmBlockedByMaxPriorityGoal) {
            this._oasisTelemetry.cyclesFarmBlockedByMaxPriority += 1;
        }
        if (gateTelemetry?.isMusteringForWar) {
            this._oasisTelemetry.cyclesMusteringForWar += 1;
        }

        const totalCycles = Math.max(this._oasisTelemetry.militaryCycles, 1);
        this._oasisTelemetry.farmEvaluationRate = this._oasisTelemetry.cyclesFarmEvaluated / totalCycles;
        this._oasisTelemetry.farmBlockedRate = this._oasisTelemetry.cyclesFarmBlockedByMaxPriority / totalCycles;
    }

    _ensureOasisTelemetryDefaults(currentTelemetry = null) {
        return {
            ...createDefaultOasisTelemetry(),
            ...(currentTelemetry || {}),
            oasisAttackHistogram: {
                ...createDefaultOasisTelemetry().oasisAttackHistogram,
                ...(currentTelemetry?.oasisAttackHistogram || {}),
            },
        };
    }

    handleReactiveEvent(eventType, data, gameState) {
        this._lastKnownGameState = gameState;
        this._expireReactiveCoordinationState();

        if (eventType === 'movement_dispatched') {
            const movement = data;
            this.log('warn', null, 'Evento Reactivo', `Detectado movimiento hostil inminente: '${movement.type}'.`, movement, 'military');
            
            if (movement.type === 'espionage') {
                this._handleEspionageReact(movement, gameState);
            } else if (movement.type === 'attack' || movement.type === 'raid') {
                this._handleAttackReact(movement, gameState);
            }
        } else if (eventType === 'espionage_success') {
            const report = data?.report;
            if (report && report.payload) {
                this.log('info', null, 'Intel Recibida', `Espionaje exitoso contra ${report.defender.villageName || 'objetivo'}.`, report.payload, 'military');
            }
        }
    }

    _handleEspionageReact(movement, gameState) {
        handleEspionageReact({
            movement,
            gameState,
            race: this._race,
            dodgeTasks: this._dodgeTasks,
            villageCombatState: {
                get: this.getVillageCombatState.bind(this),
                upsert: this.upsertVillageCombatState.bind(this),
                clear: this.clearVillageCombatState.bind(this),
            },
            locks: {
                hasMovementLock: this.hasMovementLockForVillage.bind(this),
                setMovementLock: this.setMovementLockForVillage.bind(this),
            },
            cooldowns: {
                hasReactionCooldown: this.hasReactionCooldownForMovement.bind(this),
                setReactionCooldown: this.setReactionCooldownForMovement.bind(this),
            },
            sendCommand: this._getCommandSender({ sourceLayer: 'reactive', layerPriority: 'reactive_low' }),
            log: this.log.bind(this),
        });
    }

    _handleAttackReact(movement, gameState) {
        if (this._race === 'huns') {
            this._handleHunAttackReactWithDeepSeek(movement, gameState);
            return;
        }

        handleAttackReact({
            movement,
            gameState,
            race: this._race,
            archetype: this._archetype,
            ownerId: this._ownerId,
            gameConfig: this._gameConfig,
            dodgeTasks: this._dodgeTasks,
            villageCombatState: {
                get: this.getVillageCombatState.bind(this),
                upsert: this.upsertVillageCombatState.bind(this),
                clear: this.clearVillageCombatState.bind(this),
            },
            locks: {
                hasMovementLock: this.hasMovementLockForVillage.bind(this),
                setMovementLock: this.setMovementLockForVillage.bind(this),
                hasConstructionEmergencyLock: this.hasConstructionEmergencyLockForVillage.bind(this),
                setConstructionEmergencyLock: this.setConstructionEmergencyLockForVillage.bind(this),
            },
            cooldowns: {
                hasReactionCooldown: this.hasReactionCooldownForMovement.bind(this),
                setReactionCooldown: this.setReactionCooldownForMovement.bind(this),
                hasCounterattackCooldown: this.hasCounterattackCooldownForVillage.bind(this),
                setCounterattackCooldown: this.setCounterattackCooldownForVillage.bind(this),
            },
            sendCommand: this._getCommandSender({ sourceLayer: 'reactive' }),
            log: this.log.bind(this),
        });

        const targetVillage = gameState.villages.find(
            village => village.coords.x === movement.targetCoords?.x && village.coords.y === movement.targetCoords?.y,
        );
        if (targetVillage) {
            const combatState = this.getVillageCombatState(targetVillage.id);

            if (combatState?.shouldPauseEconomicConstruction) {
                const durationMs = combatState.threatLevel === 'critical' ? 45000 : BASE_LOCK_DURATIONS_MS.constructionEmergencyLockByVillage;
                this.setConstructionEmergencyLockForVillage(
                    targetVillage.id,
                    durationMs,
                    { reason: 'reactive_macro_emergency_lock', sourceMovementId: movement.id },
                );
            }

            if (combatState && !combatState.isFake && (combatState.threatLevel === 'high' || combatState.threatLevel === 'critical')) {
                const now = Date.now();
                const cooldownEntry = this._merchantEvacuationCooldownByVillage.get(targetVillage.id);
                if (!cooldownEntry || cooldownEntry < now) {
                    const evacuationSender = this._getCommandSender({ sourceLayer: 'reactive', layerPriority: 'reactive_dodge_reinforce' });
                    const evacuationResult = planResourceEvacuation({
                        targetVillage,
                        gameState,
                        ownerId: this._ownerId,
                        sendCommand: evacuationSender,
                        log: this.log.bind(this),
                    });
                    if (evacuationResult.evacuated) {
                        this._merchantEvacuationCooldownByVillage.set(targetVillage.id, now + 120000);
                    }
                }
            }

            const hasSiegeAttack = combatState && !combatState.isFake && (combatState.threatType === 'siege_attack' || combatState.threatType === 'conquest_attack');
            if (hasSiegeAttack && movement.arrivalTime) {
                const existing = this._siegeArrivalPendingByVillage.get(targetVillage.id);
                if (!existing || existing.arrivalTime > movement.arrivalTime) {
                    this._siegeArrivalPendingByVillage.set(targetVillage.id, {
                        arrivalTime: movement.arrivalTime,
                        movementId: movement.id,
                    });
                }
            }

            const canSnipe = combatState
                && !combatState.isFake
                && movement.arrivalTime
                && combatState.preferredResponse !== 'full_dodge'
                && combatState.preferredResponse !== 'partial_dodge'
                && (combatState.threatLevel === 'medium' || combatState.threatLevel === 'high' || combatState.threatLevel === 'critical');
            if (canSnipe) {
                planSnipeTasks({
                    targetVillage,
                    movementArrivalTime: movement.arrivalTime,
                    movementId: movement.id,
                    gameState,
                    ownerId: this._ownerId,
                    race: this._race,
                    snipeTasks: this._snipeTasks,
                    gameConfig: this._gameConfig,
                    log: this.log.bind(this),
                });
            }
        }
    }

    async _handleHunAttackReactWithDeepSeek(movement, gameState) {
        const targetVillage = gameState.villages.find(
            village => village.coords.x === movement.targetCoords?.x && village.coords.y === movement.targetCoords?.y,
        );
        if (!targetVillage) return;

        const attackerVillage = gameState.villages.find(village => village.id === movement.originVillageId);
        const evaluation = evaluateThreatAndChooseResponse({
            movement,
            gameState,
            race: this._race,
            archetype: this._archetype,
            ownerId: this._ownerId,
            gameConfig: this._gameConfig,
            targetVillage,
            attackerVillage,
        });

        const dsResult = await getHunDefenseAdvice({
            movement,
            targetVillage,
            attackerVillage,
            attackPower: evaluation.attackPowerEstimate,
            localDefense: evaluation.localDefenseEstimate,
            canHoldLocally: evaluation.canHoldLocally,
            canHoldWithReinforcements: evaluation.canHoldWithReinforcements,
            threatType: evaluation.threatType,
            threatLevel: evaluation.threatLevel,
            posture: evaluation.posture,
            projectedLossSeverity: evaluation.projectedLossSeverity,
            fallbackResponse: evaluation.preferredResponse,
            log: this.log.bind(this),
        });

        const finalResponse = dsResult.overridden ? dsResult.response : evaluation.preferredResponse;
        const finalEvaluation = { ...evaluation, preferredResponse: finalResponse };

        this.upsertVillageCombatState(targetVillage.id, {
            threatLevel: finalEvaluation.threatLevel,
            threatType: finalEvaluation.threatType,
            intelFresh: finalEvaluation.intelFresh,
            lastIntelAt: finalEvaluation.lastIntelAt,
            posture: finalEvaluation.posture,
            preferredResponse: finalEvaluation.preferredResponse,
            offenseSuppressed: finalEvaluation.offenseSuppressed,
            reservedTroops: finalEvaluation.reservedTroops,
            attackPowerEstimate: finalEvaluation.attackPowerEstimate,
            localDefenseEstimate: finalEvaluation.localDefenseEstimate,
            imperialDefenseEstimate: finalEvaluation.imperialDefenseEstimate,
            canHoldLocally: finalEvaluation.canHoldLocally,
            canHoldWithReinforcements: finalEvaluation.canHoldWithReinforcements,
            shouldPreserveOffense: finalEvaluation.shouldPreserveOffense,
            shouldCounterattack: finalEvaluation.shouldCounterattack,
            shouldPauseEconomicConstruction: finalEvaluation.shouldPauseEconomicConstruction,
            shouldBoostEmergencyRecruitment: finalEvaluation.shouldBoostEmergencyRecruitment,
            attackerVillageId: finalEvaluation.attackerVillageId,
            shouldRescoutAttacker: finalEvaluation.shouldRescoutAttacker,
            rescoutReason: finalEvaluation.rescoutReason,
            doctrineId: finalEvaluation.doctrineId,
            attackerRace: finalEvaluation.attackerRace,
            counterWindowOpen: finalEvaluation.counterWindowOpen,
            counterWindowExpiresAt: finalEvaluation.counterWindowExpiresAt,
            sourceMovementIds: [movement.id],
            lastDecisionReason: `hun_deepseek:${finalResponse}`,
        }, {
            sourceMovementIds: [movement.id],
            lastDecisionReason: `hun_deepseek:${finalResponse}`,
        });

        this.setMovementLockForVillage(targetVillage.id, 15000, { reason: `hun_reactive_${finalResponse}`, sourceMovementId: movement.id });
        this.setReactionCooldownForMovement(movement.id, 20000, { reason: `hun_reactive_${finalResponse}`, sourceMovementId: movement.id });

        if (finalEvaluation.shouldPauseEconomicConstruction) {
            const durationMs = finalEvaluation.threatLevel === 'critical' ? 45000 : BASE_LOCK_DURATIONS_MS.constructionEmergencyLockByVillage;
            this.setConstructionEmergencyLockForVillage(
                targetVillage.id,
                durationMs,
                { reason: 'hun_reactive_macro_emergency_lock', sourceMovementId: movement.id },
            );
        }
    }

    _processEmergencyRepairs(gameState) {
        const now = Date.now();
        const REPAIR_PRIORITY_ORDER = ['cityWall', 'barracks', 'granary', 'warehouse', 'mainBuilding'];

        for (const [villageId, entry] of this._siegeArrivalPendingByVillage.entries()) {
            if (entry.arrivalTime > now) continue;
            this._siegeArrivalPendingByVillage.delete(villageId);

            if (!this._emergencyRepairTargetsByVillage.has(villageId)) {
                this._emergencyRepairTargetsByVillage.set(villageId, new Set(REPAIR_PRIORITY_ORDER));
            }
        }

        if (this._emergencyRepairTargetsByVillage.size === 0) return;

        const sender = this._getCommandSender({ sourceLayer: 'macro', layerPriority: 'macro_emergency' });

        for (const [villageId, buildingSet] of this._emergencyRepairTargetsByVillage.entries()) {
            if (buildingSet.size === 0) {
                this._emergencyRepairTargetsByVillage.delete(villageId);
                continue;
            }

            const village = gameState.villages.find(candidate => candidate.id === villageId && candidate.ownerId === this._ownerId);
            if (!village) {
                this._emergencyRepairTargetsByVillage.delete(villageId);
                continue;
            }

            for (const buildingType of REPAIR_PRIORITY_ORDER) {
                if (!buildingSet.has(buildingType)) continue;
                buildingSet.delete(buildingType);

                const building = village.buildings.find(b => b.type === buildingType);
                if (!building || building.level <= 0) continue;

                const result = sender('upgrade_building', {
                    villageId: village.id,
                    buildingId: building.id,
                    buildingType,
                });

                if (result?.success) {
                    this.log('success', village, 'Reparacion Emergencia', `Edificio ${buildingType} en reparacion prioritaria post-asedio.`, { buildingType, level: building.level }, 'economic');
                    break;
                }
            }

            if (buildingSet.size === 0) {
                this._emergencyRepairTargetsByVillage.delete(villageId);
            }
        }
    }

    _processSnipeTasks(gameState) {
        processSnipeTasks({
            gameState,
            snipeTasks: this._snipeTasks,
            sendCommand: this._getCommandSender({ sourceLayer: 'reactive', layerPriority: 'reactive_high' }),
            log: this.log.bind(this),
        });
    }

    _manageForwardDefense(gameState) {
        const FORWARD_DEFENSE_RADIUS = 30;
        const MIN_GARRISON_UNITS = 50;
        const SURPLUS_RATIO = 0.25;
        const COOLDOWN_MS = 10 * 60 * 1000;
        const HOSTILE_TYPES = new Set(['attack', 'raid']);
        const now = Date.now();

        const myVillages = gameState.villages.filter(v => v.ownerId === this._ownerId);
        if (myVillages.length <= 1) return;

        const enemyVillages = gameState.villages.filter(
            v => v.ownerId !== this._ownerId && v.ownerId !== 'nature',
        );
        if (enemyVillages.length === 0) return;

        const raceUnits = gameData.units[this._race]?.troops || [];

        const getDefensiveTroops = village => {
            const result = {};
            for (const unitId in village.unitsInVillage || {}) {
                const count = village.unitsInVillage[unitId] || 0;
                if (count <= 0) continue;
                const unitData = raceUnits.find(u => u.id === unitId);
                if (!unitData) continue;
                if (unitData.role === 'defensive' || unitData.role === 'versatile') {
                    result[unitId] = count;
                }
            }
            return result;
        };

        const isThreatened = village => gameState.movements.some(m => {
            if (!HOSTILE_TYPES.has(m.type)) return false;
            if (m.ownerId === this._ownerId) return false;
            return m.targetCoords?.x === village.coords.x
                && m.targetCoords?.y === village.coords.y;
        });

        const frontierVillages = myVillages.filter(mv =>
            enemyVillages.some(ev =>
                Math.hypot(ev.coords.x - mv.coords.x, ev.coords.y - mv.coords.y) <= FORWARD_DEFENSE_RADIUS,
            ),
        );
        if (frontierVillages.length === 0) return;

        const frontierIds = new Set(frontierVillages.map(v => v.id));
        const interiorVillages = myVillages.filter(v => !frontierIds.has(v.id) && !isThreatened(v));
        if (interiorVillages.length === 0) return;

        const sender = this._getCommandSender({ sourceLayer: 'military', layerPriority: 'military_low' });

        for (const frontier of frontierVillages) {
            if (isThreatened(frontier)) continue;

            const cooldownExpiry = this._forwardDefenseCooldownByVillage.get(frontier.id);
            if (cooldownExpiry && cooldownExpiry > now) continue;

            const currentDef = getDefensiveTroops(frontier);
            const totalCurrentDef = Object.values(currentDef).reduce((s, c) => s + c, 0);
            if (totalCurrentDef >= MIN_GARRISON_UNITS * 3) continue;

            const candidates = interiorVillages
                .map(v => ({
                    village: v,
                    dist: Math.hypot(v.coords.x - frontier.coords.x, v.coords.y - frontier.coords.y),
                    defensiveTroops: getDefensiveTroops(v),
                }))
                .filter(({ defensiveTroops }) => {
                    const total = Object.values(defensiveTroops).reduce((s, c) => s + c, 0);
                    return total > MIN_GARRISON_UNITS * 2;
                })
                .sort((a, b) => a.dist - b.dist);

            if (candidates.length === 0) continue;

            const source = candidates[0];
            const troopsToSend = {};
            for (const unitId in source.defensiveTroops) {
                const toSend = Math.floor((source.defensiveTroops[unitId] || 0) * SURPLUS_RATIO);
                if (toSend > 0) troopsToSend[unitId] = toSend;
            }

            const totalToSend = Object.values(troopsToSend).reduce((s, c) => s + c, 0);
            if (totalToSend < 10) continue;

            sender('send_movement', {
                originVillageId: source.village.id,
                targetCoords: frontier.coords,
                troops: troopsToSend,
                missionType: 'reinforcement',
            }, {
                strategicIntent: 'forward_defense',
            });

            this._forwardDefenseCooldownByVillage.set(frontier.id, now + COOLDOWN_MS);

            this.log('info', frontier, 'Forward Defense',
                `Refuerzo preventivo desde ${source.village.name || source.village.id} (${totalToSend} tropas).`,
                { sourceVillageId: source.village.id, troopsToSend }, 'military');
        }
    }

    _processDodgeTasks(gameState) {
        processDodgeTasks({
            gameState,
            dodgeTasks: this._dodgeTasks,
            dodgeTimeThresholdMs: AI_CONTROLLER_CONSTANTS.dodgeTimeThresholdMs,
            ownerId: this._ownerId,
            sendCommand: this._getCommandSender({ sourceLayer: 'reactive', layerPriority: 'reactive_high' }),
            log: this.log.bind(this),
        });
    }

    _processReinforcementRecalls(gameState) {
        this._reinforcementTasks = processReinforcementRecalls({
            gameState,
            reinforcementTasks: this._reinforcementTasks,
            sendCommand: this._getCommandSender({ sourceLayer: 'reactive', layerPriority: 'reactive_high' }),
            log: this.log.bind(this),
        });
    }

    makeDecision(gameState) {
        this._lastKnownGameState = gameState;
        this._expireReactiveCoordinationState();
        this._processReinforcementRecalls(gameState);
        this._processDodgeTasks(gameState);
        this._processSnipeTasks(gameState);
        this._processCounterWindows(gameState);
        this._processEmergencyRepairs(gameState);

        const now = Date.now();
        const myVillages = gameState.villages.filter(v => v.ownerId === this._ownerId);
        if (myVillages.length === 0) return;

        if (!this._isThinkingEconomic && (now - this._lastEconomicDecisionTime >= this._economicDecisionInterval)) {
            this.log('info', null, 'INICIO_CICLO_GESTION', 'Iniciando evaluacion economica y militar.');
            this._logBudgetSnapshotForCycle('economic', myVillages);
            this._isThinkingEconomic = true;
            this._lastEconomicDecisionTime = now;
            try {
                if (this._goalManager) {
                    myVillages.forEach(village => this._goalManager.ensureVillageStateExists(village.id));
                }

                myVillages.forEach((village, index) => {
                    if (this._race === 'germans' && this._isPhaseEngineEnabledForRace('germans')) {
                        const phaseState = this._ensureGermanPhaseState(village.id);
                        const result = runGermanEconomicPhaseCycle({
                            village,
                            gameState,
                            phaseState,
                            difficulty: this._difficulty,
                            gameSpeed: this._gameConfig?.gameSpeed || 1,
                            villageCombatState: this.getVillageCombatState(village.id),
                            actionExecutor: this._actionExecutor,
                            log: this.log.bind(this),
                        });

                        this._germanPhaseStates.set(village.id, result.phaseState);

                        if (!result.handled) {
                            this.log(
                                'warn',
                                village,
                                'Macro Fases',
                                'El motor por fases devolvio handled=false; se evita fallback legacy por hard cutover.',
                                { phaseId: phaseState.activePhaseId },
                                'economic',
                            );
                        }
                        return;
                    }

                    if (this._race === 'egyptians' && this._isPhaseEngineEnabledForRace('egyptians')) {
                        const phaseState = this._ensureEgyptianPhaseState(village.id);
                        const result = runEgyptianEconomicPhaseCycle({
                            village,
                            gameState,
                            phaseState,
                            difficulty: this._difficulty,
                            gameSpeed: this._gameConfig?.gameSpeed || 1,
                            villageCombatState: this.getVillageCombatState(village.id),
                            actionExecutor: this._actionExecutor,
                            log: this.log.bind(this),
                        });

                        this._egyptianPhaseStates.set(village.id, result.phaseState);

                        if (!result.handled) {
                            this.log(
                                'warn',
                                village,
                                'Macro Fases',
                                'El motor egipcio devolvio handled=false; se evita fallback legacy por hard cutover.',
                                { phaseId: phaseState.activePhaseId },
                                'economic',
                            );
                        }
                        return;
                    }

                    if (this._goalManager) {
                        this._goalManager.processVillageState(village, index, gameState);
                    }
                });
            } catch (error) {
                this.log('error', null, 'Ciclo de Gestion', 'Error en la logica estrategica.', error);
            } finally {
                this._isThinkingEconomic = false;
            }
        }

        if (!this._isThinkingMilitary && (now - this._lastMilitaryDecisionTime >= this._militaryDecisionInterval)) {
            if (this._shouldDeferMilitaryByGermanPhase(gameState)) {
                this._lastMilitaryDecisionTime = now;
                return;
            }

            this._processMilitaryDecision(gameState);
        }
    }

    async _processMilitaryDecision(gameState) {
        this._isThinkingMilitary = true;
        this._lastMilitaryDecisionTime = Date.now();
        const myVillages = gameState.villages.filter(village => village.ownerId === this._ownerId);
        this._logBudgetSnapshotForCycle('military', myVillages);

        this._manageForwardDefense(gameState);

        try {
            if (this._race === 'huns') {
                await this._logHunDeepSeekAttackAdvisory(gameState, myVillages);
            }

            const telemetry = runMilitaryDecision({
                gameState,
                ownerId: this._ownerId,
                race: this._race,
                archetype: this._archetype,
                personality: this._personality,
                gameConfig: this._gameConfig,
                villageCombatStateByVillageId: this._buildVillageCombatContractSnapshot(myVillages.map(village => village.id)),
                strategicAI: this._strategicAI,
                executeCommands: this._executeCommands.bind(this),
                log: this.log.bind(this),
                reputationManager: this._reputationManager,
            });

            if (telemetry) {
                this._updateMilitaryGateTelemetry(telemetry.militaryGate, Boolean(telemetry.oasisFarming));
            }

            if (telemetry?.oasisFarming) {
                this._updateOasisTelemetry(telemetry.oasisFarming);
            }
        } catch (error) {
            this.log('error', null, 'Error en Ciclo Militar', 'Error en la logica militar.', error.message + '\n' + error.stack, 'military');
        } finally {
            this._isThinkingMilitary = false;
        }
    }

    async _logHunDeepSeekAttackAdvisory(gameState, myVillages) {
        try {
            const status = getHunDeepSeekStatus();
            if (!status.enabled || !status.apiKeyPresent) return;

            const myVillageIds = new Set(myVillages.map(village => village.id));
            const allOtherVillages = gameState.villages.filter(village => !myVillageIds.has(village.id));
            const knownTargets = allOtherVillages.slice(0, 8).map(village => ({
                id: village.id,
                ownerId: village.ownerId,
                targetType: village.ownerId === 'nature' ? 'oasis' : 'player',
                spyStatus: 'unknown',
                coords: village.coords,
                estimatedDefense: null,
                intel: null,
            }));

            await getHunAttackAdvice({
                myVillages,
                availableForces: myVillages.map(village => ({
                    village,
                    power: 0,
                    totalPower: 0,
                    scoutCount: 0,
                    isArmyBusy: false,
                })),
                targets: { known: knownTargets, unknown: [] },
                race: this._race,
                archetype: this._archetype,
                gameState,
                ownerId: this._ownerId,
                log: this.log.bind(this),
            });
        } catch (err) {
            this.log('warn', null, 'Huno DeepSeek Ataque', `Error en advisory de ataque: ${err.message}`, null, 'military');
        }
    }
    
    _executeCommands(commands, gameState) {
        executeCommands({
            commands,
            gameState,
            sendCommand: this._getCommandSender({ sourceLayer: 'military' }),
            log: this.log.bind(this),
        });
    }
}

export default AIController;
