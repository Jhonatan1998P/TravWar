// RUTA: js/ai/StrategicAI.js
import { gameData } from '../core/GameData.js';
import { CombatFormulas } from '../core/CombatFormulas.js';
import { AI_STRATEGY_CONSTANTS } from './config/AIConstants.js';
import {
    consumeForceTroops,
    extractSiegeTroops,
    filterNonCombatTroopsInPlace,
} from './utils/AIUnitUtils.js';
import { calculateDeployedTroops, mergeTroops } from './utils/AITroopUtils.js';
import { performOptimizedFarming } from './strategy/farming.js';
import { updateFarmList, runFarmListCycle } from './strategy/farmlist.js';
import { manageNemesis } from './strategy/nemesis.js';
import { planSiegeTrain } from './strategy/siege.js';
import { dispatchSpies, performGeneralIntelligence, scanAndClassifyTargets } from './strategy/scouting.js';

const { searchRadius, scoutsPerMission, minCatsForTrain, maxWaves } = AI_STRATEGY_CONSTANTS;
const MAX_PRIORITY_GOAL = 'MAX_PRIORITY_GOAL';
const STRATEGIC_ATTACK_GATE_CONFIG = Object.freeze({
    baseProbability: 0.10,
    maxProbability: 0.40,
    noAttackBonusPerCycle: 0.015,
    noAttackBonusMaxCycles: 12,
    nemesisBonus: 0.08,
    highValueBonus: 0.05,
    baseCooldownMs: 60 * 60 * 1000,
    minCooldownAt500Ms: 10 * 60 * 1000,
    minCooldownAt5000Ms: 5 * 60 * 1000,
});

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function getStrategicAttackCooldownMs(gameSpeed = 1) {
    const speed = Math.max(1, Number(gameSpeed) || 1);
    const scaled = Math.floor(STRATEGIC_ATTACK_GATE_CONFIG.baseCooldownMs / speed);

    if (speed >= 5000) {
        return Math.max(STRATEGIC_ATTACK_GATE_CONFIG.minCooldownAt5000Ms, scaled);
    }
    if (speed >= 500) {
        return Math.max(STRATEGIC_ATTACK_GATE_CONFIG.minCooldownAt500Ms, scaled);
    }
    return Math.max(1000, scaled);
}

function ensureStrategicAttackGateState(aiState) {
    if (!aiState.strategicAttackGate || typeof aiState.strategicAttackGate !== 'object') {
        aiState.strategicAttackGate = {
            cyclesWithoutAttack: 0,
            lastAttackAt: null,
            lastProbability: STRATEGIC_ATTACK_GATE_CONFIG.baseProbability,
            lastRoll: null,
            lastDecisionReason: 'initialized',
            lastCooldownMs: STRATEGIC_ATTACK_GATE_CONFIG.baseCooldownMs,
        };
    }

    return aiState.strategicAttackGate;
}

export default class StrategicAI {
    constructor() {}

