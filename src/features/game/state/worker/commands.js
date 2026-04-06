export function handleSendMovementCommand({ payload, gameState, gameConfig, gameData, aiControllers }) {
    const { originVillageId, targetCoords, troops, missionType, catapultTargets } = payload;
    const village = gameState.villages.find(candidate => candidate.id === originVillageId);
    if (!village) return { success: false, reason: 'VILLAGE_NOT_FOUND' };

    if (missionType === 'espionage') {
        const raceTroops = gameData.units[village.race].troops;
        for (const unitId in troops) {
            const unitData = raceTroops.find(troop => troop.id === unitId);
            if (!unitData || unitData.type !== 'scout') {
                return { success: false, reason: 'INVALID_TROOPS_FOR_ESPIONAGE' };
            }
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
        id: `${startTime}-mov-${village.id}`,
        type: missionType,
        ownerId: village.ownerId,
        originVillageId: village.id,
        targetCoords,
        payload: {
            troops,
            catapultTargets: catapultTargets || [],
        },
        startTime,
        arrivalTime: startTime + travelTimeMs,
    };

    gameState.movements.push(newMovement);
    gameState.movements.sort((a, b) => a.arrivalTime - b.arrivalTime);

    const targetTile = gameState.mapData.find(tile => tile.x === targetCoords.x && tile.y === targetCoords.y);
    if (targetTile && targetTile.type === 'village' && targetTile.ownerId.startsWith('ai_') && targetTile.ownerId !== village.ownerId) {
        const targetAIController = aiControllers.find(controller => controller.getOwnerId() === targetTile.ownerId);
        if (targetAIController) {
            const hostileTypes = ['attack', 'raid', 'espionage'];
            if (hostileTypes.includes(missionType)) {
                targetAIController.handleReactiveEvent('movement_dispatched', newMovement, gameState);
            }
        }
    }

    return { success: true };
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
    const totalCapacity = merchantCount * merchantData.stats.capacity;
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
        id: `${startTime}-mov-trade-${village.id}`,
        type: 'trade',
        ownerId: village.ownerId,
        originVillageId: village.id,
        targetCoords,
        payload: {
            resources,
            merchants: Math.ceil(totalSent / merchantData.stats.capacity),
        },
        startTime,
        arrivalTime: startTime + travelTimeMs,
    });

    gameState.movements.sort((a, b) => a.arrivalTime - b.arrivalTime);
    return { success: true };
}
