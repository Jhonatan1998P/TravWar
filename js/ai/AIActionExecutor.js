// RUTA: js/ai/AIActionExecutor.js
import { gameData } from '../core/GameData.js';
import { CombatFormulas } from '../core/CombatFormulas.js';

class AIActionExecutor {
    _controller;
    _reputationManager;

    constructor(controller) {
        this._controller = controller;
    }

    init(reputationManager) {
        this._reputationManager = reputationManager;
    }

    executePlanStep(village, step, gameState, activeGoal) {
        if (!step) return { success: false, reason: 'INVALID_STEP' };
        switch (step.type) {
            case 'building':
            case 'resource_fields_level': return this._manageConstructionForGoal(village, gameState, step);
            case 'units': return this._manageRecruitmentForGoal(village, gameState, step);
            case 'research': return this._manageResearchForGoal(village, gameState, step);
            case 'upgrade': return this._manageUpgradeForGoal(village, gameState, step);
            case 'proportional_units': return this._manageProportionalRecruitment(village, gameState, step, activeGoal);
            default: return { success: false, reason: 'UNKNOWN_STEP_TYPE' };
        }
    }

    _manageProportionalRecruitment(village, gameState, step, activeGoal) {
        const { baseUnit, proportions, baseTarget } = step;
        const allMyVillages = gameState.villages.filter(v => v.ownerId === this._controller.getOwnerId());
    
        const getTotalUnitCount = (unitId) => {
            if (!unitId) return 0;
            const totalInVillages = allMyVillages.reduce((sum, v) => sum + (v.unitsInVillage[unitId] || 0), 0);
            const totalInQueue = allMyVillages.reduce((sum, v) => {
                return sum + v.recruitmentQueue.filter(j => j.unitId === unitId).reduce((qSum, j) => qSum + j.count, 0);
            }, 0);
            return totalInVillages + totalInQueue;
        };
    
        const unitCycle = [baseUnit, ...proportions.map(p => p.unit)];
        activeGoal.proportionalUnitPointer = activeGoal.proportionalUnitPointer ?? 0;
    
        const initialPointer = activeGoal.proportionalUnitPointer;
        let unitIsComplete = true;
        while (unitIsComplete) {
            const currentUnitId = this.resolveUnitId(unitCycle[activeGoal.proportionalUnitPointer]);
            const baseUnitId = this.resolveUnitId(baseUnit);
            
            let targetCount;
            if (currentUnitId === baseUnitId) {
                targetCount = baseTarget;
            } else {
                const proportion = proportions.find(p => this.resolveUnitId(p.unit) === currentUnitId);
                targetCount = proportion ? Math.floor(baseTarget * (proportion.ratio / 100)) : 0;
            }
            
            const currentCount = getTotalUnitCount(currentUnitId);
            
            if (currentCount >= targetCount) {
                activeGoal.proportionalUnitPointer = (activeGoal.proportionalUnitPointer + 1) % unitCycle.length;
                if (activeGoal.proportionalUnitPointer === initialPointer) {
                    return { success: true };
                }
            } else {
                unitIsComplete = false;
            }
        }
    
        const unitToRecruitIdentifier = unitCycle[activeGoal.proportionalUnitPointer];
        const result = this._manageRecruitmentForGoal(village, gameState, { type: 'units', unitType: unitToRecruitIdentifier, count: Infinity });

        if (result.success) {
            this._controller.log('success', village, 'Proportional Recruitment', `Encolando tanda de ${result.count}x ${result.unitId} (25% Budget).`);
            activeGoal.proportionalUnitPointer = (activeGoal.proportionalUnitPointer + 1) % unitCycle.length;
            return { success: true };
        }
        
        return result;
    }

