import gameManager from '@game/state/GameManager.js';
import { gameData } from '../core/GameData.js';
import { formatTime } from '@shared/lib/formatters.js';
import uiRenderScheduler from './UIRenderScheduler.js';

class ConstructionQueueUI {
    #container;
    #countdownIntervals = new Map();

    constructor(containerId) {
        this.#container = document.getElementById(containerId);
        if (!this.#container) {
            console.error(`[ConstructionQueueUI] No se encontró el contenedor con el ID: ${containerId}`);
            return;
        }
        uiRenderScheduler.register(`construction-queue-${containerId}`, this.render.bind(this));
    }

    _handleCancelClick(event) {
        const jobId = event.currentTarget.dataset.jobId;
        if (jobId) {
            gameManager.sendCommand('cancel_construction', { jobId });
        }
    }

    _startCountdown(job) {
        if (this.#countdownIntervals.has(job.jobId)) {
            clearInterval(this.#countdownIntervals.get(job.jobId));
        }

        const timerElement = this.#container.querySelector(`[data-timer-for="${job.jobId}"]`);
        if (!timerElement) return;

        const intervalId = setInterval(() => {
            const remainingMs = job.endTime - Date.now();
            const currentRemainingSeconds = remainingMs / 1000;

            if (currentRemainingSeconds <= 0) {
                timerElement.textContent = formatTime(0);
                clearInterval(intervalId);
                this.#countdownIntervals.delete(job.jobId);
            } else {
                timerElement.textContent = formatTime(currentRemainingSeconds);
            }
        }, 250);

        this.#countdownIntervals.set(job.jobId, intervalId);
    }

    render({ state, lastTick }) {
        if (!this.#container || !state || !lastTick) return;

        const activeVillage = state.villages.find(v => v.id === state.activeVillageId);
        if (!activeVillage) {
            this.#container.innerHTML = '';
            return;
        }
        
        const queue = activeVillage.constructionQueue;
        const maxSlots = activeVillage.maxConstructionSlots;
        const currentJobIds = new Set(queue.map(job => job.jobId));

        this.#countdownIntervals.forEach((intervalId, jobId) => {
            if (!currentJobIds.has(jobId)) {
                clearInterval(intervalId);
                this.#countdownIntervals.delete(jobId);
            }
        });

        if (!queue || queue.length === 0) {
            this.#container.innerHTML = '<div class="text-center text-gray-500 text-sm py-4">No hay construcciones en curso.</div>';
            return;
        }

        const resourceIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2 1M4 7l2-1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" /></svg>`;
        const infraIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>`;

        let queueHTML = `
            <div class="flex justify-between items-center mb-2 px-2">
                <h3 class="text-lg font-semibold text-yellow-400">Construcción</h3>
                <span class="text-sm font-mono text-gray-400">${queue.length} / ${maxSlots}</span>
            </div>
            <ul class="space-y-2">
        `;
        
        queue.forEach(job => {
            const buildingData = gameData.buildings[job.buildingType];
            const initialRemainingSeconds = (job.endTime - Date.now()) / 1000;
            const isResourceJob = /^[wcif]/.test(job.buildingId);

            queueHTML += `
                <li class="flex items-center justify-between p-2 bg-gray-700/60 rounded-lg shadow-md">
                    <div class="flex-shrink-0 w-8 flex items-center justify-center">
                        ${isResourceJob ? resourceIcon : infraIcon}
                    </div>
                    <div class="flex-grow">
                        <span class="font-semibold text-white">${buildingData.name}</span>
                        <span class="text-gray-400 text-sm">(subiendo a Nivel ${job.targetLevel})</span>
                    </div>
                    <div class="font-mono text-yellow-300 w-24 text-center" data-timer-for="${job.jobId}">
                        ${formatTime(initialRemainingSeconds)}
                    </div>
                    <button data-job-id="${job.jobId}" class="cancel-btn ml-2 text-red-500 hover:text-red-400 w-6 h-6 flex items-center justify-center rounded-full bg-red-900/50 hover:bg-red-800/50 transition-colors" title="Cancelar construcción">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </li>
            `;
        });
        queueHTML += '</ul>';

        this.#container.innerHTML = queueHTML;

        this.#container.querySelectorAll('.cancel-btn').forEach(button => {
            button.addEventListener('click', this._handleCancelClick.bind(this));
        });
        
        queue.forEach(job => {
            this._startCountdown(job);
        });
    }
}

export default ConstructionQueueUI;
