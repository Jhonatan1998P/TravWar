// Extraido de GameData.js

export const oasisTypes = {
        wood_25: {
            id: 'wood_25',
            name: 'Oasis de Madera',
            bonus: { resource: 'wood', percentage: 25 },
            beastSpawnTable: [
                { unitId: 'wild_boar', min: 5, max: 40 },
                { unitId: 'wolf', min: 10, max: 30 },
                { unitId: 'bear', min: 8, max: 20 }
            ]
        },
        wood_50: {
            id: 'wood_50',
            name: 'Oasis de Madera (50%)',
            bonus: { resource: 'wood', percentage: 50 },
            beastSpawnTable: [
                { unitId: 'wild_boar', min: 10, max: 40 },
                { unitId: 'wolf', min: 12, max: 45 },
                { unitId: 'bear', min: 5, max: 25 },
                { unitId: 'tiger', min: 5, max: 20 }
            ]
        },
        clay_25: {
            id: 'clay_25',
            name: 'Oasis de Barro',
            bonus: { resource: 'stone', percentage: 25 },
            beastSpawnTable: [
                { unitId: 'rat', min: 10, max: 40 },
                { unitId: 'spider', min: 8, max: 30 },
                { unitId: 'wild_boar', min: 5, max: 25 }
            ]
        },
        clay_50: {
            id: 'clay_50',
            name: 'Oasis de Barro (50%)',
            bonus: { resource: 'stone', percentage: 50 },
            beastSpawnTable: [
                { unitId: 'rat', min: 10, max: 40 },
                { unitId: 'spider', min: 12, max: 45 },
                { unitId: 'wild_boar', min: 5, max: 25 },
                { unitId: 'crocodile', min: 5, max: 20 }
            ]
        },
        iron_25: {
            id: 'iron_25',
            name: 'Oasis de Hierro',
            bonus: { resource: 'iron', percentage: 25 },
            beastSpawnTable: [
                { unitId: 'rat', min: 10, max: 40 },
                { unitId: 'spider', min: 8, max: 30 },
                { unitId: 'bat', min: 5, max: 25 }
            ]
        },
        iron_50: {
            id: 'iron_50',
            name: 'Oasis de Hierro (50%)',
            bonus: { resource: 'iron', percentage: 50 },
            beastSpawnTable: [
                { unitId: 'rat', min: 10, max: 40 },
                { unitId: 'spider', min: 12, max: 50 },
                { unitId: 'bat', min: 5, max: 20 },
                { unitId: 'bear', min: 5, max: 20 }
            ]
        },
        wheat_25: {
            id: 'wheat_25',
            name: 'Oasis de Cereal',
            bonus: { resource: 'food', percentage: 25 },
            beastSpawnTable: [
                { unitId: 'rat', min: 10, max: 40 },
                { unitId: 'snake', min: 8, max: 30 },
                { unitId: 'bear', min: 5, max: 25 },
                { unitId: 'tiger', min: 3, max: 15 }
            ]
        },
        wheat_50: {
            id: 'wheat_50',
            name: 'Oasis de Cereal (50%)',
            bonus: { resource: 'food', percentage: 50 },
            beastSpawnTable: [
                { unitId: 'rat', min: 10, max: 40 },
                { unitId: 'snake', min: 12, max: 45 },
                { unitId: 'crocodile', min: 5, max: 20 },
                { unitId: 'tiger', min: 5, max: 20 }
            ]
        }
    }
