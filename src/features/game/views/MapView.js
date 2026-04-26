import { gameData } from '../core/GameData.js'
import gameManager from '@game/state/GameManager.js';
import TileInfoUI from '../ui/TileInfoUI.js';
import uiRenderScheduler from '../ui/UIRenderScheduler.js';
import { perfCollector } from '@shared/lib/perf.js';
import { selectMapViewSignature } from '../ui/renderSelectors.js';

const TILE_SIZE = 40;
const DEFAULT_MAP_SIZE = 25;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const CHUNK_SIZE = 10;
const CHUNK_PIXEL_SIZE = TILE_SIZE * CHUNK_SIZE;
const LOD_SCALE_THRESHOLD = 0.7;

const ASSET_PATHS = {
    village: '/icons/village.png',
    compass: '/icons/compass.png',
    wasteland1: '/map/Wasteland_1.webp',
    wasteland2: '/map/Wasteland_2.webp',
    wasteland3: '/map/Wasteland_3.webp',
    wasteland4: '/map/Wasteland_4.webp',
    wasteland5: '/map/Wasteland_5.webp',
    wasteland6: '/map/Wasteland_6.webp',
    lumber25: '/map/Lumber25.webp',
    lumber50: '/map/Lumber50.webp',
    clay25: '/map/Clay25.webp',
    clay50: '/map/Clay50.webp',
    iron25: '/map/Iron25.webp',
    iron50: '/map/Iron50.webp',
    wheat25: '/map/Wheat25.webp',
    wheat50: '/map/Wheat50.webp'
};

const WASTELAND_VARIANT_KEYS = ['wasteland1', 'wasteland2', 'wasteland3', 'wasteland4', 'wasteland5', 'wasteland6'];

const OASIS_TEXTURE_BY_TYPE = {
    wood_25: 'lumber25',
    wood_50: 'lumber50',
    clay_25: 'clay25',
    clay_50: 'clay50',
    iron_25: 'iron25',
    iron_50: 'iron50',
    wheat_25: 'wheat25',
    wheat_50: 'wheat50',
};

function stableHash(x, y) {
    let hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    hash = (hash ^ (hash >>> 13)) >>> 0;
    hash = Math.imul(hash, 1274126177) >>> 0;
    return hash >>> 0;
}

function getWastelandVariantIndex(x, y) {
    const biomeCellSize = 7;
    const biomeX = Math.floor((x + 4096) / biomeCellSize);
    const biomeY = Math.floor((y + 4096) / biomeCellSize);
    return stableHash(biomeX, biomeY) % WASTELAND_VARIANT_KEYS.length;
}

const SHARED_MAP_RUNTIME = {
    assets: null,
    assetsPromise: null,
    chunkCache: new Map(),
    showWastelandIcons: true,
};

class MapView {
    #appRoot;
    #viewport;
    #terrainCanvas;
    #terrainCtx;
    #detailsCanvas;
    #detailsCtx;
    #coordsDisplay;
    #centerMapBtn;
    #toggleWastelandIconBtn;
    #tileInfoUI;
    #gameState = null;
    #mapDataLookup = null;
    #scale = 1.0;
    #translateX = 0;
    #translateY = 0;
    #isDragging = false;
    #hasDragged = false;
    #isViewportReady = false;
    #updateQueued = false;
    #lastMouseX;
    #lastMouseY;
    #lastActiveVillageId = null;
    #lastTransform = { x: null, y: null, scale: null };

    #assets = {};
    #assetsLoaded = false;
    #showWastelandIcons = true;
    #mapSize = DEFAULT_MAP_SIZE;

    #chunkCache = new Map();
    #dirtyChunkKeys = new Set();
    #resizeObserver;
    #didReportFirstMeaningfulPaint = false;