    _manageRecruitmentForGoal(village, gameState, step) {
        const unitId = this.resolveUnitId(step.unitType);
        if (!unitId) return { success: false, reason: 'INVALID_UNIT_ID' };
    
        const unitData = gameData.units[this._controller.getRace()].troops.find(t => t.id === unitId);
        if (!unitData) return { success: false, reason: 'INVALID_UNIT_DATA' };
    
        const trainingBuildingType = this.getTrainingBuildingForUnit(unitId);
        const trainingBuilding = village.buildings.find(b => b.type === trainingBuildingType);
        if (!trainingBuilding || trainingBuilding.level === 0) {
             return { success: false, reason: 'PREREQUISITES_NOT_MET', building: trainingBuildingType };
        }
    
        const allVillages = gameState.villages.filter(v => v.ownerId === this._controller.getOwnerId());
        const unitsInVillage = allVillages.reduce((sum, v) => sum + (v.unitsInVillage[unitId] || 0), 0);
        const unitsInQueue = allVillages.reduce((sum, v) => {
            return sum + v.recruitmentQueue.filter(j => j.unitId === unitId).reduce((qSum, j) => qSum + j.count, 0);
        }, 0);
    
        const targetAmount = step.count === Infinity ? 9999999 : step.count;
        const unitsNeeded = targetAmount - (unitsInVillage + unitsInQueue);
        
        if (unitsNeeded <= 0) return { success: true };
    
        // LEER PRESUPUESTO MILITAR DIRECTAMENTE (Hard Partitioning)
        // Si no existe (caso raro), fallback a recursos totales.
        const militaryBudget = village.budget ? village.budget.mil : {
            wood: village.resources.wood.current,
            stone: village.resources.stone.current,
            iron: village.resources.iron.current,
            food: village.resources.food.current
        };
    
        // Calcular cuántas unidades podemos pagar con el 100% de ese presupuesto militar
        let maxAffordableTotal = Infinity;
        for (const res in unitData.cost) {
            if (unitData.cost[res] > 0) {
                maxAffordableTotal = Math.min(maxAffordableTotal, Math.floor(militaryBudget[res] / unitData.cost[res]));
            }
        }
    
        if (maxAffordableTotal <= 0 || maxAffordableTotal === Infinity) {
            return { success: false, reason: 'INSUFFICIENT_RESOURCES' };
        }

        // Regla del 25% del Presupuesto
        const BATCH_PERCENTAGE = 0.25;
        let batchSize = Math.floor(maxAffordableTotal * BATCH_PERCENTAGE);

        const MIN_BATCH_FLOOR = 5;
        batchSize = Math.max(batchSize, MIN_BATCH_FLOOR);
        batchSize = Math.min(batchSize, maxAffordableTotal);

        const countToTrain = Math.min(unitsNeeded, batchSize);

        if (countToTrain <= 0) return { success: false, reason: 'INSUFFICIENT_RESOURCES' };
    
        const result = this._controller.getSendCommand()('recruit_units', { buildingId: trainingBuilding.id, unitId, count: countToTrain, villageId: village.id });
        
        if (result.success) {
            this._controller.log('success', village, 'Reclutamiento', `Orden para ${countToTrain}x ${unitId} enviada (Max posible: ${maxAffordableTotal}, Batch: 25%).`);
            return { success: true, count: countToTrain, unitId: unitId };
        } else {
            this._controller.log('fail', village, 'Reclutamiento', `Orden para ${countToTrain}x ${unitId} rechazada. Razón: ${result.reason}`, result.details);
            return { success: false, reason: result.reason, unitId: result.details?.unitId || unitId };
        }
    }

    _attemptUpgrade(village, building, newType = null) {
        const typeToBuild = newType || building.type;
        const result = this._controller.getSendCommand()('upgrade_building', { buildingId: building.id, buildingType: typeToBuild, villageId: village.id });
        return result.success;
    }
    
    getResourceTypeFromStep(step) {
        if (step.resourceType) {
            const typeMap = { 'Wood': 'woodcutter', 'Clay': 'clayPit', 'Iron': 'ironMine', 'Wheat': 'cropland' };
            return typeMap[step.resourceType];
        }
        return null;
    }
    
