import {
    BEGINNER_PROTECTION_POPULATION_THRESHOLD,
    FARM_LIST_LIMITS,
    isUnderBeginnerProtectionByPopulation,
    resolveDefaultFarmTroops,
} from '../../core/data/constants.js';
import { getScaledMerchantCapacityPerUnit } from '../../core/capacityScaling.js';
import { createNpcExchangeState, getRandomNpcExchangeCooldownMs } from '../../core/npcExchange.js';
import { compareMovementsByArrival } from './movementOrdering.js';

const HOSTILE_MISSION_TYPES = new Set(['attack', 'raid', 'espionage']);
const FARM_LIST_MISSION_TYPES = new Set(['raid', 'attack', 'espionage']);
const RESOURCE_KEYS = ['wood', 'stone', 'iron', 'food'];
const OASIS_CAPTURE_RANGE = 7;
let movementIdSequence = 0;

function createMovementId(prefix, startTime, villageId) {
    movementIdSequence = (movementIdSequence + 1) % 1000000;
    return `${startTime}-${prefix}-${villageId}-${movementIdSequence}`;
}

function getOwnerTotalPopulation(gameState, ownerId) {
    return (gameState?.villages || [])
        .filter(village => village.ownerId === ownerId)
        .reduce((sum, village) => sum + (village.population?.current || 0), 0);
}

function isOwnerUnderBeginnerProtection(gameState, ownerId) {
    const ownerState = gameState?.players?.find(player => player.id === ownerId);
    if (ownerState && typeof ownerState.isUnderProtection === 'boolean') {
        return ownerState.isUnderProtection;
    }
    const totalPopulation = getOwnerTotalPopulation(gameState, ownerId);
    return isUnderBeginnerProtectionByPopulation(totalPopulation);
}

function ownerExists(gameState, ownerId) {
    if (!ownerId) return false;
    if (gameState?.players?.some(player => player.id === ownerId)) return true;
    return gameState?.villages?.some(village => village.ownerId === ownerId) || false;
}

function getOwnerRace(gameState, ownerId) {
    return gameState?.players?.find(player => player.id === ownerId)?.race
        || gameState?.villages?.find(village => village.ownerId === ownerId)?.race
        || null;
}

function getOwnerFarmListsState(gameState, ownerId) {
    if (!gameState.farmListsByOwnerId || typeof gameState.farmListsByOwnerId !== 'object') {
        gameState.farmListsByOwnerId = {};
    }

    if (!gameState.farmListsByOwnerId[ownerId] || typeof gameState.farmListsByOwnerId[ownerId] !== 'object') {
        gameState.farmListsByOwnerId[ownerId] = { lists: [] };
    }

    if (!Array.isArray(gameState.farmListsByOwnerId[ownerId].lists)) {
        gameState.farmListsByOwnerId[ownerId].lists = [];
    }

    return gameState.farmListsByOwnerId[ownerId];
}

function normalizeTargetCoords(targetCoords) {
    const x = Number(targetCoords?.x);
    const y = Number(targetCoords?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y) };
}

