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
import { manageNemesis } from './strategy/nemesis.js';
import { planSiegeTrain } from './strategy/siege.js';
import { dispatchSpies, performGeneralIntelligence, scanAndClassifyTargets } from './strategy/scouting.js';

const { searchRadius, scoutsPerMission, minCatsForTrain, maxWaves } = AI_STRATEGY_CONSTANTS;
const MAX_PRIORITY_GOAL = 'MAX_PRIORITY_GOAL';

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

            const siegeTroopsAtHome = this._extractSiegeTroops(troopsAtHome, race);
            const combatContract = this._resolveVillageCombatContract(village.id, combatContractByVillage);
            const offenseGate = this._resolveVillageOffenseGate(combatContract);

            const powerAtHome = CombatFormulas.calculateAttackPoints(combatTroopsAtHome, race, village.smithy.upgrades).total;
            const totalPower = CombatFormulas.calculateAttackPoints(totalCombatTroops, race, village.smithy.upgrades).total;
            const isArmyBusy = powerAtHome < totalPower * 0.8;

            if (totalPower > 0 || totalScoutCount > 0) {
                availableForces.push({
                    village,
                    troops: troopsAtHome,
                    totalTroops,
                    combatTroops: combatTroopsAtHome,
                    siegeTroops: siegeTroopsAtHome,
                    scoutCount: scoutCountAtHome,
                    scoutId,
                    power: powerAtHome,
                    totalPower,
                    isArmyBusy,
                    needs: this._analyzeVillageNeeds(village),
                    combatContract,
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

        const nemesisId = this._manageNemesis(gameState, ownerId, aiState, reasoningLog);

        const targets = this._scanAndClassifyTargets(
            gameState,
            offensiveReadyForces,
            ownerId,
            nemesisId,
            reasoningLog,
            NEMESIS_SPY_INTERVAL,
            GENERAL_SPY_INTERVAL,
        );

        let isMusteringForWar = false;
        let hasMaxPriorityGoal = false;
        let oasisFarmingTelemetry = null;

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
                                        hasMaxPriorityGoal = true;
                                        commands.push(...this._markCommandsAsMaxPriorityGoal(attackCmds, 'nemesis_assault'));
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

        const spyResults = this._performGeneralIntelligence(offensiveReadyForces, targets.unknown, nemesisId);
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

        if (!isMusteringForWar) {
            if (hasMaxPriorityGoal) {
                reasoningLog.push('[FARMEO ROI] farm bloqueado por prioridad máxima.');
            } else {
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
        }

        return {
            razonamiento: reasoningLog.join('\n'),
            comandos: commands,
            telemetry: {
                oasisFarming: oasisFarmingTelemetry,
                militaryGate: {
                    hasMaxPriorityGoal,
                    isMusteringForWar,
                    farmEvaluationExecuted: !hasMaxPriorityGoal && !isMusteringForWar,
                    farmBlockedByMaxPriorityGoal: hasMaxPriorityGoal && !isMusteringForWar,
                    offensiveSuppressedByReactive: blockedForces.length > 0,
                    blockedVillagesCount: blockedForces.length,
                    offensiveReadyVillages: offensiveReadyForces.length,
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

    _calculateEstimatedDefense(target) {
        const intel = target.intel || {};
        const estimatedDefenseTroops = intel.payload?.troops || {};
        const wallLevel = intel.payload?.buildings?.wallLevel || 0;
        return CombatFormulas.calculateDefensePoints(
            [{ troops: estimatedDefenseTroops, race: target.data.race, smithyUpgrades: {} }],
            { infantry: 0.5, cavalry: 0.5 },
            target.data.race,
            wallLevel,
            0,
        );
    }

    _planNemesisDestruction(bestForce, target, race, archetype, log) {
        if (!bestForce) return [];

        const intel = target.intel || {};
        const estimatedDefenseTroops = intel.payload?.troops || {};
        const wallLevel = intel.payload?.buildings?.wallLevel || 0;
        const defPower = this._calculateEstimatedDefense(target);

        if (defPower < 100) {
            const siegeCmds = this._planSiegeTrain(bestForce, target, log);
            if (siegeCmds.length > 0) return siegeCmds;
        }

        const fullAttack = { ...bestForce.combatTroops };
        const sim = this._simulateCombat(fullAttack, estimatedDefenseTroops, target.data.race, race, wallLevel, 'attack');

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

    _scanAndClassifyTargets(gameState, forces, myOwnerId, nemesisId, log, nemesisInterval, generalInterval) {
        return scanAndClassifyTargets({
            gameState,
            forces,
            myOwnerId,
            nemesisId,
            log,
            nemesisInterval,
            generalInterval,
            searchRadius,
        });
    }

    _dispatchSpies(forces, target, baseCount, log, reason, isRetry = false, lastCount = 0) {
        return dispatchSpies(forces, target, baseCount, log, reason, isRetry, lastCount);
    }

    _performGeneralIntelligence(forces, unknownTargets, nemesisId) {
        return performGeneralIntelligence(forces, unknownTargets, nemesisId, scoutsPerMission);
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
        if (reservedTroopsCount > 0) {
            reasons.push(`reservedTroops=${reservedTroopsCount}`);
        }
        if (preferredResponse === 'partial_dodge' || preferredResponse === 'full_dodge' || preferredResponse === 'hold_with_reinforcements' || preferredResponse === 'reinforce') {
            reasons.push(`preferredResponse=${preferredResponse}`);
        }

        return {
            blocked: reasons.length > 0,
            reasons,
        };
    }

    _simulateCombat(attackTroops, defenseTroops, defRace, attRace, wallLevel, type) {
        const attPoints = CombatFormulas.calculateAttackPoints(attackTroops, attRace, {});
        const defContingent = [{ troops: defenseTroops, race: defRace, smithyUpgrades: {} }];
        const defPoints = CombatFormulas.calculateDefensePoints(
            defContingent,
            { infantry: 0.5, cavalry: 0.5 },
            defRace,
            wallLevel,
            0,
        );

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
            if (attPoints.total > defPoints) {
                attackerLossPercent = CombatFormulas.calculateRaidWinnerLosses(attPoints.total, defPoints);
                defenderLossPercent = 1.0 - attackerLossPercent;
            } else {
                attackerLossPercent = 1.0 - CombatFormulas.calculateRaidWinnerLosses(defPoints, attPoints.total);
                defenderLossPercent = 1.0 - attackerLossPercent;
            }
        } else {
            if (attPoints.total > defPoints) {
                attackerLossPercent = CombatFormulas.calculateLosses(attPoints.total, defPoints);
                defenderLossPercent = 1.0;
            } else {
                attackerLossPercent = 1.0;
                defenderLossPercent = CombatFormulas.calculateLosses(defPoints, attPoints.total);
            }
        }

        return {
            winner: attPoints.total > defPoints ? 'attacker' : 'defender',
            losses: calculateLossesByRatio(attackTroops, attackerLossPercent),
            defenderLosses: calculateLossesByRatio(defenseTroops, defenderLossPercent),
        };
    }
}
