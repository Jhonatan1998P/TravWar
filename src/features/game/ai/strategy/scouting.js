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
    let previousSuccess = null;
    let lastFailure = null;
    let lastFailureCount = 0;

    mySpyReports.sort((a, b) => b.time - a.time);

    for (const report of mySpyReports) {
        if (report.payload) {
            if (!lastSuccess) lastSuccess = report;
            else if (!previousSuccess) previousSuccess = report;
        } else if (!lastFailure) {
            lastFailure = report;
            const scoutId = Object.keys(report.attacker.troops).find(() => true);
            if (scoutId) {
                lastFailureCount = report.attacker.troops[scoutId];
            }
        }

        if (lastSuccess && previousSuccess && lastFailure) break;
    }

    return {
        lastSuccess,
        previousSuccess,
        lastFailure,
        lastFailureCount,
    };
}

function toScaledMs(minutes, gameSpeed = 1, floorMs = 90_000) {
    const speed = Math.max(1, Number(gameSpeed) || 1);
    return Math.max(floorMs, Math.floor((minutes * 60 * 1000) / speed));
}

function getVillagePopulation(target) {
    return Number(target?.data?.population?.current || target?.population?.current || 0);
}

function getWallLevel(target) {
    return Number(
        target?.data?.buildings?.find(building => building.type === 'cityWall')?.level
        || 0,
    );
}

function getVillageMilitarySignal(target) {
    const buildings = target?.data?.buildings || [];
    const wallLevel = getWallLevel(target);
    const hasMilitaryBuildings = buildings.some(building =>
        (building.type === 'workshop' && building.level >= 5)
        || (building.type === 'academy' && building.level >= 10)
        || (building.type === 'stable' && building.level >= 10)
        || (building.type === 'barracks' && building.level >= 15)
        || (building.type === 'palace' && building.level >= 10)
    );

    return hasMilitaryBuildings
        || wallLevel >= 10
        || getVillagePopulation(target) >= 550;
}

function resolveIntelContext({ target, nemesisId, priorityIntelTargetIds }) {
    const isNemesis = target.ownerId === nemesisId;
    const isPriorityRescout = priorityIntelTargetIds.has(target.id);
    const isDangerousNeighbor = target.dist <= 20;
    const isMilitaryVillage = getVillageMilitarySignal(target);

    if (isPriorityRescout) {
        return {
            intelContext: 'recent_attacker',
            isNemesis,
            isPriorityRescout,
            isDangerousNeighbor,
            isMilitaryVillage,
        };
    }
    if (isNemesis) {
        return {
            intelContext: 'nemesis',
            isNemesis,
            isPriorityRescout,
            isDangerousNeighbor,
            isMilitaryVillage,
        };
    }
    if (isDangerousNeighbor) {
        return {
            intelContext: 'dangerous_neighbor',
            isNemesis,
            isPriorityRescout,
            isDangerousNeighbor,
            isMilitaryVillage,
        };
    }
    if (isMilitaryVillage) {
        return {
            intelContext: 'military_village',
            isNemesis,
            isPriorityRescout,
            isDangerousNeighbor,
            isMilitaryVillage,
        };
    }

    return {
        intelContext: 'default_pvp',
        isNemesis,
        isPriorityRescout,
        isDangerousNeighbor,
        isMilitaryVillage,
    };
}

function getIntelTtlMsByContext({ race, intelContext, gameSpeed = 1, fallbackNemesisTtlMs, fallbackGeneralTtlMs }) {
    const raceKey = race || 'romans';

    if (raceKey === 'germans' || raceKey === 'huns') {
        if (intelContext === 'nemesis') return toScaledMs(20, gameSpeed);
        if (intelContext === 'recent_attacker') return toScaledMs(22, gameSpeed);
        if (intelContext === 'military_village') return toScaledMs(28, gameSpeed);
        if (intelContext === 'dangerous_neighbor') return toScaledMs(34, gameSpeed);
        return toScaledMs(45, gameSpeed);
    }

    if (raceKey === 'egyptians' || raceKey === 'gauls') {
        if (intelContext === 'recent_attacker') return toScaledMs(18, gameSpeed);
        if (intelContext === 'dangerous_neighbor') return toScaledMs(24, gameSpeed);
        if (intelContext === 'nemesis') return toScaledMs(28, gameSpeed);
        if (intelContext === 'military_village') return toScaledMs(32, gameSpeed);
        return toScaledMs(40, gameSpeed);
    }

    if (intelContext === 'nemesis') return fallbackNemesisTtlMs;
    return fallbackGeneralTtlMs;
}

