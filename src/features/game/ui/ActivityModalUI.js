// js/ui/ActivityModalUI.js

class ActivityModalUI {
    #modalElement;
    #openButton;
    #closeButton;
    #tabButtons;
    #tabPanels;

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

        this._initializeEventListeners();
    }

    _initializeEventListeners() {
        this.#openButton.addEventListener('click', () => this.show());
        this.#closeButton.addEventListener('click', () => this.hide());
        
        this.#tabButtons.forEach(button => {
            button.addEventListener('click', (event) => this._switchTab(event));
        });
    }

    _switchTab(event) {
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
        this.#modalElement.classList.remove('panel-hidden');
        this.#modalElement.classList.add('panel-visible');
    }

    hide() {
        this.#modalElement.classList.remove('panel-visible');
        this.#modalElement.classList.add('panel-hidden');
    }
}

export default ActivityModalUI;