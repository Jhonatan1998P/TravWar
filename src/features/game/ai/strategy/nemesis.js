export function getPlayerTotalPopulation(gameState, ownerId) {
    return gameState.villages
        .filter(village => village.ownerId === ownerId)
        .reduce((sum, village) => sum + village.population.current, 0);
}

export function findPotentialVictims(gameState, myOwnerId) {
    const targetCounts = {};
    gameState.players.forEach(player => {
        targetCounts[player.id] = 0;
    });

    for (const aiId in gameState.aiState) {
        if (aiId === myOwnerId) continue;
        const otherAiNemesis = gameState.aiState[aiId].nemesisId;
        if (otherAiNemesis) {
            targetCounts[otherAiNemesis] = (targetCounts[otherAiNemesis] || 0) + 1;
        }
    }

    let candidates = gameState.players.filter(player => {
        if (player.id === myOwnerId || player.id === 'nature') return false;

        const pop = getPlayerTotalPopulation(gameState, player.id);
        if (pop <= 3) return false;
        if (targetCounts[player.id] >= 2) return false;

        player.pop = pop;
        return true;
    });

    if (candidates.length === 0) {
        candidates = gameState.players.filter(player => {
            if (player.id === myOwnerId || player.id === 'nature') return false;

            const pop = getPlayerTotalPopulation(gameState, player.id);
            if (pop <= 3) return false;

            player.pop = pop;
            return true;
        });
    }

    return candidates;
}

export function manageNemesis(gameState, myOwnerId, aiState, log) {
    let currentNemesisId = aiState.nemesisId;

    if (currentNemesisId) {
        const totalPop = getPlayerTotalPopulation(gameState, currentNemesisId);
        if (totalPop <= 3) {
            log.push(`[VICTORIA] Némesis ${currentNemesisId} eliminado. Buscando nueva víctima.`);
            currentNemesisId = null;
            aiState.nemesisId = null;
        }
    }

    if (!currentNemesisId) {
        const potentialVictims = findPotentialVictims(gameState, myOwnerId);
        if (potentialVictims.length > 0) {
            const victim = potentialVictims[Math.floor(Math.random() * potentialVictims.length)];
            currentNemesisId = victim.id;
            aiState.nemesisId = currentNemesisId;
            log.push(`[POLÍTICA] Nuevo Rival: ${victim.id} (Pob: ${victim.pop}).`);
        }
    }

    return currentNemesisId;
}
