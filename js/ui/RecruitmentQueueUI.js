// js/ui/RecruitmentQueueUI.js
import {
    gameData
} from '../core/GameData.js';
import {
    formatTime,
    formatNumber
} from '../utils/formatters.js';
import uiRenderScheduler from './UIRenderScheduler.js';

// Definimos el orden de prioridad visual (menor número = más arriba)
const BUILDING_DISPLAY_ORDER = {
    'barracks': 1,
    'greatBarracks': 2,
    'stable': 3,
    'greatStable': 4,
    'workshop': 5,
    'palace': 6,
    'residence': 7,
    'commandCenter': 8
};

class RecruitmentQueueUI {
    #container;
    #countdownIntervals = new Map();
    #expandedQueues = new Set();

    constructor(containerId) {
        this.#container = document.getElementById(containerId);
        if (!this.#container) {
            console.error(`[RecruitmentQueueUI] No se encontró el contenedor con el ID: ${containerId}`);
            return;
        }

        // Registrar renderizado
        uiRenderScheduler.register(`recruitment-queue-${containerId}`, this.render.bind(this));

        // Event Delegation para los botones de expandir/contraer
        this.#container.addEventListener('click', (e) => {
            const toggleButton = e.target.closest('[data-toggle-queue]');
            if (toggleButton) {
                e.stopPropagation(); // Prevenir propagación
                const queueId = toggleButton.dataset.toggleQueue;
                this._toggleQueue(queueId);
            }
        });
    }

    _toggleQueue(queueId) {
        const detailsElement = this.#container.querySelector(`[data-details-for="${queueId}"]`);
        const iconElement = this.#container.querySelector(`[data-toggle-icon="${queueId}"]`);

        if (this.#expandedQueues.has(queueId)) {
            this.#expandedQueues.delete(queueId);
            if (detailsElement) detailsElement.classList.add('hidden');
            if (iconElement) iconElement.classList.remove('rotate-180');
        } else {
            this.#expandedQueues.add(queueId);
            if (detailsElement) detailsElement.classList.remove('hidden');
            if (iconElement) iconElement.classList.add('rotate-180');
        }
    }

    _startCountdown(job) {
        if (this.#countdownIntervals.has(job.jobId)) {
            clearInterval(this.#countdownIntervals.get(job.jobId));
        }

        const timerElement = this.#container.querySelector(`[data-timer-for="${job.jobId}"]`);
        if (!timerElement) return;

        const updateTimer = () => {
            const now = Date.now();
            const remainingMs = job.endTime - now;

            if (remainingMs <= 0) {
                timerElement.textContent = "Completando...";
                timerElement.classList.add('text-green-400');
            } else {
                timerElement.textContent = formatTime(remainingMs / 1000);
                timerElement.classList.remove('text-green-400');
            }
        };

        updateTimer(); // Ejecutar inmediatamente
        const intervalId = setInterval(updateTimer, 1000);
        this.#countdownIntervals.set(job.jobId, intervalId);
    }

    render({ state, lastTick }) {
        if (!this.#container || !state) return;

        const activeVillage = state.villages.find(v => v.id === state.activeVillageId);
        if (!activeVillage) {
            this.#container.innerHTML = '';
            return;
        }

        const ownerRace = activeVillage.race;
        const queue = activeVillage.recruitmentQueue || [];

        // Limpieza de intervalos de trabajos que ya no existen
        const currentJobIds = new Set(queue.map(job => job.jobId));
        this.#countdownIntervals.forEach((intervalId, jobId) => {
            if (!currentJobIds.has(jobId)) {
                clearInterval(intervalId);
                this.#countdownIntervals.delete(jobId);
            }
        });

        if (queue.length === 0) {
            this.#container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-8 text-gray-500 opacity-60">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.125-1.273-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.125-1.273.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span class="text-sm font-medium">Cuarteles vacíos</span>
            </div>`;
            return;
        }

        // 1. Agrupar trabajos por edificio
        const jobsByBuilding = queue.reduce((acc, job) => {
            const building = activeVillage.buildings.find(b => b.id === job.buildingId);
            if (!building) return acc;

            const buildingName = gameData.buildings[building.type]?.name || 'Edificio Desconocido';
            const buildingId = building.id;
            const buildingType = building.type; // Necesitamos el tipo para ordenar

            if (!acc[buildingId]) {
                acc[buildingId] = {
                    name: buildingName,
                    type: buildingType,
                    jobs: []
                };
            }
            acc[buildingId].jobs.push(job);
            return acc;
        }, {});

        // 2. Obtener las claves (IDs de edificios) y ordenarlas según la prioridad estática
        const sortedBuildingIds = Object.keys(jobsByBuilding).sort((a, b) => {
            const typeA = jobsByBuilding[a].type;
            const typeB = jobsByBuilding[b].type;
            
            const priorityA = BUILDING_DISPLAY_ORDER[typeA] || 99; // 99 para desconocidos al final
            const priorityB = BUILDING_DISPLAY_ORDER[typeB] || 99;

            return priorityA - priorityB;
        });

        let finalHTML = '<div class="space-y-3">';

        // 3. Iterar sobre el array ordenado
        for (const buildingId of sortedBuildingIds) {
            const {
                name: buildingName,
                jobs: buildingJobs
            } = jobsByBuilding[buildingId];
            
            const currentJob = buildingJobs[0];
            const unitData = gameData.units[ownerRace]?.troops.find(t => t.id === currentJob.unitId);

            if (!unitData) continue;

            const currentCount = currentJob.remainingCount !== undefined ? currentJob.remainingCount : currentJob.count;
            const totalBatchCount = currentJob.totalCount || currentCount;

            const progressPercent = totalBatchCount > 0
                ? ((totalBatchCount - currentCount) / totalBatchCount) * 100 : 0;

            const queueId = `queue-${buildingId}`;
            const isExpanded = this.#expandedQueues.has(queueId);
            const hasMoreJobs = buildingJobs.length > 1;

            let detailsHTML = '';
            if (hasMoreJobs) {
                detailsHTML += `<div data-details-for="${queueId}" class="${isExpanded ? '' : 'hidden'} mt-2 pt-2 border-t border-gray-700/50 space-y-2">`;
                detailsHTML += `<div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">En espera:</div>`;

                const pendingJobs = buildingJobs.slice(1);
                pendingJobs.forEach(job => {
                    const pUnit = gameData.units[ownerRace]?.troops.find(t => t.id === job.unitId);
                    const pCount = job.remainingCount !== undefined ? job.remainingCount : job.count;
                    if (pUnit) {
                        detailsHTML += `
                        <div class="flex justify-between items-center text-sm bg-gray-800/40 px-2 py-1 rounded">
                            <span class="text-gray-300">${formatNumber(pCount)} x ${pUnit.name}</span>
                            <span class="text-gray-500 text-xs">En cola</span>
                        </div>
                        `;
                    }
                });
                detailsHTML += `</div>`;
            }

            finalHTML += `
            <div class="bg-glass-bg border border-primary-border rounded-lg p-3 shadow-sm relative overflow-hidden group">
                <!-- Barra de progreso -->
                <div class="absolute bottom-0 left-0 h-1 bg-blue-500/30 transition-all duration-500" style="width: ${progressPercent}%"></div>

                <div class="flex justify-between items-start mb-2">
                    <div class="flex flex-col">
                        <span class="text-xs text-yellow-500 font-bold uppercase tracking-wide">${buildingName}</span>
                        <div class="flex items-baseline gap-2 mt-1">
                            <span class="text-xl font-bold text-white">${formatNumber(currentCount)}</span>
                            <span class="text-sm text-gray-300 font-medium">${unitData.name}</span>
                        </div>
                        ${totalBatchCount > currentCount ? `<span class="text-xs text-gray-500">Lote: ${formatNumber(totalBatchCount)} total</span>` : ''}
                    </div>

                    <div class="flex flex-col items-end">
                        <span class="text-xs text-gray-400 mb-0.5">Siguiente en:</span>
                        <div class="font-mono text-lg text-blue-300 font-bold tabular-nums" data-timer-for="${currentJob.jobId}">
                            Calculando...
                        </div>
                    </div>
                </div>

                ${hasMoreJobs ? `
                <button data-toggle-queue="${queueId}" class="w-full flex items-center justify-center py-1 mt-1 text-gray-400 hover:text-white hover:bg-white/5 rounded transition-colors text-xs font-medium">
                    <span>${buildingJobs.length - 1} órdenes más</span>
                    <svg data-toggle-icon="${queueId}" class="w-4 h-4 ml-1 transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7 7"></path></svg>
                </button>
                ` : ''}

                ${detailsHTML}
            </div>
            `;
        }

        finalHTML += '</div>';
        this.#container.innerHTML = finalHTML;

        for (const buildingId of sortedBuildingIds) {
            const currentJob = jobsByBuilding[buildingId].jobs[0];
            this._startCountdown(currentJob);
        }
    }
}

export default RecruitmentQueueUI;