    constructor() {
        this._handleGameStateUpdate = this._handleGameStateUpdate.bind(this);
        this._onPanStart = this._onPanStart.bind(this);
        this._onPanMove = this._onPanMove.bind(this);
        this._onPanEnd = this._onPanEnd.bind(this);
        this._onZoom = this._onZoom.bind(this);
        this._handleCenterMapClick = this._handleCenterMapClick.bind(this);
        this._handleToggleWastelandIconChange = this._handleToggleWastelandIconChange.bind(this);
        this._handleResize = this._handleResize.bind(this);

        this.#chunkCache = SHARED_MAP_RUNTIME.chunkCache;
        this.#showWastelandIcons = SHARED_MAP_RUNTIME.showWastelandIcons;
    }

    get html() {
        return `
            <div id="map-viewport" class="flex-grow">
                <canvas id="terrain-canvas" class="absolute top-0 left-0"></canvas>
                <canvas id="details-canvas" class="absolute top-0 left-0"></canvas>
            </div>
            
            <div id="map-controls-cluster" class="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center justify-center gap-3 z-30 rounded-2xl border border-primary-border bg-glass-bg/90 px-3 py-2 shadow-2xl backdrop-blur-md">
                
                <img id="center-map-btn" src="/icons/compass.png" alt="Centrar Mapa" class="h-9 w-9 cursor-pointer rounded-xl border border-primary-border bg-btn-secondary-bg p-1.5 hover:opacity-80 transition-opacity">

                <div id="coords-display" class="bg-primary-bg/80 backdrop-blur-sm text-war-gold px-3 py-1.5 h-9 flex items-center rounded-full font-mono text-sm pointer-events-none border border-primary-border">
                    (0|0)
                </div>

                <div class="bg-primary-bg/80 backdrop-blur-sm p-2 rounded-full flex items-center gap-2 h-9 border border-primary-border">
                    <label for="toggle-wasteland-icon" class="text-xs text-stone-300 cursor-pointer select-none">Iconos</label>
                    <input type="checkbox" id="toggle-wasteland-icon" class="h-4 w-4 rounded-sm bg-btn-secondary-bg border-primary-border text-war-gold focus:ring-war-gold/50 cursor-pointer" checked>
                </div>
            </div>
        `;
    }

    mount() {
        perfCollector.markStart('view.map.mount');
        perfCollector.markStart('view.map.firstMeaningfulPaint');

        this._initializeDOMElements();
        this.#tileInfoUI = new TileInfoUI();

        this.#appRoot = document.getElementById('app-root');
        if (this.#appRoot) {
            this.#appRoot.classList.add('flex', 'flex-col');
        }

        this._loadAssets()
            .then(() => {
                this._initializeEventListeners();
                this._initializeResizeObserver();
                perfCollector.markEnd('view.map.mount');
            })
            .catch(error => {
                console.error("CRITICAL ERROR: No se pudieron cargar los activos del mapa. El juego no puede continuar.", error);
                if (this.#viewport) {
                    this.#viewport.innerHTML = `<div class="text-red-500 p-4">Error al cargar recursos del mapa. Revisa la consola y la ruta de los archivos.</div>`;
                }
                perfCollector.markEnd('view.map.mount');
            });
    }

    unmount() {
        if (this.#appRoot) {
            this.#appRoot.classList.remove('flex', 'flex-col');
        }
        uiRenderScheduler.unregister('map-view');
        this.#viewport.removeEventListener('mousedown', this._onPanStart);
        this.#viewport.removeEventListener('mousemove', this._onPanMove);
        this.#viewport.removeEventListener('mouseup', this._onPanEnd);
        this.#viewport.removeEventListener('mouseleave', this._onPanEnd);
        this.#viewport.removeEventListener('wheel', this._onZoom);
        this.#viewport.removeEventListener('touchstart', this._onPanStart);
        this.#viewport.removeEventListener('touchmove', this._onPanMove);
        this.#viewport.removeEventListener('touchend', this._onPanEnd);

        this.#centerMapBtn.removeEventListener('click', this._handleCenterMapClick);
        this.#toggleWastelandIconBtn.removeEventListener('change', this._handleToggleWastelandIconChange);

        if (this.#resizeObserver) {
            this.#resizeObserver.disconnect();
        }

        this.#tileInfoUI?.destroy?.();
        this.#tileInfoUI = null;

        SHARED_MAP_RUNTIME.showWastelandIcons = this.#showWastelandIcons;
        this.#dirtyChunkKeys.clear();
        this.#isViewportReady = false;
        this.#assetsLoaded = false;
        this.#gameState = null;
        this.#mapDataLookup = null;
        this.#lastActiveVillageId = null;
        this.#lastTransform = { x: null, y: null, scale: null };
        this.#scale = 1.0;
        this.#translateX = 0;
        this.#translateY = 0;
        this.#mapSize = DEFAULT_MAP_SIZE;
    }

