import { buildings } from './buildings.js';
import { units } from './units.js';
import { oasisTypes } from './oasisTypes.js';

export function getRaceTroops(race) {
    return units[race]?.troops || [];
}

export function findUnitById(race, unitId) {
    return getRaceTroops(race).find(unit => unit.id === unitId);
}

export function findFirstUnitByType(race, type) {
    return getRaceTroops(race).find(unit => unit.type === type);
}

export function findFirstUnitByRole(race, role) {
    return getRaceTroops(race).find(unit => unit.role === role);
}

export function getBuildingData(buildingType) {
    return buildings[buildingType];
}

export function getBuildingLevelData(buildingType, level) {
    if (!Number.isFinite(level) || level <= 0) return null;
    const building = getBuildingData(buildingType);
    return building?.levels?.[level - 1] || null;
}

export function getOasisTypeData(oasisTypeId) {
    return oasisTypes[oasisTypeId];
}
