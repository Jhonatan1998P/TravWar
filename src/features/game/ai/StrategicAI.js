// RUTA: js/ai/StrategicAI.js
import {
    gameData
} from '../core/GameData.js';
import {
    CombatFormulas
} from '../core/CombatFormulas.js';

const SEARCH_RADIUS = 100;
const SCOUTS_PER_MISSION = 5;

// Configuración de Trenes de Asedio
const MIN_CATS_FOR_TRAIN = 20;
const MAX_WAVES = 5;

export default class StrategicAI {
    constructor() {}

    computeMilitaryTurn(gameState, ownerId, race, archetype, personality, gameSpeed = 1) {
        const myVillages = gameState.villages.filter(v => v.ownerId === ownerId);
        const commands = [];
        const reasoningLog = [];

        // CÁLCULO DE INTERVALOS DINÁMICOS
        const NEMESIS_SPY_INTERVAL = Math.max(5 * 60 * 1000, (24 * 60 * 60 * 1000) / gameSpeed);
        const GENERAL_SPY_INTERVAL = Math.max(10 * 60 * 1000, (48 * 60 * 60 * 1000) / gameSpeed);

        if (!personality) personality = {
            aggressionThreshold: 0
        };

        const aiState = gameState.aiState[ownerId] || {};
        if (!gameState.aiState[ownerId]) gameState.aiState[ownerId] = aiState;

        reasoningLog.push(`=== DOCTRINA DE GUERRA PROFESIONAL (${archetype.toUpperCase()}) ===`);

        const availableForces = [];

        // --- ANÁLISIS DE FUERZAS ---
        myVillages.forEach(village => {
            // 1. Tropas en casa
            const troopsAtHome = {
                ...village.unitsInVillage
            };

            // 2. Tropas fuera (Viajando o Reforzando)
            const troopsDeployed = this._calculateDeployedTroops(village.id, gameState);

            // 3. Fuerza Total (Casa + Fuera)
            const totalTroops = this._mergeTroops(troopsAtHome, troopsDeployed);

            // Datos de scouts
            const scoutUnitData = this._findUnitDataByType(race, 'scout');
            const scoutId = scoutUnitData ? scoutUnitData.id: null;

            const scoutCountAtHome = scoutId && troopsAtHome[scoutId] ? troopsAtHome[scoutId]: 0;
            const totalScoutCount = scoutId && totalTroops[scoutId] ? totalTroops[scoutId]: 0;

            // Preparar subconjuntos para combate
            const combatTroopsAtHome = {
                ...troopsAtHome
            };
            this._filterNonCombatTroops(combatTroopsAtHome, race);

            const totalCombatTroops = {
                ...totalTroops
            };
            this._filterNonCombatTroops(totalCombatTroops, race);

            const siegeTroopsAtHome = this._extractSiegeTroops(troopsAtHome, race);

            // Calcular Poder
            const powerAtHome = CombatFormulas.calculateAttackPoints(combatTroopsAtHome, race, village.smithy.upgrades).total;
            const totalPower = CombatFormulas.calculateAttackPoints(totalCombatTroops, race, village.smithy.upgrades).total;

            // Estado operativo: ¿Está el ejército disperso?
            const isArmyBusy = (powerAtHome < (totalPower * 0.8)); // Si tengo menos del 80% en casa, estoy ocupado

            if (totalPower > 0 || totalScoutCount > 0) {
                availableForces.push({
                    village,
                    troops: troopsAtHome, // Para ejecutar órdenes ahora
                    totalTroops: totalTroops, // Para saber mi fuerza real
                    combatTroops: combatTroopsAtHome,
                    siegeTroops: siegeTroopsAtHome,
                    scoutCount: scoutCountAtHome,
                    scoutId,
                    power: powerAtHome,
                    totalPower: totalPower,
                    isArmyBusy: isArmyBusy,
                    needs: this._analyzeVillageNeeds(village)
                });
            }
        });

        if (availableForces.length === 0) {
            return {
                razonamiento: reasoningLog.join('\n') + "\n[ESTADO] Imperio sin fuerzas militares.",
                comandos: []
            };
        }

        const nemesisId = this._manageNemesis(gameState, ownerId, aiState, reasoningLog);

        // Escaneo
        const targets = this._scanAndClassifyTargets(gameState, availableForces, ownerId, nemesisId, reasoningLog, NEMESIS_SPY_INTERVAL, GENERAL_SPY_INTERVAL);

        // Flag para detener el farmeo si estamos reagrupando para guerra
        let isMusteringForWar = false;

        // --- CAPA 1: OPERACIONES NÉMESIS ---
        if (nemesisId) {
            const nemesisTarget = targets.known.find(t => t.ownerId === nemesisId) ||
            targets.unknown.find(t => t.ownerId === nemesisId);

            if (nemesisTarget) {
                const hasActiveAttack = this._hasActiveAttack(gameState, nemesisTarget.id, ownerId);

                if (!hasActiveAttack) {
                    // 1.1 Espionaje
                    if (nemesisTarget.spyStatus === 'stale' || nemesisTarget.spyStatus === 'failed') {
                        const spyCmd = this._dispatchSpies(availableForces, nemesisTarget, SCOUTS_PER_MISSION, reasoningLog, "Intel Némesis", nemesisTarget.spyStatus === 'failed', nemesisTarget.lastSpyCount);
                        if (spyCmd) commands.push(spyCmd);
                    }
                    // 1.2 Ataque
                    else if (nemesisTarget.intel) {
                        // Calcular umbral de victoria necesario
                        const estimatedDefense = this._calculateEstimatedDefense(nemesisTarget);
                        const requiredPower = estimatedDefense * 1.2; // Margen del 20%

                        const bestForce = this._getBestForce(availableForces);

                        if (bestForce) {
                            // LÓGICA CRÍTICA DE REAGRUPAMIENTO
                            if (bestForce.totalPower > requiredPower) {
                                // Tenemos la fuerza TOTAL para ganar.
                                if (bestForce.power >= requiredPower) {
                                    // Y la tenemos en casa AHORA. ¡ATACAR!
                                    const attackCmds = this._planNemesisDestruction(bestForce, nemesisTarget, race, archetype, reasoningLog);
                                    if (attackCmds.length > 0) {
                                        commands.push(...attackCmds);
                                    }
                                } else {
                                    // Tenemos la fuerza total, pero está dispersa (farmeando).
                                    reasoningLog.push(`[ESTRATEGIA] 🛑 PROTOCOLO DE REAGRUPAMIENTO ACTIVADO.`);
                                    reasoningLog.push(`[ESTRATEGIA] Fuerza Total (${bestForce.totalPower.toFixed(0)}) suficiente para vencer defensa (${estimatedDefense.toFixed(0)}), pero fuerza actual (${bestForce.power.toFixed(0)}) es baja.`);
                                    reasoningLog.push(`[ESTRATEGIA] Cancelando operaciones de farmeo para reunir el ejército.`);
                                    isMusteringForWar = true; // <--- ESTO DETIENE EL FARMEO
                                }
                            } else {
                                // Ni con todo el ejército ganamos.
                                reasoningLog.push(`[ESTRATEGIA] Némesis demasiado fuerte (${estimatedDefense.toFixed(0)} def vs ${bestForce.totalPower.toFixed(0)} total). Continuando crecimiento económico.`);
                            }
                        }
                    }
                } else {
                    reasoningLog.push(`[ESPERA] Ataque en curso contra Némesis. Esperando reporte.`);
                }
            }
        }

        // --- CAPA 2: INTELIGENCIA GENERAL ---
        // El espionaje general sigue siendo permitido incluso si reagrupamos, es barato
        const spyResults = this._performGeneralIntelligence(availableForces, targets.unknown, nemesisId);
        commands.push(...spyResults.commands);
        if (spyResults.logs.length > 0) reasoningLog.push(...spyResults.logs);

        // --- CAPA 3: ECONOMÍA (Farming) ---
        // Solo farmear si NO hay comandos de guerra Y NO estamos reagrupando
        if (commands.length === 0 && !isMusteringForWar) {
            const farmingResults = this._performOptimizedFarming(availableForces, targets.known, nemesisId, race, personality);
            commands.push(...farmingResults.commands);
            if (farmingResults.logs.length > 0) reasoningLog.push(...farmingResults.logs);
        }

        return {
            razonamiento: reasoningLog.join('\n'),
            comandos: commands
        };
    }