    computeMilitaryTurn(gameState, ownerId, race, archetype, personality, gameSpeed = 1, troopSpeed = 1, intelligenceContext = {}) {
        const myVillages = gameState.villages.filter(v => v.ownerId === ownerId);
        const commands = [];
        const reasoningLog = [];

        const baitingPlayers = intelligenceContext.baitingPlayers || [];
        const reputationData = intelligenceContext.reputationData || {};
        const combatContractByVillage = intelligenceContext.combatContractByVillage || {};

        if (baitingPlayers.length > 0) {
            reasoningLog.push(`[INTEL] Jugadores sospechosos de emboscada: ${baitingPlayers.join(', ')}. Evitando ataques directos.`);
        }

        const NEMESIS_SPY_INTERVAL = Math.max(5 * 60 * 1000, (24 * 60 * 60 * 1000) / gameSpeed);
        const GENERAL_SPY_INTERVAL = Math.max(10 * 60 * 1000, (48 * 60 * 60 * 1000) / gameSpeed);

        if (!personality) personality = { aggressionThreshold: 0 };

        const aiState = gameState.aiState[ownerId] || {};
        if (!gameState.aiState[ownerId]) gameState.aiState[ownerId] = aiState;
        const strategicAttackGateState = ensureStrategicAttackGateState(aiState);

        let strategicAttackGateDecision = null;
        const evaluateStrategicAttackGate = ({ hasNemesisOpportunity = false, hasHighValueOpportunity = false } = {}) => {
            if (strategicAttackGateDecision) return strategicAttackGateDecision;

            const now = Date.now();
            const cooldownMs = getStrategicAttackCooldownMs(gameSpeed);
            strategicAttackGateState.lastCooldownMs = cooldownMs;

            if (Number.isFinite(strategicAttackGateState.lastAttackAt)) {
                const elapsed = now - strategicAttackGateState.lastAttackAt;
                if (elapsed < cooldownMs) {
                    strategicAttackGateDecision = {
                        allowed: false,
                        reason: 'cooldown_active',
                        probability: strategicAttackGateState.lastProbability || STRATEGIC_ATTACK_GATE_CONFIG.baseProbability,
                        roll: null,
                        cooldownRemainingMs: cooldownMs - elapsed,
                        cooldownMs,
                    };
                    strategicAttackGateState.lastDecisionReason = 'cooldown_active';
                    return strategicAttackGateDecision;
                }
            }

            const bonusCycles = Math.min(
                STRATEGIC_ATTACK_GATE_CONFIG.noAttackBonusMaxCycles,
                Math.max(0, Number(strategicAttackGateState.cyclesWithoutAttack) || 0),
            );

            let probability = STRATEGIC_ATTACK_GATE_CONFIG.baseProbability
                + (bonusCycles * STRATEGIC_ATTACK_GATE_CONFIG.noAttackBonusPerCycle);

            if (hasNemesisOpportunity) probability += STRATEGIC_ATTACK_GATE_CONFIG.nemesisBonus;
            if (hasHighValueOpportunity) probability += STRATEGIC_ATTACK_GATE_CONFIG.highValueBonus;

            probability = Math.min(STRATEGIC_ATTACK_GATE_CONFIG.maxProbability, clamp01(probability));
            const roll = Math.random();
            const allowed = roll <= probability;

            strategicAttackGateState.lastProbability = probability;
            strategicAttackGateState.lastRoll = roll;
            strategicAttackGateState.lastDecisionReason = allowed ? 'probability_pass' : 'probability_blocked';
            if (!allowed) {
                strategicAttackGateState.cyclesWithoutAttack = Math.max(0, (strategicAttackGateState.cyclesWithoutAttack || 0) + 1);
            }

            strategicAttackGateDecision = {
                allowed,
                reason: allowed ? 'probability_pass' : 'probability_blocked',
                probability,
                roll,
                cooldownRemainingMs: 0,
                cooldownMs,
            };

            return strategicAttackGateDecision;
        };

        const markStrategicAttackCommitted = () => {
            strategicAttackGateState.lastAttackAt = Date.now();
            strategicAttackGateState.cyclesWithoutAttack = 0;
            strategicAttackGateState.lastDecisionReason = 'attack_committed';
        };

        reasoningLog.push(`=== DOCTRINA DE GUERRA PROFESIONAL (${archetype.toUpperCase()}) ===`);

        const availableForces = [];
        myVillages.forEach(village => {
            const troopsAtHome = { ...village.unitsInVillage };
            const troopsDeployed = this._calculateDeployedTroops(village.id, gameState);
            const totalTroops = this._mergeTroops(troopsAtHome, troopsDeployed);

            const scoutUnitData = this._findUnitDataByType(race, 'scout');
            const scoutId = scoutUnitData ? scoutUnitData.id : null;

            const scoutCountAtHome = scoutId && troopsAtHome[scoutId] ? troopsAtHome[scoutId] : 0;
            const totalScoutCount = scoutId && totalTroops[scoutId] ? totalTroops[scoutId] : 0;

            const combatTroopsAtHome = { ...troopsAtHome };
            this._filterNonCombatTroops(combatTroopsAtHome, race);

            const totalCombatTroops = { ...totalTroops };
            this._filterNonCombatTroops(totalCombatTroops, race);

            const combatContract = this._resolveVillageCombatContract(village.id, combatContractByVillage);
            const freeCombatTroops = this._subtractTroops(combatTroopsAtHome, combatContract.reservedTroops || {});
            const reservedCombatTroops = this._subtractTroops(combatTroopsAtHome, freeCombatTroops);
            const siegeTroopsAtHome = this._extractSiegeTroops(freeCombatTroops, race);
            const reservedScoutCount = scoutId ? Math.max(0, Number(combatContract.reservedTroops?.[scoutId] || 0)) : 0;
            const scoutCountFree = Math.max(0, scoutCountAtHome - reservedScoutCount);
            const offenseGate = this._resolveVillageOffenseGate(combatContract);

            const powerAtHome = CombatFormulas.calculateAttackPoints(combatTroopsAtHome, race, village.smithy.upgrades).total;
            const freePowerAtHome = CombatFormulas.calculateAttackPoints(freeCombatTroops, race, village.smithy.upgrades).total;
            const totalPower = CombatFormulas.calculateAttackPoints(totalCombatTroops, race, village.smithy.upgrades).total;
            const isArmyBusy = powerAtHome < totalPower * 0.8;

            if (freePowerAtHome > 0 || scoutCountFree > 0) {
                availableForces.push({
                    village,
                    troops: troopsAtHome,
                    totalTroops,
                    combatTroops: freeCombatTroops,
                    siegeTroops: siegeTroopsAtHome,
                    scoutCount: scoutCountFree,
                    scoutId,
                    power: freePowerAtHome,
                    totalPower,
                    isArmyBusy,
                    needs: this._analyzeVillageNeeds(village),
                    combatContract,
                    reservedCombatTroops,
                    offenseBlocked: offenseGate.blocked,
                    offenseBlockedReasons: offenseGate.reasons,
                });
            }
        });

        if (availableForces.length === 0) {
            return {
                razonamiento: `${reasoningLog.join('\n')}\n[ESTADO] Imperio sin fuerzas militares.`,
                comandos: [],
            };
        }

        const offensiveReadyForces = availableForces.filter(force => !force.offenseBlocked);
        const blockedForces = availableForces.filter(force => force.offenseBlocked);
        if (blockedForces.length > 0) {
            blockedForces.forEach(force => {
                reasoningLog.push(
                    `[GATE-REACTIVE] ${force.village.name} (${force.village.id}) bloqueada para ofensiva: ${force.offenseBlockedReasons.join(', ')}.`
                );
            });
        }

        if (offensiveReadyForces.length === 0) {
            reasoningLog.push('[GATE-REACTIVE] Sin aldeas ofensivas disponibles. Se cancela ciclo ofensivo por riesgo defensivo.');
            return {
                razonamiento: reasoningLog.join('\n'),
                comandos: [],
                telemetry: {
                    militaryGate: {
                        hasMaxPriorityGoal: false,
                        isMusteringForWar: false,
                        farmEvaluationExecuted: false,
                        farmBlockedByMaxPriorityGoal: false,
                        offensiveSuppressedByReactive: true,
                        blockedVillagesCount: blockedForces.length,
                        offensiveReadyVillages: 0,
                    },
                },
            };
        }

        const priorityIntelTargetIds = this._collectPriorityIntelTargetIds(combatContractByVillage);
        if (priorityIntelTargetIds.length > 0) {
            reasoningLog.push(`[INTEL] Re-scout reactivo prioritario activado para ${priorityIntelTargetIds.length} atacante(s) reciente(s).`);
        }

        const nemesisId = this._manageNemesis(gameState, ownerId, aiState, reasoningLog);

        const targets = this._scanAndClassifyTargets(
            gameState,
            offensiveReadyForces,
            ownerId,
            race,
            gameSpeed,
            nemesisId,
            reasoningLog,
            priorityIntelTargetIds,
            NEMESIS_SPY_INTERVAL,
            GENERAL_SPY_INTERVAL,
        );

        updateFarmList(aiState, targets.known, ownerId, myVillages);

        let isMusteringForWar = false;
        let hasMaxPriorityGoal = false;
        let oasisFarmingTelemetry = null;
        let strategicAttackIssued = false;

        if (nemesisId) {
            const nemesisTarget = targets.known.find(t => t.ownerId === nemesisId) || targets.unknown.find(t => t.ownerId === nemesisId);

            if (nemesisTarget) {
                const hasActiveAttack = this._hasActiveAttack(gameState, nemesisTarget.id, ownerId);

                if (!hasActiveAttack) {
                    if (nemesisTarget.spyStatus === 'stale' || nemesisTarget.spyStatus === 'failed') {
                        const spyCmd = this._dispatchSpies(
                            offensiveReadyForces,
                            nemesisTarget,
                            scoutsPerMission,
                            reasoningLog,
                            'Intel Némesis',
                            nemesisTarget.spyStatus === 'failed',
                            nemesisTarget.lastSpyCount,
                            {
                                retryMultiplier: race === 'germans' || race === 'huns' ? 3 : 2,
                            },
                        );
                        if (spyCmd) commands.push(spyCmd);
                    } else if (nemesisTarget.intel) {
                        const estimatedDefense = this._calculateEstimatedDefense(nemesisTarget);
                        const requiredPower = estimatedDefense * 1.2;
                        const bestForce = this._getBestForce(offensiveReadyForces);

                        if (bestForce) {
                            if (bestForce.totalPower > requiredPower) {
                                if (bestForce.power >= requiredPower) {
                                    const attackCmds = this._planNemesisDestruction(bestForce, nemesisTarget, race, archetype, reasoningLog);
                                    if (attackCmds.length > 0) {
                                        const gate = evaluateStrategicAttackGate({
                                            hasNemesisOpportunity: true,
                                            hasHighValueOpportunity: true,
                                        });
                                        if (gate.allowed) {
                                            hasMaxPriorityGoal = true;
                                            commands.push(...this._markCommandsAsMaxPriorityGoal(attackCmds, 'nemesis_assault'));
                                            strategicAttackIssued = true;
                                            markStrategicAttackCommitted();
                                            const fakesNemesis = this._planFakeAttacks({
                                                realTargetCoords: nemesisTarget.coords,
                                                forces: offensiveReadyForces,
                                                gameState,
                                                ownerId,
                                                race,
                                            });
                                            if (fakesNemesis.commands.length > 0) {
                                                commands.push(...fakesNemesis.commands);
                                                reasoningLog.push(...fakesNemesis.logs);
                                            }
                                            reasoningLog.push(
                                                `[PVP-GATE] Némesis habilitado. p=${(gate.probability * 100).toFixed(1)}% ` +
                                                `roll=${(gate.roll * 100).toFixed(1)}% cd=${Math.round(gate.cooldownMs / 60000)}m.`
                                            );
                                        } else {
                                            if (gate.reason === 'cooldown_active') {
                                                reasoningLog.push(
                                                    `[PVP-GATE] Ataque a némesis en cooldown (${Math.ceil(gate.cooldownRemainingMs / 60000)}m restantes).`
                                                );
                                            } else {
                                                reasoningLog.push(
                                                    `[PVP-GATE] Némesis bloqueado por probabilidad. ` +
                                                    `p=${(gate.probability * 100).toFixed(1)}% roll=${(gate.roll * 100).toFixed(1)}%.`
                                                );
                                            }
                                        }
                                    }
                                } else {
                                    reasoningLog.push('[ESTRATEGIA] 🛑 PROTOCOLO DE REAGRUPAMIENTO ACTIVADO.');
                                    reasoningLog.push(`[ESTRATEGIA] Fuerza Total (${bestForce.totalPower.toFixed(0)}) suficiente para vencer defensa (${estimatedDefense.toFixed(0)}), pero fuerza actual (${bestForce.power.toFixed(0)}) es baja.`);
                                    reasoningLog.push('[ESTRATEGIA] Cancelando operaciones de farmeo para reunir el ejército.');
                                    isMusteringForWar = true;
                                }
                            } else {
                                reasoningLog.push(`[ESTRATEGIA] Némesis demasiado fuerte (${estimatedDefense.toFixed(0)} def vs ${bestForce.totalPower.toFixed(0)} total). Continuando crecimiento económico.`);
                            }
                        }
                    }
                } else {
                    reasoningLog.push('[ESPERA] Ataque en curso contra Némesis. Esperando reporte.');
                }
            }
        }

        const spyResults = this._performGeneralIntelligence(
            offensiveReadyForces,
            targets.unknown,
            nemesisId,
            {
                race,
                priorityIntelTargetIds,
            },
        );
        commands.push(...spyResults.commands);
        if (spyResults.logs.length > 0) reasoningLog.push(...spyResults.logs);

        const safeKnownTargets = targets.known.filter(target => {
            if (target.ownerId === 'nature') return true;
            if (baitingPlayers.includes(target.ownerId)) return false;
            const rep = reputationData[target.ownerId];
            if (rep !== undefined && rep < -0.5) {
                reasoningLog.push(`[INTEL] Objetivo ${target.data.name} (${target.ownerId}) tiene reputación muy negativa (${rep.toFixed(2)}). Priorizando espionaje sobre ataque.`);
            }
            return true;
        });

        const doctrine = this._resolveOffensiveDoctrine(race, archetype);
        const strategicPvpTargets = safeKnownTargets.filter(target =>
            target.type === 'village'
            && target.ownerId !== 'nature'
            && Boolean(target.intel)
            && target.intelGate?.intelFresh !== false,
        );
        if (!isMusteringForWar && !hasMaxPriorityGoal && strategicPvpTargets.length > 0) {
            const hasHighValueStrategicTarget = strategicPvpTargets.some(target => {
                const targetType = this._classifyStrategicTargetType(target, nemesisId);
                return targetType === 'nemesis'
                    || targetType === 'punish_exposed_army'
                    || targetType === 'high_value_siege_target'
                    || targetType === 'expansion_village';
            });

            const gate = evaluateStrategicAttackGate({
                hasNemesisOpportunity: Boolean(nemesisId),
                hasHighValueOpportunity: hasHighValueStrategicTarget,
            });

            if (gate.allowed) {
                const strategicOffense = this._planDoctrinalStrategicOffense({
                    forces: offensiveReadyForces,
                    targets: strategicPvpTargets,
                    gameState,
                    ownerId,
                    race,
                    nemesisId,
                    doctrine,
                    log: reasoningLog,
                });

                if (strategicOffense.commands.length > 0) {
                    commands.push(...strategicOffense.commands);
                    strategicAttackIssued = true;
                    markStrategicAttackCommitted();
                    const firstRealAttack = strategicOffense.commands.find(
                        c => c.comando === 'ATTACK' && c.parametros?.mision === 'attack',
                    );
                    if (firstRealAttack) {
                        const fakesOffense = this._planFakeAttacks({
                            realTargetCoords: firstRealAttack.parametros.targetCoords,
                            forces: offensiveReadyForces,
                            gameState,
                            ownerId,
                            race,
                        });
                        if (fakesOffense.commands.length > 0) {
                            commands.push(...fakesOffense.commands);
                            reasoningLog.push(...fakesOffense.logs);
                        }
                    }
                } else {
                    strategicAttackGateState.cyclesWithoutAttack = Math.max(0, (strategicAttackGateState.cyclesWithoutAttack || 0) + 1);
                }

                if (strategicOffense.logs.length > 0) {
                    reasoningLog.push(...strategicOffense.logs);
                }

                reasoningLog.push(
                    `[PVP-GATE] Ofensiva habilitada. p=${(gate.probability * 100).toFixed(1)}% ` +
                    `roll=${(gate.roll * 100).toFixed(1)}% cd=${Math.round(gate.cooldownMs / 60000)}m.`
                );
            } else if (gate.reason === 'cooldown_active') {
                reasoningLog.push(`[PVP-GATE] Ofensiva estratégica en cooldown (${Math.ceil(gate.cooldownRemainingMs / 60000)}m restantes).`);
            } else {
                reasoningLog.push(
                    `[PVP-GATE] Ofensiva estratégica omitida por probabilidad. ` +
                    `p=${(gate.probability * 100).toFixed(1)}% roll=${(gate.roll * 100).toFixed(1)}%.`
                );
            }
        }

        if (!isMusteringForWar) {
            if (hasMaxPriorityGoal || strategicAttackIssued) {
                reasoningLog.push('[FARMEO ROI] Farm de oasis en paralelo con ofensiva estrategica (tropas remanentes).');
            }

            const farmListResult = this._runFarmListCycle({
                farmList: aiState.farmList || [],
                forces: offensiveReadyForces,
                gameState,
                ownerId,
                race,
            });
            if (farmListResult.commands.length > 0) {
                commands.push(...farmListResult.commands);
                reasoningLog.push(...farmListResult.logs);
            } else if (farmListResult.logs.length > 0) {
                reasoningLog.push(...farmListResult.logs);
            }

            const farmingResults = this._performOptimizedFarming(
                offensiveReadyForces,
                safeKnownTargets,
                nemesisId,
                race,
                personality,
                troopSpeed,
                gameState,
                ownerId,
                myVillages.reduce((sum, village) => sum + (village.population?.current || 0), 0),
            );
            commands.push(...farmingResults.commands);
            if (farmingResults.logs.length > 0) reasoningLog.push(...farmingResults.logs);
            oasisFarmingTelemetry = farmingResults.telemetry || null;
        }

        return {
            razonamiento: reasoningLog.join('\n'),
            comandos: commands,
            telemetry: {
                oasisFarming: oasisFarmingTelemetry,
                militaryGate: {
                    hasMaxPriorityGoal,
                    isMusteringForWar,
                    farmEvaluationExecuted: !isMusteringForWar,
                    farmBlockedByMaxPriorityGoal: false,
                    farmBlockedByStrategicAttack: false,
                    strategicAttackProbability: strategicAttackGateDecision?.probability || strategicAttackGateState.lastProbability || STRATEGIC_ATTACK_GATE_CONFIG.baseProbability,
                    strategicAttackRoll: strategicAttackGateDecision?.roll ?? strategicAttackGateState.lastRoll,
                    strategicAttackGateReason: strategicAttackGateDecision?.reason || strategicAttackGateState.lastDecisionReason || 'not_evaluated',
                    strategicAttackCooldownMs: strategicAttackGateDecision?.cooldownMs || strategicAttackGateState.lastCooldownMs || getStrategicAttackCooldownMs(gameSpeed),
                    offensiveSuppressedByReactive: blockedForces.length > 0,
                    blockedVillagesCount: blockedForces.length,
                    offensiveReadyVillages: offensiveReadyForces.length,
                    strategicAttackIssued,
                },
            },
        };
    }

