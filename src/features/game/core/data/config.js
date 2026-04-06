// Extraido de GameData.js

export const config = {
        initialResources: {
            wood: 800,
            stone: 800,
            iron: 800,
            food: 800
        },
        initialStorage: {
            warehouse: 1000,
            granary: 1000
        },
        initialPopulation: {
            current: 2,
            max: 1200
        },
        oasis: {
            baseResourceProduction: 40,
            storageCapacity: 1000,
            beastBountyMultiplier: 240,
            beastDifficultyFactors: {
                rat: 1.0,
                spider: 1.0,
                snake: 1.0,
                bat: 1.0,
                wild_boar: 1.1,
                wolf: 1.1,
                bear: 1.25,
                tiger: 1.25,
                crocodile: 1.25,
                elephant: 1.5,
            },
            raidTravelCostPerDistance: 8,
            raidTravelCostPerMinute: 15,
            oasisPressureWindowMinutes: 60,
            oasisPressureAttackRef: 12,
            oasisPressureAlpha: 0.6,
            beastRegenCycleMinutes: 2.5,
            beastRegenAmount: 1
        },
        settlement: {
            settlersRequired: 3,
            cost: {
                wood: 750,
                stone: 750,
                iron: 750,
                food: 750
            }
        },
    }
