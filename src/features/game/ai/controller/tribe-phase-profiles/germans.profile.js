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
        resourceFieldsLevel: 2,
        buildingLevels: Object.freeze({
            mainBuilding: 3,
            barracks: 3,
            academy: 3,
            smithy: 1,
            warehouse: 3,
            granary: 3,
            marketplace: 1,
            cityWall: 3,
        }),
    }),

    PHASE_ONE_PRIORITY: Object.freeze({
        mainBuildingTargetLevel: 3,
        emergencyDefenseTargetTroops: 40,
        defenseLookaheadMs: 180_000,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_TWO_EXIT_CONDITIONS: Object.freeze({
        resourceFieldsLevel: 4,
        buildingLevels: Object.freeze({
            mainBuilding: 5,
            rallyPoint: 5,
            barracks: 5,
            academy: 5,
            smithy: 3,
            stable: 3,
            warehouse: 7,
            granary: 7,
            cityWall: 5,
        }),
    }),

    PHASE_TWO_PRIORITY: Object.freeze({
        barracksTargetLevel: 5,
        resourceFieldsTargetLevel: 4,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_THREE_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 6,
        buildingLevels: Object.freeze({
            mainBuilding: 7,
            barracks: 8,
            academy: 8,
            smithy: 5,
            stable: 8,
            warehouse: 10,
            granary: 10,
            grainMill: 1,
        }),
    }),

    PHASE_THREE_PRIORITY: Object.freeze({
        smithyTargetLevel: 5,
        barracksTargetLevel: 8,
        academyTargetLevel: 8,
        resourceFieldsTargetLevel: 6,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_FOUR_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 8,
        buildingLevels: Object.freeze({
            mainBuilding: 10,
            barracks: 10,
            academy: 15,
            smithy: 5,
            stable: 10,
            warehouse: 13,
            granary: 13,
            marketplace: 10,
            embassy: 3,
            palace: 10,
        }),
    }),

    PHASE_FOUR_PRIORITY: Object.freeze({
        rallyPointTargetLevel: 1,
        stableTargetLevel: 10,
        workshopTargetLevel: 1,
        smithyTargetLevel: 5,
        barracksTargetLevel: 10,
        academyTargetLevel: 15,
        marketplaceTargetLevel: 10,
        embassyTargetLevel: 3,
        palaceTargetLevel: 10,
        mainBuildingTargetLevel: 10,
        warehouseTargetLevel: 13,
        granaryTargetLevel: 13,
        resourceFieldsTargetLevel: 8,
        storagePressureThreshold: 0.92,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_FIVE_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 10,
        buildingLevels: Object.freeze({
            barracks: 12,
            academy: 15,
            smithy: 10,
            stable: 12,
            warehouse: 15,
            granary: 15,
            heroMansion: 10,
            workshop: 5,
            embassy: 10,
        }),
    }),

    PHASE_FIVE_PRIORITY: Object.freeze({
        academyTargetLevel: 15,
        workshopTargetLevel: 5,
        smithyTargetLevel: 10,
        barracksTargetLevel: 12,
        stableTargetLevel: 12,
        marketplaceTargetLevel: 0,
        embassyTargetLevel: 10,
        palaceTargetLevel: 0,
        heroMansionTargetLevel: 10,
        warehouseTargetLevel: 15,
        granaryTargetLevel: 15,
        resourceFieldsTargetLevel: 10,
        storagePressureThreshold: 0.9,
        minIdleLogIntervalMs: 20_000,
    }),

    PHASE_CYCLE_TARGETS_BY_DIFFICULTY: Object.freeze({
        Pesadilla: {
            phase1: { total: 0 },
            phase1Emergency: { defensiveInfantry: 5, total: 5 },
            phase2: { total: 0 },
            phase3: { total: 25, offensiveInfantry: 20, scout: 5 },
            phase4: { total: 48, offensiveInfantry: 30, scout: 3, offensiveCavalry: 15 },
            phase5: { total: 130, offensiveInfantry: 100, offensiveCavalry: 30 },
        },
    }),
});
