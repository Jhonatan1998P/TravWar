// RUTA: js/ai/AIController.js
import ReputationManager from './ReputationManager.js';
import AIGoalManager from './AIGoalManager.js';
import AIActionExecutor from './AIActionExecutor.js';
import StrategicAI from './StrategicAI.js';
import { AI_CONTROLLER_CONSTANTS } from './config/AIConstants.js';
import { applyDevelopmentBudgetMode } from './controller/economic.js';
import { executeCommands } from './controller/commands.js';
import { handleAttackReact, handleEspionageReact, processDodgeTasks, processReinforcementRecalls } from './controller/reactive.js';
import { runMilitaryDecision } from './controller/military.js';

class AIController {
    _ownerId;
    _personality;
    _race;
    _archetype;
    _sendCommand;
    _gameConfig;

    _isThinkingEconomic = false;
    _isThinkingMilitary = false;
    _lastEconomicDecisionTime = 0;
    _lastMilitaryDecisionTime = 0;
    _militaryDecisionInterval;
    
    _reputationManager;
    _goalManager;
    _actionExecutor;
    _strategicAI;
    _reinforcementTasks = [];
    _dodgeTasks = new Map();
    _oasisTelemetry = {
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

    constructor(ownerId, personality, race, archetype, sendCommandCallback, gameConfig) {
        this._ownerId = ownerId;
        this._personality = personality;
        this._race = race;
        this._archetype = archetype;
        this._sendCommand = sendCommandCallback;
        this._gameConfig = gameConfig;

        this._strategicAI = new StrategicAI();
        
        const baseInterval = this._personality.baseMilitaryInterval
        const calculatedInterval = baseInterval / (this._gameConfig.gameSpeed || 1);
        this._militaryDecisionInterval = Math.max(30000, Math.min(calculatedInterval, 300000));
        
        this._actionExecutor = new AIActionExecutor(this);
        this._goalManager = new AIGoalManager(this, this._actionExecutor);
    }

    getDecisionLog() {
        const state = this.getState();
        const goalInfo = state.goalState || {};
        const villageCount = Object.keys(goalInfo).length;
        const totalEconGoals = Object.values(goalInfo).reduce((sum, v) => sum + (v.economicGoalStack?.length || 0), 0);
        const totalMilGoals = Object.values(goalInfo).reduce((sum, v) => sum + (v.militaryGoalStack?.length || 0), 0);
        const dodgeTaskCount = state.dodgeTasks?.length || 0;
        const reinforcementTaskCount = state.reinforcementTasks?.length || 0;
        const oasisTelemetry = state.oasisTelemetry || this._oasisTelemetry;

        return [
            `=== AI Decision Log: ${this._ownerId} ===`,
            `Race: ${this._race} | Archetype: ${this._archetype}`,
            `Personality: Pesadilla`,
            `Villages managed: ${villageCount}`,
            `Active economic goals: ${totalEconGoals}`,
            `Active military goals: ${totalMilGoals}`,
            `Pending dodge tasks: ${dodgeTaskCount}`,
            `Pending reinforcement recalls: ${reinforcementTaskCount}`,
            `Oasis telemetry: decisions=${oasisTelemetry.decisions}, eval=${oasisTelemetry.evaluatedOases}, atk=${oasisTelemetry.attacksIssued}, atk<=0=${oasisTelemetry.attacksIssuedNonPositive}`,
            `Oasis KPIs: avgNet=${Math.round(oasisTelemetry.avgRewardNet || 0)}, loss/gross=${(oasisTelemetry.avgLossToGross || 0).toFixed(2)}, unique=${oasisTelemetry.uniqueOasesAttacked}, skipNoProfit=${oasisTelemetry.skippedCyclesNoProfitable}`,
            `Last economic decision: ${new Date(this._lastEconomicDecisionTime).toISOString()}`,
            `Last military decision: ${new Date(this._lastMilitaryDecisionTime).toISOString()}`,
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
        const STYLES = { info: 'color: #6c757d;', success: 'color: #28a745; font-weight: bold;', fail: 'color: #dc3545;', warn: 'color: #ffc107;', goal: 'color: #6f42c1; font-weight: bold;', error: 'color: #E91E63; font-weight: bold;' };
        
        const villageName = village ? `[${village.name}]` : '[Global]';
        console.log(`%c${ICONS[level] || ''} [IA ${this._ownerId}] ${villageName} [${action}] :: ${message}`, STYLES[level] || '');
        
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
    getPersonality() { return this._personality; }
    getGameConfig() { return this._gameConfig; }
    getSendCommand() { return this._sendCommand; }
    getActionExecutor() { return this._actionExecutor; }
    getGoalManager() { return this._goalManager; }

    init(gameState, aiPlayerState) {
        this._reputationManager = new ReputationManager(gameState.diplomacy);
        
        const goalState = aiPlayerState.goalState || {};
        this._goalManager.init(gameState, goalState);
        
        this._actionExecutor.init(this._reputationManager);
        
        const now = Date.now();
        this._lastEconomicDecisionTime = aiPlayerState.lastEconomicDecisionTime || now;
        this._lastMilitaryDecisionTime = aiPlayerState.lastMilitaryDecisionTime || now;
        this._reinforcementTasks = aiPlayerState.reinforcementTasks || [];
        this._dodgeTasks = new Map(aiPlayerState.dodgeTasks || []);
        this._oasisTelemetry = aiPlayerState.oasisTelemetry || this._oasisTelemetry;
    }
    
    getState() {
        const goalState = this._goalManager.getState();
        return {
            goalState: goalState,
            lastEconomicDecisionTime: this._lastEconomicDecisionTime,
            lastMilitaryDecisionTime: this._lastMilitaryDecisionTime,
            reinforcementTasks: this._reinforcementTasks,
            dodgeTasks: Array.from(this._dodgeTasks.entries()),
            oasisTelemetry: this._oasisTelemetry,
        };
    }

    _updateOasisTelemetry(cycleTelemetry) {
        if (!cycleTelemetry) return;

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

    handleReactiveEvent(eventType, data, gameState) {
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
            sendCommand: this._sendCommand,
            log: this.log.bind(this),
        });
    }

    _processDodgeTasks(gameState) {
        processDodgeTasks({
            gameState,
            dodgeTasks: this._dodgeTasks,
            dodgeTimeThresholdMs: AI_CONTROLLER_CONSTANTS.dodgeTimeThresholdMs,
            sendCommand: this._sendCommand,
            log: this.log.bind(this),
        });
    }

    _processReinforcementRecalls(gameState) {
        this._reinforcementTasks = processReinforcementRecalls({
            gameState,
            reinforcementTasks: this._reinforcementTasks,
            sendCommand: this._sendCommand,
            log: this.log.bind(this),
        });
    }

    makeDecision(gameState) {
        this._processReinforcementRecalls(gameState);
        this._processDodgeTasks(gameState);

        const now = Date.now();
        const myVillages = gameState.villages.filter(v => v.ownerId === this._ownerId);
        if (myVillages.length === 0) return;

        if (!this._isThinkingEconomic && (now - this._lastEconomicDecisionTime >= this._personality.decisionInterval)) {
            this.log('info', null, 'INICIO_CICLO_GESTION', 'Evaluating economic & military strategic actions...');
            this._isThinkingEconomic = true;
            this._lastEconomicDecisionTime = now;
            try {
                myVillages.forEach(village => this._goalManager.ensureVillageStateExists(village.id));

                applyDevelopmentBudgetMode({
                    myVillages,
                    personality: this._personality,
                    log: this.log.bind(this),
                });

                myVillages.forEach((village, index) => {
                    this._goalManager.processVillageState(village, index, gameState);
                });
            } catch (error) {
                this.log('error', null, 'Ciclo de Gestión', 'Error in strategic logic', error);
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

            if (telemetry?.oasisFarming) {
                this._updateOasisTelemetry(telemetry.oasisFarming);
            }
        } catch (error) {
            this.log('error', null, 'Error en Ciclo Militar', 'Error in military decision logic', error.message + '\n' + error.stack, 'military');
        } finally {
            this._isThinkingMilitary = false;
        }
    }
    
    _executeCommands(commands, gameState) {
        executeCommands({
            commands,
            gameState,
            sendCommand: this._sendCommand,
            log: this.log.bind(this),
        });
    }
}

export default AIController;
