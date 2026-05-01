export function simulateOfflineProgress({
    gameState,
    gameData,
    villageProcessors,
    processMovements,
    processOasisRegeneration,
    startTime,
    endTime,
}) {
    let currentTime = startTime;
    const MAX_PRODUCTION_MS = 2 * 60 * 60 * 1000;
    let accumulatedProductionMs = 0;

    const allVillageJobs = gameState.villages.flatMap(village => [
        ...village.constructionQueue.map(job => ({ ...job, eventType: 'construction' })),
        ...village.recruitmentQueue.map(job => ({ ...job, eventType: 'recruitment' })),
        ...village.research.queue.map(job => ({ ...job, eventType: 'research' })),
        ...village.smithy.queue.map(job => ({ ...job, eventType: 'smithy' })),
    ]);

    const allMovementsAsJobs = gameState.movements.map(movement => ({
        ...movement,
        endTime: movement.arrivalTime,
        eventType: 'movement',
    }));

    const oasisRegenJobs = [];
    const regenCycleMs = gameData.config.oasis.beastRegenCycleMinutes * 60 * 1000;
    let nextRegenTime = gameState.lastOasisRegenTime + regenCycleMs;
    while (nextRegenTime < endTime) {
        if (nextRegenTime > startTime) {
            oasisRegenJobs.push({ endTime: nextRegenTime, eventType: 'oasis_regen' });
        }
        nextRegenTime += regenCycleMs;
    }

    const allJobs = [...allVillageJobs, ...allMovementsAsJobs, ...oasisRegenJobs]
        .sort((a, b) => (a.endTime || a.arrivalTime) - (b.endTime || b.arrivalTime));

    for (const job of allJobs) {
        const jobEndTime = job.endTime || job.arrivalTime;
        if (jobEndTime > endTime) break;

        const elapsedMs = jobEndTime - currentTime;
        if (elapsedMs > 0) {
            const remaining = Math.max(0, MAX_PRODUCTION_MS - accumulatedProductionMs);
            const productionCapMs = Math.min(elapsedMs, remaining);
            accumulatedProductionMs += productionCapMs;
            const productionCapSeconds = productionCapMs / 1000;
            villageProcessors.forEach(processor => processor.update(jobEndTime, currentTime, productionCapSeconds));
        }

        if (job.eventType === 'oasis_regen') {
            processOasisRegeneration(jobEndTime);
        } else {
            processMovements(jobEndTime);
        }

        currentTime = jobEndTime;
    }

    const remainingMs = endTime - currentTime;
    if (remainingMs > 0) {
        const remaining = Math.max(0, MAX_PRODUCTION_MS - accumulatedProductionMs);
        const productionCapMs = Math.min(remainingMs, remaining);
        accumulatedProductionMs += productionCapMs;
        const productionCapSeconds = productionCapMs / 1000;
        villageProcessors.forEach(processor => processor.update(endTime, currentTime, productionCapSeconds));
        processOasisRegeneration(endTime);
    }
}