function didTargetLaunchRecentAttacks({ gameState, target, now, lookbackMs }) {
    const lookbackSince = now - lookbackMs;
    const ownerId = target.ownerId;
    const villageId = target.id;

    const hasActiveOutgoing = gameState.movements.some(movement => {
        if (!movement || (movement.type !== 'attack' && movement.type !== 'raid')) return false;
        if (movement.ownerId !== ownerId) return false;
        if (movement.originVillageId && movement.originVillageId !== villageId) return false;

        const startedAt = Number(movement.startTime || movement.arrivalTime || 0);
        return startedAt >= lookbackSince;
    });

    if (hasActiveOutgoing) return true;

    return gameState.reports.some(report => {
        if (!report || (report.type !== 'attack' && report.type !== 'raid')) return false;
        if (Number(report.time || 0) < lookbackSince) return false;
        if (report.attacker?.ownerId !== ownerId) return false;
        if (report.attacker?.villageId && report.attacker.villageId !== villageId) return false;
        return true;
    });
}

function hasRecentCombatOnVillage({ gameState, targetVillageId, now, lookbackMs }) {
    const lookbackSince = now - lookbackMs;
    return gameState.reports.some(report => {
        if (!report || (report.type !== 'attack' && report.type !== 'raid')) return false;
        if (Number(report.time || 0) < lookbackSince) return false;
        return report.defender?.villageId === targetVillageId || report.attacker?.villageId === targetVillageId;
    });
}

function hadRecentFailedIncursion({ gameState, targetVillageId, myOwnerId, now, lookbackMs }) {
    const lookbackSince = now - lookbackMs;
    return gameState.reports.some(report => {
        if (!report || (report.type !== 'attack' && report.type !== 'raid')) return false;
        if (Number(report.time || 0) < lookbackSince) return false;
        if (report.attacker?.ownerId !== myOwnerId) return false;
        if (report.defender?.villageId !== targetVillageId) return false;
        const myPlayerName = report.attacker?.playerName;
        return report.winner !== myPlayerName;
    });
}

function hasReinforcementSuspicion({ gameState, target, intelReportedAt, lastSuccessReport }) {
    const hasVisibleReinforcements = (lastSuccessReport?.payload?.refuerzos_vistos || []).length > 0;
    if (hasVisibleReinforcements) return true;

    return gameState.movements.some(movement => {
        if (!movement || movement.type !== 'reinforcement') return false;
        if (!movement.targetCoords) return false;
        if (movement.targetCoords.x !== target.coords.x || movement.targetCoords.y !== target.coords.y) return false;
        const movementStartedAt = Number(movement.startTime || movement.arrivalTime || 0);
        return movementStartedAt >= intelReportedAt;
    });
}

function hasStrategicValueShift(lastSuccessReport, previousSuccessReport) {
    if (!lastSuccessReport || !previousSuccessReport) return false;

    const currentIntel = lastSuccessReport.payload || {};
    const previousIntel = previousSuccessReport.payload || {};

    const currentResources = currentIntel.resources || {};
    const previousResources = previousIntel.resources || {};
    const currentResourcesTotal = (currentResources.wood || 0) + (currentResources.stone || 0) + (currentResources.iron || 0) + (currentResources.food || 0);
    const previousResourcesTotal = (previousResources.wood || 0) + (previousResources.stone || 0) + (previousResources.iron || 0) + (previousResources.food || 0);
    const resourceDelta = Math.abs(currentResourcesTotal - previousResourcesTotal);

    const currentDefense = Number(currentIntel.poder_defensivo_calculado || 0);
    const previousDefense = Number(previousIntel.poder_defensivo_calculado || 0);
    const defenseDeltaRatio = previousDefense > 0
        ? Math.abs(currentDefense - previousDefense) / previousDefense
        : (currentDefense > 0 ? 1 : 0);

    return defenseDeltaRatio >= 0.35 || resourceDelta >= 2000;
}

function formatIntelTime(timestampMs) {
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) return 'n/a';
    return new Date(timestampMs).toISOString();
}

