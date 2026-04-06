// RUTA: js/ai/AIGoalManager.js
import { gameData } from '../core/GameData.js';
import { AI_GOAL_MANAGER_CONSTANTS } from './config/AIConstants.js';
import { RESOURCE_FIELD_BUILDING_TYPES, STORAGE_BUILDING_BY_RESOURCE } from '../core/data/constants.js';
import { evaluateCondition } from './goal-manager/conditions.js';
import {
    getPrerequisites,
    getStepCost,
    isStepCompleted,
} from './goal-manager/steps.js';
import {
    buildVillageGoalState,
    createEmptyVillageGoalState,
    serializeVillageGoalStates,
} from './goal-manager/state.js';

const RESOURCE_STEP_NAME = 'resource_fields';

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

            this.#villageGoalStates.set(village.id, buildVillageGoalState(persistentVillageState));
        });
    }
    
    getState() {
        return serializeVillageGoalStates(this.#villageGoalStates);
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
            this.#villageGoalStates.set(villageId, createEmptyVillageGoalState());
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

    #getStepName(step) {
        if (!step) return 'unknown_step';
        if (step.type === 'resource_fields_level') {
            return step.resourceType ? `resource_fields_${step.resourceType}` : RESOURCE_STEP_NAME;
        }
        if (step.type === 'building') return step.buildingType || 'building';
        if (step.type === 'research' || step.type === 'upgrade' || step.type === 'units') {
            return step.unitType || 'unit';
        }
        if (step.type === 'proportional_units') return step.baseUnit || 'proportional_units';
        return step.type || 'step';
    }

    #getBudgetSplit(village, stepCategory) {
        if (village.budgetRatio) {
            if (stepCategory === 'economic') return village.budgetRatio.econ ?? 0.5;
            return village.budgetRatio.mil ?? 0.5;
        }

        const personality = this.#controller.getPersonality();
        if (stepCategory === 'economic') return personality.buildRatio?.econ || 0.5;
        return personality.buildRatio?.mil || 0.5;
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
            if (this.#isGoalCompleted(activeGoal, village, gameState, category)) {
                this.#completeGoal(activeGoal, goalStack, village, gameState, villageState, category);
            }
            return;
        }

        if (!activeGoal.incompleteStepIndices.includes(activeGoal.currentStepIndex)) {
            this.#rotateToNextStep(activeGoal);
        }
        
        const currentStep = activeGoal.plan[activeGoal.currentStepIndex];
        if (!currentStep) {
            this.#rotateToNextStep(activeGoal);
            return;
        }

        if (this.#isStepCompleted(currentStep, village, gameState)) {
            this.#markStepAsComplete(activeGoal, activeGoal.currentStepIndex);
            this.#rotateToNextStep(activeGoal);
            return; 
        }

        const result = this.#actionExecutor.executePlanStep(village, currentStep, gameState, activeGoal);

        if (result.success) {
            this.#rotateToNextStep(activeGoal);
        } else {
            const isHardBlock = this.#handleBlockedGoal(village, currentStep, activeGoal, gameState, category, result);
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
            const expiresAt = Date.now() + AI_GOAL_MANAGER_CONSTANTS.recurringGoalCooldownMs;
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
        return evaluateCondition(condition, {
            village,
            gameState,
            resolveUnitId: this.#actionExecutor.resolveUnitId.bind(this.#actionExecutor),
            onUnsupportedString: () => {
                this.#controller.log('warn', village, 'Condición No Soportada', 'Las condiciones de texto plano fueron deshabilitadas por seguridad. Usa condición tipo función u objeto.');
            },
        });
    }

    #getPrerequisites(step, village, failureContext = {}) {
        return getPrerequisites({
            step,
            village,
            failureContext,
            race: this.#controller.getRace(),
            actionExecutor: this.#actionExecutor,
        });
    }

    #handleBlockedGoal(village, failedStep, activeGoal, gameState, category, failureContext = {}) {
        if (!failedStep || !activeGoal) return false;
        const villageState = this.#villageGoalStates.get(village.id);
        if (!villageState) return false;

        const goalStack = category === 'economic' ? villageState.economicGoalStack : villageState.militaryGoalStack;
        const stepName = this.#getStepName(failedStep);

        const pushSubGoal = (subGoal, reason) => {
            if (goalStack.some(goal => goal.id === subGoal.id)) {
                return;
            }
            this.#controller.log('warn', village, `Objetivo ${category} Bloqueado`, `Razón: ${reason}. Creando sub-objetivo para '${stepName}'.`);
            goalStack.push({ ...subGoal, parentGoalId: activeGoal.id });
        };

        const prerequisites = this.#getPrerequisites(failedStep, village, failureContext);
        const resourceFieldTypes = RESOURCE_FIELD_BUILDING_TYPES;

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
                    category
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
        const economicActions = ['building', 'resource_fields_level', 'research', 'upgrade'];
        const stepCategory = economicActions.includes(failedStep.type) ? 'economic' : 'military';
        const budgetRatioForStep = this.#getBudgetSplit(village, stepCategory);

        for (const res in cost) {
            const effectiveCapacity = village.resources[res].capacity * budgetRatioForStep;
            if (cost[res] > effectiveCapacity) {
                const storageType = STORAGE_BUILDING_BY_RESOURCE[res] || 'warehouse';
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

            const stepIndexToAfford = parentGoal.incompleteStepIndices?.includes(parentGoal.currentStepIndex)
                ? parentGoal.currentStepIndex
                : parentGoal.incompleteStepIndices?.[0];
            const stepToAfford = parentGoal.plan[stepIndexToAfford];
            if (!stepToAfford) return false;

            const cost = this.#getStepCost(stepToAfford, village, gameState);

            const goalCategory = parentGoal.category === 'military' ? 'mil' : 'econ';
            const budget = goalCategory === 'econ'
                ? (village.budget?.econ || {
                    wood: village.resources.wood.current,
                    stone: village.resources.stone.current,
                    iron: village.resources.iron.current,
                    food: village.resources.food.current,
                })
                : (village.budget?.mil || {
                    wood: village.resources.wood.current,
                    stone: village.resources.stone.current,
                    iron: village.resources.iron.current,
                    food: village.resources.food.current,
                });

            const canAfford = Object.keys(cost).every(res => (budget[res] || 0) >= cost[res]);
            
            if (canAfford) {
                const stepName = this.#getStepName(stepToAfford);
                this.#controller.log('success', village, 'Ahorro de Recursos', `Recursos para "${stepName}" acumulados. Reanudando objetivo.`);
            }
            return canAfford;
        }

        return goal.plan.every(step => this.#isStepCompleted(step, village, gameState));
    }

    #getStepCost(step, village, gameState) {
        return getStepCost({
            step,
            village,
            gameState,
            race: this.#controller.getRace(),
            actionExecutor: this.#actionExecutor,
        });
    }

    #isStepCompleted(step, village, gameState) {
        return isStepCompleted({
            step,
            village,
            gameState,
            ownerId: this.#controller.getOwnerId(),
            actionExecutor: this.#actionExecutor,
        });
    }
}

export default AIGoalManager;
