export function getPlayerTotalPopulation(gameState, ownerId) {
    return gameState.villages
        .filter(village => village.ownerId === ownerId)
        .reduce((sum, village) => sum + village.population.current, 0);
}

export function getPlayerVillages(gameState, playerId) {
    return gameState.villages.filter(village => village.ownerId === playerId);
}

function minDistanceToAnyMyVillage(candidateVillages, myVillages) {
    if (myVillages.length === 0 || candidateVillages.length === 0) return Infinity;
    let minDist = Infinity;
    for (const myVillage of myVillages) {
        for (const theirVillage of candidateVillages) {
            const dist = Math.hypot(theirVillage.coords.x - myVillage.coords.x, theirVillage.coords.y - myVillage.coords.y);
            if (dist < minDist) minDist = dist;
        }
    }
    return minDist;
}

function computeVillageClusterScore(playerVillages) {
    if (playerVillages.length <= 1) return 1;
    let totalDist = 0;
    let pairs = 0;
    for (let i = 0; i < playerVillages.length; i++) {
        for (let j = i + 1; j < playerVillages.length; j++) {
            totalDist += Math.hypot(
                playerVillages[i].coords.x - playerVillages[j].coords.x,
                playerVillages[i].coords.y - playerVillages[j].coords.y,
            );
            pairs++;
        }
    }
    const avgDist = pairs > 0 ? totalDist / pairs : 0;
    return 1 / (1 + avgDist * 0.05);
}

function countOtherAITargetingPlayer(gameState, playerId, myOwnerId) {
    let count = 0;
    for (const aiId in gameState.aiState || {}) {
        if (aiId === myOwnerId) continue;
        if (gameState.aiState[aiId].nemesisId === playerId) count++;
    }
    return count;
}

function getAllianceStrength(gameState, allianceId) {
    if (!allianceId || allianceId === 'nature') return Infinity;
    const members = gameState.players.filter(p => p.allianceId === allianceId);
    if (members.length === 0) return 0;
    return members.reduce((sum, p) => sum + (p.pop || 0), 0);
}

function countKnownInactiveVillages(gameState, playerId) {
    if (!gameState.aiState) return 0;
    const myAiState = Object.values(gameState.aiState);
    let count = 0;
    for (const aiState of myAiState) {
        if (!aiState.farmList) continue;
        for (const farm of aiState.farmList) {
            if (farm.ownerId === playerId) count++;
        }
    }
    return count;
}

export function scoreNemesisCandidate(candidate, myVillages, candidateVillages, gameState = null) {
    const dist = minDistanceToAnyMyVillage(candidateVillages, myVillages);
    const pop = candidate.pop || 0;
    const villages = candidateVillages.length;
    const clusterScore = computeVillageClusterScore(candidateVillages);
    const proximityScore = 1000 / (dist + 1);

    let allianceStrength = 50;
    if (candidate.allianceId && gameState) {
        allianceStrength = getAllianceStrength(gameState, candidate.allianceId);
    }
    const allianceWeaknessScore = 100 / (allianceStrength + 1);

    let farmableScore = 0;
    if (gameState) {
        farmableScore = countKnownInactiveVillages(gameState, candidate.id) * 5;
    }

    return (
        proximityScore * 0.30 +
        (pop * 0.005) * 0.15 +
        (villages * 8) * 0.15 +
        (clusterScore * 60) * 0.20 +
        allianceWeaknessScore * 0.10 +
        farmableScore * 0.10
    );
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

export function selectBestNemesisCandidate(candidates, gameState, myOwnerId) {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const myVillages = getPlayerVillages(gameState, myOwnerId);
    let bestCandidate = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
        const candidateVillages = getPlayerVillages(gameState, candidate.id);
        const score = scoreNemesisCandidate(candidate, myVillages, candidateVillages, gameState);
        if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
        }
    }

    return bestCandidate;
}

export function reevaluateNemesis(gameState, myOwnerId, aiState, currentNemesisId, log) {
    if (!currentNemesisId) return null;

    const myVillages = getPlayerVillages(gameState, myOwnerId);
    const nemesisVillages = getPlayerVillages(gameState, currentNemesisId);
    const dist = minDistanceToAnyMyVillage(nemesisVillages, myVillages);

    const tooFar = dist > 80;
    const otherTargetCount = countOtherAITargetingPlayer(gameState, currentNemesisId, myOwnerId);
    const overTargeted = otherTargetCount >= 3;

    if (tooFar || overTargeted) {
        log.push(`[POLITICS] Reevaluando nemesis ${currentNemesisId}: tooFar=${tooFar}, overTargeted=${overTargeted}.`);
        return null;
    }

    return currentNemesisId;
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

    if (currentNemesisId) {
        const reevaluated = reevaluateNemesis(gameState, myOwnerId, aiState, currentNemesisId, log);
        if (!reevaluated) {
            currentNemesisId = null;
            aiState.nemesisId = null;
        }
    }

    if (!currentNemesisId) {
        const potentialVictims = findPotentialVictims(gameState, myOwnerId);
        if (potentialVictims.length > 0) {
            const victim = selectBestNemesisCandidate(potentialVictims, gameState, myOwnerId);
            if (victim) {
                currentNemesisId = victim.id;
                aiState.nemesisId = currentNemesisId;
                log.push(`[POLÍTICA] Nuevo Rival (scoring): ${victim.id} (Pob: ${victim.pop}).`);
            }
        }
    }

    return currentNemesisId;
}
