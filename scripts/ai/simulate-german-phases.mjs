import { gameData } from '../../src/features/game/core/GameData.js';
import { GameStateFactory } from '../../src/features/game/engine/GameStateFactory.js';
import { VillageProcessor } from '../../src/features/game/engine/VillageProcessor.js';
import { CombatEngine } from '../../src/features/game/engine/CombatEngine.js';
import { AIController, AIPersonality } from '../../src/features/game/ai/index.js';
import { initializeAIVillageBudget, addResourceIncomeToVillage } from '../../src/features/game/state/worker/budget.js';
import { processMovements as processMovementsStep } from '../../src/features/game/state/worker/movements.js';
import { processOasisRegeneration as processOasisRegenerationStep, registerOasisAttack as registerOasisAttackStep } from '../../src/features/game/state/worker/oasis.js';
import { handleSendMovementCommand as handleSendMovementCommandStep, handleSendMerchantsCommand as handleSendMerchantsCommandStep } from '../../src/features/game/state/worker/commands.js';
import { isUnderBeginnerProtectionByPopulation } from '../../src/features/game/core/data/constants.js';
import { GERMAN_PHASE_IDS } from '../../src/features/game/ai/controller/german-phase-engine.js';
import { EGYPTIAN_PHASE_IDS } from '../../src/features/game/ai/controller/egyptian-phase-engine.js';

const TICK_MS = 500;
const MAX_REPORTS = 200;
const PHASE_BLOCK_STALL_TICK_THRESHOLD = 120;

const SIM_RACE_ALIASES = Object.freeze({
    germanos: 'germans',
    germano: 'germans',
    german: 'germans',
    germans: 'germans',
    egipcios: 'egyptians',
    egipcio: 'egyptians',
    egyptian: 'egyptians',
    egyptians: 'egyptians',
    egypt: 'egyptians',
});

const RACE_SIMULATION_PROFILES = Object.freeze({
    germans: Object.freeze({
        aiRace: 'germans',
        phaseStateKey: 'germanPhaseState',
        sessionId: 'sim-session-german-phases',
        worldSeedPrefix: 'GERMAN_PHASE_SIM',
        phaseDoneId: GERMAN_PHASE_IDS.phaseDone,
        phaseNameById: Object.freeze({
            [GERMAN_PHASE_IDS.phase1]: 'Fase 1 - Inicio ofensivo',
            [GERMAN_PHASE_IDS.phase2]: 'Fase 2 - Presion ofensiva y saqueos',
            [GERMAN_PHASE_IDS.phase3]: 'Fase 3 - Caballeria ofensiva',
            [GERMAN_PHASE_IDS.phase4]: 'Fase 4 - Martillo en formacion (arietes)',
            [GERMAN_PHASE_IDS.phase5]: 'Fase 5 - Martillo supremo y expansion',
            [GERMAN_PHASE_IDS.phaseDone]: 'Plantilla completada',
        }),
        trackedUnitIds: Object.freeze([
            'axeman',
            'scout_german',
            'teutonic_knight',
            'ram_german',
            'catapult_german',
        ]),
        unitNameById: Object.freeze({
            axeman: 'hacheros',
            scout_german: 'exploradores',
            teutonic_knight: 'caballeria_teutona',
            ram_german: 'arietes',
            catapult_german: 'catapultas',
        }),
        cyclePhaseIdToKey: Object.freeze({
            [GERMAN_PHASE_IDS.phase2]: 'phase2',
            [GERMAN_PHASE_IDS.phase3]: 'phase3',
            [GERMAN_PHASE_IDS.phase4]: 'phase4',
            [GERMAN_PHASE_IDS.phase5]: 'phase5',
        }),
        cycleProgressPhaseKeys: Object.freeze(['phase2', 'phase3', 'phase4', 'phase5']),
        cycleAggregatePhaseKeys: Object.freeze(['phase3', 'phase4', 'phase5']),
        cycleBucketOutputByMsKey: Object.freeze({
            offensiveInfantryMs: 'infanteriaOfensiva',
            defensiveInfantryMs: 'infanteriaDefensiva',
            offensiveCavalryMs: 'caballeriaOfensiva',
            scoutMs: 'exploradores',
            ramMs: 'arietes',
            catapultMs: 'catapultas',
            expansionMs: 'expansion',
        }),
    }),
    egyptians: Object.freeze({
        aiRace: 'egyptians',
        phaseStateKey: 'egyptianPhaseState',
        sessionId: 'sim-session-egyptian-phases',
        worldSeedPrefix: 'EGYPTIAN_PHASE_SIM',
        phaseDoneId: EGYPTIAN_PHASE_IDS.phaseDone,
        phaseNameById: Object.freeze({
            [EGYPTIAN_PHASE_IDS.phase1]: 'Fase 1 - Eco Fortificada',
            [EGYPTIAN_PHASE_IDS.phase2]: 'Fase 2 - Nucleo Defensivo Temprano',
            [EGYPTIAN_PHASE_IDS.phase3]: 'Fase 3 - Escalado Defensivo',
            [EGYPTIAN_PHASE_IDS.phase4]: 'Fase 4 - Preparacion Expansion Segura',
            [EGYPTIAN_PHASE_IDS.phase5]: 'Fase 5 - Expansion Custodiada',
            [EGYPTIAN_PHASE_IDS.phase6]: 'Fase 5 - Expansion Custodiada (legacy)',
            [EGYPTIAN_PHASE_IDS.phaseDone]: 'Plantilla completada',
        }),
        trackedUnitIds: Object.freeze([
            'slave_militia_egypt',
            'ash_warden_egypt',
            'khopesh_warrior_egypt',
            'sopdu_explorer_egypt',
            'anhur_guard_egypt',
            'resheph_chariot_egypt',
            'ram_egypt',
            'catapult_egypt',
        ]),
        unitNameById: Object.freeze({
            slave_militia_egypt: 'milicia_esclavos',
            ash_warden_egypt: 'guardia_ceniza',
            khopesh_warrior_egypt: 'guerrero_khopesh',
            sopdu_explorer_egypt: 'explorador_sopdu',
            anhur_guard_egypt: 'guardia_anhur',
            resheph_chariot_egypt: 'carro_resheph',
            ram_egypt: 'arietes',
            catapult_egypt: 'catapultas',
        }),
        cyclePhaseIdToKey: Object.freeze({
            [EGYPTIAN_PHASE_IDS.phase1]: 'phase1',
            [EGYPTIAN_PHASE_IDS.phase2]: 'phase2',
            [EGYPTIAN_PHASE_IDS.phase3]: 'phase3',
            [EGYPTIAN_PHASE_IDS.phase4]: 'phase4',
            [EGYPTIAN_PHASE_IDS.phase5]: 'phase5',
            [EGYPTIAN_PHASE_IDS.phase6]: 'phase5',
        }),
        cycleProgressPhaseKeys: Object.freeze(['phase1', 'phase2', 'phase3', 'phase4', 'phase5']),
        cycleAggregatePhaseKeys: Object.freeze(['phase2', 'phase3', 'phase4', 'phase5']),
        cycleBucketOutputByMsKey: Object.freeze({
            defensiveInfantryMs: 'infanteriaDefensiva',
            defensiveCavalryMs: 'caballeriaDefensiva',
            offensiveInfantryMs: 'infanteriaOfensiva',
            offensiveCavalryMs: 'caballeriaOfensiva',
            scoutMs: 'exploradores',
            siegeMs: 'asedio',
            expansionMs: 'expansion',
        }),
    }),
});

