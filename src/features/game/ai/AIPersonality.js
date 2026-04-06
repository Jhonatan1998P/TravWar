export const AIPersonality = {
    Pesadilla: {
        decisionInterval: 5000,
        baseMilitaryInterval: 3600000,
        storageBufferRatio: 0.6,
        buildRatio: { econ: 0.35, mil: 0.65 },
        armySizeToAttackVillage: 25,
        siegeWeaponThreshold: 0.15,
        aggressionThreshold: 0,
        retaliationFactor: 2.5,
        reputationDecayRate: "Muy Baja",
        allyAttackResponseFactor: 2,
        oasisControlRadius: 15,
        oasisFarmingEfficiency: 1,
        dominanceThreshold: 300,
        oasisLossTolerance: 0.4,
        bonusMultiplier: 2,
        defensiveConfig: { stanceDuration: 120000, retaliationThreshold: 1, resourceToTroopRatio: 0.9 },
        archetypes: {
            rusher: {
                strategicGoals: [
                    {
                        id: "Eco1",
                        priority: 200,
                        category: "economic",
                        scope: "per_village",
                        isRecurring: true,
                        plan: [
                            { type: "resource_fields_level", level: 10 },
                            { type: "building", buildingType: "mainBuilding", level: 10 },
                            { type: "building", buildingType: "warehouse", level: 10 },
                            { type: "building", buildingType: "granary", level: 10 },
                            { type: "building", buildingType: "rallyPoint", level: 10 },
                            { type: "building", buildingType: "embassy", level: 10 },
                            { type: "building", buildingType: "palace", level: 10 }
                        ]
                    },
                    {
                        id: "Sett1",
                        priority: 195,
                        category: "economic",
                        scope: "village_index:0",
                        isRecurring: false,
                        plan: [
                            { type: "units", unitType: "settler", count: 3 }
                        ],
                        condition: { type: "player_property", property: "population", operator: ">=", value: 15050 },
                        action: { type: "settle_new_village", trigger: "on_plan_complete" }
                    },
                    {
                        id: "Mil1",
                        priority: 200,
                        category: "military",
                        scope: "per_village",
                        isRecurring: true,
                        plan: [
                            { type: "building", buildingType: "barracks", level: 20 },
                            { type: "units", unitType: "offensive_infantry", count: 100000 },
                            { type: "building", buildingType: "smithy", level: 20 },
                            { type: "building", buildingType: "hospital", level: 20 },
                            { type: "units", unitType: "scout", count: 5000 },
                            { type: "building", buildingType: "stable", level: 20 },
                            { type: "units", unitType: "offensive_cavalry", count: 40000 },
                            { type: "building", buildingType: "workshop", level: 20 },
                            { type: "units", unitType: "ram", count: 3000 },
                            { type: "building", buildingType: "academy", level: 20 },
                            { type: "units", unitType: "catapult", count: 1000 },
                            { type: "building", buildingType: "cityWall", level: 20 },
                            { type: "upgrade", unitType: "offensive_infantry", level: 20 },
                            { type: "upgrade", unitType: "offensive_cavalry", level: 20 },
                            { type: "upgrade", unitType: "ram", level: 20 },
                            { type: "upgrade", unitType: "catapult", level: 20 }
                        ],
                        condition: { type: "resource_fields_level", operator: ">=", value: 2 }
                    }
                ],
                tactics: []
            },
            boomer: {
                strategicGoals: [
                    {
                        id: "EcoImp1",
                        priority: 200,
                        category: "economic",
                        scope: "village_index:0",
                        isRecurring: false,
                        plan: [
                            { type: "resource_fields_level", level: 5 }
                        ]
                    },
                    {
                        id: "MilBasic1",
                        priority: 180,
                        category: "military",
                        scope: "per_village",
                        isRecurring: true,
                        plan: [
                            { type: "building", buildingType: "barracks", level: 5 },
                            { type: "units", unitType: "defensive_infantry", count: 400 },
                            { type: "units", unitType: "scout", count: 60 }
                        ],
                        condition: { type: "resource_fields_level", operator: ">=", value: 3 }
                    }
                ],
                tactics: []
            },
            turtle: {
                strategicGoals: [
                    {
                        id: "EcoImp1",
                        priority: 200,
                        category: "economic",
                        scope: "village_index:0",
                        isRecurring: false,
                        plan: [
                            { type: "resource_fields_level", level: 5 }
                        ]
                    },
                    {
                        id: "MilBasic1",
                        priority: 185,
                        category: "military",
                        scope: "per_village",
                        isRecurring: true,
                        plan: [
                            { type: "building", buildingType: "barracks", level: 7 },
                            { type: "units", unitType: "defensive_infantry", count: 600 },
                            { type: "building", buildingType: "cityWall", level: 10 },
                            { type: "units", unitType: "scout", count: 80 }
                        ],
                        condition: { type: "resource_fields_level", operator: ">=", value: 3 }
                    }
                ],
                tactics: []
            }
        }
    }
};