    _calculateEstimatedDefense(target) {
        const intel = target.intel || {};
        const estimatedDefenseTroops = intel.payload?.troops || {};
        const wallLevel = intel.payload?.buildings?.wallLevel || 0;
        return CombatFormulas.calculateDefensePoints(
            [{
                troops: estimatedDefenseTroops, race: target.data.race, smithyUpgrades: {}
            }],
            {
                infantry: 0.5, cavalry: 0.5
            },
            target.data.race,
            wallLevel,
            0
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

        const fullAttack = {
            ...bestForce.combatTroops
        };
        const sim = this._simulateCombat(fullAttack, estimatedDefenseTroops, target.data.race, race, wallLevel, 'attack');

        if (sim.winner === 'attacker') {
            const totalMyTroops = Object.values(fullAttack).reduce((a, b)=>a+b, 0);
            const totalLost = Object.values(sim.losses).reduce((a, b)=>a+b, 0);
            const lossPercent = totalLost / totalMyTroops;
            const threshold = archetype === 'rusher' ? 0.95: 0.85;

            if (lossPercent <= threshold) {
                const troopsToSend = {
                    ...fullAttack
                };
                if (Object.keys(bestForce.siegeTroops).length > 0) Object.assign(troopsToSend, bestForce.siegeTroops);
                this._consumeTroops(bestForce, troopsToSend);
                log.push(`[GUERRA] Lanzando GOLPE DE ANIQUILACIÓN (Bajas est: ${(lossPercent*100).toFixed(0)}%).`);
                return [{
                    comando: 'ATTACK',
                    villageId: bestForce.village.id,
                    parametros: {
                        targetCoords: target.coords,
                        tropas: troopsToSend,
                        mision: 'attack',
                        catapultTargets: ['mainBuilding',
                            'granary']
                    }
                }];
            } else {
                log.push(`[GUERRA] Ataque retenido. Bajas excesivas (${(lossPercent*100).toFixed(0)}%).`);
            }
        } else {
            log.push(`[GUERRA] Ataque retenido. Derrota proyectada.`);
        }
        return [];
    }

    _calculateDeployedTroops(villageId, gameState) {
        const deployed = {};
        gameState.movements.forEach(m => {
            if (m.originVillageId === villageId) {
                for (const [unitId, count] of Object.entries(m.payload.troops)) {
                    deployed[unitId] = (deployed[unitId] || 0) + count;
                }
            }
        });
        gameState.villages.forEach(v => {
            if (v.id !== villageId) {
                v.reinforcements.forEach(r => {
                    if (r.fromVillageId === villageId) {
                        for (const [unitId, count] of Object.entries(r.troops)) {
                            deployed[unitId] = (deployed[unitId] || 0) + count;
                        }
                    }
                });
            }
        });
        return deployed;
    }

    _mergeTroops(troopsA, troopsB) {
        const merged = {
            ...troopsA
        };
        for (const [unitId, count] of Object.entries(troopsB)) {
            merged[unitId] = (merged[unitId] || 0) + count;
        }
        return merged;
    }

    _getBestForce(forces) {
        let best = null;
        let maxPower = -1;
        forces.forEach(f => {
            if (f.totalPower > maxPower) {
                maxPower = f.totalPower;
                best = f;
            }
        });
        return best;
    }

    _scanAndClassifyTargets(gameState,
        forces,
        myOwnerId,
        nemesisId,
        log,
        nemesisInterval,
        generalInterval) {
        const knownTargets = [];
        const unknownTargets = [];
        const scannedIds = new Set();

        forces.forEach(force => {
            const localTargets = this._scanTargets(gameState, force.village, SEARCH_RADIUS, myOwnerId);
            localTargets.forEach(target => {
                if (scannedIds.has(target.id)) return;
                scannedIds.add(target.id);
                if (target.type === 'oasis') {
                    knownTargets.push(target);
                } else {
                    const espAnalysis = this._analyzeEspionageHistory(gameState, target.id, myOwnerId);
                    const threshold = (target.ownerId === nemesisId) ? nemesisInterval: generalInterval;
                    const isIntelFresh = espAnalysis.lastSuccess && (Date.now() - espAnalysis.lastSuccess.time < threshold);
                    target.spyStatus = 'unknown';
                    target.lastSpyCount = 0;
                    if (espAnalysis.lastFailure && (!espAnalysis.lastSuccess || espAnalysis.lastFailure.time > espAnalysis.lastSuccess.time)) {
                        target.spyStatus = 'failed';
                        target.lastSpyCount = espAnalysis.lastFailureCount;
                    } else if (isIntelFresh) {
                        target.spyStatus = 'fresh';
                        target.intel = espAnalysis.lastSuccess;
                        knownTargets.push(target);
                    } else {
                        target.spyStatus = 'stale';
                        unknownTargets.push(target);
                    }
                    if (target.spyStatus === 'failed') {
                        if (!unknownTargets.includes(target)) unknownTargets.push(target);
                    }
                }
            });
        });
        return {
            known: knownTargets, unknown: unknownTargets
        };
    }

    _analyzeEspionageHistory(gameState, targetId, myOwnerId) {
        const mySpyReports = gameState.reports.filter(r =>
            r.type === 'espionage' &&
            r.attacker.ownerId === myOwnerId &&
            r.defender.villageId === targetId
        );
        let lastSuccess = null;
        let lastFailure = null;
        let lastFailureCount = 0;
        mySpyReports.sort((a,
            b) => b.time - a.time);
        for (const r of mySpyReports) {
            if (r.payload) {
                if (!lastSuccess) lastSuccess = r;
            } else {
                if (!lastFailure) {
                    lastFailure = r;
                    const scoutId = Object.keys(r.attacker.troops).find(uid => true);
                    if (scoutId) lastFailureCount = r.attacker.troops[scoutId];
                }
            }
            if (lastSuccess && lastFailure) break;
        }
        return {
            lastSuccess,
            lastFailure,
            lastFailureCount
        };
    }

    _dispatchSpies(forces, target, baseCount, log, reason, isRetry = false, lastCount = 0) {
        let countNeeded = baseCount;
        let mode = "Normal";
        if (isRetry) {
            mode = "Venganza";
            countNeeded = Math.max(baseCount, lastCount * 2);
        }
        let bestForce = null;
        let maxScouts = -1;
        for (const force of forces) {
            if (force.scoutCount > maxScouts) {
                maxScouts = force.scoutCount;
                bestForce = force;
            }
        }
        if (!bestForce) return null;
        if (isRetry) {
            if (bestForce.scoutCount >= countNeeded) {
                countNeeded = bestForce.scoutCount;
            } else {
                const scoutId = bestForce.scoutId;
                const totalScouts = bestForce.totalTroops[scoutId] || 0;
                if (totalScouts >= countNeeded) {
                    log.push(`[INTEL] Reintento pendiente. Espías ocupados (En casa: ${bestForce.scoutCount} / Total: ${totalScouts}). Esperando retorno.`);
                } else {
                    log.push(`[INTEL] Reintento fallido. Necesito ${countNeeded} espías, tengo ${totalScouts} en total. Se requiere reclutamiento.`);
                }
                return null;
            }
        } else {
            if (bestForce.scoutCount < countNeeded) return null;
        }
        bestForce.scoutCount -= countNeeded;
        bestForce.troops[bestForce.scoutId] -= countNeeded;
        log.push(`[INTEL] ${reason} (${mode}): ${target.data.name}. Enviando ${countNeeded} espías.`);
        return {
            comando: 'SPY',
            villageId: bestForce.village.id,
            parametros: {
                targetCoords: target.coords,
                tropas: {
                    [bestForce.scoutId]: countNeeded
                },
                mision: 'espionage'
            }
        };
    }

    _performGeneralIntelligence(forces, unknownTargets, nemesisId) {
        const commands = [];
        const logs = [];
        const others = unknownTargets.filter(t => t.ownerId !== nemesisId);
        others.sort((a, b) => a.dist - b.dist);
        others.forEach(target => {
            if (target.dist > 30) return;
            const isRetry = target.spyStatus === 'failed';
            const cmd = this._dispatchSpies(forces, target, SCOUTS_PER_MISSION, logs, "Exploración Rutinaria", isRetry, target.lastSpyCount);
            if (cmd) commands.push(cmd);
        });
        return {
            commands, logs
        };
    }

    _manageNemesis(gameState,
        myOwnerId,
        aiState,
        log) {
        let currentNemesisId = aiState.nemesisId;
        if (currentNemesisId) {
            const totalPop = this._getPlayerTotalPopulation(gameState, currentNemesisId);
            if (totalPop <= 3) {
                log.push(`[VICTORIA] Némesis ${currentNemesisId} eliminado. Buscando nueva víctima.`);
                currentNemesisId = null;
                aiState.nemesisId = null;
            }
        }
        if (!currentNemesisId) {
            const potentialVictims = this._findPotentialVictims(gameState, myOwnerId);
            if (potentialVictims.length > 0) {
                const victim = potentialVictims[Math.floor(Math.random() * potentialVictims.length)];
                currentNemesisId = victim.id;
                aiState.nemesisId = currentNemesisId;
                log.push(`[POLÍTICA] Nuevo Rival: ${victim.id} (Pob: ${victim.pop}).`);
            }
        }
        return currentNemesisId;
    }

    _planSiegeTrain(force, target, log) {
        const catapultId = Object.keys(force.siegeTroops).find(uid => {
            const u = gameData.units[force.village.race].troops.find(unit => unit.id === uid);
            return u && u.role === 'catapult';
        });
        if (!catapultId || !force.siegeTroops[catapultId]) return [];

        const totalCats = force.siegeTroops[catapultId];
        if (totalCats < MIN_CATS_FOR_TRAIN) {
            const troopsToSend = {
                ...force.combatTroops,
                ...force.siegeTroops
            };
            this._consumeTroops(force, troopsToSend);
            log.push(`[ASEDIO] Ataque único de limpieza.`);
            return [{
                comando: 'ATTACK',
                villageId: force.village.id,
                parametros: {
                    targetCoords: target.coords,
                    tropas: troopsToSend,
                    mision: 'attack',
                    catapultTargets: ['cropland',
                        'warehouse']
                }
            }];
        }

        const waves = Math.min(MAX_WAVES, Math.floor(totalCats / 10));
        const catsPerWave = Math.floor(totalCats / waves);

        const commands = [];
        const targetsList = [['cropland',
            'granary'],
            ['mainBuilding',
                'warehouse'],
            ['barracks',
                'stable'],
            ['marketplace',
                'wall'],
            ['cropland',
                'cropland']];
        const unitTypes = Object.keys(force.combatTroops);

        for (let i = 0; i < waves; i++) {
            const waveTroops = {};
            waveTroops[catapultId] = catsPerWave;
            unitTypes.forEach(uid => {
                const amount = Math.floor(force.combatTroops[uid] / waves);
                if (amount > 0) waveTroops[uid] = amount;
            });
            commands.push({
                comando: 'ATTACK',
                villageId: force.village.id,
                parametros: {
                    targetCoords: target.coords,
                    tropas: waveTroops,
                    mision: 'attack',
                    catapultTargets: targetsList[i % targetsList.length]
                }
            });
        }
        this._consumeTroops(force,
            force.combatTroops);
        this._consumeTroops(force,
            force.siegeTroops);
        log.push(`[ASEDIO] ¡TREN DE DESTRUCCIÓN LANZADO! ${waves} oleadas.`);
        return commands;
    }

    _performOptimizedFarming(forces, knownTargets, nemesisId, race, personality) {
        const commands = [];
        const logs = [];
        const opportunities = [];
        const visitedTargets = new Set();

        const farmTargets = knownTargets.filter(t => t.ownerId !== nemesisId);

        // 1. Generar Oportunidades
        farmTargets.forEach(target => {
            forces.forEach((force, forceIndex) => {
                if (force.power <= 0) return;

                const dist = Math.hypot(target.coords.x - force.village.coords.x, target.coords.y - force.village.coords.y);
                if (dist > 50) return;

                // Calcular Botín Potencial
                let potentialLoot = 0;
                let defenderTroops = {};
                let defRace = 'nature';

                if (target.type === 'oasis') {
                    const beasts = target.data.state?.beasts || {};
                    defenderTroops = { ...beasts };
                    const multiplier = gameData.config.oasis.beastBountyMultiplier || 40;
                    const natureUnits = gameData.units.nature.troops;
                    for (const [bid, count] of Object.entries(beasts)) {
                        const bData = natureUnits.find(u => u.id === bid);
                        if (bData) potentialLoot += (bData.upkeep * count * multiplier);
                    }
                } else {
                    const res = target.intel?.payload?.resources;
                    if (res) potentialLoot = res.wood + res.stone + res.iron + res.food;
                    defenderTroops = target.intel?.payload?.troops || {};
                    defRace = target.data.race;
                }

                if (potentialLoot === 0 && Object.keys(defenderTroops).length === 0) return; // Nada que ganar, nada que matar

                // Calcular Escuadrón Óptimo
                const squadConfig = this._calculateBestRaidConfig(force.combatTroops, defenderTroops, defRace, race, potentialLoot, force.village.smithy.upgrades);

                if (squadConfig) {
                    const score = squadConfig.netProfit / (dist + 10); // Penalizar distancia
                    if (squadConfig.netProfit > 0) {
                        opportunities.push({
                            score,
                            forceIndex,
                            target,
                            squad: squadConfig.squad,
                            profit: squadConfig.netProfit,
                            loot: potentialLoot,
                            dist
                        });
                    }
                }
            });
        });

        // 2. Ordenar por Puntuación (ROI / Distancia)
        opportunities.sort((a, b) => b.score - a.score);

        // 3. Ejecutar
        opportunities.forEach(opp => {
            const force = forces[opp.forceIndex];
            
            // Verificar si el objetivo ya fue tomado en este turno
            if (visitedTargets.has(opp.target.id)) return;
            
            // Verificar si la fuerza aún tiene las tropas necesarias
            let hasTroops = true;
            for (const uid in opp.squad) {
                if ((force.combatTroops[uid] || 0) < opp.squad[uid]) {
                    hasTroops = false;
                    break;
                }
            }

            if (hasTroops) {
                commands.push({
                    comando: 'ATTACK',
                    villageId: force.village.id,
                    parametros: {
                        targetCoords: opp.target.coords,
                        tropas: opp.squad,
                        mision: 'raid'
                    }
                });
                logs.push(`[FARMEO ROI] ${force.village.name} -> ${opp.target.type === 'oasis' ? 'Oasis' : opp.target.data.name} (Profit: ${opp.profit.toFixed(0)}, Dist: ${opp.dist.toFixed(1)})`);
                
                this._consumeTroops(force, opp.squad);
                visitedTargets.add(opp.target.id);
            }
        });

        return { commands, logs };
    }

    _calculateBestRaidConfig(availableTroops, defenderTroops, defRace, attRace, potentialLoot, smithyUpgrades) {
        const raceUnits = gameData.units[attRace].troops;
        
        // Clasificar unidades disponibles
        const availableUnits = [];
        for (const uid in availableTroops) {
            const uData = raceUnits.find(u => u.id === uid);
            if (uData && availableTroops[uid] > 0 && !['settler', 'chief', 'ram', 'catapult', 'scout'].includes(uData.role)) {
                availableUnits.push({
                    id: uid,
                    count: availableTroops[uid],
                    data: uData,
                    attackEff: uData.stats.attack / this._getUnitCost(uData), // Eficiencia de ataque por recurso
                    carryEff: (uData.stats.capacity * uData.stats.speed) / this._getUnitCost(uData) // Eficiencia de carga
                });
            }
        }

        // Calcular defensa
        const defPower = CombatFormulas.calculateDefensePoints(
            [{ troops: defenderTroops, race: defRace, smithyUpgrades: {} }],
            { infantry: 0.5, cavalry: 0.5 },
            defRace, 0, 0
        );

        const squad = {};
        let currentAttack = 0;
        let currentCapacity = 0;
        let totalCostOfSquad = 0;

        // FASE 1: SUPERAR DEFENSA (Overkill 30%)
        if (defPower > 0) {
            const targetAttack = defPower * 1.3;
            // Ordenar por eficiencia de ataque
            availableUnits.sort((a, b) => b.attackEff - a.attackEff);

            for (const unit of availableUnits) {
                if (currentAttack >= targetAttack) break;
                
                const needed = Math.ceil((targetAttack - currentAttack) / unit.data.stats.attack);
                const take = Math.min(unit.count, needed);
                
                if (take > 0) {
                    squad[unit.id] = (squad[unit.id] || 0) + take;
                    unit.count -= take;
                    currentAttack += take * unit.data.stats.attack;
                    currentCapacity += take * unit.data.stats.capacity;
                    totalCostOfSquad += take * this._getUnitCost(unit.data);
                }
            }

            // Si no alcanzamos el poder necesario, abortar (no suicidar tropas)
            if (currentAttack < defPower * 1.1) return null;
        }

        // FASE 2: CAPACIDAD DE CARGA
        if (currentCapacity < potentialLoot) {
            // Ordenar por eficiencia de carga
            availableUnits.sort((a, b) => b.carryEff - a.carryEff);

            for (const unit of availableUnits) {
                if (currentCapacity >= potentialLoot) break;
                if (unit.count <= 0) continue;

                const needed = Math.ceil((potentialLoot - currentCapacity) / unit.data.stats.capacity);
                const take = Math.min(unit.count, needed);

                squad[unit.id] = (squad[unit.id] || 0) + take;
                unit.count -= take;
                currentCapacity += take * unit.data.stats.capacity;
                currentAttack += take * unit.data.stats.attack;
                totalCostOfSquad += take * this._getUnitCost(unit.data);
            }
        }

        if (Object.keys(squad).length === 0) return null;

        // FASE 3: SIMULACIÓN DE PÉRDIDAS Y ROI
        const sim = this._simulateCombat(squad, defenderTroops, defRace, attRace, 0, 'raid');
        
        let lossValue = 0;
        for (const uid in sim.losses) {
            const uData = raceUnits.find(u => u.id === uid);
            lossValue += this._getUnitCost(uData) * sim.losses[uid];
        }

        const netProfit = potentialLoot - lossValue;

        return { squad, netProfit };
    }

    _getUnitCost(unitData) {
        if (!unitData.cost) return 0;
        return (unitData.cost.wood || 0) + (unitData.cost.stone || 0) + (unitData.cost.iron || 0) + (unitData.cost.food || 0);
    }

    _hasActiveAttack(gameState, targetId, ownerId) {
        return gameState.movements.some(m =>
            m.ownerId === ownerId &&
            m.type === 'attack' &&
            this._getTargetIdFromCoords(gameState, m.targetCoords) === targetId
        );
    }

    _getTargetIdFromCoords(gameState, coords) {
        const tile = gameState.spatialIndex.get(`${coords.x}|${coords.y}`);
        return tile ? (tile.villageId || `oasis_${tile.x}_${tile.y}`): null;
    }

    _consumeTroops(force, troopsUsed) {
        for (const uid in troopsUsed) {
            if (force.troops[uid]) force.troops[uid] -= troopsUsed[uid];
            if (force.combatTroops[uid]) force.combatTroops[uid] -= troopsUsed[uid];
            if (force.siegeTroops[uid]) force.siegeTroops[uid] -= troopsUsed[uid];
        }
    }

    _getPlayerTotalPopulation(gameState, ownerId) {
        return gameState.villages.filter(v => v.ownerId === ownerId).reduce((sum, v) => sum + v.population.current, 0);
    }

    _findPotentialVictims(gameState, myOwnerId) {
        const targetCounts = {};
        gameState.players.forEach(p => targetCounts[p.id] = 0);
        for (const aiId in gameState.aiState) {
            if (aiId === myOwnerId) continue;
            const otherAiNemesis = gameState.aiState[aiId].nemesisId;
            if (otherAiNemesis) targetCounts[otherAiNemesis] = (targetCounts[otherAiNemesis] || 0) + 1;
        }
        let candidates = gameState.players.filter(p => {
            if (p.id === myOwnerId || p.id === 'nature') return false;
            const pop = this._getPlayerTotalPopulation(gameState, p.id);
            if (pop <= 3) return false;
            if (targetCounts[p.id] >= 2) return false;
            p.pop = pop;
            return true;
        });
        if (candidates.length === 0) {
            candidates = gameState.players.filter(p => {
                if (p.id === myOwnerId || p.id === 'nature') return false;
                const pop = this._getPlayerTotalPopulation(gameState, p.id);
                if (pop <= 3) return false;
                p.pop = pop;
                return true;
            });
        }
        return candidates;
    }

    _findUnitDataByType(race,
        type) {
        const raceUnits = gameData.units[race]?.troops;
        if (!raceUnits) return null;
        return raceUnits.find(u => u.type === type);
    }

    _scanTargets(gameState, village, radius, myOwnerId) {
        const targets = [];
        for (const v of gameState.villages) {
            if (v.ownerId === myOwnerId || v.ownerId === 'nature') continue;
            const dist = Math.hypot(v.coords.x - village.coords.x, v.coords.y - village.coords.y);
            if (dist <= radius) {
                targets.push({
                    type: 'village',
                    data: v,
                    coords: v.coords,
                    id: v.id,
                    dist,
                    population: v.population,
                    ownerId: v.ownerId
                });
            }
        }
        for (const tile of gameState.mapData) {
            if (tile.type !== 'oasis') continue;
            const dist = Math.hypot(tile.x - village.coords.x, tile.y - village.coords.y);
            if (dist <= radius) {
                targets.push({
                    type: 'oasis',
                    data: tile,
                    coords: {
                        x: tile.x, y: tile.y
                    },
                    id: `oasis_${tile.x}_${tile.y}`,
                    dist,
                    ownerId: 'nature'
                });
            }
        }
        return targets;
    }

    _analyzeVillageNeeds(village) {
        const needs = {
            wood: 1,
            stone: 1,
            iron: 1,
            food: 1
        };
        let minPercent = 1.0;
        let scarcestRes = '';
        for (const res in village.resources) {
            const percent = village.resources[res].current / village.resources[res].capacity;
            if (percent < minPercent) {
                minPercent = percent; scarcestRes = res;
            }
        }
        if (scarcestRes) needs[scarcestRes] = 2.5;
        if (village.resources.food.production < 0) needs.food = 5.0;
        return needs;
    }

    _filterNonCombatTroops(troops, race) {
        const raceUnits = gameData.units[race].troops;
        for (const unitId in troops) {
            const unit = raceUnits.find(u => u.id === unitId);
            if (!unit || ['settler', 'chief', 'scout'].includes(unit.type)) delete troops[unitId];
        }
    }

    _extractSiegeTroops(troops, race) {
        const siege = {};
        const raceUnits = gameData.units[race].troops;
        for (const unitId in troops) {
            const unit = raceUnits.find(u => u.id === unitId);
            if (unit && ['ram', 'catapult'].includes(unit.role)) {
                siege[unitId] = troops[unitId];
            }
        }
        return siege;
    }

    _simulateCombat(attackTroops, defenseTroops, defRace, attRace, wallLevel, type) {
        const attPoints = CombatFormulas.calculateAttackPoints(attackTroops, attRace, {});
        const defContingent = [{
            troops: defenseTroops,
            race: defRace,
            smithyUpgrades: {}
        }];
        const defPoints = CombatFormulas.calculateDefensePoints(defContingent, {
            infantry: 0.5, cavalry: 0.5
        }, defRace, wallLevel, 0);

        let attackerLossRatio = 0;
        if (attPoints.total > defPoints) {
            attackerLossRatio = type === 'raid'
            ? CombatFormulas.calculateRaidWinnerLosses(attPoints.total, defPoints): CombatFormulas.calculateLosses(attPoints.total, defPoints);

            const losses = {};
            for (const uid in attackTroops) losses[uid] = Math.round(attackTroops[uid] * attackerLossRatio);
            return {
                winner: 'attacker',
                losses
            };
        } else {
            return {
                winner: 'defender',
                losses: attackTroops
            };
        }
    }

}