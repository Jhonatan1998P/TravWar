export const EGYPTIAN_PHASE_PROFILE = Object.freeze({
    PHASE_IDS: Object.freeze({
        phase1: 'egyptian_phase_1_fortified_economy',
        phase2: 'egyptian_phase_2_early_defensive_core',
        phase3: 'egyptian_phase_3_defensive_scaling',
        phase4: 'egyptian_phase_4_secure_expansion_setup',
        phase5: 'egyptian_phase_5_guarded_expansion_execution',
        phase6: 'egyptian_phase_6_resilient_late_control',
        phaseDone: 'egyptian_phase_template_complete',
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

    PHASE_ONE_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 6,
        buildingLevels: Object.freeze({
            mainBuilding: 10,
            barracks: 10,
            academy: 10,
            smithy: 10,
            warehouse: 15,
            granary: 15,
            marketplace: 3,
            embassy: 3,
            cityWall: 10,
        }),
    }),

    PHASE_TWO_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 8,
        buildingLevels: Object.freeze({
            academy: 15,
            cityWall: 15,
        }),
    }),

    PHASE_THREE_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 10,
        buildingLevels: Object.freeze({
            barracks: 15,
            academy: 15,
            warehouse: 17,
            granary: 17,
            marketplace: 10,
            embassy: 10,
            palace: 10,
        }),
    }),

    PHASE_FOUR_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 11,
        buildingLevels: Object.freeze({
            smithy: 15,
            cityWall: 20,
        }),
    }),

    PHASE_FIVE_INFRASTRUCTURE_TARGETS: Object.freeze({
        resourceFieldsLevel: 12,
        buildingLevels: Object.freeze({
            smithy: 18,
        }),
    }),

    PHASE_FOUR_UPGRADE_TARGETS: Object.freeze({
        defensiveInfantry: 12,
        defensiveCavalry: 10,
    }),

    PHASE_FIVE_UPGRADE_TARGETS: Object.freeze({
        defensiveInfantry: 15,
        defensiveCavalry: 12,
    }),

    PHASE_EXIT_CYCLE_TARGETS: Object.freeze({
        phase1: { total: 0 },
        phase2: { total: 35, defensiveInfantry: 30, scout: 5 },
        phase3: { total: 100, defensiveInfantry: 60, defensiveCavalry: 30, scout: 10 },
        phase4: { total: 140, defensiveInfantry: 80, scout: 10, defensiveCavalry: 50 },
        phase5: { total: 200, defensiveInfantry: 120, defensiveCavalry: 80 },
    }),

    PHASE_LANE_STEPS: Object.freeze({
        phase1: Object.freeze({
            construction: Object.freeze([
                { type: 'resource_fields_level', level: 6 },
                { type: 'building', buildingType: 'mainBuilding', level: 10 },
                { type: 'building', buildingType: 'barracks', level: 10 },
                { type: 'building', buildingType: 'academy', level: 10 },
                { type: 'building', buildingType: 'smithy', level: 10 },
                { type: 'building', buildingType: 'warehouse', level: 15 },
                { type: 'building', buildingType: 'granary', level: 15 },
                { type: 'building', buildingType: 'marketplace', level: 3 },
                { type: 'building', buildingType: 'embassy', level: 3 },
                { type: 'building', buildingType: 'cityWall', level: 10 },
            ]),
            research: Object.freeze([
                { type: 'research', unitType: 'defensive_infantry' },
                { type: 'research', unitType: 'scout' },
                { type: 'research', unitType: 'defensive_cavalry' },
            ]),
            upgrade: Object.freeze([]),
            recruitment: Object.freeze([]),
        }),
        phase2: Object.freeze({
            construction: Object.freeze([
                { type: 'resource_fields_level', level: 8 },
                { type: 'building', buildingType: 'academy', level: 15 },
                { type: 'building', buildingType: 'cityWall', level: 15 },
            ]),
            research: Object.freeze([]),
            upgrade: Object.freeze([
                { type: 'upgrade', unitType: 'defensive_infantry', level: 8 },
                { type: 'upgrade', unitType: 'defensive_cavalry', level: 5 },
            ]),
            recruitment: Object.freeze([
                { type: 'units', unitType: 'defensive_infantry', countMode: 'cycle_batch', cycleCount: 1, allowBudgetBorrow: true },
                { type: 'units', unitType: 'scout', countMode: 'cycle_batch', cycleCount: 1, allowBudgetBorrow: true },
            ]),
        }),
        phase3: Object.freeze({
            construction: Object.freeze([
                { type: 'resource_fields_level', level: 10 },
                { type: 'building', buildingType: 'barracks', level: 15 },
                { type: 'building', buildingType: 'academy', level: 15 },
                { type: 'building', buildingType: 'warehouse', level: 17 },
                { type: 'building', buildingType: 'granary', level: 17 },
                { type: 'building', buildingType: 'marketplace', level: 10 },
                { type: 'building', buildingType: 'embassy', level: 10 },
                { type: 'building', buildingType: 'palace', level: 10 },
            ]),
            research: Object.freeze([
                { type: 'research', unitType: 'ram' },
            ]),
            upgrade: Object.freeze([
                { type: 'upgrade', unitType: 'defensive_infantry', level: 10 },
                { type: 'upgrade', unitType: 'defensive_cavalry', level: 8 },
            ]),
            recruitment: Object.freeze([
                { type: 'units', unitType: 'defensive_infantry', countMode: 'cycle_batch', cycleCount: 1, allowBudgetBorrow: true },
                { type: 'units', unitType: 'scout', countMode: 'cycle_batch', cycleCount: 1, allowBudgetBorrow: true },
                { type: 'units', unitType: 'defensive_cavalry', countMode: 'cycle_batch', cycleCount: 1, allowBudgetBorrow: true },
            ]),
        }),
        phase4: Object.freeze({
            construction: Object.freeze([
                { type: 'resource_fields_level', level: 11 },
                { type: 'building', buildingType: 'smithy', level: 15 },
                { type: 'building', buildingType: 'cityWall', level: 20 },
            ]),
            research: Object.freeze([
                { type: 'research', unitType: 'catapult' },
            ]),
            upgrade: Object.freeze([
                { type: 'upgrade', unitType: 'defensive_infantry', level: 12 },
                { type: 'upgrade', unitType: 'defensive_cavalry', level: 10 },
            ]),
            recruitment: Object.freeze([
                { type: 'units', unitType: 'defensive_infantry', countMode: 'cycle_batch', cycleCount: 1, allowBudgetBorrow: true },
                { type: 'units', unitType: 'scout', countMode: 'cycle_batch', cycleCount: 1, allowBudgetBorrow: true },
                { type: 'units', unitType: 'defensive_cavalry', countMode: 'cycle_batch', cycleCount: 1, allowBudgetBorrow: true },
            ]),
        }),
        phase5: Object.freeze({
            construction: Object.freeze([
                { type: 'resource_fields_level', level: 12 },
                { type: 'building', buildingType: 'smithy', level: 18 },
            ]),
            research: Object.freeze([]),
            upgrade: Object.freeze([
                { type: 'upgrade', unitType: 'defensive_infantry', level: 15 },
                { type: 'upgrade', unitType: 'defensive_cavalry', level: 12 },
            ]),
            recruitment: Object.freeze([
                { type: 'units', unitType: 'defensive_infantry', countMode: 'cycle_batch', cycleCount: 1, allowBudgetBorrow: true },
                { type: 'units', unitType: 'defensive_cavalry', countMode: 'cycle_batch', cycleCount: 1, allowBudgetBorrow: true },
            ]),
        }),
    }),
});