    _markCommandsAsMaxPriorityGoal(commands, reason = 'critical_military_target') {
        return (commands || []).map(command => ({
            ...command,
            meta: {
                ...(command.meta || {}),
                priority: MAX_PRIORITY_GOAL,
                reason,
            },
        }));
    }

    _calculateEstimatedDefense(target, attackerProportions = { infantry: 0.5, cavalry: 0.5 }) {
        const contingents = this._buildIntelDefendingContingents(target);
        const wallLevel = target.intel?.payload?.buildings?.wallLevel || 0;
        const palaceLevel = target.intel?.payload?.buildings?.residenceLevel || 0;
        return CombatFormulas.calculateDefensePoints(
            contingents,
            attackerProportions,
            target.data.race,
            wallLevel,
            palaceLevel,
        );
    }

    _planNemesisDestruction(bestForce, target, race, archetype, log) {
        if (!bestForce) return [];

        const attackerPreview = CombatFormulas.calculateAttackPoints(bestForce.combatTroops || {}, race, bestForce.village?.smithy?.upgrades || {});
        const defPower = this._calculateEstimatedDefense(target, this._getAttackerProportions(attackerPreview));

        if (defPower < 100) {
            const siegeCmds = this._planSiegeTrain(bestForce, target, log);
            if (siegeCmds.length > 0) return siegeCmds;
        }

        const fullAttack = { ...bestForce.combatTroops };
        const sim = this._simulateCombatAgainstTarget(fullAttack, target, race, 'attack', bestForce.village?.smithy?.upgrades || {});

        if (sim.winner === 'attacker') {
            const totalMyTroops = Object.values(fullAttack).reduce((a, b) => a + b, 0);
            const totalLost = Object.values(sim.losses).reduce((a, b) => a + b, 0);
            const lossPercent = totalLost / totalMyTroops;
            const threshold = archetype === 'rusher' ? 0.95 : 0.85;

            if (lossPercent <= threshold) {
                const troopsToSend = { ...fullAttack };
                if (Object.keys(bestForce.siegeTroops).length > 0) {
                    Object.assign(troopsToSend, bestForce.siegeTroops);
                }

                this._consumeTroops(bestForce, troopsToSend);
                log.push(`[GUERRA] Lanzando GOLPE DE ANIQUILACIÓN (Bajas est: ${(lossPercent * 100).toFixed(0)}%).`);

                return [{
                    comando: 'ATTACK',
                    villageId: bestForce.village.id,
                    parametros: {
                        targetCoords: target.coords,
                        tropas: troopsToSend,
                        mision: 'attack',
                        catapultTargets: ['mainBuilding', 'granary'],
                    },
                }];
            }

            log.push(`[GUERRA] Ataque retenido. Bajas excesivas (${(lossPercent * 100).toFixed(0)}%).`);
        } else {
            log.push('[GUERRA] Ataque retenido. Derrota proyectada.');
        }

        return [];
    }

