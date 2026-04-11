// RUTA: js/engine/GameStateFactory.js
import { gameData } from '../core/GameData.js';
import { generateLayout, generateVillageCenterLayout, TEMPLATES } from '../core/LayoutManager.js';

const MAP_SIZE = 25;
const MIN_VILLAGE_DISTANCE = 5;
const PLAYER_SPAWN_RADIUS = 5;
const OASIS_DENSITY = 0.10;

export class GameStateFactory {
    #config;

    constructor(gameConfig) {
        this.#config = gameConfig;
    }
    
    create(sessionId) {
        const { mapData, random } = this.#generateMapData(this.#config.worldSeed);
        const allVillages = [];
        const players = [];
        
        players.push({ id: 'player', race: this.#config.playerRace, isUnderProtection: true });
        
        const spatialIndex = this.#buildSpatialIndex(mapData);

        const { x: playerX, y: playerY, tileIndex: playerTileIndex, valleyType: playerValleyType } = this.#findValidSpawnPoint(mapData, spatialIndex, random, PLAYER_SPAWN_RADIUS);
        
        const playerVillageId = `v_${Date.now()}`;
        allVillages.push(this.createVillageObject(playerVillageId, 'Nueva Aldea', this.#config.playerRace, 'player', { x: playerX, y: playerY }, '4-4-4-6'));
        
        mapData[playerTileIndex] = { x: playerX, y: playerY, type: 'village', villageId: playerVillageId, ownerId: 'player', race: this.#config.playerRace };
        spatialIndex.set(`${playerX}|${playerY}`, mapData[playerTileIndex]);

        for (let i = 0; i < this.#config.aiCount; i++) {
            const aiRace = this.#config.aiRaces[i] || 'germans';
            const ownerId = `ai_${i}`;
            players.push({ id: ownerId, race: aiRace, isUnderProtection: true });

            const { x: aiX, y: aiY, tileIndex: aiTileIndex, valleyType: randomValleyType } = this.#findValidSpawnPoint(mapData, spatialIndex, random);
            const aiVillageId = `v_ai_${i}_${Date.now()}`;
            
            const finalValleyType = (ownerId === 'ai_0') ? '4-4-4-6' : randomValleyType;
            
            allVillages.push(this.createVillageObject(aiVillageId, `Aldea IA ${i + 1}`, aiRace, ownerId, { x: aiX, y: aiY }, finalValleyType));
            mapData[aiTileIndex] = { x: aiX, y: aiY, type: 'village', villageId: aiVillageId, ownerId: ownerId, race: aiRace };
            spatialIndex.set(`${aiX}|${aiY}`, mapData[aiTileIndex]);
        }
        
        mapData.forEach(tile => {
            if (tile.type === 'oasis') {
                const oasisTypeData = gameData.oasisTypes[tile.oasisType];
                tile.state = {
                    beasts: {},
                    isClearedOnce: false,
                    pressure: { recentAttacks: [], current: 0 },
                };
                oasisTypeData.beastSpawnTable.forEach(spawn => tile.state.beasts[spawn.unitId] = spawn.min);
            }
        });

        const newGameState = {
            startedAt: Date.now(),
            sessionId: sessionId, worldSeed: this.#config.worldSeed, villages: allVillages, players, activeVillageId: playerVillageId, mapData,
            movements: [], reports: [], unreadCounts: {}, diplomacy: { relations: {} },
            alliance: { id: null, name: null, bonuses: { productionBonusPercent: 0, constructionTimeBonusPercent: 0 } }, aiState: {},
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
            if (player.isUnderProtection === undefined) {
                const totalPopulation = savedState.villages
                    .filter(v => v.ownerId === player.id)
                    .reduce((sum, v) => sum + (v.population?.current || 0), 0);
                player.isUnderProtection = totalPopulation < 500;
            }
        });
        savedState.villages.forEach(village => {
            village.research ??= { completed: [], queue: [] };
            village.smithy ??= { upgrades: {}, queue: [] };
            village.settlementsFounded ??= 0;
            village.maxConstructionSlots ??= (village.race === 'romans' ? 3 : 2);
            village.recruitmentQueue ??= [];
            village.constructionQueue ??= [];
            village.unitsInVillage ??= {};
            village.reinforcements ??= [];
            village.population ??= { current: 0, foodConsumption: 0 };
            village.villageType ??= '4-4-4-6';
            village.race ??= savedState.players.find(p => p.id === village.ownerId)?.race;
            
            // Asegurar estructura de presupuesto si es IA
            if (village.ownerId.startsWith('ai_')) {
                village.budget ??= {
                    econ: { wood: 0, stone: 0, iron: 0, food: 0 },
                    mil: { wood: 0, stone: 0, iron: 0, food: 0 }
                };
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
        savedState.startedAt ??= Date.now();
        savedState.lastOasisRegenTime ??= Date.now();
        savedState.memory ??= { log: [] };
        if (savedState.aiProfiles && !(savedState.aiProfiles instanceof Map)) {
            savedState.aiProfiles = new Map(Object.entries(savedState.aiProfiles));
        } else {
            savedState.aiProfiles ??= new Map();
        }
        if (!savedState.activeVillageId) savedState.activeVillageId = savedState.villages.find(v => v.ownerId === 'player')?.id;
        if (!savedState.mapData || savedState.mapData.length < (MAP_SIZE * 2 + 1) * (MAP_SIZE * 2 + 1)) {
            const { mapData } = this.#generateMapData(savedState.worldSeed || Date.now().toString());
            savedState.mapData = mapData;
            savedState.villages.forEach(v => {
                const tileIndex = savedState.mapData.findIndex(t => t.x === v.coords.x && t.y === v.coords.y);
                if (tileIndex !== -1) {
                    savedState.mapData[tileIndex] = { x: v.coords.x, y: v.coords.y, type: 'village', villageId: v.id, ownerId: v.ownerId, race: v.race };
                }
            });
        }
        
        savedState.spatialIndex = this.#buildSpatialIndex(savedState.mapData);

        savedState.mapData.forEach(tile => {
            if (tile.type === 'oasis' && (!tile.state || !tile.state.beasts)) {
                const oasisTypeData = gameData.oasisTypes[tile.oasisType];
                tile.state = { beasts: {}, isClearedOnce: false };
                oasisTypeData.beastSpawnTable.forEach(spawn => tile.state.beasts[spawn.unitId] = spawn.min);
            }

            if (tile.type === 'oasis' && tile.state) {
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

    createVillageObject(id, name, race, ownerId, coords, villageType) {
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
                wood: { current: gameData.config.initialResources.wood, production: 0, capacity: 0 },
                stone: { current: gameData.config.initialResources.stone, production: 0, capacity: 0 },
                iron: { current: gameData.config.initialResources.iron, production: 0, capacity: 0 },
                food: { current: gameData.config.initialResources.food, production: 0, capacity: 0 }
            },
            population: { current: 2, foodConsumption: 2 }, unitsInVillage: {}, reinforcements: [], recruitmentQueue: [],
            constructionQueue: [], maxConstructionSlots: race === 'romans' ? 3 : 2,
            research: { completed: [], queue: [] }, smithy: { upgrades: {}, queue: [] }
        };

        // Inicializar estructura de presupuesto para IA.
        // El reparto por ratio se aplica en el worker durante init.
        if (ownerId.startsWith('ai_')) {
            village.budget = {
                econ: { wood: 0, stone: 0, iron: 0, food: 0 },
                mil: { wood: 0, stone: 0, iron: 0, food: 0 }
            };
        }

        return village;
    }

    #generateMapData(seed) {
        const mapData = [];
        const PROBABILITY_15C = 0.005;
        const PROBABILITY_9C = 0.01;

        function mulberry32(a) {
            return function() {
                let t = a += 0x6D2B79F5;
                t = Math.imul(t ^ t >>> 15, t | 1);
                t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            }
        }

        let seedNum = 0;
        for (let i = 0; i < seed.length; i++) {
            seedNum = (seedNum << 5) - seedNum + seed.charCodeAt(i);
            seedNum |= 0;
        }
        const random = mulberry32(seedNum);
        
        const standardValleyTypes = Object.keys(TEMPLATES).filter(k => k !== '1-1-1-15' && k !== '3-3-3-9');
        
        for (let y = -MAP_SIZE; y <= MAP_SIZE; y++) {
            for (let x = -MAP_SIZE; x <= MAP_SIZE; x++) {
                const rand = random();
                let valleyType;
                if (rand < PROBABILITY_15C) valleyType = '1-1-1-15';
                else if (rand < PROBABILITY_15C + PROBABILITY_9C) valleyType = '3-3-3-9';
                else valleyType = standardValleyTypes[Math.floor(random() * standardValleyTypes.length)];
                
                mapData.push({ x, y, type: 'valley', valleyType });
            }
        }
        
        const specialValleys = mapData.filter(tile => tile.valleyType === '1-1-1-15' || tile.valleyType === '3-3-3-9');
        const tempIndex = new Map();
        mapData.forEach((t, i) => tempIndex.set(`${t.x}|${t.y}`, i));

        specialValleys.forEach(valley => {
            const potentialOasisCoords = [];
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = valley.x + dx;
                    const ny = valley.y + dy;
                    if (nx >= -MAP_SIZE && nx <= MAP_SIZE && ny >= -MAP_SIZE && ny <= MAP_SIZE) {
                        potentialOasisCoords.push({ x: nx, y: ny });
                    }
                }
            }

            for (let i = potentialOasisCoords.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                [potentialOasisCoords[i], potentialOasisCoords[j]] = [potentialOasisCoords[j], potentialOasisCoords[i]];
            }

            for (let i = 0; i < Math.min(3, potentialOasisCoords.length); i++) {
                const coord = potentialOasisCoords[i];
                const tileIndex = tempIndex.get(`${coord.x}|${coord.y}`);
                if (tileIndex !== undefined) {
                    mapData[tileIndex] = { x: coord.x, y: coord.y, type: 'oasis', oasisType: random() < 0.5 ? 'wheat_25' : 'wheat_50' };
                }
            }
        });

        const nonWheatOasisTypes = Object.keys(gameData.oasisTypes).filter(k => !k.startsWith('wheat'));
        mapData.forEach((tile, i) => {
            if (tile.type === 'valley' && tile.valleyType !== '1-1-1-15' && tile.valleyType !== '3-3-3-9') {
                if (random() < OASIS_DENSITY) {
                    const oasisType = nonWheatOasisTypes[Math.floor(random() * nonWheatOasisTypes.length)];
                    mapData[i] = { x: tile.x, y: tile.y, type: 'oasis', oasisType };
                }
            }
        });

        return { mapData, random };
    }

    #findValidSpawnPoint(mapData, spatialIndex, random, maxRadius = MAP_SIZE) {
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
