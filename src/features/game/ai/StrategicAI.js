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

export default class StrategicAI {
    constructor() {}

    computeMilitaryTurn(gameState, ownerId, race, archetype, personality, gameSpeed = 1) {
        const myVillages = gameState.villages.filter(v => v.ownerId === ownerId);
        const commands = [];
        const reasoningLog = [];

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
                });
            }
        });

        if (availableForces.length === 0) {
            return {
                razonamiento: `${reasoningLog.join('\n')}\n[ESTADO] Imperio sin fuerzas militares.`,
                comandos: [],
            };
        }

        const nemesisId = this._manageNemesis(gameState, ownerId, aiState, reasoningLog);

        const targets = this._scanAndClassifyTargets(
            gameState,
            availableForces,
            ownerId,
            nemesisId,
            reasoningLog,
            NEMESIS_SPY_INTERVAL,
            GENERAL_SPY_INTERVAL,
        );

        let isMusteringForWar = false;

        if (nemesisId) {
            const nemesisTarget = targets.known.find(t => t.ownerId === nemesisId) || targets.unknown.find(t => t.ownerId === nemesisId);

            if (nemesisTarget) {
                const hasActiveAttack = this._hasActiveAttack(gameState, nemesisTarget.id, ownerId);

                if (!hasActiveAttack) {
                    if (nemesisTarget.spyStatus === 'stale' || nemesisTarget.spyStatus === 'failed') {
                        const spyCmd = this._dispatchSpies(
                            availableForces,
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
                        const bestForce = this._getBestForce(availableForces);

                        if (bestForce) {
                            if (bestForce.totalPower > requiredPower) {
                                if (bestForce.power >= requiredPower) {
                                    const attackCmds = this._planNemesisDestruction(bestForce, nemesisTarget, race, archetype, reasoningLog);
                                    if (attackCmds.length > 0) commands.push(...attackCmds);
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

        const spyResults = this._performGeneralIntelligence(availableForces, targets.unknown, nemesisId);
        commands.push(...spyResults.commands);
        if (spyResults.logs.length > 0) reasoningLog.push(...spyResults.logs);

        if (commands.length === 0 && !isMusteringForWar) {
            const farmingResults = this._performOptimizedFarming(availableForces, targets.known, nemesisId, race, personality);
            commands.push(...farmingResults.commands);
            if (farmingResults.logs.length > 0) reasoningLog.push(...farmingResults.logs);
        }

        return {
            razonamiento: reasoningLog.join('\n'),
            comandos: commands,
        };
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

    _performOptimizedFarming(forces, knownTargets, nemesisId, race, personality) {
        return performOptimizedFarming({
            forces,
            knownTargets,
            nemesisId,
            race,
            personality,
            simulateCombat: this._simulateCombat.bind(this),
            consumeTroops: this._consumeTroops.bind(this),
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

        if (attPoints.total > defPoints) {
            const attackerLossRatio = type === 'raid'
                ? CombatFormulas.calculateRaidWinnerLosses(attPoints.total, defPoints)
                : CombatFormulas.calculateLosses(attPoints.total, defPoints);

            const losses = {};
            for (const unitId in attackTroops) {
                losses[unitId] = Math.round(attackTroops[unitId] * attackerLossRatio);
            }
            return { winner: 'attacker', losses };
        }

        return {
            winner: 'defender',
            losses: attackTroops,
        };
    }
}
