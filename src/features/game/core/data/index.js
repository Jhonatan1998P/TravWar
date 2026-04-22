export { buildings } from './buildings.js';
export { units } from './units.js';
export { oasisTypes } from './oasisTypes.js';
export { config } from './config.js';
export {
    BEGINNER_PROTECTION_POPULATION_THRESHOLD,
    BUDGET_RATIO_REBALANCE_INTERVAL_MS,
    FARM_LIST_LIMITS,
    OASIS_BEAST_SCALING_MAX,
    OASIS_BEAST_SCALING_MIN,
    OASIS_SPEED_MULTIPLIER_STEP,
    RESOURCE_FIELD_BUILDING_TYPES,
    RESOURCE_LABEL_TO_BUILDING_TYPE,
    STORAGE_BUILDING_BY_RESOURCE,
    getOasisSpeedMultiplier,
    isUnderBeginnerProtectionByPopulation,
    resolveDefaultFarmTroops,
    resolveDefaultFarmUnitId,
    resolvePhaseEngineRolloutFlags,
} from './constants.js';
export {
    findFirstUnitByRole,
    findFirstUnitByType,
    findUnitById,
    getBuildingData,
    getBuildingLevelData,
    getOasisTypeData,
    getRaceTroops,
} from './lookups.js';
