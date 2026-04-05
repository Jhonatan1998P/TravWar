import { gameData } from '../core/GameData.js';
import { formatTime } from '../utils/formatters.js';
import uiRenderScheduler from './UIRenderScheduler.js';

class SmithyQueueUI {
    #container;
    #wrapper;
    #countdownIntervals = new Map();

    constructor(containerId, wrapperId) {
        this.#container = document.getElementById(containerId);
        this.#wrapper = document.getElementById(wrapperId);
        if (!this.#container || !this.#wrapper) {
            console.error(`[SmithyQueueUI] No se encontraron los elementos: ${containerId}, ${wrapperId}`);
            return;
        }
        uiRenderScheduler.register(`smithy-queue-${containerId}`, this.render.bind(this));
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
            this.#wrapper.classList.add('hidden');
            return;
        }

        const queue = activeVillage.smithy.queue;
        const currentJobIds = new Set(queue.map(job => job.jobId));
        this.#countdownIntervals.forEach((intervalId, jobId) => {
            if (!currentJobIds.has(jobId)) {
                clearInterval(intervalId);
                this.#countdownIntervals.delete(jobId);
            }
        });

        if (!queue || queue.length === 0) {
            this.#wrapper.classList.add('hidden');
            this.#container.innerHTML = '';
            return;
        }
        
        this.#wrapper.classList.remove('hidden');

        let queueHTML = '<ul class="space-y-2">';
        queue.forEach(job => {
            const unitData = gameData.units[activeVillage.race].troops.find(u => u.id === job.unitId);
            const targetLevel = (activeVillage.smithy.upgrades[job.unitId] || 0) + 1;
            const initialRemainingSeconds = (job.endTime - Date.now()) / 1000;

            queueHTML += `
                <li class="flex items-center justify-between p-2 bg-gray-700/60 rounded-lg shadow-md">
                    <div class="flex-grow">
                        <span class="font-semibold text-white">${unitData.name}</span>
                        <span class="text-gray-400 text-sm">(mejorando a Nivel ${targetLevel})</span>
                    </div>
                    <div class="font-mono text-yellow-300 w-24 text-center" data-timer-for="${job.jobId}">
                        ${formatTime(initialRemainingSeconds)}
                    </div>
                </li>
            `;
        });
        queueHTML += '</ul>';

        this.#container.innerHTML = queueHTML;

        queue.forEach(job => {
            this._startCountdown(job);
        });
    }
}

export default SmithyQueueUI;