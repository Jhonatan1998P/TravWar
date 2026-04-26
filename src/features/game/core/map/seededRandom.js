export function hashSeed(seed) {
    const normalizedSeed = String(seed || 'default-world');
    let hash = 0;

    for (let index = 0; index < normalizedSeed.length; index += 1) {
        hash = (hash << 5) - hash + normalizedSeed.charCodeAt(index);
        hash |= 0;
    }

    return hash;
}

export function createSeededRandom(seed) {
    let state = hashSeed(seed);

    return function random() {
        let value = state += 0x6D2B79F5;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
}

export function randomInt(random, maxExclusive) {
    return Math.floor(random() * maxExclusive);
}

export function pickWeighted(entries, random) {
    const totalWeight = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.weight) || 0), 0);
    if (totalWeight <= 0) return entries[0] || null;

    let cursor = random() * totalWeight;
    for (const entry of entries) {
        cursor -= Math.max(0, Number(entry.weight) || 0);
        if (cursor <= 0) return entry;
    }

    return entries[entries.length - 1] || null;
}

export function shuffleInPlace(items, random) {
    for (let index = items.length - 1; index > 0; index -= 1) {
        const swapIndex = randomInt(random, index + 1);
        [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
}
