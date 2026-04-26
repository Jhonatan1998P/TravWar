// RUTA: js/engine/CombatEngine.js
import { gameData, NON_TARGETABLE_BUILDINGS } from '../core/GameData.js';
import { CombatFormulas } from '../core/CombatFormulas.js';
import { MemoryManager } from '../ai/index.js';
import { calculateBeastBountyValue } from '../core/OasisEconomy.js';
import { getScaledCrannyCapacity } from '../core/capacityScaling.js';

let returnMovementIdSequence = 0;
const OASIS_CAPTURE_RANGE = 7;

function createReturnMovementId(now, originVillageId) {
    returnMovementIdSequence = (returnMovementIdSequence + 1) % 1000000;
    return `${now}-mov-return-${originVillageId}-${returnMovementIdSequence}`;
}

function getHeroMansionOasisSlots(village) {
    const level = village?.buildings?.find(building => building.type === 'heroMansion')?.level || 0;
    if (level >= 20) return 3;
    if (level >= 15) return 2;
    if (level >= 10) return 1;
    return 0;
}

function isOasisInCaptureRange(village, targetCoords) {
    return Math.abs(targetCoords.x - village.coords.x) <= OASIS_CAPTURE_RANGE
        && Math.abs(targetCoords.y - village.coords.y) <= OASIS_CAPTURE_RANGE;
}

function hasLivingBeasts(beasts = {}) {
    return Object.values(beasts).some(count => count > 0);
}

export class CombatEngine {
    _gameState;
    _gameConfig;
    _movement;
    _results;

    constructor(gameState, gameConfig = null) {
        this._gameState = gameState;
        this._gameConfig = gameConfig;
    }

    processMovement(movement) {
        this._movement = movement;
        this._results = {
            reportsToCreate: [],
            movementsToCreate: [],
            aiNotifications: [],
            stateChanges: {
                villageUpdates: [],
                tileUpdates: []
            }
        };

        switch (movement.type) {
            case 'attack':
            case 'raid':
                this._handleAttackArrival();
                break;
            case 'espionage':
                this._handleEspionageArrival();
                break;
        }

        if (this._movement.type === 'attack' || this._movement.type === 'raid') {
            const memoryManager = new MemoryManager(this._gameState);
            const allParticipants = new Set(this._results.reportsToCreate.map(r => r.ownerId));
            
            allParticipants.forEach(ownerId => {
                const participantReport = this._results.reportsToCreate.find(r => r.ownerId === ownerId);
                if (participantReport) {
                    memoryManager.recordBattleOutcome(participantReport, ownerId);
                }
            });
        }

        return this._results;
    }

    _getParticipantInfo(ownerId, villageId, fallbackCoords) {
        const player = this._gameState.players.find(p => p.id === ownerId);
        const village = this._gameState.villages.find(v => v.id === villageId);
        
        return {
            ownerId: ownerId,
            playerName: player ? player.name : (ownerId === 'nature' ? 'Naturaleza' : 'Desconocido'),
            villageId: villageId,
            villageName: village ? village.name : (fallbackCoords ? `Oasis ${fallbackCoords.x}|${fallbackCoords.y}`: 'Aldea Desconocida'),
            coords: village ? village.coords : fallbackCoords,
            race: player ? player.race : (village ? village.race : (ownerId === 'nature' ? 'nature' : 'romans'))
        };
    }
    
