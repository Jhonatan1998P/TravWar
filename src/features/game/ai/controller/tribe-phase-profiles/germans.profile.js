export const GERMAN_PHASE_PROFILE = Object.freeze({
    PHASE_IDS: Object.freeze({
        phase1: 'german_phase_1_offensive_bootstrap',
        phase2: 'german_phase_2_offensive_pressure',
        phase3: 'german_phase_3_offensive_cavalry',
        phase4: 'german_phase_4_hammer_formation',
        phase5: 'german_phase_5_supreme_hammer',
        phaseDone: 'german_phase_template_complete',
    }),

    PHASE_TEMPLATE_BY_DIFFICULTY: Object.freeze({
        Pesadilla: {
            phase1: { ratio: { econ: 0.60, mil: 0.40 } },
            phase2: { ratio: { econ: 0.55, mil: 0.45 } },
            phase3: { ratio: { econ: 0.55, mil: 0.45 } },
            phase4: { ratio: { econ: 0.50, mil: 0.50 } },
            phase5: { ratio: { econ: 0.50, mil: 0.50 } },
        },
    }),

    PHASE_ONE_EXIT_CONDITIONS: Object.freeze({
        resourceFieldsLevel: 6,
        buildingLevels: Object.freeze({
            mainBuilding: 5,
            rallyPoint: 1,
            warehouse: 10,
            granary: 10,
        }),
    }),

    PHASE_ONE_PRIORITY: Object.freeze({
        mainBuildingTargetLevel: 5,
        emergencyDefenseTargetTroops: 30,
        defenseLookaheadMs: 120_000,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_TWO_EXIT_CONDITIONS: Object.freeze({
        resourceFieldsLevel: 8,
        buildingLevels: Object.freeze({
            mainBuilding: 5,
            rallyPoint: 5,
            barracks: 10,
            academy: 5,
            smithy: 5,
            stable: 5,
            warehouse: 15,
            granary: 15,
            grainMill: 5,
            cityWall: 10,
        }),
    }),

    PHASE_TWO_PRIORITY: Object.freeze({
        barracksTargetLevel: 10,
        resourceFieldsTargetLevel: 8,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_THREE_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 10,
        buildingLevels: Object.freeze({
            mainBuilding: 10,
            barracks: 13,
            academy: 10,
            smithy: 10,
            stable: 10,
            workshop: 3,
            rallyPoint: 5,
            warehouse: 18,
            granary: 18,
            bakery: 5,
        }),
    }),

    PHASE_THREE_PRIORITY: Object.freeze({
        smithyTargetLevel: 10,
        barracksTargetLevel: 13,
        academyTargetLevel: 10,
        stableTargetLevel: 10,
        workshopTargetLevel: 3,
        resourceFieldsTargetLevel: 10,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_FOUR_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 10,
        buildingLevels: Object.freeze({
            mainBuilding: 10,
            barracks: 16,
            rallyPoint: 10,
            academy: 10,
            smithy: 10,
            stable: 13,
            workshop: 5,
            warehouse: 20,
            granary: 20,
            marketplace: 7,
            embassy: 5,
            palace: 10,
        }),
    }),

    PHASE_FOUR_PRIORITY: Object.freeze({
        rallyPointTargetLevel: 10,
        stableTargetLevel: 13,
        workshopTargetLevel: 5,
        smithyTargetLevel: 10,
        barracksTargetLevel: 16,
        academyTargetLevel: 10,
        marketplaceTargetLevel: 7,
        embassyTargetLevel: 5,
        palaceTargetLevel: 10,
        mainBuildingTargetLevel: 10,
        warehouseTargetLevel: 20,
        granaryTargetLevel: 20,
        resourceFieldsTargetLevel: 10,
        storagePressureThreshold: 0.92,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_FIVE_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 11,
        buildingLevels: Object.freeze({
            barracks: 20,
            academy: 10,
            smithy: 10,
            stable: 17,
            workshop: 10,
            warehouse: 19,
            granary: 19,
            heroMansion: 10,
            marketplace: 10,
            embassy: 10,
            palace: 15,
        }),
    }),

    PHASE_FIVE_PRIORITY: Object.freeze({
        academyTargetLevel: 10,
        workshopTargetLevel: 10,
        smithyTargetLevel: 10,
        barracksTargetLevel: 20,
        stableTargetLevel: 17,
        marketplaceTargetLevel: 10,
        embassyTargetLevel: 10,
        palaceTargetLevel: 15,
        heroMansionTargetLevel: 10,
        warehouseTargetLevel: 19,
        granaryTargetLevel: 19,
        resourceFieldsTargetLevel: 11,
        storagePressureThreshold: 0.9,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_CYCLE_TARGETS_BY_DIFFICULTY: Object.freeze({
        Pesadilla: {
            phase1: { total: 0 },
            phase1Emergency: { offensiveInfantry: 3, total: 3 },
            phase2: { total: 25, offensiveInfantry: 20, scout: 5 },
            phase3: { total: 170, offensiveInfantry: 120, scout: 10, offensiveCavalry: 40 },
            phase4: { total: 220, offensiveInfantry: 150, scout: 10, offensiveCavalry: 50, ram: 10, expansion: 1 },
            phase5: { total: 370, offensiveInfantry: 250, scout: 10, offensiveCavalry: 80, ram: 20, catapult: 10, expansion: 2 },
        },
    }),
});
