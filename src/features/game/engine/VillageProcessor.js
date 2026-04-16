// RUTA: js/engine/VillageProcessor.js
import { gameData } from '../core/GameData.js';

const CONSTRUCTION_CANCEL_REFUND_PERCENT = 0.45;
const BASE_PRODUCTION = 12;
const SMITHY_UPGRADE_COST_MULTIPLIER = 1.6;
const RECRUITMENT_NOTIFICATION_BATCH_INTERVAL_MS = 30000;

export class VillageProcessor {
    #village;
    #config;
    #notifications;
    #recruitmentBatch;
    #lastBatchDispatchTime;
    #aiBonusMultiplier;

    constructor(village, gameConfig, allianceBonuses, aiBonusMultiplier = 1, budgetConfig = null) {
        this.#village = village;
        this.#config = gameConfig;
        this.#notifications = [];
        this.#recruitmentBatch = [];
        this.#lastBatchDispatchTime = 0;
        this.#aiBonusMultiplier = aiBonusMultiplier;
        this.allianceBonuses = allianceBonuses || { productionBonusPercent: 0, constructionTimeBonusPercent: 0 };
        
        // Inicializar el ratio en el estado de la aldea si se proporciona y no existe
        // Esto permite que la IA lo modifique dinámicamente en tiempo real
        if (budgetConfig && !this.#village.budgetRatio) {
            this.#village.budgetRatio = { ...budgetConfig };
        }
        if (this.#village.budgetRatio) {
            this.#ensureBudgetState();
        }
        
        this.#calculateStorage();
        this.#calculateProduction();
        this.#calculatePopulation();
    }

