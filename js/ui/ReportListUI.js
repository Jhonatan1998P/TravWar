import gameManager from '../GameManager.js';
import { gameData } from '../core/GameData.js';
import battleReportUI from './BattleReportUI.js';
import uiRenderScheduler from './UIRenderScheduler.js';

const ICONS = {
    attack: `<img src="assets/icons/sword.png" alt="Ataque" class="h-8 w-8">`,
    defense: `<img src="assets/icons/shield.png" alt="Defensa" class="h-8 w-8">`,
    espionage: `<img src="assets/icons/report.png" alt="Espionaje" class="h-8 w-8">`,
    settlement: `<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-blue-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 2h10v7h-2V7a1 1 0 00-1-1H6V5zm1 5a1 1 0 011-1h4a1 1 0 110 2H7a1 1 0 01-1-1z" clip-rule="evenodd" /></svg>`,
    delete: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`
};

class ReportListUI {
    #container;
    #paginationContainer;
    #gameState = null;
    #currentPage = 1;
    #reportsPerPage = 10;

    constructor(containerId) {
        this.#container = document.getElementById(containerId);
        this.#paginationContainer = document.getElementById('reports-pagination-container');
        if (!this.#container || !this.#paginationContainer) {
            return;
        }
        document.querySelector('main').addEventListener('click', e => this.#handleContainerClick(e));
        uiRenderScheduler.register(`report-list-ui`, (gameState) => this.render(gameState.state));
    }

    #getReportTitle(report) {
        if (!report) return 'Informe inválido';

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
        } else {
            return `${missionType} de ${attackerName}`;
        }
    }
    
    #analyzeReportForPlayer(report) {
        const result = { icon: '', titleColorClass: 'text-white' };
        if (!report) return result;

        if (report.type === 'settlement_success') {
            result.icon = ICONS.settlement;
            result.titleColorClass = 'text-blue-400';
            return result;
        }
        
        if (!report.attacker || !report.defender) return result;

        const isPlayerAttacker = report.attacker.ownerId === 'player';
        
        if (report.type.includes('espionage')) {
            result.icon = ICONS.espionage;
            if (isPlayerAttacker) {
                const totalLosses = Object.values(report.attacker.losses || {}).reduce((s, v) => s + v, 0);
                const totalTroops = Object.values(report.attacker.troops || {}).reduce((s, v) => s + v, 0);
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

        if (isPlayerAttacker) {
            result.icon = ICONS.attack;
            const initialTroops = report.attacker.troops || {};
            const losses = report.attacker.losses || {};
            const hadLosses = Object.keys(losses).length > 0;
            const allTroopsLost = Object.keys(initialTroops).every(unitId => (initialTroops[unitId] || 0) <= (losses[unitId] || 0));

            if (didAttackerWin) {
                result.titleColorClass = hadLosses ? 'text-yellow-300' : 'text-green-400';
            } else {
                result.titleColorClass = 'text-red-400';
            }
        } else {
            result.icon = ICONS.defense;
            const playerContingent = report.defender.contingents.find(c => c.ownerId === 'player');
            const hadLosses = playerContingent && playerContingent.losses && Object.keys(playerContingent.losses).length > 0;
            
            if (didAttackerWin) {
                result.titleColorClass = 'text-red-400';
            } else {
                result.titleColorClass = hadLosses ? 'text-yellow-300' : 'text-green-400';
            }
        }
        
        return result;
    }

    #handleContainerClick(event) {
        const reportItem = event.target.closest('.report-item');
        const deleteButton = event.target.closest('[data-action="delete-report"]');
        const pageButton = event.target.closest('[data-page]');

        if (deleteButton) {
            event.stopPropagation();
            const reportId = deleteButton.dataset.reportId;
            gameManager.sendCommand('delete_report', { reportId });
        } else if (reportItem) {
            const reportId = reportItem.dataset.reportId;
            const report = this.#gameState.reports.find(r => r.id === reportId);
            if (report) {
                battleReportUI.show(report, this.#gameState);
            }
        } else if (pageButton) {
            const totalReports = this.#getPlayerReports(this.#gameState).length;
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
    }

    #renderPagination(totalReports) {
        const totalPages = Math.ceil(totalReports / this.#reportsPerPage);
        if (totalPages <= 1) {
            this.#paginationContainer.innerHTML = '';
            return;
        }

        let paginationHTML = `
            <button class="pagination-button" data-page="prev" ${this.#currentPage === 1 ? 'disabled' : ''}>«</button>`;

        for (let i = 1; i <= totalPages; i++) {
            paginationHTML += `
                <button class="pagination-button ${i === this.#currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }

        paginationHTML += `
            <button class="pagination-button" data-page="next" ${this.#currentPage === totalPages ? 'disabled' : ''}>»</button>`;

        this.#paginationContainer.innerHTML = paginationHTML;
    }
    
    #getPlayerReports(state) {
        if (!state || !state.reports) return [];
        return state.reports.filter(report => report.ownerId === 'player');
    }

    render(state) {
        if (!this.#container || !state) return;
        this.#gameState = state;

        const playerReports = this.#getPlayerReports(state);

        if (!playerReports || playerReports.length === 0) {
            this.#container.innerHTML = `<div class="text-center text-gray-500 text-sm py-8">No tienes informes.</div>`;
            this.#paginationContainer.innerHTML = '';
            return;
        }
        
        const totalPages = Math.ceil(playerReports.length / this.#reportsPerPage);
        if (this.#currentPage > totalPages) {
            this.#currentPage = totalPages > 0 ? totalPages : 1;
        }

        const startIndex = (this.#currentPage - 1) * this.#reportsPerPage;
        const endIndex = startIndex + this.#reportsPerPage;
        const pagedReports = playerReports.slice(startIndex, endIndex);

        let reportsHTML = '<div class="space-y-2">';
        pagedReports.forEach(report => {
            const reportIndex = state.reports.findIndex(r => r.id === report.id);
            const unreadCount = state.unreadCounts?.['player'] || 0;
            const isUnread = reportIndex < unreadCount;
            
            const { icon, titleColorClass } = this.#analyzeReportForPlayer(report);
            
            const title = this.#getReportTitle(report);
            const date = new Date(report.time).toLocaleString('es-ES', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            reportsHTML += `
                <div class="report-item bg-gray-700/50 hover:bg-gray-700 rounded-lg shadow-md flex items-center gap-4 transition-colors cursor-pointer ${isUnread ? 'unread' : ''}" data-report-id="${report.id}">
                    <div class="pl-3">${icon}</div>
                    <div class="flex-grow py-3">
                        <p class="font-semibold ${titleColorClass}">${title}</p>
                        <p class="text-xs text-gray-400">${date}</p>
                    </div>
                    <button data-action="delete-report" data-report-id="${report.id}" class="flex-shrink-0 p-3 text-gray-500 hover:text-red-400 transition-colors" title="Borrar informe">
                        ${ICONS.delete}
                    </button>
                </div>
            `;
        });
        reportsHTML += '</div>';
        this.#container.innerHTML = reportsHTML;
        this.#renderPagination(playerReports.length);
    }
}

export default ReportListUI;