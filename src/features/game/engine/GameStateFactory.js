// RUTA: js/engine/GameStateFactory.js
import { gameData } from '../core/GameData.js';
import { generateLayout, generateVillageCenterLayout } from '../core/LayoutManager.js';
import { DEFAULT_MAP_SIZE, generateMapData, normalizeMapSize } from '../core/map/mapGenerator.js';
import { analyzeMapDistribution } from '../core/map/mapValidator.js';
import {
    FARM_LIST_LIMITS,
    getOasisSpeedMultiplier,
    isUnderBeginnerProtectionByPopulation,
    resolveDefaultFarmTroops,
} from '../core/data/constants.js';
import { scaleCapacityByGameSpeed } from '../core/capacityScaling.js';
import { createNpcExchangeState } from '../core/npcExchange.js';

const MIN_VILLAGE_DISTANCE = 5;
const PLAYER_SPAWN_RADIUS = 5;
const STARTING_RESOURCES_BASE_CAPACITY_RATIO = 0.9;

function getInitialOasisBeastAmount(spawnMin, gameSpeed) {
    const speedMultiplier = getOasisSpeedMultiplier(gameSpeed);
    return Math.max(1, Math.floor(spawnMin * speedMultiplier));
}

function getInitialOasisBeastCap(oasisTypeData, gameSpeed) {
    if (!oasisTypeData || !Array.isArray(oasisTypeData.beastSpawnTable)) {
        return 0;
    }

    return oasisTypeData.beastSpawnTable.reduce((sum, spawn) => {
        return sum + getInitialOasisBeastAmount(spawn.min, gameSpeed);
    }, 0);
}

function createDefaultRecruitmentExchangeKpi() {
    return {
        attempts: 0,
        activations: 0,
        skippedByProbability: 0,
        skippedNoEfficiencyGain: 0,
        skippedNoBudget: 0,
        totalPotentialUnitGain: 0,
        lastAttemptAt: null,
        lastActivationAt: null,
        byUnit: {},
    };
}

function createEmptyFarmListsOwnerState() {
    return { lists: [] };
}

function createFarmListsByOwnerId(players) {
    const farmListsByOwnerId = {};
    const safePlayers = Array.isArray(players) ? players : [];
    safePlayers.forEach(player => {
        if (typeof player?.id === 'string' && player.id.length > 0) {
            farmListsByOwnerId[player.id] = createEmptyFarmListsOwnerState();
        }
    });
    return farmListsByOwnerId;
}

