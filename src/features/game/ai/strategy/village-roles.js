export const VILLAGE_ROLE = Object.freeze({
    CAPITAL: 'capital',
    HAMMER: 'hammer',
    ANVIL: 'anvil',
    SUPPORT: 'support',
});

const CROP_FIELD_WEIGHTS = { crop: 3, iron: 1.5, stone: 1.2, wood: 1 };
const CROP_FIELD_TYPES = new Set(['crop', 'grain']);

export function classifyVillageRole(village, gameState, allMyVillages = []) {
    if (!village) return VILLAGE_ROLE.SUPPORT;

    const buildings = village.buildings || [];
    const hasPalace = buildings.some(b => b.type === 'palace' && b.level >= 10);
    const hasAcademy = buildings.some(b => b.type === 'academy' && b.level >= 10);
    const hasWorkshop = buildings.some(b => b.type === 'workshop' && b.level >= 5);
    const hasGreatBarracks = buildings.some(b => b.type === 'greatBarracks' && b.level >= 1);
    const hasGreatStable = buildings.some(b => b.type === 'greatStable' && b.level >= 1);
    const wallLevel = buildings.find(b => b.type === 'cityWall')?.level || 0;
    const barracksLevel = buildings.find(b => b.type === 'barracks')?.level || 0;
    const stableLevel = buildings.find(b => b.type === 'stable')?.level || 0;

    const resourceFieldLevels = {};
    for (const building of buildings) {
        if (/^[wcif]/.test(building.id)) {
            const type = building.id[0];
            resourceFieldLevels[type] = Math.max(resourceFieldLevels[type] || 0, building.level || 0);
        }
    }

    let cropScore = 0;
    for (const [type, weight] of Object.entries(CROP_FIELD_WEIGHTS)) {
        if (CROP_FIELD_TYPES.has(type) || type === 'crop') {
            cropScore += (resourceFieldLevels[type] || 0) * weight;
        }
    }
    const totalFieldLevels = Object.values(resourceFieldLevels).reduce((s, l) => s + l, 0);
    const cropRatio = totalFieldLevels > 0 ? cropScore / totalFieldLevels : 0;

    const population = village.population?.current || 0;
    const isHighestPop = allMyVillages.length > 0
        && population >= Math.max(...allMyVillages.map(v => v.population?.current || 0));

    if (isHighestPop && hasPalace && cropRatio > 0.4) {
        return VILLAGE_ROLE.CAPITAL;
    }

    if ((barracksLevel >= 15 || hasGreatBarracks) && (stableLevel >= 12 || hasGreatStable) && wallLevel < 10) {
        return VILLAGE_ROLE.HAMMER;
    }

    if (wallLevel >= 15 && (barracksLevel >= 10 || stableLevel >= 10)) {
        return VILLAGE_ROLE.ANVIL;
    }

    return VILLAGE_ROLE.SUPPORT;
}

export function getVillageRoleLabel(role) {
    switch (role) {
        case VILLAGE_ROLE.CAPITAL: return '🏰 Capital';
        case VILLAGE_ROLE.HAMMER: return '⚔️ Hammer';
        case VILLAGE_ROLE.ANVIL: return '🛡️ Anvil';
        case VILLAGE_ROLE.SUPPORT: return '🔧 Support';
        default: return '❓ Unknown';
    }
}

export const ROLE_PHASE_MODIFIERS = Object.freeze({
    [VILLAGE_ROLE.CAPITAL]: Object.freeze({
        buildRatio: { econ: 0.80, mil: 0.20 },
        recruitmentPriority: ['defensive', 'versatile'],
        defenseReservePoints: 400,
        offenseCommitRatio: 0.20,
        allowedMilitaryConstruction: new Set(['barracks', 'academy', 'smithy', 'rallyPoint']),
        blockedMilitaryConstruction: new Set(['stable', 'workshop', 'greatBarracks', 'greatStable']),
    }),
    [VILLAGE_ROLE.HAMMER]: Object.freeze({
        buildRatio: { econ: 0.20, mil: 0.80 },
        recruitmentPriority: ['offensive', 'ram', 'catapult', 'versatile'],
        defenseReservePoints: 100,
        offenseCommitRatio: 0.90,
        allowedMilitaryConstruction: new Set(['barracks', 'stable', 'workshop', 'academy', 'smithy', 'rallyPoint', 'greatBarracks', 'greatStable']),
        blockedMilitaryConstruction: new Set(['cityWall']),
    }),
    [VILLAGE_ROLE.ANVIL]: Object.freeze({
        buildRatio: { econ: 0.40, mil: 0.60 },
        recruitmentPriority: ['defensive', 'defensiveCavalry', 'versatile'],
        defenseReservePoints: 600,
        offenseCommitRatio: 0.15,
        allowedMilitaryConstruction: new Set(['cityWall', 'barracks', 'stable', 'academy', 'smithy', 'rallyPoint']),
        blockedMilitaryConstruction: new Set([]),
    }),
    [VILLAGE_ROLE.SUPPORT]: Object.freeze({
        buildRatio: { econ: 0.55, mil: 0.45 },
        recruitmentPriority: ['offensive', 'defensive', 'versatile', 'scout'],
        defenseReservePoints: 200,
        offenseCommitRatio: 0.55,
        allowedMilitaryConstruction: new Set(['barracks', 'stable', 'workshop', 'academy', 'smithy', 'rallyPoint', 'cityWall']),
        blockedMilitaryConstruction: new Set([]),
    }),
});

export function getPhaseModifierForRole(role) {
    return ROLE_PHASE_MODIFIERS[role] || ROLE_PHASE_MODIFIERS[VILLAGE_ROLE.SUPPORT];
}

export function assignVillageRoles(villages, gameState) {
    const roles = new Map();
    for (const village of villages) {
        const role = classifyVillageRole(village, gameState, villages);
        roles.set(village.id, role);
    }
    return roles;
}

export function isMilitaryConstructionAllowedForRole(role, buildingType) {
    const modifier = getPhaseModifierForRole(role);
    if (modifier.blockedMilitaryConstruction.has(buildingType)) {
        return false;
    }
    return true;
}