    _manageConstructionForGoal(village, gameState, step) {
        let candidate;
        
        if (step.type === 'building') {
            let building = village.buildings.find(b => b.type === step.buildingType);
            if (building && building.level < step.level) {
                candidate = { building, type: step.buildingType };
            } else if (!building) {
                const emptySlot = village.buildings.find(b => b.type === 'empty' && /^v[0-9]+/.test(b.id));
                if (emptySlot) candidate = { building: emptySlot, type: step.buildingType };
            }
        } else if (step.type === 'resource_fields_level') {
            const resourceTypes = ['woodcutter', 'clayPit', 'ironMine', 'cropland'];
            let allFields = village.buildings.filter(b => resourceTypes.includes(b.type));
            
            const fieldsWithEffectiveLevel = allFields.map(f => {
                const queuedUpgrades = village.constructionQueue.filter(j => j.buildingId === f.id).length;
                return {
                    ...f,
                    effectiveLevel: f.level + queuedUpgrades
                };
            });

            const fieldsNeedingUpgrade = fieldsWithEffectiveLevel.filter(f => f.effectiveLevel < step.level);

            if (fieldsNeedingUpgrade.length > 0) {
                fieldsNeedingUpgrade.sort((a, b) => a.effectiveLevel - b.effectiveLevel);
                const bestCandidate = fieldsNeedingUpgrade[0];
                candidate = { building: bestCandidate, type: bestCandidate.type };
            }
        }

        if (candidate) {
            const buildingState = candidate.building;
            const targetLevel = (buildingState.level || 0) + village.constructionQueue.filter(j => j.buildingId === buildingState.id).length + 1;
            const buildingData = gameData.buildings[candidate.type];
            if (!buildingData) return { success: false, reason: 'INVALID_BUILDING_DATA' };

            const cost = buildingData.levels[targetLevel - 1]?.cost;
            if (!cost) return { success: false, reason: 'INVALID_LEVEL_DATA' };

            // LEER PRESUPUESTO ECONÓMICO
            const econBudget = village.budget ? village.budget.econ : {
                wood: village.resources.wood.current,
                stone: village.resources.stone.current,
                iron: village.resources.iron.current,
                food: village.resources.food.current
            };

            for (const res in cost) {
                if (cost[res] > econBudget[res]) {
                    return { success: false, reason: 'INSUFFICIENT_RESOURCES' };
                }
            }
            
            const buildingName = buildingData.name || 'Campo de Recurso';
            const success = this._attemptUpgrade(village, candidate.building, candidate.type);

            if (success) {
                this._controller.log('success', village, 'Construcción', `Iniciando mejora de ${buildingName} a Nivel ${targetLevel}.`);
                return { success: true };
            } else {
                return { success: false, reason: 'QUEUE_FULL' };
            }
        }
        
        return { success: false, reason: 'NO_CANDIDATE_FOUND' };
    }
    
    _manageResearchForGoal(village, gameState, step) {
        const unitId = this.resolveUnitId(step.unitType);
        if (!unitId) return { success: false, reason: 'INVALID_UNIT_ID' };
        
        if(village.research.completed.includes(unitId)) return { success: true };

        const result = this._controller.getSendCommand()('research_unit', { unitId, villageId: village.id });
        
        if (result.success) {
            this._controller.log('success', village, 'Investigación', `Orden para investigar ${unitId} enviada con éxito.`);
        } else {
            this._controller.log('fail', village, 'Investigación', `La orden para investigar ${unitId} fue rechazada. Razón: ${result.reason}`, result.details);
        }
        return { success: result.success, reason: result.reason };
    }

    _manageUpgradeForGoal(village, gameState, step) {
        const unitId = this.resolveUnitId(step.unitType);
        if (!unitId) return { success: false, reason: 'INVALID_UNIT_ID' };

        if ((village.smithy.upgrades[unitId] || 0) >= step.level) return { success: true };

        const result = this._controller.getSendCommand()('upgrade_unit', { unitId, villageId: village.id });

        if (result.success) {
            this._controller.log('success', village, 'Herrería', `Orden para mejorar ${unitId} enviada con éxito.`);
        } else {
            this._controller.log('fail', village, 'Herrería', `La orden para mejorar ${unitId} fue rechazada. Razón: ${result.reason}`, result.details);
        }
        return { success: result.success, reason: result.reason };
    }
    