    _calculateDeployedTroops(villageId, gameState) {
        return calculateDeployedTroops(villageId, gameState);
    }

    _mergeTroops(troopsA, troopsB) {
        return mergeTroops(troopsA, troopsB);
    }

    _getBestForce(forces) {
        let best = null;
        let maxPower = -1;
        forces.forEach(force => {
            if (force.totalPower > maxPower) {
                maxPower = force.totalPower;
                best = force;
            }
        });
        return best;
    }

    _scanAndClassifyTargets(gameState, forces, myOwnerId, race, gameSpeed, nemesisId, log, priorityIntelTargetIds, nemesisInterval, generalInterval) {
        return scanAndClassifyTargets({
            gameState,
            forces,
            myOwnerId,
            race,
            gameSpeed,
            nemesisId,
            log,
            priorityIntelTargetIds,
            nemesisInterval,
            generalInterval,
            searchRadius,
        });
    }

    _dispatchSpies(forces, target, baseCount, log, reason, isRetry = false, lastCount = 0, options = {}) {
        return dispatchSpies(forces, target, baseCount, log, reason, isRetry, lastCount, options);
    }

    _performGeneralIntelligence(forces, unknownTargets, nemesisId, options = {}) {
        return performGeneralIntelligence(forces, unknownTargets, nemesisId, scoutsPerMission, options);
    }

    _collectPriorityIntelTargetIds(combatContractByVillage = {}) {
        const targetIds = new Set();

        Object.values(combatContractByVillage || {}).forEach(combatState => {
            if (!combatState || !combatState.attackerVillageId) return;

            const severeThreat = Boolean(combatState.shouldRescoutAttacker)
                || combatState.threatLevel === 'high'
                || combatState.threatLevel === 'critical'
                || combatState.threatType === 'multi_wave_attack'
                || combatState.threatType === 'siege_attack'
                || combatState.threatType === 'conquest_attack';

            if (severeThreat) {
                targetIds.add(combatState.attackerVillageId);
            }
        });

        return [...targetIds];
    }

    _resolveOffensiveDoctrine(race, archetype) {
        const isGermanic = race === 'germans' || race === 'huns' || archetype === 'rusher';
        const isEgyptian = race === 'egyptians' || archetype === 'turtle';

        if (isGermanic) {
            return {
                doctrineId: 'germanic_pressure',
                reserveDefensiveRatio: 0.30,
                reserveOffensiveRatio: 0.12,
                minDefenseReservePoints: 180,
                minAttackPower: 220,
                maxStrategicAttacksPerCycle: 2,
                maxDistance: 45,
                requireIsolatedTarget: false,
                allowMultiWave: true,
                multiWaveMinMargin: 1.45,
                baseCommitRatio: 0.68,
                maxLossPercent: 0.62,
                minVictoryMargin: 1.05,
                targetWeights: {
                    nemesis: 170,
                    punish_exposed_army: 135,
                    high_value_siege_target: 108,
                    economic_village: 96,
                    military_village: 90,
                    expansion_village: 88,
                },
                commitRatioByType: {
                    nemesis: 0.82,
                    punish_exposed_army: 0.76,
                    high_value_siege_target: 0.74,
                    economic_village: 0.70,
                    military_village: 0.68,
                    expansion_village: 0.66,
                },
                minMarginByType: {
                    nemesis: 1.08,
                    punish_exposed_army: 1.02,
                    high_value_siege_target: 1.12,
                    economic_village: 1.05,
                    military_village: 1.12,
                    expansion_village: 1.10,
                },
                maxLossByType: {
                    punish_exposed_army: 0.68,
                    high_value_siege_target: 0.62,
                    nemesis: 0.65,
                },
            };
        }

        if (isEgyptian) {
            return {
                doctrineId: 'egyptian_guarded_pressure',
                reserveDefensiveRatio: 0.56,
                reserveOffensiveRatio: 0.28,
                minDefenseReservePoints: 340,
                minAttackPower: 260,
                maxStrategicAttacksPerCycle: 1,
                maxDistance: 32,
                requireIsolatedTarget: true,
                allowMultiWave: false,
                multiWaveMinMargin: 99,
                baseCommitRatio: 0.48,
                maxLossPercent: 0.38,
                minVictoryMargin: 1.28,
                targetWeights: {
                    nemesis: 150,
                    punish_exposed_army: 90,
                    high_value_siege_target: 108,
                    economic_village: 92,
                    military_village: 84,
                    expansion_village: 104,
                },
                commitRatioByType: {
                    nemesis: 0.60,
                    punish_exposed_army: 0.44,
                    high_value_siege_target: 0.58,
                    economic_village: 0.46,
                    military_village: 0.42,
                    expansion_village: 0.54,
                },
                minMarginByType: {
                    nemesis: 1.32,
                    punish_exposed_army: 1.30,
                    high_value_siege_target: 1.34,
                    economic_village: 1.28,
                    military_village: 1.30,
                    expansion_village: 1.34,
                },
                maxLossByType: {
                    nemesis: 0.40,
                    high_value_siege_target: 0.36,
                    expansion_village: 0.34,
                },
            };
        }

        return {
            doctrineId: 'balanced_offense',
            reserveDefensiveRatio: 0.42,
            reserveOffensiveRatio: 0.20,
            minDefenseReservePoints: 240,
            minAttackPower: 240,
            maxStrategicAttacksPerCycle: 1,
            maxDistance: 36,
            requireIsolatedTarget: false,
            allowMultiWave: false,
            multiWaveMinMargin: 99,
            baseCommitRatio: 0.56,
            maxLossPercent: 0.50,
            minVictoryMargin: 1.16,
            targetWeights: {
                nemesis: 150,
                punish_exposed_army: 110,
                high_value_siege_target: 104,
                economic_village: 96,
                military_village: 92,
                expansion_village: 98,
            },
            commitRatioByType: {},
            minMarginByType: {},
            maxLossByType: {},
        };
    }

