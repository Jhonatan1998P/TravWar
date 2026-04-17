import gameManager from '@game/state/GameManager.js';
import ReportListUI from '../ui/ReportListUI.js';
import toastUI from '../ui/ToastUI.js';
import uiRenderScheduler from '../ui/UIRenderScheduler.js';
import { perfCollector } from '@shared/lib/perf.js';
import { selectReportsSignature, selectUnreadPlayerReports } from '../ui/renderSelectors.js';

class ReportsView {
    #reportListUI;
    #gameState;
    #didReportFirstMeaningfulPaint = false;

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
        perfCollector.markStart('view.reports.mount');
        perfCollector.markStart('view.reports.firstMeaningfulPaint');

        this.#reportListUI = new ReportListUI('reports-container');
        this.initializeEventListeners();
        gameManager.sendCommand('mark_reports_as_read');
        gameManager.sendCommand('get_latest_state');

        perfCollector.markEnd('view.reports.mount');
    }

    unmount() {
        uiRenderScheduler.unregister('reports-view');
        document.removeEventListener('notify:battle_report', this._handleNewReport);
        this.#reportListUI?.destroy?.();
        this.#reportListUI = null;
    }

    initializeEventListeners() {
        uiRenderScheduler.register('reports-view', this._handleGameStateUpdate, [
            selectReportsSignature,
            selectUnreadPlayerReports
        ]);
        document.addEventListener('notify:battle_report', this._handleNewReport);
    }

    _handleGameStateUpdate(gameStatePayload) {
        const { state } = gameStatePayload;
        if (!state) return;
        this.#gameState = state;
        
        this.#reportListUI.render(state);

        if (!this.#didReportFirstMeaningfulPaint) {
            this.#didReportFirstMeaningfulPaint = true;
            perfCollector.markEnd('view.reports.firstMeaningfulPaint');
        }
    }
    
    _handleNewReport(event) {
        const { report } = event.detail;
        const activeVillage = this.#gameState?.villages?.find(v => v.id === this.#gameState?.activeVillageId);
        const perspectiveOwnerId = activeVillage?.ownerId || 'player';
        if (this.#gameState && report?.ownerId === perspectiveOwnerId) {
            toastUI.show('¡Nuevo informe de batalla recibido!', 'info');
        }
    }
}

export default ReportsView;
