export const AI_CONTROLLER_CONSTANTS = Object.freeze({
    dodgeTimeThresholdMs: 10_000,
});

export const AI_GOAL_MANAGER_CONSTANTS = Object.freeze({
    recurringGoalCooldownMs: 10 * 60 * 1000,
});

export const AI_STRATEGY_CONSTANTS = Object.freeze({
    searchRadius: 30,
    scoutsPerMission: 5,
    minCatsForTrain: 20,
    maxWaves: 5,
});

export const AI_SETTLEMENT_CONSTANTS = Object.freeze({
    maxSearchRadius: 25,
    minDistanceFromExistingVillage: 4,
});

export const AI_RECRUITMENT_CONSTANTS = Object.freeze({
    laneRecruitmentBatchMode: 'dynamic_cycle',
    dynamicCycleFraction: 0.2,
});

export const AI_HUN_CONSTANTS = Object.freeze({
    deepseekEnabled: true,
    deepseekApiKey: 'sk-9f6f0ba847444efcb4f7f12385935131',
});