    async _loadAssets() {
        if (SHARED_MAP_RUNTIME.assets) {
            this.#assets = SHARED_MAP_RUNTIME.assets;
            this.#assetsLoaded = true;
            return;
        }

        if (!SHARED_MAP_RUNTIME.assetsPromise) {
            SHARED_MAP_RUNTIME.assetsPromise = (async () => {
                const loadedAssets = {};
                const promises = Object.entries(ASSET_PATHS).map(([key, src]) => {
                    return new Promise((resolve, reject) => {
                        const img = new Image();
                        img.onload = () => {
                            loadedAssets[key] = img;
                            resolve();
                        };
                        img.onerror = () => reject(`No se pudo cargar la imagen: ${src}`);
                        img.src = src;
                    });
                });

                await Promise.all(promises);

                const villageImg = loadedAssets.village;
                if (villageImg) {
                    const playerVillageCanvas = document.createElement('canvas');
                    playerVillageCanvas.width = villageImg.width;
                    playerVillageCanvas.height = villageImg.height;
                    const pctx = playerVillageCanvas.getContext('2d');
                    pctx.drawImage(villageImg, 0, 0);
                    pctx.globalCompositeOperation = 'source-atop';
                    pctx.fillStyle = 'rgba(56, 178, 172, 0.3)';
                    pctx.fillRect(0, 0, villageImg.width, villageImg.height);
                    loadedAssets.playerVillage = playerVillageCanvas;

                    const enemyVillageCanvas = document.createElement('canvas');
                    enemyVillageCanvas.width = villageImg.width;
                    enemyVillageCanvas.height = villageImg.height;
                    const ectx = enemyVillageCanvas.getContext('2d');
                    ectx.drawImage(villageImg, 0, 0);
                    ectx.globalCompositeOperation = 'source-atop';
                    ectx.fillStyle = 'rgba(229, 62, 62, 0.3)';
                    ectx.fillRect(0, 0, villageImg.width, villageImg.height);
                    loadedAssets.enemyVillage = enemyVillageCanvas;
                }

                return loadedAssets;
            })();
        }

        try {
            const sharedAssets = await SHARED_MAP_RUNTIME.assetsPromise;
            SHARED_MAP_RUNTIME.assets = sharedAssets;
            this.#assets = sharedAssets;
            this.#assetsLoaded = true;
        } catch (error) {
            SHARED_MAP_RUNTIME.assetsPromise = null;
            throw error;
        }
    }

    _initializeDOMElements() {
        this.#viewport = document.getElementById('map-viewport');
        this.#terrainCanvas = document.getElementById('terrain-canvas');
        this.#detailsCanvas = document.getElementById('details-canvas');
        this.#coordsDisplay = document.getElementById('coords-display');
        this.#centerMapBtn = document.getElementById('center-map-btn');
        this.#toggleWastelandIconBtn = document.getElementById('toggle-wasteland-icon');
        this.#terrainCtx = this.#terrainCanvas.getContext('2d');
        this.#detailsCtx = this.#detailsCanvas.getContext('2d');

        if (this.#toggleWastelandIconBtn) {
            this.#toggleWastelandIconBtn.checked = this.#showWastelandIcons;
        }
    }
    
    _setupSingleCanvas(canvas, ctx) {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.#viewport.getBoundingClientRect();
        
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        
        ctx.scale(dpr, dpr);
        ctx.imageSmoothingEnabled = false;
    }