function findMapTileByCoords(gameState, targetCoords) {
    return gameState.mapData.find(tile => tile.x === targetCoords.x && tile.y === targetCoords.y) || null;
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

function getVillageOasisCount(village) {
    return Array.isArray(village?.oases) ? village.oases.length : 0;
}

function getPendingOasisCaptureCount(gameState, villageId) {
    return (gameState.movements || []).filter(movement => {
        return movement.originVillageId === villageId
            && movement.type === 'attack'
            && movement.payload?.conquerOasis === true;
    }).length;
}

function resolveFarmEntryTarget({ gameState, ownerId, targetCoords }) {
    const normalizedCoords = normalizeTargetCoords(targetCoords);
    if (!normalizedCoords) {
        return { success: false, reason: 'INVALID_TARGET_COORDS' };
    }

    const tile = findMapTileByCoords(gameState, normalizedCoords);
    if (!tile) {
        return {
            success: false,
            reason: 'TARGET_COORDS_OUT_OF_MAP',
            details: { targetCoords: normalizedCoords },
        };
    }

    if (tile.type === 'oasis') {
        return {
            success: true,
            targetType: 'oasis',
            targetCoords: normalizedCoords,
        };
    }

    if (tile.type !== 'village') {
        return {
            success: false,
            reason: 'TARGET_TILE_NOT_ELIGIBLE',
            details: { targetCoords: normalizedCoords, tileType: tile.type },
        };
    }

    if (tile.ownerId === ownerId) {
        return {
            success: false,
            reason: 'OWN_VILLAGE_NOT_ALLOWED',
            details: { targetCoords: normalizedCoords },
        };
    }

    return {
        success: true,
        targetType: 'village',
        targetCoords: normalizedCoords,
    };
}

function sanitizeFarmListName(name, fallback) {
    if (typeof name !== 'string') return fallback;
    const trimmedName = name.trim();
    return trimmedName.length > 0 ? trimmedName : fallback;
}

function sanitizeFarmEntryTroops(troops, ownerRace, gameData, options = {}) {
    const { allowDefaultFallback = true } = options;
    const allowedUnits = new Set(
        (gameData?.units?.[ownerRace]?.troops || [])
            .filter(unit => unit?.id && unit.type !== 'merchant')
            .map(unit => unit.id),
    );

    const normalizedTroops = {};
    if (troops && typeof troops === 'object' && !Array.isArray(troops)) {
        Object.entries(troops).forEach(([unitId, amount]) => {
            const parsedAmount = Math.floor(Number(amount));
            if (!allowedUnits.has(unitId) || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
            normalizedTroops[unitId] = parsedAmount;
        });
    }

    if (Object.keys(normalizedTroops).length > 0) {
        return normalizedTroops;
    }

    if (!allowDefaultFallback) {
        return {};
    }

    return resolveDefaultFarmTroops(ownerRace);
}

function hasDuplicateTargetInFarmList(list, targetCoords) {
    return (list.entries || []).some(entry => {
        const coords = normalizeTargetCoords(entry.targetCoords);
        if (!coords) return false;
        return coords.x === targetCoords.x && coords.y === targetCoords.y;
    });
}

function createFarmListId() {
    return `farm_list_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createFarmEntryId() {
    return `entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function addFarmListEntry({ payload, gameState, gameData }) {
    const ownerId = payload?.ownerId;
    const listId = payload?.listId;

    if (!ownerExists(gameState, ownerId)) {
        return { success: false, reason: 'OWNER_NOT_FOUND' };
    }

    const ownerFarmListState = getOwnerFarmListsState(gameState, ownerId);
    const list = ownerFarmListState.lists.find(candidate => candidate.id === listId);
    if (!list) {
        return { success: false, reason: 'FARM_LIST_NOT_FOUND' };
    }

    if ((list.entries?.length || 0) >= FARM_LIST_LIMITS.maxEntriesPerList) {
        return {
            success: false,
            reason: 'FARM_LIST_MAX_ENTRIES_REACHED',
            details: { maxEntriesPerList: FARM_LIST_LIMITS.maxEntriesPerList },
        };
    }

    const targetResult = resolveFarmEntryTarget({
        gameState,
        ownerId,
        targetCoords: payload?.targetCoords,
    });
    if (!targetResult.success) {
        return targetResult;
    }

    if (hasDuplicateTargetInFarmList(list, targetResult.targetCoords)) {
        return {
            success: false,
            reason: 'FARM_LIST_DUPLICATE_TARGET',
            details: { targetCoords: targetResult.targetCoords },
        };
    }

    const ownerRace = getOwnerRace(gameState, ownerId);
    const troops = sanitizeFarmEntryTroops(null, ownerRace, gameData);
    if (Object.keys(troops).length === 0) {
        return { success: false, reason: 'NO_DEFAULT_FARM_UNIT' };
    }

    const entry = {
        id: createFarmEntryId(),
        targetType: targetResult.targetType,
        targetCoords: targetResult.targetCoords,
        troops,
        lastDispatchAtByOrigin: {},
    };

    list.entries.push(entry);
    list.updatedAt = Date.now();

    return {
        success: true,
        listId: list.id,
        entry,
    };
}

export function handleSendMovementCommand({ payload, gameState, gameConfig, gameData, aiControllers }) {
    const { originVillageId, targetCoords, troops, missionType, catapultTargets, conquerOasis } = payload;
    const village = gameState.villages.find(candidate => candidate.id === originVillageId);
    if (!village) return { success: false, reason: 'VILLAGE_NOT_FOUND' };

    const targetTile = gameState.mapData.find(tile => tile.x === targetCoords?.x && tile.y === targetCoords?.y);
    const defenderVillage = targetTile?.type === 'village'
        ? gameState.villages.find(candidate => candidate.id === targetTile.villageId)
        : null;

    if (HOSTILE_MISSION_TYPES.has(missionType) && defenderVillage && defenderVillage.ownerId !== village.ownerId) {
        const attackerPopulation = getOwnerTotalPopulation(gameState, village.ownerId);
        const defenderPopulation = getOwnerTotalPopulation(gameState, defenderVillage.ownerId);
        const attackerUnderProtection = isOwnerUnderBeginnerProtection(gameState, village.ownerId);
        const defenderUnderProtection = isOwnerUnderBeginnerProtection(gameState, defenderVillage.ownerId);

        if (attackerUnderProtection) {
            return {
                success: false,
                reason: 'ATTACKER_UNDER_BEGINNER_PROTECTION',
                details: {
                    missionType,
                    attackerOwnerId: village.ownerId,
                    defenderOwnerId: defenderVillage.ownerId,
                    threshold: BEGINNER_PROTECTION_POPULATION_THRESHOLD,
                    attackerPopulation,
                },
            };
        }

        if (defenderUnderProtection) {
            return {
                success: false,
                reason: 'TARGET_UNDER_BEGINNER_PROTECTION',
                details: {
                    missionType,
                    attackerOwnerId: village.ownerId,
                    defenderOwnerId: defenderVillage.ownerId,
                    threshold: BEGINNER_PROTECTION_POPULATION_THRESHOLD,
                    defenderPopulation,
                },
            };
        }
    }

    if (missionType === 'espionage') {
        const raceTroops = gameData.units[village.race].troops;
        for (const unitId in troops) {
            const unitData = raceTroops.find(troop => troop.id === unitId);
            if (!unitData || unitData.type !== 'scout') {
                return { success: false, reason: 'INVALID_TROOPS_FOR_ESPIONAGE' };
            }
        }
    }

    if (conquerOasis) {
        if (missionType !== 'attack') return { success: false, reason: 'OASIS_CONQUEST_REQUIRES_ATTACK' };
        if (targetTile?.type !== 'oasis') return { success: false, reason: 'TARGET_NOT_OASIS' };
        if (targetTile.villageId === village.id) return { success: false, reason: 'OASIS_ALREADY_OWNED_BY_VILLAGE' };
        if (!isOasisInCaptureRange(village, targetCoords)) return { success: false, reason: 'OASIS_OUT_OF_RANGE' };

        const oasisSlots = getHeroMansionOasisSlots(village);
        const usedOasisSlots = getVillageOasisCount(village) + getPendingOasisCaptureCount(gameState, village.id);
        if (usedOasisSlots >= oasisSlots) {
            return {
                success: false,
                reason: 'NO_OASIS_SLOTS_AVAILABLE',
                details: { availableSlots: oasisSlots, usedSlots: usedOasisSlots },
            };
        }
    }

    for (const unitId in troops) {
        const count = troops[unitId];
        if (count <= 0 || (village.unitsInVillage[unitId] || 0) < count) {
            return {
                success: false,
                reason: 'INSUFFICIENT_TROOPS',
                details: { needed: troops, available: village.unitsInVillage },
            };
        }
    }

    if (missionType === 'settle') {
        const settlerUnitId = Object.keys(troops).find(id => gameData.units[village.race].troops.find(troop => troop.id === id)?.type === 'settler');
        if (!settlerUnitId || troops[settlerUnitId] < 3) {
            return {
                success: false,
                reason: 'INSUFFICIENT_SETTLERS',
                details: { needed: 3, available: troops[settlerUnitId] || 0 },
            };
        }

        const settlementsFoundedByThisVillage = village.settlementsFounded || 0;
        let requiredPop = 0;
        if (settlementsFoundedByThisVillage === 0) requiredPop = 150;
        else if (settlementsFoundedByThisVillage === 1) requiredPop = 300;
        else if (settlementsFoundedByThisVillage === 2) requiredPop = 600;
        else return { success: false, reason: 'MAX_SETTLEMENTS_REACHED' };

        if (village.population.current < requiredPop) {
            return {
                success: false,
                reason: 'INSUFFICIENT_POPULATION',
                details: { needed: requiredPop, available: village.population.current },
            };
        }

        const settlementCost = gameData.config.settlement.cost;
        const isAI = village.ownerId.startsWith('ai_') && village.budget;
        const availableRes = isAI ? village.budget.econ : village.resources;
        const currentRes = isAI
            ? availableRes
            : {
                wood: availableRes.wood.current,
                stone: availableRes.stone.current,
                iron: availableRes.iron.current,
                food: availableRes.food.current,
            };

        for (const res in settlementCost) {
            if (currentRes[res] < settlementCost[res]) {
                return {
                    success: false,
                    reason: 'INSUFFICIENT_RESOURCES',
                    details: { needed: settlementCost, available: currentRes },
                };
            }
        }

        for (const res in settlementCost) {
            if (isAI) {
                village.budget.econ[res] -= settlementCost[res];
                village.resources[res].current = village.budget.econ[res] + village.budget.mil[res];
            } else {
                village.resources[res].current -= settlementCost[res];
            }
        }
    }

    let slowestSpeed = Infinity;
    for (const unitId in troops) {
        const unitData = gameData.units[village.race].troops.find(unit => unit.id === unitId);
        if (unitData.stats.speed < slowestSpeed) slowestSpeed = unitData.stats.speed;
    }
    if (slowestSpeed === Infinity) return { success: false, reason: 'NO_VALID_UNITS' };

    const distance = Math.hypot(targetCoords.x - village.coords.x, targetCoords.y - village.coords.y);
    const travelTimeMs = ((distance / (slowestSpeed * gameConfig.troopSpeed)) * 3600) * 1000;
    const startTime = Date.now();

    for (const unitId in troops) {
        village.unitsInVillage[unitId] -= troops[unitId];
    }

    const newMovement = {
        id: createMovementId('mov', startTime, village.id),
        type: missionType,
        ownerId: village.ownerId,
        originVillageId: village.id,
        targetCoords,
        payload: {
            troops,
            catapultTargets: catapultTargets || [],
            conquerOasis: conquerOasis === true,
        },
        startTime,
        arrivalTime: startTime + travelTimeMs,
    };

    gameState.movements.push(newMovement);
    gameState.movements.sort(compareMovementsByArrival);

    if (targetTile && targetTile.type === 'village' && targetTile.ownerId.startsWith('ai_') && targetTile.ownerId !== village.ownerId) {
        const targetAIController = aiControllers.find(controller => controller.getOwnerId() === targetTile.ownerId);
        if (targetAIController) {
            const hostileTypes = ['attack', 'raid', 'espionage'];
            if (hostileTypes.includes(missionType)) {
                targetAIController.handleReactiveEvent('movement_dispatched', newMovement, gameState);
            }
        }
    }

    return { success: true, movementId: newMovement.id };
}

export function handleSendMerchantsCommand({ payload, gameState, gameConfig, gameData }) {
    const { originVillageId, targetCoords, resources } = payload;
    const village = gameState.villages.find(candidate => candidate.id === originVillageId);
    if (!village) return { success: false, reason: 'VILLAGE_NOT_FOUND' };

    const marketplace = village.buildings.find(building => building.type === 'marketplace');
    if (!marketplace || marketplace.level === 0) return { success: false, reason: 'MARKETPLACE_REQUIRED' };

    const merchantData = gameData.units[village.race].troops.find(troop => troop.type === 'merchant');
    if (!merchantData) return { success: false, reason: 'NO_MERCHANT_UNIT_FOR_RACE' };

    const merchantCount = gameData.buildings.marketplace.levels[marketplace.level - 1].attribute.merchantCapacity;
    const merchantCapacityPerUnit = getScaledMerchantCapacityPerUnit(
        village.race,
        gameConfig?.gameSpeed || 1,
        merchantData.stats.capacity,
    );
    const totalCapacity = merchantCount * merchantCapacityPerUnit;
    const totalSent = Object.values(resources).reduce((sum, value) => sum + value, 0);

    if (totalSent > totalCapacity) {
        return {
            success: false,
            reason: 'MERCHANT_CAPACITY_EXCEEDED',
            details: { sent: totalSent, capacity: totalCapacity },
        };
    }

    const isAI = village.ownerId.startsWith('ai_') && village.budget;
    const availableRes = isAI ? village.budget.econ : village.resources;
    const currentRes = isAI
        ? availableRes
        : {
            wood: availableRes.wood.current,
            stone: availableRes.stone.current,
            iron: availableRes.iron.current,
            food: availableRes.food.current,
        };

    for (const res in resources) {
        if (currentRes[res] < resources[res]) {
            return {
                success: false,
                reason: 'INSUFFICIENT_RESOURCES',
                details: { needed: resources, available: currentRes },
            };
        }
    }

    for (const res in resources) {
        if (isAI) {
            village.budget.econ[res] -= resources[res];
            village.resources[res].current = village.budget.econ[res] + village.budget.mil[res];
        } else {
            village.resources[res].current -= resources[res];
        }
    }

    const distance = Math.hypot(targetCoords.x - village.coords.x, targetCoords.y - village.coords.y);
    const travelTimeMs = ((distance / (merchantData.stats.speed * gameConfig.troopSpeed)) * 3600) * 1000;
    const startTime = Date.now();

    gameState.movements.push({
        id: createMovementId('mov-trade', startTime, village.id),
        type: 'trade',
        ownerId: village.ownerId,
        originVillageId: village.id,
        targetCoords,
        payload: {
            resources,
            merchants: Math.ceil(totalSent / Math.max(merchantCapacityPerUnit, 1)),
        },
        startTime,
        arrivalTime: startTime + travelTimeMs,
    });

    gameState.movements.sort(compareMovementsByArrival);
    return { success: true };
}

export function handleNpcResourceExchangeCommand({ payload, gameState }) {
    const villageId = payload?.villageId;
    const village = gameState.villages.find(candidate => candidate.id === villageId);
    if (!village) return { success: false, reason: 'VILLAGE_NOT_FOUND' };

    const marketplace = village.buildings.find(building => building.type === 'marketplace');
    if (!marketplace || marketplace.level === 0) return { success: false, reason: 'MARKETPLACE_REQUIRED' };

    const now = Date.now();
    village.npcExchange ??= createNpcExchangeState(now);
    const nextAvailableAt = Number(village.npcExchange.nextAvailableAt) || 0;
    if (nextAvailableAt > now) {
        return {
            success: false,
            reason: 'NPC_EXCHANGE_COOLDOWN',
            details: { nextAvailableAt, remainingMs: nextAvailableAt - now },
        };
    }

    const requestedResources = payload?.resources;
    if (!requestedResources || typeof requestedResources !== 'object' || Array.isArray(requestedResources)) {
        return { success: false, reason: 'INVALID_RESOURCE_DISTRIBUTION' };
    }

    const currentTotal = RESOURCE_KEYS.reduce((sum, resourceKey) => {
        return sum + Math.floor(Number(village.resources?.[resourceKey]?.current) || 0);
    }, 0);

    const normalizedResources = {};
    let requestedTotal = 0;
    for (const resourceKey of RESOURCE_KEYS) {
        const amount = Math.floor(Number(requestedResources[resourceKey]) || 0);
        if (!Number.isFinite(amount) || amount < 0) {
            return { success: false, reason: 'INVALID_RESOURCE_AMOUNT', details: { resourceKey } };
        }

        const capacity = Math.floor(Number(village.resources?.[resourceKey]?.capacity) || 0);
        if (amount > capacity) {
            return {
                success: false,
                reason: 'RESOURCE_CAPACITY_EXCEEDED',
                details: { resourceKey, amount, capacity },
            };
        }

        normalizedResources[resourceKey] = amount;
        requestedTotal += amount;
    }

    if (requestedTotal !== currentTotal) {
        return {
            success: false,
            reason: 'NPC_EXCHANGE_TOTAL_MISMATCH',
            details: { requestedTotal, currentTotal },
        };
    }

    for (const resourceKey of RESOURCE_KEYS) {
        village.resources[resourceKey].current = normalizedResources[resourceKey];
    }

    village.npcExchange.lastExchangeAt = now;
    village.npcExchange.nextAvailableAt = now + getRandomNpcExchangeCooldownMs();

    return {
        success: true,
        villageId: village.id,
        resources: normalizedResources,
        nextAvailableAt: village.npcExchange.nextAvailableAt,
    };
}

export function handleReleaseOasisCommand({ payload, gameState }) {
    const villageId = payload?.villageId;
    const x = Number(payload?.x);
    const y = Number(payload?.y);
    if (!villageId || !Number.isFinite(x) || !Number.isFinite(y)) {
        return { success: false, reason: 'INVALID_PAYLOAD' };
    }

    const village = gameState.villages.find(candidate => candidate.id === villageId);
    if (!village) return { success: false, reason: 'VILLAGE_NOT_FOUND' };

    const oasis = (village.oases || []).find(item => item.x === x && item.y === y);
    if (!oasis) return { success: false, reason: 'OASIS_NOT_OWNED_BY_VILLAGE' };

    const tile = gameState.mapData.find(candidate => candidate.x === x && candidate.y === y && candidate.type === 'oasis');
    if (!tile) return { success: false, reason: 'OASIS_TILE_NOT_FOUND' };

    village.oases = (village.oases || []).filter(item => item.x !== x || item.y !== y);
    if (tile.villageId === villageId) {
        tile.villageId = null;
        tile.ownerId = null;
    }
    if (tile.state?.villageId === villageId) {
        tile.state.villageId = null;
        tile.state.ownerId = null;
    }

    return { success: true, villageId, oasis: { x, y, oasisType: oasis.oasisType || tile.oasisType } };
}

export function handleFarmListCreateCommand({ payload, gameState }) {
    const ownerId = payload?.ownerId;
    if (!ownerExists(gameState, ownerId)) {
        return { success: false, reason: 'OWNER_NOT_FOUND' };
    }

    const ownerFarmListState = getOwnerFarmListsState(gameState, ownerId);
    if (ownerFarmListState.lists.length >= FARM_LIST_LIMITS.maxListsPerOwner) {
        return {
            success: false,
            reason: 'FARM_LIST_MAX_LISTS_REACHED',
            details: { maxListsPerOwner: FARM_LIST_LIMITS.maxListsPerOwner },
        };
    }

    const requestedListId = typeof payload?.listId === 'string' ? payload.listId.trim() : '';
    if (requestedListId && ownerFarmListState.lists.some(list => list.id === requestedListId)) {
        return { success: false, reason: 'FARM_LIST_ID_ALREADY_EXISTS' };
    }

    const now = Date.now();
    const defaultName = `Lista ${ownerFarmListState.lists.length + 1}`;
    const list = {
        id: requestedListId || createFarmListId(),
        name: sanitizeFarmListName(payload?.name, defaultName),
        createdAt: now,
        updatedAt: now,
        entries: [],
    };
    ownerFarmListState.lists.push(list);

    return {
        success: true,
        ownerId,
        list,
    };
}

export function handleFarmListDeleteCommand({ payload, gameState }) {
    const ownerId = payload?.ownerId;
    const listId = payload?.listId;
    if (!ownerExists(gameState, ownerId)) {
        return { success: false, reason: 'OWNER_NOT_FOUND' };
    }

    const ownerFarmListState = getOwnerFarmListsState(gameState, ownerId);
    const listIndex = ownerFarmListState.lists.findIndex(list => list.id === listId);
    if (listIndex === -1) {
        return { success: false, reason: 'FARM_LIST_NOT_FOUND' };
    }

    const [deletedList] = ownerFarmListState.lists.splice(listIndex, 1);
    return {
        success: true,
        ownerId,
        deletedListId: deletedList.id,
    };
}

export function handleFarmListRenameCommand({ payload, gameState }) {
    const ownerId = payload?.ownerId;
    const listId = payload?.listId;
    const requestedName = payload?.name;
    if (!ownerExists(gameState, ownerId)) {
        return { success: false, reason: 'OWNER_NOT_FOUND' };
    }

    if (typeof requestedName !== 'string' || requestedName.trim().length === 0) {
        return { success: false, reason: 'INVALID_FARM_LIST_NAME' };
    }

    const ownerFarmListState = getOwnerFarmListsState(gameState, ownerId);
    const list = ownerFarmListState.lists.find(candidate => candidate.id === listId);
    if (!list) {
        return { success: false, reason: 'FARM_LIST_NOT_FOUND' };
    }

    list.name = requestedName.trim();
    list.updatedAt = Date.now();

    return {
        success: true,
        ownerId,
        listId: list.id,
        name: list.name,
    };
}

export function handleFarmListAddEntryFromTileCommand({ payload, gameState, gameData }) {
    return addFarmListEntry({ payload, gameState, gameData });
}

export function handleFarmListAddEntryByCoordsCommand({ payload, gameState, gameData }) {
    return addFarmListEntry({ payload, gameState, gameData });
}

export function handleFarmListUpdateEntryTroopsCommand({ payload, gameState, gameData }) {
    const ownerId = payload?.ownerId;
    const listId = payload?.listId;
    const entryId = payload?.entryId;
    if (!ownerExists(gameState, ownerId)) {
        return { success: false, reason: 'OWNER_NOT_FOUND' };
    }

    const ownerFarmListState = getOwnerFarmListsState(gameState, ownerId);
    const list = ownerFarmListState.lists.find(candidate => candidate.id === listId);
    if (!list) {
        return { success: false, reason: 'FARM_LIST_NOT_FOUND' };
    }

    const entry = list.entries.find(candidate => candidate.id === entryId);
    if (!entry) {
        return { success: false, reason: 'FARM_LIST_ENTRY_NOT_FOUND' };
    }

    const ownerRace = getOwnerRace(gameState, ownerId);
    const troops = sanitizeFarmEntryTroops(payload?.troops, ownerRace, gameData, {
        allowDefaultFallback: false,
    });
    if (Object.keys(troops).length === 0) {
        return { success: false, reason: 'INVALID_FARM_LIST_TROOPS' };
    }

    entry.troops = troops;
    list.updatedAt = Date.now();

    return {
        success: true,
        ownerId,
        listId: list.id,
        entryId: entry.id,
        troops,
    };
}

export function handleFarmListRemoveEntryCommand({ payload, gameState }) {
    const ownerId = payload?.ownerId;
    const listId = payload?.listId;
    const entryId = payload?.entryId;
    if (!ownerExists(gameState, ownerId)) {
        return { success: false, reason: 'OWNER_NOT_FOUND' };
    }

    const ownerFarmListState = getOwnerFarmListsState(gameState, ownerId);
    const list = ownerFarmListState.lists.find(candidate => candidate.id === listId);
    if (!list) {
        return { success: false, reason: 'FARM_LIST_NOT_FOUND' };
    }

    const entryIndex = list.entries.findIndex(candidate => candidate.id === entryId);
    if (entryIndex === -1) {
        return { success: false, reason: 'FARM_LIST_ENTRY_NOT_FOUND' };
    }

    const [deletedEntry] = list.entries.splice(entryIndex, 1);
    list.updatedAt = Date.now();

    return {
        success: true,
        ownerId,
        listId: list.id,
        deletedEntryId: deletedEntry.id,
    };
}

export function handleFarmListSendEntriesCommand({ payload, gameState, dispatchMovement }) {
    const ownerId = payload?.ownerId;
    const listId = payload?.listId;
    const originVillageId = payload?.originVillageId;
    const requestedEntryIds = payload?.entryIds;
    const missionType = payload?.missionType || FARM_LIST_LIMITS.defaultMissionType;

    if (!ownerExists(gameState, ownerId)) {
        return { success: false, reason: 'OWNER_NOT_FOUND' };
    }

    if (!FARM_LIST_MISSION_TYPES.has(missionType)) {
        return {
            success: false,
            reason: 'INVALID_FARM_LIST_MISSION_TYPE',
            details: { missionType },
        };
    }

    const originVillage = gameState.villages.find(village => village.id === originVillageId);
    if (!originVillage) {
        return { success: false, reason: 'VILLAGE_NOT_FOUND' };
    }

    if (originVillage.ownerId !== ownerId) {
        return { success: false, reason: 'ORIGIN_VILLAGE_OWNER_MISMATCH' };
    }

    const ownerFarmListState = getOwnerFarmListsState(gameState, ownerId);
    const list = ownerFarmListState.lists.find(candidate => candidate.id === listId);
    if (!list) {
        return { success: false, reason: 'FARM_LIST_NOT_FOUND' };
    }

    let entriesToDispatch = [];
    if (requestedEntryIds === undefined || requestedEntryIds === null) {
        entriesToDispatch = list.entries.map(entry => ({ entryId: entry.id, entry }));
    } else if (Array.isArray(requestedEntryIds)) {
        const uniqueEntryIds = [...new Set(requestedEntryIds
            .filter(entryId => typeof entryId === 'string')
            .map(entryId => entryId.trim())
            .filter(Boolean))];

        const requestedEntryIdSet = new Set(uniqueEntryIds);
        const existingEntryById = new Map((list.entries || []).map(entry => [entry.id, entry]));

        entriesToDispatch = (list.entries || [])
            .filter(entry => requestedEntryIdSet.has(entry.id))
            .map(entry => ({
                entryId: entry.id,
                entry,
            }));

        uniqueEntryIds.forEach(entryId => {
            if (!existingEntryById.has(entryId)) {
                entriesToDispatch.push({
                    entryId,
                    entry: null,
                });
            }
        });
    } else {
        return {
            success: false,
            reason: 'INVALID_FARM_LIST_ENTRY_SELECTION',
            details: { entryIds: requestedEntryIds },
        };
    }

    if (entriesToDispatch.length === 0) {
        return { success: false, reason: 'NO_FARM_LIST_ENTRIES_SELECTED' };
    }

    const results = [];
    let successfulDispatches = 0;

    for (const item of entriesToDispatch) {
        const { entryId, entry } = item;
        if (!entry) {
            results.push({
                entryId,
                success: false,
                reason: 'FARM_LIST_ENTRY_NOT_FOUND',
            });
            continue;
        }

        const targetValidation = resolveFarmEntryTarget({
            gameState,
            ownerId,
            targetCoords: entry.targetCoords,
        });
        if (!targetValidation.success) {
            results.push({
                entryId,
                success: false,
                reason: targetValidation.reason,
                details: targetValidation.details,
            });
            continue;
        }

        const now = Date.now();
        const lastDispatchAt = Number(entry.lastDispatchAtByOrigin?.[originVillageId]) || 0;
        const elapsed = now - lastDispatchAt;
        if (elapsed < FARM_LIST_LIMITS.minDispatchCooldownMs) {
            results.push({
                entryId,
                success: false,
                reason: 'ENTRY_COOLDOWN',
                details: {
                    remainingMs: FARM_LIST_LIMITS.minDispatchCooldownMs - elapsed,
                    minDispatchCooldownMs: FARM_LIST_LIMITS.minDispatchCooldownMs,
                },
            });
            continue;
        }

        const movementResult = dispatchMovement({
            originVillageId,
            targetCoords: targetValidation.targetCoords,
            troops: entry.troops,
            missionType,
        });

        if (!movementResult?.success) {
            results.push({
                entryId,
                success: false,
                reason: movementResult?.reason || 'MOVEMENT_DISPATCH_FAILED',
                details: movementResult?.details,
            });
            continue;
        }

        if (!entry.lastDispatchAtByOrigin || typeof entry.lastDispatchAtByOrigin !== 'object') {
            entry.lastDispatchAtByOrigin = {};
        }
        entry.lastDispatchAtByOrigin[originVillageId] = now;
        successfulDispatches += 1;
        results.push({
            entryId,
            success: true,
            movementId: movementResult.movementId || null,
        });
    }

    if (successfulDispatches > 0) {
        list.updatedAt = Date.now();
    }

    return {
        success: successfulDispatches > 0,
        listId,
        originVillageId,
        results,
        sentCount: successfulDispatches,
        failedCount: results.length - successfulDispatches,
    };
}