    resolveUnitId(identifier) {
        const troops = gameData.units[this._controller.getRace()].troops;
        if (!troops) return undefined;
        const directMatch = troops.find(t => t.id === identifier);
        if (directMatch) return directMatch.id;

        const getTotalCost = (unit) => {
            if (!unit.cost) return Infinity;
            const total = (unit.cost.wood || 0) + (unit.cost.stone || 0) + (unit.cost.iron || 0) + (unit.cost.food || 0);
            return total > 0 ? total : Infinity;
        };

        const findBestUnit = (filterFn, scoreFn) => {
            const candidates = troops.filter(filterFn);
            if (candidates.length === 0) return undefined;
            if (candidates.length === 1) return candidates[0].id;
            return candidates.reduce((best, current) => scoreFn(current) > scoreFn(best) ? current : best).id;
        };

        const defensiveScore = t => {
            const totalCost = getTotalCost(t);
            if (totalCost === Infinity) return 0;
            const avgDefense = (t.stats.defense.infantry + t.stats.defense.cavalry) / 2;
            return avgDefense / totalCost;
        };
        
        const offensiveScore = t => {
            const totalCost = getTotalCost(t);
            if (totalCost === Infinity) return 0;
            return t.stats.attack / totalCost;
        };

        switch(identifier) {
            case 'defensive_infantry': return findBestUnit(t => t.type === 'infantry', defensiveScore);
            case 'offensive_infantry': return findBestUnit(t => t.type === 'infantry', offensiveScore);
            case 'defensive_cavalry': return findBestUnit(t => t.type === 'cavalry', defensiveScore);
            case 'offensive_cavalry': return findBestUnit(t => t.type === 'cavalry', offensiveScore);
            case 'siege': return troops.find(t => t.type === 'siege')?.id;
            case 'ram': return troops.find(t => t.type === 'siege' && t.id.includes('ram'))?.id;
            case 'catapult': return troops.find(t => t.type === 'siege' && (t.id.includes('catapult') || t.id.includes('trebuchet')) )?.id;
            case 'settler': return troops.find(t => t.type === 'settler')?.id;
            case 'scout': return troops.find(t => t.type === 'scout')?.id;
            default: return troops.find(t => t.id === identifier)?.id;
        }
    }
    
    getTrainingBuildingForUnit(unitId) {
        const unitData = gameData.units[this._controller.getRace()].troops.find(u => u.id === unitId);
        if (!unitData) return null;
        switch (unitData.type) {
            case 'infantry': case 'scout': return 'barracks';
            case 'cavalry': return 'stable';
            case 'siege': return 'workshop';
            case 'settler': case 'chief': return 'palace';
            default: return null;
        }
    }

    _findStrongestVillage(villages, gameState) {
        if (!villages || villages.length === 0) return null;
        let strongestVillage = null;
        let maxAttackPower = -1;
        for (const village of villages) {
            const attackPoints = CombatFormulas.calculateAttackPoints(village.unitsInVillage, this._controller.getRace(), village.smithy.upgrades);
            if (attackPoints.total > maxAttackPower) {
                maxAttackPower = attackPoints.total;
                strongestVillage = village;
            }
        }
        return strongestVillage || villages[0];
    }

    _findBestSettlementLocation(myVillages, gameState) {
        const MAX_SETTLE_SEARCH_RADIUS = 25;
        const MIN_SETTLE_DISTANCE = 4;
        const allVillageCoords = new Set(gameState.villages.map(v => `${v.coords.x}|${v.coords.y}`));
        const potentialSpots = [];
        for (const tile of gameState.mapData) {
            if (tile.type !== 'valley') continue;
            if (allVillageCoords.has(`${tile.x}|${tile.y}`)) continue;
            const distFromCapital = Math.hypot(tile.x - myVillages[0].coords.x, tile.y - myVillages[0].coords.y);
            if (distFromCapital > MAX_SETTLE_SEARCH_RADIUS) continue;
            let isTooClose = false;
            for (const villageCoord of allVillageCoords) {
                const [vx, vy] = villageCoord.split('|').map(Number);
                if (Math.hypot(tile.x - vx, tile.y - vy) < MIN_SETTLE_DISTANCE) {
                    isTooClose = true;
                    break;
                }
            }
            if (isTooClose) continue;
            let score = 0;
            if (tile.valleyType === '1-1-1-15') score += 1000;
            else if (tile.valleyType === '3-3-3-9') score += 500;
            for (let dy = -3; dy <= 3; dy++) {
                for (let dx = -3; dx <= 3; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const neighbor = gameState.mapData.find(t => t.x === tile.x + dx && t.y === tile.y + dy);
                    if (neighbor && neighbor.type === 'oasis') {
                        const oasisDetails = gameData.oasisTypes[neighbor.oasisType];
                        if (oasisDetails.bonus.resource === 'food') score += 150;
                        else score += 75;
                    }
                }
            }
            score -= (distFromCapital * 10) + (distFromCapital * distFromCapital * 0.5);
            if (score > 0) potentialSpots.push({ ...tile, score });
        }
        if (potentialSpots.length === 0) return null;
        potentialSpots.sort((a, b) => b.score - a.score);
        return potentialSpots[0];
    }
    