    _planDoctrinalStrategicOffense({
        forces,
        targets,
        gameState,
        ownerId,
        race,
        nemesisId,
        doctrine,
        log,
    }) {
        const commands = [];
        const logs = [];
        const usedVillages = new Set();
        const maxCommands = Math.max(0, doctrine.maxStrategicAttacksPerCycle || 0);

        const candidateTargets = targets
            .filter(target => !this._hasActiveAttack(gameState, target.id, ownerId))
            .filter(target => !this._isTargetUnderProtection(gameState, target.ownerId))
            .map(target => {
                const targetType = this._classifyStrategicTargetType(target, nemesisId);
                const baseScore = this._scoreStrategicTarget({
                    target,
                    targetType,
                    doctrine,
                    gameState,
                    ownerId,
                    race,
                });
                return {
                    target,
                    targetType,
                    baseScore,
                };
            })
            .sort((a, b) => b.baseScore - a.baseScore);

        for (const candidate of candidateTargets) {
            if (commands.length >= maxCommands) break;

            const bestPlan = this._buildBestForcePlanForTarget({
                forces,
                usedVillages,
                target: candidate.target,
                targetType: candidate.targetType,
                targetBaseScore: candidate.baseScore,
                race,
                doctrine,
                gameState,
            });

            if (!bestPlan) continue;

            commands.push(bestPlan.command);
            if (bestPlan.followUpCommand) {
                commands.push(bestPlan.followUpCommand);
            }
            usedVillages.add(bestPlan.force.village.id);

            this._consumeTroops(bestPlan.force, bestPlan.troopsCommitted);
            if (bestPlan.followUpTroopsCommitted) {
                this._consumeTroops(bestPlan.force, bestPlan.followUpTroopsCommitted);
            }

            logs.push(
                `[OFENSIVA-${doctrine.doctrineId}] ${bestPlan.force.village.name} -> ${candidate.target.data.name} ` +
                `tipo=${candidate.targetType} margen=${bestPlan.victoryMargin.toFixed(2)} ` +
                `loss=${(bestPlan.lossPercent * 100).toFixed(0)}% power=${Math.round(bestPlan.attackPower)}.`
            );
        }

        if (candidateTargets.length > 0 && commands.length === 0) {
            logs.push(`[OFENSIVA-${doctrine.doctrineId}] Sin ataques estratégicos válidos por certeza doctrinal/reserva defensiva.`);
        }

        return {
            commands,
            logs,
        };
    }

    _buildBestForcePlanForTarget({ forces, usedVillages, target, targetType, targetBaseScore, race, doctrine, gameState }) {
        let best = null;

        forces.forEach(force => {
            if (!force || usedVillages.has(force.village.id)) return;

            const plan = this._buildForceAttackPlan({
                force,
                target,
                targetType,
                targetBaseScore,
                race,
                doctrine,
                gameState,
            });
            if (!plan) return;

            if (!best || plan.finalScore > best.finalScore) {
                best = plan;
            }
        });

        return best;
    }

    _buildForceAttackPlan({ force, target, targetType, targetBaseScore, race, doctrine, gameState }) {
        const distance = Math.hypot(
            target.coords.x - force.village.coords.x,
            target.coords.y - force.village.coords.y,
        );

        if (distance > doctrine.maxDistance && targetType !== 'nemesis') {
            return null;
        }

        const reservePlan = this._buildDefenseReservePlan(force, race, doctrine);
        const attackReadyTroops = reservePlan.attackReadyTroops;
        const readyPower = CombatFormulas.calculateAttackPoints(attackReadyTroops, race, force.village.smithy?.upgrades || {}).total;
        if (readyPower < doctrine.minAttackPower) return null;

        const commitRatio = doctrine.commitRatioByType[targetType] || doctrine.baseCommitRatio;
        const troopsToSend = this._selectTroopsForAttack({
            troops: attackReadyTroops,
            race,
            targetType,
            commitRatio,
        });

        const attackPower = CombatFormulas.calculateAttackPoints(troopsToSend, race, force.village.smithy?.upgrades || {}).total;
        if (attackPower < doctrine.minAttackPower) return null;

        const sim = this._simulateCombatAgainstTarget(troopsToSend, target, race, 'attack', force.village?.smithy?.upgrades || {});
        const totalSent = this._countTroops(troopsToSend);
        const totalLost = this._countTroops(sim.losses);
        const lossPercent = totalSent > 0 ? totalLost / totalSent : 1;

        const attackerBreakdown = CombatFormulas.calculateAttackPoints(troopsToSend, race, force.village.smithy?.upgrades || {});
        const attackerProportions = this._getAttackerProportions(attackerBreakdown);
        const estimatedDefense = this._calculateEstimatedDefense(target, attackerProportions);
        const victoryMargin = attackPower / Math.max(estimatedDefense, 1);

        const minMargin = doctrine.minMarginByType[targetType] || doctrine.minVictoryMargin;
        const maxLoss = doctrine.maxLossByType[targetType] || doctrine.maxLossPercent;
        if (sim.winner !== 'attacker') return null;
        if (victoryMargin < minMargin) return null;
        if (lossPercent > maxLoss) return null;
        if (doctrine.requireIsolatedTarget && this._countNearbyEnemyVillages(gameState, target, 16) > 2) return null;

        const command = {
            comando: 'ATTACK',
            villageId: force.village.id,
            parametros: {
                targetCoords: target.coords,
                tropas: troopsToSend,
                mision: 'attack',
                catapultTargets: this._resolveCatapultTargetsByType(targetType),
            },
            meta: {
                strategicTargetType: targetType,
                doctrine: doctrine.doctrineId,
                confidence: Number(victoryMargin.toFixed(3)),
                estimatedLossPercent: Number(lossPercent.toFixed(3)),
            },
        };

        const finalScore = targetBaseScore
            + (victoryMargin * 35)
            - (lossPercent * 28)
            - (distance * 0.55)
            + (reservePlan.reservedDefense >= doctrine.minDefenseReservePoints ? 8 : 0);

        let followUpCommand = null;
        let followUpTroopsCommitted = null;
        if (doctrine.allowMultiWave && victoryMargin >= doctrine.multiWaveMinMargin) {
            const remaining = this._subtractTroops(attackReadyTroops, troopsToSend);
            const followUpTroops = this._selectTroopsForAttack({
                troops: remaining,
                race,
                targetType,
                commitRatio: 0.42,
            });
            const followUpPower = CombatFormulas.calculateAttackPoints(followUpTroops, race, force.village.smithy?.upgrades || {}).total;
            if (followUpPower >= doctrine.minAttackPower * 0.5) {
                followUpCommand = {
                    comando: 'ATTACK',
                    villageId: force.village.id,
                    parametros: {
                        targetCoords: target.coords,
                        tropas: followUpTroops,
                        mision: 'attack',
                        catapultTargets: this._resolveCatapultTargetsByType(targetType),
                    },
                    meta: {
                        strategicTargetType: targetType,
                        doctrine: doctrine.doctrineId,
                        wave: 'follow_up',
                    },
                };
                followUpTroopsCommitted = followUpTroops;
            }
        }

        return {
            force,
            command,
            followUpCommand,
            troopsCommitted: troopsToSend,
            followUpTroopsCommitted,
            victoryMargin,
            lossPercent,
            attackPower,
            finalScore,
        };
    }