    #ensureBudgetState() {
        if (!this.#village.budget) {
            this.#village.budget = {
                econ: { wood: 0, stone: 0, iron: 0, food: 0 },
                mil: { wood: 0, stone: 0, iron: 0, food: 0 },
            };
        }

        const ratio = this.#village.budgetRatio || { econ: 0.5, mil: 0.5 };
        const ratioSum = (ratio.econ || 0) + (ratio.mil || 0) || 1;

        ['wood', 'stone', 'iron', 'food'].forEach(resource => {
            const econValue = Number(this.#village.budget.econ[resource]);
            const milValue = Number(this.#village.budget.mil[resource]);
            const hasValidBudget = Number.isFinite(econValue) && Number.isFinite(milValue);

            if (!hasValidBudget) {
                const current = this.#village.resources?.[resource]?.current || 0;
                this.#village.budget.econ[resource] = current * (ratio.econ || 0) / ratioSum;
                this.#village.budget.mil[resource] = current * (ratio.mil || 0) / ratioSum;
                return;
            }

            const current = this.#village.resources?.[resource]?.current || 0;
            const totalBudget = econValue + milValue;
            if (totalBudget <= 0 && current > 0) {
                this.#village.budget.econ[resource] = current * (ratio.econ || 0) / ratioSum;
                this.#village.budget.mil[resource] = current * (ratio.mil || 0) / ratioSum;
            }
        });
    }

    #calculateProduction() {
        const hourlyProduction = { wood: BASE_PRODUCTION, stone: BASE_PRODUCTION, iron: BASE_PRODUCTION, food: BASE_PRODUCTION };
        const bonusPercent = { wood: 0, stone: 0, iron: 0, food: 0 };
        const allianceProdBonus = this.allianceBonuses.productionBonusPercent / 100;

        for (const building of this.#village.buildings) {
            if (building.level <= 0 || !building.type || building.type === 'empty') continue;
            
            const buildingInfo = gameData.buildings[building.type];
            if (!buildingInfo) continue;
            
            const levelData = buildingInfo.levels[building.level - 1];
            if (!levelData) continue;

            if (levelData.production) {
                for (const resource in levelData.production) {
                    if (hourlyProduction[resource] !== undefined) {
                        hourlyProduction[resource] += levelData.production[resource];
                    }
                }
            }

            if (levelData.attribute?.productionBonusPercent) {
                let resourceType = null;
                switch (building.type) {
                    case 'sawmill': resourceType = 'wood'; break;
                    case 'brickyard': resourceType = 'stone'; break;
                    case 'ironFoundry': resourceType = 'iron'; break;
                    case 'grainMill': 
                    case 'bakery': 
                        resourceType = 'food'; break;
                }
                
                if (resourceType) {
                    bonusPercent[resourceType] += levelData.attribute.productionBonusPercent;
                }
            }
        }

        for (const resource in hourlyProduction) {
            const totalMultiplier = (1 + (bonusPercent[resource] / 100) + allianceProdBonus) * this.#config.gameSpeed * this.#aiBonusMultiplier;
            let finalProduction = hourlyProduction[resource] * totalMultiplier;
            
            if (resource === 'food') {
                finalProduction -= this.#village.population.foodConsumption;
            }
            
            this.#village.resources[resource].production = Math.round(finalProduction);
        }
    }
    
    getVillageId() {
        return this.#village.id;
    }

    update(currentTime, lastTick) {
        this.#notifications = [];
        const elapsedSeconds = (currentTime - lastTick) / 1000;

        let needsRecalculation = this.#processQueues(currentTime);
        this.#processRecruitmentNotificationBatch(currentTime);
        this.#updateResources(elapsedSeconds);

        if (needsRecalculation) {
            this.#calculateProduction();
            this.#calculateStorage();
            this.#calculatePopulation();
        }

        return this.#notifications;
    }
    
    queueBuildingUpgrade(payload) {
        const { buildingId, buildingType } = payload;
        if (this.#village.budgetRatio) this.#ensureBudgetState();
    
        if (this.#village.constructionQueue.length >= this.#village.maxConstructionSlots) {
            return { success: false, reason: 'QUEUE_FULL', details: `La cola general está llena.` };
        }
    
        if (this.#village.race === 'romans') {
            const isNewJobResource = /^[wcif]/.test(buildingId);
            const resourceJobsInQueue = this.#village.constructionQueue.filter(j => /^[wcif]/.test(j.buildingId)).length;
            const infraJobsInQueue = this.#village.constructionQueue.length - resourceJobsInQueue;
    
            if (isNewJobResource && resourceJobsInQueue >= 2) return { success: false, reason: 'ROMAN_RESOURCE_QUEUE_FULL' };
            if (!isNewJobResource && infraJobsInQueue >= 2) return { success: false, reason: 'ROMAN_INFRA_QUEUE_FULL' };
        }
    
        const buildingState = this.#village.buildings.find(b => b.id === buildingId);
        if (!buildingState) return { success: false, reason: 'BUILDING_NOT_FOUND' };
    
        const jobsForThisBuilding = this.#village.constructionQueue.filter(j => j.buildingId === buildingId);
        const highestQueuedLevel = jobsForThisBuilding.length > 0
            ? Math.max(...jobsForThisBuilding.map(j => j.targetLevel))
            : buildingState.level;
    
        const targetLevel = highestQueuedLevel + 1;
        const type = buildingState.type === 'empty' ? buildingType : buildingState.type;
        const buildingData = gameData.buildings[type];
        if (!buildingData || !buildingData.levels[targetLevel - 1]) return { success: false, reason: 'INVALID_LEVEL_DATA' };
    
        const levelData = buildingData.levels[targetLevel - 1];
    
        const prerequisitesToCheck = levelData.requires || buildingData.requires;
        if (prerequisitesToCheck) {
            const resourceFieldTypes = ['woodcutter', 'clayPit', 'ironMine', 'cropland'];
            for (const reqBuildingType in prerequisitesToCheck) {
                const requiredLevel = prerequisitesToCheck[reqBuildingType];
                let requirementMet = false;
                if (resourceFieldTypes.includes(reqBuildingType)) {
                    requirementMet = this.#village.buildings.some(b => b.type === reqBuildingType && b.level >= requiredLevel);
                } else {
                    const playerBuilding = this.#village.buildings.find(b => b.type === reqBuildingType);
                    requirementMet = playerBuilding && playerBuilding.level >= requiredLevel;
                }
                if (!requirementMet) return { success: false, reason: 'PREREQUISITES_NOT_MET', details: { required: { [reqBuildingType]: requiredLevel } } };
            }
        }

        // GASTO DE RECURSOS: Partición Estricta
        // Usamos this.#village.budgetRatio para determinar si estamos en modo IA con presupuesto
        const availableRes = this.#village.budgetRatio ? this.#village.budget.econ : {
            wood: this.#village.resources.wood.current,
            stone: this.#village.resources.stone.current,
            iron: this.#village.resources.iron.current,
            food: this.#village.resources.food.current
        };

        for (const resource in levelData.cost) {
            if (availableRes[resource] < levelData.cost[resource]) {
                return { success: false, reason: 'INSUFFICIENT_RESOURCES', details: { needed: levelData.cost, available: availableRes } };
            }
        }

        for (const resource in levelData.cost) {
            if (this.#village.budgetRatio) {
                this.#village.budget.econ[resource] -= levelData.cost[resource];
                // Sincronizar visualmente
                this.#village.resources[resource].current = this.#village.budget.econ[resource] + this.#village.budget.mil[resource];
            } else {
                this.#village.resources[resource].current -= levelData.cost[resource];
            }
        }
    
        const mainBuildingLevel = this.#village.buildings.find(b => b.type === 'mainBuilding')?.level || 0;
        let timeFactor = mainBuildingLevel > 0 ? gameData.buildings.mainBuilding.levels[mainBuildingLevel - 1].attribute.constructionTimeFactor : 1.0;
        const allianceTimeFactor = 1 - (this.allianceBonuses.constructionTimeBonusPercent / 100);
        const buildTimeInMs = (levelData.buildTime / this.#config.gameSpeed) * timeFactor * allianceTimeFactor * 1000;
    
        const now = Date.now();
        const startTime = now;
        const endTime = startTime + buildTimeInMs;
    
        this.#village.constructionQueue.push({
            jobId: `${now}-${buildingId}`, buildingId, buildingType: type, targetLevel, startTime, endTime
        });
        this.#village.constructionQueue.sort((a, b) => a.endTime - b.endTime);
        return { success: true };
    }    
    
    cancelBuilding(payload) {
        const { jobId } = payload;
        if (this.#village.budgetRatio) this.#ensureBudgetState();
        const jobIndex = this.#village.constructionQueue.findIndex(j => j.jobId === jobId);
        if (jobIndex === -1) return;

        const jobToCancel = this.#village.constructionQueue[jobIndex];
        const levelData = gameData.buildings[jobToCancel.buildingType].levels[jobToCancel.targetLevel - 1];

        // REEMBOLSO: Al budget correcto
        for (const resource in levelData.cost) {
            const refund = Math.floor(levelData.cost[resource] * CONSTRUCTION_CANCEL_REFUND_PERCENT);
            if (this.#village.budgetRatio) {
                this.#village.budget.econ[resource] += refund;
                this.#village.resources[resource].current = this.#village.budget.econ[resource] + this.#village.budget.mil[resource];
            } else {
                this.#village.resources[resource].current += refund;
            }
        }

        const timeCancelled = jobToCancel.endTime - jobToCancel.startTime;
        this.#village.constructionQueue.splice(jobIndex, 1);

        const isCancelledJobResource = /^[wcif]/.test(jobToCancel.buildingId);
        for (const subsequentJob of this.#village.constructionQueue) {
            if (subsequentJob.startTime >= jobToCancel.endTime) {
                if (this.#village.race !== 'romans' || /^[wcif]/.test(subsequentJob.buildingId) === isCancelledJobResource) {
                    subsequentJob.startTime -= timeCancelled;
                    subsequentJob.endTime -= timeCancelled;
                }
            }
        }
        this.#village.constructionQueue.sort((a, b) => a.endTime - b.endTime);
    }

    queueRecruitment(payload) {
        const { buildingId, unitId, count } = payload;
        if (this.#village.budgetRatio) this.#ensureBudgetState();
        if (!buildingId || !unitId || !count || count <= 0) return { success: false, reason: 'INVALID_PAYLOAD' };

        const unitData = gameData.units[this.#village.race].troops.find(t => t.id === unitId);
        if (!unitData) return { success: false, reason: 'INVALID_UNIT_ID' };
        if (unitData.research.time > 0 && !this.#village.research.completed.includes(unitId)) {
            return { success: false, reason: 'RESEARCH_REQUIRED', details: { unitId } };
        }

        if (unitData.type === 'settler' || unitData.type === 'chief') {
            const palace = this.#village.buildings.find(b => b.type === 'palace' || b.type === 'residence');
            if (!palace || palace.level < 10) return { success: false, reason: 'EXPANSION_BUILDING_LOW_LEVEL' };
            const existingUnits = (this.#village.unitsInVillage[unitId] || 0) + this.#village.recruitmentQueue
                .filter(j => j.unitId === unitId)
                .reduce((sum, j) => sum + (j.remainingCount || j.count), 0);
            
            let maxAllowed = 0;
            if (palace.level >= 20) maxAllowed = 9; else if (palace.level >= 15) maxAllowed = 6; else if (palace.level >= 10) maxAllowed = 3;
            if (existingUnits + count > maxAllowed) return { success: false, reason: 'EXPANSION_SLOTS_FULL', details: { needed: count, available: maxAllowed - existingUnits } };
        }

        // GASTO DE RECURSOS: Partición Estricta (Militar)
        const availableRes = this.#village.budgetRatio ? this.#village.budget.mil : {
            wood: this.#village.resources.wood.current,
            stone: this.#village.resources.stone.current,
            iron: this.#village.resources.iron.current,
            food: this.#village.resources.food.current
        };

        const totalCost = {};
        for (const resource in unitData.cost) {
            totalCost[resource] = unitData.cost[resource] * count;
            if (availableRes[resource] < totalCost[resource]) {
                return { success: false, reason: 'INSUFFICIENT_RESOURCES', details: { needed: totalCost, available: availableRes } };
            }
        }
        for (const resource in totalCost) {
            if (this.#village.budgetRatio) {
                this.#village.budget.mil[resource] -= totalCost[resource];
                this.#village.resources[resource].current = this.#village.budget.econ[resource] + this.#village.budget.mil[resource];
            } else {
                this.#village.resources[resource].current -= totalCost[resource];
            }
        }

        const building = this.#village.buildings.find(b => b.id === buildingId);
        const timeFactor = gameData.buildings[building.type].levels[building.level - 1].attribute.trainingTimeFactor || 1.0;
        const singleUnitTimeInMs = ((unitData.trainTime / timeFactor) / this.#config.gameSpeed) * 1000;

        const now = Date.now();
        
        let lastJobInQueue = this.#village.recruitmentQueue
            .filter(j => j.buildingId === buildingId)
            .sort((a, b) => a.endTime - b.endTime)
            .pop();
            
        let batchStartTime = now;
        
        if (lastJobInQueue) {
            const remainingUnitsTime = Math.max(0, (lastJobInQueue.remainingCount - 1)) * lastJobInQueue.timePerUnit;
            batchStartTime = lastJobInQueue.endTime + remainingUnitsTime;
        }
        
        this.#village.recruitmentQueue.push({
            jobId: `${now}-${unitId}-batch`,
            buildingId,
            unitId,
            totalCount: count,
            remainingCount: count,
            startTime: batchStartTime,
            endTime: batchStartTime + singleUnitTimeInMs, 
            timePerUnit: singleUnitTimeInMs
        });

        this.#village.recruitmentQueue.sort((a, b) => a.endTime - b.endTime);
        return { success: true };
    }

    queueResearch(payload) {
        const { unitId } = payload;
        if (this.#village.budgetRatio) this.#ensureBudgetState();
        if (!unitId) return { success: false, reason: 'INVALID_PAYLOAD' };
        if (this.#village.research.queue.length > 0) return { success: false, reason: 'QUEUE_FULL' };

        const unitData = gameData.units[this.#village.race].troops.find(u => u.id === unitId);
        if (!unitData || !unitData.research || unitData.research.time === 0) return { success: false, reason: 'INVALID_UNIT_ID' };
        if (this.#village.research.completed.includes(unitId)) return { success: false, reason: 'ALREADY_RESEARCHED' };

        const requiredBuildings = unitData.research.requires || {};
        for (const [buildingType, requiredLevelRaw] of Object.entries(requiredBuildings)) {
            const requiredLevel = Math.max(1, Number(requiredLevelRaw) || 1);
            const currentLevel = this.#village.buildings.find(building => building.type === buildingType)?.level || 0;
            if (currentLevel < requiredLevel) {
                return {
                    success: false,
                    reason: 'PREREQUISITES_NOT_MET',
                    details: {
                        required: { [buildingType]: requiredLevel },
                        current: { [buildingType]: currentLevel },
                        unitId,
                    },
                };
            }
        }

        // GASTO DE RECURSOS: Partición Estricta (Económico)
        const availableRes = this.#village.budgetRatio ? this.#village.budget.econ : {
            wood: this.#village.resources.wood.current,
            stone: this.#village.resources.stone.current,
            iron: this.#village.resources.iron.current,
            food: this.#village.resources.food.current
        };

        for (const res in unitData.research.cost) {
            if (availableRes[res] < unitData.research.cost[res]) {
                return { success: false, reason: 'INSUFFICIENT_RESOURCES', details: { needed: unitData.research.cost, available: availableRes } };
            }
        }
        for (const res in unitData.research.cost) {
            if (this.#village.budgetRatio) {
                this.#village.budget.econ[res] -= unitData.research.cost[res];
                this.#village.resources[res].current = this.#village.budget.econ[res] + this.#village.budget.mil[res];
            } else {
                this.#village.resources[res].current -= unitData.research.cost[res];
            }
        }

        const researchTimeInSeconds = unitData.research.time / this.#config.gameSpeed;
        const now = Date.now();
        const startTime = now;
        this.#village.research.queue.push({
            jobId: `${now}-research-${unitId}`, unitId, startTime, endTime: startTime + (researchTimeInSeconds * 1000)
        });
        return { success: true };
    }

    queueSmithyUpgrade(payload) {
        const { unitId } = payload;
        if (this.#village.budgetRatio) this.#ensureBudgetState();
        if (!unitId) return { success: false, reason: 'INVALID_PAYLOAD' };
        if (this.#village.smithy.queue.length > 0) return { success: false, reason: 'QUEUE_FULL' };

        const unitData = gameData.units[this.#village.race].troops.find(u => u.id === unitId);
        if (!unitData) return { success: false, reason: 'INVALID_UNIT_ID' };
        if (unitData.research.time > 0 && !this.#village.research.completed.includes(unitId)) {
            return { success: false, reason: 'RESEARCH_REQUIRED', details: { unitId } };
        }

        const smithyLevel = this.#village.buildings.find(b => b.type === 'smithy')?.level || 0;
        const currentUpgradeLevel = this.#village.smithy.upgrades[unitId] || 0;
        if (currentUpgradeLevel >= 20) {
            return { success: false, reason: 'MAX_LEVEL_REACHED', details: { currentLevel: currentUpgradeLevel, smithyLevel } };
        }

        if (currentUpgradeLevel >= smithyLevel) {
            const requiredSmithyLevel = Math.min(20, currentUpgradeLevel + 1);
            return {
                success: false,
                reason: 'PREREQUISITES_NOT_MET',
                details: {
                    required: { smithy: requiredSmithyLevel },
                    current: { smithy: smithyLevel },
                    unitId,
                },
            };
        }

        const upgradeCost = {};
        for (const res in unitData.cost) {
            upgradeCost[res] = Math.floor(unitData.cost[res] * Math.pow(SMITHY_UPGRADE_COST_MULTIPLIER, currentUpgradeLevel + 1));
        }

        // GASTO DE RECURSOS: Partición Estricta (Económico)
        const availableRes = this.#village.budgetRatio ? this.#village.budget.econ : {
            wood: this.#village.resources.wood.current,
            stone: this.#village.resources.stone.current,
            iron: this.#village.resources.iron.current,
            food: this.#village.resources.food.current
        };

        for (const res in upgradeCost) {
            if (availableRes[res] < upgradeCost[res]) {
                return { success: false, reason: 'INSUFFICIENT_RESOURCES', details: { needed: upgradeCost, available: availableRes } };
            }
        }
        for (const res in upgradeCost) {
            if (this.#village.budgetRatio) {
                this.#village.budget.econ[res] -= upgradeCost[res];
                this.#village.resources[res].current = this.#village.budget.econ[res] + this.#village.budget.mil[res];
            } else {
                this.#village.resources[res].current -= upgradeCost[res];
            }
        }

        const upgradeTimeInSeconds = (unitData.trainTime / this.#config.gameSpeed);
        const now = Date.now();
        const startTime = now;
        this.#village.smithy.queue.push({
            jobId: `${now}-upgrade-${unitId}`, unitId, startTime, endTime: startTime + (upgradeTimeInSeconds * 1000)
        });
        return { success: true };
    }

    rename(newName) {
        if (newName && newName.trim().length > 0) {
            this.#village.name = newName.trim().substring(0, 30);
        }
    }

    #processQueues(currentTime) {
        let needsRecalculation = false;
        
        const completedConstructionJobs = [];
        while (this.#village.constructionQueue.length > 0 && currentTime >= this.#village.constructionQueue[0].endTime) {
            const job = this.#village.constructionQueue.shift();
            const building = this.#village.buildings.find(b => b.id === job.buildingId);
            if (building) {
                building.level = job.targetLevel;
                if (building.type === 'empty') building.type = job.buildingType;
                
            }
            completedConstructionJobs.push(job);
            needsRecalculation = true;
        }
        if (completedConstructionJobs.length > 0) {
            this.#notifications.push({ type: 'construction:finished', payload: { completed: completedConstructionJobs, villageId: this.#village.id } });
        }

        const buildingsBusy = new Set();

        for (let i = 0; i < this.#village.recruitmentQueue.length; i++) {
            const job = this.#village.recruitmentQueue[i];
            
            if (buildingsBusy.has(job.buildingId)) {
                continue;
            }

            if (job.remainingCount === undefined) {
                if (currentTime >= job.endTime) {
                    this.#village.unitsInVillage[job.unitId] = (this.#village.unitsInVillage[job.unitId] || 0) + job.count;
                    this.#recruitmentBatch.push({ ...job, villageId: this.#village.id });
                    this.#village.recruitmentQueue.splice(i, 1);
                    i--;
                    needsRecalculation = true;
                } else {
                    buildingsBusy.add(job.buildingId);
                }
                continue;
            }

            if (currentTime >= job.endTime) {
                const timeSinceNextUnitEnd = currentTime - job.endTime;
                const unitsCompletedNow = 1 + Math.floor(timeSinceNextUnitEnd / job.timePerUnit);
                const actualCompleted = Math.min(unitsCompletedNow, job.remainingCount);
                
                if (actualCompleted > 0) {
                    this.#village.unitsInVillage[job.unitId] = (this.#village.unitsInVillage[job.unitId] || 0) + actualCompleted;
                    job.remainingCount -= actualCompleted;
                    
                    this.#recruitmentBatch.push({
                        unitId: job.unitId,
                        count: actualCompleted,
                        buildingId: job.buildingId,
                        timePerUnit: job.timePerUnit,
                        villageId: this.#village.id,
                    });
                    
                    needsRecalculation = true;
                }

                if (job.remainingCount <= 0) {
                    this.#village.recruitmentQueue.splice(i, 1);
                    i--;
                } else {
                    job.endTime += (actualCompleted * job.timePerUnit);
                    buildingsBusy.add(job.buildingId);
                }
            } else {
                buildingsBusy.add(job.buildingId);
            }
        }
        
        this.#village.recruitmentQueue.sort((a, b) => a.endTime - b.endTime);

        const completedResearchJobs = [];
        while (this.#village.research.queue.length > 0 && currentTime >= this.#village.research.queue[0].endTime) {
            const job = this.#village.research.queue.shift();
            this.#village.research.completed.push(job.unitId);
            completedResearchJobs.push(job);
        }
        if (completedResearchJobs.length > 0) {
            this.#notifications.push({ type: 'research:finished', payload: { completed: completedResearchJobs, villageId: this.#village.id } });
        }
        
        const completedSmithyJobs = [];
        while (this.#village.smithy.queue.length > 0 && currentTime >= this.#village.smithy.queue[0].endTime) {
            const job = this.#village.smithy.queue.shift();
            this.#village.smithy.upgrades[job.unitId] = (this.#village.smithy.upgrades[job.unitId] || 0) + 1;
            completedSmithyJobs.push(job);
        }
        if (completedSmithyJobs.length > 0) {
            this.#notifications.push({ type: 'smithy:finished', payload: { completed: completedSmithyJobs, villageId: this.#village.id } });
        }
        
        return needsRecalculation;
    }

    #processRecruitmentNotificationBatch(currentTime) {
        if (currentTime - this.#lastBatchDispatchTime < RECRUITMENT_NOTIFICATION_BATCH_INTERVAL_MS) return;
        if (this.#recruitmentBatch.length > 0) {
            const aggregatedCompleted = this.#recruitmentBatch.reduce((acc, job) => {
                const key = `${job.unitId}:${job.timePerUnit || 0}:${job.buildingId || 'unknown'}`;
                acc[key] = acc[key] || {
                    unitId: job.unitId,
                    count: 0,
                    timePerUnit: job.timePerUnit || 0,
                    buildingId: job.buildingId || null,
                };
                acc[key].count += job.count;
                return acc;
            }, {});
            this.#notifications.push({ type: 'recruitment:finished', payload: { completed: Object.values(aggregatedCompleted), villageId: this.#village.id } });
            this.#recruitmentBatch = [];
        }
        this.#lastBatchDispatchTime = currentTime;
    }

    #updateResources(elapsedSeconds) {
        if (elapsedSeconds <= 0) return;
        if (this.#village.budgetRatio) this.#ensureBudgetState();
        for (const resName in this.#village.resources) {
            const res = this.#village.resources[resName];
            if (res.production) {
                const produced = (res.production / 3600) * elapsedSeconds;
                
                if (this.#village.budgetRatio) {
                    // LÓGICA DE PARTICIÓN DE PRODUCCIÓN DINÁMICA
                    // Usamos el ratio almacenado en el estado de la aldea
                    const econShare = produced * this.#village.budgetRatio.econ;
                    const milShare = produced * this.#village.budgetRatio.mil;

                    const econCap = res.capacity * this.#village.budgetRatio.econ;
                    const milCap = res.capacity * this.#village.budgetRatio.mil;

                    this.#village.budget.econ[resName] = Math.min(res.capacity, Math.max(0, this.#village.budget.econ[resName] + econShare));
                    this.#village.budget.mil[resName] = Math.min(res.capacity, Math.max(0, this.#village.budget.mil[resName] + milShare));
                    
                    // Sincronizar visual
                    res.current = this.#village.budget.econ[resName] + this.#village.budget.mil[resName];
                    
                    if (res.current > res.capacity) {
                        const overflow = res.current - res.capacity;
                        this.#village.budget.econ[resName] -= overflow * this.#village.budgetRatio.econ;
                        this.#village.budget.mil[resName] -= overflow * this.#village.budgetRatio.mil;
                        res.current = res.capacity;
                    }

                } else {
                    res.current = Math.min(res.capacity, Math.max(0, res.current + produced));
                }
            }
        }
    }

    #calculatePopulation() {
        let totalPopulation = 0;
        for (const building of this.#village.buildings) {
            if (building.level > 0 && building.type !== 'empty') {
                const buildingData = gameData.buildings[building.type];
                if (buildingData) {
                    for (let i = 0; i < building.level; i++) {
                        if (buildingData.levels[i]?.population) totalPopulation += buildingData.levels[i].population;
                    }
                }
            }
        }
        let unitPopulation = 0;
        const allUnits = gameData.units[this.#village.race].troops;
        for(const unitId in this.#village.unitsInVillage) {
            const unitData = allUnits.find(u => u.id === unitId);
            if(unitData) unitPopulation += unitData.upkeep * this.#village.unitsInVillage[unitId];
        }
        this.#village.population.current = totalPopulation;
        this.#village.population.foodConsumption = unitPopulation;
    }
    
    #calculateStorage() {
        let generalCapacity = gameData.config.initialStorage.warehouse;
        let foodCapacity = gameData.config.initialStorage.granary;
        
        const warehouses = this.#village.buildings.filter(b => b.type === 'warehouse' && b.level > 0);
        if (warehouses.length > 0) {
            const warehouseBonus = warehouses.reduce((sum, b) => {
                const levelData = gameData.buildings.warehouse.levels[b.level - 1];
                return sum + (levelData ? levelData.attribute.storageCapacity : 0);
            }, 0);
            generalCapacity += warehouseBonus;
        }
        
        const granaries = this.#village.buildings.filter(b => b.type === 'granary' && b.level > 0);
        if (granaries.length > 0) {
            const granaryBonus = granaries.reduce((sum, b) => {
                const levelData = gameData.buildings.granary.levels[b.level - 1];
                return sum + (levelData ? levelData.attribute.storageCapacity : 0);
            }, 0);
            foodCapacity += granaryBonus;
        }

        const speedMultiplier = Math.max(1, Math.floor(this.#config.gameSpeed / 20));
        
        this.#village.resources.wood.capacity = generalCapacity * speedMultiplier;
        this.#village.resources.stone.capacity = generalCapacity * speedMultiplier;
        this.#village.resources.iron.capacity = generalCapacity * speedMultiplier;
        this.#village.resources.food.capacity = foodCapacity * speedMultiplier;
    }
}
