import gameManager from '@game/state/GameManager.js';
import { renderBuildingSlots, initializeBuildingSlotClicks } from '../ui/BuildingSlotsUI.js';
import { renderResourceBar } from '../ui/ResourceBarUI.js';
import buildingInfoUI from '../ui/BuildingInfoUI.js';
import ActivityModalUI from '../ui/ActivityModalUI.js';
import ConstructionQueueUI from '../ui/ConstructionQueueUI.js';
import RecruitmentQueueUI from '../ui/RecruitmentQueueUI.js';
import ResearchQueueUI from '../ui/ResearchQueueUI.js';
import SmithyQueueUI from '../ui/SmithyQueueUI.js';
import TroopsUI from '../ui/TroopsUI.js';
import MovementsUI from '../ui/MovementsUI.js';
import toastUI from '../ui/ToastUI.js';
import { gameData } from '../core/GameData.js';
import { formatNumber } from '@shared/lib/formatters.js';
import uiRenderScheduler from '../ui/UIRenderScheduler.js';

class VillageView {
    #populationDisplay;
    #gameState;
    #activityModalUI;
    #constructionQueueUI;
    #recruitmentQueueUI;
    #researchQueueUI;
    #smithyQueueUI;
    #troopsUI;
    #movementsUI;

    constructor() {
        this._handleGameStateUpdate = this._handleGameStateUpdate.bind(this);
        this._handleConstructionFinished = this._handleConstructionFinished.bind(this);
        this._handleRecruitmentFinished = this._handleRecruitmentFinished.bind(this);
        this._handleResearchFinished = this._handleResearchFinished.bind(this);
        this._handleSmithyFinished = this._handleSmithyFinished.bind(this);
    }

    get html() {
        return `
            <div class="absolute inset-x-0 top-0 flex items-center justify-center min-h-full py-4" id="mainViewContainer">
                <div id="mainView" class="relative w-[380px] h-[380px]">
                </div>
            </div>
        `;
    }

    mount() {
        this.#populationDisplay = document.getElementById('population-display');
        
        this.#activityModalUI = new ActivityModalUI();
        this.#constructionQueueUI = new ConstructionQueueUI('construction-queue-container');
        this.#recruitmentQueueUI = new RecruitmentQueueUI('tab-panel-recruitment');
        this.#researchQueueUI = new ResearchQueueUI('research-queue-container', 'research-queue-wrapper');
        this.#smithyQueueUI = new SmithyQueueUI('smithy-queue-container', 'smithy-queue-wrapper');
        this.#troopsUI = new TroopsUI('tab-panel-troops');
        this.#movementsUI = new MovementsUI('tab-panel-movements');

        initializeBuildingSlotClicks(document.getElementById('mainViewContainer'));

        this.initializeEventListeners();
        gameManager.sendCommand('get_latest_state');
    }

    unmount() {
        uiRenderScheduler.unregister('village-view');
        document.removeEventListener('notify:construction_finished', this._handleConstructionFinished);
        document.removeEventListener('notify:recruitment_finished', this._handleRecruitmentFinished);
        document.removeEventListener('notify:research_finished', this._handleResearchFinished);
        document.removeEventListener('notify:smithy_finished', this._handleSmithyFinished);
    }

    initializeEventListeners() {
        uiRenderScheduler.register('village-view', this._handleGameStateUpdate);
        document.addEventListener('notify:construction_finished', this._handleConstructionFinished);
        document.addEventListener('notify:recruitment_finished', this._handleRecruitmentFinished);
        document.addEventListener('notify:research_finished', this._handleResearchFinished);
        document.addEventListener('notify:smithy_finished', this._handleSmithyFinished);
    }

    _handleGameStateUpdate(gameStatePayload) {
        const { state } = gameStatePayload;
        if (!state) return;
        this.#gameState = state;
        
        const activeVillage = state.villages.find(v => v.id === state.activeVillageId);
        if (!activeVillage) return;

        renderResourceBar(document.getElementById('resource-bar'), activeVillage.resources);
        renderBuildingSlots(document.getElementById('mainView'), state);

        if (this.#populationDisplay && activeVillage.population) {
            this.#populationDisplay.textContent = formatNumber(activeVillage.population.current);
        }
    }

    _handleConstructionFinished(event) {
        const { villageId, completed } = event.detail;
        if (this.#gameState && villageId !== this.#gameState.activeVillageId) return;

        completed.forEach(job => {
            const buildingName = gameData.buildings[job.buildingType].name;
            toastUI.show(`${buildingName} ha subido al nivel ${job.targetLevel}.`, 'success');
        });
    }

    _handleRecruitmentFinished(event) {
        const { villageId, completed } = event.detail;
        if (this.#gameState && villageId !== this.#gameState.activeVillageId) return;
        
        const village = this.#gameState.villages.find(v => v.id === villageId);
        if (!village) return;

        completed.forEach(job => {
            const unitData = gameData.units[village.race].troops.find(u => u.id === job.unitId);
            if (unitData) {
                toastUI.show(`Se han entrenado ${job.count} x ${unitData.name}.`, 'success');
            }
        });
    }

    _handleResearchFinished(event) {
        const { villageId, completed } = event.detail;
        if (this.#gameState && villageId !== this.#gameState.activeVillageId) return;

        const village = this.#gameState.villages.find(v => v.id === villageId);
        if (!village) return;

        completed.forEach(job => {
            const unitName = gameData.units[village.race].troops.find(u => u.id === job.unitId).name;
            toastUI.show(`${unitName} ha sido investigado.`, 'success');
        });
    }

    _handleSmithyFinished(event) {
        const { villageId, completed } = event.detail;
        if (this.#gameState && villageId !== this.#gameState.activeVillageId) return;

        const village = this.#gameState.villages.find(v => v.id === villageId);
        if (!village) return;

        completed.forEach(job => {
            const unitName = gameData.units[village.race].troops.find(u => u.id === job.unitId).name;
            toastUI.show(`${unitName} ha sido mejorado en la herrería.`, 'success');
        });
    }
}

export default VillageView;