function normalizeFarmListTimestamp(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function normalizeFarmListTargetCoords(targetCoords) {
    const x = Number(targetCoords?.x);
    const y = Number(targetCoords?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: Math.trunc(x), y: Math.trunc(y) };
}

function normalizeFarmListTroops(troops, race) {
    const allowedUnitIds = new Set(
        (gameData.units?.[race]?.troops || [])
            .filter(unit => unit?.id && unit.type !== 'merchant')
            .map(unit => unit.id),
    );

    const normalizedTroops = {};
    if (troops && typeof troops === 'object' && !Array.isArray(troops)) {
        Object.entries(troops).forEach(([unitId, amount]) => {
            const normalizedAmount = Math.floor(Number(amount));
            if (!unitId || !allowedUnitIds.has(unitId) || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) return;
            normalizedTroops[unitId] = normalizedAmount;
        });
    }

    if (Object.keys(normalizedTroops).length > 0) {
        return normalizedTroops;
    }

    return resolveDefaultFarmTroops(race);
}

function normalizeFarmListDispatchMap(lastDispatchAtByOrigin) {
    const normalizedDispatchMap = {};
    if (!lastDispatchAtByOrigin || typeof lastDispatchAtByOrigin !== 'object' || Array.isArray(lastDispatchAtByOrigin)) {
        return normalizedDispatchMap;
    }

    Object.entries(lastDispatchAtByOrigin).forEach(([originVillageId, timestamp]) => {
        if (!originVillageId) return;
        const normalizedTimestamp = Number(timestamp);
        if (!Number.isFinite(normalizedTimestamp) || normalizedTimestamp < 0) return;
        normalizedDispatchMap[originVillageId] = Math.floor(normalizedTimestamp);
    });

    return normalizedDispatchMap;
}

function normalizeFarmListEntry(entry, entryIndex, race) {
    if (!entry || typeof entry !== 'object') return null;
    const targetCoords = normalizeFarmListTargetCoords(entry.targetCoords);
    if (!targetCoords) return null;

    return {
        id: (typeof entry.id === 'string' && entry.id.length > 0) ? entry.id : `entry_${entryIndex + 1}`,
        targetType: entry.targetType === 'oasis' ? 'oasis' : 'village',
        targetCoords,
        troops: normalizeFarmListTroops(entry.troops, race),
        lastDispatchAtByOrigin: normalizeFarmListDispatchMap(entry.lastDispatchAtByOrigin),
    };
}

function normalizeFarmList(list, listIndex, race) {
    const safeNow = Date.now();
    const createdAt = normalizeFarmListTimestamp(list?.createdAt, safeNow);
    const updatedAt = normalizeFarmListTimestamp(list?.updatedAt, createdAt);
    const maxEntriesPerList = Math.max(1, Math.floor(Number(FARM_LIST_LIMITS.maxEntriesPerList) || 100));
    const normalizedEntries = [];
    const seenTargetCoords = new Set();
    const seenEntryIds = new Set();
    const rawEntries = Array.isArray(list?.entries) ? list.entries : [];

    rawEntries.forEach((entry, entryIndex) => {
        if (normalizedEntries.length >= maxEntriesPerList) return;

        const normalizedEntry = normalizeFarmListEntry(entry, entryIndex, race);
        if (!normalizedEntry) return;

        const coordKey = `${normalizedEntry.targetCoords.x}|${normalizedEntry.targetCoords.y}`;
        if (seenTargetCoords.has(coordKey)) return;

        let resolvedEntryId = normalizedEntry.id;
        let entryDisambiguator = 1;
        while (seenEntryIds.has(resolvedEntryId)) {
            resolvedEntryId = `${normalizedEntry.id}_${entryDisambiguator++}`;
        }

        normalizedEntry.id = resolvedEntryId;
        seenEntryIds.add(resolvedEntryId);
        seenTargetCoords.add(coordKey);
        normalizedEntries.push(normalizedEntry);
    });

    return {
        id: (typeof list?.id === 'string' && list.id.length > 0) ? list.id : `farm_list_${listIndex + 1}`,
        name: (typeof list?.name === 'string' && list.name.trim().length > 0) ? list.name.trim() : `Lista ${listIndex + 1}`,
        createdAt,
        updatedAt,
        entries: normalizedEntries,
    };
}

function normalizeFarmListsByOwnerId(source, players) {
    const normalized = createFarmListsByOwnerId(players);
    const safeSource = source && typeof source === 'object' ? source : null;
    const safePlayers = Array.isArray(players) ? players : [];
    const maxListsPerOwner = Math.max(1, Math.floor(Number(FARM_LIST_LIMITS.maxListsPerOwner) || 5));

    safePlayers.forEach(player => {
        const ownerId = player?.id;
        if (!ownerId || !safeSource) return;

        const ownerPayload = safeSource[ownerId];
        const lists = [];
        const seenListIds = new Set();
        const rawLists = Array.isArray(ownerPayload?.lists) ? ownerPayload.lists : [];

        rawLists.forEach((list, listIndex) => {
            if (lists.length >= maxListsPerOwner) return;

            const normalizedList = normalizeFarmList(list, listIndex, player.race);
            if (!normalizedList) return;

            let resolvedListId = normalizedList.id;
            let listDisambiguator = 1;
            while (seenListIds.has(resolvedListId)) {
                resolvedListId = `${normalizedList.id}_${listDisambiguator++}`;
            }

            normalizedList.id = resolvedListId;
            seenListIds.add(resolvedListId);
            lists.push(normalizedList);
        });

        normalized[ownerId] = { lists };
    });

    return normalized;
}

export class GameStateFactory {
    #config;

    constructor(gameConfig) {
        this.#config = gameConfig;
    }
    
    create(sessionId) {
        const { mapData, random, mapSize } = generateMapData({
            seed: this.#config.worldSeed,
            mapSize: this.#getMapSize(),
        });
        const allVillages = [];
        const players = [];
        
        players.push({ id: 'player', race: this.#config.playerRace, isUnderProtection: true });
        
        const spatialIndex = this.#buildSpatialIndex(mapData);

        const { x: playerX, y: playerY, tileIndex: playerTileIndex, valleyType: playerValleyType } = this.#findValidSpawnPoint(mapData, spatialIndex, random, PLAYER_SPAWN_RADIUS);
        
        const playerVillageId = `v_${Date.now()}`;
        allVillages.push(this.createVillageObject(
            playerVillageId,
            'Nueva Aldea',
            this.#config.playerRace,
            'player',
            { x: playerX, y: playerY },
            playerValleyType || '4-4-4-6',
            { startResourcesFromBaseCapacityRatio: STARTING_RESOURCES_BASE_CAPACITY_RATIO },
        ));
        
        mapData[playerTileIndex] = {
            x: playerX,
            y: playerY,
            type: 'village',
            villageId: playerVillageId,
            ownerId: 'player',
            race: this.#config.playerRace,
            terrainVariant: mapData[playerTileIndex]?.terrainVariant,
        };
        spatialIndex.set(`${playerX}|${playerY}`, mapData[playerTileIndex]);

        for (let i = 0; i < this.#config.aiCount; i++) {
            const aiRace = this.#config.aiRaces[i] || 'germans';
            const ownerId = `ai_${i}`;
            players.push({ id: ownerId, race: aiRace, isUnderProtection: true });

            const { x: aiX, y: aiY, tileIndex: aiTileIndex, valleyType: aiValleyType } = this.#findValidSpawnPoint(mapData, spatialIndex, random);
            const aiVillageId = `v_ai_${i}_${Date.now()}`;

            allVillages.push(this.createVillageObject(
                aiVillageId,
                `Aldea IA ${i + 1}`,
                aiRace,
                ownerId,
                { x: aiX, y: aiY },
                aiValleyType || '4-4-4-6',
                { startResourcesFromBaseCapacityRatio: STARTING_RESOURCES_BASE_CAPACITY_RATIO },
            ));
            mapData[aiTileIndex] = {
                x: aiX,
                y: aiY,
                type: 'village',
                villageId: aiVillageId,
                ownerId: ownerId,
                race: aiRace,
                terrainVariant: mapData[aiTileIndex]?.terrainVariant,
            };
            spatialIndex.set(`${aiX}|${aiY}`, mapData[aiTileIndex]);
        }
        
        mapData.forEach(tile => {
            if (tile.type === 'oasis') {
                const oasisTypeData = gameData.oasisTypes[tile.oasisType];
                tile.state = {
                    beasts: {},
                    isClearedOnce: false,
                    maxBeasts: getInitialOasisBeastCap(oasisTypeData, this.#config.gameSpeed),
                    pressure: { recentAttacks: [], current: 0 },
                };
                oasisTypeData.beastSpawnTable.forEach(spawn => {
                    tile.state.beasts[spawn.unitId] = getInitialOasisBeastAmount(spawn.min, this.#config.gameSpeed);
                });
            }
        });

        const newGameState = {
            startedAt: Date.now(),
            sessionId: sessionId, worldSeed: this.#config.worldSeed, mapSize, mapStats: analyzeMapDistribution(mapData), villages: allVillages, players, activeVillageId: playerVillageId, mapData,
            movements: [], reports: [], unreadCounts: {}, diplomacy: { relations: {} },
            alliance: { id: null, name: null, bonuses: { productionBonusPercent: 0, constructionTimeBonusPercent: 0 } }, aiState: {},
            farmListsByOwnerId: createFarmListsByOwnerId(players),
            lastOasisRegenTime: Date.now(),
            memory: { log: [] },
            aiProfiles: new Map(),
            spatialIndex: spatialIndex
        };
        newGameState.players.forEach(p => newGameState.unreadCounts[p.id] = 0);
        return newGameState;
    }    

    loadAndValidate(savedState, sessionId) {
        if (!savedState.villages || !Array.isArray(savedState.villages)) return this.create(sessionId);
        if (!savedState.players || !savedState.players.length) {
            savedState.players = [];
            [...new Set(savedState.villages.map(v => v.ownerId))].forEach(id => {
                savedState.players.push({ id: id, race: savedState.villages.find(v => v.ownerId === id).race });
            });
        }
        savedState.players.forEach(player => {
            player.race ??= savedState.villages.find(v => v.ownerId === player.id)?.race ?? 'germans';
            if (player.isUnderProtection === undefined) {
                const totalPopulation = savedState.villages
                    .filter(v => v.ownerId === player.id)
                    .reduce((sum, v) => sum + (v.population?.current || 0), 0);
                player.isUnderProtection = isUnderBeginnerProtectionByPopulation(totalPopulation);
            }
        });
        savedState.villages.forEach(village => {
            village.research ??= { completed: [], queue: [] };
            village.smithy ??= { upgrades: {}, queue: [] };
            village.settlementsFounded ??= 0;
            village.maxConstructionSlots ??= (village.race === 'romans' ? 3 : 2);
            village.recruitmentQueue ??= [];
            village.constructionQueue ??= [];
            village.demolitionUnlocked ??= (village.buildings?.find(b => b.type === 'mainBuilding')?.level || 0) >= 10;
            village.npcExchange ??= createNpcExchangeState();
            village.unitsInVillage ??= {};
    village.reinforcements ??= [];
    village.oases ??= [];
    village.merchantsBusy ??= 0;
            village.population ??= { current: 0, foodConsumption: 0 };
            village.villageType ??= '4-4-4-6';
            village.race ??= savedState.players.find(p => p.id === village.ownerId)?.race;
            
            // Asegurar estructura de presupuesto si es IA
            if (village.ownerId.startsWith('ai_')) {
                village.budget ??= {
                    econ: { wood: 0, stone: 0, iron: 0, food: 0 },
                    mil: { wood: 0, stone: 0, iron: 0, food: 0 }
                };
                village.aiRecruitmentExchangeKpi ??= createDefaultRecruitmentExchangeKpi();
            }
        });
        if (savedState.unreadReports !== undefined && savedState.unreadCounts === undefined) {
            savedState.unreadCounts = {};
            savedState.players.forEach(p => savedState.unreadCounts[p.id] = 0);
            savedState.unreadCounts['player'] = savedState.unreadReports;
            delete savedState.unreadReports;
        }
        savedState.alliance ??= { id: null, name: null, bonuses: { productionBonusPercent: 0, constructionTimeBonusPercent: 0 } };
        savedState.movements ??= [];
        savedState.reports ??= [];
        savedState.unreadCounts ??= {};
        savedState.diplomacy ??= { relations: {} };
        savedState.aiState ??= {};
        savedState.farmListsByOwnerId = normalizeFarmListsByOwnerId(savedState.farmListsByOwnerId, savedState.players);
        savedState.startedAt ??= Date.now();
        savedState.lastOasisRegenTime ??= Date.now();
        savedState.memory ??= { log: [] };
        if (savedState.aiProfiles && !(savedState.aiProfiles instanceof Map)) {
            savedState.aiProfiles = new Map(Object.entries(savedState.aiProfiles));
        } else {
            savedState.aiProfiles ??= new Map();
        }
        if (!savedState.activeVillageId) savedState.activeVillageId = savedState.villages.find(v => v.ownerId === 'player')?.id;
        savedState.mapSize = normalizeMapSize(savedState.mapSize || this.#getMapSize());
        const expectedMapTiles = (savedState.mapSize * 2 + 1) ** 2;
        if (!savedState.mapData || savedState.mapData.length < expectedMapTiles) {
            const { mapData, mapSize } = generateMapData({
                seed: savedState.worldSeed || Date.now().toString(),
                mapSize: savedState.mapSize,
            });
            savedState.mapData = mapData;
            savedState.mapSize = mapSize;
            savedState.villages.forEach(v => {
                const tileIndex = savedState.mapData.findIndex(t => t.x === v.coords.x && t.y === v.coords.y);
                if (tileIndex !== -1) {
                    savedState.mapData[tileIndex] = { x: v.coords.x, y: v.coords.y, type: 'village', villageId: v.id, ownerId: v.ownerId, race: v.race };
                }
            });
            savedState.mapStats = analyzeMapDistribution(savedState.mapData);
        }
        savedState.mapStats ??= analyzeMapDistribution(savedState.mapData);
        
        savedState.spatialIndex = this.#buildSpatialIndex(savedState.mapData);

        savedState.mapData.forEach(tile => {
            if (tile.type === 'oasis' && (!tile.state || !tile.state.beasts)) {
                const oasisTypeData = gameData.oasisTypes[tile.oasisType];
                tile.state = {
                    beasts: {},
                    isClearedOnce: false,
                    maxBeasts: getInitialOasisBeastCap(oasisTypeData, this.#config.gameSpeed),
                };
                oasisTypeData.beastSpawnTable.forEach(spawn => {
                    tile.state.beasts[spawn.unitId] = getInitialOasisBeastAmount(spawn.min, this.#config.gameSpeed);
                });
            }

            if (tile.type === 'oasis' && tile.state) {
                const oasisTypeData = gameData.oasisTypes[tile.oasisType];
                tile.state.maxBeasts ??= getInitialOasisBeastCap(oasisTypeData, this.#config.gameSpeed);
                if (!Number.isFinite(Number(tile.state.maxBeasts)) || Number(tile.state.maxBeasts) < 0) {
                    tile.state.maxBeasts = getInitialOasisBeastCap(oasisTypeData, this.#config.gameSpeed);
                }
                tile.state.maxBeasts = Math.floor(Number(tile.state.maxBeasts));
                tile.state.isClearedOnce ??= false;
                tile.state.pressure ??= { recentAttacks: [], current: 0 };
                tile.state.pressure.recentAttacks ??= [];
                tile.state.pressure.current ??= 0;
            }
        });
        savedState.sessionId = sessionId;
        return savedState;
    }
    
    #buildSpatialIndex(mapData) {
        const index = new Map();
        for (const tile of mapData) {
            index.set(`${tile.x}|${tile.y}`, tile);
        }
        return index;
    }

    #getMapSize() {
        return normalizeMapSize(this.#config.mapSize || DEFAULT_MAP_SIZE);
    }

    createVillageObject(id, name, race, ownerId, coords, villageType, options = {}) {
        const ratio = Number.isFinite(options.startResourcesFromBaseCapacityRatio)
            ? Math.max(0, Math.min(1, options.startResourcesFromBaseCapacityRatio))
            : STARTING_RESOURCES_BASE_CAPACITY_RATIO;
        const baseWarehouseCapacity = gameData.config.initialStorage.warehouse;
        const baseGranaryCapacity = gameData.config.initialStorage.granary;
        const scaledBaseWarehouseCapacity = scaleCapacityByGameSpeed(baseWarehouseCapacity, this.#config.gameSpeed);
        const scaledBaseGranaryCapacity = scaleCapacityByGameSpeed(baseGranaryCapacity, this.#config.gameSpeed);
        const startingWood = Math.floor(scaledBaseWarehouseCapacity * ratio);
        const startingStone = Math.floor(scaledBaseWarehouseCapacity * ratio);
        const startingIron = Math.floor(scaledBaseWarehouseCapacity * ratio);
        const startingFood = Math.floor(scaledBaseGranaryCapacity * ratio);

        const buildings = [];
        const resourceLayout = generateLayout(villageType);
        const typeMap = { 'Wood': 'woodcutter', 'Clay': 'clayPit', 'Iron': 'ironMine', 'Wheat': 'cropland' };
        resourceLayout.forEach(slot => buildings.push({ id: slot.id, type: typeMap[slot.defaultType], level: 0 }));
        
        const villageLayout = generateVillageCenterLayout();
        villageLayout.forEach(slot => {
            if (slot.id === 'v_main') buildings.push({ id: slot.id, type: 'mainBuilding', level: 1 });
            else if (slot.id === 'v_rally_point') buildings.push({ id: slot.id, type: 'rallyPoint', level: 1 });
            else buildings.push({ id: slot.id, type: 'empty', level: 0 });
        });
        buildings.push({ id: 'v_wall', type: 'cityWall', level: 0 });
        
        const village = {
            id, name, race, ownerId, coords, villageType, settlementsFounded: 0, buildings,
            resources: {
                wood: { current: startingWood, production: 0, capacity: 0 },
                stone: { current: startingStone, production: 0, capacity: 0 },
                iron: { current: startingIron, production: 0, capacity: 0 },
                food: { current: startingFood, production: 0, capacity: 0 }
            },
            population: { current: 2, foodConsumption: 2 }, unitsInVillage: {}, reinforcements: [], recruitmentQueue: [], oases: [],
            constructionQueue: [], maxConstructionSlots: race === 'romans' ? 3 : 2, demolitionUnlocked: false,
            research: { completed: [], queue: [] }, smithy: { upgrades: {}, queue: [] }, npcExchange: createNpcExchangeState(), merchantsBusy: 0
        };

        // Inicializar estructura de presupuesto para IA.
        // El reparto por ratio se aplica en el worker durante init.
        if (ownerId.startsWith('ai_')) {
            village.budget = {
                econ: { wood: 0, stone: 0, iron: 0, food: 0 },
                mil: { wood: 0, stone: 0, iron: 0, food: 0 }
            };
            village.aiRecruitmentExchangeKpi = createDefaultRecruitmentExchangeKpi();
        }

        return village;
    }

    #findValidSpawnPoint(mapData, spatialIndex, random, maxRadius = this.#getMapSize()) {
        const candidateSpots = mapData.filter(tile => 
            tile.type === 'valley' && 
            Math.abs(tile.x) <= maxRadius && 
            Math.abs(tile.y) <= maxRadius
        );
    
        const validSpots = candidateSpots.filter(spot => {
            for (let dx = -MIN_VILLAGE_DISTANCE; dx <= MIN_VILLAGE_DISTANCE; dx++) {
                for (let dy = -MIN_VILLAGE_DISTANCE; dy <= MIN_VILLAGE_DISTANCE; dy++) {
                    const nx = spot.x + dx;
                    const ny = spot.y + dy;
                    if (Math.hypot(dx, dy) >= MIN_VILLAGE_DISTANCE) continue;

                    const neighbor = spatialIndex.get(`${nx}|${ny}`);
                    if (neighbor && neighbor.type === 'village') {
                        return false;
                    }
                }
            }
            return true;
        });
    
        if (validSpots.length === 0) {
            throw new Error("No se pudieron encontrar puntos de aparición válidos.");
        }
    
        const randomIndex = Math.floor(random() * validSpots.length);
        const chosenSpot = validSpots[randomIndex];
        const tileIndex = mapData.findIndex(tile => tile.x === chosenSpot.x && tile.y === chosenSpot.y);
    
        return { 
            x: chosenSpot.x, 
            y: chosenSpot.y, 
            tileIndex, 
            valleyType: chosenSpot.valleyType 
        };
    }
}
