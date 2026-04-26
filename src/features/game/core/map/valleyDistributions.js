export const VALLEY_DISTRIBUTION = [
    { id: '4-4-4-6', category: 'balanced', weight: 30 },
    { id: '3-5-4-6', category: 'balanced', weight: 10 },
    { id: '5-3-4-6', category: 'balanced', weight: 10 },
    { id: '4-5-3-6', category: 'balanced', weight: 10 },
    { id: '3-4-5-6', category: 'balanced', weight: 10 },
    { id: '5-4-3-6', category: 'balanced', weight: 10 },
    { id: '3-4-4-7', category: 'crop-plus', weight: 7 },
    { id: '4-3-4-7', category: 'crop-plus', weight: 7 },
    { id: '4-4-3-7', category: 'crop-plus', weight: 7 },
    { id: '5-5-3-5', category: 'resource-heavy', weight: 4 },
    { id: '5-3-5-5', category: 'resource-heavy', weight: 4 },
    { id: '3-5-5-5', category: 'resource-heavy', weight: 4 },
    { id: '3-3-5-7', category: 'hybrid-crop', weight: 3 },
    { id: '3-5-3-7', category: 'hybrid-crop', weight: 3 },
    { id: '5-3-3-7', category: 'hybrid-crop', weight: 3 },
    { id: '2-4-4-8', category: 'crop-rich', weight: 2 },
    { id: '4-2-4-8', category: 'crop-rich', weight: 2 },
    { id: '4-4-2-8', category: 'crop-rich', weight: 2 },
    { id: '3-3-3-9', category: 'nine-crop', weight: 1.15 },
    { id: '1-1-1-15', category: 'fifteen-crop', weight: 0.42 },
];

export const RARE_VALLEY_RULES = {
    '3-3-3-9': { minDistance: 4, maxShare: 0.022 },
    '1-1-1-15': { minDistance: 7, maxShare: 0.009 },
};

export function getValleyDistributionForMapSize(mapSize) {
    const scale = Math.max(0.75, Math.min(1.6, mapSize / 25));

    return VALLEY_DISTRIBUTION.map(entry => {
        if (entry.category === 'nine-crop') return { ...entry, weight: entry.weight * scale };
        if (entry.category === 'fifteen-crop') return { ...entry, weight: entry.weight * scale };
        if (entry.category === 'crop-rich') return { ...entry, weight: entry.weight * (0.9 + scale * 0.15) };
        return entry;
    });
}
