import gameManager from '@game/state/GameManager.js';
import { router } from '@app/router.js';
import { FARM_LIST_LIMITS, gameData } from '../core/GameData.js';
import { getScaledCrannyCapacity, getScaledMerchantCapacityPerUnit, scaleCapacityByGameSpeed } from '../core/capacityScaling.js';
import GameConfig from '../state/GameConfig.js';
import { formatNumber, formatTime } from '@shared/lib/formatters.js';
import toastUI from './ToastUI.js';
import { markModalOpened, shouldIgnoreModalAction } from './modalInteractionGuard.js';
import { unitSpriteManager } from './UnitSpriteManager.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import { selectBuildingInfoPanelSignature } from './renderSelectors.js';

const ICONS = {
    time: `<img src="/icons/timer.png" alt="Tiempo" class="h-5 w-5">`,
    population: `<img src="/icons/population.png" alt="Población" class="h-5 w-5">`,
    wood: `<img src="/icons/wood.webp" alt="Madera" class="h-[25px] w-[25px]">`,
    clay: `<img src="/icons/clay.webp" alt="Barro" class="h-[25px] w-[25px]">`,
    iron: `<img src="/icons/iron.webp" alt="Hierro" class="h-[25px] w-[25px]">`,
    wheat: `<img src="/icons/wheat.webp" alt="Cereal" class="h-[25px] w-[25px]">`,
    exchange: `<img src="/icons/bolsa.png" alt="Intercambio" class="block h-3.5 w-3.5 sm:h-4 sm:w-4 object-contain">`,
};

const RESOURCE_ICON_MAP = {
    wood: 'wood', stone: 'clay', iron: 'iron', food: 'wheat',
    time: 'time', population: 'population'
};

const RESOURCE_KEYS = ['wood', 'stone', 'iron', 'food'];
const RESOURCE_LABELS = { wood: 'Madera', stone: 'Barro', iron: 'Hierro', food: 'Cereal' };
const UNIT_TYPE_LABELS = {
    infantry: 'Infanteria', cavalry: 'Caballeria', siege: 'Asedio', scout: 'Exploracion', settler: 'Colonizacion', chief: 'Conquista', merchant: 'Comercio'
};
const UNIT_ROLE_LABELS = {
    offensive: 'Ofensiva', defensive: 'Defensiva', versatile: 'Versatil', scout: 'Explorador', ram: 'Ariete', catapult: 'Catapulta', conquest: 'Fundador', colonization: 'Conquista', trade: 'Comercio'
};

const BUILDING_CATEGORIES = {
    infrastructure: ['embassy', 'palace', 'heroMansion'],
    military: ['barracks', 'stable', 'workshop', 'smithy', 'academy', 'hospital', 'greatBarracks', 'greatStable', 'tournamentSquare'],
    economy: ['warehouse', 'granary', 'cranny', 'marketplace', 'tradeOffice', 'sawmill', 'brickyard', 'ironFoundry', 'grainMill', 'bakery', 'waterworks']
};

const MULTIPLE_ALLOWED_BUILDINGS = ['warehouse', 'granary', 'cranny'];

class BuildingInfoUI {
    #panelElement;
    #mainContainer;
    #currentSlotId = null;
    #viewingType = null;
    #currentGameState = null;
    #gameConfig = null;
    #showAllBuildings = false;
    #showAllUnits = false;
    #lastOpenedAt = 0;

    constructor() {
        this.#mainContainer = document.getElementById('village-container');
        this.#gameConfig = new GameConfig().getSettings();
        this._init();
    }

