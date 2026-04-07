import { gameData } from '../core/GameData.js';
import { formatTime } from '@shared/lib/formatters.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import { selectSmithyQueueSignature } from './renderSelectors.js';
import { reconcileList } from './reconcileList.js';
import countdownService from './CountdownService.js';

class SmithyQueueUI {
    #container;
    #wrapper;
    #activeCountdownKeys = new Set();
    #jobNodes = new Map();
    #list;
    #countdownScope;

    constructor(containerId, wrapperId) {
        this.#container = document.getElementById(containerId);
        this.#wrapper = document.getElementById(wrapperId);
        if (!this.#container || !this.#wrapper) {
            console.error(`[SmithyQueueUI] No se encontraron los elementos: ${containerId}, ${wrapperId}`);
            return;
        }

        this.#countdownScope = `smithy:${containerId}`;

        this.#list = document.createElement('ul');
        this.#list.className = 'space-y-2';
        this.#container.replaceChildren(this.#list);

        uiRenderScheduler.register(`smithy-queue-${containerId}`, this.render.bind(this), [
            selectSmithyQueueSignature
        ]);
    }

    #createJobNode() {
        const item = document.createElement('li');
        item.className = 'flex items-center justify-between p-2 bg-gray-700/60 rounded-lg shadow-md';

        const content = document.createElement('div');
        content.className = 'flex-grow';

        const unitName = document.createElement('span');
        unitName.className = 'font-semibold text-white';

        const levelText = document.createElement('span');
        levelText.className = 'text-gray-400 text-sm';

        content.append(unitName, levelText);

        const timer = document.createElement('div');
        timer.className = 'font-mono text-yellow-300 w-24 text-center';

        item.append(content, timer);
        item.__refs = { unitName, levelText, timer };
        return item;
    }

    #updateJobNode(node, job, activeVillage) {
        const refs = node.__refs;
        const unitData = gameData.units[activeVillage.race].troops.find(unit => unit.id === job.unitId);
        const targetLevel = (activeVillage.smithy.upgrades[job.unitId] || 0) + 1;

        refs.unitName.textContent = unitData?.name || job.unitId;
        refs.levelText.textContent = ` (mejorando a Nivel ${targetLevel})`;
        refs.timer.dataset.timerFor = job.jobId;
        refs.timer.textContent = formatTime((job.endTime - Date.now()) / 1000);
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

        const queue = activeVillage.smithy.queue || [];

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

export default SmithyQueueUI;
