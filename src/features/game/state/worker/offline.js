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

        const elapsedSeconds = (jobEndTime - currentTime) / 1000;
        if (elapsedSeconds > 0) {
            villageProcessors.forEach(processor => processor.update(jobEndTime, currentTime));
        }

        if (job.eventType === 'oasis_regen') {
            processOasisRegeneration(jobEndTime);
        } else {
            processMovements(jobEndTime);
        }

        currentTime = jobEndTime;
    }

    const remainingElapsedSeconds = (endTime - currentTime) / 1000;
    if (remainingElapsedSeconds > 0) {
        villageProcessors.forEach(processor => processor.update(endTime, currentTime));
        processOasisRegeneration(endTime);
    }
}
