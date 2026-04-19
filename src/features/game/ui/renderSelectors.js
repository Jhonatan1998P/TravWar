function getState(payload) {
    return payload?.state || null;
}

function getActiveVillage(state) {
    if (!state || !state.activeVillageId || !Array.isArray(state.villages)) {
        return null;
    }
    return state.villages.find(village => village.id === state.activeVillageId) || null;
}

function getPerspectiveOwnerId(state) {
    if (!state || !Array.isArray(state.players)) {
        return 'player';
    }

    const explicitPlayer = state.players.find(player => player.id === 'player');
    if (explicitPlayer) return explicitPlayer.id;

    const firstHuman = state.players.find(player => !String(player.id || '').startsWith('ai_'));
    return firstHuman?.id || 'player';
}

function numberFloor(value) {
    return Math.floor(Number(value) || 0);
}

function panelVisible(panelId) {
    if (typeof document === 'undefined') {
        return false;
    }

    const panel = document.getElementById(panelId);
    return Boolean(panel && panel.classList.contains('panel-visible'));
}

function resourceSignature(resources) {
    const resourceKeys = ['wood', 'stone', 'iron', 'food'];
    return resourceKeys
        .map(resourceKey => {
            const resource = resources?.[resourceKey] || {};
            return `${resourceKey}:${numberFloor(resource.current)}:${numberFloor(resource.production)}:${numberFloor(resource.capacity)}`;
        })
        .join('|');
}

function populationSignature(population) {
    return `${numberFloor(population?.current)}:${numberFloor(population?.foodConsumption)}`;
}

function sortedByIdSignature(entries = [], key = 'id', mapper = () => '') {
    return [...entries]
        .sort((left, right) => String(left?.[key] || '').localeCompare(String(right?.[key] || '')))
        .map(mapper)
        .join(';');
}

function buildingsSignature(buildings = []) {
    return sortedByIdSignature(buildings, 'id', building => `${building.id}:${building.type}:${building.level}`);
}

function constructionQueueSignature(queue = []) {
    return sortedByIdSignature(queue, 'jobId', job => `${job.jobId}:${job.buildingId}:${job.buildingType}:${job.targetLevel}:${job.endTime}`);
}

function recruitmentQueueSignature(queue = []) {
    return sortedByIdSignature(queue, 'jobId', job => {
        const remaining = Number.isFinite(Number(job.remainingCount)) ? Number(job.remainingCount) : '';
        const total = Number.isFinite(Number(job.totalCount)) ? Number(job.totalCount) : '';
        return `${job.jobId}:${job.buildingId}:${job.unitId}:${job.count}:${remaining}:${total}:${job.endTime}`;
    });
}

function researchQueueSignature(queue = []) {
    return sortedByIdSignature(queue, 'jobId', job => `${job.jobId}:${job.unitId}:${job.endTime}`);
}

function smithyQueueSignature(queue = []) {
    return sortedByIdSignature(queue, 'jobId', job => `${job.jobId}:${job.unitId}:${job.endTime}`);
}

function completedResearchSignature(completed = []) {
    return [...completed].sort((left, right) => String(left).localeCompare(String(right))).join(';');
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

export function selectVillageVisualSignature(payload) {
    const state = getState(payload);
    const activeVillage = getActiveVillage(state);
    if (!activeVillage) {
        return '';
    }

    return [
        activeVillage.id,
        activeVillage.villageType || '',
        resourceSignature(activeVillage.resources),
        populationSignature(activeVillage.population),
        buildingsSignature(activeVillage.buildings || []),
        constructionQueueSignature(activeVillage.constructionQueue || []),
    ].join(':');
}

export function selectUnreadPlayerReports(payload) {
    const state = getState(payload);
    const ownerId = getPerspectiveOwnerId(state);
    return state?.unreadCounts?.[ownerId] || 0;
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

export function selectBuildingInfoPanelSignature(payload) {
    const state = getState(payload);
    const visible = panelVisible('building-info-panel');

    if (!state) {
        return visible ? 'visible:no-state' : 'hidden:no-state';
    }

    const activeVillage = getActiveVillage(state);
    if (!activeVillage) {
        return visible ? 'visible:no-village' : `hidden:${state.activeVillageId || ''}`;
    }

    if (!visible) {
        return `hidden:${activeVillage.id}`;
    }

    return [
        'visible',
        activeVillage.id,
        resourceSignature(activeVillage.resources),
        populationSignature(activeVillage.population),
        buildingsSignature(activeVillage.buildings || []),
        constructionQueueSignature(activeVillage.constructionQueue || []),
        recruitmentQueueSignature(activeVillage.recruitmentQueue || []),
        researchQueueSignature(activeVillage.research?.queue || []),
        completedResearchSignature(activeVillage.research?.completed || []),
        smithyQueueSignature(activeVillage.smithy?.queue || []),
        objectSignature(activeVillage.smithy?.upgrades || {}),
    ].join(':');
}

export function selectTileInfoPanelSignature(payload) {
    const state = getState(payload);
    const visible = panelVisible('tile-info-panel');

    if (!state) {
        return visible ? 'visible:no-state' : 'hidden:no-state';
    }

    const activeVillage = getActiveVillage(state);
    const perspectiveOwnerId = activeVillage?.ownerId || 'player';

    if (!visible) {
        return `hidden:${perspectiveOwnerId}:${state.activeVillageId || ''}`;
    }

    const tickSignature = Number(payload?.lastTick) || 0;
    return [
        'visible',
        perspectiveOwnerId,
        state.activeVillageId || '',
        selectVillageListSignature(payload),
        (state.mapData || []).length,
        (state.movements || []).length,
        (state.reports || []).length,
        tickSignature,
    ].join(':');
}

export function selectBattleReportPanelSignature(payload) {
    const state = getState(payload);
    const visible = panelVisible('battle-report-panel');

    if (!state) {
        return visible ? 'visible:no-state' : 'hidden:no-state';
    }

    const activeVillage = getActiveVillage(state);
    const perspectiveOwnerId = activeVillage?.ownerId || 'player';

    if (!visible) {
        return `hidden:${perspectiveOwnerId}:${state.activeVillageId || ''}`;
    }

    return [
        'visible',
        perspectiveOwnerId,
        state.activeVillageId || '',
        selectReportsSignature(payload),
    ].join(':');
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
