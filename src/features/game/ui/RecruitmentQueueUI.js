import { gameData } from '../core/GameData.js';
import { formatTime, formatNumber } from '@shared/lib/formatters.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import { selectRecruitmentQueueSignature } from './renderSelectors.js';
import { reconcileList } from './reconcileList.js';
import countdownService from './CountdownService.js';

const BUILDING_DISPLAY_ORDER = {
    barracks: 1,
    greatBarracks: 2,
    stable: 3,
    greatStable: 4,
    workshop: 5,
    palace: 6,
    residence: 7,
    commandCenter: 8
};

const EMPTY_STATE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.125-1.273-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.125-1.273.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>`;

class RecruitmentQueueUI {
    #container;
    #activeCountdownKeys = new Set();
    #expandedQueues = new Set();
    #groupNodes = new Map();
    #groupsContainer;
    #emptyState;
    #countdownScope;
    #schedulerKey;
    #handleContainerClick;

    constructor(containerId) {
        this.#container = document.getElementById(containerId);
        if (!this.#container) {
            console.error(`[RecruitmentQueueUI] No se encontro el contenedor con el ID: ${containerId}`);
            return;
        }

        this.#countdownScope = `recruitment:${containerId}`;
        this.#schedulerKey = `recruitment-queue-${containerId}`;

        this.#setupStaticMarkup();

        this.#handleContainerClick = (event) => {
            const toggleButton = event.target.closest('[data-toggle-queue]');
            if (!toggleButton) return;

            event.stopPropagation();
            const queueId = toggleButton.dataset.toggleQueue;
            this.#toggleQueue(queueId);
        };

        this.#container.addEventListener('click', this.#handleContainerClick);

        uiRenderScheduler.register(this.#schedulerKey, this.render.bind(this), [
            selectRecruitmentQueueSignature
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
        this.#groupNodes.clear();
        this.#expandedQueues.clear();
    }

    #setupStaticMarkup() {
        this.#container.replaceChildren();

        this.#groupsContainer = document.createElement('div');
        this.#groupsContainer.className = 'space-y-3';

        this.#emptyState = document.createElement('div');
        this.#emptyState.className = 'flex flex-col items-center justify-center py-8 text-gray-500 opacity-60';

        const icon = document.createElement('div');
        icon.innerHTML = EMPTY_STATE_ICON;

        const label = document.createElement('span');
        label.className = 'text-sm font-medium';
        label.textContent = 'Cuarteles vacios';

        this.#emptyState.append(icon.firstElementChild, label);

        this.#container.append(this.#groupsContainer, this.#emptyState);
    }

    #toggleQueue(queueId) {
        if (!queueId) return;

        if (this.#expandedQueues.has(queueId)) {
            this.#expandedQueues.delete(queueId);
        } else {
            this.#expandedQueues.add(queueId);
        }

        const detailsElement = this.#groupsContainer.querySelector(`[data-details-for="${queueId}"]`);
        const iconElement = this.#groupsContainer.querySelector(`[data-toggle-icon="${queueId}"]`);

        const isExpanded = this.#expandedQueues.has(queueId);
        if (detailsElement) {
            detailsElement.classList.toggle('hidden', !isExpanded);
        }
        if (iconElement) {
            iconElement.classList.toggle('rotate-180', isExpanded);
        }
    }

    #createPendingRow() {
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center text-sm bg-gray-800/40 px-2 py-1 rounded';

        const label = document.createElement('span');
        label.className = 'text-gray-300';

        const status = document.createElement('span');
        status.className = 'text-gray-500 text-xs';
        status.textContent = 'En cola';

        row.append(label, status);
        row.__refs = { label };
        return row;
    }

    #createGroupNode() {
        const card = document.createElement('div');
        card.className = 'bg-glass-bg border border-primary-border rounded-lg p-3 shadow-sm relative overflow-hidden group';

        const progressBar = document.createElement('div');
        progressBar.className = 'absolute bottom-0 left-0 h-1 bg-blue-500/30 transition-all duration-500';

        const header = document.createElement('div');
        header.className = 'flex justify-between items-start mb-2';

        const left = document.createElement('div');
        left.className = 'flex flex-col';

        const buildingName = document.createElement('span');
        buildingName.className = 'text-xs text-yellow-500 font-bold uppercase tracking-wide';

        const amountRow = document.createElement('div');
        amountRow.className = 'flex items-baseline gap-2 mt-1';

        const currentCount = document.createElement('span');
        currentCount.className = 'text-xl font-bold text-white';

        const unitName = document.createElement('span');
        unitName.className = 'text-sm text-gray-300 font-medium';

        amountRow.append(currentCount, unitName);

        const batchInfo = document.createElement('span');
        batchInfo.className = 'text-xs text-gray-500';

        left.append(buildingName, amountRow, batchInfo);

        const right = document.createElement('div');
        right.className = 'flex flex-col items-end';

        const timerLabel = document.createElement('span');
        timerLabel.className = 'text-xs text-gray-400 mb-0.5';
        timerLabel.textContent = 'Termina en:';

        const timer = document.createElement('div');
        timer.className = 'font-mono text-lg text-blue-300 font-bold tabular-nums';

        const finishAt = document.createElement('span');
        finishAt.className = 'text-[11px] text-gray-500 mt-0.5 font-mono tabular-nums';

        right.append(timerLabel, timer, finishAt);
        header.append(left, right);

        const toggleButton = document.createElement('button');
        toggleButton.className = 'w-full flex items-center justify-center py-1 mt-1 text-gray-400 hover:text-white hover:bg-white/5 rounded transition-colors text-xs font-medium';

        const toggleText = document.createElement('span');

        const toggleIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        toggleIcon.setAttribute('class', 'w-4 h-4 ml-1 transform transition-transform duration-200');
        toggleIcon.setAttribute('fill', 'none');
        toggleIcon.setAttribute('stroke', 'currentColor');
        toggleIcon.setAttribute('viewBox', '0 0 24 24');

        const togglePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        togglePath.setAttribute('stroke-linecap', 'round');
        togglePath.setAttribute('stroke-linejoin', 'round');
        togglePath.setAttribute('stroke-width', '2');
        togglePath.setAttribute('d', 'M19 9l-7 7-7 7');
        toggleIcon.appendChild(togglePath);

        toggleButton.append(toggleText, toggleIcon);

        const details = document.createElement('div');
        details.className = 'mt-2 pt-2 border-t border-gray-700/50 space-y-2 hidden';

        const pendingTitle = document.createElement('div');
        pendingTitle.className = 'text-xs font-bold text-gray-400 uppercase tracking-wider mb-1';
        pendingTitle.textContent = 'En espera:';

        const pendingList = document.createElement('div');
        pendingList.className = 'space-y-2';

        details.append(pendingTitle, pendingList);

        card.append(progressBar, header, toggleButton, details);

        card.__refs = {
            progressBar,
            buildingName,
            currentCount,
            unitName,
            batchInfo,
            timer,
            finishAt,
            toggleButton,
            toggleText,
            toggleIcon,
            details,
            pendingList,
            pendingNodes: new Map()
        };

        return card;
    }

    #getRemainingCount(job) {
        return Math.max(0, Number(job.remainingCount ?? job.count ?? 0));
    }

    #getJobCompletionTime(job) {
        const endTime = Number(job.endTime) || Date.now();
        const remainingCount = this.#getRemainingCount(job);
        const timePerUnit = Math.max(0, Number(job.timePerUnit) || 0);

        if (remainingCount <= 1 || timePerUnit <= 0) {
            return endTime;
        }

        return endTime + ((remainingCount - 1) * timePerUnit);
    }

    #getQueueCompletionTime(entry) {
        return entry.jobs.reduce((latestEndTime, job) => {
            return Math.max(latestEndTime, this.#getJobCompletionTime(job));
        }, Date.now());
    }

    #formatClockTime(timestamp) {
        const date = new Date(timestamp);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }

    #updateGroupNode(node, entry, ownerRace) {
        const refs = node.__refs;
        const currentJob = entry.jobs[0];
        const unitData = gameData.units[ownerRace]?.troops.find(unit => unit.id === currentJob.unitId);
        if (!unitData) {
            return;
        }

        const currentCount = this.#getRemainingCount(currentJob);
        const totalBatchCount = currentJob.totalCount || currentCount;
        const progressPercent = totalBatchCount > 0
            ? ((totalBatchCount - currentCount) / totalBatchCount) * 100
            : 0;
        const queueEndTime = this.#getQueueCompletionTime(entry);

        const queueId = `queue-${entry.buildingId}`;
        const hasMoreJobs = entry.jobs.length > 1;
        const isExpanded = this.#expandedQueues.has(queueId);

        refs.progressBar.style.width = `${progressPercent}%`;
        refs.buildingName.textContent = entry.name;
        refs.currentCount.textContent = formatNumber(currentCount);
        refs.unitName.textContent = unitData.name;
        refs.batchInfo.textContent = totalBatchCount > currentCount
            ? `Lote: ${formatNumber(totalBatchCount)} total`
            : '';

        refs.timer.dataset.timerFor = queueId;
        refs.timer.textContent = formatTime((queueEndTime - Date.now()) / 1000);
        refs.finishAt.textContent = `Fin estimado: ${this.#formatClockTime(queueEndTime)}`;

        refs.toggleButton.dataset.toggleQueue = queueId;
        refs.toggleIcon.dataset.toggleIcon = queueId;
        refs.details.dataset.detailsFor = queueId;

        refs.toggleButton.classList.toggle('hidden', !hasMoreJobs);
        refs.details.classList.toggle('hidden', !hasMoreJobs || !isExpanded);
        refs.toggleIcon.classList.toggle('rotate-180', hasMoreJobs && isExpanded);

        if (hasMoreJobs) {
            refs.toggleText.textContent = `${entry.jobs.length - 1} ordenes mas`;

            const pendingJobs = entry.jobs.slice(1);
            reconcileList(
                refs.pendingList,
                pendingJobs,
                job => job.jobId,
                refs.pendingNodes,
                () => this.#createPendingRow(),
                (row, job) => {
                    const pendingUnit = gameData.units[ownerRace]?.troops.find(unit => unit.id === job.unitId);
                    const pendingCount = this.#getRemainingCount(job);
                    row.__refs.label.textContent = `${formatNumber(pendingCount)} x ${pendingUnit?.name || job.unitId}`;
                }
            );
        } else {
            this.#expandedQueues.delete(queueId);
            reconcileList(refs.pendingList, [], job => job.jobId, refs.pendingNodes, () => null, () => {});
        }
    }

    #subscribeCountdown(entry, nextCountdownKeys) {
        const queueId = `queue-${entry.buildingId}`;
        const queueEndTime = this.#getQueueCompletionTime(entry);
        const countdownKey = `${this.#countdownScope}:${queueId}`;
        nextCountdownKeys.add(countdownKey);

        const timerElement = this.#groupsContainer.querySelector(`[data-timer-for="${queueId}"]`);
        if (!timerElement) return;

        countdownService.subscribe({
            id: countdownKey,
            endTime: queueEndTime,
            onTick: (remainingSeconds) => {
                if (!timerElement.isConnected) {
                    return;
                }

                if (remainingSeconds <= 0) {
                    timerElement.textContent = 'Completando...';
                    timerElement.classList.add('text-green-400');
                } else {
                    timerElement.textContent = formatTime(remainingSeconds);
                    timerElement.classList.remove('text-green-400');
                }
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
        if (!this.#container || !state) return;

        const activeVillage = state.villages.find(v => v.id === state.activeVillageId);
        if (!activeVillage) {
            this.#emptyState.classList.remove('hidden');
            reconcileList(this.#groupsContainer, [], entry => entry.buildingId, this.#groupNodes, () => null, () => {});
            this.#syncCountdownSubscriptions(new Set());
            return;
        }

        const ownerRace = activeVillage.race;
        const queue = activeVillage.recruitmentQueue || [];

        if (queue.length === 0) {
            this.#emptyState.classList.remove('hidden');
            reconcileList(this.#groupsContainer, [], entry => entry.buildingId, this.#groupNodes, () => null, () => {});
            this.#syncCountdownSubscriptions(new Set());
            return;
        }

        this.#emptyState.classList.add('hidden');

        const jobsByBuilding = queue.reduce((acc, job) => {
            const building = activeVillage.buildings.find(currentBuilding => currentBuilding.id === job.buildingId);
            if (!building) return acc;

            if (!acc[building.id]) {
                acc[building.id] = {
                    buildingId: building.id,
                    name: gameData.buildings[building.type]?.name || 'Edificio Desconocido',
                    type: building.type,
                    jobs: []
                };
            }

            acc[building.id].jobs.push(job);
            return acc;
        }, {});

        const sortedEntries = Object.values(jobsByBuilding).sort((left, right) => {
            const leftPriority = BUILDING_DISPLAY_ORDER[left.type] || 99;
            const rightPriority = BUILDING_DISPLAY_ORDER[right.type] || 99;
            return leftPriority - rightPriority;
        });

        reconcileList(
            this.#groupsContainer,
            sortedEntries,
            entry => entry.buildingId,
            this.#groupNodes,
            () => this.#createGroupNode(),
            (node, entry) => this.#updateGroupNode(node, entry, ownerRace)
        );

        const nextCountdownKeys = new Set();
        for (const entry of sortedEntries) {
            this.#subscribeCountdown(entry, nextCountdownKeys);
        }
        this.#syncCountdownSubscriptions(nextCountdownKeys);
    }
}

export default RecruitmentQueueUI;