    _setupCanvas() {
        this._setupSingleCanvas(this.#terrainCanvas, this.#terrainCtx);
        this._setupSingleCanvas(this.#detailsCanvas, this.#detailsCtx);
    }

    _initializeResizeObserver() {
        this.#resizeObserver = new ResizeObserver(this._handleResize);
        this.#resizeObserver.observe(this.#viewport);
    }

    _handleResize() {
        const rect = this.#viewport.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            this._setupCanvas();
            
            if (!this.#isViewportReady) {
                this.#isViewportReady = true;
                gameManager.sendCommand('get_latest_state');
            } else {
                this._applyTransform();
            }
        }
    }

    _initializeEventListeners() {
        uiRenderScheduler.register('map-view', this._handleGameStateUpdate, [selectMapViewSignature], {
            suspendWhenPanelVisible: true,
        });
        this.#viewport.addEventListener('mousedown', this._onPanStart);
        this.#viewport.addEventListener('mousemove', this._onPanMove);
        this.#viewport.addEventListener('mouseup', this._onPanEnd);
        this.#viewport.addEventListener('mouseleave', this._onPanEnd);
        this.#viewport.addEventListener('wheel', this._onZoom, { passive: false });
        this.#viewport.addEventListener('touchstart', this._onPanStart, { passive: true });
        this.#viewport.addEventListener('touchmove', this._onPanMove, { passive: false });
        this.#viewport.addEventListener('touchend', this._onPanEnd);

        this.#centerMapBtn.addEventListener('click', this._handleCenterMapClick);
        this.#toggleWastelandIconBtn.addEventListener('change', this._handleToggleWastelandIconChange);
    }

    _handleCenterMapClick() {
        if (!this.#gameState) return;
        const activeVillage = this.#gameState.villages.find(v => v.id === this.#gameState.activeVillageId);
        if (activeVillage) {
            this._centerOn(activeVillage.coords.x, activeVillage.coords.y);
        }
    }

    _handleToggleWastelandIconChange(e) {
        this.#showWastelandIcons = e.target.checked;
        SHARED_MAP_RUNTIME.showWastelandIcons = this.#showWastelandIcons;
        this.#chunkCache.clear();
        this._applyTransform();
    }
    
    _buildMapLookup() {
        this.#mapDataLookup = new Map();
        for (const tile of this.#gameState.mapData) {
            this.#mapDataLookup.set(`${tile.x}|${tile.y}`, tile);
        }
    }

    _handleGameStateUpdate(gameStatePayload) {
        const { state } = gameStatePayload;
        if (!state || !this.#isViewportReady) {
            if (!this.#isViewportReady) {
                this.#gameState = state;
            }
            return;
        }

        const isInitialLoad = !this.#gameState;
        this.#gameState = state;
        this.#mapSize = this._resolveMapSize(state);

        if (isInitialLoad || !this.#mapDataLookup) {
            this._buildMapLookup();
        }

        if (this.#gameState.villages) {
            this.#gameState.villages.forEach(village => {
                const chunkKeyTerrain = this._getChunkKeyForTile(village.coords.x, village.coords.y) + '|false';
                const chunkKeyLowDetail = this._getChunkKeyForTile(village.coords.x, village.coords.y) + '|true';
                this.#dirtyChunkKeys.add(chunkKeyTerrain);
                this.#dirtyChunkKeys.add(chunkKeyLowDetail);
            });
        }

        if (state.activeVillageId !== this.#lastActiveVillageId) {
            const activeVillage = this.#gameState.villages.find(v => v.id === state.activeVillageId);
            if (activeVillage) {
                this._centerOn(activeVillage.coords.x, activeVillage.coords.y);
                this.#lastActiveVillageId = state.activeVillageId;
            }
        }
        
        this._applyTransform();
    }

    _clampTransform(x, y, scale) {
        const fullMapGridSize = this.#mapSize * 2 + 1;
        const mapPixelWidth = fullMapGridSize * TILE_SIZE * scale;
        const mapPixelHeight = fullMapGridSize * TILE_SIZE * scale;
        const viewportWidth = this.#viewport.clientWidth;
        const viewportHeight = this.#viewport.clientHeight;

        const minX = viewportWidth - mapPixelWidth;
        const minY = viewportHeight - mapPixelHeight;
        const maxX = 0;
        const maxY = 0;

        return {
            x: Math.max(minX, Math.min(x, maxX)),
            y: Math.max(minY, Math.min(y, maxY))
        };
    }

