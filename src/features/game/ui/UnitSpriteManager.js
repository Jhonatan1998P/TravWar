import { gameData } from '../core/GameData.js';

const SPRITE_CONFIG = {
    path: '/troops/',
    width: 16,
    height: 16
};

const RACE_SPRITE_MAPPING = {
    romans: 'v1_romans2.gif',
    germans: 'v2_teutons2.gif',
    gauls: 'v3_gauls2.gif',
    nature: 'v4_nature2.gif',
    natars: 'v5_natars2.gif',
    egyptians: 'v6_egypts2.gif',
    huns: 'v7_huns2.gif'
};

const UNIT_ORDER_CACHE = new Map();

function buildUnitOrderCache() {
    if (UNIT_ORDER_CACHE.size > 0) return;
    for (const raceId in gameData.units) {
        const troopIds = gameData.units[raceId].troops
            .filter(t => t.type !== 'merchant')
            .map(t => t.id);
        UNIT_ORDER_CACHE.set(raceId, troopIds);
    }
}

function getUnitSprite(unitId, raceId) {
    if (UNIT_ORDER_CACHE.size === 0) {
        buildUnitOrderCache();
    }

    const spriteFile = RACE_SPRITE_MAPPING[raceId];
    const unitOrder = UNIT_ORDER_CACHE.get(raceId);

    if (!spriteFile || !unitOrder) {
        return `<div class="w-4 h-4 bg-gray-600 inline-block align-middle" title="${unitId}"></div>`;
    }

    const unitIndex = unitOrder.indexOf(unitId);
    if (unitIndex === -1) {
        return `<div class="w-4 h-4 bg-gray-600 inline-block align-middle" title="${unitId}"></div>`;
    }

    const totalSpriteSheetWidth = 200;
    const actualSpriteWidth = totalSpriteSheetWidth / unitOrder.length;
    
    const displayWidth = 20;
    const displayHeight = 16;
    
    const xOffset = -(unitIndex * actualSpriteWidth);
    
    const backgroundWidth = displayWidth * unitOrder.length;
    const backgroundHeight = displayHeight;

    const styles = [
        `background-image: url('${SPRITE_CONFIG.path}${spriteFile}')`,
        `background-position: ${xOffset}px 0px`,
        `width: ${displayWidth}px`,
        `height: ${displayHeight}px`,
        `background-size: ${backgroundWidth}px ${backgroundHeight}px`,
        'image-rendering: pixelated',
        'image-rendering: -moz-crisp-edges',
        'image-rendering: crisp-edges',
        'display: inline-block',
        'vertical-align: middle',
        'flex-shrink: 0'
    ];

    const unitName = gameData.units[raceId]?.troops.find(t => t.id === unitId)?.name || unitId;

    return `<div style="${styles.join(';')}" title="${unitName}"></div>`;
}

export const unitSpriteManager = {
    getUnitSprite
};
