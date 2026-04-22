export const GERMAN_PHASE_PROFILE = Object.freeze({
    PHASE_IDS: Object.freeze({
        phase1: 'german_phase_1_economic_bootstrap',
        phase2: 'german_phase_2_basic_military_unlock',
        phase3: 'german_phase_3_sustained_mixed_production',
        phase4: 'german_phase_4_military_pressure_tech',
        phase5: 'german_phase_5_siege_expansion',
        phaseDone: 'german_phase_template_complete',
    }),

    PHASE_TEMPLATE_BY_DIFFICULTY: Object.freeze({
        Pesadilla: {
            phase1: { ratio: { econ: 0.65, mil: 0.35 } },
            phase2: { ratio: { econ: 0.65, mil: 0.35 } },
            phase3: { ratio: { econ: 0.65, mil: 0.35 } },
            phase4: { ratio: { econ: 0.65, mil: 0.35 } },
            phase5: { ratio: { econ: 0.65, mil: 0.35 } },
        },
    }),

    PHASE_ONE_EXIT_CONDITIONS: Object.freeze({
        resourceFieldsLevel: 5,
        buildingLevels: Object.freeze({
            mainBuilding: 8,
            barracks: 3,
            academy: 5,
            smithy: 1,
            warehouse: 8,
            granary: 8,
            grainMill: 5,
            marketplace: 0,
            cityWall: 0,
        }),
    }),

    PHASE_ONE_PRIORITY: Object.freeze({
        mainBuildingTargetLevel: 8,
        emergencyDefenseTargetTroops: 40,
        defenseLookaheadMs: 180_000,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_TWO_EXIT_CONDITIONS: Object.freeze({
        resourceFieldsLevel: 7,
        buildingLevels: Object.freeze({
            mainBuilding: 10,
            rallyPoint: 0,
            barracks: 10,
            academy: 10,
            smithy: 5,
            stable: 0,
            warehouse: 12,
            granary: 12,
            cityWall: 0,
        }),
    }),

    PHASE_TWO_PRIORITY: Object.freeze({
        barracksTargetLevel: 10,
        resourceFieldsTargetLevel: 7,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_THREE_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 8,
        buildingLevels: Object.freeze({
            mainBuilding: 10,
            barracks: 12,
            academy: 10,
            smithy: 10,
            stable: 10,
            warehouse: 15,
            granary: 15,
            grainMill: 5,
        }),
    }),

    PHASE_THREE_PRIORITY: Object.freeze({
        smithyTargetLevel: 10,
        barracksTargetLevel: 12,
        academyTargetLevel: 10,
        resourceFieldsTargetLevel: 8,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_FOUR_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 9,
        buildingLevels: Object.freeze({
            mainBuilding: 10,
            barracks: 15,
            rallyPoint: 10,
            academy: 10,
            smithy: 10,
            stable: 12,
            workshop: 3,
            warehouse: 17,
            granary: 17,
            marketplace: 0,
            embassy: 0,
            palace: 0,
        }),
    }),

    PHASE_FOUR_PRIORITY: Object.freeze({
        rallyPointTargetLevel: 10,
        stableTargetLevel: 12,
        workshopTargetLevel: 3,
        smithyTargetLevel: 10,
        barracksTargetLevel: 15,
        academyTargetLevel: 10,
        marketplaceTargetLevel: 0,
        embassyTargetLevel: 0,
        palaceTargetLevel: 0,
        mainBuildingTargetLevel: 10,
        warehouseTargetLevel: 17,
        granaryTargetLevel: 17,
        resourceFieldsTargetLevel: 9,
        storagePressureThreshold: 0.92,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_FIVE_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 10,
        buildingLevels: Object.freeze({
            barracks: 17,
            academy: 10,
            smithy: 10,
            stable: 15,
            warehouse: 19,
            granary: 19,
            heroMansion: 0,
            workshop: 10,
            marketplace: 10,
            embassy: 10,
            palace: 15,
        }),
    }),

    PHASE_FIVE_PRIORITY: Object.freeze({
        academyTargetLevel: 10,
        workshopTargetLevel: 10,
        smithyTargetLevel: 10,
        barracksTargetLevel: 17,
        stableTargetLevel: 15,
        marketplaceTargetLevel: 10,
        embassyTargetLevel: 10,
        palaceTargetLevel: 15,
        heroMansionTargetLevel: 0,
        warehouseTargetLevel: 19,
        granaryTargetLevel: 19,
        resourceFieldsTargetLevel: 10,
        storagePressureThreshold: 0.9,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_CYCLE_TARGETS_BY_DIFFICULTY: Object.freeze({
        Pesadilla: {
            phase1: { total: 25, offensiveInfantry: 20, scout: 5 },
            phase1Emergency: { defensiveInfantry: 5, total: 5 },
            phase2: { total: 65, offensiveInfantry: 60, scout: 5 },
            phase3: { total: 170, offensiveInfantry: 120, scout: 10, offensiveCavalry: 40 },
            phase4: { total: 210, offensiveInfantry: 150, scout: 10, offensiveCavalry: 50 },
            phase5: { total: 410, offensiveInfantry: 300, scout: 10, offensiveCavalry: 100 },
        },
    }),
});
