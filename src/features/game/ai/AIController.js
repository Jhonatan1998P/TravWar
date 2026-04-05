// RUTA: js/ai/AIController.js
import { AIPersonality } from './AIPersonality.js';
import ReputationManager from './ReputationManager.js';
import AIGoalManager from './AIGoalManager.js';
import AIActionExecutor from './AIActionExecutor.js';
import StrategicAI from './StrategicAI.js';
import { gameData } from '../core/GameData.js';
import { CombatFormulas } from '../core/CombatFormulas.js';

const LOG_MILITARY_DECISIONS = true;
const LOG_ECONOMIC_DECISIONS = true;

const REINFORCEMENT_RECALL_DELAY_MS = 10000;
const DODGE_TIME_THRESHOLD_MS = 10000;

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
        const targetVillage = gameState.villages.find(v => v.coords.x === movement.targetCoords.x && v.coords.y === movement.targetCoords.y);
        if (!targetVillage) return;

        const raceUnits = gameData.units[this._race].troops;
        const scoutUnit = raceUnits.find(u => u.type === 'scout');
        const hasScouts = scoutUnit && (targetVillage.unitsInVillage[scoutUnit.id] || 0) > 0;

        const troopsToDodge = {};
        const troopsToKeep = {};

        if (hasScouts) {
            for (const unitId in targetVillage.unitsInVillage) {
                if (raceUnits.find(u => u.id === unitId)?.type === 'scout') {
                    troopsToKeep[unitId] = targetVillage.unitsInVillage[unitId];
                } else {
                    troopsToDodge[unitId] = targetVillage.unitsInVillage[unitId];
                }
            }
            this.log('info', targetVillage, 'Counter-espionage', `Espionage detected. Keeping scouts and dodging other troops.`, { troopsToDodge }, 'military');
        } else {
            Object.assign(troopsToDodge, targetVillage.unitsInVillage);
            this.log('info', targetVillage, 'Counter-espionage', `Espionage detected. No scouts to defend. Dodging all troops.`, null, 'military');
        }

        if (Object.keys(troopsToDodge).length > 0) {
            this._dodgeTasks.set(movement.id, {
                arrivalTime: movement.arrivalTime,
                villageId: targetVillage.id,
                troops: troopsToDodge
            });
        }
    }

    _handleAttackReact(movement, gameState) {
        const targetVillage = gameState.villages.find(v => v.coords.x === movement.targetCoords.x && v.coords.y === movement.targetCoords.y);
        if (!targetVillage) return;

        const attackerRace = gameState.players.find(p => p.id === movement.ownerId)?.race || 'romans';
        const attackerVillage = gameState.villages.find(v => v.id === movement.originVillageId);
        const attackerSmithy = attackerVillage?.smithy.upgrades || {};
        const attackPower = CombatFormulas.calculateAttackPoints(movement.payload.troops, attackerRace, attackerSmithy).total;

        const hasSiege = Object.keys(movement.payload.troops).some(id => gameData.units[attackerRace].troops.find(u => u.id === id)?.role === 'catapult');
        const hasConquest = Object.keys(movement.payload.troops).some(id => gameData.units[attackerRace].troops.find(u => u.id === id)?.role === 'conquest');

        if (hasSiege || hasConquest) {
            if (this._archetype === 'rusher') {
                this.log('warn', targetVillage, 'Siege Reaction (Rusher)', 'Siege attack detected! Launching punitive counter-attack.', movement, 'military');
                const mySiegeUnits = {};
                const raceUnits = gameData.units[this._race].troops;
                const catapult = raceUnits.find(u => u.role === 'catapult');
                const ram = raceUnits.find(u => u.role === 'ram');
                if (catapult) mySiegeUnits[catapult.id] = targetVillage.unitsInVillage[catapult.id] || 0;
                if (ram) mySiegeUnits[ram.id] = targetVillage.unitsInVillage[ram.id] || 0;

                if (Object.values(mySiegeUnits).some(count => count > 0)) {
                    this._sendCommand('send_movement', {
                        originVillageId: targetVillage.id,
                        targetCoords: attackerVillage.coords,
                        troops: mySiegeUnits,
                        missionType: 'attack',
                        catapultTargets: ['warehouse', 'granary']
                    });
                }
            } 
            
            this.log('warn', targetVillage, 'Siege Reaction', 'Siege attack detected! Organizing Swarm Defense.', movement, 'military');
            this._manageReinforcements(targetVillage, attackPower, true, gameState);
            return;
        }

        if (attackPower < targetVillage.population.current) {
            const localDefensePower = CombatFormulas.calculateDefensePoints(
                [{ troops: targetVillage.unitsInVillage, race: this._race, smithyUpgrades: targetVillage.smithy.upgrades }],
                { infantry: 0.5, cavalry: 0.5 }, this._race, targetVillage.buildings.find(b => b.type === 'cityWall')?.level || 0, 0
            );
            if (localDefensePower > attackPower) {
                this.log('info', targetVillage, 'Local Defense', `Weak attack (${attackPower.toFixed(0)}) vs Local defense (${localDefensePower.toFixed(0)}). Holding position.`, null, 'military');
            } else {
                this.log('warn', targetVillage, 'Tactical Evasion', `Weak attack (${attackPower.toFixed(0)}) but stronger than local defense (${localDefensePower.toFixed(0)}). Evading.`, null, 'military');
                this._dodgeTasks.set(movement.id, { arrivalTime: movement.arrivalTime, villageId: targetVillage.id, troops: targetVillage.unitsInVillage });
            }
            return;
        }

        if (this._archetype === 'rusher') {
            this.log('info', targetVillage, 'Reaction (Rusher)', 'Rusher archetype: Evading attack to preserve offensive force.', null, 'military');
            this._dodgeTasks.set(movement.id, { arrivalTime: movement.arrivalTime, villageId: targetVillage.id, troops: targetVillage.unitsInVillage });
        } else {
            this.log('info', targetVillage, 'Reaction (Defensive)', 'Boomer/Turtle archetype: Organizing Swarm Defense.', null, 'military');
            this._manageReinforcements(targetVillage, attackPower, false, gameState);
        }
    }

    _manageReinforcements(targetVillage, attackPower, ignoreTravelTime, gameState) {
        const raceUnits = gameData.units[this._race].troops;
        
        const getDefensiveTroops = (units) => {
            const defensive = {};
            for (const unitId in units) {
                if (raceUnits.find(u => u.id === unitId)?.role.includes('defensive')) {
                    defensive[unitId] = units[unitId];
                }
            }
            return defensive;
        };

        const wallLevel = targetVillage.buildings.find(b => b.type === 'cityWall')?.level || 0;
        
        const localDefensePower = CombatFormulas.calculateDefensePoints(
            [{ troops: getDefensiveTroops(targetVillage.unitsInVillage), race: this._race, smithyUpgrades: targetVillage.smithy.upgrades }],
            { infantry: 0.5, cavalry: 0.5 }, this._race, wallLevel, 0
        );

        const neededPower = attackPower * 1.1;
        const deficit = neededPower - localDefensePower;

        if (deficit <= 0) {
            this.log('info', targetVillage, 'Defensa Coordinada', 'La defensa local es suficiente.', null, 'military');
            return;
        }

        const myOtherVillages = gameState.villages.filter(v => v.ownerId === this._ownerId && v.id !== targetVillage.id);
        const potentialReinforcements = [];

        for (const village of myOtherVillages) {
            const defensiveTroops = getDefensiveTroops(village.unitsInVillage);
            if (Object.keys(defensiveTroops).length === 0) continue;

            const slowestSpeed = this._getSlowestUnitSpeed(defensiveTroops);
            const travelTime = this._calculateTravelTime(village.coords, targetVillage.coords, slowestSpeed);
            
            if (ignoreTravelTime || (Date.now() + travelTime < (targetVillage.arrivalTime || Date.now() + 999999))) {
                const power = CombatFormulas.calculateDefensePoints(
                    [{ troops: defensiveTroops, race: village.race, smithyUpgrades: village.smithy.upgrades }],
                    { infantry: 0.5, cavalry: 0.5 }, village.race, wallLevel, 0 
                );
                
                potentialReinforcements.push({ 
                    village, 
                    troops: defensiveTroops, 
                    power, 
                    travelTime 
                });
            }
        }

        potentialReinforcements.sort((a, b) => a.travelTime - b.travelTime);

        let accumulatedPower = 0;
        const reinforcementsToSend = [];

        for (const reinf of potentialReinforcements) {
            if (accumulatedPower >= deficit) break;
            
            reinforcementsToSend.push(reinf);
            accumulatedPower += reinf.power;
        }

        const totalProjectedDefense = localDefensePower + accumulatedPower;

        if (totalProjectedDefense >= attackPower) {
            this.log('success', targetVillage, 'Defensa Coordinada', `Enjambre activado. ${reinforcementsToSend.length} aldeas enviando ayuda. Poder Total: ${totalProjectedDefense.toFixed(0)} vs Ataque: ${attackPower.toFixed(0)}`, null, 'military');
            
            reinforcementsToSend.forEach(({ village, troops }) => {
                this._sendCommand('send_movement', {
                    originVillageId: village.id,
                    targetCoords: targetVillage.coords,
                    troops: troops,
                    missionType: 'reinforcement'
                });
            });
        } else {
            this.log('warn', targetVillage, 'Defensa Coordinada Fallida', `Ni con todo el imperio (${totalProjectedDefense.toFixed(0)}) podemos parar el ataque (${attackPower.toFixed(0)}). Iniciando evacuación.`, null, 'military');
            this._dodgeTasks.set(targetVillage.id + Date.now(), { arrivalTime: targetVillage.arrivalTime, villageId: targetVillage.id, troops: targetVillage.unitsInVillage });
        }
    }

    _executeDodge(village, troopsToDodge, gameState) {
        if (Object.keys(troopsToDodge).length === 0) {
            this.log('info', village, 'Dodge Maneuver Skipped', 'No troops specified to dodge.', null, 'military');
            return;
        }

        const nearbyOases = gameState.mapData.filter(tile =>
            tile.type === 'oasis' && Math.hypot(tile.x - village.coords.x, tile.y - village.coords.y) <= 10
        );

        if (nearbyOases.length > 0) {
            const targetOasis = nearbyOases[Math.floor(Math.random() * nearbyOases.length)];
            this._sendCommand('send_movement', {
                originVillageId: village.id,
                targetCoords: { x: targetOasis.x, y: targetOasis.y },
                troops: troopsToDodge,
                missionType: 'raid'
            });
            this.log('success', village, 'Dodge Maneuver', `Troops sent to raid oasis at (${targetOasis.x}|${targetOasis.y}) to avoid combat.`, { troops: troopsToDodge }, 'military');
        } else {
            this.log('fail', village, 'Dodge Maneuver', 'No nearby oases found to dodge troops.', null, 'military');
        }
    }

    _processDodgeTasks(gameState) {
        if (this._dodgeTasks.size === 0) return;
        const now = Date.now();
        for (const [movementId, task] of this._dodgeTasks.entries()) {
            if (task.arrivalTime - now < DODGE_TIME_THRESHOLD_MS) {
                const village = gameState.villages.find(v => v.id === task.villageId);
                if (village) {
                    this.log('warn', village, 'Executing Dodge', `Imminent hostile movement (${((task.arrivalTime - now) / 1000).toFixed(1)}s). Dodging troops.`, task.troops, 'military');
                    this._executeDodge(village, task.troops, gameState);
                }
                this._dodgeTasks.delete(movementId);
            }
        }
    }

    _processReinforcementRecalls(gameState) {
        const now = Date.now();
        const activeTasks = [];
        for (const task of this._reinforcementTasks) {
            if (now >= task.expiryTime) {
                this.log('info', null, 'Reinforcement Recall', 'Initiating recall of reinforcement troops post-battle.', task, 'military');
                for (const reinf of task.reinforcements) {
                    const reinforcedVillage = gameState.villages.find(v => v.id === reinf.to);
                    if (!reinforcedVillage) continue;

                    const reinforcementData = reinforcedVillage.reinforcements.find(r => r.fromVillageId === reinf.from);
                    if (reinforcementData && Object.keys(reinforcementData.troops).length > 0) {
                        const originVillage = gameState.villages.find(v => v.id === reinf.from);
                        if (originVillage) {
                            this._sendCommand('send_movement', {
                                originVillageId: reinforcedVillage.id,
                                targetCoords: originVillage.coords,
                                troops: reinforcementData.troops,
                                missionType: 'reinforcement'
                            });
                        }
                    }
                }
            } else {
                activeTasks.push(task);
            }
        }
        this._reinforcementTasks = activeTasks;
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
                
                // LÓGICA DE MODO DESARROLLO (CAPITAL < NIVEL 3)
                // Solo aplicamos esto a la primera aldea (Capital)
                if (myVillages.length > 0) {
                    const capital = myVillages[0];
                    const resourceTypes = ['woodcutter', 'clayPit', 'ironMine', 'cropland'];
                    
                    // Obtener campos de recursos
                    const fields = capital.buildings.filter(b => resourceTypes.includes(b.type));
                    
                    // Verificar si todos son >= 3
                    // Nota: Si no hay campos (ej. error de init), asumimos que no cumple.
                    const allLevel3 = fields.length > 0 && fields.every(f => f.level >= 3);
                    
                    if (!allLevel3) {
                        // MODO DESARROLLO: 100% Economía
                        if (!capital.budgetRatio || capital.budgetRatio.econ !== 1.0) {
                            this.log('info', capital, 'Ajuste Estratégico', 'Modo Desarrollo Activado: Priorizando economía (100%) hasta alcanzar nivel 3 en recursos.');
                            capital.budgetRatio = { econ: 1.0, mil: 0.0 };
                        }
                    } else {
                        // MODO NORMAL: Restaurar personalidad
                        // Verificamos si necesitamos restaurar para no sobrescribir innecesariamente
                        const defaultRatio = this._personality.buildRatio || { econ: 0.5, mil: 0.5 };
                        if (capital.budgetRatio && capital.budgetRatio.econ === 1.0 && defaultRatio.econ !== 1.0) {
                            this.log('info', capital, 'Ajuste Estratégico', 'Modo Desarrollo Completado: Restaurando balance económico/militar estándar.');
                            capital.budgetRatio = { ...defaultRatio };
                        }
                    }
                }

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

    _getTroopSchemaForRace(race) {
        const raceTroops = gameData.units[race]?.troops;
        if (!raceTroops) {
            return [];
        }
        return raceTroops.map(troop => ({
            id: troop.id,
            role: troop.role || 'unknown'
        }));
    }

    async _processMilitaryDecision(gameState) {
        this.log('info', null, 'INICIO_CICLO_MILITAR', `Evaluating military actions (Deterministic).`);
        
        this._isThinkingMilitary = true;
        this._lastMilitaryDecisionTime = Date.now();
        
        try {
            const aiPlayerState = gameState.players.find(p => p.id === this._ownerId);
            if (!aiPlayerState) return;

            if (aiPlayerState.isUnderProtection) {
                this.log('info', null, 'Ciclo Militar Omitido', 'AI is under beginner protection.', null, 'military');
                return;
            }

            const myVillages = gameState.villages.filter(v => v.ownerId === this._ownerId);
            const totalPopulation = myVillages.reduce((sum, v) => sum + v.population.current, 0);
            
            const raceTroops = gameData.units[this._race]?.troops || [];
            const nonCombatRoles = new Set(['conquest', 'colonization', 'scout']);
            
            let combatTroopCount = 0;
            myVillages.forEach(v => {
                for (const unitId in v.unitsInVillage) {
                    const unitData = raceTroops.find(t => t.id === unitId);
                    if (unitData && !nonCombatRoles.has(unitData.role)) {
                        combatTroopCount += v.unitsInVillage[unitId];
                    }
                }
            });

            const requiredTroops = totalPopulation * 0.15; 
            if (combatTroopCount < requiredTroops) {
                this.log('warn', null, 'Ciclo Militar Omitido', `Gathering forces. Combat troops (${combatTroopCount}) are below the required threshold (${requiredTroops.toFixed(0)}).`, null, 'military');
                return;
            }

            this.log('info', null, 'Strategic AI', 'Computing utility scores for potential targets...', null, 'military');
            
            // PASO DE LA CONFIGURACION DE JUEGO
            const gameSpeed = this._gameConfig.gameSpeed || 1;

            const response = this._strategicAI.computeMilitaryTurn(
                gameState, 
                this._ownerId, 
                this._race, 
                this._archetype, 
                this._personality,
                gameSpeed // <-- NUEVO ARGUMENTO
            );
            
            if (response.razonamiento) {
                this.log('goal', null, 'Razonamiento Estratégico', 'The General has issued the following analysis:', response.razonamiento, 'military');
            }
            
            if (response.comandos && response.comandos.length > 0) {
                this.log('success', null, 'Órdenes Recibidas', `Executing ${response.comandos.length} military commands.`, response.comandos, 'military');
                this._executeCommands(response.comandos, gameState);
            } else {
                this.log('info', null, 'Sin Comandos', 'The AI General issued no commands this cycle.', null, 'military');
            }
        } catch (error) {
            this.log('error', null, 'Error en Ciclo Militar', 'Error in military decision logic', error.message + '\n' + error.stack, 'military');
        } finally {
            this._isThinkingMilitary = false;
        }
    }
    
    _executeCommands(commands, gameState) {
        for (const cmd of commands) {
            const { comando, villageId, parametros } = cmd;
            const village = gameState.villages.find(v => v.id === villageId);
            if (!village) {
                this.log('warn', null, 'Comando Inválido', `Origin village ${villageId} not found.`, cmd, 'military');
                continue;
            }
            
            switch (comando) {
                case 'ATTACK':
                case 'SPY':
                case 'REINFORCE': {
                    if (!parametros.tropas || Object.keys(parametros.tropas).length === 0 || Object.values(parametros.tropas).every(qty => qty <= 0)) {
                        this.log('warn', village, 'Comando Inválido', `Attempted ${comando} with 0 troops.`, cmd, 'military');
                        continue;
                    }
                    let missionType;
                    if (comando === 'SPY') {
                        missionType = 'espionage';
                    } else if (comando === 'REINFORCE') {
                        missionType = 'reinforcement';
                    } else {
                        missionType = parametros.mision;
                    }

                    const result = this._sendCommand('send_movement', { 
                        originVillageId: villageId, 
                        targetCoords: parametros.targetCoords, 
                        troops: parametros.tropas, 
                        missionType 
                    });
                    
                    if(result.success) {
                        this.log('success', village, 'Comando Enviado', `${comando} order sent successfully.`, parametros, 'military');
                    } else {
                        this.log('fail', village, 'Comando Fallido', `Worker rejected the ${comando} order. Reason: ${result.reason}`, result.details, 'military');
                    }
                    break;
                }
            }
        }
    }

    _getSlowestUnitSpeed(troops) {
        let slowestSpeed = Infinity;
        for (const unitId in troops) {
            if (troops[unitId] > 0) {
                const unitData = gameData.units[this._race].troops.find(u => u.id === unitId);
                if (unitData && unitData.stats.speed < slowestSpeed) {
                    slowestSpeed = unitData.stats.speed;
                }
            }
        }
        return slowestSpeed === Infinity ? 0 : slowestSpeed;
    }

    _calculateTravelTime(originCoords, targetCoords, slowestSpeed) {
        if (slowestSpeed <= 0) return Infinity;
        const distance = Math.hypot(targetCoords.x - originCoords.x, targetCoords.y - originCoords.y);
        return ((distance / (slowestSpeed * this._gameConfig.troopSpeed)) * 3600) * 1000;
    }
}

export default AIController;