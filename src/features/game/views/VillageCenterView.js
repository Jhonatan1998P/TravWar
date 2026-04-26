import gameManager from '@game/state/GameManager.js';
import { renderVillageCenterSlots, initializeBuildingSlotClicks } from '../ui/BuildingSlotsUI.js';
import { renderResourceBar } from '../ui/ResourceBarUI.js';
import toastUI from '../ui/ToastUI.js';
import { gameData } from '../core/GameData.js';
import { formatNumber } from '@shared/lib/formatters.js';
import uiRenderScheduler from '../ui/UIRenderScheduler.js';
import { perfCollector } from '@shared/lib/perf.js';
import { selectVillageVisualSignature } from '../ui/renderSelectors.js';

class VillageCenterView {
    #populationDisplay;
    #gameState;
    #lastVillageRenderSignature = '';
    #didReportFirstMeaningfulPaint = false;

    constructor() {
        this._handleGameStateUpdate = this._handleGameStateUpdate.bind(this);
        this._handleConstructionFinished = this._handleConstructionFinished.bind(this);
        this._handleRecruitmentFinished = this._handleRecruitmentFinished.bind(this);
        this._handleResearchFinished = this._handleResearchFinished.bind(this);
        this._handleSmithyFinished = this._handleSmithyFinished.bind(this);
    }

    get html() {
        return `
            <div class="absolute inset-x-0 top-0 flex items-center justify-center min-h-full py-4 px-2" id="mainViewContainer">
                <div id="mainView" class="relative w-[92vw] h-[92vw] max-w-[380px] max-h-[380px] rounded-full bg-[radial-gradient(circle,rgba(245,196,81,0.12),rgba(18,13,10,0.16)_58%,transparent_74%)] shadow-[inset_0_0_44px_rgba(245,196,81,0.10)]">
                </div>
            </div>
        `;
    }

    mount() {
        perfCollector.markStart('view.villageCenter.mount');
        perfCollector.markStart('view.villageCenter.firstMeaningfulPaint');

        this.#populationDisplay = document.getElementById('population-display');

        initializeBuildingSlotClicks(document.getElementById('mainViewContainer'));

        this.initializeEventListeners();
        gameManager.sendCommand('get_latest_state');

        perfCollector.markEnd('view.villageCenter.mount');
    }

    unmount() {
        uiRenderScheduler.unregister('village-center-view');
        document.removeEventListener('notify:construction_finished', this._handleConstructionFinished);
        document.removeEventListener('notify:recruitment_finished', this._handleRecruitmentFinished);
        document.removeEventListener('notify:research_finished', this._handleResearchFinished);
        document.removeEventListener('notify:smithy_finished', this._handleSmithyFinished);
    }

    initializeEventListeners() {
        uiRenderScheduler.register('village-center-view', this._handleGameStateUpdate, [selectVillageVisualSignature]);
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

        const villageRenderSignature = this.#getVillageRenderSignature(activeVillage, state.activeVillageId);
        if (villageRenderSignature !== this.#lastVillageRenderSignature) {
            renderVillageCenterSlots(document.getElementById('mainView'), state);
            this.#lastVillageRenderSignature = villageRenderSignature;
        }
        
        if (this.#populationDisplay && activeVillage.population) {
            this.#populationDisplay.textContent = formatNumber(activeVillage.population.current);
        }

        if (!this.#didReportFirstMeaningfulPaint) {
            this.#didReportFirstMeaningfulPaint = true;
            perfCollector.markEnd('view.villageCenter.firstMeaningfulPaint');
        }
    }

    #getVillageRenderSignature(activeVillage, activeVillageId) {
        const buildingsSignature = [...(activeVillage.buildings || [])]
            .sort((left, right) => String(left.id).localeCompare(String(right.id)))
            .map(building => `${building.id}:${building.type}:${building.level}`)
            .join(';');

        const constructionQueueSignature = [...(activeVillage.constructionQueue || [])]
            .sort((left, right) => String(left.jobId).localeCompare(String(right.jobId)))
            .map(job => `${job.jobId}:${job.jobType || 'construction'}:${job.buildingId}:${job.buildingType}:${job.targetLevel}`)
            .join(';');

        return `${activeVillageId}:${activeVillage.villageType}:${buildingsSignature}|${constructionQueueSignature}`;
    }

    _handleConstructionFinished(event) {
        const { villageId, completed } = event.detail;
        if (this.#gameState && villageId !== this.#gameState.activeVillageId) return;

        completed.forEach(job => {
            const buildingName = gameData.buildings[job.buildingType].name;
            if (job.jobType === 'demolition') {
                toastUI.show(`${buildingName} ha sido demolido al nivel ${job.targetLevel}.`, 'warning');
                return;
            }
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

export default VillageCenterView;
