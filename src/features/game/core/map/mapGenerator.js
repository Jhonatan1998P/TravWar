import { pickWeighted, createSeededRandom, shuffleInPlace } from './seededRandom.js';
import { getValleyDistributionForMapSize, RARE_VALLEY_RULES } from './valleyDistributions.js';
import { getOasisRulesForMapSize, OASIS_TYPE_DISTRIBUTION, WHEAT_OASIS_DISTRIBUTION } from './oasisDistributions.js';
import { analyzeMapDistribution } from './mapValidator.js';

const DEFAULT_MAP_SIZE = 25;

function normalizeMapSize(value) {
    const numeric = Math.floor(Number(value));
    if (!Number.isFinite(numeric)) return DEFAULT_MAP_SIZE;
    return Math.max(15, Math.min(50, numeric));
}

function distanceBetween(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y);
}

function isFarEnoughFromRareValleys(tile, rareValleys, valleyType) {
    const rule = RARE_VALLEY_RULES[valleyType];
    if (!rule) return true;

    return rareValleys.every(rareTile => distanceBetween(tile, rareTile) >= rule.minDistance);
}

function countRareValley(mapData, valleyType) {
    return mapData.reduce((count, tile) => count + (tile.valleyType === valleyType ? 1 : 0), 0);
}

function pickValleyType({ mapData, tile, random, mapSize, rareValleys }) {
    const totalTiles = (mapSize * 2 + 1) ** 2;
    const distribution = getValleyDistributionForMapSize(mapSize);
    const fallbackDistribution = distribution.filter(entry => !RARE_VALLEY_RULES[entry.id]);

    for (let attempt = 0; attempt < 8; attempt += 1) {
        const selected = pickWeighted(distribution, random);
        if (!selected) return '4-4-4-6';

        const rule = RARE_VALLEY_RULES[selected.id];
        if (!rule) return selected.id;

        const currentShare = countRareValley(mapData, selected.id) / totalTiles;
        if (currentShare < rule.maxShare && isFarEnoughFromRareValleys(tile, rareValleys, selected.id)) {
            rareValleys.push({ ...tile, valleyType: selected.id });
            return selected.id;
        }
    }

    return pickWeighted(fallbackDistribution, random)?.id || '4-4-4-6';
}

function buildTileIndex(mapData) {
    const index = new Map();
    mapData.forEach((tile, tileIndex) => index.set(`${tile.x}|${tile.y}`, tileIndex));
    return index;
}

function canPlaceOasis(tile, mapData, tileIndexByCoords, minDistance) {
    for (let y = tile.y - minDistance; y <= tile.y + minDistance; y += 1) {
        for (let x = tile.x - minDistance; x <= tile.x + minDistance; x += 1) {
            if (x === tile.x && y === tile.y) continue;
            const neighborIndex = tileIndexByCoords.get(`${x}|${y}`);
            if (neighborIndex === undefined) continue;
            if (mapData[neighborIndex].type === 'oasis') return false;
        }
    }

    return true;
}

function placeSpecialCropOasis(mapData, random, mapSize, tileIndexByCoords) {
    const rules = getOasisRulesForMapSize(mapSize);
    const specialValleys = mapData.filter(tile => tile.type === 'valley' && (tile.valleyType === '1-1-1-15' || tile.valleyType === '3-3-3-9'));

    for (const valley of specialValleys) {
        const candidates = [];
        for (let dy = -rules.specialCropOasisRadius; dy <= rules.specialCropOasisRadius; dy += 1) {
            for (let dx = -rules.specialCropOasisRadius; dx <= rules.specialCropOasisRadius; dx += 1) {
                if (dx === 0 && dy === 0) continue;
                const candidate = { x: valley.x + dx, y: valley.y + dy };
                if (candidate.x < -mapSize || candidate.x > mapSize || candidate.y < -mapSize || candidate.y > mapSize) continue;
                candidates.push(candidate);
            }
        }

        shuffleInPlace(candidates, random);
        let placed = 0;

        for (const candidate of candidates) {
            if (placed >= rules.maxSpecialCropOasis) break;
            const candidateIndex = tileIndexByCoords.get(`${candidate.x}|${candidate.y}`);
            if (candidateIndex === undefined) continue;

            const tile = mapData[candidateIndex];
            if (tile.type !== 'valley') continue;
            if (!canPlaceOasis(tile, mapData, tileIndexByCoords, rules.minDistance)) continue;

            const oasisType = pickWeighted(WHEAT_OASIS_DISTRIBUTION, random)?.id || 'wheat_25';
            mapData[candidateIndex] = { x: tile.x, y: tile.y, type: 'oasis', oasisType };
            placed += 1;
        }
    }
}

function placeAmbientOasis(mapData, random, mapSize, tileIndexByCoords) {
    const rules = getOasisRulesForMapSize(mapSize);
    const candidates = shuffleInPlace([...mapData.keys()], random);
    const targetOasisCount = Math.floor(mapData.length * rules.density);
    let currentOasisCount = mapData.reduce((sum, tile) => sum + (tile.type === 'oasis' ? 1 : 0), 0);

    for (const index of candidates) {
        if (currentOasisCount >= targetOasisCount) break;

        const tile = mapData[index];
        if (tile.type !== 'valley') continue;
        if (tile.valleyType === '1-1-1-15' || tile.valleyType === '3-3-3-9') continue;
        if (!canPlaceOasis(tile, mapData, tileIndexByCoords, rules.minDistance)) continue;

        const oasisType = pickWeighted(OASIS_TYPE_DISTRIBUTION, random)?.id || 'wheat_25';
        mapData[index] = { x: tile.x, y: tile.y, type: 'oasis', oasisType };
        currentOasisCount += 1;
    }
}

export function generateMapData({ seed, mapSize = DEFAULT_MAP_SIZE } = {}) {
    const normalizedMapSize = normalizeMapSize(mapSize);
    const random = createSeededRandom(`${seed || 'default-world'}:${normalizedMapSize}`);
    const mapData = [];
    const rareValleys = [];

    for (let y = -normalizedMapSize; y <= normalizedMapSize; y += 1) {
        for (let x = -normalizedMapSize; x <= normalizedMapSize; x += 1) {
            const tile = { x, y };
            const valleyType = pickValleyType({ mapData, tile, random, mapSize: normalizedMapSize, rareValleys });
            mapData.push({ x, y, type: 'valley', valleyType });
        }
    }

    const tileIndexByCoords = buildTileIndex(mapData);
    placeSpecialCropOasis(mapData, random, normalizedMapSize, tileIndexByCoords);
    placeAmbientOasis(mapData, random, normalizedMapSize, tileIndexByCoords);

    return {
        mapData,
        random,
        mapSize: normalizedMapSize,
        mapStats: analyzeMapDistribution(mapData),
    };
}

export { DEFAULT_MAP_SIZE, normalizeMapSize };
