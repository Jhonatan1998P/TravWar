import { gameData } from '../core/GameData.js';
import { formatTime } from '@shared/lib/formatters.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import { selectResearchQueueSignature } from './renderSelectors.js';
import { reconcileList } from './reconcileList.js';
import countdownService from './CountdownService.js';

class ResearchQueueUI {
    #container;
    #wrapper;
    #activeCountdownKeys = new Set();
    #jobNodes = new Map();
    #list;
    #countdownScope;
    #schedulerKey;

    constructor(containerId, wrapperId) {
        this.#container = document.getElementById(containerId);
        this.#wrapper = document.getElementById(wrapperId);
        if (!this.#container || !this.#wrapper) {
            console.error(`[ResearchQueueUI] No se encontraron los elementos: ${containerId}, ${wrapperId}`);
            return;
        }

        this.#countdownScope = `research:${containerId}`;
        this.#schedulerKey = `research-queue-${containerId}`;

        this.#list = document.createElement('ul');
        this.#list.className = 'space-y-2';
        this.#container.replaceChildren(this.#list);

        uiRenderScheduler.register(this.#schedulerKey, this.render.bind(this), [
            selectResearchQueueSignature
        ]);
    }

    destroy() {
        if (this.#schedulerKey) {
            uiRenderScheduler.unregister(this.#schedulerKey);
        }

        countdownService.unsubscribeByPrefix(`${this.#countdownScope}:`);
        this.#activeCountdownKeys.clear();
        this.#jobNodes.clear();
    }

    #createJobNode() {
        const item = document.createElement('li');
        item.className = 'flex items-center justify-between p-2 bg-gray-700/60 rounded-lg shadow-md';

        const content = document.createElement('div');
        content.className = 'flex-grow';

        const unitName = document.createElement('span');
        unitName.className = 'font-semibold text-white';
        content.appendChild(unitName);

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

        item.append(content, timerBlock);
        item.__refs = { unitName, timer, finishAt };
        return item;
    }

    #formatClockTime(timestamp) {
        const date = new Date(timestamp);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }

    #updateJobNode(node, job, activeVillage) {
        const refs = node.__refs;
        const unitData = gameData.units[activeVillage.race].troops.find(unit => unit.id === job.unitId);

        refs.unitName.textContent = unitData?.name || job.unitId;
        refs.timer.dataset.timerFor = job.jobId;
        refs.timer.textContent = formatTime((job.endTime - Date.now()) / 1000);
        refs.finishAt.textContent = `Fin estimado: ${this.#formatClockTime(job.endTime)}`;
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
            this.#wrapper.classList.add('hidden');
            reconcileList(this.#list, [], job => job.jobId, this.#jobNodes, () => null, () => {});
            this.#syncCountdownSubscriptions(new Set());
            return;
        }

        const queue = activeVillage.research.queue || [];

        if (queue.length === 0) {
            this.#wrapper.classList.add('hidden');
            reconcileList(this.#list, [], job => job.jobId, this.#jobNodes, () => null, () => {});
            this.#syncCountdownSubscriptions(new Set());
            return;
        }

        this.#wrapper.classList.remove('hidden');

        reconcileList(
            this.#list,
            queue,
            job => job.jobId,
            this.#jobNodes,
            () => this.#createJobNode(),
            (node, job) => this.#updateJobNode(node, job, activeVillage)
        );

        const nextCountdownKeys = new Set();
        for (const job of queue) {
            this.#subscribeCountdown(job, nextCountdownKeys);
        }
        this.#syncCountdownSubscriptions(nextCountdownKeys);
    }
}

export default ResearchQueueUI;
