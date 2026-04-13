// RUTA: js/ai/AIController.js
import ReputationManager from './ReputationManager.js';
import AIGoalManager from './AIGoalManager.js';
import AIActionExecutor from './AIActionExecutor.js';
import StrategicAI from './StrategicAI.js';
import { AI_CONTROLLER_CONSTANTS } from './config/AIConstants.js';
import { gameData } from '../core/GameData.js';
import { applyDevelopmentBudgetMode } from './controller/economic.js';
import { executeCommands } from './controller/commands.js';
import { handleAttackReact, handleEspionageReact, processDodgeTasks, processReinforcementRecalls } from './controller/reactive.js';
import { runMilitaryDecision } from './controller/military.js';
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
        [EGYPTIAN_PHASE_IDS.phase6]: 'Fase 6 - Control Resiliente Tardio',
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
});

const COMMAND_LAYER_PRIORITY = Object.freeze({
    reactive_critical: 50,
    reactive_high: 40,
    macro_emergency: 30,
    macro_normal: 20,
    reactive_low: 10,
});

const COMMAND_WINDOW_TTL_MS = 12000;

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
        posture: 'hybrid',
        preferredResponse: 'hold',
        attackPowerEstimate: 0,
        localDefenseEstimate: 0,
        imperialDefenseEstimate: 0,
        canHoldLocally: false,
        canHoldWithReinforcements: false,
        shouldPreserveOffense: false,
        shouldCounterattack: false,
        shouldPauseEconomicConstruction: false,
        shouldBoostEmergencyRecruitment: false,
        counterWindowOpen: false,
        counterWindowExpiresAt: null,
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
    if (phaseId === EGYPTIAN_PHASE_IDS.phase5 || phaseId === EGYPTIAN_PHASE_IDS.phase6 || phaseId === EGYPTIAN_PHASE_IDS.phaseDone) return 'late';
    return 'unknown';
}