    _classifyStrategicTargetType(target, nemesisId) {
        if (target.ownerId === nemesisId) return 'nemesis';

        const intel = target.intel?.payload || {};
        const troops = intel.troops || {};
        const troopCount = this._countTroops(troops);
        const population = Number(target.data?.population?.current || target.population?.current || 0);
        const wallLevel = Number(intel.buildings?.wallLevel || 0);
        const residenceLevel = Number(intel.buildings?.residenceLevel || 0);
        const defensePower = Number(intel.poder_defensivo_calculado || 0);
        const resources = intel.resources || {};
        const resourceTotal = (resources.wood || 0) + (resources.stone || 0) + (resources.iron || 0) + (resources.food || 0);

        const hasExpansionSignal = residenceLevel >= 10 || this._hasConquestTroops(troops, target.data?.race);
        const hasHighSiegeValue = wallLevel >= 14 || (target.data?.buildings || []).some(building =>
            (building.type === 'academy' && building.level >= 12)
            || (building.type === 'workshop' && building.level >= 8)
            || (building.type === 'palace' && building.level >= 10),
        );
        const hasMilitarySignal = defensePower >= 700 || (target.data?.buildings || []).some(building =>
            (building.type === 'barracks' && building.level >= 14)
            || (building.type === 'stable' && building.level >= 10)
            || (building.type === 'cityWall' && building.level >= 12),
        );

        if (troopCount <= 45 && population >= 320) return 'punish_exposed_army';
        if (hasHighSiegeValue) return 'high_value_siege_target';
        if (hasExpansionSignal) return 'expansion_village';
        if (hasMilitarySignal) return 'military_village';
        if (resourceTotal >= 1500) return 'economic_village';
        return 'economic_village';
    }

    _scoreStrategicTarget({ target, targetType, doctrine, gameState, ownerId, race }) {
        const intel = target.intel?.payload || {};
        const resources = intel.resources || {};
        const troopCount = this._countTroops(intel.troops || {});
        const resourceTotal = (resources.wood || 0) + (resources.stone || 0) + (resources.iron || 0) + (resources.food || 0);
        const defensePower = Number(intel.poder_defensivo_calculado || 0);
        const wallLevel = Number(intel.buildings?.wallLevel || 0);
        const base = doctrine.targetWeights[targetType] || 80;

        let score = base;
        if (targetType === 'economic_village') {
            score += resourceTotal / 260;
            score += Math.max(0, 120 - defensePower) / 9;
        }
        if (targetType === 'punish_exposed_army') {
            const pop = Number(target.data?.population?.current || 0);
            score += Math.max(0, pop - troopCount) / 5;
            score += Math.max(0, 10 - wallLevel) * 2.4;
        }
        if (targetType === 'high_value_siege_target') {
            score += wallLevel * 1.6;
            score += Math.max(0, defensePower - 400) / 25;
        }
        if (targetType === 'expansion_village') {
            score += Math.max(0, (intel.buildings?.residenceLevel || 0) - 7) * 3;
        }
        if (targetType === 'military_village') {
            score += Math.max(0, defensePower - 500) / 40;
        }

        const ownerVillagesNearby = this._countNearbyEnemyVillages(gameState, target, 16);
        if (race === 'egyptians') {
            score += Math.max(0, 3 - ownerVillagesNearby) * 8;
            score -= ownerVillagesNearby * 5;
        }
        if (race === 'germans' || race === 'huns') {
            score += Math.max(0, 12 - wallLevel) * 2.2;
            score += Math.max(0, 140 - troopCount) / 6;
        }

        if (target.intelGate?.context === 'recent_attacker') {
            score += 12;
        }
        if (target.intelGate?.context === 'dangerous_neighbor' && race === 'egyptians') {
            score += 10;
        }

        if (this._isTargetUnderProtection(gameState, target.ownerId)) {
            score -= 1000;
        }
        if (target.ownerId === ownerId || target.ownerId === 'nature') {
            score -= 1000;
        }

        return score;
    }

    _buildDefenseReservePlan(force, race, doctrine) {
        const baseTroops = { ...(force.combatTroops || {}) };
        const reservedTroops = {};
        const attackReadyTroops = {};
        const smithyUpgrades = force.village?.smithy?.upgrades || {};

        Object.entries(baseTroops).forEach(([unitId, count]) => {
            const available = Math.max(0, Number(count) || 0);
            if (available <= 0) return;

            const unitData = this._findUnitDataById(race, unitId);
            const isDefensiveRole = unitData?.role === 'defensive' || unitData?.role === 'versatile';
            const keepRatio = isDefensiveRole ? doctrine.reserveDefensiveRatio : doctrine.reserveOffensiveRatio;
            const reserveCount = Math.min(available, Math.floor(available * keepRatio));
            const freeCount = Math.max(0, available - reserveCount);

            if (reserveCount > 0) reservedTroops[unitId] = reserveCount;
            if (freeCount > 0) attackReadyTroops[unitId] = freeCount;
        });

        let reservedDefense = this._estimateVillageDefenseWithTroops(force.village, reservedTroops, race, smithyUpgrades);
        if (reservedDefense < doctrine.minDefenseReservePoints) {
            const movable = Object.entries(attackReadyTroops)
                .map(([unitId, count]) => ({
                    unitId,
                    count,
                    unitData: this._findUnitDataById(race, unitId),
                }))
                .filter(entry => entry.count > 0 && entry.unitData)
                .sort((a, b) => this._getUnitDefenseWeight(b.unitData) - this._getUnitDefenseWeight(a.unitData));

            movable.forEach(entry => {
                if (reservedDefense >= doctrine.minDefenseReservePoints) return;

                const perUnitDefense = this._getUnitDefenseWeight(entry.unitData);
                if (perUnitDefense <= 0) return;

                const deficit = doctrine.minDefenseReservePoints - reservedDefense;
                const toReserve = Math.min(entry.count, Math.max(1, Math.ceil(deficit / perUnitDefense)));
                if (toReserve <= 0) return;

                attackReadyTroops[entry.unitId] -= toReserve;
                if (attackReadyTroops[entry.unitId] <= 0) delete attackReadyTroops[entry.unitId];
                reservedTroops[entry.unitId] = (reservedTroops[entry.unitId] || 0) + toReserve;
                reservedDefense = this._estimateVillageDefenseWithTroops(force.village, reservedTroops, race, smithyUpgrades);
            });
        }

        return {
            reservedTroops,
            attackReadyTroops,
            reservedDefense,
        };
    }