    _handleEspionageArrival() {
        const attackerInfo = this._getParticipantInfo(this._movement.ownerId, this._movement.originVillageId);
        
        // OPTIMIZADO: Uso de spatialIndex
        const targetTile = this._gameState.spatialIndex.get(`${this._movement.targetCoords.x}|${this._movement.targetCoords.y}`);
        
        const isOasis = targetTile?.type === 'oasis';
        const defenderVillage = !isOasis && targetTile?.type === 'village' ? this._gameState.villages.find(v => v.id === targetTile.villageId) : null;
        const defenderInfo = this._getParticipantInfo(defenderVillage?.ownerId, defenderVillage?.id, this._movement.targetCoords);

        let attackerScoutingPower = 0;
        const attackerRaceData = gameData.units[attackerInfo.race];
        for (const unitId in this._movement.payload.troops) {
            const count = this._movement.payload.troops[unitId];
            const unitData = attackerRaceData.troops.find(u => u.id === unitId);
            if (unitData && unitData.type === 'scout') {
                attackerScoutingPower += count * 35;
            }
        }

        let defenderScoutingPower = 0;
        const defendingScouts = {};

        const addDefendingScouts = (troops, race) => {
            const raceData = gameData.units[race];
            if (!raceData) return;
            for (const unitId in troops) {
                const unitData = raceData.troops.find(u => u.id === unitId);
                if (unitData && unitData.type === 'scout') {
                    const count = troops[unitId];
                    defenderScoutingPower += count * 20;
                    defendingScouts[unitId] = (defendingScouts[unitId] || 0) + count;
                }
            }
        };

        if (defenderVillage) {
            addDefendingScouts(defenderVillage.unitsInVillage, defenderVillage.race);
            defenderVillage.reinforcements.forEach(reinf => addDefendingScouts(reinf.troops, reinf.race));
            
            const rallyPointLevel = defenderVillage.buildings.find(b => b.type === 'rallyPoint')?.level || 0;
            defenderScoutingPower += rallyPointLevel * 5;
        } else if (isOasis && targetTile.state?.beasts) {
            addDefendingScouts(targetTile.state.beasts, 'nature');
        }

        let attackerLossPercent = 0;
        let defenderLossPercent = 0;
        
        if (attackerScoutingPower > 0 || defenderScoutingPower > 0) {
            const isAttackerStronger = attackerScoutingPower > defenderScoutingPower;

            if (isAttackerStronger) {
                const ratio = defenderScoutingPower / attackerScoutingPower;
                attackerLossPercent = Math.pow(ratio, 1.5);
                defenderLossPercent = 1;
            } else {
                const ratio = attackerScoutingPower / defenderScoutingPower;
                attackerLossPercent = 1;
                defenderLossPercent = Math.pow(ratio, 1.5);
            }
        }
        
        const attackerLosses = {};
        let survivingScoutsCount = 0;
        const survivingScouts = { ...this._movement.payload.troops };

        for (const unitId in this._movement.payload.troops) {
            const lostCount = Math.round(this._movement.payload.troops[unitId] * attackerLossPercent);
            if (lostCount > 0) attackerLosses[unitId] = lostCount;
            survivingScouts[unitId] -= lostCount;
            if (survivingScouts[unitId] <= 0) delete survivingScouts[unitId];
            else survivingScoutsCount += survivingScouts[unitId];
        }

        const informationObtained = survivingScoutsCount > 0;
        const winnerName = attackerScoutingPower > defenderScoutingPower ? attackerInfo.playerName : defenderInfo.playerName;
        
        const defenderLosses = {};
        for(const unitId in defendingScouts) {
            const lostCount = Math.round(defendingScouts[unitId] * defenderLossPercent);
            if(lostCount > 0) defenderLosses[unitId] = lostCount;
        }

        const attackerReport = {
            id: `rep-att-${this._movement.arrivalTime}`, ownerId: this._movement.ownerId, type: 'espionage',
            time: this._movement.arrivalTime, winner: winnerName,
            attacker: { ...attackerInfo, troops: this._movement.payload.troops, losses: attackerLosses },
            defender: { ...defenderInfo, troops: defendingScouts, losses: defenderLosses },
            payload: null
        };

        if (informationObtained) {
            let payloadData = null;
            if (defenderVillage) {
                const wallLevel = defenderVillage.buildings.find(b => b.type === 'cityWall')?.level || 0;
                const residenceLevel = defenderVillage.buildings.find(b => b.type === 'residence' || b.type === 'palace')?.level || 0;
                
                const defendingContingents = [{ id: defenderVillage.id, troops: { ...defenderVillage.unitsInVillage }, race: defenderVillage.race, smithyUpgrades: defenderVillage.smithy.upgrades || {} }];
                defenderVillage.reinforcements.forEach(reinforcement => {
                    const reinforcingVillage = this._gameState.villages.find(v => v.id === reinforcement.fromVillageId);
                    const smithyUpgrades = reinforcingVillage ? (reinforcingVillage.smithy.upgrades || {}) : (reinforcement.smithyUpgradesSnapshot || {});
                    const contingentRace = reinforcement.race && gameData.units[reinforcement.race] ? reinforcement.race : 'romans';
                    defendingContingents.push({ id: reinforcement.fromVillageId, troops: { ...reinforcement.troops }, race: contingentRace, smithyUpgrades: smithyUpgrades });
                });

                payloadData = {
                    resources: {
                        wood: Math.floor(defenderVillage.resources.wood.current), stone: Math.floor(defenderVillage.resources.stone.current),
                        iron: Math.floor(defenderVillage.resources.iron.current), food: Math.floor(defenderVillage.resources.food.current)
                    },
                    buildings: { wallLevel, residenceLevel },
                    troops: defenderVillage.unitsInVillage,
                    refuerzos_vistos: defenderVillage.reinforcements,
                };

                const genericAttackerProportions = { infantry: 0.5, cavalry: 0.5 };
                const calculatedDefense = CombatFormulas.calculateDefensePoints(defendingContingents, genericAttackerProportions, defenderVillage.race, wallLevel, residenceLevel);
                payloadData.poder_defensivo_calculado = Math.floor(calculatedDefense);

            } else if (isOasis) {
                payloadData = {
                    resources: null, buildings: null,
                    troops: targetTile.state?.beasts || {},
                    refuerzos_vistos: []
                };
                const natureContingents = [{ troops: targetTile.state?.beasts, race: 'nature', smithyUpgrades: {} }];
                const genericAttackerProportions = { infantry: 0.5, cavalry: 0.5 };
                const calculatedDefense = CombatFormulas.calculateDefensePoints(natureContingents, genericAttackerProportions, 'nature', 0, 0);
                payloadData.poder_defensivo_calculado = Math.floor(calculatedDefense);
            }
            attackerReport.payload = payloadData;

            if (attackerInfo.ownerId.startsWith('ai_')) {
                const memoryManager = new MemoryManager(this._gameState);
                memoryManager.recordEspionage(attackerReport);
                this._results.aiNotifications.push({
                    type: 'espionage_success',
                    targetAiId: attackerInfo.ownerId,
                    payload: { report: attackerReport }
                });
            }
        }
        this._results.reportsToCreate.push(attackerReport);
        
        if (defenderVillage && defenderInfo.ownerId) {
            const defenderReport = {
                id: `rep-def-${this._movement.arrivalTime}`, ownerId: defenderInfo.ownerId, type: 'espionage_defense',
                time: this._movement.arrivalTime, winner: winnerName,
                attacker: { ...attackerInfo, troops: this._movement.payload.troops, losses: attackerLosses },
                defender: { ...defenderInfo, troops: defendingScouts, losses: defenderLosses },
                espionageDetected: true,
                payload: attackerReport.payload 
            };
            this._results.reportsToCreate.push(defenderReport);
        }
    
        const returnMovement = this._createReturnMovement(survivingScouts);
        if (returnMovement) {
            this._results.movementsToCreate.push(returnMovement);
        }
    }
    
