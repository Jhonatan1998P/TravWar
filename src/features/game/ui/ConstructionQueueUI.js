import gameManager from '@game/state/GameManager.js';
import { gameData } from '../core/GameData.js';
import { formatTime } from '@shared/lib/formatters.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import { selectConstructionQueueSignature } from './renderSelectors.js';
import { reconcileList } from './reconcileList.js';
import countdownService from './CountdownService.js';

const RESOURCE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2 1M4 7l2-1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" /></svg>`;
const INFRA_ICON = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>`;
const CANCEL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>`;

class ConstructionQueueUI {
    #container;
    #activeCountdownKeys = new Set();
    #jobNodes = new Map();
    #headerCounter;
    #list;
    #emptyState;
    #countdownScope;
    #schedulerKey;
    #handleContainerClick;

    constructor(containerId) {
        this.#container = document.getElementById(containerId);
        if (!this.#container) {
            console.error(`[ConstructionQueueUI] No se encontro el contenedor con el ID: ${containerId}`);
            return;
        }

        this.#countdownScope = `construction:${containerId}`;
        this.#schedulerKey = `construction-queue-${containerId}`;

        this.#setupStaticMarkup();

        this.#handleContainerClick = (event) => {
            const button = event.target.closest('.cancel-btn');
            if (!button) return;

            const jobId = button.dataset.jobId;
            if (jobId) {
                gameManager.sendCommand('cancel_construction', { jobId });
            }
        };

        this.#container.addEventListener('click', this.#handleContainerClick);