    _selectTroopsForAttack({ troops, race, targetType, commitRatio }) {
        const source = { ...(troops || {}) };
        const totalUnits = this._countTroops(source);
        if (totalUnits <= 0) return {};

        const targetUnits = Math.max(20, Math.floor(totalUnits * Math.max(0.1, Math.min(0.95, commitRatio))));
        const selected = {};
        const preference = this._getTargetTypeRolePreference(targetType);

        const ranked = Object.entries(source)
            .map(([unitId, count]) => ({
                unitId,
                count,
                unitData: this._findUnitDataById(race, unitId),
            }))
            .filter(entry => entry.count > 0 && entry.unitData)
            .sort((a, b) => {
                const aRoleRank = preference.indexOf(a.unitData.role);
                const bRoleRank = preference.indexOf(b.unitData.role);
                const aRank = aRoleRank === -1 ? 99 : aRoleRank;
                const bRank = bRoleRank === -1 ? 99 : bRoleRank;
                if (aRank !== bRank) return aRank - bRank;

                const aAttack = Number(a.unitData.stats?.attack || 0);
                const bAttack = Number(b.unitData.stats?.attack || 0);
                return bAttack - aAttack;
            });

        let picked = 0;
        ranked.forEach(entry => {
            if (picked >= targetUnits) return;
            const take = Math.min(entry.count, targetUnits - picked);
            if (take <= 0) return;
            selected[entry.unitId] = take;
            picked += take;
        });

        return selected;
    }

    _getTargetTypeRolePreference(targetType) {
        if (targetType === 'high_value_siege_target' || targetType === 'nemesis') {
            return ['catapult', 'ram', 'offensive', 'versatile', 'defensive'];
        }
        if (targetType === 'military_village') {
            return ['offensive', 'catapult', 'ram', 'versatile', 'defensive'];
        }
        if (targetType === 'expansion_village') {
            return ['offensive', 'versatile', 'catapult', 'ram', 'defensive'];
        }
        if (targetType === 'punish_exposed_army') {
            return ['offensive', 'versatile', 'ram', 'catapult', 'defensive'];
        }
        return ['offensive', 'versatile', 'catapult', 'ram', 'defensive'];
    }

    _resolveCatapultTargetsByType(targetType) {
        if (targetType === 'high_value_siege_target' || targetType === 'nemesis') {
            return ['mainBuilding', 'granary'];
        }
        if (targetType === 'expansion_village') {
            return ['residence', 'mainBuilding'];
        }
        if (targetType === 'military_village') {
            return ['barracks', 'stable'];
        }
        return [];
    }

    _countNearbyEnemyVillages(gameState, target, radius) {
        return gameState.villages.filter(village => {
            if (!village || village.ownerId !== target.ownerId) return false;
            if (village.id === target.id) return false;
            const dist = Math.hypot(village.coords.x - target.coords.x, village.coords.y - target.coords.y);
            return dist <= radius;
        }).length;
    }

    _hasConquestTroops(troops = {}, race) {
        const raceUnits = gameData.units[race]?.troops || [];
        for (const unitId in troops) {
            if ((troops[unitId] || 0) <= 0) continue;
            const unitData = raceUnits.find(unit => unit.id === unitId);
            if (!unitData) continue;
            if (unitData.role === 'conquest' || unitData.type === 'chief' || unitData.type === 'settler') {
                return true;
            }
        }
        return false;
    }

    _isTargetUnderProtection(gameState, ownerId) {
        if (!ownerId || ownerId === 'nature') return false;
        const player = gameState.players.find(candidate => candidate.id === ownerId);
        return Boolean(player?.isUnderProtection);
    }

    _estimateVillageDefenseWithTroops(village, troops, race, smithyUpgrades = {}) {
        const wallLevel = village.buildings?.find(building => building.type === 'cityWall')?.level || 0;
        const palaceLevel = village.buildings?.find(building => building.type === 'palace' || building.type === 'residence')?.level || 0;
        return CombatFormulas.calculateDefensePoints(
            [{ troops, race, smithyUpgrades }],
            { infantry: 0.5, cavalry: 0.5 },
            race,
            wallLevel,
            palaceLevel,
        );
    }

    _findUnitDataById(race, unitId) {
        return gameData.units[race]?.troops?.find(unit => unit.id === unitId) || null;
    }

    _getUnitDefenseWeight(unitData) {
        if (!unitData || !unitData.stats?.defense) return 0;
        return ((Number(unitData.stats.defense.infantry || 0) * 0.5) + (Number(unitData.stats.defense.cavalry || 0) * 0.5));
    }

    _subtractTroops(baseTroops = {}, toSubtract = {}) {
        const result = {};
        const unitIds = new Set([...Object.keys(baseTroops), ...Object.keys(toSubtract)]);
        unitIds.forEach(unitId => {
            const remaining = (baseTroops[unitId] || 0) - (toSubtract[unitId] || 0);
            if (remaining > 0) result[unitId] = remaining;
        });
        return result;
    }

    _planFakeAttacks({ realTargetCoords, forces, gameState, ownerId, race, maxFakes = 3 }) {
        const DECOY_RADIUS = 10;
        const commands = [];
        const logs = [];

        const raceUnits = gameData.units[race]?.troops || [];

        let cheapestUnit = null;
        let lowestCost = Infinity;
        let sourceForce = null;

        for (const force of forces) {
            for (const unitId in force.combatTroops) {
                const count = force.combatTroops[unitId] || 0;
                if (count < maxFakes) continue;
                const unitData = raceUnits.find(u => u.id === unitId);
                if (!unitData) continue;
                if (unitData.role !== 'offensive') continue;
                if (unitData.type !== 'infantry') continue;
                const cost = (unitData.stats?.attack || 0) > 0
                    ? (unitData.cost?.wood || 0) + (unitData.cost?.stone || 0) + (unitData.cost?.iron || 0)
                    : 0;
                if (cost > 0 && cost < lowestCost) {
                    lowestCost = cost;
                    cheapestUnit = { unitId, unitData, count };
                    sourceForce = force;
                }
            }
        }

        if (!cheapestUnit || !sourceForce) return { commands, logs };

        const decoyTargets = gameState.villages
            .filter(v => {
                if (v.ownerId === ownerId || v.ownerId === 'nature') return false;
                const dist = Math.hypot(
                    v.coords.x - realTargetCoords.x,
                    v.coords.y - realTargetCoords.y,
                );
                return dist > 0 && dist <= DECOY_RADIUS;
            })
            .slice(0, maxFakes);

        if (decoyTargets.length === 0) return { commands, logs };

        const fakesCount = Math.min(decoyTargets.length, maxFakes, cheapestUnit.count);
        const toConsume = {};

        for (let i = 0; i < fakesCount; i++) {
            commands.push({
                comando: 'ATTACK',
                villageId: sourceForce.village.id,
                parametros: {
                    targetCoords: decoyTargets[i].coords,
                    tropas: { [cheapestUnit.unitId]: 1 },
                    mision: 'raid',
                },
                meta: { isFakeAttack: true, realTargetCoords },
            });
            toConsume[cheapestUnit.unitId] = (toConsume[cheapestUnit.unitId] || 0) + 1;
        }

        this._consumeTroops(sourceForce, toConsume);
        logs.push(
            `[FAKES] ${fakesCount} raids de 1x${cheapestUnit.unitId} enviados desde ` +
            `${sourceForce.village.name} a aldeas vecinas del objetivo real.`,
        );

        return { commands, logs };
    }

    _runFarmListCycle({ farmList, forces, gameState, ownerId, race }) {
        return runFarmListCycle({
            farmList,
            forces,
            gameState,
            ownerId,
            race,
            consumeTroops: this._consumeTroops.bind(this),
            hasActiveAttackFn: this._hasActiveAttack.bind(this),
        });
    }

    _manageNemesis(gameState, myOwnerId, aiState, log) {
        return manageNemesis(gameState, myOwnerId, aiState, log);
    }

    _planSiegeTrain(force, target, log) {
        return planSiegeTrain(force, target, log, {
            minCatsForTrain,
            maxWaves,
            consumeTroops: this._consumeTroops.bind(this),
        });
    }

