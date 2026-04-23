// js/ui/ActivityModalUI.js
import { markModalOpened, shouldIgnoreModalAction } from './modalInteractionGuard.js';

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