        uiRenderScheduler.register(this.#schedulerKey, this.render.bind(this), [
            selectConstructionQueueSignature
        ]);
    }

    destroy() {
        if (!this.#container) {
            return;
        }

        if (this.#handleContainerClick) {
            this.#container.removeEventListener('click', this.#handleContainerClick);
        }

        if (this.#schedulerKey) {
            uiRenderScheduler.unregister(this.#schedulerKey);
        }

        countdownService.unsubscribeByPrefix(`${this.#countdownScope}:`);
        this.#activeCountdownKeys.clear();
        this.#jobNodes.clear();
    }

    #setupStaticMarkup() {
        this.#container.replaceChildren();

        const header = document.createElement('div');
        header.className = 'flex justify-between items-center mb-2 px-2';

        const title = document.createElement('h3');
        title.className = 'text-lg font-semibold text-yellow-400';
        title.textContent = 'Construccion';

        this.#headerCounter = document.createElement('span');
        this.#headerCounter.className = 'text-sm font-mono text-gray-400';
        this.#headerCounter.textContent = '0 / 0';

        header.append(title, this.#headerCounter);

        this.#list = document.createElement('ul');
        this.#list.className = 'space-y-2';

        this.#emptyState = document.createElement('div');
        this.#emptyState.className = 'text-center text-gray-500 text-sm py-4';
        this.#emptyState.textContent = 'No hay construcciones en curso.';

        this.#container.append(header, this.#list, this.#emptyState);
    }

    #createJobNode() {
        const item = document.createElement('li');
        item.className = 'flex items-center justify-between p-2 bg-gray-700/60 rounded-lg shadow-md';

        const iconWrapper = document.createElement('div');
        iconWrapper.className = 'flex-shrink-0 w-8 flex items-center justify-center';

        const content = document.createElement('div');
        content.className = 'flex-grow';

        const buildingName = document.createElement('span');
        buildingName.className = 'font-semibold text-white';

        const levelText = document.createElement('span');
        levelText.className = 'text-gray-400 text-sm';

        content.append(buildingName, levelText);

        const timerBlock = document.createElement('div');
        timerBlock.className = 'flex flex-col items-end w-32 text-right';

        const timerLabel = document.createElement('span');
        timerLabel.className = 'text-[11px] text-gray-400 leading-tight';
        timerLabel.textContent = 'Termina en:';

        const timer = document.createElement('div');
        timer.className = 'font-mono text-yellow-300 leading-tight';

        const finishAt = document.createElement('span');
        finishAt.className = 'text-[11px] text-gray-500 font-mono tabular-nums leading-tight';

        timerBlock.append(timerLabel, timer, finishAt);

        const cancelButton = document.createElement('button');
        cancelButton.className = 'cancel-btn ml-2 text-red-500 hover:text-red-400 w-6 h-6 flex items-center justify-center rounded-full bg-red-900/50 hover:bg-red-800/50 transition-colors';
        cancelButton.title = 'Cancelar construccion';
        cancelButton.innerHTML = CANCEL_ICON;

        item.append(iconWrapper, content, timerBlock, cancelButton);

        item.__refs = {
            iconWrapper,
            buildingName,
            levelText,
            timer,
            finishAt,
            cancelButton
        };

        return item;
    }

    #formatClockTime(timestamp) {
        const date = new Date(timestamp);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }

    #updateJobNode(node, job) {
        const refs = node.__refs;
        const buildingData = gameData.buildings[job.buildingType];
        const isResourceJob = /^[wcif]/.test(job.buildingId);

        refs.iconWrapper.innerHTML = isResourceJob ? RESOURCE_ICON : INFRA_ICON;
        refs.buildingName.textContent = buildingData?.name || job.buildingType;
        refs.levelText.textContent = ` (subiendo a Nivel ${job.targetLevel})`;
        refs.timer.dataset.timerFor = job.jobId;
        refs.timer.textContent = formatTime((job.endTime - Date.now()) / 1000);
        refs.finishAt.textContent = `Fin estimado: ${this.#formatClockTime(job.endTime)}`;
        refs.cancelButton.dataset.jobId = job.jobId;
    }

    #subscribeCountdown(job, nextCountdownKeys) {
        const countdownKey = `${this.#countdownScope}:${job.jobId}`;
        nextCountdownKeys.add(countdownKey);

        const timerElement = this.#list.querySelector(`[data-timer-for="${job.jobId}"]`);
        if (!timerElement) return;

        countdownService.subscribe({
            id: countdownKey,
            endTime: job.endTime,
            onTick: (remainingSeconds) => {
                if (!timerElement.isConnected) {
                    return;
                }
                timerElement.textContent = formatTime(remainingSeconds);
            }
        });
    }

    #syncCountdownSubscriptions(nextCountdownKeys) {
        for (const key of this.#activeCountdownKeys) {
            if (!nextCountdownKeys.has(key)) {
                countdownService.unsubscribe(key);
            }
        }

        this.#activeCountdownKeys = nextCountdownKeys;
    }

    render({ state, lastTick }) {
        if (!this.#container || !state || !lastTick) return;

        const activeVillage = state.villages.find(v => v.id === state.activeVillageId);
        if (!activeVillage) {
            this.#headerCounter.textContent = '0 / 0';
            this.#emptyState.classList.remove('hidden');
            reconcileList(this.#list, [], job => job.jobId, this.#jobNodes, () => null, () => {});
            this.#syncCountdownSubscriptions(new Set());
            return;
        }

        const queue = activeVillage.constructionQueue || [];
        const maxSlots = activeVillage.maxConstructionSlots || 0;

        this.#headerCounter.textContent = `${queue.length} / ${maxSlots}`;
        this.#emptyState.classList.toggle('hidden', queue.length > 0);

        reconcileList(
            this.#list,
            queue,
            job => job.jobId,
            this.#jobNodes,
            () => this.#createJobNode(),
            (node, job) => this.#updateJobNode(node, job)
        );

        const nextCountdownKeys = new Set();
        for (const job of queue) {
            this.#subscribeCountdown(job, nextCountdownKeys);
        }
        this.#syncCountdownSubscriptions(nextCountdownKeys);
    }
}

export default ConstructionQueueUI;
