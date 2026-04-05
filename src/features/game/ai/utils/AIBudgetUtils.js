const RESOURCE_KEYS = ['wood', 'stone', 'iron', 'food'];

function toResourceValue(resource) {
    if (typeof resource === 'number') return resource;
    if (resource && typeof resource.current === 'number') return resource.current;
    return 0;
}

export function getResourceSnapshot(resources = {}) {
    return RESOURCE_KEYS.reduce((snapshot, key) => {
        snapshot[key] = toResourceValue(resources[key]);
        return snapshot;
    }, {});
}

export function getVillageBudget(village, budgetType) {
    if (village?.budget?.[budgetType]) {
        return village.budget[budgetType];
    }
    return getResourceSnapshot(village?.resources || {});
}

export function canAffordCost(cost = {}, budget = {}) {
    return Object.entries(cost).every(([resource, amount]) => amount <= (budget[resource] || 0));
}

export function getMaxAffordableCount(cost = {}, budget = {}) {
    let maxAffordable = Infinity;
    for (const [resource, amount] of Object.entries(cost)) {
        if (amount > 0) {
            maxAffordable = Math.min(maxAffordable, Math.floor((budget[resource] || 0) / amount));
        }
    }
    return maxAffordable;
}
