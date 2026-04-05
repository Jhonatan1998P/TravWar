// RUTA: js/ai/AIGoalManager.js
import { gameData } from '../core/GameData.js';

const RECURRING_GOAL_COOLDOWN_MS = 10 * 60 * 1000;
const STEP_TIME_SLICE_MS = 5 * 60 * 1000;

class AIGoalManager {
    #controller;
    #actionExecutor;
    #villageGoalStates = new Map();

    constructor(controller, actionExecutor) {
        this.#controller = controller;
        this.#actionExecutor = actionExecutor;
    }
    
    init(gameState, goalState) {
        const myVillages = gameState.villages.filter(v => v.ownerId === this.#controller.getOwnerId());
        myVillages.forEach(village => {
            const persistentVillageState = goalState[village.id] || {};
            
            if (!goalState[village.id]) {
                goalState[village.id] = persistentVillageState;
            }
            
            const initializeScheduler = (goal) => {
                delete goal.stepPointer;
                goal.proportionalUnitPointer = goal.proportionalUnitPointer ?? 0;
                goal.currentStepIndex = goal.currentStepIndex ?? 0;
                goal.stepStartTime = goal.stepStartTime ?? Date.now();
                if (!goal.incompleteStepIndices || goal.incompleteStepIndices.length === 0) {
                     goal.incompleteStepIndices = goal.plan ? goal.plan.map((_, i) => i) : [];
                }
            };

            persistentVillageState.economicGoalStack?.forEach(initializeScheduler);
            persistentVillageState.militaryGoalStack?.forEach(initializeScheduler);

            this.#villageGoalStates.set(village.id, {
                economicGoalStack: persistentVillageState.economicGoalStack || [],
                militaryGoalStack: persistentVillageState.militaryGoalStack || [],
                completedGoals: new Set(persistentVillageState.completedGoals || []),
                goalCooldowns: new Map(persistentVillageState.goalCooldowns || []),
                lastUpgradedResourceType: persistentVillageState.lastUpgradedResourceType || null
            });
        });
    }
    
    getState() {
        const serializableState = {};
        for (const [villageId, villageState] of this.#villageGoalStates.entries()) {
            const cleanStack = (stack) => stack.map(g => {
                const { currentStep, ...rest } = g;
                return rest;
            });

            serializableState[villageId] = {
                economicGoalStack: cleanStack(villageState.economicGoalStack),
                militaryGoalStack: cleanStack(villageState.militaryGoalStack),
                completedGoals: Array.from(villageState.completedGoals),
                goalCooldowns: Array.from(villageState.goalCooldowns.entries()),
                lastUpgradedResourceType: villageState.lastUpgradedResourceType
            };
        }
        return serializableState;
    }
    
    getGoalStackInfo(villageId) {
        const villageState = this.#villageGoalStates.get(villageId);
        if (!villageState) {
            return { econ: 0, mil: 0 };
        }
        return {
            econ: villageState.economicGoalStack.length,
            mil: villageState.militaryGoalStack.length
        };
    }

    getVillageState(villageId) {
        return this.#villageGoalStates.get(villageId);
    }
    
    ensureVillageStateExists(villageId) {
        if (!this.#villageGoalStates.has(villageId)) {
            this.#villageGoalStates.set(villageId, { 
                economicGoalStack: [], 
                militaryGoalStack: [], 
                completedGoals: new Set(),
                goalCooldowns: new Map(),
                lastUpgradedResourceType: null
            });
        }
    }
    
    processVillageState(village, villageIndex, gameState) {
        this.#processGoalCategory(village, villageIndex, gameState, 'economic');
        this.#processGoalCategory(village, villageIndex, gameState, 'military');
    }

    #rotateToNextStep(activeGoal) {
        if (!activeGoal || !activeGoal.incompleteStepIndices || activeGoal.incompleteStepIndices.length === 0) {
            return;
        }
    
        const currentIndexInList = activeGoal.incompleteStepIndices.indexOf(activeGoal.currentStepIndex);
        let nextIndexInList;

        if (currentIndexInList === -1 || currentIndexInList >= activeGoal.incompleteStepIndices.length - 1) {
            nextIndexInList = 0;
        } else {
            nextIndexInList = currentIndexInList + 1;
        }
        
        activeGoal.currentStepIndex = activeGoal.incompleteStepIndices[nextIndexInList];
        activeGoal.stepStartTime = Date.now();
    }
    
    #markStepAsComplete(activeGoal, stepIndex) {
        if (activeGoal && activeGoal.incompleteStepIndices) {
            const indexToRemove = activeGoal.incompleteStepIndices.indexOf(stepIndex);
            if (indexToRemove > -1) {
                activeGoal.incompleteStepIndices.splice(indexToRemove, 1);
            }
        }
    }

    // NUEVO MÉTODO: Verifica si todos los campos de recursos están "parejos"
    #areResourceFieldsBalanced(village) {
        const resourceTypes = ['woodcutter', 'clayPit', 'ironMine', 'cropland'];
        const fields = village.buildings.filter(b => resourceTypes.includes(b.type));
        
        if (fields.length === 0) return true;

        // Calculamos el nivel efectivo (nivel actual + mejoras en cola)
        const effectiveLevels = fields.map(f => {
            const queuedUpgrades = village.constructionQueue.filter(j => j.buildingId === f.id).length;
            return f.level + queuedUpgrades;
        });

        const minLevel = Math.min(...effectiveLevels);
        const maxLevel = Math.max(...effectiveLevels);

        // Si el mínimo es igual al máximo, están perfectamente balanceados (todos al mismo nivel)
        // Si min < max, significa que hay campos rezagados que debemos subir antes de cambiar de tarea.
        return minLevel === maxLevel;
    }

    #processGoalCategory(village, villageIndex, gameState, category) {
        const villageState = this.#villageGoalStates.get(village.id);
        const goalStack = category === 'economic' ? villageState.economicGoalStack : villageState.militaryGoalStack;
        
        if (goalStack.length === 0) {
            this.#findAndAssignNewGoalForVillage(village, villageIndex, gameState, category);
        }

        const activeGoal = goalStack.length > 0 ? goalStack[goalStack.length - 1] : null;
        if (!activeGoal) return;

        if (activeGoal.incompleteStepIndices.length === 0) {
            this.#completeGoal(activeGoal, goalStack, village, gameState, villageState, category);
            return;
        }

        if (!activeGoal.incompleteStepIndices.includes(activeGoal.currentStepIndex)) {
            this.#rotateToNextStep(activeGoal);
        }
        
        const currentStep = activeGoal.plan[activeGoal.currentStepIndex];

        if (this.#isStepCompleted(currentStep, village, gameState)) {
            this.#markStepAsComplete(activeGoal, activeGoal.currentStepIndex);
            this.#rotateToNextStep(activeGoal);
            return; 
        }

        const result = this.#actionExecutor.executePlanStep(village, currentStep, gameState, activeGoal);

        if (result.success) {
            // LÓGICA DE ROTACIÓN CONDICIONAL
            if (currentStep.type === 'resource_fields_level') {
                // Si es un paso de recursos, verificamos si hemos completado la "capa"
                if (this.#areResourceFieldsBalanced(village)) {
                    // ¡Capa completada! (Todos los campos subieron al nuevo nivel). Rotamos.
                    this.#rotateToNextStep(activeGoal);
                } else {
                    // Aún hay campos desnivelados. NO ROTAMOS.
                    // Nos quedamos en este paso para que el siguiente ciclo suba otro campo rezagado.
                }
            } else {
                // Para otros pasos (edificios, tropas), rotamos siempre para mantener el paralelismo
                this.#rotateToNextStep(activeGoal);
            }
        } else {
            // Si falló (recursos, cola llena), manejamos el bloqueo.
            const isHardBlock = this.#handleBlockedGoal(village, currentStep, activeGoal, gameState, category, result);
            
            // Si no es un bloqueo crítico, rotamos para intentar otra cosa.
            // Nota: Si es recursos y está bloqueado por cola llena (Romanos), rotamos para aprovechar la otra cola.
            if (!isHardBlock) {
                this.#rotateToNextStep(activeGoal);
            }
        }
    }

    #completeGoal(completedGoal, goalStack, village, gameState, villageState, category) {
        goalStack.pop();
        this.#controller.log('goal', village, `Objetivo ${category} Completado`, `Se ha logrado el objetivo "${completedGoal.id}".`);
        
        if (completedGoal.action) {
            this.#controller.log('info', village, 'Acción de Objetivo', `Ejecutando acción final "${completedGoal.action.type}"...`);
            this.#actionExecutor.executeGoalAction(completedGoal.action, gameState.villages.filter(v => v.ownerId === this.#controller.getOwnerId()), gameState);
        }

        if (completedGoal.isRecurring) {
            const expiresAt = Date.now() + RECURRING_GOAL_COOLDOWN_MS;
            villageState.goalCooldowns.set(completedGoal.id, expiresAt);
        } else if (!completedGoal.id.startsWith('SUB_GOAL:')) {
            villageState.completedGoals.add(completedGoal.id);
        }
    }

    #findAndAssignNewGoalForVillage(village, villageIndex, gameState, category) {
        const personality = this.#controller.getPersonality();
        const allGoals = personality.archetypes[this.#controller.getArchetype()].strategicGoals;
        const villageState = this.#villageGoalStates.get(village.id);
    
        const filterAndSortGoals = (scopePredicate) => {
            return allGoals
                .filter(goal => goal.category === category)
                .filter(goal => scopePredicate(goal.scope) && !villageState.completedGoals.has(goal.id))
                .filter(goal => {
                    const cooldownExpiresAt = villageState.goalCooldowns.get(goal.id);
                    if (cooldownExpiresAt) {
                        if (Date.now() < cooldownExpiresAt) {
                            return false;
                        } else {
                            villageState.goalCooldowns.delete(goal.id);
                        }
                    }
                    return true;
                })
                .filter(goal => this.#evaluateCondition(goal.condition, village, gameState))
                .sort((a, b) => b.priority - a.priority);
        };
    
        let potentialGoals = filterAndSortGoals(scope => scope === `village_index:${villageIndex}`);
        if (potentialGoals.length === 0) potentialGoals = filterAndSortGoals(scope => scope === 'per_village');
        if (potentialGoals.length === 0) potentialGoals = filterAndSortGoals(scope => scope === 'global');
    
        const goalStack = category === 'economic' ? villageState.economicGoalStack : villageState.militaryGoalStack;
        
        if (potentialGoals.length > 0) {
            const originalGoal = potentialGoals[0];
            const gameSpeed = this.#controller.getGameConfig()?.gameSpeed || 1;
    
            const bestGoal = JSON.parse(JSON.stringify(originalGoal));
    
            if (gameSpeed > 1) {
                bestGoal.plan.forEach(step => {
                    if (step.type === 'proportional_units') {
                        step.baseTarget = Math.floor(step.baseTarget * Math.max(1, (gameSpeed / 10)));
                    }
                });
            }
    
            const newGoal = {
                ...bestGoal,
                currentStepIndex: 0,
                stepStartTime: Date.now(),
                incompleteStepIndices: bestGoal.plan.map((_, i) => i)
            };
            goalStack.push(newGoal);

            const goalType = bestGoal.isRecurring ? 'Recurrente' : '';
            this.#controller.log('goal', village, `Nuevo Objetivo ${category} ${goalType}`.trim(), `Asignado objetivo: "${bestGoal.id}" (Prioridad: ${bestGoal.priority})`);
        }
    }

    #evaluateCondition(condition, village, gameState) {
        if (!condition) return true;
        switch (typeof condition) {
            case 'function': return condition(village, gameState);
            case 'string':
                try {
                    const func = new Function('village', 'gameState', `return ${condition}`);
                    return func(village, gameState);
                } catch (e) { this.#controller.log('error', village, 'Condición Inválida', `Error evaluando condición string: ${e}`); return false; }
            case 'object': return this.#parseConditionNode(condition, village, gameState);
            default: return true;
        }
    }

    #parseConditionNode(node, village, gameState) {
        if (node.type === 'AND') return node.conditions.every(subNode => this.#parseConditionNode(subNode, village, gameState));
        if (node.type === 'OR') return node.conditions.some(subNode => this.#parseConditionNode(subNode, village, gameState));
        return this.#evaluateRule(node, village, gameState);
    }
    
    #evaluateRule(rule, village, gameState) {
        const getBuildingLevel = (v, type) => (v.buildings.find(b => b.type === type) || { level: 0 }).level;
        const getResourceFieldsLevel = (v, resType) => {
            const resourceMap = { 'Wood': 'woodcutter', 'Clay': 'clayPit', 'Iron': 'ironMine', 'Wheat': 'cropland' };
            const typeToFind = resourceMap[resType] || null;
            const fields = v.buildings.filter(b => /^[wcif]/.test(b.id) && (typeToFind ? b.type === typeToFind : true));
            if (fields.length === 0) return 0;
            return Math.min(...fields.map(f => f.level));
        };
        const getPlayerProperty = (gs, ownerId, prop) => {
            if (prop === 'population') return gs.villages.filter(v => v.ownerId === ownerId).reduce((sum, v) => sum + v.population.current, 0);
            return 0;
        };
        const isResearchCompleted = (v, unitId) => {
            const resolvedUnitId = this.#actionExecutor.resolveUnitId(unitId);
            if (!resolvedUnitId) return false;
            return v.research.completed.includes(resolvedUnitId);
        };
        const getVillageCount = (gs, ownerId) => gs.villages.filter(v => v.ownerId === ownerId).length;
        let value;
        switch (rule.type) {
            case 'building_level': value = getBuildingLevel(village, rule.building); break;
            case 'resource_fields_level': value = getResourceFieldsLevel(village, rule.resourceType); break;
            case 'player_property': value = getPlayerProperty(gameState, village.ownerId, rule.property); break;
            case 'research_completed': return isResearchCompleted(village, rule.unit);
            case 'village_count': value = getVillageCount(gameState, village.ownerId); break;
            default: return true;
        }
        const targetValue = rule.value;
        switch (rule.operator) {
            case '>=': return value >= targetValue;
            case '<=': return value <= targetValue;
            case '==': return value == targetValue;
            case '!=': return value != targetValue;
            case '>': return value > targetValue;
            case '<': return value < targetValue;
            default: return true;
        }
    }

    #getPrerequisites(step, village, failureContext = {}) {
        const requirements = { buildings: {}, research: {} };
        const raceTroops = gameData.units[this.#controller.getRace()].troops;

        if (failureContext.reason === 'RESEARCH_REQUIRED' && failureContext.unitId) {
            requirements.research[failureContext.unitId] = true;
        }
        
        const mergeRequirements = (reqs) => {
            if (!reqs) return;
            for (const reqType in reqs) {
                requirements.buildings[reqType] = Math.max(requirements.buildings[reqType] || 0, reqs[reqType]);
            }
        };

        switch (step.type) {
            case 'building': {
                const buildingData = gameData.buildings[step.buildingType];
                const level = (village.buildings.find(b => b.type === step.buildingType)?.level || 0) + 1;
                const levelData = buildingData?.levels[level - 1];
                mergeRequirements(levelData?.requires);
                mergeRequirements(buildingData?.requires);
                break;
            }
            case 'research': {
                const unitId = this.#actionExecutor.resolveUnitId(step.unitType);
                const unitData = raceTroops.find(u => u.id === unitId);
                mergeRequirements(unitData?.research?.requires);
                break;
            }
            case 'upgrade': {
                const unitId = this.#actionExecutor.resolveUnitId(step.unitType);
                const unitData = raceTroops.find(u => u.id === unitId);
                const nextUpgradeLevel = (village.smithy.upgrades[unitId] || 0) + 1;
                
                requirements.buildings['smithy'] = Math.max(requirements.buildings['smithy'] || 0, nextUpgradeLevel);
                
                if (unitData?.research?.time > 0) {
                    requirements.research[unitId] = true;
                }
                break;
            }
            case 'proportional_units':
            case 'units': {
                const unitIdentifier = failureContext.unitId || step.baseUnit || step.unitType;
                const unitId = this.#actionExecutor.resolveUnitId(unitIdentifier);
                const unitData = raceTroops.find(u => u.id === unitId);
                if (unitData) {
                    if (unitData.research?.time > 0) {
                        requirements.research[unitId] = true;
                    }
                    mergeRequirements(unitData.research?.requires);
                    const trainingBuilding = this.#actionExecutor.getTrainingBuildingForUnit(unitId);
                    if (trainingBuilding) {
                        requirements.buildings[trainingBuilding] = Math.max(requirements.buildings[trainingBuilding] || 0, 1);
                    }
                }
                break;
            }
        }
        return requirements;
    }

    #handleBlockedGoal(village, failedStep, activeGoal, gameState, category, failureContext = {}) {
        if (!failedStep || !activeGoal) return false;
        const villageState = this.#villageGoalStates.get(village.id);
        if (!villageState) return false;

        const goalStack = category === 'economic' ? villageState.economicGoalStack : villageState.militaryGoalStack;
        const stepName = failedStep.buildingType || failedStep.unitType || failedStep.baseUnit || 'recurso';

        const pushSubGoal = (subGoal, reason) => {
            this.#controller.log('warn', village, `Objetivo ${category} Bloqueado`, `Razón: ${reason}. Creando sub-objetivo para '${stepName}'.`);
            goalStack.push({ ...subGoal, parentGoalId: activeGoal.id });
        };

        const prerequisites = this.#getPrerequisites(failedStep, village, failureContext);
        const resourceFieldTypes = ['woodcutter', 'clayPit', 'ironMine', 'cropland'];

        for (const reqBuildingType in prerequisites.buildings) {
            const reqLevel = prerequisites.buildings[reqBuildingType];
            let requirementMet = false;

            if (resourceFieldTypes.includes(reqBuildingType)) {
                requirementMet = village.buildings.some(b => b.type === reqBuildingType && b.level >= reqLevel);
            } else {
                const requiredBuilding = village.buildings.find(b => b.type === reqBuildingType);
                requirementMet = requiredBuilding && requiredBuilding.level >= reqLevel;
            }

            if (!requirementMet) {
                const highestLevelInProgress = village.constructionQueue
                    .filter(j => j.buildingType === reqBuildingType)
                    .reduce((max, job) => Math.max(max, job.targetLevel), 0);

                if (highestLevelInProgress < reqLevel) {
                    const reason = `Se necesita ${reqBuildingType} a nivel ${reqLevel}.`;
                    pushSubGoal({
                        id: `SUB_GOAL:BUILD_PREREQ_${reqBuildingType.toUpperCase()}`,
                        priority: 999,
                        plan: [{ type: 'building', buildingType: reqBuildingType, level: reqLevel }],
                        currentStepIndex: 0,
                        stepStartTime: Date.now(),
                        incompleteStepIndices: [0],
                        category: 'economic'
                    }, reason);
                    return true;
                }
            }
        }

        for (const reqUnitId in prerequisites.research) {
            if (!village.research.completed.includes(reqUnitId) && !village.research.queue.some(j => j.unitId === reqUnitId)) {
                const unitIdentifier = gameData.units[this.#controller.getRace()].troops.find(t => t.id === reqUnitId)?.id || reqUnitId;
                const reason = `Se necesita investigar ${unitIdentifier}.`;
                pushSubGoal({
                    id: `SUB_GOAL:RESEARCH_UNIT_${reqUnitId.toUpperCase()}`,
                    priority: 998,
                    plan: [{ type: 'research', unitType: unitIdentifier }],
                    currentStepIndex: 0,
                    stepStartTime: Date.now(),
                    incompleteStepIndices: [0],
                    category: 'military'
                }, reason);
                return true;
            }
        }

        if (village.constructionQueue.length >= village.maxConstructionSlots) {
            pushSubGoal({ id: `SUB_GOAL:WAIT_FOR_QUEUE:CONSTRUCTION`, plan: [], currentStepIndex: 0, stepStartTime: Date.now(), incompleteStepIndices: [], category }, "Cola de construcción general llena.");
            return true;
        }
        
        if (village.race === 'romans' && (failedStep.type === 'building' || failedStep.type === 'resource_fields_level')) {
            const buildingIdForStep = failedStep.buildingId || (village.buildings.find(b => b.type === failedStep.buildingType)?.id || '');
            const isNewJobResource = /^[wcif]/.test(buildingIdForStep);
            const resourceJobsInQueue = village.constructionQueue.filter(j => /^[wcif]/.test(j.buildingId)).length;
            const infraJobsInQueue = village.constructionQueue.length - resourceJobsInQueue;
            if ((isNewJobResource && resourceJobsInQueue >= 2) || (!isNewJobResource && infraJobsInQueue >= 2)) {
                pushSubGoal({ id: `SUB_GOAL:WAIT_FOR_QUEUE:CONSTRUCTION`, plan: [], currentStepIndex: 0, stepStartTime: Date.now(), incompleteStepIndices: [], category }, "Cola de Romanos llena.");
                return true;
            }
        }

        if (failedStep.type === 'research' && village.research.queue.length > 0) {
            pushSubGoal({ id: `SUB_GOAL:WAIT_FOR_QUEUE:RESEARCH`, plan: [], currentStepIndex: 0, stepStartTime: Date.now(), incompleteStepIndices: [], category }, "Cola de investigación llena.");
            return true;
        }
        if (failedStep.type === 'upgrade' && village.smithy.queue.length > 0) {
            pushSubGoal({ id: `SUB_GOAL:WAIT_FOR_QUEUE:SMITHY`, plan: [], currentStepIndex: 0, stepStartTime: Date.now(), incompleteStepIndices: [], category }, "Cola de herrería llena.");
            return true;
        }

        const cost = this.#getStepCost(failedStep, village, gameState);
        const personality = this.#controller.getPersonality();
        
        const economicActions = ['building', 'resource_fields_level', 'research', 'upgrade'];
        const stepCategory = economicActions.includes(failedStep.type) ? 'economic' : 'military';
        
        const budgetRatioForStep = stepCategory === 'economic' 
            ? personality.buildRatio?.econ || 0.5
            : personality.buildRatio?.mil || 0.5;

        for (const res in cost) {
            const effectiveCapacity = village.resources[res].capacity * budgetRatioForStep;
            if (cost[res] > effectiveCapacity) {
                const storageType = res === 'food' ? 'granary' : 'warehouse';
                const MAX_STORAGE_LEVEL = 20;

                const storages = village.buildings.filter(b => b.type === storageType);
                const queuedStorageIds = new Set(village.constructionQueue.map(j => j.buildingId));
                
                const candidateForUpgrade = storages
                    .filter(s => s.level < MAX_STORAGE_LEVEL && !queuedStorageIds.has(s.id))
                    .sort((a, b) => a.level - b.level)[0];

                if (candidateForUpgrade) {
                    const reason = `Se necesita más capacidad de ${storageType}. Mejorando el existente.`;
                    pushSubGoal({
                        id: `SUB_GOAL:UPGRADE_${storageType.toUpperCase()}`,
                        priority: 997,
                        plan: [{ type: 'building', buildingType: storageType, level: candidateForUpgrade.level + 1 }],
                        currentStepIndex: 0,
                        stepStartTime: Date.now(),
                        incompleteStepIndices: [0],
                        category: 'economic'
                    }, reason);
                    return true;
                }

                const emptySlot = village.buildings.find(b => b.type === 'empty' && /^v[0-9]+/.test(b.id));
                if (emptySlot) {
                    const reason = `Se necesita más capacidad de ${storageType}. Construyendo nuevo.`;
                    pushSubGoal({
                        id: `SUB_GOAL:BUILD_NEW_${storageType.toUpperCase()}`,
                        priority: 996,
                        plan: [{ type: 'building', buildingType: storageType, level: 1 }],
                        currentStepIndex: 0,
                        stepStartTime: Date.now(),
                        incompleteStepIndices: [0],
                        category: 'economic'
                    }, reason);
                    return true;
                }
                
                this.#controller.log('warn', village, 'Almacenamiento Bloqueado', `No se puede aumentar la capacidad de ${storageType}.`);
                return true;
            }
        }

        pushSubGoal({ id: `SUB_GOAL:SAVE_RESOURCES_FOR:${stepName.toUpperCase()}`, plan: [], currentStepIndex: 0, stepStartTime: Date.now(), incompleteStepIndices: [], category }, "Recursos insuficientes.");
        return false; 
    }
    
    #isGoalCompleted(goal, village, gameState, category) {
        if (goal.id.startsWith('SUB_GOAL:WAIT_FOR_QUEUE')) {
            const queueType = goal.id.split(':')[2];
            let isQueueFree = false;
            switch (queueType) {
                case 'CONSTRUCTION':
                    isQueueFree = village.constructionQueue.length < village.maxConstructionSlots;
                    break;
                case 'RESEARCH':
                    isQueueFree = village.research.queue.length === 0;
                    break;
                case 'SMITHY':
                    isQueueFree = village.smithy.queue.length === 0;
                    break;
            }
            if (isQueueFree) {
                this.#controller.log('success', village, 'Cola Libre', `La cola de ${queueType} está disponible. Reanudando objetivo principal.`);
            }
            return isQueueFree;
        }

        if (goal.id.startsWith('SUB_GOAL:SAVE_RESOURCES_FOR')) {
            const villageState = this.#villageGoalStates.get(village.id);
            const goalStack = category === 'economic' ? villageState.economicGoalStack : villageState.militaryGoalStack;
            if (goalStack.length < 2) return false;
            const parentGoal = goalStack[goalStack.length - 2];
            if (!parentGoal) return false;
            
            const stepToAfford = parentGoal.plan[parentGoal.currentStepIndex];
            if (!stepToAfford) return false;

            const cost = this.#getStepCost(stepToAfford, village, gameState);
            
            const personality = this.#controller.getPersonality();
            const goalCategory = parentGoal.category === 'military' ? 'mil' : 'econ';
            const budgetRatio = personality.buildRatio[goalCategory] || 0.5;
            
            const canAfford = Object.keys(cost).every(res => (village.resources[res].current * budgetRatio) >= cost[res]);
            
            if (canAfford) {
                const stepName = stepToAfford.buildingType || stepToAfford.unitType || 'recurso';
                this.#controller.log('success', village, 'Ahorro de Recursos', `Recursos para "${stepName}" acumulados. Reanudando objetivo.`);
            }
            return canAfford;
        }

        return goal.plan.every(step => this.#isStepCompleted(step, village, gameState));
    }

    #getStepCost(step, village, gameState) {
        switch (step.type) {
            case 'building':
            case 'resource_fields_level': {
                const buildingType = step.buildingType || this.#actionExecutor.getResourceTypeFromStep(step);
                if (!buildingType) return {};
                const building = village.buildings.find(b => b.type === buildingType);
                const level = (building ? building.level : 0) + village.constructionQueue.filter(j => j.buildingType === buildingType).length;
                const buildingData = gameData.buildings[buildingType];
                return buildingData?.levels[level]?.cost || {};
            }
            case 'units': {
                const unitId = this.#actionExecutor.resolveUnitId(step.unitType);
                const unitData = gameData.units[this.#controller.getRace()].troops.find(u => u.id === unitId);
                return unitData?.cost || {};
            }
            case 'research': {
                const unitId = this.#actionExecutor.resolveUnitId(step.unitType);
                const unitData = gameData.units[this.#controller.getRace()].troops.find(u => u.id === unitId);
                return unitData?.research?.cost || {};
            }
            case 'upgrade': {
                const unitId = this.#actionExecutor.resolveUnitId(step.unitType);
                const unitData = gameData.units[this.#controller.getRace()].troops.find(u => u.id === unitId);
                if (!unitData) return {};
                const currentLevel = village.smithy.upgrades[unitId] || 0;
                const cost = {};
                for (const res in unitData.cost) cost[res] = Math.floor(unitData.cost[res] * Math.pow(1.6, currentLevel + 1));
                return cost;
            }
            case 'proportional_units': {
                const allUnitTypes = [step.baseUnit, ...step.proportions.map(p => p.unit)];
                let maxCost = {};
                let mostExpensiveUnitCost = 0;
                allUnitTypes.forEach(unitType => {
                    const unitCost = this.#getStepCost({ type: 'units', unitType: unitType }, village, gameState);
                    const totalResourceCost = Object.values(unitCost).reduce((a, b) => a + b, 0);
                    if (totalResourceCost > mostExpensiveUnitCost) {
                        mostExpensiveUnitCost = totalResourceCost;
                        maxCost = unitCost;
                    }
                });
                return maxCost;
            }
            default: return {};
        }
    }

    #isStepCompleted(step, village, gameState) {
        if (!step) return false;
        const allVillages = gameState.villages.filter(v => v.ownerId === this.#controller.getOwnerId());
    
        switch (step.type) {
            case 'building': {
                const building = village.buildings.find(b => b.type === step.buildingType);
                const isLevelMet = building && building.level >= step.level;
                return isLevelMet;
            }
    
            case 'resource_fields_level': {
                let fields = village.buildings.filter(b => /^[wcif]/.test(b.id));
                const resourceType = this.#actionExecutor.getResourceTypeFromStep(step);
                if (resourceType) fields = fields.filter(f => f.type === resourceType);
                if (fields.length === 0 && step.level > 0) return false;
    
                return fields.every(field => field.level >= step.level);
            }
    
            case 'units': {
                const unitId = this.#actionExecutor.resolveUnitId(step.unitType);
                if (!unitId) return true;
    
                const settlerId = this.#actionExecutor.resolveUnitId('settler');
                const chiefId = this.#actionExecutor.resolveUnitId('chief');
    
                if (unitId === settlerId || unitId === chiefId) {
                    const totalInThisVillage = (village.unitsInVillage[unitId] || 0) +
                                               village.recruitmentQueue.filter(j => j.unitId === unitId).reduce((qSum, j) => qSum + j.count, 0);
                    return totalInThisVillage >= step.count;
                }
                
                const totalInAllVillages = allVillages.reduce((sum, v) => sum + (v.unitsInVillage[unitId] || 0), 0);
                const totalInAllQueues = allVillages.reduce((sum, v) => {
                    return sum + v.recruitmentQueue.filter(j => j.unitId === unitId).reduce((qSum, j) => qSum + j.count, 0);
                }, 0);
                
                return (totalInAllVillages + totalInAllQueues) >= step.count;
            }
    
            case 'research': {
                const researchUnitId = this.#actionExecutor.resolveUnitId(step.unitType);
                return village.research.completed.includes(researchUnitId);
            }
    
            case 'upgrade': {
                const upgradeUnitId = this.#actionExecutor.resolveUnitId(step.unitType);
                return (village.smithy.upgrades[upgradeUnitId] || 0) >= step.level;
            }
    
            case 'proportional_units': {
                const { baseUnit, proportions, baseTarget } = step;
                const baseUnitId = this.#actionExecutor.resolveUnitId(baseUnit);
                if (!baseUnitId) return true;
    
                const getTotalUnitCount = (unitId) => {
                    const totalInVillages = allVillages.reduce((sum, v) => sum + (v.unitsInVillage[unitId] || 0), 0);
                    const totalInQueue = allVillages.reduce((sum, v) => {
                        return sum + v.recruitmentQueue.filter(j => j.unitId === unitId).reduce((qSum, j) => qSum + j.count, 0);
                    }, 0);
                    return totalInVillages + totalInQueue;
                };
    
                if (getTotalUnitCount(baseUnitId) < baseTarget) return false;
                
                for (const proportion of proportions) {
                    const proportionalUnitId = this.#actionExecutor.resolveUnitId(proportion.unit);
                    if (!proportionalUnitId) continue;
                    const targetCount = Math.floor(baseTarget * (proportion.ratio / 100));
                    if (getTotalUnitCount(proportionalUnitId) < targetCount) return false;
                }
                return true;
            }
    
            default: 
                return false;
        }
    }
}

export default AIGoalManager;