    shouldEndDefensiveStance(gameState, lastAttackerInfo) {
        if (!lastAttackerInfo) return true;
        
        const attackerPlayerState = gameState.players.find(p => p.id === lastAttackerInfo.id);
        if (attackerPlayerState && attackerPlayerState.isUnderProtection) {
            this._controller.log('info', null, 'Represalia Abortada', `El atacante ${lastAttackerInfo.id} está ahora bajo protección.`);
            return true;
        }
        
        const lastReport = gameState.reports.find(r => r.attacker.ownerId === lastAttackerInfo.id);
        if (lastReport && lastReport.summary.defender.lostUpkeep === 0) {
            this._controller.log('info', null, 'Represalia Ignorada', 'El último ataque no causó daños. Saliendo de postura defensiva.');
            return true;
        }

        return false;
    }

    executeDefensiveStance(villages, gameState, archetype, lastAttackerInfo) {
        const village = villages[0];
        this._controller.log('info', village, 'Postura Defensiva', `Arquetipo '${archetype}'.`);
        if (archetype === 'turtle') {
            const wall = village.buildings.find(b => b.type === 'cityWall');
            if (wall && wall.level < 20) {
                if(this._attemptUpgrade(village, wall, 'cityWall').success) return;
            }
            this._manageRecruitmentForGoal(village, gameState, { type: 'units', unitType: 'defensive_infantry' });
        } else {
            this._manageRecruitmentForGoal(village, gameState, { type: 'units', unitType: 'offensive_infantry' });
            const myArmyPower = CombatFormulas.calculateAttackPoints(village.unitsInVillage, this._controller.getRace(), village.smithy.upgrades).total;
            const attackerPlayerState = gameState.players.find(p => p.id === lastAttackerInfo.id);
            const attackerVillage = gameState.villages.find(v => v.ownerId === lastAttackerInfo.id);
    
            if (!attackerVillage) return;
            
            const attackerRace = attackerPlayerState?.race || 'romans';
            const attackerSmithy = attackerVillage?.smithy.upgrades || {};
            const attackerArmyPower = CombatFormulas.calculateAttackPoints(lastAttackerInfo.army, attackerRace, attackerSmithy).total;
            
            const personality = this._controller.getPersonality();
            if (myArmyPower > attackerArmyPower * personality.defensiveConfig.retaliationThreshold) {
                this._controller.log('success', village, 'Represalia', `Fuerza suficiente reunida (Poder: ${myArmyPower.toFixed(0)}). ¡Contraatacando!`);
                
                const requiredPower = attackerArmyPower * 1.25;
                const forceToSend = {};
                let sentPower = 0;
                
                const sortedTroops = Object.entries(village.unitsInVillage)
                    .map(([id, count]) => ({ id, count, unitData: gameData.units[this._controller.getRace()].troops.find(u => u.id === id) }))
                    .filter(item => item.unitData && item.unitData.stats.attack > 0)
                    .sort((a, b) => (b.unitData.stats.attack / b.unitData.upkeep) - (a.unitData.stats.attack / a.unitData.upkeep));
    
                for (const item of sortedTroops) {
                    if (sentPower >= requiredPower) break;
                    const troopsToAdd = Math.min(item.count, Math.ceil((requiredPower - sentPower) / item.unitData.stats.attack));
                    forceToSend[item.id] = (forceToSend[item.id] || 0) + troopsToAdd;
                    sentPower += troopsToAdd * item.unitData.stats.attack;
                }
    
                this._controller.getSendCommand()('send_movement', {
                    originVillageId: village.id,
                    targetCoords: attackerVillage.coords,
                    troops: forceToSend,
                    missionType: 'attack'
                });
                return true;
            }
        }
    }

    executeGoalAction(action, villages, gameState) {
        switch (action.type) {
            case 'settle_new_village': this._executeSettleNewVillage(action, villages, gameState); break;
            case 'farm_oases_in_radius': this._executeFarmOases(action, villages, gameState); break;
            case 'rebalance_resources': this._executeRebalanceResources(action, villages, gameState); break;
        }
    }