function getPhaseLabel(race, phaseId) {
    const labels = PHASE_LABELS_BY_RACE[race] || {};
    return labels[phaseId] || 'Fase no definida';
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
    _commandWindowByVillage = new Map();
    _lastKnownGameState = null;

    constructor(ownerId, personality, race, archetype, sendCommandCallback, gameConfig, difficulty = 'Pesadilla') {
        this._ownerId = ownerId;
        this._personality = personality;
        this._race = race;
        this._archetype = archetype;
        this._difficulty = difficulty;
        this._sendCommandRaw = sendCommandCallback;
        this._sendCommand = this._dispatchCommand.bind(this);
        this._gameConfig = gameConfig;

        this._strategicAI = new StrategicAI();

        const gameSpeed = this._gameConfig?.gameSpeed || DECISION_SPEED_MIN;
        this._economicDecisionInterval = getEconomicDecisionIntervalMs(gameSpeed);
        this._militaryDecisionInterval = getMilitaryDecisionIntervalMs(gameSpeed);
        
        this._actionExecutor = new AIActionExecutor(this);
        this._goalManager = (this._race === 'germans' || this._race === 'egyptians')
            ? null
            : new AIGoalManager(this, this._actionExecutor);
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
            `Macro engine: ${this._race === 'germans' || this._race === 'egyptians' ? 'PhaseEngine (sin GoalManager)' : 'GoalManager legacy'}`,
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
        const ICONS = { info: '⚙️', success: '✅', fail: '❌', warn: '⚠️', goal: '🎯', error: '🔥' };
        const STYLES = {
            info: 'color: #6c757d;',
            success: 'color: #28a745; font-weight: bold;',
            fail: 'color: #dc3545;',
            warn: 'color: #ffc107;',
            goal: 'color: #6f42c1; font-weight: bold;',
            error: 'color: #E91E63; font-weight: bold;',
        };

        const logVillage = village || this._resolvePrimaryVillage();
        const context = this._buildLogContext(logVillage, category);
        const normalizedAction = ACTION_LABELS[action] || action;

        console.log(
            `%c${ICONS[level] || ''} [IA ${this._ownerId}] [Juego ${context.gameTime}] [Etapa ${context.stage}] [${context.phase}] [${context.villageLabel}] [${normalizedAction}] :: ${message}`,
            STYLES[level] || '',
        );

        if (details) {
            if (typeof details === 'string') {
                console.log(details);
            } else {
                console.dir(details);
            }
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

    handleGameNotification(notification, gameState) {
        this._lastKnownGameState = gameState;

        if (this._race !== 'germans' || !notification || !notification.type) {
            return;
        }

        if (notification.type !== 'recruitment:finished') {
            return;
        }

        const payload = notification.payload || {};
        const village = gameState?.villages?.find(candidate => candidate.id === payload.villageId);
        if (!village) return;

        const phaseState = this._germanPhaseStates.get(village.id);
        if (!phaseState || !phaseState.activePhaseId) return;

        const phaseKey = phaseState.activePhaseId;
        if (!phaseKey || phaseKey === GERMAN_PHASE_IDS.phaseDone || phaseKey === GERMAN_PHASE_IDS.phase1) return;

        const cycleStatus = getGermanPhaseCycleStatus(phaseState, this._difficulty, phaseKey);
        const detailMap = [
            ['offensiveInfantry', 'ofInf'],
            ['offensiveCavalry', 'ofCav'],
            ['defensiveInfantry', 'defInf'],
            ['scout', 'scout'],
            ['ram', 'ram'],
            ['catapult', 'cata'],
            ['expansion', 'exp'],
        ];
        const detail = detailMap
            .filter(([key]) => (cycleStatus.targets?.[key] || 0) > 0)
            .map(([key, label]) => `${label}:${cycleStatus.cycles?.[key] || 0}/${cycleStatus.targets?.[key] || 0}`)
            .join(' | ');

        this.log(
            'info',
            village,
            'Macro Reclutamiento',
            `Ciclos fase actual: ${cycleStatus.completed}/${cycleStatus.max} (${cycleStatus.max > 0 ? ((cycleStatus.completed / cycleStatus.max) * 100).toFixed(1) : '0.0'}%)${detail ? ` | ${detail}` : ''}.`,
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

        for (const [villageId, windowState] of this._commandWindowByVillage.entries()) {
            if (!windowState || !Number.isFinite(windowState.expiresAt) || windowState.expiresAt <= now) {
                this._commandWindowByVillage.delete(villageId);
            }
        }
    }

    _getCommandSender(context = {}) {
        return (commandType, payload) => this._sendCommand(commandType, payload, context);
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

    _resolveLayerPriority(villageId, context = {}) {
        if (context.layerPriority && COMMAND_LAYER_PRIORITY[context.layerPriority]) {
            return context.layerPriority;
        }

        const sourceLayer = context.sourceLayer || 'macro';
        if (sourceLayer === 'reactive') {
            const combatState = villageId ? this.getVillageCombatState(villageId) : null;
            if (!combatState) return 'reactive_low';
            if (combatState.threatLevel === 'critical') return 'reactive_critical';
            if (combatState.threatLevel === 'high') return 'reactive_high';
            return 'reactive_low';
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
            return 'reactive_low';
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

    _isCommandCompatibleWithWindow(villageId, nextCategory, nextPriorityScore, now) {
        const windowState = this._commandWindowByVillage.get(villageId);
        if (!windowState || windowState.expiresAt <= now) return true;

        const sameCategory = windowState.category === nextCategory;
        if (!sameCategory) return true;

        return nextPriorityScore >= windowState.priorityScore;
    }

    _setCommandWindow(villageId, category, priorityScore, layerPriority, sourceLayer) {
        if (!villageId || !category) return;
        const now = Date.now();
        this._commandWindowByVillage.set(villageId, {
            category,
            priorityScore,
            layerPriority,
            sourceLayer,
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
        const now = Date.now();

        if (category === 'movement' && villageId && sourceLayer !== 'reactive' && this._hasPendingDodgeForVillage(villageId)) {
            const village = this._lastKnownGameState?.villages?.find(candidate => candidate.id === villageId) || null;
            this.log('warn', village, 'Arbitraje Central', 'Comando bloqueado: aldea con dodge pendiente.', {
                villageId,
                commandType,
                layerPriority,
                sourceLayer,
            }, 'military');
            return {
                success: false,
                reason: 'AI_ARBITRATION_DODGE_LOCK',
                details: { villageId, commandType, layerPriority, sourceLayer },
            };
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

        if (villageId && !this._isCommandCompatibleWithWindow(villageId, category, priorityScore, now)) {
            const village = this._lastKnownGameState?.villages?.find(candidate => candidate.id === villageId) || null;
            this.log('warn', village, 'Arbitraje Central', 'Comando bloqueado: prioridad inferior en ventana activa.', {
                villageId,
                commandType,
                layerPriority,
                sourceLayer,
                category,
            }, 'military');
            return {
                success: false,
                reason: 'AI_ARBITRATION_PRIORITY_SUPERSEDED',
                details: { villageId, commandType, layerPriority, sourceLayer, category },
            };
        }

        const result = this._sendCommandRaw(commandType, payload);
        if (result?.success && villageId) {
            this._setCommandWindow(villageId, category, priorityScore, layerPriority, sourceLayer);
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
        const sender = this._getCommandSender({ sourceLayer: 'reactive', layerPriority: 'reactive_high' });
        const myVillages = gameState.villages.filter(village => village.ownerId === this._ownerId);

        for (const village of myVillages) {
            const state = this.getVillageCombatState(village.id);
            if (!state || !state.counterWindowOpen) continue;
            if (Number.isFinite(state.counterWindowExpiresAt) && state.counterWindowExpiresAt <= Date.now()) {
                this.upsertVillageCombatState(village.id, {
                    counterWindowOpen: false,
                    counterWindowExpiresAt: null,
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
            });

            if (!result?.success) continue;

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
        }
    }

    _processDodgeTasks(gameState) {
        processDodgeTasks({
            gameState,
            dodgeTasks: this._dodgeTasks,
            dodgeTimeThresholdMs: AI_CONTROLLER_CONSTANTS.dodgeTimeThresholdMs,
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
        this._processCounterWindows(gameState);

        const now = Date.now();
        const myVillages = gameState.villages.filter(v => v.ownerId === this._ownerId);
        if (myVillages.length === 0) return;

        if (!this._isThinkingEconomic && (now - this._lastEconomicDecisionTime >= this._economicDecisionInterval)) {
            this.log('info', null, 'INICIO_CICLO_GESTION', 'Iniciando evaluacion economica y militar.');
            this._isThinkingEconomic = true;
            this._lastEconomicDecisionTime = now;
            try {
                if (this._goalManager) {
                    myVillages.forEach(village => this._goalManager.ensureVillageStateExists(village.id));
                }

                if (this._goalManager) {
                    applyDevelopmentBudgetMode({
                        myVillages,
                        personality: this._personality,
                        log: this.log.bind(this),
                    });
                }

                myVillages.forEach((village, index) => {
                    if (this._race === 'germans') {
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

                    if (this._race === 'egyptians') {
                        const phaseState = this._ensureEgyptianPhaseState(village.id);
                        const result = runEgyptianEconomicPhaseCycle({
                            village,
                            gameState,
                            phaseState,
                            difficulty: this._difficulty,
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
            this._processMilitaryDecision(gameState);
        }
    }

    async _processMilitaryDecision(gameState) {
        this._isThinkingMilitary = true;
        this._lastMilitaryDecisionTime = Date.now();
        
        try {
            const telemetry = runMilitaryDecision({
                gameState,
                ownerId: this._ownerId,
                race: this._race,
                archetype: this._archetype,
                personality: this._personality,
                gameConfig: this._gameConfig,
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
    
    _executeCommands(commands, gameState) {
        executeCommands({
            commands,
            gameState,
            sendCommand: this._getCommandSender({ sourceLayer: 'military', layerPriority: 'reactive_low' }),
            log: this.log.bind(this),
        });
    }
}

export default AIController;
