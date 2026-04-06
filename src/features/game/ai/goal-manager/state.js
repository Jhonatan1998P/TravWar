export function createEmptyVillageGoalState() {
    return {
        economicGoalStack: [],
        militaryGoalStack: [],
        completedGoals: new Set(),
        goalCooldowns: new Map(),
        lastUpgradedResourceType: null,
    };
}

export function initializeGoalScheduler(goal) {
    goal.proportionalUnitPointer = goal.proportionalUnitPointer ?? 0;
    goal.currentStepIndex = goal.currentStepIndex ?? 0;
    goal.stepStartTime = goal.stepStartTime ?? Date.now();
    if (!goal.incompleteStepIndices || goal.incompleteStepIndices.length === 0) {
        goal.incompleteStepIndices = goal.plan ? goal.plan.map((_, index) => index) : [];
    }
}

export function buildVillageGoalState(persistentVillageState = {}) {
    persistentVillageState.economicGoalStack?.forEach(initializeGoalScheduler);
    persistentVillageState.militaryGoalStack?.forEach(initializeGoalScheduler);

    return {
        economicGoalStack: persistentVillageState.economicGoalStack || [],
        militaryGoalStack: persistentVillageState.militaryGoalStack || [],
        completedGoals: new Set(persistentVillageState.completedGoals || []),
        goalCooldowns: new Map(persistentVillageState.goalCooldowns || []),
        lastUpgradedResourceType: persistentVillageState.lastUpgradedResourceType || null,
    };
}

export function serializeVillageGoalStates(villageGoalStates) {
    const serializableState = {};

    for (const [villageId, villageState] of villageGoalStates.entries()) {
        const cleanStack = stack => stack.map(goal => {
            const { currentStep, ...rest } = goal;
            return rest;
        });

        serializableState[villageId] = {
            economicGoalStack: cleanStack(villageState.economicGoalStack),
            militaryGoalStack: cleanStack(villageState.militaryGoalStack),
            completedGoals: Array.from(villageState.completedGoals),
            goalCooldowns: Array.from(villageState.goalCooldowns.entries()),
            lastUpgradedResourceType: villageState.lastUpgradedResourceType,
        };
    }

    return serializableState;
}