    _init() {
        uiRenderScheduler.register('building-info-ui', this._handleGameStateUpdate.bind(this), [selectBuildingInfoPanelSignature]);
        this._createPanelHTML();
        this.#panelElement = document.getElementById('building-info-panel');
        this.#panelElement.querySelector('[data-action="close"]').addEventListener('click', () => this.hide());
        this.#panelElement.querySelector('[data-action="upgrade"]').addEventListener('click', () => this._handleUpgradeClick());
        this.#panelElement.querySelector('[data-action="demolish"]').addEventListener('click', () => this._handleDemolishClick());
        this.#panelElement.querySelector('[data-action="close-unit-info"]').addEventListener('click', () => this._hideUnitInfoModal());
        this.#panelElement.querySelector('#unit-info-modal').addEventListener('click', e => {
            if (e.target.id === 'unit-info-modal') this._hideUnitInfoModal();
        });
    
        const mainPanel = this.#panelElement.querySelector('#panel-main');
        mainPanel.addEventListener('click', e => {
            const button = e.target.closest('button[data-action]');
            if (!button || button.disabled) return;

            if (shouldIgnoreModalAction(this.#lastOpenedAt)) {
                return;
            }
    
            const action = button.dataset.action;
            const unitId = button.dataset.unitId;
            const unitDiv = button.closest('div[data-unit-id]');
            const activeVillageId = this.#currentGameState?.activeVillageId;
            if (!activeVillageId) return;

            if (action === 'unit-info') {
                this._showUnitInfoModal(unitId);
                return;
            }

            if (action === 'optimize-unit-exchange') {
                this._handleOptimizeUnitExchange(unitId, activeVillageId);
                return;
            }

            if (action === 'farm-open-center') {
                this.hide();
                router.navigate('/farm-lists');
                return;
            }

            if (action === 'release-oasis') {
                this._handleReleaseOasisClick(button);
                return;
            }

            if (action === 'npc-max-resource') {
                this._handleNpcMaxClick(button.dataset.res);
                return;
            }

            if (action === 'npc-exchange') {
                this._handleNpcExchangeClick(activeVillageId);
                return;
            }
    
            if (action === 'train') {
                const input = unitDiv.querySelector('input[type="number"]');
                const count = parseInt(input.value, 10);
                if (count > 0) {
                    gameManager.sendCommand('recruit_units', {
                        buildingId: this.#currentSlotId,
                        unitId: unitId,
                        count: count,
                        villageId: activeVillageId
                    });
                    input.value = '';
                }
            } else if (action === 'max-train') {
                const activeVillage = this.#currentGameState.villages.find(v => v.id === activeVillageId);
                if (!activeVillage) return;
    
                const unitData = gameData.units[activeVillage.race].troops.find(u => u.id === unitId);
                const input = button.parentElement.querySelector('input[type="number"]');
                if (!input || !unitData) return;
    
                let maxAffordable = Infinity;
                for (const res in unitData.cost) {
                    const affordable = Math.floor(activeVillage.resources[res].current / unitData.cost[res]);
                    if (affordable < maxAffordable) {
                        maxAffordable = affordable;
                    }
                }
                input.value = maxAffordable > 0 ? maxAffordable : '';
            } else if (action === 'research') {
                gameManager.sendCommand('research_unit', { unitId, villageId: activeVillageId });
            } else if (action === 'upgrade_unit') {
                gameManager.sendCommand('upgrade_unit', { unitId, villageId: activeVillageId });
            }
        });

        mainPanel.addEventListener('input', e => {
            if (e.target.matches('[data-npc-resource-input]')) {
                this._handleNpcResourceInput(e.target);
                this._updateNpcExchangeState();
            }
        });

        document.addEventListener('npc_resource_exchange:result', e => this._handleNpcExchangeResult(e.detail));
        document.addEventListener('release_oasis:result', e => this._handleReleaseOasisResult(e.detail));
    }

    _createPanelHTML() {
        const panelHTML = `
            <div id="building-info-panel" class="fixed inset-0 h-[var(--app-viewport-height)] bg-primary-bg/80 backdrop-blur-sm flex items-start sm:items-center justify-center overflow-y-auto p-2 sm:p-4 z-50 transition-all duration-200 ease-out panel-hidden">
                <div class="bg-glass-bg border border-primary-border rounded-[2rem] shadow-2xl w-full max-w-md my-2 sm:my-4 text-war-mist flex flex-col max-h-[calc(var(--app-viewport-height)-1rem)] backdrop-blur-2xl">
                    <header id="panel-header" class="flex justify-between items-center p-4 border-b border-primary-border">
                        <h2 id="panel-title" class="text-xl font-display font-bold text-war-gold"></h2>
                        <button data-action="close" class="min-h-11 min-w-11 text-gray-400 text-3xl leading-none hover:text-white" aria-label="Cerrar">×</button>
                    </header>
                    <main id="panel-main" class="flex flex-col p-4 overflow-y-auto min-h-0 max-h-[calc(var(--app-viewport-height)-12rem)]"></main>
                    <footer id="panel-footer" class="p-4 border-t border-primary-border space-y-2">
                        <button id="upgrade-button" data-action="upgrade" class="w-full bg-btn-primary-bg hover:bg-btn-primary-hover text-war-mist font-bold py-3 px-4 rounded-xl transition duration-300 disabled:bg-btn-secondary-bg disabled:cursor-not-allowed border border-primary-border">
                        </button>
                        <button id="demolish-button" data-action="demolish" class="w-full bg-red-950/70 hover:bg-red-900/80 text-red-100 font-bold py-3 px-4 rounded-xl transition duration-300 disabled:bg-btn-secondary-bg disabled:text-gray-500 disabled:cursor-not-allowed border border-red-500/35 flex items-center justify-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 20h16M7 20l1.5-9h7L17 20M9 11V8a3 3 0 016 0v3M6 6l12 12" /></svg>
                            <span>Demoler un nivel</span>
                        </button>
                    </footer>
                </div>
                <div id="unit-info-modal" class="fixed inset-0 h-[var(--app-viewport-height)] bg-black/70 backdrop-blur-sm hidden items-center justify-center p-3 sm:p-4 z-[60]">
                    <div class="w-full max-w-lg max-h-[calc(var(--app-viewport-height)-2rem)] overflow-y-auto rounded-2xl border border-primary-border bg-gray-950/95 shadow-2xl text-war-mist">
                        <header class="flex items-center justify-between gap-3 p-4 border-b border-primary-border sticky top-0 bg-gray-950/95 backdrop-blur-xl">
                            <div class="min-w-0">
                                <h3 id="unit-info-title" class="text-xl font-display font-bold text-war-gold truncate"></h3>
                                <p id="unit-info-subtitle" class="text-xs text-gray-400 mt-1"></p>
                            </div>
                            <button data-action="close-unit-info" class="min-h-11 min-w-11 text-gray-400 text-3xl leading-none hover:text-white" aria-label="Cerrar informacion de unidad">×</button>
                        </header>
                        <div id="unit-info-content" class="p-4 space-y-4"></div>
                    </div>
                </div>
            </div>`;
        this.#mainContainer.insertAdjacentHTML('beforeend', panelHTML);
    }

    _handleGameStateUpdate(gameStatePayload) {
        const { state } = gameStatePayload;
        this.#gameConfig = new GameConfig().getSettings();
        this.#currentGameState = state;
        if (this.#panelElement.classList.contains('panel-visible')) {
            this._updateCosts();
            if (this.#viewingType === 'smithy') {
                this._updateSmithyList();
            }
            if (this.#viewingType === 'academy') {
                this._updateAcademyList();
            }
            if (['barracks', 'stable', 'workshop', 'greatBarracks', 'greatStable', 'palace'].includes(this.#viewingType)) {
                this._updateTroopList();
            }
            if (this.#viewingType === 'hospital') {
                const contentContainer = this.#panelElement.querySelector('#building-details-content');
                if (contentContainer) this._renderHospitalUnits(contentContainer);
            }
            if (this.#viewingType === 'heroMansion') {
                this._updateHeroMansionOases();
            }
            if (this.#viewingType === 'rallyPoint') {
                this._updateRallyPointFarmListPanel();
            }
            if (this.#viewingType === 'marketplace') {
                this._updateNpcExchangeState();
            }
        }
    }

    _handleUpgradeClick() {
        if (!this.#currentSlotId || !this.#viewingType) return;

        if (shouldIgnoreModalAction(this.#lastOpenedAt, 500)) {
            return;
        }

        gameManager.sendCommand('upgrade_building', {
            buildingId: this.#currentSlotId,
            buildingType: this.#viewingType
        });
        this.hide();
    }

    _handleDemolishClick() {
        if (!this.#currentSlotId || !this.#viewingType) return;

        if (shouldIgnoreModalAction(this.#lastOpenedAt, 500)) {
            return;
        }

        gameManager.sendCommand('demolish_building', {
            buildingId: this.#currentSlotId,
        });
        this.hide();
    }

    _getDemolitionState(activeVillage, buildingState, queuedJobsForSlot) {
        const currentLevel = buildingState?.type === this.#viewingType ? buildingState.level : 0;
        const demolitionUnlocked = Boolean(activeVillage.demolitionUnlocked)
            || (activeVillage.buildings.find(b => b.type === 'mainBuilding')?.level || 0) >= 10;
        const canDemolish = demolitionUnlocked
            && currentLevel > 0
            && this.#viewingType !== 'empty'
            && queuedJobsForSlot.length === 0;

        return {
            canDemolish,
            currentLevel,
            demolitionUnlocked,
            targetLevel: Math.max(0, currentLevel - 1),
        };
    }

    _getFinalBuildTime(baseTime) {
        if (!this.#currentGameState || !this.#gameConfig) return baseTime;
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return baseTime;

        const mainBuilding = activeVillage.buildings.find(b => b.type === 'mainBuilding');
        const mainBuildingLevel = mainBuilding ? mainBuilding.level : 0;
        let timeFactor = 1.0;
        if (mainBuildingLevel > 0) {
            timeFactor = gameData.buildings.mainBuilding.levels[mainBuildingLevel - 1].attribute.constructionTimeFactor;
        }
        const allianceTimeFactor = 1 - ((this.#currentGameState.alliance.bonuses.constructionTimeBonusPercent || 0) / 100);
        const finalTime = (baseTime / this.#gameConfig.gameSpeed) * timeFactor * allianceTimeFactor;
        return finalTime;
    }

    _checkRequirements(buildingId) {
        const buildingData = gameData.buildings[buildingId];
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return false;
        if (buildingData.allowedRaces && !buildingData.allowedRaces.includes(activeVillage.race)) return false;
        if (!buildingData.requires) return true;

        const resourceFieldTypes = ['woodcutter', 'clayPit', 'ironMine', 'cropland'];

        for (const reqBuildingType in buildingData.requires) {
            const requiredLevel = buildingData.requires[reqBuildingType];
            let requirementMet = false;

            if (resourceFieldTypes.includes(reqBuildingType)) {
                requirementMet = activeVillage.buildings.some(b => b.type === reqBuildingType && b.level >= requiredLevel);
            } else {
                const playerBuilding = activeVillage.buildings.find(b => b.type === reqBuildingType);
                requirementMet = playerBuilding && playerBuilding.level >= requiredLevel;
            }

            if (!requirementMet) {
                return false;
            }
        }

        return true;
    }
    
    _getMissingBuildingRequirementsHTML(buildingId) {
        const buildingData = gameData.buildings[buildingId];
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return '';

        let html = '<div class="mt-2 border-t border-primary-border pt-2 text-xs space-y-1">';
        html += `<span class="text-gray-400 font-semibold">Requisitos:</span>`;

        if (buildingData.allowedRaces && !buildingData.allowedRaces.includes(activeVillage.race)) {
            html += `<p class="text-red-400">Solo disponible para Egipcios</p>`;
        }

        if (!buildingData.requires) {
            html += '</div>';
            return html;
        }

        const resourceFieldTypes = ['woodcutter', 'clayPit', 'ironMine', 'cropland'];

        for (const reqBuildingType in buildingData.requires) {
            const requiredLevel = buildingData.requires[reqBuildingType];
            let isMet = false;

            if (resourceFieldTypes.includes(reqBuildingType)) {
                isMet = activeVillage.buildings.some(b => b.type === reqBuildingType && b.level >= requiredLevel);
            } else {
                const playerBuilding = activeVillage.buildings.find(b => b.type === reqBuildingType);
                isMet = playerBuilding && playerBuilding.level >= requiredLevel;
            }

            const colorClass = isMet ? 'text-green-400' : 'text-red-400';
            const buildingName = gameData.buildings[reqBuildingType].name;

            html += `<p class="${colorClass}">${buildingName} (Nivel ${requiredLevel})</p>`;
        }
        html += '</div>';
        return html;
    }
    
    _getMissingUnitRequirementsHTML(unitId) {
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return '';
    
        const unitData = gameData.units[activeVillage.race]?.troops.find(t => t.id === unitId);
        const requirements = unitData?.research?.requires;
        if (!requirements) return '';
    
        let html = '<div class="mt-2 border-t border-primary-border pt-2 text-xs space-y-1">';
        html += `<span class="text-gray-400 font-semibold">Requisitos de Investigación:</span>`;
        
        for (const reqBuildingType in requirements) {
            const requiredLevel = requirements[reqBuildingType];
            const playerBuilding = activeVillage.buildings.find(b => b.type === reqBuildingType);
            const playerLevel = playerBuilding ? playerBuilding.level : 0;
            const isMet = playerLevel >= requiredLevel;
            const colorClass = isMet ? 'text-green-400' : 'text-red-400';
            const buildingName = gameData.buildings[reqBuildingType].name;
            
            html += `<p class="${colorClass}">${buildingName} (Nivel ${requiredLevel})</p>`;
        }
        html += '</div>';
        return html;
    }
    
    show(slotId) {
        if (!this.#currentGameState) return;
        document.getElementById('building-tooltip').classList.add('hidden');

        this.#lastOpenedAt = markModalOpened();
        
        this.#panelElement.classList.remove('panel-hidden');
        this.#panelElement.classList.add('panel-visible');
        
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return;

        this.#currentSlotId = slotId;

        const queuedJob = activeVillage.constructionQueue.find(j => j.buildingId === slotId);
        if (queuedJob) {
            this.#viewingType = queuedJob.buildingType;
        } else {
            const buildingState = activeVillage.buildings.find(b => b.id === slotId);
            this.#viewingType = buildingState?.type || 'empty';
        }
        
        this._render();
    }

    hide() {
        this._hideUnitInfoModal();
        this.#panelElement.classList.remove('panel-visible');
        this.#panelElement.classList.add('panel-hidden');
        this.#currentSlotId = null;
        this.#viewingType = null;
        this.#showAllBuildings = false;
        this.#showAllUnits = false;
    }

    _render() {
        if (!this.#currentGameState || !this.#currentSlotId) return;
        
        const isResourceSlot = /^[wcif]/.test(this.#currentSlotId);

        if (this.#viewingType === 'empty' && !isResourceSlot) {
            this._renderEmptyInfrastructureSlot();
        } else if (this.#viewingType === 'empty') {
            this.hide();
        } else {
            this._renderBuildingDetails();
        }
    }

    _renderEmptyInfrastructureSlot() {
        const mainPanel = this.#panelElement.querySelector('#panel-main');
        this.#panelElement.querySelector('#panel-title').textContent = 'Construir Edificio';
        this.#panelElement.querySelector('#panel-footer').classList.add('hidden');
        
        mainPanel.innerHTML = `
            <div id="build-tabs" class="flex border-b border-primary-border/50 mb-1">
                <button data-tab="infrastructure" class="tab-button active px-4 py-2 text-sm font-semibold transition-colors">Infraestructura</button>
                <button data-tab="military" class="tab-button px-4 py-2 text-sm font-semibold transition-colors">Militar</button>
                <button data-tab="economy" class="tab-button px-4 py-2 text-sm font-semibold transition-colors">Economía</button>
            </div>
            <div class="flex items-center justify-end my-2">
                <label for="show-all-toggle" class="text-xs text-gray-400 mr-2 cursor-pointer">Mostrar todos</label>
                <input type="checkbox" id="show-all-toggle" class="bg-btn-secondary-bg border-primary-border text-blue-500 rounded focus:ring-2 focus:ring-blue-500/50 cursor-pointer">
            </div>
            <div id="build-content-container" class="flex-grow overflow-y-auto"></div>
        `;
        
        mainPanel.querySelector('#show-all-toggle').addEventListener('change', (e) => {
            this.#showAllBuildings = e.currentTarget.checked;
            this._updateBuildingList();
        });

        mainPanel.querySelector('#build-tabs').addEventListener('click', e => {
            if (e.target.matches('.tab-button')) {
                mainPanel.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');
                this._updateBuildingList();
            }
        });

        mainPanel.querySelector('#build-content-container').addEventListener('click', e => {
            const button = e.target.closest('button[data-btype]:not([disabled])');
            if (button) {
                if (shouldIgnoreModalAction(this.#lastOpenedAt, 320)) {
                    return;
                }
                this.#viewingType = button.dataset.btype;
                this._render();
            }
        });
        
        const toggle = mainPanel.querySelector('#show-all-toggle');
        toggle.checked = this.#showAllBuildings;

        this._updateBuildingList();
    }
    
    _updateBuildingList() {
        const mainPanel = this.#panelElement.querySelector('#panel-main');
        if (!mainPanel) return;
        
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return;

        const contentContainer = mainPanel.querySelector('#build-content-container');
        const activeTab = mainPanel.querySelector('.tab-button.active').dataset.tab;
        
        let categoryContent = '';
        const categoryBuildings = BUILDING_CATEGORIES[activeTab] || [];

        categoryBuildings.forEach(bId => {
            if (bId === 'cityWall') return;

            const existingBuildingsOfType = activeVillage.buildings.filter(b => b.type === bId);
            const isAlreadyBuilt = existingBuildingsOfType.length > 0;

            if (MULTIPLE_ALLOWED_BUILDINGS.includes(bId)) {
                if (isAlreadyBuilt) {
                    const maxLevel = gameData.buildings[bId].levels.length;
                    const canBuildAnother = existingBuildingsOfType.some(b => b.level === maxLevel);
                    if (!canBuildAnother) return;
                }
            } else {
                if (isAlreadyBuilt) return;
            }

            const canBuild = this._checkRequirements(bId);
            if (!canBuild && !this.#showAllBuildings) return;

            const buildingData = gameData.buildings[bId];
            const buttonClasses = canBuild ? 'hover:bg-glass-bg/80' : 'opacity-50 cursor-not-allowed';
            const buttonDisabled = canBuild ? '' : 'disabled';
            const requirementsHTML = canBuild ? '' : this._getMissingBuildingRequirementsHTML(bId);

            categoryContent += `<button data-btype="${bId}" class="text-left p-3 bg-glass-bg rounded-lg w-full ${buttonClasses} border border-primary-border" ${buttonDisabled}>
                <span class="font-bold text-yellow-400">${buildingData.name}</span>
                <p class="text-xs text-gray-400 mt-1">${buildingData.description.substring(0, 100)}...</p>
                ${requirementsHTML}
            </button>`;
        });

        if (categoryContent === '') {
            categoryContent = `<p class="text-gray-500 text-sm col-span-full text-center py-4">No hay edificios disponibles en esta categoría.</p>`;
        }
        
        contentContainer.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 gap-2">${categoryContent}</div>`;
    }

    _renderBuildingDetails() {
        const mainPanel = this.#panelElement.querySelector('#panel-main');
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return;
        
        const buildingState = activeVillage.buildings.find(b => b.id === this.#currentSlotId);
        const buildingStaticData = gameData.buildings[this.#viewingType];
        const currentLevel = (buildingState?.type === this.#viewingType) ? buildingState.level : 0;
        
        this.#panelElement.querySelector('#panel-title').textContent = `${buildingStaticData.name} (Nivel ${currentLevel})`;
        
        mainPanel.innerHTML = `<p class="mb-4 text-gray-300">${buildingStaticData.description}</p>
                             <div id="upgrade-info-container"></div>
                             <div id="building-details-content"></div>`;
        
        this._createCostsHTML();
        this._updateCosts();

        const contentContainer = mainPanel.querySelector('#building-details-content');
        const isMilitaryBuilding = ['barracks', 'stable', 'workshop', 'greatBarracks', 'greatStable', 'palace'].includes(this.#viewingType);
        
        if (this.#viewingType === 'smithy') {
            this._renderSmithyUpgrades(contentContainer);
        } else if (this.#viewingType === 'academy') {
            this._renderAcademyResearch(contentContainer);
        } else if (this.#viewingType === 'hospital') {
            this._renderHospitalUnits(contentContainer);
        } else if (this.#viewingType === 'heroMansion') {
            this._renderHeroMansionOases(contentContainer);
        } else if (isMilitaryBuilding) {
            this._renderTroopTraining(contentContainer);
        } else if (this.#viewingType === 'rallyPoint') {
            this._renderRallyPointFarmListPanel(contentContainer);
        } else if (this.#viewingType === 'marketplace') {
            this._renderNpcExchangePanel(contentContainer);
        }
    }

_renderNpcExchangePanel(container) {
  const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
  if (!activeVillage) return;

  const marketplace = activeVillage.buildings.find(b => b.type === 'marketplace');
  const merchantUnit = gameData.units[activeVillage.race]?.troops.find(t => t.type === 'merchant');
  const merchantCapacityPerUnit = getScaledMerchantCapacityPerUnit(
    activeVillage.race,
    this.#gameConfig?.gameSpeed || 1,
    merchantUnit?.stats.capacity || 0,
  );
  const totalMerchants = marketplace ? gameData.buildings.marketplace.levels[marketplace.level - 1].attribute.merchantCapacity : 0;
  const busyMerchants = activeVillage.merchantsBusy || 0;
  const availableMerchants = Math.max(0, totalMerchants - busyMerchants);

  const merchantIcon = `<img src="/icons/merchant.png" alt="Mercader" class="h-5 w-5 inline-block">`;
  const merchantsHTML = `
  <div class="flex items-center justify-between gap-3 p-3 rounded-lg bg-gray-900/50 border border-primary-border/50 mb-3">
    <div class="flex items-center gap-2">
      ${merchantIcon}
      <span class="font-semibold text-sm">Mercaderes</span>
    </div>
    <div class="text-right">
      <span class="font-mono font-bold text-lg ${availableMerchants === 0 ? 'text-yellow-400' : 'text-white'}">${availableMerchants}</span>
      <span class="text-gray-400">/ ${totalMerchants}</span>
      ${busyMerchants > 0 ? `<div class="text-xs text-yellow-400">${busyMerchants} en camino</div>` : ''}
      <div class="text-xs text-gray-400">Cap: ${formatNumber(merchantCapacityPerUnit)}/u</div>
    </div>
  </div>`;

  const resourcesHTML = RESOURCE_KEYS.map(resourceKey => {
            const resource = activeVillage.resources[resourceKey];
            const iconKey = RESOURCE_ICON_MAP[resourceKey];
            const current = Math.floor(resource?.current || 0);
            const capacity = Math.floor(resource?.capacity || 0);

            return `
                <div class="flex items-center gap-3 p-2 bg-gray-900/45 rounded-lg border border-primary-border/50">
                    <div class="w-8 h-8 flex items-center justify-center">${ICONS[iconKey]}</div>
                    <div class="flex-grow">
                        <div class="font-semibold text-sm text-white">${RESOURCE_LABELS[resourceKey]}</div>
                        <div class="text-xs text-gray-400">Actual: ${formatNumber(current)} / ${formatNumber(capacity)}</div>
                    </div>
                    <input data-npc-resource-input data-res="${resourceKey}" type="number" min="0" max="${capacity}" value="${current}" class="w-24 bg-gray-950 border border-primary-border text-white rounded-md p-1 text-center font-mono focus:ring-2 focus:ring-war-gold/60 focus:border-war-gold">
                    <button data-action="npc-max-resource" data-res="${resourceKey}" class="px-2 py-1 text-xs bg-btn-secondary-bg hover:bg-btn-secondary-hover rounded-md border border-primary-border">Máx</button>
                </div>`;
        }).join('');

  container.innerHTML = `
  <section id="npc-exchange-panel" class="border-t border-primary-border mt-4 pt-4 space-y-3">
    <div>
      <h3 class="text-lg font-bold text-war-gold">Mercado</h3>
    </div>
    ${merchantsHTML}
    <div>
      <h4 class="text-md font-bold text-war-gold">NPC de intercambio</h4>
      <p class="text-xs text-gray-400 mt-1">Redistribuye todos tus recursos actuales entre madera, barro, hierro y cereal. El próximo uso se desbloquea aleatoriamente cada 15-30 minutos, incluso si estás offline.</p>
    </div>
                <div id="npc-exchange-status" class="text-sm p-3 rounded-lg bg-gray-900/50 border border-primary-border/50"></div>
                <div class="space-y-2">${resourcesHTML}</div>
                <div class="flex justify-between text-sm bg-gray-900/45 rounded-lg p-3 border border-primary-border/50">
                    <span class="text-gray-400">Total asignado / disponible</span>
                    <span id="npc-exchange-total" class="font-mono font-semibold text-white"></span>
                </div>
                <button data-action="npc-exchange" id="npc-exchange-button" class="w-full bg-btn-primary-bg hover:bg-btn-primary-hover text-war-mist font-bold py-3 px-4 rounded-xl transition duration-300 disabled:bg-btn-secondary-bg disabled:cursor-not-allowed border border-primary-border">
                    Intercambiar recursos
                </button>
            </section>`;

        this._updateNpcExchangeState();
    }

    _getNpcExchangeTotals() {
        const activeVillage = this.#currentGameState?.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        const totalAvailable = RESOURCE_KEYS.reduce((sum, resourceKey) => {
            return sum + Math.floor(activeVillage?.resources?.[resourceKey]?.current || 0);
        }, 0);
        const inputs = this.#panelElement.querySelectorAll('[data-npc-resource-input]');
        const resources = {};
        let totalAssigned = 0;

        inputs.forEach(input => {
            const amount = Math.floor(Number(input.value) || 0);
            resources[input.dataset.res] = amount;
            totalAssigned += amount;
        });

        return { resources, totalAssigned, totalAvailable };
    }

    _formatRemainingTime(ms) {
        return formatTime(Math.ceil(Math.max(0, ms) / 1000));
    }

    _updateNpcExchangeState() {
        const panel = this.#panelElement.querySelector('#npc-exchange-panel');
        if (!panel) return;

        const activeVillage = this.#currentGameState?.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return;

        const { totalAssigned, totalAvailable } = this._getNpcExchangeTotals();
        const nextAvailableAt = Number(activeVillage.npcExchange?.nextAvailableAt) || 0;
        const remainingMs = nextAvailableAt - Date.now();
        const isAvailable = remainingMs <= 0;
        const totalsMatch = totalAssigned === totalAvailable;

        const totalEl = panel.querySelector('#npc-exchange-total');
        const statusEl = panel.querySelector('#npc-exchange-status');
        const button = panel.querySelector('#npc-exchange-button');

        if (totalEl) {
            totalEl.textContent = `${formatNumber(totalAssigned)} / ${formatNumber(totalAvailable)}`;
            totalEl.classList.toggle('text-green-400', totalsMatch);
            totalEl.classList.toggle('text-red-400', !totalsMatch);
        }

        if (statusEl) {
            statusEl.textContent = isAvailable
                ? 'Disponible ahora. Ajusta las cantidades y confirma el intercambio.'
                : `Disponible en ${this._formatRemainingTime(remainingMs)}.`;
            statusEl.classList.toggle('text-green-300', isAvailable);
            statusEl.classList.toggle('text-yellow-300', !isAvailable);
        }

        if (button) {
            button.disabled = !isAvailable || !totalsMatch || totalAvailable <= 0;
        }
    }

    _handleNpcResourceInput(input) {
        const max = Math.floor(Number(input.max) || 0);
        let value = Math.floor(Number(input.value) || 0);
        value = Math.max(0, Math.min(value, max));
        input.value = value > 0 ? value : '0';
    }

    _handleNpcMaxClick(resourceKey) {
        const targetInput = this.#panelElement.querySelector(`[data-npc-resource-input][data-res="${resourceKey}"]`);
        if (!targetInput) return;

        const inputs = Array.from(this.#panelElement.querySelectorAll('[data-npc-resource-input]'));
        const activeVillage = this.#currentGameState?.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        const totalAvailable = RESOURCE_KEYS.reduce((sum, key) => sum + Math.floor(activeVillage?.resources?.[key]?.current || 0), 0);
        const otherTotal = inputs
            .filter(input => input !== targetInput)
            .reduce((sum, input) => sum + (Math.floor(Number(input.value) || 0)), 0);
        const capacity = Math.floor(Number(targetInput.max) || 0);

        targetInput.value = Math.max(0, Math.min(capacity, totalAvailable - otherTotal));
        this._updateNpcExchangeState();
    }

    _handleNpcExchangeClick(activeVillageId) {
        const { resources, totalAssigned, totalAvailable } = this._getNpcExchangeTotals();
        if (totalAssigned !== totalAvailable) {
            toastUI.show('El total asignado debe coincidir con tus recursos actuales.', 'warning');
            return;
        }

        gameManager.sendCommand('npc_resource_exchange', {
            villageId: activeVillageId,
            resources,
        });
    }

    _handleNpcExchangeResult(payload) {
        const result = payload?.result;
        if (!result) return;
        const request = payload?.request || {};
        const isUnitOptimalExchange = request.mode === 'unit_optimal_exchange';

        if (result.success) {
            if (isUnitOptimalExchange) {
                const previousMax = formatNumber(request.currentMax || 0);
                const exchangeMax = formatNumber(request.exchangeMax || 0);
                toastUI.show(`Intercambio optimo aplicado para ${request.unitName || 'la unidad'}: ${previousMax} -> ${exchangeMax} reclutables.`, 'success');
                return;
            }
            toastUI.show('Intercambio NPC completado correctamente.', 'success');
            return;
        }

        const messages = {
            MARKETPLACE_REQUIRED: 'Necesitas un Mercado construido para usar el intercambio NPC.',
            NPC_EXCHANGE_COOLDOWN: 'El NPC de intercambio aún no está disponible.',
            NPC_EXCHANGE_TOTAL_MISMATCH: 'El total asignado no coincide con tus recursos actuales.',
            RESOURCE_CAPACITY_EXCEEDED: 'Una cantidad supera la capacidad de almacenamiento.',
            INVALID_RESOURCE_DISTRIBUTION: 'La distribución de recursos no es válida.',
            INVALID_RESOURCE_AMOUNT: 'Una cantidad de recursos no es válida.',
        };
        const fallbackMessage = isUnitOptimalExchange
            ? `No se pudo aplicar el intercambio optimo para ${request.unitName || 'la unidad'}.`
            : 'No se pudo completar el intercambio NPC.';
        toastUI.show(messages[result.reason] || fallbackMessage, 'error');
    }

    _getHeroMansionOasisSlots(activeVillage) {
        const level = activeVillage?.buildings.find(building => building.type === 'heroMansion')?.level || 0;
        if (level >= 20) return 3;
        if (level >= 15) return 2;
        if (level >= 10) return 1;
        return 0;
    }

    _getPendingOasisCaptureCount(activeVillage) {
        return (this.#currentGameState?.movements || []).filter(movement => {
            return movement.originVillageId === activeVillage?.id
                && movement.type === 'attack'
                && movement.payload?.conquerOasis === true;
        }).length;
    }

    _renderHeroMansionOases(container) {
        container.innerHTML = `<div class="border-t border-primary-border mt-4 pt-4" id="hero-mansion-oases-panel"></div>`;
        this._updateHeroMansionOases();
    }

    _updateHeroMansionOases() {
        const panel = this.#panelElement.querySelector('#hero-mansion-oases-panel');
        if (!panel) return;

        const activeVillage = this.#currentGameState?.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return;

        const oases = activeVillage.oases || [];
        const slots = this._getHeroMansionOasisSlots(activeVillage);
        const pendingCaptures = this._getPendingOasisCaptureCount(activeVillage);

        const rows = oases.map(oasis => {
            const oasisType = gameData.oasisTypes[oasis.oasisType] || gameData.oasisTypes[this.#currentGameState.mapData.find(tile => tile.x === oasis.x && tile.y === oasis.y)?.oasisType];
            const bonus = oasisType?.bonus || {};
            const iconKey = RESOURCE_ICON_MAP[bonus.resource] || 'wheat';
            return `
                <div class="flex items-center gap-3 rounded-lg border border-primary-border bg-glass-bg p-3">
                    <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-900/60 border border-primary-border/60">${ICONS[iconKey] || ICONS.wheat}</div>
                    <div class="min-w-0 flex-grow">
                        <div class="font-semibold text-white truncate">${oasisType?.name || 'Oasis'}</div>
                        <div class="text-xs text-gray-400">(${oasis.x}|${oasis.y}) · +${bonus.percentage || 0}% ${RESOURCE_LABELS[bonus.resource] || 'recurso'}</div>
                    </div>
                    <button data-action="release-oasis" data-x="${oasis.x}" data-y="${oasis.y}" class="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/35 bg-red-950/50 text-red-100 hover:bg-red-900/70 focus:outline-none focus:ring-2 focus:ring-red-400/60" title="Soltar oasis" aria-label="Soltar oasis (${oasis.x}|${oasis.y})">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>`;
        }).join('');

        panel.innerHTML = `
            <div class="flex items-center justify-between gap-3 mb-2">
                <h3 class="font-bold text-gray-400">Oasis anexados</h3>
                <span class="text-xs text-gray-400">${oases.length + pendingCaptures}/${slots} slots</span>
            </div>
            ${pendingCaptures > 0 ? `<p class="text-xs text-yellow-300 mb-2">${pendingCaptures} conquista(s) de oasis en camino ocupan slot temporalmente.</p>` : ''}
            <div class="space-y-2">${rows || '<p class="text-center text-gray-500 text-sm py-4">Esta aldea no tiene oasis anexados.</p>'}</div>
        `;
    }

    _handleReleaseOasisClick(button) {
        const activeVillageId = this.#currentGameState?.activeVillageId;
        const x = Number(button.dataset.x);
        const y = Number(button.dataset.y);
        if (!activeVillageId || !Number.isFinite(x) || !Number.isFinite(y)) return;

        button.disabled = true;
        gameManager.sendCommand('release_oasis', { villageId: activeVillageId, x, y });
    }

    _handleReleaseOasisResult(payload) {
        const result = payload?.result;
        if (!result) return;

        if (result.success) {
            const oasis = result.oasis || payload.request || {};
            toastUI.show(`Oasis (${oasis.x}|${oasis.y}) liberado correctamente.`, 'success');
            this._updateHeroMansionOases();
            return;
        }

        const messages = {
            INVALID_PAYLOAD: 'No se pudo identificar el oasis a soltar.',
            VILLAGE_NOT_FOUND: 'No se encontro la aldea activa.',
            OASIS_NOT_OWNED_BY_VILLAGE: 'Ese oasis no pertenece a esta aldea.',
            OASIS_TILE_NOT_FOUND: 'No se encontro el oasis en el mapa.',
        };
        toastUI.show(messages[result.reason] || 'No se pudo soltar el oasis.', 'error');
        this._updateHeroMansionOases();
    }

    _getBenefitText(attribute, currentValue, nextValue, context = {}) {
        if (!attribute) return '';
        const formatBenefit = (label, current, next, unit = '') => 
            `<li>${label}: <span class="font-mono text-gray-300">${current}${unit}</span> -> <span class="font-mono text-green-400">${next}${unit}</span></li>`;

        if (attribute.storageCapacity) {
            return formatBenefit('Capacidad', formatNumber(currentValue), formatNumber(nextValue));
        }
        if (attribute.hidingCapacity) {
            return formatBenefit('Escondite', formatNumber(currentValue), formatNumber(nextValue));
        }
        if (attribute.productionBonusPercent) {
            return formatBenefit('Bono de producción', `${currentValue}%`, `${nextValue}%`);
        }
        if (attribute.oasisBonusMultiplierPercent) {
            return formatBenefit('Bono sobre oasis', `+${currentValue}%`, `+${nextValue}%`);
        }
        if (attribute.trainingTimeFactor) {
            const currentReduction = (1 - currentValue) * 100;
            const nextReduction = (1 - nextValue) * 100;
            return formatBenefit('Reducción tiempo de entr.', `${currentReduction.toFixed(1)}%`, `${nextReduction.toFixed(1)}%`);
        }
        if (attribute.constructionTimeFactor) {
            const currentReduction = (1 - currentValue) * 100;
            const nextReduction = (1 - nextValue) * 100;
            return formatBenefit('Reducción tiempo de const.', `${currentReduction.toFixed(1)}%`, `${nextReduction.toFixed(1)}%`);
        }
        if (attribute.defenseBonusPercent) {
            return formatBenefit('Bono de defensa', `${currentValue}%`, `${nextValue}%`);
        }
        if (attribute.merchantCapacity) {
            const currentPerMerchant = Math.max(0, Number(context.currentPerMerchant) || 0);
            const nextPerMerchant = Math.max(0, Number(context.nextPerMerchant) || 0);
            const currentTotalCapacity = currentValue * currentPerMerchant;
            const nextTotalCapacity = nextValue * nextPerMerchant;

            return [
                formatBenefit('Mercaderes', currentValue, nextValue),
                formatBenefit('Cap. por mercader', formatNumber(currentPerMerchant), formatNumber(nextPerMerchant)),
                formatBenefit('Capacidad total', formatNumber(currentTotalCapacity), formatNumber(nextTotalCapacity)),
            ].join('');
        }
        if (attribute.memberSlots) {
            return formatBenefit('Miembros de alianza', currentValue, nextValue);
        }
        if (attribute.speedBonusPercent) {
            return formatBenefit('Bono de velocidad', `+${currentValue}%`, `+${nextValue}%`);
        }
        if (attribute.oasisSlots) {
            return formatBenefit('Oasis conquistables', currentValue, nextValue);
        }
        return '';
    }

    _formatCurrentBenefitText(label, value, unit = '') {
        return `<li>${label}: <span class="font-mono text-green-400">${value}${unit}</span></li>`;
    }

    _getBenefitsHTML(buildingData, currentLevel, nextLevelData, activeVillage) {
        if (!nextLevelData) return '';
    
        const currentLevelData = currentLevel > 0 ? buildingData.levels[currentLevel - 1] : null;
        let benefitsList = '';
        const activeRace = activeVillage?.race || '';
        const gameSpeed = this.#gameConfig?.gameSpeed || 1;
    
        if (nextLevelData.production) {
            const resType = Object.keys(nextLevelData.production)[0];
            const currentProd = currentLevelData?.production?.[resType] || 0;
            const nextProd = nextLevelData.production[resType];

            const displayCurrentProd = Math.round(currentProd * this.#gameConfig.gameSpeed);
            const displayNextProd = Math.round(nextProd * this.#gameConfig.gameSpeed);

            benefitsList += `<li>Producción: <span class="font-mono text-gray-300">${formatNumber(displayCurrentProd)}/hr</span> -> <span class="font-mono text-green-400">${formatNumber(displayNextProd)}/hr</span></li>`;
        }
    
        if (nextLevelData.attribute) {
            for (const key in nextLevelData.attribute) {
                const isFactor = key.includes('Factor');
                const rawCurrentValue = currentLevelData?.attribute?.[key] || (isFactor ? 1.0 : 0);
                const rawNextValue = nextLevelData.attribute[key];
                let currentValue = rawCurrentValue;
                let nextValue = rawNextValue;
                let context = {};

                if (key === 'storageCapacity') {
                    currentValue = scaleCapacityByGameSpeed(rawCurrentValue, gameSpeed);
                    nextValue = scaleCapacityByGameSpeed(rawNextValue, gameSpeed);
                } else if (key === 'hidingCapacity') {
                    currentValue = getScaledCrannyCapacity(rawCurrentValue, activeRace, gameSpeed);
                    nextValue = getScaledCrannyCapacity(rawNextValue, activeRace, gameSpeed);
                } else if (key === 'merchantCapacity') {
                    const merchantUnit = gameData.units[activeRace]?.troops.find(unit => unit.type === 'merchant');
                    const perMerchantCapacity = getScaledMerchantCapacityPerUnit(
                        activeRace,
                        gameSpeed,
                        merchantUnit?.stats?.capacity || 0,
                    );
                    context = {
                        currentPerMerchant: perMerchantCapacity,
                        nextPerMerchant: perMerchantCapacity,
                    };
                }

                benefitsList += this._getBenefitText({ [key]: true }, currentValue, nextValue, context);
            }
        }

        return benefitsList ? `<div class="p-3 bg-glass-bg rounded-lg text-blue-200 text-sm mb-4 border border-primary-border"><ul>${benefitsList}</ul></div>` : '';
    }

    _getMaxLevelBenefitsHTML(buildingData, currentLevel, activeVillage) {
        if (!buildingData || currentLevel <= 0) return '';

        const currentLevelData = buildingData.levels[currentLevel - 1];
        if (!currentLevelData) return '';

        const activeRace = activeVillage?.race || '';
        const gameSpeed = this.#gameConfig?.gameSpeed || 1;
        let benefitsList = '';

        if (currentLevelData.production) {
            const resType = Object.keys(currentLevelData.production)[0];
            const rawProduction = Number(currentLevelData.production[resType]) || 0;
            const displayProduction = Math.round(rawProduction * gameSpeed);
            benefitsList += this._formatCurrentBenefitText('Produccion', `${formatNumber(displayProduction)}/hr`);
        }

        const attributes = currentLevelData.attribute || {};
        for (const key in attributes) {
            const rawValue = attributes[key];

            if (key === 'storageCapacity') {
                benefitsList += this._formatCurrentBenefitText('Capacidad', formatNumber(scaleCapacityByGameSpeed(rawValue, gameSpeed)));
                continue;
            }

            if (key === 'hidingCapacity') {
                benefitsList += this._formatCurrentBenefitText('Escondite', formatNumber(getScaledCrannyCapacity(rawValue, activeRace, gameSpeed)));
                continue;
            }

            if (key === 'productionBonusPercent') {
                benefitsList += this._formatCurrentBenefitText('Bono de produccion', `${rawValue}%`);
                continue;
            }

            if (key === 'oasisBonusMultiplierPercent') {
                benefitsList += this._formatCurrentBenefitText('Bono sobre oasis', `+${rawValue}%`);
                continue;
            }

            if (key === 'trainingTimeFactor') {
                const reduction = (1 - rawValue) * 100;
                benefitsList += this._formatCurrentBenefitText('Reduccion tiempo de entr.', `${reduction.toFixed(1)}%`);
                continue;
            }

            if (key === 'constructionTimeFactor') {
                const reduction = (1 - rawValue) * 100;
                benefitsList += this._formatCurrentBenefitText('Reduccion tiempo de const.', `${reduction.toFixed(1)}%`);
                continue;
            }

            if (key === 'defenseBonusPercent') {
                benefitsList += this._formatCurrentBenefitText('Bono de defensa', `${rawValue}%`);
                continue;
            }

            if (key === 'merchantCapacity') {
                const merchantUnit = gameData.units[activeRace]?.troops.find(unit => unit.type === 'merchant');
                const perMerchantCapacity = getScaledMerchantCapacityPerUnit(
                    activeRace,
                    gameSpeed,
                    merchantUnit?.stats?.capacity || 0,
                );
                const totalCapacity = Number(rawValue || 0) * perMerchantCapacity;

                benefitsList += this._formatCurrentBenefitText('Mercaderes', Number(rawValue || 0));
                benefitsList += this._formatCurrentBenefitText('Cap. por mercader', formatNumber(perMerchantCapacity));
                benefitsList += this._formatCurrentBenefitText('Capacidad total', formatNumber(totalCapacity));
                continue;
            }

            if (key === 'memberSlots') {
                benefitsList += this._formatCurrentBenefitText('Miembros de alianza', Number(rawValue || 0));
                continue;
            }

            if (key === 'speedBonusPercent') {
                benefitsList += this._formatCurrentBenefitText('Bono de velocidad', `+${rawValue}%`);
                continue;
            }

            if (key === 'oasisSlots') {
                benefitsList += this._formatCurrentBenefitText('Oasis conquistables', Number(rawValue || 0));
                continue;
            }

            benefitsList += this._formatCurrentBenefitText(key, String(rawValue));
        }

        if (!benefitsList) {
            return '';
        }

        return `<div class="p-3 bg-glass-bg rounded-lg text-blue-200 text-sm mb-4 border border-primary-border"><h3 class="font-bold mb-2 text-gray-300">Bonificacion actual (nivel maximo)</h3><ul>${benefitsList}</ul></div>`;
    }
    
    _createCostsHTML() {
        const upgradeInfoContainer = this.#panelElement.querySelector('#upgrade-info-container');
        if (!upgradeInfoContainer) return;

        let costsHTML = '<div id="benefits-container"></div>';
        costsHTML += '<h3 class="font-bold mb-1 text-gray-400">Costes de Mejora</h3><div class="grid grid-cols-2 gap-x-4 gap-y-2">';
        const costKeys = ['wood', 'stone', 'iron', 'food', 'time', 'population'];

        for (const key of costKeys) {
            const iconKey = RESOURCE_ICON_MAP[key] || key;
            costsHTML += `<div class="flex items-center gap-2 p-2 bg-glass-bg rounded-md border border-primary-border" data-cost-key="${key}">
                <span class="text-yellow-400">${ICONS[iconKey]}</span>
                <span class="font-semibold" data-cost-value></span>
                <span class="ml-auto text-xs text-gray-400" data-player-amount></span>
            </div>`;
        }
        costsHTML += '</div>';
        upgradeInfoContainer.innerHTML = costsHTML;
    }

    _updateCosts() {
        if (!this.#currentGameState || !this.#viewingType) return;
        
        const buildingStaticData = gameData.buildings[this.#viewingType];
        if (!buildingStaticData) return;

        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return;

        const buildingState = activeVillage.buildings.find(b => b.id === this.#currentSlotId);
        
        const currentLevelOnRecord = (buildingState?.type === this.#viewingType) ? buildingState.level : 0;
        const queuedJobsForSlot = activeVillage.constructionQueue.filter(j => j.buildingId === this.#currentSlotId);
        const highestQueuedLevel = queuedJobsForSlot.length > 0 ? Math.max(...queuedJobsForSlot.map(j => j.targetLevel)) : 0;
        const effectiveCurrentLevel = Math.max(currentLevelOnRecord, highestQueuedLevel);

        const nextLevel = effectiveCurrentLevel + 1;
        const nextLevelData = buildingStaticData.levels[nextLevel - 1];
        
        this.#panelElement.querySelector('#panel-title').textContent = `${buildingStaticData.name} (Nivel ${effectiveCurrentLevel})`;
        
        const footer = this.#panelElement.querySelector('#panel-footer');
        const upgradeInfoContainer = this.#panelElement.querySelector('#upgrade-info-container');
        if (!upgradeInfoContainer) return;

        const demolishButton = this.#panelElement.querySelector('#demolish-button');
        const demolitionState = this._getDemolitionState(activeVillage, buildingState, queuedJobsForSlot);
        if (demolishButton) {
            demolishButton.disabled = !demolitionState.canDemolish;
            const demolishLabel = demolishButton.querySelector('span');
            if (demolishLabel) {
                demolishLabel.textContent = demolitionState.demolitionUnlocked
                    ? `Demoler a Nivel ${demolitionState.targetLevel}`
                    : 'Requiere Edificio Principal Nivel 10';
            }
            demolishButton.title = demolitionState.demolitionUnlocked
                ? 'Demoler no devuelve recursos y tarda la mitad que construir este nivel.'
                : 'Sube el Edificio Principal a Nivel 10 para desbloquear demolición.';
        }

        if (!nextLevelData) {
            const maxBenefitsHTML = this._getMaxLevelBenefitsHTML(buildingStaticData, effectiveCurrentLevel, activeVillage);
            upgradeInfoContainer.innerHTML = `${maxBenefitsHTML}<div class="text-center p-4 max-level-notice">Este edificio ha alcanzado su maximo nivel.</div>`;
            footer.classList.toggle('hidden', !demolitionState.canDemolish && !demolitionState.demolitionUnlocked);
            const upgradeButton = this.#panelElement.querySelector('#upgrade-button');
            if (upgradeButton) upgradeButton.classList.add('hidden');
            return;
        }
        
        footer.classList.remove('hidden');

        const benefitsContainer = upgradeInfoContainer.querySelector('#benefits-container');
        if (benefitsContainer) {
            benefitsContainer.innerHTML = this._getBenefitsHTML(buildingStaticData, effectiveCurrentLevel, nextLevelData, activeVillage);
        }

        const costs = { ...nextLevelData.cost, time: this._getFinalBuildTime(nextLevelData.buildTime), population: nextLevelData.population };
        let canAfford = true;

        for (const key in costs) {
            const value = costs[key];
            const costElement = upgradeInfoContainer.querySelector(`[data-cost-key="${key}"]`);
            if (!costElement) continue;

            const valueSpan = costElement.querySelector('[data-cost-value]');
            const playerAmountSpan = costElement.querySelector('[data-player-amount]');
            
            const playerAmount = activeVillage.resources[key]?.current;
            const isMet = (playerAmount === undefined) || (playerAmount >= value);
            if (key !== 'time' && key !== 'population' && !isMet) canAfford = false;
            
            valueSpan.textContent = key === 'time' ? formatTime(value) : formatNumber(value);
            valueSpan.classList.toggle('text-green-400', isMet || key === 'time' || key === 'population');
            valueSpan.classList.toggle('text-red-500', !isMet && key !== 'time' && key !== 'population');
            
            if (playerAmount !== undefined && key !== 'time' && key !== 'population') {
                playerAmountSpan.textContent = `(${formatNumber(playerAmount)})`;
            } else {
                playerAmountSpan.textContent = '';
            }
        }
        
        const upgradeButton = this.#panelElement.querySelector('#upgrade-button');
        upgradeButton.classList.remove('hidden');
        const requirementsMet = this._checkRequirements(this.#viewingType);
        const hasDemolitionQueued = queuedJobsForSlot.some(job => job.jobType === 'demolition');
        upgradeButton.disabled = !canAfford || !requirementsMet || hasDemolitionQueued;
        upgradeButton.textContent = currentLevelOnRecord === 0 ? `Construir a Nivel 1` : `Subir a Nivel ${nextLevel}`;
    }
    
    _checkUnitResearchRequirements(unitId) {
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return false;

        const unitData = gameData.units[activeVillage.race]?.troops.find(t => t.id === unitId);
        
        const requirements = unitData?.research?.requires;
        if (!requirements) return true;
        
        for (const reqBuildingType in requirements) {
            const requiredLevel = requirements[reqBuildingType];
            const playerBuilding = activeVillage.buildings.find(b => b.type === reqBuildingType);
            const playerLevel = playerBuilding ? playerBuilding.level : 0;
            if (playerLevel < requiredLevel) return false;
        }
        return true;
    }

    _getUnitNameButtonHTML(unit) {
        return `<button data-action="unit-info" data-unit-id="${unit.id}" class="text-left font-bold text-yellow-400 hover:text-yellow-200 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-war-gold/70 rounded px-1 -ml-1">${unit.name}</button>`;
    }

    _getUnitHeaderHTML(unit, { showExchange = false } = {}) {
        return `<div class="inline-flex items-center gap-1.5 min-w-0 align-middle leading-none">
            ${this._getUnitNameButtonHTML(unit)}
            ${showExchange ? `<button data-action="optimize-unit-exchange" data-unit-id="${unit.id}" class="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-md text-amber-200 hover:bg-amber-500/15 focus:outline-none focus:ring-1 focus:ring-war-gold/70" title="Intercambio optimo para reclutar mas ${unit.name}" aria-label="Intercambio optimo para ${unit.name}">${ICONS.exchange}</button>` : ''}
        </div>`;
    }

    _getUnitTotalCost(cost = {}) {
        return RESOURCE_KEYS.reduce((sum, resourceKey) => sum + Math.max(0, Number(cost[resourceKey]) || 0), 0);
    }

    _getCurrentResourceSnapshot(activeVillage) {
        return RESOURCE_KEYS.reduce((snapshot, resourceKey) => {
            snapshot[resourceKey] = Math.floor(Number(activeVillage.resources?.[resourceKey]?.current) || 0);
            return snapshot;
        }, {});
    }

    _getMaxAffordableUnitCount(unitCost = {}, resources = {}) {
        let maxAffordable = Infinity;
        for (const resourceKey of RESOURCE_KEYS) {
            const cost = Math.max(0, Number(unitCost[resourceKey]) || 0);
            if (cost <= 0) continue;
            maxAffordable = Math.min(maxAffordable, Math.floor((resources[resourceKey] || 0) / cost));
        }
        return Number.isFinite(maxAffordable) ? Math.max(0, maxAffordable) : 0;
    }

    _getOptimalUnitExchangeResources(unit, activeVillage) {
        const unitCost = unit?.cost || {};
        const totalCost = this._getUnitTotalCost(unitCost);
        if (totalCost <= 0) return { success: false, reason: 'INVALID_UNIT_COST' };

        const currentResources = this._getCurrentResourceSnapshot(activeVillage);
        const totalResources = RESOURCE_KEYS.reduce((sum, resourceKey) => sum + currentResources[resourceKey], 0);
        const capacities = RESOURCE_KEYS.reduce((snapshot, resourceKey) => {
            snapshot[resourceKey] = Math.floor(Number(activeVillage.resources?.[resourceKey]?.capacity) || 0);
            return snapshot;
        }, {});

        const currentMax = this._getMaxAffordableUnitCount(unitCost, currentResources);
        let exchangeMax = Math.floor(totalResources / totalCost);
        for (const resourceKey of RESOURCE_KEYS) {
            const cost = Math.max(0, Number(unitCost[resourceKey]) || 0);
            if (cost > 0) exchangeMax = Math.min(exchangeMax, Math.floor(capacities[resourceKey] / cost));
        }

        if (!Number.isFinite(exchangeMax) || exchangeMax <= 0) {
            return { success: false, reason: 'NOT_ENOUGH_TOTAL_RESOURCES', currentMax, exchangeMax: 0 };
        }
        if (exchangeMax <= currentMax) {
            return { success: false, reason: 'NO_EFFICIENCY_GAIN', currentMax, exchangeMax };
        }

        const resources = {};
        let allocated = 0;
        for (const resourceKey of RESOURCE_KEYS) {
            resources[resourceKey] = Math.max(0, Number(unitCost[resourceKey]) || 0) * exchangeMax;
            allocated += resources[resourceKey];
        }

        let remaining = totalResources - allocated;
        const preferredResources = RESOURCE_KEYS.slice().sort((a, b) => (unitCost[b] || 0) - (unitCost[a] || 0));
        for (const resourceKey of preferredResources) {
            if (remaining <= 0) break;
            const availableCapacity = Math.max(0, capacities[resourceKey] - resources[resourceKey]);
            const amount = Math.min(remaining, availableCapacity);
            resources[resourceKey] += amount;
            remaining -= amount;
        }

        if (remaining > 0) {
            return { success: false, reason: 'RESOURCE_CAPACITY_EXCEEDED', currentMax, exchangeMax };
        }

        return { success: true, resources, currentMax, exchangeMax };
    }

    _handleOptimizeUnitExchange(unitId, activeVillageId) {
        const activeVillage = this.#currentGameState?.villages.find(v => v.id === activeVillageId);
        if (!activeVillage || !unitId) return;

        const unit = gameData.units[activeVillage.race]?.troops.find(troop => troop.id === unitId);
        if (!unit) {
            toastUI.show('No se encontro la unidad para optimizar recursos.', 'error');
            return;
        }

        const exchange = this._getOptimalUnitExchangeResources(unit, activeVillage);
        if (!exchange.success) {
            const messages = {
                INVALID_UNIT_COST: 'Esta unidad no tiene un coste valido para intercambio.',
                NOT_ENOUGH_TOTAL_RESOURCES: `No hay recursos totales suficientes para optimizar ${unit.name}.`,
                NO_EFFICIENCY_GAIN: `La distribucion actual ya permite reclutar ${exchange.currentMax || 0} ${unit.name}; el intercambio no mejora el resultado.`,
                RESOURCE_CAPACITY_EXCEEDED: 'No hay capacidad suficiente para guardar la distribucion optima.',
            };
            toastUI.show(messages[exchange.reason] || 'No se pudo calcular el intercambio optimo.', 'warning');
            return;
        }

        gameManager.sendCommand('npc_resource_exchange', {
            villageId: activeVillageId,
            resources: exchange.resources,
            mode: 'unit_optimal_exchange',
            unitId,
            unitName: unit.name,
            currentMax: exchange.currentMax,
            exchangeMax: exchange.exchangeMax,
        });
    }

    _formatPreciseTime(totalSeconds) {
        if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0s';

        let remainingMs = Math.round(totalSeconds * 1000);
        const days = Math.floor(remainingMs / 86400000);
        remainingMs %= 86400000;
        const hours = Math.floor(remainingMs / 3600000);
        remainingMs %= 3600000;
        const minutes = Math.floor(remainingMs / 60000);
        remainingMs %= 60000;
        const seconds = Math.floor(remainingMs / 1000);
        const milliseconds = remainingMs % 1000;

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}min`);
        if (seconds > 0) parts.push(`${seconds}s`);
        if (milliseconds > 0) parts.push(`${milliseconds}ms`);

        return parts.join(' ') || '0ms';
    }

    _getUnitTrainingTime(unit, activeVillage) {
        let trainingTimeFactor = 1.0;
        const trainingBuildingsByType = {
            infantry: ['barracks', 'greatBarracks'],
            cavalry: ['stable', 'greatStable'],
            scout: ['stable', 'greatStable'],
            siege: ['workshop'],
            settler: ['palace'],
            chief: ['palace'],
        };
        const candidateTypes = trainingBuildingsByType[unit.type] || [];
        const preferredBuilding = candidateTypes.includes(this.#viewingType)
            ? activeVillage.buildings.find(building => building.id === this.#currentSlotId && building.type === this.#viewingType)
            : activeVillage.buildings.find(building => candidateTypes.includes(building.type));

        if (preferredBuilding?.level > 0) {
            trainingTimeFactor = gameData.buildings[preferredBuilding.type]?.levels[preferredBuilding.level - 1]?.attribute?.trainingTimeFactor || 1.0;
        }

        return (unit.trainTime / trainingTimeFactor) / this.#gameConfig.gameSpeed;
    }

    _getUnitContextDetails(unit, activeVillage) {
        if (this.#viewingType === 'academy' && unit.research) {
            return {
                title: 'Investigacion',
                cost: unit.research.cost,
                time: unit.research.time / this.#gameConfig.gameSpeed,
            };
        }

        if (this.#viewingType === 'smithy') {
            const currentUpgradeLevel = activeVillage.smithy?.upgrades?.[unit.id] || 0;
            return {
                title: `Mejora a nivel ${currentUpgradeLevel + 1}`,
                cost: this._calculateSmithyUpgradeCost(unit, currentUpgradeLevel + 1),
                time: unit.trainTime / this.#gameConfig.gameSpeed,
            };
        }

        return {
            title: 'Entrenamiento',
            cost: unit.cost || {},
            time: this._getUnitTrainingTime(unit, activeVillage),
        };
    }

    _getCostGridHTML(cost = {}) {
        return RESOURCE_KEYS.map(resourceKey => `
            <div class="flex items-center gap-2 rounded-lg bg-gray-900/60 border border-primary-border/60 p-2" title="${RESOURCE_LABELS[resourceKey]}">
                ${ICONS[RESOURCE_ICON_MAP[resourceKey]]}
                <span class="text-gray-300">${formatNumber(cost[resourceKey] || 0)}</span>
            </div>
        `).join('');
    }

    _showUnitInfoModal(unitId) {
        const activeVillage = this.#currentGameState?.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage || !unitId) return;

        const unit = gameData.units[activeVillage.race]?.troops.find(troop => troop.id === unitId);
        if (!unit) return;

        const modal = this.#panelElement.querySelector('#unit-info-modal');
        const title = modal.querySelector('#unit-info-title');
        const subtitle = modal.querySelector('#unit-info-subtitle');
        const content = modal.querySelector('#unit-info-content');
        const contextDetails = this._getUnitContextDetails(unit, activeVillage);
        const stats = unit.stats || {};
        const defense = stats.defense || {};

        title.textContent = unit.name;
        subtitle.textContent = `${UNIT_TYPE_LABELS[unit.type] || unit.type || 'Unidad'} · ${UNIT_ROLE_LABELS[unit.role] || unit.role || 'Sin rol definido'}`;
        content.innerHTML = `
            <div class="flex items-start gap-3">
                <div class="shrink-0 mt-1">${unitSpriteManager.getUnitSprite(unit.id, activeVillage.race)}</div>
                <p class="text-sm leading-6 text-gray-300">${unit.description || 'Sin descripcion disponible.'}</p>
            </div>

            <section class="rounded-xl border border-primary-border bg-glass-bg p-3">
                <h4 class="font-bold text-gray-200 mb-2">${contextDetails.title}</h4>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm mb-3">
                    ${this._getCostGridHTML(contextDetails.cost)}
                </div>
                <div class="flex items-center gap-2 rounded-lg bg-gray-900/60 border border-primary-border/60 p-2 text-sm">
                    ${ICONS.time}
                    <span class="text-gray-400">Tiempo:</span>
                    <span class="font-mono text-white">${this._formatPreciseTime(contextDetails.time)}</span>
                </div>
            </section>

            <section class="rounded-xl border border-primary-border bg-glass-bg p-3">
                <h4 class="font-bold text-gray-200 mb-2">Estadisticas</h4>
                <div class="grid grid-cols-2 gap-2 text-sm">
                    <div class="rounded-lg bg-gray-900/60 border border-primary-border/60 p-2"><span class="text-gray-400">Ataque</span><div class="font-mono text-white">${formatNumber(stats.attack || 0)}</div></div>
                    <div class="rounded-lg bg-gray-900/60 border border-primary-border/60 p-2"><span class="text-gray-400">Def. infanteria</span><div class="font-mono text-white">${formatNumber(defense.infantry || 0)}</div></div>
                    <div class="rounded-lg bg-gray-900/60 border border-primary-border/60 p-2"><span class="text-gray-400">Def. caballeria</span><div class="font-mono text-white">${formatNumber(defense.cavalry || 0)}</div></div>
                    <div class="rounded-lg bg-gray-900/60 border border-primary-border/60 p-2"><span class="text-gray-400">Velocidad</span><div class="font-mono text-white">${formatNumber(stats.speed || 0)} casillas/h</div></div>
                    <div class="rounded-lg bg-gray-900/60 border border-primary-border/60 p-2"><span class="text-gray-400">Carga</span><div class="font-mono text-white">${formatNumber(stats.capacity || 0)}</div></div>
                    <div class="rounded-lg bg-gray-900/60 border border-primary-border/60 p-2"><span class="text-gray-400">Consumo</span><div class="font-mono text-white">${formatNumber(unit.upkeep || 0)} cereal/h</div></div>
                </div>
            </section>
        `;

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    _hideUnitInfoModal() {
        const modal = this.#panelElement.querySelector('#unit-info-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    _renderHospitalUnits(container) {
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return;

        const combatUnits = gameData.units[activeVillage.race]?.troops.filter(unit => ['infantry', 'cavalry', 'siege', 'scout'].includes(unit.type)) || [];
        const unitRows = combatUnits.map(unit => `
            <div class="flex items-center justify-between gap-3 p-3 bg-glass-bg rounded-lg border border-primary-border" data-unit-id="${unit.id}">
                <div class="flex items-center gap-3 min-w-0">
                    ${unitSpriteManager.getUnitSprite(unit.id, activeVillage.race)}
                    ${this._getUnitHeaderHTML(unit, { showExchange: true })}
                </div>
                <span class="text-xs text-gray-400">${UNIT_TYPE_LABELS[unit.type] || unit.type}</span>
            </div>
        `).join('');

        container.innerHTML = `<div class="border-t border-primary-border mt-4 pt-4">
            <h3 class="font-bold mb-2 text-gray-400">Unidades</h3>
            <p class="text-xs text-gray-500 mb-3">Haz click en el nombre de una unidad para ver costes, tiempo preciso y estadisticas.</p>
            <div class="space-y-2">${unitRows || '<p class="text-center text-gray-500 text-sm py-4">No hay unidades disponibles.</p>'}</div>
        </div>`;
    }

    _renderUnitToggleCheckbox(container, updateFunction) {
        const label = this.#viewingType === 'academy' ? 'Mostrar todas las unidades' : 'Mostrar no investigadas';
        container.innerHTML = `
            <div class="flex items-center justify-end my-2">
                <label for="show-all-units-toggle" class="text-xs text-gray-400 mr-2 cursor-pointer">${label}</label>
                <input type="checkbox" id="show-all-units-toggle" class="bg-btn-secondary-bg border-primary-border text-blue-500 rounded focus:ring-2 focus:ring-blue-500/50 cursor-pointer">
            </div>
            <div id="unit-list" class="space-y-3"></div>`;

        const toggle = container.querySelector('#show-all-units-toggle');
        toggle.checked = this.#showAllUnits;
        toggle.addEventListener('change', (e) => {
            this.#showAllUnits = e.currentTarget.checked;
            updateFunction();
        });
    }

    _renderAcademyResearch(container) {
        container.innerHTML = `<div class="border-t border-primary-border mt-4 pt-4">
                                <h3 class="font-bold mb-2 text-gray-400">Investigar Unidades</h3>
                                <div id="unit-list-container"></div>
                            </div>`;
        const listContainer = container.querySelector('#unit-list-container');
        this._renderUnitToggleCheckbox(listContainer, this._updateAcademyList.bind(this));
        this._updateAcademyList();
    }
    
    _updateAcademyList() {
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return;
        
        const allUnits = gameData.units[activeVillage.race].troops.filter(u => u.research && u.research.time > 0);
        const listContainer = this.#panelElement.querySelector('#unit-list');
        if (!listContainer) return;

        let unitsToShowHTML = '';
        for (const unit of allUnits) {
            const isResearched = activeVillage.research.completed.includes(unit.id);
            const isInQueue = activeVillage.research.queue.some(j => j.unitId === unit.id);
            const requirementsMet = this._checkUnitResearchRequirements(unit.id);

            if (!requirementsMet && !this.#showAllUnits) continue;

            let buttonHTML = '';
            const disabledClasses = !requirementsMet || isResearched || isInQueue ? 'opacity-50 cursor-not-allowed' : '';
            if (isResearched) {
                buttonHTML = `<button class="w-full bg-btn-primary-bg text-white font-bold py-1 px-3 rounded-lg border border-primary-border" disabled>Investigado</button>`;
            } else if (isInQueue) {
                buttonHTML = `<button class="w-full bg-btn-secondary-bg text-white font-bold py-1 px-3 rounded-lg border border-primary-border" disabled>En cola</button>`;
            } else {
                buttonHTML = `<button data-action="research" data-unit-id="${unit.id}" class="w-full bg-btn-primary-bg hover:bg-btn-primary-hover text-white font-bold py-1 px-3 rounded-lg transition duration-300 disabled:bg-btn-secondary-bg disabled:cursor-not-allowed border border-primary-border" ${!requirementsMet ? 'disabled' : ''}>Investigar</button>`;
            }
            
            unitsToShowHTML += `
                <div class="p-3 bg-glass-bg rounded-lg ${disabledClasses} border border-primary-border" data-unit-id="${unit.id}">
                    <div class="flex items-center gap-3">
                        ${unitSpriteManager.getUnitSprite(unit.id, activeVillage.race)}
                        ${this._getUnitNameButtonHTML(unit)}
                    </div>
                    <p class="text-xs text-gray-400 mt-1 mb-2">${unit.description}</p>
                    <div class="grid grid-cols-2 gap-2 mb-3 text-sm">
                        ${Object.entries(unit.research.cost).map(([res, val]) => `
                            <div class="flex items-center gap-1" title="${res.charAt(0).toUpperCase() + res.slice(1)}">
                                ${ICONS[RESOURCE_ICON_MAP[res]]}
                                <span class="text-gray-300">${formatNumber(val)}</span>
                            </div>
                        `).join('')}
                        <div class="flex items-center gap-1" title="Tiempo de investigación">
                            ${ICONS.time}
                            <span class="text-gray-300">${formatTime(unit.research.time / this.#gameConfig.gameSpeed)}</span>
                        </div>
                    </div>
                    ${buttonHTML}
                    ${!requirementsMet ? this._getMissingUnitRequirementsHTML(unit.id) : ''}
                </div>`;
        }
        listContainer.innerHTML = unitsToShowHTML;
    }
    
    _calculateSmithyUpgradeCost(unitData, level) {
        const cost = {};
        for(const res in unitData.cost) {
            cost[res] = Math.floor(unitData.cost[res] * Math.pow(1.2, level));
        }
        return cost;
    }

    _renderSmithyUpgrades(container) {
        container.innerHTML = `<div class="border-t border-primary-border mt-4 pt-4">
                                <h3 class="font-bold mb-2 text-gray-400">Mejorar Unidades</h3>
                                <div id="unit-list-container" class="space-y-3"></div>
                            </div>`;
        this._updateSmithyList();
    }

    _updateSmithyList() {
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return;

        const smithyLevel = activeVillage.buildings.find(b => b.type === 'smithy')?.level || 0;
        
        const researchedUnits = gameData.units[activeVillage.race].troops.filter(u => {
            const isCombatUnit = ['infantry', 'cavalry', 'siege', 'scout'].includes(u.type);
            if (!isCombatUnit) return false;
            
            const isResearched = activeVillage.research.completed.includes(u.id);
            const needsNoResearch = u.research.time === 0;
            
            return isResearched || needsNoResearch;
        });
        
        const listContainer = this.#panelElement.querySelector('#unit-list-container');
        if (!listContainer) return;

        if (researchedUnits.length === 0) {
            listContainer.innerHTML = `<p class="text-center text-gray-500 text-sm py-4">Investiga unidades en la Academia para poder mejorarlas aquí.</p>`;
            return;
        }

        let unitsToShowHTML = '';
        for (const unit of researchedUnits) {
            const currentUpgradeLevel = activeVillage.smithy.upgrades[unit.id] || 0;
            const canUpgrade = currentUpgradeLevel < smithyLevel;
            const isInQueue = activeVillage.smithy.queue.some(j => j.unitId === unit.id);
            
            const nextLevelCost = this._calculateSmithyUpgradeCost(unit, currentUpgradeLevel + 1);
            let canAfford = true;
            for (const res in nextLevelCost) {
                if (activeVillage.resources[res].current < nextLevelCost[res]) {
                    canAfford = false;
                    break;
                }
            }

            let buttonHTML = '';
            const isDisabled = !canUpgrade || isInQueue || !canAfford;
            const disabledClasses = isDisabled ? 'opacity-50 cursor-not-allowed' : '';

            if (isInQueue) {
                buttonHTML = `<button class="w-full bg-btn-secondary-bg text-white font-bold py-1 px-3 rounded-lg border border-primary-border" disabled>En cola</button>`;
            } else if (!canUpgrade) {
                buttonHTML = `<button class="w-full bg-btn-primary-bg text-white font-bold py-1 px-3 rounded-lg border border-primary-border" disabled>Nivel Máximo</button>`;
            } else {
                buttonHTML = `<button data-action="upgrade_unit" data-unit-id="${unit.id}" class="w-full bg-btn-primary-bg hover:bg-btn-primary-hover text-white font-bold py-1 px-3 rounded-lg transition duration-300 border border-primary-border" ${isDisabled ? 'disabled' : ''}>Mejorar</button>`;
            }
            
            const upgradeTime = unit.trainTime / this.#gameConfig.gameSpeed;

            unitsToShowHTML += `
                <div class="p-3 bg-glass-bg rounded-lg ${disabledClasses} border border-primary-border" data-unit-id="${unit.id}">
                    <div class="flex justify-between items-center mb-2">
                        <div class="flex items-center gap-3">
                            ${unitSpriteManager.getUnitSprite(unit.id, activeVillage.race)}
                            ${this._getUnitNameButtonHTML(unit)}
                        </div>
                        <span class="font-mono text-sm">Nivel: <span class="font-bold text-white">${currentUpgradeLevel}</span> / ${smithyLevel}</span>
                    </div>
                    ${canUpgrade ? `
                    <div class="grid grid-cols-2 gap-2 mb-3 text-sm">
                        ${Object.entries(nextLevelCost).map(([res, val]) => `
                            <div class="flex items-center gap-1" title="${res.charAt(0).toUpperCase() + res.slice(1)}">
                                ${ICONS[RESOURCE_ICON_MAP[res]]}
                                <span class="text-gray-300">${formatNumber(val)}</span>
                            </div>
                        `).join('')}
                         <div class="flex items-center gap-1" title="Tiempo de mejora">
                            ${ICONS.time}
                            <span class="text-gray-300">${formatTime(upgradeTime)}</span>
                        </div>
                    </div>` : ''}
                    ${buttonHTML}
                </div>`;
        }
        listContainer.innerHTML = unitsToShowHTML;
    }

    _renderTroopTraining(container) {
        container.innerHTML = `<div class="border-t border-primary-border mt-4 pt-4">
                            <h3 class="font-bold mb-2 text-gray-400">Entrenar Tropas</h3>
                            <div id="unit-list-container"></div>
                         </div>`;
        const listContainer = container.querySelector('#unit-list-container');
        this._renderUnitToggleCheckbox(listContainer, this._updateTroopList.bind(this));
        this._updateTroopList();
    }

    _getActiveVillage() {
        if (!this.#currentGameState?.activeVillageId) return null;
        return this.#currentGameState.villages.find(village => village.id === this.#currentGameState.activeVillageId) || null;
    }

    _getOwnerFarmLists(ownerId) {
        return this.#currentGameState?.farmListsByOwnerId?.[ownerId]?.lists || [];
    }

    _renderRallyPointFarmListPanel(container) {
        const activeVillage = this._getActiveVillage();
        if (!activeVillage) {
            container.innerHTML = '<p class="text-sm text-red-400">No se pudo resolver la aldea activa.</p>';
            return;
        }

        const ownerId = activeVillage.ownerId;
        const ownerLists = this._getOwnerFarmLists(ownerId);
        const totalEntries = ownerLists.reduce((total, list) => total + ((list?.entries || []).length), 0);
        const missionLabel = FARM_LIST_LIMITS.defaultMissionType === 'raid' ? 'Asalto' : FARM_LIST_LIMITS.defaultMissionType;

        container.innerHTML = `
            <div class="border-t border-primary-border mt-4 pt-4 space-y-3">
                <div class="flex items-center justify-between gap-2">
                    <h3 class="font-bold text-gray-300">Lista de Vacas</h3>
                    <span class="text-xs text-gray-400">${ownerLists.length}/${FARM_LIST_LIMITS.maxListsPerOwner} listas</span>
                </div>
                <p class="text-sm text-gray-300">La gestion completa de listas, objetivos y envios se hace desde el Centro de Listas de Vacas.</p>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div class="rounded-lg border border-primary-border bg-glass-bg p-2 text-gray-300">Objetivos totales: <span class="text-white font-semibold">${totalEntries}/${FARM_LIST_LIMITS.maxListsPerOwner * FARM_LIST_LIMITS.maxEntriesPerList}</span></div>
                    <div class="rounded-lg border border-primary-border bg-glass-bg p-2 text-gray-300">Cooldown: <span class="text-white font-semibold">${Math.floor(FARM_LIST_LIMITS.minDispatchCooldownMs / 1000)}s</span> por origen/objetivo</div>
                    <div class="rounded-lg border border-primary-border bg-glass-bg p-2 text-gray-300">Mision por defecto: <span class="text-white font-semibold">${missionLabel}</span></div>
                    <div class="rounded-lg border border-primary-border bg-glass-bg p-2 text-gray-300">Aldea actual: <span class="text-white font-semibold">${activeVillage.name}</span></div>
                </div>
                <button data-action="farm-open-center" class="w-full bg-btn-primary-bg hover:bg-btn-primary-hover text-white font-semibold py-2 px-3 rounded-md border border-primary-border">Abrir Centro de Listas de Vacas</button>
            </div>
        `;
    }

    _updateRallyPointFarmListPanel() {
        if (this.#viewingType !== 'rallyPoint') return;
        const contentContainer = this.#panelElement.querySelector('#building-details-content');
        if (!contentContainer) return;
        this._renderRallyPointFarmListPanel(contentContainer);
    }
    
    _updateTroopList() {
        const focusedInput = document.activeElement;
        if (focusedInput?.matches?.('#unit-list input[type="number"]')) {
            return;
        }

        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        const ownerState = this.#currentGameState.players.find(p => p.id === activeVillage?.ownerId);
        if (!activeVillage || !ownerState) return;

        const buildingState = activeVillage.buildings.find(b => b.id === this.#currentSlotId);
        const currentLevel = buildingState ? buildingState.level : 0;
        const buildingStaticData = gameData.buildings[this.#viewingType];
        
        const listContainer = this.#panelElement.querySelector('#unit-list');
        if (!listContainer) return;

        const previousInputValues = {};
        listContainer.querySelectorAll('[data-unit-id]').forEach(unitCard => {
            const input = unitCard.querySelector('input[type="number"]');
            if (input && input.value !== '') {
                previousInputValues[unitCard.dataset.unitId] = input.value;
            }
        });
        const focusedUnitId = document.activeElement?.closest?.('[data-unit-id]')?.dataset?.unitId || null;

        let unitTypeToTrain;
        switch(this.#viewingType) {
            case 'barracks':
            case 'greatBarracks':
                unitTypeToTrain = 'infantry';
                break;
            case 'stable':
            case 'greatStable':
                unitTypeToTrain = ['cavalry', 'scout'];
                break;
            case 'workshop':
                unitTypeToTrain = 'siege';
                break;
            case 'palace':
                unitTypeToTrain = ['settler', 'chief'];
                break;
            default: return;
        }

        if (!unitTypeToTrain) return;

        const trainableUnits = gameData.units[ownerState.race]?.troops.filter(troop => 
            Array.isArray(unitTypeToTrain) ? unitTypeToTrain.includes(troop.type) : troop.type === unitTypeToTrain
        );

        if (!trainableUnits || trainableUnits.length === 0) {
            listContainer.innerHTML = '';
            return;
        }

        const levelData = currentLevel > 0 ? buildingStaticData.levels[currentLevel - 1] : null;
        const trainingTimeFactor = levelData?.attribute?.trainingTimeFactor || 1.0;
        const showUnitExchange = ['barracks', 'stable', 'workshop', 'greatBarracks', 'greatStable'].includes(this.#viewingType);
        let unitsToShowHTML = '';

        for (const unit of trainableUnits) {
            const buildingPrereqsMet = this._checkUnitResearchRequirements(unit.id);
            const isResearched = activeVillage.research.completed.includes(unit.id) || (unit.research && unit.research.time === 0);
            const canTrain = buildingPrereqsMet && isResearched;

            if (!canTrain && !this.#showAllUnits) continue;

            if (unit.type === 'settler' || unit.type === 'chief') {
                const palace = activeVillage.buildings.find(b => b.type === 'palace');
                const palaceLevel = palace ? palace.level : 0;

                if (palaceLevel < 10) continue;

                const existingUnits = (activeVillage.unitsInVillage[unit.id] || 0) +
                    activeVillage.recruitmentQueue
                        .filter(job => job.unitId === unit.id)
                        .reduce((sum, job) => sum + job.count, 0);

                let maxAllowed = 0;
                if (unit.type === 'settler') {
                    if (palaceLevel >= 20) maxAllowed = 9;
                    else if (palaceLevel >= 15) maxAllowed = 6;
                    else if (palaceLevel >= 10) maxAllowed = 3;
                } else if (unit.type === 'chief') {
                    if (palaceLevel >= 20) maxAllowed = 3;
                    else if (palaceLevel >= 15) maxAllowed = 2;
                    else if (palaceLevel >= 10) maxAllowed = 1;
                }

                if (existingUnits >= maxAllowed) {
                    continue;
                }
            }

            const finalTrainTime = (unit.trainTime / trainingTimeFactor) / this.#gameConfig.gameSpeed;
            const requirementsHTML = !canTrain ? this._getMissingUnitRequirementsHTML(unit.id) : '';

            const disabledState = !canTrain ? 'disabled' : '';
            const disabledClasses = !canTrain ? 'opacity-50 cursor-not-allowed' : '';
            
            unitsToShowHTML += `
                <div class="p-3 bg-glass-bg rounded-lg ${disabledClasses} border border-primary-border" data-unit-id="${unit.id}">
                    <div class="flex justify-between items-center mb-2">
                        <div class="flex items-center gap-3">
                            ${unitSpriteManager.getUnitSprite(unit.id, activeVillage.race)}
                            ${this._getUnitHeaderHTML(unit, { showExchange: showUnitExchange && canTrain })}
                        </div>
                        <div class="flex items-center gap-1 text-xs text-gray-400" title="Tiempo de entrenamiento por unidad">
                            ${ICONS.time} ${formatTime(finalTrainTime)}
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-5 gap-2 mb-3 text-xs">
                        ${Object.entries(unit.cost).map(([res, val]) => `
                            <div class="flex items-center gap-1" title="${res.charAt(0).toUpperCase() + res.slice(1)}">
                                ${ICONS[RESOURCE_ICON_MAP[res]]}
                                <span class="text-gray-300">${formatNumber(val)}</span>
                            </div>
                        `).join('')}
                        <div class="flex items-center gap-1" title="Consumo de cereal">
                            ${ICONS[RESOURCE_ICON_MAP.food]}
                            <span class="text-gray-300">${unit.upkeep}</span>
                        </div>
                    </div>

                    <div class="flex gap-2">
                        <input type="number" inputmode="numeric" min="0" placeholder="Cant." class="w-24 bg-btn-secondary-bg border-primary-border text-white rounded-md p-1 text-center font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500" ${disabledState}>
                        <button data-action="max-train" data-unit-id="${unit.id}" class="px-3 py-1 text-xs bg-btn-secondary-bg hover:bg-btn-secondary-hover rounded-md border border-primary-border" ${disabledState}>Máx</button>
                        <button data-action="train" data-unit-id="${unit.id}" class="flex-grow bg-btn-primary-bg hover:bg-btn-primary-hover text-white font-bold py-1 px-3 rounded-lg transition duration-300 disabled:bg-btn-secondary-bg disabled:cursor-not-allowed border border-primary-border" ${disabledState}>
                            Entrenar
                        </button>
                    </div>
                    ${requirementsHTML}
                </div>
            `;
        }
        listContainer.innerHTML = unitsToShowHTML;

        for (const [unitId, value] of Object.entries(previousInputValues)) {
            const input = listContainer.querySelector(`[data-unit-id="${unitId}"] input[type="number"]`);
            if (input) input.value = value;
        }

        if (focusedUnitId) {
            const input = listContainer.querySelector(`[data-unit-id="${focusedUnitId}"] input[type="number"]`);
            if (input) {
                input.focus();
                const cursorPosition = input.value.length;
                input.setSelectionRange(cursorPosition, cursorPosition);
            }
        }
    }
}

const buildingInfoUI = new BuildingInfoUI();
export default buildingInfoUI;