    _handleAttackArrival() {
        const attackerInfo = this._getParticipantInfo(this._movement.ownerId, this._movement.originVillageId);
        const attackerVillage = this._gameState.villages.find(v => v.id === this._movement.originVillageId);
        const attackerSmithy = attackerVillage?.smithy.upgrades || {};
        const attackPoints = CombatFormulas.calculateAttackPoints(this._movement.payload.troops, attackerInfo.race, attackerSmithy);
        
        const totalAttackPowerWithSiege = attackPoints.total + attackPoints.siege;
        if (totalAttackPowerWithSiege === 0) return;

        // OPTIMIZADO: Uso de spatialIndex
        const targetTile = this._gameState.spatialIndex.get(`${this._movement.targetCoords.x}|${this._movement.targetCoords.y}`);
        
        const defenderVillage = targetTile?.type === 'village' ? this._gameState.villages.find(v => v.id === targetTile.villageId) : null;
        
        let defenderOwnerId = 'nature';
        if (defenderVillage) {
            defenderOwnerId = defenderVillage.ownerId;
        }
        const defenderInfo = this._getParticipantInfo(defenderOwnerId, defenderVillage?.id, this._movement.targetCoords);

        let wallLevel = defenderVillage ? defenderVillage.buildings.find(b => b.type === 'cityWall')?.level || 0 : 0;
        let palaceLevel = defenderVillage ? defenderVillage.buildings.find(b => b.type === 'residence' || b.type === 'palace')?.level || 0 : 0;
        let wallDamage = null;
        let buildingDamage = [];
        let oasisConquest = null;

        const defendingContingents = [];
        if (defenderVillage) {
            if (Object.keys(defenderVillage.unitsInVillage).length > 0) {
                defendingContingents.push({ id: defenderVillage.id, troops: { ...defenderVillage.unitsInVillage }, race: defenderInfo.race, smithyUpgrades: defenderVillage.smithy.upgrades || {} });
            }
            defenderVillage.reinforcements.forEach(reinforcement => {
                const reinforcingVillage = this._gameState.villages.find(v => v.id === reinforcement.fromVillageId);
                const smithyUpgrades = reinforcingVillage ? (reinforcingVillage.smithy.upgrades || {}) : (reinforcement.smithyUpgradesSnapshot || {});
                const contingentRace = reinforcement.race && gameData.units[reinforcement.race] ? reinforcement.race : 'romans';
                defendingContingents.push({ id: reinforcement.fromVillageId, troops: { ...reinforcement.troops }, race: contingentRace, smithyUpgrades: smithyUpgrades });
            });
        } else if (targetTile?.type === 'oasis' && targetTile.state?.beasts) {
            const natureTroops = { ...targetTile.state.beasts };
            if (Object.keys(natureTroops).length > 0) {
                defendingContingents.push({ id: 'nature', troops: natureTroops, race: 'nature', smithyUpgrades: {} });
            }
        }

        const tempDefenseForRamCalc = CombatFormulas.calculateDefensePoints(defendingContingents, { infantry: 0.5, cavalry: 0.5 }, defenderInfo.race, wallLevel, palaceLevel, 1.0);
        
        const ramCount = Object.keys(this._movement.payload.troops).reduce((sum, unitId) => {
            const unitData = gameData.units[attackerInfo.race]?.troops.find(u => u.id === unitId);
            return unitData?.role === 'ram' ? sum + this._movement.payload.troops[unitId] : sum;
        }, 0);

        if (this._movement.type === 'attack' && defenderVillage && ramCount > 0) {
            try {
                const initialWallLevel = wallLevel;
                const ramEffectiveness = CombatFormulas.calculateRamEffectiveness(attackPoints.total, tempDefenseForRamCalc);
                const levelsDestroyed = CombatFormulas.calculateWallDamage(ramCount, ramEffectiveness, initialWallLevel);
                const damageDone = levelsDestroyed > 0;
                const finalLevel = Math.max(0, initialWallLevel - levelsDestroyed);
                wallDamage = { initial: initialWallLevel, final: finalLevel, damageDone };
                if (damageDone) {
                    this._results.stateChanges.villageUpdates.push({ villageId: defenderVillage.id, changes: { buildingLevel: { buildingId: 'v_wall', newLevel: finalLevel } } });
                    wallLevel = finalLevel;
                }
            } catch (e) {
                wallDamage = { error: "Hubo un error en los calculos del daño de los arietes." };
            }
        }

        const attackerPop = this._getOwnerPopulation(this._movement.ownerId);
        const defenderPop = this._getOwnerPopulation(defenderVillage?.ownerId);
        const moraleBonus = defenderInfo.race === 'nature'
            ? 1.0
            : CombatFormulas.getMoraleBonus(attackerPop, defenderPop);
        
        const attackerProportions = { infantry: attackPoints.infantry / attackPoints.total, cavalry: attackPoints.cavalry / attackPoints.total };
        const defensePoints = CombatFormulas.calculateDefensePoints(defendingContingents, attackerProportions, defenderInfo.race, wallLevel, palaceLevel, moraleBonus);
        
        const attackerWins = attackPoints.total > defensePoints;
        let winnerName = attackerWins ? attackerInfo.playerName : defenderInfo.playerName;
        if (attackPoints.total === defensePoints) winnerName = "Empate";

        let attackerLossPercent = 0;
        let defenderLossPercent = 0;

        if (this._movement.type === 'raid') {
            attackerLossPercent = attackerWins ? CombatFormulas.calculateRaidWinnerLosses(attackPoints.total, defensePoints) : 1.0 - CombatFormulas.calculateRaidWinnerLosses(defensePoints, attackPoints.total);
            defenderLossPercent = 1.0 - attackerLossPercent;
        } else {
            attackerLossPercent = attackerWins ? CombatFormulas.calculateLosses(attackPoints.total, defensePoints) : 1.0;
            defenderLossPercent = attackerWins ? 1.0 : CombatFormulas.calculateLosses(defensePoints, attackPoints.total);
        }

        const catapultCount = Object.keys(this._movement.payload.troops).reduce((sum, unitId) => {
            const unitData = gameData.units[attackerInfo.race]?.troops.find(u => u.id === unitId);
            return unitData?.role === 'catapult' ? sum + this._movement.payload.troops[unitId] : sum;
        }, 0);

        if (this._movement.type === 'attack' && defenderVillage && catapultCount > 0) {
            try {
                const siegeEffectiveness = CombatFormulas.calculateSiegeEffectiveness(attackPoints.total, defensePoints);
                const mainBuildingLevel = attackerVillage?.buildings.find(b => b.type === 'mainBuilding')?.level || 0;
                const desiredTargets = this._movement.payload.catapultTargets || [];
                const targetableBuildings = defenderVillage.buildings.filter(b => b.level > 0 && !NON_TARGETABLE_BUILDINGS.includes(b.type));
                
                let finalTargets = [];

                if (mainBuildingLevel < 10) {
                    if (targetableBuildings.length > 0) {
                        const randomIndex = Math.floor(Math.random() * targetableBuildings.length);
                        finalTargets.push(targetableBuildings[randomIndex]);
                    }
                } else {
                    const maxTargets = mainBuildingLevel >= 20 ? 2 : 1;
                    if (desiredTargets.length > 0) {
                        finalTargets = desiredTargets.slice(0, maxTargets)
                            .map(bType => targetableBuildings.find(b => b.type === bType))
                            .filter(Boolean);
                    }
                    
                    if (finalTargets.length === 0 && targetableBuildings.length > 0) {
                        const numRandomTargets = maxTargets - finalTargets.length;
                        for (let i = 0; i < numRandomTargets && targetableBuildings.length > 0; i++) {
                            const randomIndex = Math.floor(Math.random() * targetableBuildings.length);
                            finalTargets.push(targetableBuildings.splice(randomIndex, 1)[0]);
                        }
                    }
                }

                const catapultsPerTarget = finalTargets.length > 0 ? Math.floor(catapultCount / finalTargets.length) : 0;

                finalTargets.forEach((target, index) => {
                    if (!target || catapultsPerTarget === 0) return;

                    let demolitionPowerModifier = 1.0;
                    if (index === 1) { 
                        demolitionPowerModifier = 0.5;
                    }

                    const initialLevel = target.level;
                    const levelsDestroyed = CombatFormulas.calculateBuildingDamage(catapultsPerTarget * demolitionPowerModifier, siegeEffectiveness, initialLevel);
                    const damageDone = levelsDestroyed > 0;
                    const finalLevel = Math.max(0, initialLevel - levelsDestroyed);
                    
                    buildingDamage.push({ name: gameData.buildings[target.type].name, initial: initialLevel, final: finalLevel, damageDone });
                    
                    if (damageDone) {
                        const changePayload = { buildingId: target.id, newLevel: finalLevel };
                        if (finalLevel === 0 && /^v/.test(target.id)) {
                            changePayload.newType = 'empty';
                        }
                        this._results.stateChanges.villageUpdates.push({ villageId: defenderVillage.id, changes: { buildingLevel: changePayload } });
                    }
                });
            } catch(e) {
                buildingDamage.push({ error: "Hubo un error en los calculos de daño de las catapultas." });
            }
        }

        const calculateSideLosses = (contingent, lossPercent) => {
            const losses = {};
            let lostUpkeep = 0;
            const lostResources = { wood: 0, stone: 0, iron: 0, food: 0 };
            const raceData = gameData.units[contingent.race];

            for (const unitId in contingent.troops) {
                const count = contingent.troops[unitId];
                const unitData = raceData.troops.find(u => u.id === unitId);
                if (!unitData) continue;
                const numLosses = Math.round(count * lossPercent);
                if (numLosses > 0) {
                    losses[unitId] = numLosses;
                    lostUpkeep += unitData.upkeep * numLosses;
                    if (unitData.cost) {
                        for (const res in unitData.cost) {
                            lostResources[res] += unitData.cost[res] * numLosses;
                        }
                    }
                }
            }
            return { losses, lostUpkeep, lostResources };
        };

        const attackerContingent = [{ troops: this._movement.payload.troops, race: attackerInfo.race, smithyUpgrades: attackerSmithy }];
        const attackerResults = calculateSideLosses(attackerContingent[0], attackerLossPercent);
        
        const defenderContingentResults = defendingContingents.map(c => ({ ...c, ...calculateSideLosses(c, defenderLossPercent) }));
        
        const totalDefenderLosses = { losses: {}, lostUpkeep: 0, lostResources: { wood: 0, stone: 0, iron: 0, food: 0 } };
        const totalDefenderTroops = {};

        defendingContingents.forEach(contingent => {
            for (const unitId in contingent.troops) {
                totalDefenderTroops[unitId] = (totalDefenderTroops[unitId] || 0) + contingent.troops[unitId];
            }
        });

        defenderContingentResults.forEach(result => {
            for (const unitId in result.losses) {
                totalDefenderLosses.losses[unitId] = (totalDefenderLosses.losses[unitId] || 0) + result.losses[unitId];
            }
            totalDefenderLosses.lostUpkeep += result.lostUpkeep;
            for (const res in result.lostResources) {
                totalDefenderLosses.lostResources[res] += result.lostResources[res];
            }
        });

        const survivingAttackerTroops = { ...this._movement.payload.troops };
        for (const unitId in attackerResults.losses) {
            survivingAttackerTroops[unitId] -= attackerResults.losses[unitId];
            if (survivingAttackerTroops[unitId] <= 0) delete survivingAttackerTroops[unitId];
        }
        
        if (defenderVillage) {
            this._results.stateChanges.villageUpdates.push({ villageId: defenderVillage.id, changes: { troopLosses: defenderContingentResults } });
        } else if (targetTile?.type === 'oasis' && targetTile.state?.beasts) {
            const natureResult = defenderContingentResults.find(r => r.id === 'nature');
            if (natureResult) {
                this._results.stateChanges.tileUpdates.push({ coords: targetTile, changes: { beastLosses: natureResult.losses } });
                const natureContingent = defendingContingents.find(c => c.id === 'nature');
                let totalBeastsKilled = 0;
                let totalInitialBeasts = 0;
                for(const unitId in natureContingent.troops) {
                    totalInitialBeasts += natureContingent.troops[unitId];
                    totalBeastsKilled += natureResult.losses[unitId] || 0;
                }
                if (totalBeastsKilled >= totalInitialBeasts && !targetTile.state.isClearedOnce) {
                    this._results.stateChanges.tileUpdates.push({ coords: targetTile, changes: { enableRegeneration: true } });
                }
            }
        }
        
        const plunder = { wood: 0, stone: 0, iron: 0, food: 0 };
        const bounty = { wood: 0, stone: 0, iron: 0, food: 0 };
        
        let totalLootCapacity = 0;
        const attackerRaceData = gameData.units[attackerInfo.race];
        for (const unitId in survivingAttackerTroops) {
            const unitData = attackerRaceData.troops.find(u => u.id === unitId);
            if (unitData) totalLootCapacity += unitData.stats.capacity * survivingAttackerTroops[unitId];
        }
        
        if (defendingContingents.some(c => c.id === 'nature')) {
            const totalBountyFromBeasts = calculateBeastBountyValue(totalDefenderLosses.losses);
            if (totalBountyFromBeasts > 0) {
                bounty.wood = Math.floor(totalBountyFromBeasts * 0.3);
                bounty.stone = Math.floor(totalBountyFromBeasts * 0.3);
                bounty.iron = Math.floor(totalBountyFromBeasts * 0.3);
                bounty.food = Math.floor(totalBountyFromBeasts * 0.1);
            }
        }

        if (defenderVillage && attackerWins) {
            let totalHidingCapacity = 0;
            const crannies = defenderVillage.buildings.filter(b => b.type === 'cranny' && b.level > 0);
            if (crannies.length > 0) {
                const gameSpeed = this._gameConfig?.gameSpeed || 1;
                totalHidingCapacity = crannies.reduce((sum, cranny) => {
                    const levelData = gameData.buildings.cranny.levels[cranny.level - 1];
                    const baseHidingCapacity = levelData?.attribute?.hidingCapacity || 0;
                    return sum + getScaledCrannyCapacity(baseHidingCapacity, defenderVillage.race, gameSpeed);
                }, 0);
                if (attackerInfo.race === 'germans') totalHidingCapacity *= 0.8;
            }

            const lootableResources = {};
            for(const res in defenderVillage.resources) {
                lootableResources[res] = Math.max(0, defenderVillage.resources[res].current - totalHidingCapacity);
            }

            let totalResources = Object.values(lootableResources).reduce((a, b) => a + b, 0);
            
            if (totalResources > 0 && totalLootCapacity > 0) {
                const lootableRatio = Math.min(1, totalLootCapacity / totalResources);
                for(const res in plunder) {
                    const looted = Math.floor(lootableResources[res] * lootableRatio);
                    plunder[res] = looted;
                }
                this._results.stateChanges.villageUpdates.push({ villageId: defenderVillage.id, changes: { plunder: plunder } });
            }
        }

        if (targetTile?.type === 'oasis' && this._movement.payload.conquerOasis === true) {
            const currentBeasts = { ...(targetTile.state?.beasts || {}) };
            for (const unitId in totalDefenderLosses.losses) {
                currentBeasts[unitId] = Math.max(0, (currentBeasts[unitId] || 0) - totalDefenderLosses.losses[unitId]);
            }

            const hasFreeSlot = attackerVillage && (attackerVillage.oases?.length || 0) < getHeroMansionOasisSlots(attackerVillage);
            const canConquer = attackerWins
                && attackerVillage
                && hasFreeSlot
                && isOasisInCaptureRange(attackerVillage, this._movement.targetCoords)
                && !hasLivingBeasts(currentBeasts);

            if (canConquer) {
                const previousVillageId = targetTile.villageId || targetTile.state?.villageId || null;
                const oasisRecord = {
                    x: targetTile.x,
                    y: targetTile.y,
                    oasisType: targetTile.oasisType,
                };

                if (previousVillageId && previousVillageId !== attackerVillage.id) {
                    this._results.stateChanges.villageUpdates.push({
                        villageId: previousVillageId,
                        changes: { removeOasis: { x: targetTile.x, y: targetTile.y } },
                    });
                }

                this._results.stateChanges.villageUpdates.push({
                    villageId: attackerVillage.id,
                    changes: { addOasis: oasisRecord },
                });
                this._results.stateChanges.tileUpdates.push({
                    coords: targetTile,
                    changes: { captureOasis: { ownerId: attackerVillage.ownerId, villageId: attackerVillage.id } },
                });
                oasisConquest = { success: true, oasis: oasisRecord };
            } else {
                oasisConquest = { success: false };
            }
        }
         
        const defenderReportContingents = defenderContingentResults.map(c => {
            let contingentInfo;
            if (c.id === 'nature') {
                contingentInfo = this._getParticipantInfo('nature', null, this._movement.targetCoords);
            } else {
                const villageOwner = this._gameState.villages.find(v => v.id === c.id)?.ownerId;
                contingentInfo = this._getParticipantInfo(villageOwner, c.id);
            }
            return { ...contingentInfo, troops: c.troops, losses: c.losses };
        });

        const masterReport = {
            id: `rep-master-${this._movement.arrivalTime}`, type: this._movement.type, time: this._movement.arrivalTime,
            winner: winnerName,
            attacker: { ...attackerInfo, troops: this._movement.payload.troops, losses: attackerResults.losses, carryCapacity: totalLootCapacity },
            defender: { ...defenderInfo, tropas_totales: totalDefenderTroops, contingents: defenderReportContingents },
            plunder, bounty, wallDamage, buildingDamage, oasisConquest,
            summary: {
                attacker: { attackPower: attackPoints.total, lostUpkeep: attackerResults.lostUpkeep, lostResources: attackerResults.lostResources },
                defender: { defensePower: defensePoints, lostUpkeep: totalDefenderLosses.lostUpkeep, lostResources: totalDefenderLosses.lostResources }
            }
        };
        
        const allParticipants = new Set([attackerInfo.ownerId]);
        defenderReportContingents.forEach(c => {
            if (c.ownerId && c.ownerId !== 'nature') {
                allParticipants.add(c.ownerId);
            }
        });

        allParticipants.forEach(participantId => {
            const participantReport = JSON.parse(JSON.stringify(masterReport));
            participantReport.id = `rep-${participantId}-${this._movement.arrivalTime}`;
            participantReport.ownerId = participantId;
            this._results.reportsToCreate.push(participantReport);
        });

        const returnMovement = this._createReturnMovement(survivingAttackerTroops, bounty, plunder);
        if (returnMovement) {
            this._results.movementsToCreate.push(returnMovement);
        }
    }
    