    _executeFarmOases(action, villages, gameState) {
        const { radius = 5, maxArmyPercentageToSend = 0.25 } = action;
        const village = this._findStrongestVillage(villages, gameState);
        if (!village) return;
        
        const totalArmy = village.unitsInVillage;
        const armyToFarm = {};
        for (const unitId in totalArmy) armyToFarm[unitId] = Math.floor(totalArmy[unitId] * maxArmyPercentageToSend);
        if (Object.keys(armyToFarm).length === 0) return;
        const farmableOases = gameState.mapData.filter(tile => {
            if (tile.type !== 'oasis' || !tile.state?.beasts) return false;
            const distance = Math.hypot(tile.x - village.coords.x, tile.y - village.coords.y);
            return distance <= radius && distance > 0;
        });
        if (farmableOases.length === 0) return;
        const attackerPower = CombatFormulas.calculateAttackPoints(armyToFarm, this._controller.getRace(), village.smithy.upgrades).total;
        let bestTarget = null;
        let bestScore = -Infinity;
        for (const oasis of farmableOases) {
            const defenderPower = CombatFormulas.calculateDefensePoints([{ troops: oasis.state.beasts, race: 'nature' }], { infantry: 1, cavalry: 0 });
            if (attackerPower > defenderPower) {
                const score = attackerPower - defenderPower;
                if (score > bestScore) {
                    bestScore = score;
                    bestTarget = oasis;
                }
            }
        }
        if (bestTarget) {
            this._controller.log('success', village, 'Farmeo de Oasis', `Enviando ${maxArmyPercentageToSend * 100}% del ejército a saquear el oasis en ${bestTarget.x}|${bestTarget.y}.`);
            this._controller.getSendCommand()('send_movement', { originVillageId: village.id, targetCoords: { x: bestTarget.x, y: bestTarget.y }, troops: armyToFarm, missionType: 'raid' });
        }
    }

    _executeRebalanceResources(action, villages, gameState) {
        if (villages.length < 2) return;
        const { threshold = 0.9 } = action;
        let sourceVillage = null, destVillage = null, resourceToSend = null;
        let maxSurplus = -1, maxDeficit = -1;
        for (const v of villages) {
            for (const res in v.resources) {
                const ratio = v.resources[res].current / v.resources[res].capacity;
                if (ratio > threshold && ratio > maxSurplus) {
                    maxSurplus = ratio;
                    sourceVillage = v;
                    resourceToSend = res;
                }
            }
        }
        if (!sourceVillage) return;
        for (const v of villages) {
            if (v.id === sourceVillage.id) continue;
            const ratio = v.resources[resourceToSend].current / v.resources[resourceToSend].capacity;
            const deficit = 1 - ratio;
            if (deficit > maxDeficit) {
                maxDeficit = deficit;
                destVillage = v;
            }
        }
        if (sourceVillage && destVillage) {
            const amountToSend = Math.floor(sourceVillage.resources[resourceToSend].current - (sourceVillage.resources[resourceToSend].capacity * threshold));
            if (amountToSend <= 0) return;
            this._controller.log('success', sourceVillage, 'Rebalanceo de Recursos', `Enviando ${amountToSend} de ${resourceToSend} a ${destVillage.name}.`);
            this._controller.getSendCommand()('send_merchants', { originVillageId: sourceVillage.id, targetCoords: destVillage.coords, resources: { [resourceToSend]: amountToSend } });
        }
    }

    _executeSettleNewVillage(action, villages, gameState) {
        if (gameState.movements.some(m => m.ownerId === this._controller.getOwnerId() && m.type === 'settle')) {
            this._controller.log('info', null, 'Colonización', 'Ya hay una misión de colonización en curso. Esperando...');
            return;
        }
        const settlerUnitId = this.resolveUnitId('settler');
        const settlerVillage = villages.find(v => (v.unitsInVillage[settlerUnitId] || 0) >= 3);
        if (!settlerVillage) {
            this._controller.log('fail', null, 'Colonización', 'No se puede colonizar: No se encontró ninguna aldea con 3 colonos.');
            return;
        }
        const targetLocation = this._findBestSettlementLocation(villages, gameState);
        if (!targetLocation) {
            this._controller.log('warn', null, 'Colonización', 'No se pudo encontrar una ubicación adecuada para colonizar.');
            return;
        }
        this._controller.log('success', settlerVillage, 'Colonización', `Objetivo fijado en ${targetLocation.x}|${targetLocation.y} (Puntuación: ${targetLocation.score.toFixed(0)}). Enviando colonos.`);
        const settlers = { [settlerUnitId]: 3 };
        this._controller.getSendCommand()('send_movement', { originVillageId: settlerVillage.id, targetCoords: { x: targetLocation.x, y: targetLocation.y }, troops: settlers, missionType: 'settle' });
    }
}

export default AIActionExecutor;