import gameManager from '@game/state/GameManager.js';
import ReportListUI from '../ui/ReportListUI.js';
import toastUI from '../ui/ToastUI.js';
import uiRenderScheduler from '../ui/UIRenderScheduler.js';
import { perfCollector } from '@shared/lib/perf.js';
import { selectReportsSignature, selectUnreadPlayerReports } from '../ui/renderSelectors.js';

function getPerspectiveOwnerId(state) {
    const activeVillage = state?.villages?.find(village => village.id === state.activeVillageId);
    if (activeVillage?.ownerId) return activeVillage.ownerId;

    if (!state?.players) return 'player';

    const explicitPlayer = state.players.find(player => player.id === 'player');
    if (explicitPlayer) return explicitPlayer.id;

    const firstHuman = state.players.find(player => !String(player.id || '').startsWith('ai_'));
    return firstHuman?.id || 'player';
}

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
            <main class="flex-grow p-3 flex flex-col overflow-y-auto bg-gradient-to-b from-war-leather/30 to-transparent">
                <header class="mb-3 rounded-2xl border border-primary-border bg-glass-light-bg p-4 shadow-inner">
                    <p class="text-xs uppercase tracking-[0.28em] text-war-gold/80">Consejo de guerra</p>
                    <h1 class="mt-1 text-2xl font-display font-bold text-war-mist">Informes</h1>
                </header>
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

        const perspectiveOwnerId = getPerspectiveOwnerId(state);
        if ((state.unreadCounts?.[perspectiveOwnerId] || 0) > 0) {
            gameManager.sendCommand('mark_reports_as_read', { ownerId: perspectiveOwnerId });
        }

        if (!this.#didReportFirstMeaningfulPaint) {
            this.#didReportFirstMeaningfulPaint = true;
            perfCollector.markEnd('view.reports.firstMeaningfulPaint');
        }
    }
    
    _handleNewReport(event) {
        const { report } = event.detail;
        const perspectiveOwnerId = getPerspectiveOwnerId(this.#gameState);
        if (this.#gameState && report?.ownerId === perspectiveOwnerId) {
            toastUI.show('¡Nuevo informe de batalla recibido!', 'info');
        }
    }
}

export default ReportsView;
