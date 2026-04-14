# Reporte de convergencia por replay determinista

- deterministic_same_seed: OK
- seed_base: 1337
- seed_alterno: 7331
- ciclos: 140

## Snapshot seed base
```json
{
  "seed": 1337,
  "cycles": 140,
  "german": {
    "activePhaseId": "german_phase_3_sustained_mixed_production",
    "transitions": 0,
    "subGoalHistory": 7,
    "activeSubGoalKind": "wait_resources",
    "recruitmentCycles": {
      "completed": 4,
      "max": 52
    },
    "goalActions": 0
  },
  "egyptian": {
    "activePhaseId": "egyptian_phase_3_defensive_scaling",
    "transitions": 0,
    "subGoalHistory": 2,
    "activeSubGoalKind": null,
    "recruitmentCycles": {
      "completed": 4,
      "max": 46
    },
    "goalActions": 0
  }
}
```

## Snapshot seed alterno
```json
{
  "seed": 7331,
  "cycles": 140,
  "german": {
    "activePhaseId": "german_phase_3_sustained_mixed_production",
    "transitions": 0,
    "subGoalHistory": 10,
    "activeSubGoalKind": "wait_resources",
    "recruitmentCycles": {
      "completed": 3,
      "max": 52
    },
    "goalActions": 0
  },
  "egyptian": {
    "activePhaseId": "egyptian_phase_3_defensive_scaling",
    "transitions": 0,
    "subGoalHistory": 1,
    "activeSubGoalKind": null,
    "recruitmentCycles": {
      "completed": 8,
      "max": 46
    },
    "goalActions": 0
  }
}
```