    _createReturnMovement(troops, bounty = {}, plunder = {}) {
        if (Object.keys(troops).length === 0 && Object.values(bounty).every(v => v === 0) && Object.values(plunder).every(v => v === 0)) {
            return null;
        }

        const originVillage = this._gameState.villages.find(v => v.id === this._movement.originVillageId);
        if (!originVillage) return null;

        const returnTravelTime = this._movement.arrivalTime - this._movement.startTime;
        const now = Date.now();
        const sourceTile = this._gameState.spatialIndex.get(`${this._movement.targetCoords.x}|${this._movement.targetCoords.y}`);
        const returnContext = {
            sourceTileType: sourceTile?.type || null,
            sourceCoords: {
                x: this._movement.targetCoords.x,
                y: this._movement.targetCoords.y,
            },
            sourceMissionType: this._movement.type,
        };
        
        return {
            id: createReturnMovementId(now, originVillage.id),
            type: 'return',
            ownerId: this._movement.ownerId,
            originVillageId: this._movement.originVillageId,
            targetCoords: { x: originVillage.coords.x, y: originVillage.coords.y },
            payload: { troops, bounty, plunder, returnContext },
            startTime: now,
            arrivalTime: now + returnTravelTime,
        };
    }

    _getOwnerPopulation(ownerId) {
        if (!ownerId) return 0;
        return this._gameState.villages
            .filter(v => v.ownerId === ownerId)
            .reduce((sum, v) => sum + v.population.current, 0);
    }
}