    _performOptimizedFarming(forces, knownTargets, nemesisId, race, personality, troopSpeed, gameState, ownerId, attackerPopulation) {
        return performOptimizedFarming({
            forces,
            knownTargets,
            nemesisId,
            ownerId,
            race,
            personality,
            attackerPopulation,
            troopSpeed,
            simulateCombat: this._simulateCombat.bind(this),
            consumeTroops: this._consumeTroops.bind(this),
            currentMovements: gameState?.movements,
            resolveTileTypeFromCoords: coords => {
                if (!coords || !gameState) return null;
                const tile = gameState.spatialIndex.get(`${coords.x}|${coords.y}`);
                return tile?.type || null;
            },
        });
    }

    _hasActiveAttack(gameState, targetId, ownerId) {
        return gameState.movements.some(movement =>
            movement.ownerId === ownerId &&
            movement.type === 'attack' &&
            this._getTargetIdFromCoords(gameState, movement.targetCoords) === targetId,
        );
    }

    _getTargetIdFromCoords(gameState, coords) {
        const tile = gameState.spatialIndex.get(`${coords.x}|${coords.y}`);
        return tile ? (tile.villageId || `oasis_${tile.x}_${tile.y}`) : null;
    }

    _consumeTroops(force, troopsUsed) {
        consumeForceTroops(force, troopsUsed);
    }

    _findUnitDataByType(race, type) {
        const raceUnits = gameData.units[race]?.troops;
        if (!raceUnits) return null;
        return raceUnits.find(unit => unit.type === type);
    }

    _analyzeVillageNeeds(village) {
        const needs = { wood: 1, stone: 1, iron: 1, food: 1 };
        let minPercent = 1.0;
        let scarcestRes = '';

        for (const resource in village.resources) {
            const percent = village.resources[resource].current / village.resources[resource].capacity;
            if (percent < minPercent) {
                minPercent = percent;
                scarcestRes = resource;
            }
        }

        if (scarcestRes) needs[scarcestRes] = 2.5;
        if (village.resources.food.production < 0) needs.food = 5.0;
        return needs;
    }

    _filterNonCombatTroops(troops, race) {
        filterNonCombatTroopsInPlace(troops, race);
    }

    _extractSiegeTroops(troops, race) {
        return extractSiegeTroops(troops, race);
    }

    _resolveVillageCombatContract(villageId, combatContractByVillage = {}) {
        const state = combatContractByVillage[villageId] || {};
        return {
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
    }

    _countTroops(troops = {}) {
        return Object.values(troops).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
    }

    _resolveVillageOffenseGate(combatContract) {
        const reasons = [];
        const threatLevel = combatContract?.threatLevel || 'none';
        const preferredResponse = combatContract?.preferredResponse || 'hold';
        const reservedTroopsCount = this._countTroops(combatContract?.reservedTroops || {});

        if (threatLevel === 'high' || threatLevel === 'critical') {
            reasons.push(`threat=${threatLevel}`);
        }
        if (combatContract?.offenseSuppressed) {
            reasons.push('offenseSuppressed=true');
        }
        if (combatContract?.counterWindowOpen) {
            reasons.push('counterWindowOpen=true');
        }
        if (preferredResponse === 'partial_dodge' || preferredResponse === 'full_dodge' || preferredResponse === 'hold_with_reinforcements' || preferredResponse === 'reinforce') {
            reasons.push(`preferredResponse=${preferredResponse}`);
        }

        return {
            blocked: reasons.length > 0,
            reasons: reservedTroopsCount > 0
                ? [...reasons, `reservedTroops=${reservedTroopsCount}`]
                : reasons,
        };
    }

    _buildIntelDefendingContingents(target) {
        const primaryTroops = target.intel?.payload?.troops || {};
        const contingents = [{
            troops: primaryTroops,
            race: target.data.race,
            smithyUpgrades: {},
        }];

        const reinforcements = target.intel?.payload?.refuerzos_vistos || [];
        reinforcements.forEach(reinforcement => {
            if (!reinforcement?.troops || this._countTroops(reinforcement.troops) <= 0) return;
            contingents.push({
                troops: reinforcement.troops,
                race: reinforcement.race || target.data.race,
                smithyUpgrades: reinforcement.smithyUpgradesSnapshot || {},
            });
        });

        return contingents;
    }

    _getAttackerProportions(attackBreakdown) {
        const inf = Number(attackBreakdown?.infantry || 0);
        const cav = Number(attackBreakdown?.cavalry || 0);
        const total = inf + cav;
        if (total <= 0) {
            return { infantry: 0.5, cavalry: 0.5 };
        }

        return {
            infantry: inf / total,
            cavalry: cav / total,
        };
    }

    _simulateCombatAgainstTarget(attackTroops, target, attRace, type, attackerSmithyUpgrades = {}) {
        const attackBreakdown = CombatFormulas.calculateAttackPoints(attackTroops, attRace, attackerSmithyUpgrades);
        const attackerProportions = this._getAttackerProportions(attackBreakdown);
        const defContingent = this._buildIntelDefendingContingents(target);
        const wallLevel = target.intel?.payload?.buildings?.wallLevel || 0;
        const palaceLevel = target.intel?.payload?.buildings?.residenceLevel || 0;
        const defRace = target.data.race;

        const defPoints = CombatFormulas.calculateDefensePoints(
            defContingent,
            attackerProportions,
            defRace,
            wallLevel,
            palaceLevel,
        );

        return this._calculateCombatOutcome({
            attackTroops,
            defenseTroops: target.intel?.payload?.troops || {},
            attackPower: attackBreakdown.total,
            defensePower: defPoints,
            type,
        });
    }

    _calculateCombatOutcome({ attackTroops, defenseTroops, attackPower, defensePower, type }) {
        const calculateLossesByRatio = (troops, ratio) => {
            const losses = {};
            for (const unitId in troops) {
                const originalCount = troops[unitId] || 0;
                if (originalCount <= 0) continue;
                const lost = Math.round(originalCount * ratio);
                if (lost > 0) losses[unitId] = Math.min(lost, originalCount);
            }
            return losses;
        };

        let attackerLossPercent = 0;
        let defenderLossPercent = 0;

        if (type === 'raid') {
            if (attackPower > defensePower) {
                attackerLossPercent = CombatFormulas.calculateRaidWinnerLosses(attackPower, defensePower);
                defenderLossPercent = 1.0 - attackerLossPercent;
            } else {
                attackerLossPercent = 1.0 - CombatFormulas.calculateRaidWinnerLosses(defensePower, attackPower);
                defenderLossPercent = 1.0 - attackerLossPercent;
            }
        } else {
            if (attackPower > defensePower) {
                attackerLossPercent = CombatFormulas.calculateLosses(attackPower, defensePower);
                defenderLossPercent = 1.0;
            } else {
                attackerLossPercent = 1.0;
                defenderLossPercent = CombatFormulas.calculateLosses(defensePower, attackPower);
            }
        }

        return {
            winner: attackPower > defensePower ? 'attacker' : 'defender',
            losses: calculateLossesByRatio(attackTroops, attackerLossPercent),
            defenderLosses: calculateLossesByRatio(defenseTroops, defenderLossPercent),
        };
    }

    _simulateCombat(attackTroops, defenseTroops, defRace, attRace, wallLevel, type) {
        const attPoints = CombatFormulas.calculateAttackPoints(attackTroops, attRace, {});
        const attackerProportions = this._getAttackerProportions(attPoints);
        const defContingent = [{ troops: defenseTroops, race: defRace, smithyUpgrades: {} }];
        const defPoints = CombatFormulas.calculateDefensePoints(
            defContingent,
            attackerProportions,
            defRace,
            wallLevel,
            0,
        );

        return this._calculateCombatOutcome({
            attackTroops,
            defenseTroops,
            attackPower: attPoints.total,
            defensePower: defPoints,
            type,
        });
    }
}
