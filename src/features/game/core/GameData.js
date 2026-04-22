// js/core/GameData.js

import { buildings, config, oasisTypes, units } from './data/index.js';
export {
    FARM_LIST_LIMITS,
    RESOURCE_FIELD_BUILDING_TYPES,
    RESOURCE_LABEL_TO_BUILDING_TYPE,
    STORAGE_BUILDING_BY_RESOURCE,
    resolveDefaultFarmTroops,
    resolveDefaultFarmUnitId,
    findFirstUnitByRole,
    findFirstUnitByType,
    findUnitById,
    getBuildingData,
    getBuildingLevelData,
    getOasisTypeData,
    getRaceTroops,
} from './data/index.js';

export const NON_TARGETABLE_BUILDINGS = ['cranny'];

/**
 * GameData: La Fuente Unica de Verdad (Single Source of Truth).
 * Contiene todos los datos estaticos de balanceo del juego.
 */
export const gameData = {
    buildings,
    units,
    oasisTypes,
    config,
};
