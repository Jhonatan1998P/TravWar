import gameManager from '@game/state/GameManager.js';
import ReportListUI from '../ui/ReportListUI.js';
import toastUI from '../ui/ToastUI.js';
import uiRenderScheduler from '../ui/UIRenderScheduler.js';

class ReportsView {
    #reportListUI;
    #gameState;

    constructor() {
        this._handleGameStateUpdate = this._handleGameStateUpdate.bind(this);
        this._handleNewReport = this._handleNewReport.bind(this);
    }

    get html() {
        return `
            <main class="flex-grow p-2 flex flex-col overflow-y-auto">
                <div id="reports-container" class="flex-grow">
                </div>
                <div id="reports-pagination-container" class="flex-shrink-0 p-2 flex justify-center items-center gap-2">
                </div>
            </main>
        `;
    }

    mount() {
        this.#reportListUI = new ReportListUI('reports-container');
        this.initializeEventListeners();
        gameManager.sendCommand('mark_reports_as_read');
        gameManager.sendCommand('get_latest_state');
    }

    unmount() {
        uiRenderScheduler.unregister('reports-view');
        document.removeEventListener('notify:battle_report', this._handleNewReport);
    }

    initializeEventListeners() {
        uiRenderScheduler.register('reports-view', this._handleGameStateUpdate);
        document.addEventListener('notify:battle_report', this._handleNewReport);
    }

    _handleGameStateUpdate(gameStatePayload) {
        const { state } = gameStatePayload;
        if (!state) return;
        this.#gameState = state;
        
        this.#reportListUI.render(state);
    }
    
    _handleNewReport(event) {
        const { report } = event.detail;
        if (this.#gameState && report.attacker.villageId && this.#gameState.villages.find(v => v.id === report.attacker.villageId)?.ownerId === 'player') {
            toastUI.show('¡Nuevo informe de batalla recibido!', 'info');
        }
    }
}

export default ReportsView;