    _applyTransform() {
        if (!this.#updateQueued) {
            this.#updateQueued = true;
            requestAnimationFrame(() => {
                this._drawMap();
                this.#updateQueued = false;
            });
        }
    }
    
    _centerOn(x, y) {
        const viewportWidth = this.#viewport.clientWidth;
        const viewportHeight = this.#viewport.clientHeight;
        if (viewportWidth === 0 || viewportHeight === 0) return;

        const targetPixelX = (x + this.#mapSize) * TILE_SIZE * this.#scale + (TILE_SIZE * this.#scale / 2);
        const targetPixelY = (y + this.#mapSize) * TILE_SIZE * this.#scale + (TILE_SIZE * this.#scale / 2);

        this.#translateX = viewportWidth / 2 - targetPixelX;
        this.#translateY = viewportHeight / 2 - targetPixelY;

        this._applyTransform();
    }

    _onPanStart(e) {
        this.#isDragging = true;
        this.#hasDragged = false;
        this.#lastMouseX = e.touches ? e.touches[0].clientX : e.clientX;
        this.#lastMouseY = e.touches ? e.touches[0].clientY : e.clientY;
    }

    _onPanMove(e) {
        if (!this.#isDragging) return;
        e.preventDefault();
        this.#hasDragged = true;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        const dx = clientX - this.#lastMouseX;
        const dy = clientY - this.#lastMouseY;
        
        this.#translateX += dx;
        this.#translateY += dy;

        this.#lastMouseX = clientX;
        this.#lastMouseY = clientY;
        this._applyTransform();
    }
    
    _onPanEnd(e) {
        if (this.#isDragging && !this.#hasDragged) {
            const coords = this._getTileCoordsFromClick(e);
            if (coords) {
                this.#tileInfoUI.show(coords, this.#gameState);
            }
        }
        this.#isDragging = false;
    }
    
    _getTileCoordsFromClick(e) {
        const rect = this.#detailsCanvas.getBoundingClientRect();
        const clientX = e.clientX ?? e.changedTouches?.[0]?.clientX;
        const clientY = e.clientY ?? e.changedTouches?.[0]?.clientY;

        if (clientX === undefined || clientY === undefined) return null;

        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const worldX = (x - this.#translateX) / this.#scale;
        const worldY = (y - this.#translateY) / this.#scale;

        const gridX = Math.floor(worldX / TILE_SIZE);
        const gridY = Math.floor(worldY / TILE_SIZE);

        const mapX = gridX - this.#mapSize;
        const mapY = gridY - this.#mapSize;
        
        if (mapX >= -this.#mapSize && mapX <= this.#mapSize && mapY >= -this.#mapSize && mapY <= this.#mapSize) {
            return { x: mapX, y: mapY };
        }
        
        return null;
    }

    _onZoom(e) {
        e.preventDefault();
        const rect = this.#viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const mapMouseX = (mouseX - this.#translateX) / this.#scale;
        const mapMouseY = (mouseY - this.#translateY) / this.#scale;
        
        this.#scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.#scale - e.deltaY * 0.005));

        this.#translateX = mouseX - mapMouseX * this.#scale;
        this.#translateY = mouseY - mapMouseY * this.#scale;
        
        this._applyTransform();
    }

    _getChunkKeyForTile(mapX, mapY) {
        const chunkX = Math.floor((mapX + this.#mapSize) / CHUNK_SIZE);
        const chunkY = Math.floor((mapY + this.#mapSize) / CHUNK_SIZE);
        return `${chunkX}|${chunkY}`;
    }

    _resolveMapSize(state) {
        const configuredSize = Math.floor(Number(state?.mapSize));
        if (Number.isFinite(configuredSize) && configuredSize > 0) return configuredSize;

        const maxCoordinate = (state?.mapData || []).reduce((maxValue, tile) => {
            return Math.max(maxValue, Math.abs(Number(tile.x) || 0), Math.abs(Number(tile.y) || 0));
        }, DEFAULT_MAP_SIZE);
        return maxCoordinate || DEFAULT_MAP_SIZE;
    }

    _renderChunk(chunkX, chunkY, useLowDetail) {
        const terrainChunkCanvas = document.createElement('canvas');
        terrainChunkCanvas.width = CHUNK_PIXEL_SIZE;
        terrainChunkCanvas.height = CHUNK_PIXEL_SIZE;
        const terrainCtx = terrainChunkCanvas.getContext('2d');

        const detailsChunkCanvas = document.createElement('canvas');
        detailsChunkCanvas.width = CHUNK_PIXEL_SIZE;
        detailsChunkCanvas.height = CHUNK_PIXEL_SIZE;
        const detailsCtx = detailsChunkCanvas.getContext('2d');

        const startGridX = chunkX * CHUNK_SIZE;
        const endGridX = startGridX + CHUNK_SIZE;
        const startGridY = chunkY * CHUNK_SIZE;
        const endGridY = startGridY + CHUNK_SIZE;

        for (let gridY = startGridY; gridY < endGridY; gridY++) {
            for (let gridX = startGridX; gridX < endGridX; gridX++) {
                const mapX = gridX - this.#mapSize;
                const mapY = gridY - this.#mapSize;
                const tileData = this.#mapDataLookup.get(`${mapX}|${mapY}`);
                
                const tilePixelX = (gridX - startGridX) * TILE_SIZE;
                const tilePixelY = (gridY - startGridY) * TILE_SIZE;
                
                this._drawTileTerrain(terrainCtx, tilePixelX, tilePixelY, tileData, useLowDetail, mapX, mapY);
                if (!useLowDetail) {
                    this._drawTileDetails(detailsCtx, tilePixelX, tilePixelY, tileData);
                }
            }
        }
        
        const key = `${chunkX}|${chunkY}|${useLowDetail}`;
        const chunkData = { terrain: terrainChunkCanvas, details: detailsChunkCanvas };
        this.#chunkCache.set(key, chunkData);
        this.#dirtyChunkKeys.delete(key);
        return chunkData;
    }
    
    _drawMap() {
        if (!this.#assetsLoaded || !this.#gameState || !this.#isViewportReady) return;

        const viewportWidth = this.#viewport.clientWidth;
        const viewportHeight = this.#viewport.clientHeight;

        const clamped = this._clampTransform(this.#translateX, this.#translateY, this.#scale);
        this.#translateX = clamped.x;
        this.#translateY = clamped.y;

        const transformChanged = this.#translateX !== this.#lastTransform.x || 
                                 this.#translateY !== this.#lastTransform.y || 
                                 this.#scale !== this.#lastTransform.scale;

        this.#detailsCtx.clearRect(0, 0, this.#detailsCanvas.width, this.#detailsCanvas.height);
        
        if (transformChanged) {
            this.#terrainCtx.clearRect(0, 0, this.#terrainCanvas.width, this.#terrainCanvas.height);
            this.#terrainCtx.save();
            this.#terrainCtx.translate(this.#translateX, this.#translateY);
            this.#terrainCtx.scale(this.#scale, this.#scale);
        }

        this.#detailsCtx.save();
        this.#detailsCtx.translate(this.#translateX, this.#translateY);
        this.#detailsCtx.scale(this.#scale, this.#scale);

        const centerX = (viewportWidth / 2 - this.#translateX) / this.#scale;
        const centerY = (viewportHeight / 2 - this.#translateY) / this.#scale;
        const centerGridX = Math.floor(centerX / TILE_SIZE);
        const centerGridY = Math.floor(centerY / TILE_SIZE);
        const centerMapX = centerGridX - this.#mapSize;
        const centerMapY = centerGridY - this.#mapSize;
        this.#coordsDisplay.textContent = `(${centerMapX}|${centerMapY})`;

        const startChunkX = Math.floor(-this.#translateX / this.#scale / CHUNK_PIXEL_SIZE);
        const endChunkX = startChunkX + Math.ceil(viewportWidth / this.#scale / CHUNK_PIXEL_SIZE) + 1;
        const startChunkY = Math.floor(-this.#translateY / this.#scale / CHUNK_PIXEL_SIZE);
        const endChunkY = startChunkY + Math.ceil(viewportHeight / this.#scale / CHUNK_PIXEL_SIZE) + 1;

        const useLowDetail = this.#scale < LOD_SCALE_THRESHOLD;

        for (let cy = startChunkY; cy < endChunkY; cy++) {
            for (let cx = startChunkX; cx < endChunkX; cx++) {
                const key = `${cx}|${cy}|${useLowDetail}`;
                let chunkData = this.#chunkCache.get(key);
                
                if (!chunkData || this.#dirtyChunkKeys.has(key)) {
                    chunkData = this._renderChunk(cx, cy, useLowDetail);
                }
                
                const chunkDrawX = cx * CHUNK_PIXEL_SIZE;
                const chunkDrawY = cy * CHUNK_PIXEL_SIZE;
                
                if (transformChanged) {
                    this.#terrainCtx.drawImage(chunkData.terrain, chunkDrawX, chunkDrawY);
                }
                this.#detailsCtx.drawImage(chunkData.details, chunkDrawX, chunkDrawY);
            }
        }
        
        if (transformChanged) {
             this.#terrainCtx.restore();
        }
        this.#detailsCtx.restore();

        this.#lastTransform = { x: this.#translateX, y: this.#translateY, scale: this.#scale };

        if (!this.#didReportFirstMeaningfulPaint) {
            this.#didReportFirstMeaningfulPaint = true;
            perfCollector.markEnd('view.map.firstMeaningfulPaint');
        }
    }

    _drawTileTerrain(ctx, px, py, tileData, useLowDetail, mapX, mapY) {
        const activeVillage = this.#gameState?.villages?.find(village => village.id === this.#gameState?.activeVillageId);
        const perspectiveOwnerId = activeVillage?.ownerId || 'player';

        const tileX = Number.isFinite(tileData?.x) ? tileData.x : mapX;
        const tileY = Number.isFinite(tileData?.y) ? tileData.y : mapY;
        const fallbackVariant = getWastelandVariantIndex(tileX, tileY) + 1;
        const terrainVariant = Number.isFinite(tileData?.terrainVariant) ? tileData.terrainVariant : fallbackVariant;
        const wastelandKey = `wasteland${Math.max(1, Math.min(6, terrainVariant))}`;
        const wastelandTexture = this.#assets[wastelandKey] || this.#assets.wasteland1;

        if (wastelandTexture) {
            ctx.drawImage(wastelandTexture, px, py, TILE_SIZE, TILE_SIZE);
        } else {
            ctx.fillStyle = '#6B4F4B';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }

        if (tileData?.type === 'oasis') {
            const oasisTextureKey = OASIS_TEXTURE_BY_TYPE[tileData.oasisType];
            const oasisTexture = this.#assets[oasisTextureKey];
            if (oasisTexture) {
                ctx.drawImage(oasisTexture, px, py, TILE_SIZE, TILE_SIZE);
            }
        }

        if (tileData?.type === 'village') {
            ctx.fillStyle = tileData.ownerId === perspectiveOwnerId ? 'rgba(56, 178, 172, 0.18)' : 'rgba(229, 62, 62, 0.18)';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }

        if (useLowDetail) {
            let detailColor = null;
            if (tileData) {
                if (tileData.type === 'village') {
                    detailColor = tileData.ownerId === perspectiveOwnerId ? '#48BB78' : '#E53E3E';
                } else if (tileData.type === 'oasis') {
                    const oasisDetails = gameData.oasisTypes[tileData.oasisType];
                    const resourceType = oasisDetails.bonus.resource;
                    const colorMap = { wood: '#A0522D', stone: '#B22222', iron: '#778899', food: '#FFD700' };
                    detailColor = colorMap[resourceType];
                }
            }
            if (detailColor) {
                ctx.fillStyle = detailColor;
                const markerSize = Math.max(6, Math.floor(TILE_SIZE * 0.3));
                const markerX = px + Math.floor((TILE_SIZE - markerSize) / 2);
                const markerY = py + Math.floor((TILE_SIZE - markerSize) / 2);
                ctx.fillRect(markerX, markerY, markerSize, markerSize);
            }
        }
    }

    _drawTileDetails(ctx, px, py, tileData) {
        const activeVillage = this.#gameState?.villages?.find(village => village.id === this.#gameState?.activeVillageId);
        const perspectiveOwnerId = activeVillage?.ownerId || 'player';

        ctx.lineWidth = 1;
        let borderColor = null;
        let icon = null;
        let isDashed = false;

        if (!tileData || tileData.type === 'valley') {
            borderColor = '#718096';
            isDashed = false;
        } else if (tileData.type === 'oasis') {
            const oasisDetails = gameData.oasisTypes[tileData.oasisType];
            const resourceType = oasisDetails.bonus.resource;
            const colorMap = { wood: '#A0522D', stone: '#B22222', iron: '#778899', food: '#FFD700' };
            borderColor = colorMap[resourceType];
            isDashed = true;

        } else if (tileData.type === 'village') {
            const village = this.#gameState.villages.find(v => v.id === tileData.villageId);
            if (this.#showWastelandIcons) {
                icon = this.#assets.village;
            }

            if (tileData.ownerId === perspectiveOwnerId) {
                borderColor = (village && village.id === this.#gameState.activeVillageId) ? '#FFFFFF' : '#48BB78';
            } else {
                borderColor = '#E53E3E';
            }
            isDashed = true;
        }

        if (borderColor) {
            ctx.setLineDash(isDashed ? [4, 2] : []);
            ctx.strokeStyle = borderColor;
            ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
        }

        ctx.setLineDash([]);
        if (icon) {
            const iconSize = TILE_SIZE * 0.5;
            const iconPadding = 2;
            
            let iconX, iconY;
            let iconToDraw = icon;

            if ((tileData && tileData.type === 'oasis') || !tileData || (tileData && tileData.type === 'valley')) {
                iconX = px + iconPadding;
                iconY = py + iconPadding;
            } else if (tileData && tileData.type === 'village') {
                iconX = px + (TILE_SIZE - iconSize) / 2;
                iconY = py + (TILE_SIZE - iconSize) / 2;
                
                if (borderColor === '#48BB78' || borderColor === '#FFFFFF') {
                    if (this.#assets.playerVillage) iconToDraw = this.#assets.playerVillage;
                } else {
                    if (this.#assets.enemyVillage) iconToDraw = this.#assets.enemyVillage;
                }
            }
            
            if (iconX !== undefined) {
                ctx.drawImage(iconToDraw, iconX, iconY, iconSize, iconSize);
            }
        }

        if (this.#showWastelandIcons && tileData?.type === 'oasis') {
            const bonusPercentage = gameData.oasisTypes[tileData.oasisType]?.bonus?.percentage;
            if (bonusPercentage) {
                this._drawOasisBonusLabel(ctx, px, py, bonusPercentage);
            }
        }
    }

    _drawOasisBonusLabel(ctx, px, py, bonusPercentage) {
        const label = `+${bonusPercentage}%`;
        const labelHeight = 11;
        const labelPaddingX = 3;
        ctx.save();
        ctx.font = 'bold 8px sans-serif';
        const labelWidth = Math.ceil(ctx.measureText(label).width) + labelPaddingX * 2;
        const labelX = px + TILE_SIZE - labelWidth - 2;
        const labelY = py + 2;

        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(17, 24, 39, 0.78)';
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.72)';
        ctx.lineWidth = 1;
        ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
        ctx.strokeRect(labelX + 0.5, labelY + 0.5, labelWidth - 1, labelHeight - 1);
        ctx.fillStyle = '#fde68a';
        ctx.fillText(label, labelX + labelPaddingX, labelY + labelHeight / 2);
        ctx.restore();
    }
}

export default MapView;