export function dispatchSpies(forces, target, baseCount, log, reason, isRetry = false, lastCount = 0, options = {}) {
    let countNeeded = baseCount;
    let mode = 'Base';
    const retryMultiplier = Math.max(1.5, Number(options.retryMultiplier) || 2);

    if (isRetry) {
        mode = 'Reintento';
        countNeeded = Math.max(baseCount, Math.ceil(lastCount * retryMultiplier));
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
        log.push(`[INTEL] ${reason}: espias insuficientes para ${target.data.name}. Necesario=${countNeeded}, disponibles=${bestForce.scoutCount}.`);
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

export function performGeneralIntelligence(forces, unknownTargets, nemesisId, scoutsPerMission, options = {}) {
    const commands = [];
    const logs = [];
    const race = options.race || 'romans';
    const priorityIntelTargetIds = new Set(options.priorityIntelTargetIds || []);
    const germanRetry = race === 'germans' || race === 'huns';
    const retryMultiplier = germanRetry ? 3 : 2;

    const targets = unknownTargets.filter(target => target.ownerId !== nemesisId);
    targets.sort((a, b) => {
        const aPriority = priorityIntelTargetIds.has(a.id) ? 1 : 0;
        const bPriority = priorityIntelTargetIds.has(b.id) ? 1 : 0;
        if (aPriority !== bPriority) return bPriority - aPriority;

        const aFailed = a.spyStatus === 'failed' ? 1 : 0;
        const bFailed = b.spyStatus === 'failed' ? 1 : 0;
        if (aFailed !== bFailed) return bFailed - aFailed;

        const aDangerous = a.intelGate?.context === 'dangerous_neighbor' ? 1 : 0;
        const bDangerous = b.intelGate?.context === 'dangerous_neighbor' ? 1 : 0;
        if (race === 'egyptians' && aDangerous !== bDangerous) {
            return bDangerous - aDangerous;
        }

        return a.dist - b.dist;
    });

    targets.forEach(target => {
        const isPriority = priorityIntelTargetIds.has(target.id);
        const maxScoutDistance = isPriority ? 70 : 30;
        if (target.dist > maxScoutDistance) return;

        const isRetry = target.spyStatus === 'failed';
        const command = dispatchSpies(
            forces,
            target,
            scoutsPerMission,
            logs,
            'Exploración Rutinaria',
            isRetry,
            target.lastSpyCount,
            {
                retryMultiplier,
            },
        );

        if (command) {
            commands.push(command);
        } else if (isPriority) {
            logs.push(`[INTEL] Prioridad reactiva sin despacho: ${target.data.name} (${target.id}).`);
        }
    });

    return { commands, logs };
}

export function scanAndClassifyTargets({
    gameState,
    forces,
    myOwnerId,
    race,
    gameSpeed,
    nemesisId,
    log,
    priorityIntelTargetIds = [],
    nemesisInterval,
    generalInterval,
    searchRadius,
}) {
    const knownTargets = [];
    const unknownTargets = [];
    const scannedIds = new Set();
    const now = Date.now();
    const prioritySet = new Set(priorityIntelTargetIds || []);

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
            const intelContextInfo = resolveIntelContext({
                target,
                nemesisId,
                priorityIntelTargetIds: prioritySet,
            });
            const intelTtlMs = getIntelTtlMsByContext({
                race,
                intelContext: intelContextInfo.intelContext,
                gameSpeed,
                fallbackNemesisTtlMs: nemesisInterval,
                fallbackGeneralTtlMs: generalInterval,
            });

            const lastIntelAt = espionageAnalysis.lastSuccess?.time || null;
            const reasons = [];

            if (!lastIntelAt) {
                reasons.push('intel_missing');
            } else {
                if ((now - lastIntelAt) > intelTtlMs) {
                    reasons.push('ttl_expired');
                }

                const eventWindowMs = Math.min(toScaledMs(30, gameSpeed), intelTtlMs);
                if (didTargetLaunchRecentAttacks({ gameState, target, now, lookbackMs: eventWindowMs })) {
                    reasons.push('target_recent_attacks');
                }
                if (hasRecentCombatOnVillage({ gameState, targetVillageId: target.id, now, lookbackMs: eventWindowMs })) {
                    reasons.push('recent_combat_report');
                }
                if (hadRecentFailedIncursion({ gameState, targetVillageId: target.id, myOwnerId, now, lookbackMs: toScaledMs(80, gameSpeed) })) {
                    reasons.push('failed_incursion_recently');
                }
                if (hasStrategicValueShift(espionageAnalysis.lastSuccess, espionageAnalysis.previousSuccess)) {
                    reasons.push('strategic_value_shifted');
                }
                if (hasReinforcementSuspicion({
                    gameState,
                    target,
                    intelReportedAt: lastIntelAt,
                    lastSuccessReport: espionageAnalysis.lastSuccess,
                })) {
                    reasons.push('reinforcement_suspected');
                }
            }

            const intelFresh = reasons.length === 0;

            target.spyStatus = 'unknown';
            target.lastSpyCount = 0;
            target.intel = espionageAnalysis.lastSuccess || null;
            target.intelGate = {
                intelFresh,
                lastIntelAt,
                ttlMs: intelTtlMs,
                context: intelContextInfo.intelContext,
                reasons,
            };

            if (espionageAnalysis.lastFailure && (!espionageAnalysis.lastSuccess || espionageAnalysis.lastFailure.time > espionageAnalysis.lastSuccess.time)) {
                target.spyStatus = 'failed';
                target.lastSpyCount = espionageAnalysis.lastFailureCount;
            } else if (intelFresh) {
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

            const reasonText = intelFresh ? 'valid' : reasons.join(',');
            const ttlMinutes = (intelTtlMs / 60000).toFixed(1);
            if (Array.isArray(log)) {
                log.push(
                    `[INTEL-GATE] ${target.data.name} (${target.id}) ctx=${intelContextInfo.intelContext} ` +
                    `lastIntelAt=${formatIntelTime(lastIntelAt)} ttl=${ttlMinutes}m status=${target.spyStatus} motivo=${reasonText}`,
                );
            }
        });
    });

    return {
        known: knownTargets,
        unknown: unknownTargets,
    };
}
