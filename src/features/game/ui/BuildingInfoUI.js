import gameManager from '@game/state/GameManager.js';
import { gameData } from '../core/GameData.js';
import { getScaledCrannyCapacity, getScaledMerchantCapacityPerUnit, scaleCapacityByGameSpeed } from '../core/capacityScaling.js';
import GameConfig from '../state/GameConfig.js';
import { formatNumber, formatTime } from '@shared/lib/formatters.js';
import toastUI from './ToastUI.js';
import { unitSpriteManager } from './UnitSpriteManager.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import { selectBuildingInfoPanelSignature } from './renderSelectors.js';

const ICONS = {
    time: `<img src="/icons/timer.png" alt="Tiempo" class="h-5 w-5">`,
    population: `<img src="/icons/population.png" alt="Población" class="h-5 w-5">`,
    wood: `<img src="/icons/wood.png" alt="Madera" class="h-5 w-5">`,
    clay: `<img src="/icons/clay.png" alt="Barro" class="h-5 w-5">`,
    iron: `<img src="/icons/iron.png" alt="Hierro" class="h-5 w-5">`,
    wheat: `<img src="/icons/wheat.png" alt="Cereal" class="h-5 w-5">`,
};

const RESOURCE_ICON_MAP = {
    wood: 'wood', stone: 'clay', iron: 'iron', food: 'wheat',
    time: 'time', population: 'population'
};

const BUILDING_CATEGORIES = {
    infrastructure: ['embassy', 'palace', 'heroMansion'],
    military: ['barracks', 'stable', 'workshop', 'smithy', 'academy', 'hospital', 'greatBarracks', 'greatStable', 'tournamentSquare'],
    economy: ['warehouse', 'granary', 'cranny', 'marketplace', 'tradeOffice', 'sawmill', 'brickyard', 'ironFoundry', 'grainMill', 'bakery']
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
    
        const mainPanel = this.#panelElement.querySelector('#panel-main');
        mainPanel.addEventListener('click', e => {
            const button = e.target.closest('button[data-action]');
            if (!button || button.disabled) return;
    
            const action = button.dataset.action;
            const unitId = button.dataset.unitId;
            const unitDiv = button.closest('div[data-unit-id]');
            const activeVillageId = this.#currentGameState?.activeVillageId;
            if (!activeVillageId) return;
    
            if (action === 'research' || action === 'upgrade_unit') {
                button.disabled = true;
                const card = button.closest('[data-unit-id]');
                if (card) card.classList.add('opacity-50', 'cursor-wait');
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
    }

    _createPanelHTML() {
        const panelHTML = `
            <div id="building-info-panel" class="fixed inset-0 bg-primary-bg/60 backdrop-blur-sm flex items-center justify-center z-50 transition-all duration-200 ease-out panel-hidden">
                <div class="bg-glass-bg border-2 border-primary-border rounded-lg shadow-xl w-full max-w-md m-4 text-white flex flex-col">
                    <header id="panel-header" class="flex justify-between items-center p-4 border-b border-primary-border">
                        <h2 id="panel-title" class="text-xl font-bold text-yellow-300"></h2>
                        <button data-action="close" class="text-gray-400 text-3xl leading-none hover:text-white">×</button>
                    </header>
                    <main id="panel-main" class="flex flex-col p-4 overflow-y-auto" style="max-height: 70vh;"></main>
                    <footer id="panel-footer" class="p-4 border-t border-primary-border">
                        <button id="upgrade-button" data-action="upgrade" class="w-full bg-btn-primary-bg hover:bg-btn-primary-hover text-white font-bold py-2 px-4 rounded-lg transition duration-300 disabled:bg-btn-secondary-bg disabled:cursor-not-allowed border border-primary-border">
                        </button>
                    </footer>
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
        }
    }

    _handleUpgradeClick() {
        if (!this.#currentSlotId || !this.#viewingType) return;

        const timeSinceOpen = Date.now() - this.#lastOpenedAt;
        if (timeSinceOpen < 500) {
            return;
        }

        gameManager.sendCommand('upgrade_building', {
            buildingId: this.#currentSlotId,
            buildingType: this.#viewingType
        });
        this.hide();
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
        if (!buildingData.requires) return true;

        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return false;

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
        if (!buildingData.requires) return '';

        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        if (!activeVillage) return '';

        let html = '<div class="mt-2 border-t border-primary-border pt-2 text-xs space-y-1">';
        html += `<span class="text-gray-400 font-semibold">Requisitos:</span>`;

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

        this.#lastOpenedAt = Date.now();
        
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
        } else if (isMilitaryBuilding) {
            this._renderTroopTraining(contentContainer);
        }
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

        if (!nextLevelData) {
            upgradeInfoContainer.innerHTML = '<div class="text-center p-4 max-level-notice">Este edificio ha alcanzado su máximo nivel.</div>';
            footer.classList.add('hidden');
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
        const requirementsMet = this._checkRequirements(this.#viewingType);
        upgradeButton.disabled = !canAfford || !requirementsMet;
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
                        <span class="font-bold text-yellow-400">${unit.name}</span>
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
                            <span class="font-bold text-yellow-400">${unit.name}</span>
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
    
    _updateTroopList() {
        const activeVillage = this.#currentGameState.villages.find(v => v.id === this.#currentGameState.activeVillageId);
        const ownerState = this.#currentGameState.players.find(p => p.id === activeVillage?.ownerId);
        if (!activeVillage || !ownerState) return;

        const buildingState = activeVillage.buildings.find(b => b.id === this.#currentSlotId);
        const currentLevel = buildingState ? buildingState.level : 0;
        const buildingStaticData = gameData.buildings[this.#viewingType];
        
        const listContainer = this.#panelElement.querySelector('#unit-list');
        if (!listContainer) return;

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
                            <span class="font-bold text-yellow-400">${unit.name}</span>
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
                        <input type="number" min="0" placeholder="Cant." class="w-24 bg-btn-secondary-bg border-primary-border text-white rounded-md p-1 text-center font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500" ${disabledState}>
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
    }
}

const buildingInfoUI = new BuildingInfoUI();
export default buildingInfoUI;
