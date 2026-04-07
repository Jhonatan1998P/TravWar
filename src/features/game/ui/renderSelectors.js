function getState(payload) {
    return payload?.state || null;
}

function getActiveVillage(state) {
    if (!state || !state.activeVillageId || !Array.isArray(state.villages)) {
        return null;
    }
    return state.villages.find(village => village.id === state.activeVillageId) || null;
}

function objectSignature(value) {
    if (!value || typeof value !== 'object') {
        return '';
    }

    const keys = Object.keys(value).sort();
    const pairs = [];
    for (const key of keys) {
        const currentValue = value[key];
        if (typeof currentValue === 'object' && currentValue !== null) {
            pairs.push(`${key}:{${objectSignature(currentValue)}}`);
        } else {
            pairs.push(`${key}:${String(currentValue)}`);
        }
    }
    return pairs.join('|');
}

function coordsSignature(coords) {
    if (!coords) {
        return '0|0';
    }
    return `${coords.x ?? 0}|${coords.y ?? 0}`;
}

export function selectActiveVillageId(payload) {
    const state = getState(payload);
    return state?.activeVillageId || '';
}

export function selectVillageListSignature(payload) {
    const state = getState(payload);
    if (!state || !Array.isArray(state.villages)) {
        return '';
    }

    return state.villages
        .map(village => `${village.id}:${village.ownerId}:${village.name}:${coordsSignature(village.coords)}`)
        .join(';');
}

export function selectUnreadPlayerReports(payload) {
    const state = getState(payload);
    return state?.unreadCounts?.player || 0;
}

export function selectReportsSignature(payload) {
    const state = getState(payload);
    if (!state || !Array.isArray(state.reports)) {
        return '';
    }

    return state.reports
        .map(report => `${report.id}:${report.type}:${report.ownerId}:${report.time}`)
        .join(';');
}

export function selectConstructionQueueSignature(payload) {
    const state = getState(payload);
    const activeVillage = getActiveVillage(state);
    if (!activeVillage) {
        return '';
    }

    const queue = activeVillage.constructionQueue || [];
    const queueSignature = queue
        .map(job => `${job.jobId}:${job.buildingId}:${job.buildingType}:${job.targetLevel}:${job.endTime}`)
        .join(';');

    return `${activeVillage.id}:${activeVillage.maxConstructionSlots || 0}:${queueSignature}`;
}

export function selectRecruitmentQueueSignature(payload) {
    const state = getState(payload);
    const activeVillage = getActiveVillage(state);
    if (!activeVillage) {
        return '';
    }

    const queue = activeVillage.recruitmentQueue || [];
    const queueSignature = queue
        .map(job => `${job.jobId}:${job.buildingId}:${job.unitId}:${job.count}:${job.remainingCount ?? ''}:${job.totalCount ?? ''}:${job.endTime}`)
        .join(';');

    const buildingsSignature = (activeVillage.buildings || [])
        .map(building => `${building.id}:${building.type}`)
        .join(';');

    return `${activeVillage.id}:${activeVillage.race}:${buildingsSignature}:${queueSignature}`;
}

export function selectResearchQueueSignature(payload) {
    const state = getState(payload);
    const activeVillage = getActiveVillage(state);
    if (!activeVillage) {
        return '';
    }

    const queue = activeVillage.research?.queue || [];
    const queueSignature = queue
        .map(job => `${job.jobId}:${job.unitId}:${job.endTime}`)
        .join(';');

    return `${activeVillage.id}:${activeVillage.race}:${queueSignature}`;
}

export function selectSmithyQueueSignature(payload) {
    const state = getState(payload);
    const activeVillage = getActiveVillage(state);
    if (!activeVillage) {
        return '';
    }

    const queue = activeVillage.smithy?.queue || [];
    const queueSignature = queue
        .map(job => `${job.jobId}:${job.unitId}:${job.endTime}`)
        .join(';');

    const upgradesSignature = objectSignature(activeVillage.smithy?.upgrades || {});

    return `${activeVillage.id}:${activeVillage.race}:${upgradesSignature}:${queueSignature}`;
}

export function selectMovementsSignature(payload) {
    const state = getState(payload);
    if (!state) {
        return '';
    }

    const villagesSignature = selectVillageListSignature(payload);
    const movementsSignature = (state.movements || [])
        .map(movement => {
            const payloadSignature = objectSignature(movement.payload || {});
            return `${movement.id}:${movement.type}:${movement.ownerId}:${movement.originVillageId}:${coordsSignature(movement.targetCoords)}:${movement.arrivalTime}:${payloadSignature}`;
        })
        .join(';');

    return `${state.activeVillageId || ''}:${villagesSignature}:${movementsSignature}`;
}

export function selectMapViewSignature(payload) {
    const state = getState(payload);
    if (!state) {
        return '';
    }

    const villagesSignature = (state.villages || [])
        .map(village => `${village.id}:${village.ownerId}:${coordsSignature(village.coords)}`)
        .join(';');

    return `${state.activeVillageId || ''}:${villagesSignature}:${(state.mapData || []).length}`;
}

export function selectTroopsSignature(payload) {
    const state = getState(payload);
    const activeVillage = getActiveVillage(state);
    if (!activeVillage) {
        return '';
    }

    const ownTroopsSignature = objectSignature(activeVillage.unitsInVillage || {});
    const reinforcementsSignature = (activeVillage.reinforcements || [])
        .map(contingent => `${contingent.ownerId || ''}:${contingent.race || ''}:${objectSignature(contingent.troops || {})}`)
        .join(';');

    return `${activeVillage.id}:${activeVillage.race}:${ownTroopsSignature}:${reinforcementsSignature}`;
}
