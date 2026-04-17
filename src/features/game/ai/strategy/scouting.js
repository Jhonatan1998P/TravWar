export function scanTargets(gameState, village, radius, myOwnerId) {
    const targets = [];

    for (const candidateVillage of gameState.villages) {
        if (candidateVillage.ownerId === myOwnerId || candidateVillage.ownerId === 'nature') continue;

        const dist = Math.hypot(
            candidateVillage.coords.x - village.coords.x,
            candidateVillage.coords.y - village.coords.y,
        );

        if (dist <= radius) {
            targets.push({
                type: 'village',
                data: candidateVillage,
                coords: candidateVillage.coords,
                id: candidateVillage.id,
                dist,
                population: candidateVillage.population,
                ownerId: candidateVillage.ownerId,
            });
        }
    }

    for (const tile of gameState.mapData) {
        if (tile.type !== 'oasis') continue;

        const dist = Math.hypot(tile.x - village.coords.x, tile.y - village.coords.y);
        if (dist <= radius) {
            targets.push({
                type: 'oasis',
                data: tile,
                coords: { x: tile.x, y: tile.y },
                id: `oasis_${tile.x}_${tile.y}`,
                dist,
                ownerId: 'nature',
            });
        }
    }

    return targets;
}

export function analyzeEspionageHistory(gameState, targetId, myOwnerId) {
    const mySpyReports = gameState.reports.filter(report =>
        report.type === 'espionage' &&
        report.attacker.ownerId === myOwnerId &&
        report.defender.villageId === targetId,
    );

    let lastSuccess = null;
    let lastFailure = null;
    let lastFailureCount = 0;

    mySpyReports.sort((a, b) => b.time - a.time);

    for (const report of mySpyReports) {
        if (report.payload) {
            if (!lastSuccess) lastSuccess = report;
        } else if (!lastFailure) {
            lastFailure = report;
            const scoutId = Object.keys(report.attacker.troops).find(() => true);
            if (scoutId) {
                lastFailureCount = report.attacker.troops[scoutId];
            }
        }

        if (lastSuccess && lastFailure) break;
    }

    return { lastSuccess, lastFailure, lastFailureCount };
}

export function dispatchSpies(forces, target, baseCount, log, reason, isRetry = false, lastCount = 0) {
    let countNeeded = baseCount;
    let mode = 'Base';

    if (isRetry) {
        mode = 'Venganza';
        countNeeded = Math.max(baseCount, lastCount * 2);
    }

    let bestForce = null;
    let maxScouts = -1;
    for (const force of forces) {
        if (force.scoutCount > maxScouts) {
            maxScouts = force.scoutCount;
            bestForce = force;
        }
    }

    if (!bestForce) return null;

    if (isRetry) {
        if (bestForce.scoutCount >= countNeeded) {
            countNeeded = bestForce.scoutCount;
        } else {
            const scoutId = bestForce.scoutId;
            const totalScouts = bestForce.totalTroops[scoutId] || 0;
            if (totalScouts >= countNeeded) {
                log.push(`[INTEL] Reintento pendiente. Espías ocupados (En casa: ${bestForce.scoutCount} / Total: ${totalScouts}). Esperando retorno.`);
            } else {
                log.push(`[INTEL] Reintento fallido. Necesito ${countNeeded} espías, tengo ${totalScouts} en total. Se requiere reclutamiento.`);
            }
            return null;
        }
    } else if (bestForce.scoutCount < countNeeded) {
        return null;
    }

    bestForce.scoutCount -= countNeeded;
    bestForce.troops[bestForce.scoutId] -= countNeeded;
    log.push(`[INTEL] ${reason} (${mode}): ${target.data.name}. Enviando ${countNeeded} espías.`);

    return {
        comando: 'SPY',
        villageId: bestForce.village.id,
        parametros: {
            targetCoords: target.coords,
            tropas: {
                [bestForce.scoutId]: countNeeded,
            },
            mision: 'espionage',
        },
    };
}

export function performGeneralIntelligence(forces, unknownTargets, nemesisId, scoutsPerMission) {
    const commands = [];
    const logs = [];

    const targets = unknownTargets.filter(target => target.ownerId !== nemesisId);
    targets.sort((a, b) => a.dist - b.dist);

    targets.forEach(target => {
        if (target.dist > 30) return;

        const isRetry = target.spyStatus === 'failed';
        const command = dispatchSpies(
            forces,
            target,
            scoutsPerMission,
            logs,
            'Exploración Rutinaria',
            isRetry,
            target.lastSpyCount,
        );

        if (command) commands.push(command);
    });

    return { commands, logs };
}

export function scanAndClassifyTargets({
    gameState,
    forces,
    myOwnerId,
    nemesisId,
    nemesisInterval,
    generalInterval,
    searchRadius,
}) {
    const knownTargets = [];
    const unknownTargets = [];
    const scannedIds = new Set();

    forces.forEach(force => {
        const localTargets = scanTargets(gameState, force.village, searchRadius, myOwnerId);

        localTargets.forEach(target => {
            if (scannedIds.has(target.id)) return;
            scannedIds.add(target.id);

            if (target.type === 'oasis') {
                knownTargets.push(target);
                return;
            }

            const espionageAnalysis = analyzeEspionageHistory(gameState, target.id, myOwnerId);
            const threshold = target.ownerId === nemesisId ? nemesisInterval : generalInterval;
            const isIntelFresh = espionageAnalysis.lastSuccess && (Date.now() - espionageAnalysis.lastSuccess.time < threshold);

            target.spyStatus = 'unknown';
            target.lastSpyCount = 0;

            if (espionageAnalysis.lastFailure && (!espionageAnalysis.lastSuccess || espionageAnalysis.lastFailure.time > espionageAnalysis.lastSuccess.time)) {
                target.spyStatus = 'failed';
                target.lastSpyCount = espionageAnalysis.lastFailureCount;
            } else if (isIntelFresh) {
                target.spyStatus = 'fresh';
                target.intel = espionageAnalysis.lastSuccess;
                knownTargets.push(target);
            } else {
                target.spyStatus = 'stale';
                unknownTargets.push(target);
            }

            if (target.spyStatus === 'failed' && !unknownTargets.includes(target)) {
                unknownTargets.push(target);
            }
        });
    });

    return {
        known: knownTargets,
        unknown: unknownTargets,
    };
}