let PERFIL_RAZA_ACTIVO = RACE_SIMULATION_PROFILES.germans;
let TRACKED_UNIT_IDS = [...PERFIL_RAZA_ACTIVO.trackedUnitIds];
let CYCLE_PHASE_ID_TO_KEY = { ...PERFIL_RAZA_ACTIVO.cyclePhaseIdToKey };
let CYCLE_PROGRESS_PHASE_KEYS = [...PERFIL_RAZA_ACTIVO.cycleProgressPhaseKeys];
let CYCLE_AGGREGATE_PHASE_KEYS = [...PERFIL_RAZA_ACTIVO.cycleAggregatePhaseKeys];
let CYCLE_BUCKET_OUTPUT_BY_MS_KEY = { ...PERFIL_RAZA_ACTIVO.cycleBucketOutputByMsKey };
let NOMBRE_FASE_ES = { ...PERFIL_RAZA_ACTIVO.phaseNameById };
let NOMBRE_UNIDAD_ES = { ...PERFIL_RAZA_ACTIVO.unitNameById };

function normalizeSimRace(value) {
    const key = String(value || '').trim().toLowerCase();
    return SIM_RACE_ALIASES[key] || null;
}

function setActiveRaceProfile(race) {
    const profile = RACE_SIMULATION_PROFILES[race] || RACE_SIMULATION_PROFILES.germans;
    PERFIL_RAZA_ACTIVO = profile;
    TRACKED_UNIT_IDS = [...profile.trackedUnitIds];
    CYCLE_PHASE_ID_TO_KEY = { ...profile.cyclePhaseIdToKey };
    CYCLE_PROGRESS_PHASE_KEYS = [...profile.cycleProgressPhaseKeys];
    CYCLE_AGGREGATE_PHASE_KEYS = [...profile.cycleAggregatePhaseKeys];
    CYCLE_BUCKET_OUTPUT_BY_MS_KEY = { ...profile.cycleBucketOutputByMsKey };
    NOMBRE_FASE_ES = { ...profile.phaseNameById };
    NOMBRE_UNIDAD_ES = { ...profile.unitNameById };
    return profile;
}

function createConfig({ gameSpeed = 5000, aiRace = 'germans', worldSeed = 'PHASE_SIM' } = {}) {
    return {
        gameSpeed,
        troopSpeed: 1,
        tradeCapacityMultiplier: 1,
        playerRace: 'gauls',
        aiCount: 1,
        aiRaces: [aiRace],
        maxGameDays: 120,
        worldSeed,
        aiPhaseEngineRollout: { germans: true, egyptians: true },
    };
}

function updatePlayerProtectionStatus(gameState) {
    if (!gameState?.players) return;

    gameState.players.forEach(player => {
        if (!player.isUnderProtection) return;

        const totalPopulation = gameState.villages
            .filter(village => village.ownerId === player.id)
            .reduce((sum, village) => sum + (village.population?.current || 0), 0);

        if (!isUnderBeginnerProtectionByPopulation(totalPopulation)) {
            player.isUnderProtection = false;
        }
    });
}

