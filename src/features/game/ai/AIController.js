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
        this._militaryDecisionInterval = Math.max(30000, calculatedInterval);
        
        this._actionExecutor = new AIActionExecutor(this);
        this._goalManager = new AIGoalManager(this, this._actionExecutor);
    }

    getDecisionLog() {
        return "Strategic AI (Deterministic) active. Check console logs for reasoning.";
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
    }
    
    getState() {
        const goalState = this._goalManager.getState();
        return {
            goalState: goalState,
            lastEconomicDecisionTime: this._lastEconomicDecisionTime,
            lastMilitaryDecisionTime: this._lastMilitaryDecisionTime,
            reinforcementTasks: this._reinforcementTasks,
            dodgeTasks: Array.from(this._dodgeTasks.entries())
        };
    }

    handleReactiveEvent(eventType, movement, gameState) {
        if (eventType !== 'movement_dispatched') return;

        this.log('warn', null, 'Evento Reactivo', `Detectado movimiento hostil inminente: '${movement.type}'.`, movement, 'military');
        
        if (movement.type === 'espionage') {
            this._handleEspionageReact(movement, gameState);
        } else if (movement.type === 'attack' || movement.type === 'raid') {
            this._handleAttackReact(movement, gameState);
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
            runMilitaryDecision({
                gameState,
                ownerId: this._ownerId,
                race: this._race,
                archetype: this._archetype,
                personality: this._personality,
                gameConfig: this._gameConfig,
                strategicAI: this._strategicAI,
                executeCommands: this._executeCommands.bind(this),
                log: this.log.bind(this),
            });
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
