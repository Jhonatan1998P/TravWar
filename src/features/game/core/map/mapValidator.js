function createCountMap() {
    return Object.create(null);
}

function increment(counts, key) {
    counts[key] = (counts[key] || 0) + 1;
}

export function analyzeMapDistribution(mapData) {
    const stats = {
        totalTiles: mapData.length,
        valleys: 0,
        oasis: 0,
        villages: 0,
        valleyTypes: createCountMap(),
        oasisTypes: createCountMap(),
        quadrants: {
            nw: { oasis: 0, rareValleys: 0 },
            ne: { oasis: 0, rareValleys: 0 },
            sw: { oasis: 0, rareValleys: 0 },
            se: { oasis: 0, rareValleys: 0 },
        },
    };

    for (const tile of mapData) {
        if (tile.type === 'valley') {
            stats.valleys += 1;
            increment(stats.valleyTypes, tile.valleyType || 'unknown');

            if (tile.valleyType === '3-3-3-9' || tile.valleyType === '1-1-1-15') {
                stats.quadrants[getQuadrant(tile)].rareValleys += 1;
            }
        } else if (tile.type === 'oasis') {
            stats.oasis += 1;
            increment(stats.oasisTypes, tile.oasisType || 'unknown');
            stats.quadrants[getQuadrant(tile)].oasis += 1;
        } else if (tile.type === 'village') {
            stats.villages += 1;
        }
    }

    stats.oasisDensity = stats.totalTiles > 0 ? stats.oasis / stats.totalTiles : 0;
    return stats;
}

function getQuadrant(tile) {
    if (tile.x < 0 && tile.y < 0) return 'nw';
    if (tile.x >= 0 && tile.y < 0) return 'ne';
    if (tile.x < 0 && tile.y >= 0) return 'sw';
    return 'se';
}