function getReadableGameTime(gameMs) {
    const totalSeconds = Math.max(0, Math.floor(gameMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = value => String(value).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function getReadableRealTime(realMs, gameSpeed = 1) {
    const totalSeconds = Math.max(0, Math.floor(realMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = value => String(value).padStart(2, '0');
    const gameMs = realMs * gameSpeed;
    const gameTotalSeconds = Math.floor(gameMs / 1000);
    const gameHours = Math.floor(gameTotalSeconds / 3600);
    const gameMins = Math.floor((gameTotalSeconds % 3600) / 60);
    const gameSecs = gameTotalSeconds % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)} real / ${String(gameHours).padStart(3, '0')}:${String(gameMins).padStart(2, '0')}:${String(gameSecs).padStart(2, '0')} juego`;
}

function getMaxBuildingLevelByType(village, buildingType) {
    return Math.max(
        0,
        ...(village?.buildings || [])
            .filter(building => building.type === buildingType)
            .map(building => Number(building.level) || 0),
    );
}

function getAverageResourceFieldLevel(village) {
    const resourceFieldTypes = new Set(['woodcutter', 'clayPit', 'ironMine', 'cropland']);
    const fields = (village?.buildings || []).filter(building => resourceFieldTypes.has(building.type));
    if (fields.length === 0) return 0;
    const total = fields.reduce((sum, field) => sum + (Number(field.level) || 0), 0);
    return total / fields.length;
}

function msToCycles(value) {
    const cycleMs = 3 * 60 * 1000;
    return Math.floor(Math.max(0, Number(value) || 0) / cycleMs);
}

function createEmptyTrackedUnits() {
    const snapshot = {};
    TRACKED_UNIT_IDS.forEach(unitId => {
        snapshot[unitId] = 0;
    });
    return snapshot;
}

function createTrackedUnitSnapshot(village) {
    const snapshot = createEmptyTrackedUnits();
    TRACKED_UNIT_IDS.forEach(unitId => {
        snapshot[unitId] = Math.max(0, Number(village?.unitsInVillage?.[unitId]) || 0);
    });
    return snapshot;
}

function subtractTrackedUnitSnapshots(currentSnapshot, previousSnapshot) {
    const delta = createEmptyTrackedUnits();
    TRACKED_UNIT_IDS.forEach(unitId => {
        const current = Number(currentSnapshot?.[unitId]) || 0;
        const previous = Number(previousSnapshot?.[unitId]) || 0;
        delta[unitId] = Math.max(0, current - previous);
    });
    return delta;
}

function addTrackedUnitSnapshots(leftSnapshot, rightSnapshot) {
    const sum = createEmptyTrackedUnits();
    TRACKED_UNIT_IDS.forEach(unitId => {
        const left = Number(leftSnapshot?.[unitId]) || 0;
        const right = Number(rightSnapshot?.[unitId]) || 0;
        sum[unitId] = Math.max(0, left + right);
    });
    return sum;
}

function getTrackedUnitsTotal(snapshot) {
    return TRACKED_UNIT_IDS.reduce((sum, unitId) => sum + (Number(snapshot?.[unitId]) || 0), 0);
}

function toNonNegativeNumber(value) {
    return Math.max(0, Number(value) || 0);
}

function createCycleAccounting(rawMs, cycleMs = 3 * 60 * 1000) {
    const tiempoRealComprometidoMs = toNonNegativeNumber(rawMs);
    const ciclosCompletados = Math.floor(tiempoRealComprometidoMs / cycleMs);
    const tiempoRealRequeridoMs = ciclosCompletados * cycleMs;
    const excedenteRealMs = tiempoRealComprometidoMs - tiempoRealRequeridoMs;

    return {
        duracionCicloMs: cycleMs,
        tiempoRealComprometidoMs,
        tiempoRealComprometido: getReadableGameTime(tiempoRealComprometidoMs),
        ciclosCompletados,
        tiempoRealRequeridoMs,
        tiempoRealRequerido: getReadableGameTime(tiempoRealRequeridoMs),
        excedenteRealMs,
        excedenteReal: getReadableGameTime(excedenteRealMs),
        reglaEstrictaCumplida: tiempoRealComprometidoMs >= tiempoRealRequeridoMs && excedenteRealMs < cycleMs,
    };
}

function obtenerNombreFaseEs(idFase) {
    return NOMBRE_FASE_ES[idFase] || idFase || null;
}

function traducirUnidades(snapshot = {}) {
    const salida = {};
    TRACKED_UNIT_IDS.forEach(unitId => {
        const nombreUnidad = NOMBRE_UNIDAD_ES[unitId] || unitId;
        salida[nombreUnidad] = Math.max(0, Number(snapshot?.[unitId]) || 0);
    });
    return salida;
}

function traducirListaUnidades(lista = []) {
    return (Array.isArray(lista) ? lista : []).map(idUnidad => NOMBRE_UNIDAD_ES[idUnidad] || idUnidad);
}

function traducirMapaUnidades(mapa = {}) {
    return Object.entries(mapa || {}).reduce((acc, [idUnidad, valor]) => {
        const nombreUnidad = NOMBRE_UNIDAD_ES[idUnidad] || idUnidad;
        acc[nombreUnidad] = valor;
        return acc;
    }, {});
}

const TRADUCCION_RAZON_BLOQUEO = Object.freeze({
    PREREQUISITES_NOT_MET: 'PRERREQUISITOS_NO_CUMPLIDOS',
    INSUFFICIENT_RESOURCES: 'RECURSOS_INSUFICIENTES',
    QUEUE_FULL: 'COLA_LLENA',
    RESEARCH_REQUIRED: 'INVESTIGACION_REQUERIDA',
});

const TRADUCCION_TIPO_PASO = Object.freeze({
    research: 'investigacion',
    building: 'edificio',
    upgrade: 'mejora',
    units: 'unidades',
});

const TRADUCCION_ORIGEN_BLOQUEO = Object.freeze({
    phase4_lane_research: 'carril_fase4_investigacion',
    phase4_lane_upgrade: 'carril_fase4_mejora',
    phase5_lane_research: 'carril_fase5_investigacion',
    phase5_lane_upgrade: 'carril_fase5_mejora',
});

function traducirMapaDeBloqueos(mapa = {}, traducciones = {}) {
    return Object.entries(mapa).reduce((acc, [clave, valor]) => {
        const claveTraducida = traducciones[clave] || clave;
        acc[claveTraducida] = valor;
        return acc;
    }, {});
}

function obtenerNombreFaseEnTick(historial = [], tickObjetivo = 0) {
    if (!Array.isArray(historial) || historial.length === 0) return null;
    let fase = historial[0]?.nombreFase || null;
    for (const entrada of historial) {
        if (!entrada || !Number.isFinite(entrada.tick)) continue;
        if (entrada.tick <= tickObjetivo) {
            fase = entrada.nombreFase || fase;
            continue;
        }
        break;
    }
    return fase;
}

function runSimulation({ maxTicks = 3000, gameSpeed = 5000, quiet = true, simRace = 'germans' } = {}) {
    const originalDateNow = Date.now;
    const originalConsoleLog = console.log;
    const originalConsoleInfo = console.info;
    const originalConsoleWarn = console.warn;
    const originalConsoleDebug = console.debug;

    if (quiet) {
        console.log = () => {};
        console.info = () => {};
        console.warn = () => {};
        console.debug = () => {};
    }

    let simulatedNow = 1_700_000_000_000;
    Date.now = () => simulatedNow;

    try {
        const race = normalizeSimRace(simRace);
        if (!race) {
            throw new Error(`Tribu no valida: ${simRace}. Usa germanos/germans o egipcios/egyptians.`);
        }

        const profile = setActiveRaceProfile(race);
        const config = createConfig({
            gameSpeed,
            aiRace: profile.aiRace,
            worldSeed: `${profile.worldSeedPrefix}_X${gameSpeed}`,
        });
        const factory = new GameStateFactory(config);
        const gameState = factory.create(profile.sessionId);
        const personality = AIPersonality.Pesadilla;
        const aiBonus = personality.bonusMultiplier || 1;
        const budgetConfig = personality.buildRatio;

        const villageProcessors = [];
        gameState.villages.forEach(village => {
            if (village.ownerId.startsWith('ai_')) {
                initializeAIVillageBudget(village, budgetConfig);
            }

            villageProcessors.push(new VillageProcessor(
                village,
                config,
                gameState.alliance?.bonuses,
                village.ownerId.startsWith('ai_') ? aiBonus : 1,
                village.ownerId.startsWith('ai_') ? budgetConfig : null,
            ));
        });

        const aiControllers = [];

        const handleSendMovementCommand = payload => handleSendMovementCommandStep({
            payload,
            gameState,
            gameConfig: config,
            gameData,
            aiControllers,
        });

        const handleSendMerchantsCommand = payload => handleSendMerchantsCommandStep({
            payload,
            gameState,
            gameConfig: config,
            gameData,
        });

        function handleReturnArrival(movement) {
            const village = gameState.villages.find(candidate => candidate.id === movement.originVillageId);
            if (!village) return;
            if (movement.ownerId && village.ownerId !== movement.ownerId) return;

            for (const unitId in movement.payload.troops) {
                village.unitsInVillage[unitId] = (village.unitsInVillage[unitId] || 0) + movement.payload.troops[unitId];
            }

            const lootKeys = new Set([
                ...Object.keys(movement.payload.bounty || {}),
                ...Object.keys(movement.payload.plunder || {}),
            ]);

            for (const resource of lootKeys) {
                const bountyAmount = movement.payload.bounty?.[resource] || 0;
                const plunderAmount = movement.payload.plunder?.[resource] || 0;
                const amount = bountyAmount + plunderAmount;
                if (amount > 0) {
                    addResourceIncomeToVillage(village, resource, amount, { budgetBucket: 'mil' });
                }
            }
        }

        function handleReinforcementArrival(movement) {
            const targetVillage = gameState.villages.find(candidate => (
                candidate.coords.x === movement.targetCoords.x && candidate.coords.y === movement.targetCoords.y
            ));
            if (!targetVillage) return;

            const originVillage = gameState.villages.find(candidate => candidate.id === movement.originVillageId);
            if (!originVillage) return;

            const reinforcement = targetVillage.reinforcements.find(item => item.fromVillageId === movement.originVillageId);
            if (reinforcement) {
                for (const unitId in movement.payload.troops) {
                    reinforcement.troops[unitId] = (reinforcement.troops[unitId] || 0) + movement.payload.troops[unitId];
                }
                return;
            }

            targetVillage.reinforcements.push({
                fromVillageId: movement.originVillageId,
                race: originVillage.race,
                troops: movement.payload.troops,
                smithyUpgradesSnapshot: { ...(originVillage.smithy?.upgrades || {}) },
            });
        }

        function handleTradeArrival(movement) {
            const targetVillage = gameState.villages.find(candidate => (
                candidate.coords.x === movement.targetCoords.x && candidate.coords.y === movement.targetCoords.y
            ));
            if (!targetVillage) return;

            for (const resource in movement.payload.resources) {
                const amount = movement.payload.resources[resource];
                if (amount > 0) {
                    addResourceIncomeToVillage(targetVillage, resource, amount);
                }
            }

            const originVillage = gameState.villages.find(candidate => candidate.id === movement.originVillageId);
            if (!originVillage) return;

            const returnTravelTime = movement.arrivalTime - movement.startTime;
            const now = Date.now();
            gameState.movements.push({
                id: `${now}-mov-trade_return-${originVillage.id}`,
                type: 'trade_return',
                ownerId: movement.ownerId,
                originVillageId: movement.originVillageId,
                targetCoords: { x: originVillage.coords.x, y: originVillage.coords.y },
                payload: { merchants: movement.payload.merchants },
                startTime: now,
                arrivalTime: now + returnTravelTime,
            });

            gameState.movements.sort((left, right) => left.arrivalTime - right.arrivalTime);
        }

        function handleSettleArrival(movement) {
            const originVillage = gameState.villages.find(candidate => candidate.id === movement.originVillageId);
            if (!originVillage) return;

            const tileIndex = gameState.mapData.findIndex(tile => tile.x === movement.targetCoords.x && tile.y === movement.targetCoords.y);
            const tile = tileIndex >= 0 ? gameState.mapData[tileIndex] : null;
            if (!tile || tile.type !== 'valley') {
                for (const unitId in movement.payload.troops || {}) {
                    originVillage.unitsInVillage[unitId] = (originVillage.unitsInVillage[unitId] || 0) + movement.payload.troops[unitId];
                }
                return;
            }

            originVillage.settlementsFounded = (originVillage.settlementsFounded || 0) + 1;

            const newVillage = factory.createVillageObject(
                `v_${Date.now()}`,
                'Nueva Aldea',
                originVillage.race,
                originVillage.ownerId,
                movement.targetCoords,
                tile.valleyType,
                { startResourcesFromBaseCapacityRatio: 0.9 },
            );

            if (originVillage.ownerId.startsWith('ai_')) {
                initializeAIVillageBudget(newVillage, budgetConfig);
            }

            villageProcessors.push(new VillageProcessor(
                newVillage,
                config,
                gameState.alliance?.bonuses,
                originVillage.ownerId.startsWith('ai_') ? aiBonus : 1,
                originVillage.ownerId.startsWith('ai_') ? budgetConfig : null,
            ));

            gameState.villages.push(newVillage);
            gameState.mapData[tileIndex] = {
                x: movement.targetCoords.x,
                y: movement.targetCoords.y,
                type: 'village',
                villageId: newVillage.id,
                ownerId: newVillage.ownerId,
                race: newVillage.race,
            };
            gameState.spatialIndex.set(`${movement.targetCoords.x}|${movement.targetCoords.y}`, gameState.mapData[tileIndex]);
        }

        function handleAICommand(commandType, payload) {
            const villageId = payload?.villageId || gameState.activeVillageId;
            const processor = villageProcessors.find(candidate => candidate.getVillageId() === villageId);

            switch (commandType) {
                case 'upgrade_building':
                    return processor ? processor.queueBuildingUpgrade(payload) : { success: false, reason: 'PROCESSOR_NOT_FOUND' };
                case 'recruit_units':
                    return processor ? processor.queueRecruitment(payload) : { success: false, reason: 'PROCESSOR_NOT_FOUND' };
                case 'research_unit':
                    return processor ? processor.queueResearch(payload) : { success: false, reason: 'PROCESSOR_NOT_FOUND' };
                case 'upgrade_unit':
                    return processor ? processor.queueSmithyUpgrade(payload) : { success: false, reason: 'PROCESSOR_NOT_FOUND' };
                case 'send_movement':
                    return handleSendMovementCommand(payload);
                case 'send_merchants':
                    return handleSendMerchantsCommand(payload);
                default:
                    return { success: false, reason: 'UNKNOWN_COMMAND' };
            }
        }

        const aiPlayers = gameState.players.filter(player => player.id.startsWith('ai_'));
        const archetypes = Object.keys(personality.archetypes || {});
        const estadoProteccionPrevioPorJugador = new Map(
            aiPlayers.map(player => [player.id, Boolean(player.isUnderProtection)]),
        );
        const salidaProteccionPrincipiantePorJugador = {};

        aiPlayers.forEach((player, index) => {
            const archetype = archetypes[index % archetypes.length] || archetypes[0];
            const controller = new AIController(
                player.id,
                personality,
                player.race,
                archetype,
                handleAICommand,
                config,
                'Pesadilla',
            );

            const aiPlayerState = gameState.aiState[player.id] || {};
            gameState.aiState[player.id] = aiPlayerState;
            controller.init(gameState, aiPlayerState);
            aiControllers.push(controller);
        });

        let lastTick = simulatedNow;
        const aiVillageIds = gameState.villages
            .filter(village => village.ownerId.startsWith('ai_') && village.race === profile.aiRace)
            .map(village => village.id);

        const phaseHistoryByVillage = {};
        const lastPhaseByVillage = new Map();
        const lastPhaseChangeTickByVillage = new Map();
        const unitsAtPhaseChange = {};
        const blockageStatsByVillage = {};

        aiVillageIds.forEach(villageId => {
            phaseHistoryByVillage[villageId] = [];
            unitsAtPhaseChange[villageId] = createEmptyTrackedUnits();
            blockageStatsByVillage[villageId] = {
                blockedTicks: 0,
                longestBlockedStreakTicks: 0,
                currentBlockedStreakTicks: 0,
                blockedByReason: {},
                blockedByStepType: {},
                blockedBySource: {},
                likelyStalls: [],
            };
        });

        let completedAtTick = null;

        for (let tick = 1; tick <= maxTicks; tick += 1) {
            simulatedNow += TICK_MS;
            const currentTime = simulatedNow;

            villageProcessors.forEach(processor => {
                const notifications = processor.update(currentTime, lastTick);
                notifications.forEach(notification => {
                    aiControllers.forEach(controller => controller.handleGameNotification(notification, gameState));
                });
            });

            processMovementsStep({
                gameState,
                currentTime,
                aiControllers,
                maxReports: MAX_REPORTS,
                postMessage: () => {},
                createCombatEngine: () => new CombatEngine(gameState, config),
                updateAIProfiles: () => {},
                registerOasisAttack: ({ tile, currentTime: attackTime }) => {
                    registerOasisAttackStep({ tile, currentTime: attackTime, gameData });
                },
                logMovement: () => {},
                handlers: {
                    reinforcement: handleReinforcementArrival,
                    settle: handleSettleArrival,
                    return: handleReturnArrival,
                    trade: handleTradeArrival,
                    tradeReturn: () => {},
                },
            });

            processOasisRegenerationStep({
                gameState,
                currentTime,
                gameData,
                gameSpeed: config.gameSpeed,
            });

            updatePlayerProtectionStatus(gameState);

            aiPlayers.forEach(player => {
                const estadoPrevio = estadoProteccionPrevioPorJugador.get(player.id);
                const estadoActual = Boolean(player.isUnderProtection);

                if (estadoPrevio && !estadoActual && !salidaProteccionPrincipiantePorJugador[player.id]) {
                    const aldeasJugador = gameState.villages.filter(village => village.ownerId === player.id);
                    const poblacionTotal = aldeasJugador.reduce((sum, village) => sum + (village.population?.current || 0), 0);
                    const poblacionPorAldea = aldeasJugador.reduce((acc, village) => {
                        acc[village.id] = Math.max(0, Number(village.population?.current) || 0);
                        return acc;
                    }, {});

                    salidaProteccionPrincipiantePorJugador[player.id] = {
                        tickSalida: tick,
                        tiempoRealSalida: getReadableGameTime(tick * TICK_MS),
                        tiempoJuegoSalida: getReadableGameTime((tick * TICK_MS) * config.gameSpeed),
                        poblacionTotalJugadorAlSalir: poblacionTotal,
                        poblacionPorAldeaAlSalir: poblacionPorAldea,
                    };
                }

                estadoProteccionPrevioPorJugador.set(player.id, estadoActual);
            });

            aiControllers.forEach(controller => {
                controller.makeDecision(gameState);
                gameState.aiState[controller.getOwnerId()] = controller.getState();
            });

            aiControllers.forEach(controller => {
                const ownerId = controller.getOwnerId();
                const state = gameState.aiState[ownerId] || {};
                const phaseStateByVillage = state[profile.phaseStateKey] || {};

                Object.entries(phaseStateByVillage).forEach(([villageId, phaseState]) => {
                    if (!aiVillageIds.includes(villageId)) return;

                    const phaseId = phaseState?.activePhaseId || null;
                    if (!phaseId) return;

                    const blockage = blockageStatsByVillage[villageId];
                    const activeSubGoal = phaseState?.activeSubGoal || null;
                    if (activeSubGoal) {
                        blockage.blockedTicks += 1;
                        blockage.currentBlockedStreakTicks += 1;
                        blockage.longestBlockedStreakTicks = Math.max(
                            blockage.longestBlockedStreakTicks,
                            blockage.currentBlockedStreakTicks,
                        );

                        const reasonKey = activeSubGoal.reason || 'UNKNOWN';
                        const sourceKey = activeSubGoal.source || 'UNKNOWN';
                        const stepTypeKey = activeSubGoal.blockedStep?.type || 'UNKNOWN';
                        blockage.blockedByReason[reasonKey] = (blockage.blockedByReason[reasonKey] || 0) + 1;
                        blockage.blockedBySource[sourceKey] = (blockage.blockedBySource[sourceKey] || 0) + 1;
                        blockage.blockedByStepType[stepTypeKey] = (blockage.blockedByStepType[stepTypeKey] || 0) + 1;

                        if (blockage.currentBlockedStreakTicks === PHASE_BLOCK_STALL_TICK_THRESHOLD) {
                            blockage.likelyStalls.push({
                                tick,
                                nombreFase: obtenerNombreFaseEs(phaseId),
                                razon: TRADUCCION_RAZON_BLOQUEO[reasonKey] || reasonKey,
                                origen: TRADUCCION_ORIGEN_BLOQUEO[sourceKey] || sourceKey,
                                tipoPasoBloqueado: TRADUCCION_TIPO_PASO[stepTypeKey] || stepTypeKey,
                                intentos: activeSubGoal.attempts || 0,
                                tiempoReal: getReadableGameTime(tick * TICK_MS),
                            });
                        }
                    } else {
                        blockage.currentBlockedStreakTicks = 0;
                    }

                    const previousPhaseId = lastPhaseByVillage.get(villageId);
                    if (previousPhaseId === phaseId) return;

                    const village = gameState.villages.find(c => c.id === villageId);
                    const unitsAtNewPhase = createTrackedUnitSnapshot(village);
                    const unitsAtOldPhase = unitsAtPhaseChange[villageId] || {};
                    const recruitedSincePhaseChange = subtractTrackedUnitSnapshots(unitsAtNewPhase, unitsAtOldPhase);

                    lastPhaseByVillage.set(villageId, phaseId);
                    lastPhaseChangeTickByVillage.set(villageId, tick);
                    unitsAtPhaseChange[villageId] = unitsAtNewPhase;

                    phaseHistoryByVillage[villageId].push({
                        tick,
                        tiempoReal: getReadableRealTime(tick * TICK_MS, config.gameSpeed),
                        tiempoJuego: getReadableGameTime((tick * TICK_MS) * config.gameSpeed),
                        nombreFase: obtenerNombreFaseEs(phaseId),
                        unidadesReclutadas: traducirUnidades(recruitedSincePhaseChange),
                        unidadesReclutadasInterno: recruitedSincePhaseChange,
                    });
                });
            });

            const allDone = aiVillageIds.every(villageId => lastPhaseByVillage.get(villageId) === profile.phaseDoneId);
            if (allDone) {
                completedAtTick = tick;
                break;
            }

            lastTick = currentTime;
        }

        const finalVillageState = aiVillageIds.map(villageId => {
            const finalPhase = lastPhaseByVillage.get(villageId) || null;
            const lastChangeTick = lastPhaseChangeTickByVillage.get(villageId) || 0;
            const village = gameState.villages.find(candidate => candidate.id === villageId);
            const phaseStateByVillage = gameState.aiState[village?.ownerId || '']?.[profile.phaseStateKey] || {};
            const resolvedPhaseState = phaseStateByVillage[villageId] || {};
            const cycleProgress = resolvedPhaseState.phaseCycleProgress || {};
            const history = phaseHistoryByVillage[villageId] || [];

            const recruitmentByCompletedPhase = {};
            for (let index = 1; index < history.length; index += 1) {
                const completedPhaseId = history[index - 1]?.nombreFase;
                if (!completedPhaseId) continue;
                recruitmentByCompletedPhase[completedPhaseId] = history[index]?.unidadesReclutadasInterno || createEmptyTrackedUnits();
            }

            const cycleProgressByPhase = {};
            const cycleAccounting = {};

            CYCLE_PROGRESS_PHASE_KEYS.forEach(phaseKey => {
                const phaseCycles = cycleProgress[phaseKey] || {};
                const progressEntry = {
                    total: msToCycles(phaseCycles.totalMs),
                };
                const accountingEntry = {
                    total: createCycleAccounting(phaseCycles.totalMs),
                };

                Object.entries(CYCLE_BUCKET_OUTPUT_BY_MS_KEY).forEach(([msKey, outputKey]) => {
                    progressEntry[outputKey] = msToCycles(phaseCycles[msKey]);
                    accountingEntry[outputKey] = createCycleAccounting(phaseCycles[msKey]);
                });

                cycleProgressByPhase[phaseKey] = progressEntry;
                cycleAccounting[phaseKey] = accountingEntry;
            });

            const phaseDurations = history.map((entry, index) => {
                const nextTick = history[index + 1]?.tick || (completedAtTick || maxTicks);
                const durationTicks = Math.max(0, nextTick - entry.tick);
                const durationRealMs = durationTicks * TICK_MS;
                return {
                    nombreFase: entry.nombreFase,
                    tickInicio: entry.tick,
                    tickFin: nextTick,
                    duracionTicks: durationTicks,
                    duracionTiempoRealMs: durationRealMs,
                    duracionTiempoReal: getReadableGameTime(durationRealMs),
                    duracionTiempoJuego: getReadableGameTime(durationRealMs * config.gameSpeed),
                };
            });

            const totalUnitsByTypeInCompletedPhases = Object.values(recruitmentByCompletedPhase)
                .reduce((sum, snapshot) => addTrackedUnitSnapshots(sum, snapshot), createEmptyTrackedUnits());

            const cycleValidation = Object.entries(CYCLE_PHASE_ID_TO_KEY)
                .reduce((acc, [phaseId, phaseKey]) => {
                    const cyclesCompleted = Number(cycleProgressByPhase[phaseKey]?.total || 0);
                    const unitsSnapshot = recruitmentByCompletedPhase[obtenerNombreFaseEs(phaseId)] || createEmptyTrackedUnits();
                    const unitsTotal = getTrackedUnitsTotal(unitsSnapshot);
                    const unitsPerCycleAvg = cyclesCompleted > 0 ? (unitsTotal / cyclesCompleted) : 0;
                    const reconstructedUnitsTotal = unitsPerCycleAvg * cyclesCompleted;

                    const unitsByType = TRACKED_UNIT_IDS.reduce((byType, unitId) => {
                        const nombreUnidad = NOMBRE_UNIDAD_ES[unitId] || unitId;
                        const total = Number(unitsSnapshot[unitId]) || 0;
                        const averagePerCycle = cyclesCompleted > 0 ? (total / cyclesCompleted) : 0;
                        const reconstructedTotal = averagePerCycle * cyclesCompleted;
                        byType[nombreUnidad] = {
                            total,
                            promedioPorCiclo: Number(averagePerCycle.toFixed(3)),
                            totalReconstruido: Number(reconstructedTotal.toFixed(3)),
                            diferencia: Number((reconstructedTotal - total).toFixed(6)),
                        };
                        return byType;
                    }, {});

                    const claveSalida = phaseKey.replace('phase', 'fase');
                    acc[claveSalida] = {
                        nombreFase: obtenerNombreFaseEs(phaseId),
                        ciclosCompletados: cyclesCompleted,
                        unidadesTotales: unitsTotal,
                        promedioUnidadesPorCiclo: Number(unitsPerCycleAvg.toFixed(3)),
                        verificacionMultiplicacion: {
                            formula: 'ciclosCompletados * promedioUnidadesPorCiclo',
                            totalUnidadesReconstruido: Number(reconstructedUnitsTotal.toFixed(3)),
                            diferencia: Number((reconstructedUnitsTotal - unitsTotal).toFixed(6)),
                        },
                        unidadesPorTipo: unitsByType,
                    };
                    return acc;
                }, {});

            const totalUnitsByTypeInCyclePhases = CYCLE_AGGREGATE_PHASE_KEYS.reduce((sum, phaseKey) => {
                const claveSalida = phaseKey.replace('phase', 'fase');
                return addTrackedUnitSnapshots(sum, cycleValidation[claveSalida]?.unidadesPorTipo
                ? TRACKED_UNIT_IDS.reduce((snapshot, unitId) => {
                    const nombreUnidad = NOMBRE_UNIDAD_ES[unitId] || unitId;
                    snapshot[unitId] = cycleValidation[claveSalida].unidadesPorTipo[nombreUnidad].total;
                    return snapshot;
                }, createEmptyTrackedUnits())
                : createEmptyTrackedUnits());
            }, createEmptyTrackedUnits());

            const progresoCiclosPorFaseSalida = CYCLE_PROGRESS_PHASE_KEYS.reduce((acc, phaseKey) => {
                acc[phaseKey.replace('phase', 'fase')] = cycleProgressByPhase[phaseKey] || { total: 0 };
                return acc;
            }, {});

            const contabilidadCiclosPorFaseSalida = CYCLE_PROGRESS_PHASE_KEYS.reduce((acc, phaseKey) => {
                acc[phaseKey.replace('phase', 'fase')] = cycleAccounting[phaseKey] || { total: createCycleAccounting(0) };
                return acc;
            }, {});

            const ownerId = village?.ownerId || null;
            const jugador = ownerId ? gameState.players.find(player => player.id === ownerId) : null;
            const salidaProteccion = ownerId ? salidaProteccionPrincipiantePorJugador[ownerId] : null;
            const faseAlSalirProteccion = salidaProteccion
                ? obtenerNombreFaseEnTick(history, salidaProteccion.tickSalida)
                : null;
            const poblacionAldeaAlSalir = salidaProteccion && villageId in (salidaProteccion.poblacionPorAldeaAlSalir || {})
                ? salidaProteccion.poblacionPorAldeaAlSalir[villageId]
                : null;

            return {
                idAldea: villageId,
                nombreFaseFinal: obtenerNombreFaseEs(finalPhase),
                completada: finalPhase === profile.phaseDoneId,
                ticksDesdeUltimoCambioDeFase: maxTicks - lastChangeTick,
                proteccionPrincipiante: {
                    bajoProteccionActualmente: Boolean(jugador?.isUnderProtection),
                    salioDeProteccion: Boolean(salidaProteccion),
                    tickSalida: salidaProteccion?.tickSalida || null,
                    tiempoRealSalida: salidaProteccion?.tiempoRealSalida || null,
                    tiempoJuegoSalida: salidaProteccion?.tiempoJuegoSalida || null,
                    faseAlSalir: faseAlSalirProteccion,
                    habitantesJugadorAlSalir: salidaProteccion?.poblacionTotalJugadorAlSalir || null,
                    habitantesAldeaAlSalir: poblacionAldeaAlSalir,
                },
                historial: history.map(({ unidadesReclutadasInterno, ...entradaPublica }) => entradaPublica),
                duracionesPorFase: phaseDurations,
                diagnosticos: village ? {
                    promedioCamposRecursos: Number(getAverageResourceFieldLevel(village).toFixed(2)),
                    nivelesEdificios: {
                        edificioPrincipal: getMaxBuildingLevelByType(village, 'mainBuilding'),
                        cuartel: getMaxBuildingLevelByType(village, 'barracks'),
                        academia: getMaxBuildingLevelByType(village, 'academy'),
                        herreria: getMaxBuildingLevelByType(village, 'smithy'),
                        establo: getMaxBuildingLevelByType(village, 'stable'),
                        almacen: getMaxBuildingLevelByType(village, 'warehouse'),
                        granero: getMaxBuildingLevelByType(village, 'granary'),
                        mercado: getMaxBuildingLevelByType(village, 'marketplace'),
                        muralla: getMaxBuildingLevelByType(village, 'cityWall'),
                        embajada: getMaxBuildingLevelByType(village, 'embassy'),
                        palacio: getMaxBuildingLevelByType(village, 'palace'),
                        taller: getMaxBuildingLevelByType(village, 'workshop'),
                        mansionHeroe: getMaxBuildingLevelByType(village, 'heroMansion'),
                        molino: getMaxBuildingLevelByType(village, 'grainMill'),
                    },
                    recursos: {
                        madera: Math.floor(village.resources?.wood?.current || 0),
                        barro: Math.floor(village.resources?.stone?.current || 0),
                        hierro: Math.floor(village.resources?.iron?.current || 0),
                        cereal: Math.floor(village.resources?.food?.current || 0),
                    },
                    presupuesto: {
                        economia: {
                            madera: Math.floor(village.budget?.econ?.wood || 0),
                            barro: Math.floor(village.budget?.econ?.stone || 0),
                            hierro: Math.floor(village.budget?.econ?.iron || 0),
                            cereal: Math.floor(village.budget?.econ?.food || 0),
                        },
                        militar: {
                            madera: Math.floor(village.budget?.mil?.wood || 0),
                            barro: Math.floor(village.budget?.mil?.stone || 0),
                            hierro: Math.floor(village.budget?.mil?.iron || 0),
                            cereal: Math.floor(village.budget?.mil?.food || 0),
                        },
                    },
                    investigacionesCompletadas: traducirListaUnidades(village.research?.completed || []),
                    mejorasHerreria: traducirMapaUnidades(village.smithy?.upgrades || {}),
                    largoColaHerreria: village.smithy?.queue?.length || 0,
                    progresoCiclos: progresoCiclosPorFaseSalida,
                    contabilidadCiclos: contabilidadCiclosPorFaseSalida,
                    totalesReclutamiento: {
                        unidadesActualesEnAldeaPorTipo: traducirUnidades(createTrackedUnitSnapshot(village)),
                        reclutadasEnFasesCompletadasPorTipo: traducirUnidades(totalUnitsByTypeInCompletedPhases),
                        reclutadasEnFasesConCiclosPorTipo: traducirUnidades(totalUnitsByTypeInCyclePhases),
                        reclutadasEnFasesConCiclosTotal: getTrackedUnitsTotal(totalUnitsByTypeInCyclePhases),
                    },
                    validacionCiclos: cycleValidation,
                    analisisBloqueos: {
                        ticksBloqueados: blockageStatsByVillage[villageId].blockedTicks,
                        tiempoRealBloqueado: getReadableGameTime(blockageStatsByVillage[villageId].blockedTicks * TICK_MS),
                        rachaBloqueoMasLargaTicks: blockageStatsByVillage[villageId].longestBlockedStreakTicks,
                        rachaBloqueoMasLargaTiempoReal: getReadableGameTime(blockageStatsByVillage[villageId].longestBlockedStreakTicks * TICK_MS),
                        bloqueosPorRazon: traducirMapaDeBloqueos(blockageStatsByVillage[villageId].blockedByReason, TRADUCCION_RAZON_BLOQUEO),
                        bloqueosPorTipoPaso: traducirMapaDeBloqueos(blockageStatsByVillage[villageId].blockedByStepType, TRADUCCION_TIPO_PASO),
                        bloqueosPorOrigen: traducirMapaDeBloqueos(blockageStatsByVillage[villageId].blockedBySource, TRADUCCION_ORIGEN_BLOQUEO),
                        posiblesEstancamientos: blockageStatsByVillage[villageId].likelyStalls,
                        tuvoPosibleEstancamiento: blockageStatsByVillage[villageId].likelyStalls.length > 0,
                    },
                    subobjetivoActivo: resolvedPhaseState.activeSubGoal
                        ? {
                            tipo: resolvedPhaseState.activeSubGoal.kind,
                            razon: TRADUCCION_RAZON_BLOQUEO[resolvedPhaseState.activeSubGoal.reason] || resolvedPhaseState.activeSubGoal.reason,
                            origen: TRADUCCION_ORIGEN_BLOQUEO[resolvedPhaseState.activeSubGoal.source] || resolvedPhaseState.activeSubGoal.source,
                            tipoCola: resolvedPhaseState.activeSubGoal.queueType,
                            tipoPasoBloqueado: TRADUCCION_TIPO_PASO[resolvedPhaseState.activeSubGoal.blockedStep?.type] || resolvedPhaseState.activeSubGoal.blockedStep?.type || null,
                            tipoUnidadBloqueada: resolvedPhaseState.activeSubGoal.blockedStep?.unitType || null,
                            tipoEdificioBloqueado: resolvedPhaseState.activeSubGoal.blockedStep?.buildingType || null,
                            intentos: resolvedPhaseState.activeSubGoal.attempts,
                        }
                        : null,
                } : null,
            };
        });

        return {
            configuracion: {
                tribuIA: profile.aiRace,
                velocidadJuego: config.gameSpeed,
                maximoTicks: maxTicks,
                duracionTickMs: TICK_MS,
                tiempoJuegoSimulado: getReadableGameTime((Math.min(completedAtTick || maxTicks, maxTicks) * TICK_MS) * config.gameSpeed),
            },
            completadoEnTick: completedAtTick,
            completada: completedAtTick !== null,
            aldeas: finalVillageState,
        };
    } finally {
        Date.now = originalDateNow;
        console.log = originalConsoleLog;
        console.info = originalConsoleInfo;
        console.warn = originalConsoleWarn;
        console.debug = originalConsoleDebug;
    }
}

function parsePositiveInt(value, fallback) {
    return Number.isFinite(Number(value)) ? Math.max(1, Math.floor(Number(value))) : fallback;
}

function parseCliArgs(argv) {
    const args = argv.slice(2);
    const arg1 = args[0];

    if (arg1 === '--help' || arg1 === '-h') {
        return { help: true };
    }

    const oldStyle = !arg1 || Number.isFinite(Number(arg1));
    if (oldStyle) {
        return {
            simRace: 'germans',
            maxTicks: parsePositiveInt(args[0], 3000),
            gameSpeed: parsePositiveInt(args[1], 5000),
            quiet: args[2] !== 'verbose',
        };
    }

    const normalizedRace = normalizeSimRace(arg1);
    if (!normalizedRace) {
        throw new Error(`Tribu no valida: ${arg1}. Usa germanos/germans o egipcios/egyptians.`);
    }

    return {
        simRace: normalizedRace,
        gameSpeed: parsePositiveInt(args[1], 5000),
        maxTicks: parsePositiveInt(args[2], 3000),
        quiet: args[3] !== 'verbose',
    };
}

const cli = parseCliArgs(process.argv);

if (cli.help) {
    console.log([
        'Uso nuevo:',
        '  node scripts/ai/simulate-phases.mjs <tribu> <velocidad> <maxTicks> [verbose]',
        'Ejemplos:',
        '  node scripts/ai/simulate-phases.mjs germanos 5000 150000',
        '  node scripts/ai/simulate-phases.mjs egipcios 500 120000 verbose',
        '',
        'Compatibilidad (formato antiguo):',
        '  node scripts/ai/simulate-german-phases.mjs <maxTicks> <velocidad> [verbose]',
    ].join('\n'));
    process.exit(0);
}

const result = runSimulation(cli);

console.log(JSON.stringify(result, null, 2));

if (!result.completada) {
    process.exitCode = 2;
}
