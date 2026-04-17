import gameManager from '@game/state/GameManager.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import { selectReportsSignature, selectUnreadPlayerReports } from './renderSelectors.js';
import { reconcileList } from './reconcileList.js';

let battleReportUILoadPromise = null;

async function getBattleReportUI() {
    if (!battleReportUILoadPromise) {
        battleReportUILoadPromise = import('./BattleReportUI.js')
            .then(module => module.default);
    }

    return battleReportUILoadPromise;
}

const ICONS = {
    attack: `<img src="/icons/sword.png" alt="Ataque" class="h-8 w-8">`,
    defense: `<img src="/icons/shield.png" alt="Defensa" class="h-8 w-8">`,
    espionage: `<img src="/icons/report.png" alt="Espionaje" class="h-8 w-8">`,
    settlement: `<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-blue-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 2h10v7h-2V7a1 1 0 00-1-1H6V5zm1 5a1 1 0 011-1h4a1 1 0 110 2H7a1 1 0 01-1-1z" clip-rule="evenodd" /></svg>`,
    delete: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`
};

class ReportListUI {
    #container;
    #paginationContainer;
    #gameState = null;
    #currentPage = 1;
    #reportsPerPage = 10;
    #reportNodes = new Map();
    #list;
    #emptyState;
    #mainElement;
    #handleMainClick;
    #schedulerKey = 'report-list-ui';

    constructor(containerId) {
        this.#container = document.getElementById(containerId);
        this.#paginationContainer = document.getElementById('reports-pagination-container');
        if (!this.#container || !this.#paginationContainer) {
            return;
        }

        this.#setupStaticMarkup();

        this.#mainElement = document.querySelector('main');
        this.#handleMainClick = event => this.#handleContainerClick(event);
        this.#mainElement?.addEventListener('click', this.#handleMainClick);

        uiRenderScheduler.register(this.#schedulerKey, (gameState) => this.render(gameState.state), [
            selectReportsSignature,
            selectUnreadPlayerReports
        ]);
    }

    destroy() {
        if (this.#mainElement && this.#handleMainClick) {
            this.#mainElement.removeEventListener('click', this.#handleMainClick);
        }

        uiRenderScheduler.unregister(this.#schedulerKey);
        this.#reportNodes.clear();
    }

    #setupStaticMarkup() {
        this.#container.replaceChildren();

        this.#list = document.createElement('div');
        this.#list.className = 'space-y-2';

        this.#emptyState = document.createElement('div');
        this.#emptyState.className = 'text-center text-gray-500 text-sm py-8';
        this.#emptyState.textContent = 'No tienes informes.';

        this.#container.append(this.#list, this.#emptyState);
    }

    #getReportTitle(report) {
        if (!report) return 'Informe invalido';

        if (report.type === 'settlement_success') {
            return `Nueva aldea fundada: ${report.newVillageName}`;
        }

        if (!report.attacker || !report.defender) return 'Informe de batalla';

        const attackerName = report.attacker.villageName || 'Aldea desconocida';
        const defenderName = report.defender.villageName || `Oasis (${report.defender.coords.x}|${report.defender.coords.y})`;

        let missionType = 'Ataque';
        if (report.type === 'raid') missionType = 'Asalto';
        if (report.type === 'espionage') missionType = 'Espionaje';
        if (report.type === 'espionage_defense') missionType = 'Espionaje';

        if (report.ownerId === report.attacker.ownerId) {
            return `${missionType} a ${defenderName}`;
        }

        return `${missionType} de ${attackerName}`;
    }

    #getPerspectiveOwnerId(state = this.#gameState) {
        const activeVillage = state?.villages?.find(village => village.id === state?.activeVillageId);
        return activeVillage?.ownerId || 'player';
    }

    #analyzeReportForPlayer(report, perspectiveOwnerId) {
        const result = { icon: '', titleColorClass: 'text-white' };
        if (!report) return result;

        if (report.type === 'settlement_success') {
            result.icon = ICONS.settlement;
            result.titleColorClass = 'text-blue-400';
            return result;
        }

        if (!report.attacker || !report.defender) return result;

        const isPerspectiveAttacker = report.attacker.ownerId === perspectiveOwnerId;

        if (report.type.includes('espionage')) {
            result.icon = ICONS.espionage;
            if (isPerspectiveAttacker) {
                const totalLosses = Object.values(report.attacker.losses || {}).reduce((sum, value) => sum + value, 0);
                const totalTroops = Object.values(report.attacker.troops || {}).reduce((sum, value) => sum + value, 0);
                if (totalLosses === 0) result.titleColorClass = 'text-green-400';
                else if (totalLosses < totalTroops) result.titleColorClass = 'text-yellow-300';
                else result.titleColorClass = 'text-red-400';
            } else {
                result.titleColorClass = report.espionageDetected ? 'text-green-400' : 'text-red-400';
            }
            return result;
        }

        if (!report.summary) return result;

        const didAttackerWin = report.winner === report.attacker.playerName;

        if (isPerspectiveAttacker) {
            result.icon = ICONS.attack;
            const losses = report.attacker.losses || {};
            const hadLosses = Object.keys(losses).length > 0;

            if (didAttackerWin) {
                result.titleColorClass = hadLosses ? 'text-yellow-300' : 'text-green-400';
            } else {
                result.titleColorClass = 'text-red-400';
            }
        } else {
            result.icon = ICONS.defense;
            const perspectiveContingent = report.defender.contingents.find(contingent => contingent.ownerId === perspectiveOwnerId);
            const hadLosses = perspectiveContingent && perspectiveContingent.losses && Object.keys(perspectiveContingent.losses).length > 0;

            if (didAttackerWin) {
                result.titleColorClass = 'text-red-400';
            } else {
                result.titleColorClass = hadLosses ? 'text-yellow-300' : 'text-green-400';
            }
        }

        return result;
    }

    async #handleContainerClick(event) {
        const reportItem = event.target.closest('.report-item');
        const deleteButton = event.target.closest('[data-action="delete-report"]');
        const pageButton = event.target.closest('[data-page]');

        if (deleteButton) {
            event.stopPropagation();
            const reportId = deleteButton.dataset.reportId;
            gameManager.sendCommand('delete_report', { reportId });
            return;
        }

        if (reportItem) {
            const reportId = reportItem.dataset.reportId;
            const report = this.#gameState.reports.find(currentReport => currentReport.id === reportId);
            if (report) {
                const battleReportUI = await getBattleReportUI();
                battleReportUI.show(report, this.#gameState);
            }
            return;
        }

        if (!pageButton) {
            return;
        }

        const totalReports = this.#getPerspectiveReports(this.#gameState).length;
        const totalPages = Math.ceil(totalReports / this.#reportsPerPage);

        if (pageButton.dataset.page === 'prev') {
            this.#currentPage = Math.max(1, this.#currentPage - 1);
        } else if (pageButton.dataset.page === 'next') {
            this.#currentPage = Math.min(totalPages, this.#currentPage + 1);
        } else {
            this.#currentPage = parseInt(pageButton.dataset.page, 10);
        }

        this.render(this.#gameState);
    }

    #renderPagination(totalReports) {
        const totalPages = Math.ceil(totalReports / this.#reportsPerPage);
        if (totalPages <= 1) {
            this.#paginationContainer.replaceChildren();
            return;
        }

        const fragment = document.createDocumentFragment();

        const createButton = (label, page, isActive = false, isDisabled = false) => {
            const button = document.createElement('button');
            button.className = `pagination-button${isActive ? ' active' : ''}`;
            button.dataset.page = page;
            button.textContent = label;
            button.disabled = isDisabled;
            return button;
        };

        fragment.appendChild(createButton('«', 'prev', false, this.#currentPage === 1));

        for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
            fragment.appendChild(createButton(String(pageNumber), String(pageNumber), pageNumber === this.#currentPage));
        }

        fragment.appendChild(createButton('»', 'next', false, this.#currentPage === totalPages));

        this.#paginationContainer.replaceChildren(fragment);
    }

    #getPerspectiveReports(state) {
        if (!state || !state.reports) return [];
        const perspectiveOwnerId = this.#getPerspectiveOwnerId(state);
        return state.reports.filter(report => report.ownerId === perspectiveOwnerId);
    }

    #createReportNode() {
        const item = document.createElement('div');
        item.className = 'report-item bg-gray-700/50 hover:bg-gray-700 rounded-lg shadow-md flex items-center gap-4 transition-colors cursor-pointer';

        const icon = document.createElement('div');
        icon.className = 'pl-3';

        const content = document.createElement('div');
        content.className = 'flex-grow py-3';

        const title = document.createElement('p');
        title.className = 'font-semibold';

        const date = document.createElement('p');
        date.className = 'text-xs text-gray-400';

        content.append(title, date);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'flex-shrink-0 p-3 text-gray-500 hover:text-red-400 transition-colors';
        deleteButton.title = 'Borrar informe';
        deleteButton.dataset.action = 'delete-report';
        deleteButton.innerHTML = ICONS.delete;

        item.append(icon, content, deleteButton);

        item.__refs = {
            icon,
            title,
            date,
            deleteButton
        };

        return item;
    }

    #updateReportNode(node, report, isUnread, perspectiveOwnerId) {
        const refs = node.__refs;
        const { icon, titleColorClass } = this.#analyzeReportForPlayer(report, perspectiveOwnerId);
        const title = this.#getReportTitle(report);
        const date = new Date(report.time).toLocaleString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        node.dataset.reportId = report.id;
        node.classList.toggle('unread', isUnread);

        refs.icon.innerHTML = icon;
        refs.title.className = `font-semibold ${titleColorClass}`;
        refs.title.textContent = title;
        refs.date.textContent = date;
        refs.deleteButton.dataset.reportId = report.id;
    }

    render(state) {
        if (!this.#container || !state) return;
        this.#gameState = state;

        const perspectiveOwnerId = this.#getPerspectiveOwnerId(state);
        const perspectiveReports = this.#getPerspectiveReports(state);

        if (perspectiveReports.length === 0) {
            this.#emptyState.classList.remove('hidden');
            reconcileList(this.#list, [], report => report.id, this.#reportNodes, () => null, () => {});
            this.#paginationContainer.replaceChildren();
            return;
        }

        const totalPages = Math.ceil(perspectiveReports.length / this.#reportsPerPage);
        if (this.#currentPage > totalPages) {
            this.#currentPage = totalPages > 0 ? totalPages : 1;
        }

        const startIndex = (this.#currentPage - 1) * this.#reportsPerPage;
        const endIndex = startIndex + this.#reportsPerPage;
        const pagedReports = perspectiveReports.slice(startIndex, endIndex);

        const unreadCount = state.unreadCounts?.[perspectiveOwnerId] || 0;
        const unreadIds = new Set(
            perspectiveReports
                .slice(0, unreadCount)
                .map(report => report.id),
        );

        this.#emptyState.classList.add('hidden');

        reconcileList(
            this.#list,
            pagedReports,
            report => report.id,
            this.#reportNodes,
            () => this.#createReportNode(),
            (node, report) => {
                const isUnread = unreadIds.has(report.id);
                this.#updateReportNode(node, report, isUnread, perspectiveOwnerId);
            }
        );

        this.#renderPagination(perspectiveReports.length);
    }
}

export default ReportListUI;
