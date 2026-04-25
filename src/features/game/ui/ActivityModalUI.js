import { markModalOpened, shouldIgnoreModalAction } from './modalInteractionGuard.js';
import ConstructionQueueUI from './ConstructionQueueUI.js';
import RecruitmentQueueUI from './RecruitmentQueueUI.js';
import ResearchQueueUI from './ResearchQueueUI.js';
import SmithyQueueUI from './SmithyQueueUI.js';
import TroopsUI from './TroopsUI.js';
import MovementsUI from './MovementsUI.js';

class ActivityModalUI {
    #modalElement;
    #openButton;
    #closeButton;
    #tabButtons;
    #tabPanels;
    #handleOpenClick;
    #handleCloseClick;
    #handleTabClick;
    #isInitialized = false;
    #lastOpenedAt = 0;
    #constructionQueueUI;
    #recruitmentQueueUI;
    #researchQueueUI;
    #smithyQueueUI;
    #troopsUI;
    #movementsUI;

    constructor() {
        this.#modalElement = document.getElementById('activity-modal');
        this.#openButton = document.getElementById('activity-overview-btn');
        this.#closeButton = document.getElementById('activity-modal-close-btn');
        
        if (!this.#modalElement || !this.#openButton || !this.#closeButton) {
            console.error('[ActivityModalUI] No se pudieron encontrar los elementos esenciales del modal.');
            return;
        }

        this.#tabButtons = this.#modalElement.querySelectorAll('.tab-button');
        this.#tabPanels = this.#modalElement.querySelectorAll('.tab-panel');

        this.#handleOpenClick = this.show.bind(this);
        this.#handleCloseClick = this.hide.bind(this);
        this.#handleTabClick = this._switchTab.bind(this);

        this.#constructionQueueUI = new ConstructionQueueUI('construction-queue-container');
        this.#recruitmentQueueUI = new RecruitmentQueueUI('tab-panel-recruitment');
        this.#researchQueueUI = new ResearchQueueUI('research-queue-container', 'research-queue-wrapper');
        this.#smithyQueueUI = new SmithyQueueUI('smithy-queue-container', 'smithy-queue-wrapper');
        this.#troopsUI = new TroopsUI('tab-panel-troops');
        this.#movementsUI = new MovementsUI('tab-panel-movements');

        this._initializeEventListeners();
    }

    _initializeEventListeners() {
        if (this.#isInitialized) {
            return;
        }

        this.#openButton.addEventListener('click', this.#handleOpenClick);
        this.#closeButton.addEventListener('click', this.#handleCloseClick);
        
        this.#tabButtons.forEach(button => {
            button.addEventListener('click', this.#handleTabClick);
        });

        this.#isInitialized = true;
    }

    destroy() {
        if (!this.#isInitialized) {
            return;
        }

        this.#openButton?.removeEventListener('click', this.#handleOpenClick);
        this.#closeButton?.removeEventListener('click', this.#handleCloseClick);

        this.#tabButtons?.forEach(button => {
            button.removeEventListener('click', this.#handleTabClick);
        });

        this.#constructionQueueUI?.destroy?.();
        this.#recruitmentQueueUI?.destroy?.();
        this.#researchQueueUI?.destroy?.();
        this.#smithyQueueUI?.destroy?.();
        this.#troopsUI?.destroy?.();
        this.#movementsUI?.destroy?.();

        this.#constructionQueueUI = null;
        this.#recruitmentQueueUI = null;
        this.#researchQueueUI = null;
        this.#smithyQueueUI = null;
        this.#troopsUI = null;
        this.#movementsUI = null;

        this.#isInitialized = false;
    }

    _switchTab(event) {
        if (shouldIgnoreModalAction(this.#lastOpenedAt)) {
            return;
        }

        const tabId = event.currentTarget.dataset.tab;

        // Actualiza los estilos de los botones de las pestañas
        this.#tabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });

        // Actualiza la visibilidad de los paneles de contenido
        this.#tabPanels.forEach(panel => {
            panel.classList.toggle('hidden', panel.id !== `tab-panel-${tabId}`);
        });
    }

    show() {
        this.#lastOpenedAt = markModalOpened();
        this.#modalElement.classList.remove('panel-hidden');
        this.#modalElement.classList.add('panel-visible');
    }

    hide() {
        this.#modalElement.classList.remove('panel-visible');
        this.#modalElement.classList.add('panel-hidden');
    }
}

export default ActivityModalUI;
