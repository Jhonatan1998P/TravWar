import gameManager from '@game/state/GameManager.js';
import { router } from '@app/router.js';
import { FARM_LIST_LIMITS, gameData, resolveDefaultFarmTroops } from '../core/GameData.js';
import toastUI from '../ui/ToastUI.js';
import { unitSpriteManager } from '../ui/UnitSpriteManager.js';
import uiRenderScheduler from '../ui/UIRenderScheduler.js';
import { markModalOpened, shouldIgnoreModalAction } from '../ui/modalInteractionGuard.js';
import { perfCollector } from '@shared/lib/perf.js';
import { selectFarmListsViewSignature } from '../ui/renderSelectors.js';

const VIEW_SOURCE = 'farm-lists-view';

function getPerspectiveOwnerId(state) {
    const activeVillage = state?.villages?.find(village => village.id === state.activeVillageId);
    if (activeVillage?.ownerId) return activeVillage.ownerId;

    if (!state?.players) return 'player';

    const explicitPlayer = state.players.find(player => player.id === 'player');
    if (explicitPlayer) return explicitPlayer.id;

    const firstHuman = state.players.find(player => !String(player.id || '').startsWith('ai_'));
    return firstHuman?.id || 'player';
}

class FarmListsView {
    #rootElement = null;
    #gameState = null;
    #selectedListId = null;
    #selectedOriginVillageId = null;
    #entryEditorContext = null;
    #selectedEntryIds = new Set();
    #entryDispatchIndicators = new Map();
    #entryDispatchIndicatorTimeouts = new Map();
    #didReportFirstMeaningfulPaint = false;

    #boundClick;
    #boundChange;
    #boundCommandResult;
    #boundSendResult;

    constructor() {
        this.#boundClick = this._handleClick.bind(this);
        this.#boundChange = this._handleChange.bind(this);
        this.#boundCommandResult = this._handleFarmListCommandResult.bind(this);
        this.#boundSendResult = this._handleFarmListSendResult.bind(this);
        this._handleGameStateUpdate = this._handleGameStateUpdate.bind(this);
    }

    get html() {
        return `
            <main id="farm-lists-view-root" class="flex-grow overflow-y-auto p-3 md:p-4 bg-gradient-to-b from-war-leather/30 to-transparent">
            </main>
        `;
    }

    mount() {
        perfCollector.markStart('view.farmLists.mount');
        perfCollector.markStart('view.farmLists.firstMeaningfulPaint');

        this.#rootElement = document.getElementById('farm-lists-view-root');
        if (!this.#rootElement) return;

        this.#rootElement.addEventListener('click', this.#boundClick);
        this.#rootElement.addEventListener('change', this.#boundChange);
        document.addEventListener('farm_list:command_result', this.#boundCommandResult);
        document.addEventListener('farm_list:send_result', this.#boundSendResult);

        uiRenderScheduler.register('farm-lists-view', this._handleGameStateUpdate, [selectFarmListsViewSignature]);
        gameManager.sendCommand('get_latest_state');

        perfCollector.markEnd('view.farmLists.mount');
    }

    unmount() {
        uiRenderScheduler.unregister('farm-lists-view');
        if (this.#rootElement) {
            this.#rootElement.removeEventListener('click', this.#boundClick);
            this.#rootElement.removeEventListener('change', this.#boundChange);
        }
        document.removeEventListener('farm_list:command_result', this.#boundCommandResult);
        document.removeEventListener('farm_list:send_result', this.#boundSendResult);

        this.#rootElement = null;
        this.#gameState = null;
        this.#selectedListId = null;
        this.#selectedOriginVillageId = null;
        this.#entryEditorContext = null;
        this.#selectedEntryIds.clear();
        this.#entryDispatchIndicators.clear();
        this.#entryDispatchIndicatorTimeouts.forEach(timeoutId => window.clearTimeout(timeoutId));
        this.#entryDispatchIndicatorTimeouts.clear();
        this.#didReportFirstMeaningfulPaint = false;
    }

    _handleGameStateUpdate(gameStatePayload) {
        const { state } = gameStatePayload;
        if (!state) return;
        this.#gameState = state;

        this._ensureSelectionState();
        this._render();

        if (!this.#didReportFirstMeaningfulPaint) {
            this.#didReportFirstMeaningfulPaint = true;
            perfCollector.markEnd('view.farmLists.firstMeaningfulPaint');
        }
    }

    _getOwnerVillages(ownerId) {
        return (this.#gameState?.villages || []).filter(village => village.ownerId === ownerId);
    }

    _getOwnerFarmLists(ownerId) {
        return this.#gameState?.farmListsByOwnerId?.[ownerId]?.lists || [];
    }

    _getOwnerRace(ownerId) {
        return this.#gameState?.players?.find(player => player.id === ownerId)?.race
            || this._getOwnerVillages(ownerId)[0]?.race
            || null;
    }

    _ensureSelectionState() {
        const ownerId = getPerspectiveOwnerId(this.#gameState);
        const ownerVillages = this._getOwnerVillages(ownerId);
        const ownerLists = this._getOwnerFarmLists(ownerId);
        const previousSelectedListId = this.#selectedListId;

        const preferredOriginVillageId = this.#gameState?.activeVillageId;
        if (!ownerVillages.some(village => village.id === this.#selectedOriginVillageId)) {
            if (ownerVillages.some(village => village.id === preferredOriginVillageId)) {
                this.#selectedOriginVillageId = preferredOriginVillageId;
            } else {
                this.#selectedOriginVillageId = ownerVillages[0]?.id || null;
            }
        }

        if (!ownerLists.some(list => list.id === this.#selectedListId)) {
            this.#selectedListId = ownerLists[0]?.id || null;
        }

        if (this.#selectedListId !== previousSelectedListId) {
            this.#selectedEntryIds.clear();
            this.#entryEditorContext = null;
        }

        const selectedList = ownerLists.find(list => list.id === this.#selectedListId) || null;
        const validEntryIds = new Set((selectedList?.entries || []).map(entry => entry.id));
        [...this.#selectedEntryIds].forEach(entryId => {
            if (!validEntryIds.has(entryId)) {
                this.#selectedEntryIds.delete(entryId);
            }
        });
    }

    _getSelectedList(ownerId) {
        const ownerLists = this._getOwnerFarmLists(ownerId);
        const selectedList = ownerLists.find(list => list.id === this.#selectedListId) || null;
        return selectedList || ownerLists[0] || null;
    }

    _resolveTargetLabel(entry) {
        const coords = entry?.targetCoords;
        if (!coords) return 'Objetivo invalido';

        const tile = this.#gameState?.mapData?.find(candidate => candidate.x === coords.x && candidate.y === coords.y) || null;
        if (!tile) {
            return `(${coords.x}|${coords.y})`;
        }

        if (tile.type === 'oasis') {
            const oasisName = gameData.oasisTypes?.[tile.oasisType]?.name || 'Oasis';
            return `${oasisName} (${coords.x}|${coords.y})`;
        }

        if (tile.type === 'village') {
            const village = this.#gameState?.villages?.find(candidate => candidate.id === tile.villageId) || null;
            return `${village?.name || 'Aldea'} (${coords.x}|${coords.y})`;
        }

        return `${tile.type} (${coords.x}|${coords.y})`;
    }

    _normalizeDefaultTroops(ownerRace) {
        const defaults = resolveDefaultFarmTroops(ownerRace);
        if (defaults && Object.keys(defaults).length > 0) {
            return defaults;
        }

        const firstUnit = (gameData.units?.[ownerRace]?.troops || []).find(unit => unit.type !== 'merchant');
        return firstUnit ? { [firstUnit.id]: FARM_LIST_LIMITS.defaultUnitCount } : {};
    }

    _normalizeEditorTroops(rawTroops, ownerRace, options = {}) {
        const { allowDefaultFallback = true } = options;
        const troopCatalog = (gameData.units?.[ownerRace]?.troops || []).filter(unit => unit.type !== 'merchant');
        const allowedUnitIds = new Set(troopCatalog.map(unit => unit.id));
        const normalized = {};

        if (rawTroops && typeof rawTroops === 'object') {
            Object.entries(rawTroops).forEach(([unitId, amount]) => {
                const parsedAmount = Math.floor(Number(amount));
                if (!allowedUnitIds.has(unitId) || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
                normalized[unitId] = parsedAmount;
            });
        }

        if (Object.keys(normalized).length > 0) {
            return normalized;
        }

        if (!allowDefaultFallback) {
            return {};
        }

        return this._normalizeDefaultTroops(ownerRace);
    }

    _getAutoSplitTroopAmount(ownerId, listId, unitId) {
        const ownerLists = this._getOwnerFarmLists(ownerId);
        const list = ownerLists.find(candidate => candidate.id === listId) || null;
        const totalEntries = Math.max(1, Number(list?.entries?.length) || 1);

        const ownerVillages = this._getOwnerVillages(ownerId);
        const originVillage = ownerVillages.find(village => village.id === this.#selectedOriginVillageId)
            || ownerVillages[0]
            || null;

        const totalAvailableUnits = Math.floor(Number(originVillage?.unitsInVillage?.[unitId]) || 0);
        const fallbackAmount = Math.max(1, Math.floor(Number(FARM_LIST_LIMITS.defaultUnitCount) || 1));

        if (!Number.isFinite(totalAvailableUnits) || totalAvailableUnits <= 0) {
            return fallbackAmount;
        }

        const splitAmount = Math.floor(totalAvailableUnits / totalEntries);
        return Math.max(1, splitAmount);
    }

    _setEntryDispatchIndicator(entryId, status, message = '') {
        if (!entryId) return;

        this.#entryDispatchIndicators.set(entryId, { status, message });

        const previousTimeout = this.#entryDispatchIndicatorTimeouts.get(entryId);
        if (previousTimeout) {
            window.clearTimeout(previousTimeout);
        }

        const timeoutId = window.setTimeout(() => {
            this.#entryDispatchIndicators.delete(entryId);
            this.#entryDispatchIndicatorTimeouts.delete(entryId);
            this._render();
        }, 6000);

        this.#entryDispatchIndicatorTimeouts.set(entryId, timeoutId);
    }

    _clearEntryDispatchIndicator(entryId) {
        if (!entryId) return;
        this.#entryDispatchIndicators.delete(entryId);
        const timeoutId = this.#entryDispatchIndicatorTimeouts.get(entryId);
        if (timeoutId) {
            window.clearTimeout(timeoutId);
            this.#entryDispatchIndicatorTimeouts.delete(entryId);
        }
    }

    _getSelectedEntryIdsInListOrder(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return [];
        }
        return entries
            .filter(entry => this.#selectedEntryIds.has(entry.id))
            .map(entry => entry.id);
    }

    _resolveEditorEntry(ownerId) {
        const context = this.#entryEditorContext;
        if (!context) return null;

        const ownerLists = this._getOwnerFarmLists(ownerId);
        const list = ownerLists.find(candidate => candidate.id === context.listId) || null;
        if (!list) return null;

        const entry = (list.entries || []).find(candidate => candidate.id === context.entryId) || null;
        if (!entry) return null;

        return { list, entry };
    }

    _buildEntryEditorModalHtml(ownerId, ownerRace, troopCatalog) {
        const context = this.#entryEditorContext;
        if (!context) {
            return '<div id="farm-view-editor-panel" class="fixed inset-0 h-[100dvh] bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center overflow-y-auto p-2 sm:p-4 z-[70] panel-hidden"></div>';
        }

        const resolved = this._resolveEditorEntry(ownerId);
        if (!resolved) {
            this.#entryEditorContext = null;
            return '<div id="farm-view-editor-panel" class="fixed inset-0 h-[100dvh] bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center overflow-y-auto p-2 sm:p-4 z-[70] panel-hidden"></div>';
        }

        const { list, entry } = resolved;
        const troops = this._normalizeEditorTroops(context.draftTroops, ownerRace);
        context.draftTroops = troops;

        const rows = troopCatalog.map(unit => {
            const unitCount = Number(troops?.[unit.id]) || 0;
            const checked = unitCount > 0;
            const inputValue = checked ? unitCount : '';
            const disabledAttr = checked ? '' : 'disabled';

            return `
                <div class="grid grid-cols-[auto_1fr_auto] items-center gap-3 p-3 bg-gray-900/40 rounded-lg border border-gray-700" data-farm-view-unit-row="${unit.id}">
                    <input type="checkbox" data-farm-view-unit-toggle="${unit.id}" ${checked ? 'checked' : ''} class="h-4 w-4 rounded border-gray-500 bg-gray-700 text-amber-500 focus:ring-amber-500" ${context.isSaving ? 'disabled' : ''}>
                    <label class="flex items-center gap-3 min-w-0" for="farm-view-unit-${unit.id}">
                        ${unitSpriteManager.getUnitSprite(unit.id, ownerRace)}
                        <span class="font-semibold text-gray-100 truncate">${unit.name}</span>
                    </label>
                    <input id="farm-view-unit-${unit.id}" type="number" min="1" step="1" value="${inputValue}" data-farm-view-unit-count="${unit.id}" ${disabledAttr} class="w-24 bg-gray-800 border border-gray-600 text-white rounded-md p-2 text-center font-mono focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-40 disabled:cursor-not-allowed" ${context.isSaving ? 'disabled' : ''}>
                </div>
            `;
        }).join('');

        return `
            <div id="farm-view-editor-panel" class="fixed inset-0 h-[100dvh] bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center overflow-y-auto p-2 sm:p-4 z-[70]">
                <div class="bg-gray-800 border-2 border-gray-700/50 rounded-lg shadow-xl w-full max-w-2xl my-2 sm:my-4 text-white flex flex-col max-h-[calc(100dvh-1rem)]">
                    <header class="flex justify-between items-center p-4 border-b border-gray-700">
                        <h2 class="text-xl font-bold text-amber-300">Editar Lista de Vacas</h2>
                        <button data-action="farm-view-close-editor" class="text-gray-400 text-3xl leading-none hover:text-white">x</button>
                    </header>
                    <main class="p-4 overflow-y-auto min-h-0 max-h-[calc(100dvh-12rem)]">
                        <div class="space-y-4">
                            <div class="rounded-lg border border-gray-700 bg-gray-900/30 p-3">
                                <p class="text-sm text-gray-300">Objetivo: <span class="font-semibold text-amber-300">${this._resolveTargetLabel(entry)}</span></p>
                                <p class="text-xs text-gray-400 mt-1">Lista: <span class="font-semibold text-gray-200">${list.name}</span></p>
                            </div>
                            <div class="space-y-2">
                                ${rows || '<p class="text-sm text-red-400">No hay unidades disponibles para editar.</p>'}
                            </div>
                        </div>
                    </main>
                    <footer class="p-4 border-t border-gray-700 flex flex-col sm:flex-row gap-2 sm:justify-between">
                        <button data-action="farm-view-delete-editor" class="bg-red-700 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg border border-red-600" ${context.isSaving ? 'disabled' : ''}>Eliminar objetivo</button>
                        <div class="flex flex-col sm:flex-row gap-2 sm:justify-end">
                        <button data-action="farm-view-reset-editor" class="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg border border-gray-600" ${context.isSaving ? 'disabled' : ''}>Resetear</button>
                        <button data-action="farm-view-close-editor" class="bg-gray-600 hover:bg-gray-500 text-white font-semibold py-2 px-4 rounded-lg border border-gray-500" ${context.isSaving ? 'disabled' : ''}>Cancelar</button>
                        <button data-action="farm-view-save-editor" class="bg-amber-600 hover:bg-amber-500 text-black font-bold py-2 px-4 rounded-lg border border-amber-500" ${context.isSaving ? 'disabled' : ''}>Guardar</button>
                        </div>
                    </footer>
                </div>
            </div>
        `;
    }

    _collectEditorTroopsFromDom(ownerRace) {
        if (!this.#rootElement) return {};

        const rawTroops = {};
        const toggles = this.#rootElement.querySelectorAll('input[data-farm-view-unit-toggle]');
        toggles.forEach(toggle => {
            if (!toggle.checked) return;
            const unitId = toggle.dataset.farmViewUnitToggle;
            if (!unitId) return;

            const input = this.#rootElement.querySelector(`input[data-farm-view-unit-count="${unitId}"]`);
            const parsedCount = Math.floor(Number(input?.value));
            if (!Number.isFinite(parsedCount) || parsedCount <= 0) return;
            rawTroops[unitId] = parsedCount;
        });

        return this._normalizeEditorTroops(rawTroops, ownerRace, { allowDefaultFallback: false });
    }

    _render() {
        if (!this.#rootElement || !this.#gameState) return;

        const ownerId = getPerspectiveOwnerId(this.#gameState);
        const ownerRace = this._getOwnerRace(ownerId);
        const ownerVillages = this._getOwnerVillages(ownerId);
        const ownerLists = this._getOwnerFarmLists(ownerId);
        const selectedList = this._getSelectedList(ownerId);
        const selectedListId = selectedList?.id || '';
        const selectedOriginVillageId = this.#selectedOriginVillageId || ownerVillages[0]?.id || '';
        const selectedOriginVillage = ownerVillages.find(village => village.id === selectedOriginVillageId) || null;
        const troopCatalog = (gameData.units?.[ownerRace]?.troops || []).filter(unit => unit.type !== 'merchant');

        const villageOptions = ownerVillages.map(village => {
            const selected = village.id === selectedOriginVillageId ? 'selected' : '';
            return `<option value="${village.id}" ${selected}>${village.name} (${village.coords.x}|${village.coords.y})</option>`;
        }).join('');

        const listOptions = ownerLists.map(list => {
            const selected = list.id === selectedListId ? 'selected' : '';
            return `<option value="${list.id}" ${selected}>${list.name} (${(list.entries || []).length}/${FARM_LIST_LIMITS.maxEntriesPerList})</option>`;
        }).join('');

        const entries = selectedList?.entries || [];
        const selectedEntryIdsInOrder = this._getSelectedEntryIdsInListOrder(entries);
        const entriesById = new Map(entries.map(entry => [entry.id, entry]));
        const selectedEntries = selectedEntryIdsInOrder
            .map(entryId => entriesById.get(entryId))
            .filter(Boolean);

        const requiredTroops = {};
        selectedEntries.forEach(entry => {
            const troops = this._normalizeEditorTroops(entry?.troops, ownerRace);
            Object.entries(troops).forEach(([unitId, amount]) => {
                requiredTroops[unitId] = (requiredTroops[unitId] || 0) + (Number(amount) || 0);
            });
        });

        const availableTroops = selectedOriginVillage?.unitsInVillage || {};
        const requiredUnitIds = Object.keys(requiredTroops);
        const hasTroopShortage = requiredUnitIds.some(unitId => (requiredTroops[unitId] || 0) > (Number(availableTroops[unitId]) || 0));
        const requiredRows = requiredUnitIds.map(unitId => {
            const unitData = troopCatalog.find(unit => unit.id === unitId) || null;
            const requiredAmount = Number(requiredTroops[unitId]) || 0;
            const availableAmount = Number(availableTroops[unitId]) || 0;
            const enough = availableAmount >= requiredAmount;
            const shortageAmount = Math.max(0, requiredAmount - availableAmount);
            return `
                <div class="rounded-lg border ${enough ? 'border-emerald-600/50 bg-emerald-950/20' : 'border-red-600/50 bg-red-950/20'} p-2.5">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2 min-w-0">
                            ${unitData ? unitSpriteManager.getUnitSprite(unitData.id, ownerRace) : ''}
                            <span class="text-xs text-gray-200 truncate">${unitData?.name || unitId}</span>
                        </div>
                        <span class="text-[11px] px-1.5 py-0.5 rounded ${enough ? 'text-emerald-300 bg-emerald-900/40 border border-emerald-600/40' : 'text-red-300 bg-red-900/40 border border-red-600/40'}">${enough ? 'OK' : `Falta ${shortageAmount}`}</span>
                    </div>
                    <div class="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                        <div class="rounded bg-black/20 px-2 py-1 text-gray-300">Req: <span class="font-semibold text-gray-100">${requiredAmount}</span></div>
                        <div class="rounded bg-black/20 px-2 py-1 text-gray-300">Disp: <span class="font-semibold ${enough ? 'text-emerald-300' : 'text-red-300'}">${availableAmount}</span></div>
                    </div>
                </div>
            `;
        }).join('');

        const selectionSummaryHtml = selectedEntries.length === 0
            ? '<p class="text-xs text-gray-400">Selecciona entradas para ver el consumo total de tropas.</p>'
            : `
                <div class="space-y-2">
                    <div class="text-xs text-gray-200 font-semibold">Consumo estimado de tropas</div>
                    <div class="text-xs ${hasTroopShortage ? 'text-red-300' : 'text-emerald-300'}">
                        ${hasTroopShortage
                            ? 'No alcanzan las tropas para cubrir toda la selección. Se enviará en orden y puede fallar en entradas finales.'
                            : 'Tropas suficientes para cubrir toda la selección.'}
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${requiredRows}</div>
                </div>
            `;

        const entriesHtml = entries.length === 0
            ? '<p class="text-sm text-gray-400">Esta lista no tiene objetivos todavía.</p>'
            : entries.map(entry => {
                const indicator = this.#entryDispatchIndicators.get(entry.id) || null;
                const indicatorIsSuccess = indicator?.status === 'success';
                const indicatorSymbol = indicatorIsSuccess ? '✓' : '✕';
                const indicatorClass = indicatorIsSuccess
                    ? 'text-emerald-300 bg-emerald-900/40 border-emerald-600/40'
                    : 'text-red-300 bg-red-900/40 border-red-600/40';
                const indicatorTitle = indicator?.message || (indicatorIsSuccess ? 'Envío exitoso' : 'Envío fallido');

                return `
                    <article class="rounded-lg border border-primary-border bg-glass-bg p-3" data-entry-id-row="${entry.id}">
                        <div class="flex items-center gap-2">
                            <input type="checkbox" class="farm-view-entry-select h-4 w-4" data-entry-id="${entry.id}" ${this.#selectedEntryIds.has(entry.id) ? 'checked' : ''}>
                            <p class="min-w-0 flex-grow font-semibold text-yellow-300 break-words">${this._resolveTargetLabel(entry)}</p>
                            <div class="flex items-center gap-2">
                                ${indicator ? `<span title="${indicatorTitle}" class="inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-bold ${indicatorClass}">${indicatorSymbol}</span>` : ''}
                                <button data-action="farm-view-open-editor" data-entry-id="${entry.id}" class="text-xs px-2 py-1 rounded bg-btn-secondary-bg hover:bg-btn-secondary-hover border border-primary-border">Editar</button>
                            </div>
                        </div>
                    </article>
                `;
            }).join('');

        const dispatchLegendHtml = '<div class="flex flex-wrap items-center gap-2 text-[11px] text-gray-300"><span class="inline-flex items-center gap-1 rounded border border-emerald-600/40 bg-emerald-900/30 px-1.5 py-0.5 text-emerald-300">✓ Enviado</span><span class="inline-flex items-center gap-1 rounded border border-red-600/40 bg-red-900/30 px-1.5 py-0.5 text-red-300">✕ Falló</span><span class="text-gray-400">Indicador temporal por entrada</span></div>';

        const editorModalHtml = this._buildEntryEditorModalHtml(ownerId, ownerRace, troopCatalog);

        const ownerRaceLabel = gameData.units?.[ownerRace]?.name || ownerRace || 'Sin raza';
        this.#rootElement.innerHTML = `
            <section class="rounded-xl border border-primary-border bg-glass-bg p-4 space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 class="text-xl md:text-2xl font-bold text-yellow-300">Centro de Listas de Vacas</h1>
                        <p class="text-sm text-gray-300">Gestiona objetivos, presets y lanzamientos rápidos desde una vista dedicada.</p>
                    </div>
                    <div class="flex gap-2">
                        <button data-action="farm-view-refresh" class="px-3 py-2 text-xs rounded-md bg-btn-secondary-bg hover:bg-btn-secondary-hover border border-primary-border">Actualizar</button>
                        <button data-action="farm-view-back-rally" class="px-3 py-2 text-xs rounded-md bg-purple-700 hover:bg-purple-600 border border-primary-border">Volver a Plaza</button>
                    </div>
                </div>
                <div class="text-xs text-gray-400">Propietario activo: <span class="text-gray-200 font-semibold">${ownerId}</span> • Tribu: <span class="text-gray-200 font-semibold">${ownerRaceLabel}</span></div>
            </section>

            <div class="mt-3 grid grid-cols-1 xl:grid-cols-[330px_1fr] gap-3">
                <aside class="rounded-xl border border-primary-border bg-glass-bg p-4 space-y-4">
                    <div>
                        <h2 class="font-semibold text-gray-200">Configuración base</h2>
                        <p class="text-xs text-gray-400 mt-1">Máx listas: ${FARM_LIST_LIMITS.maxListsPerOwner} • Máx objetivos/lista: ${FARM_LIST_LIMITS.maxEntriesPerList} • Cooldown: ${Math.floor(FARM_LIST_LIMITS.minDispatchCooldownMs / 1000)}s</p>
                    </div>

                    <div class="space-y-2">
                        <label class="text-xs font-semibold text-gray-400">Aldea de origen para envíos</label>
                        <select data-action="farm-view-select-origin" class="w-full bg-btn-secondary-bg border-primary-border text-white rounded-md p-2 text-sm" ${ownerVillages.length === 0 ? 'disabled' : ''}>
                            ${ownerVillages.length === 0 ? '<option value="">Sin aldeas disponibles</option>' : villageOptions}
                        </select>
                    </div>

                    <div class="space-y-2">
                        <label class="text-xs font-semibold text-gray-400">Listas existentes (${ownerLists.length}/${FARM_LIST_LIMITS.maxListsPerOwner})</label>
                        <select data-action="farm-view-select-list" class="w-full bg-btn-secondary-bg border-primary-border text-white rounded-md p-2 text-sm" ${ownerLists.length === 0 ? 'disabled' : ''}>
                            ${ownerLists.length === 0 ? '<option value="">Sin listas</option>' : listOptions}
                        </select>
                    </div>

                    <div class="space-y-2">
                        <label class="text-xs font-semibold text-gray-400">Crear nueva lista</label>
                        <div class="grid grid-cols-[1fr_auto] gap-2">
                            <input id="farm-view-new-list-name" type="text" maxlength="40" placeholder="Nombre de lista" class="bg-btn-secondary-bg border-primary-border text-white rounded-md p-2 text-sm">
                            <button data-action="farm-view-create-list" class="px-3 py-2 text-xs font-semibold rounded-md bg-btn-primary-bg hover:bg-btn-primary-hover border border-primary-border">Crear</button>
                        </div>
                    </div>

                    <div class="space-y-2">
                        <label class="text-xs font-semibold text-gray-400">Renombrar lista seleccionada</label>
                        <div class="grid grid-cols-[1fr_auto_auto] gap-2">
                            <input id="farm-view-rename-list-name" type="text" maxlength="40" value="${selectedList?.name || ''}" placeholder="Nuevo nombre" class="bg-btn-secondary-bg border-primary-border text-white rounded-md p-2 text-sm" ${selectedList ? '' : 'disabled'}>
                            <button data-action="farm-view-rename-list" class="px-3 py-2 text-xs font-semibold rounded-md bg-btn-secondary-bg hover:bg-btn-secondary-hover border border-primary-border" ${selectedList ? '' : 'disabled'}>Guardar</button>
                            <button data-action="farm-view-delete-list" class="px-3 py-2 text-xs font-semibold rounded-md bg-red-700 hover:bg-red-600 border border-primary-border" ${selectedList ? '' : 'disabled'}>Eliminar</button>
                        </div>
                    </div>

                    <div class="space-y-2 pt-2 border-t border-primary-border/60">
                        <label class="text-xs font-semibold text-gray-400">Añadir objetivo por coordenadas</label>
                        <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                            <input id="farm-view-add-x" type="number" placeholder="X" class="min-w-0 bg-btn-secondary-bg border-primary-border text-white rounded-md p-2 text-sm" ${selectedList ? '' : 'disabled'}>
                            <input id="farm-view-add-y" type="number" placeholder="Y" class="min-w-0 bg-btn-secondary-bg border-primary-border text-white rounded-md p-2 text-sm" ${selectedList ? '' : 'disabled'}>
                            <button data-action="farm-view-add-entry" class="w-full sm:w-auto px-3 py-2 text-xs font-semibold rounded-md bg-amber-600 hover:bg-amber-500 text-black border border-primary-border" ${selectedList ? '' : 'disabled'}>Añadir</button>
                        </div>
                    </div>
                </aside>

                <section class="rounded-xl border border-primary-border bg-glass-bg p-4 space-y-3 min-h-[360px]">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h2 class="font-semibold text-gray-100">${selectedList ? selectedList.name : 'Sin lista seleccionada'}</h2>
                            <p class="text-xs text-gray-400">${selectedList ? `Entradas: ${(selectedList.entries || []).length}/${FARM_LIST_LIMITS.maxEntriesPerList}` : 'Crea una lista para comenzar.'}</p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <button data-action="farm-view-select-all" class="px-3 py-2 text-xs rounded-md bg-btn-secondary-bg hover:bg-btn-secondary-hover border border-primary-border" ${selectedList ? '' : 'disabled'}>Seleccionar todo</button>
                            <button data-action="farm-view-clear-selection" class="px-3 py-2 text-xs rounded-md bg-btn-secondary-bg hover:bg-btn-secondary-hover border border-primary-border" ${selectedList ? '' : 'disabled'}>Limpiar</button>
                            <button data-action="farm-view-send-selected" class="px-3 py-2 text-xs rounded-md bg-amber-600 hover:bg-amber-500 text-black font-semibold border border-primary-border" ${selectedList && selectedOriginVillage && selectedEntryIdsInOrder.length > 0 ? '' : 'disabled'}>Enviar seleccionadas</button>
                        </div>
                    </div>

                    <div class="rounded-lg border border-primary-border/60 bg-black/20 p-3 space-y-2">
                        <p class="text-xs text-gray-300">Orden de envío: secuencial según posición en la lista.</p>
                        <p class="text-xs text-gray-400">Selección actual: ${selectedEntries.length} objetivo(s).</p>
                        ${selectionSummaryHtml}
                    </div>

                    <div class="space-y-2">
                        ${dispatchLegendHtml}
                        ${entriesHtml}
                    </div>
                </section>
            </div>

            ${editorModalHtml}
        `;
    }

    _handleClick(event) {
        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) return;

        const action = actionButton.dataset.action;
        const ownerId = getPerspectiveOwnerId(this.#gameState);
        const selectedList = this._getSelectedList(ownerId);

        if (action === 'farm-view-back-rally') {
            const selectedOriginVillageId = this.#selectedOriginVillageId;
            if (selectedOriginVillageId) {
                gameManager.sendCommand('switch_village', { villageId: selectedOriginVillageId });
            }
            router.navigate('/village-center');
            return;
        }

        if (action === 'farm-view-refresh') {
            gameManager.sendCommand('get_latest_state');
            toastUI.show('Vista de listas actualizada.', 'info');
            return;
        }

        if (action === 'farm-view-create-list') {
            const input = this.#rootElement.querySelector('#farm-view-new-list-name');
            const listName = input?.value?.trim() || `Lista ${this._getOwnerFarmLists(ownerId).length + 1}`;
            const listId = `farm_list_view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

            gameManager.sendCommand('farm_list_create', {
                ownerId,
                listId,
                name: listName,
                meta: {
                    source: VIEW_SOURCE,
                    action: 'create-list',
                    listName,
                },
            });
            return;
        }

        if (action === 'farm-view-rename-list') {
            if (!selectedList) {
                toastUI.show('Selecciona una lista para renombrar.', 'warning');
                return;
            }
            const input = this.#rootElement.querySelector('#farm-view-rename-list-name');
            const listName = input?.value?.trim() || '';
            if (!listName) {
                toastUI.show('El nombre de la lista no puede estar vacío.', 'warning');
                return;
            }

            gameManager.sendCommand('farm_list_rename', {
                ownerId,
                listId: selectedList.id,
                name: listName,
                meta: {
                    source: VIEW_SOURCE,
                    action: 'rename-list',
                    listName,
                },
            });
            return;
        }

        if (action === 'farm-view-delete-list') {
            if (!selectedList) {
                toastUI.show('Selecciona una lista para eliminar.', 'warning');
                return;
            }
            const confirmed = window.confirm(`¿Eliminar la lista "${selectedList.name}"?`);
            if (!confirmed) return;

            gameManager.sendCommand('farm_list_delete', {
                ownerId,
                listId: selectedList.id,
                meta: {
                    source: VIEW_SOURCE,
                    action: 'delete-list',
                    listName: selectedList.name,
                },
            });
            return;
        }

        if (action === 'farm-view-add-entry') {
            if (!selectedList) {
                toastUI.show('Selecciona una lista antes de añadir objetivos.', 'warning');
                return;
            }
            const xInput = this.#rootElement.querySelector('#farm-view-add-x');
            const yInput = this.#rootElement.querySelector('#farm-view-add-y');
            const x = Number.parseInt(xInput?.value ?? '', 10);
            const y = Number.parseInt(yInput?.value ?? '', 10);

            if (!Number.isInteger(x) || !Number.isInteger(y)) {
                toastUI.show('Debes ingresar coordenadas válidas.', 'warning');
                return;
            }

            gameManager.sendCommand('farm_list_add_entry_by_coords', {
                ownerId,
                listId: selectedList.id,
                targetCoords: { x, y },
                meta: {
                    source: VIEW_SOURCE,
                    action: 'add-entry-by-coords',
                    listName: selectedList.name,
                },
            });
            return;
        }

        if (action === 'farm-view-open-editor') {
            if (!selectedList) return;
            const entryId = actionButton.dataset.entryId;
            if (!entryId) return;

            this.#entryEditorContext = {
                ownerId,
                ownerRace: this._getOwnerRace(ownerId),
                listId: selectedList.id,
                entryId,
                draftTroops: {},
                isSaving: false,
                openedAt: markModalOpened(),
            };

            const resolved = this._resolveEditorEntry(ownerId);
            if (!resolved) {
                this.#entryEditorContext = null;
                toastUI.show('No se encontró la entrada seleccionada.', 'warning');
                return;
            }

            this.#entryEditorContext.draftTroops = this._normalizeEditorTroops(
                resolved.entry?.troops,
                this.#entryEditorContext.ownerRace,
            );
            this._render();
            return;
        }

        if (action === 'farm-view-delete-editor') {
            if (!this.#entryEditorContext || this.#entryEditorContext.isSaving) return;
            if (shouldIgnoreModalAction(this.#entryEditorContext.openedAt)) return;
            const context = this.#entryEditorContext;
            const resolved = this._resolveEditorEntry(ownerId);
            if (!resolved) {
                this.#entryEditorContext = null;
                toastUI.show('No se encontró la entrada seleccionada.', 'warning');
                this._render();
                return;
            }

            const confirmed = window.confirm(`¿Eliminar el objetivo ${this._resolveTargetLabel(resolved.entry)} de la lista "${resolved.list.name}"?`);
            if (!confirmed) return;

            context.isSaving = true;
            this._render();

            gameManager.sendCommand('farm_list_remove_entry', {
                ownerId,
                listId: resolved.list.id,
                entryId: resolved.entry.id,
                meta: {
                    source: VIEW_SOURCE,
                    action: 'remove-entry-modal',
                    listName: resolved.list.name,
                },
            });
            return;
        }

        if (action === 'farm-view-close-editor') {
            this.#entryEditorContext = null;
            this._render();
            return;
        }

        if (action === 'farm-view-reset-editor') {
            if (!this.#entryEditorContext || this.#entryEditorContext.isSaving) return;
            if (shouldIgnoreModalAction(this.#entryEditorContext.openedAt)) return;
            this.#entryEditorContext.draftTroops = this._normalizeDefaultTroops(this.#entryEditorContext.ownerRace);
            this._render();
            return;
        }

        if (action === 'farm-view-save-editor') {
            if (!this.#entryEditorContext || this.#entryEditorContext.isSaving) return;
            if (shouldIgnoreModalAction(this.#entryEditorContext.openedAt)) return;
            const context = this.#entryEditorContext;
            const resolved = this._resolveEditorEntry(ownerId);
            if (!resolved) {
                this.#entryEditorContext = null;
                toastUI.show('No se encontró la entrada seleccionada.', 'warning');
                this._render();
                return;
            }

            const troops = this._collectEditorTroopsFromDom(context.ownerRace);
            if (Object.keys(troops).length === 0) {
                toastUI.show('Debes seleccionar al menos un tipo de tropa con cantidad válida.', 'warning');
                return;
            }

            context.isSaving = true;
            context.draftTroops = troops;
            this._render();

            gameManager.sendCommand('farm_list_update_entry_troops', {
                ownerId,
                listId: resolved.list.id,
                entryId: resolved.entry.id,
                troops,
                meta: {
                    source: VIEW_SOURCE,
                    action: 'save-entry-troops-modal',
                    listName: resolved.list.name,
                },
            });
            return;
        }

        if (action === 'farm-view-select-all') {
            (selectedList?.entries || []).forEach(entry => this.#selectedEntryIds.add(entry.id));
            this._render();
            return;
        }

        if (action === 'farm-view-clear-selection') {
            this.#selectedEntryIds.clear();
            this._render();
            return;
        }

        if (action === 'farm-view-send-selected') {
            if (!selectedList) {
                toastUI.show('Selecciona una lista primero.', 'warning');
                return;
            }
            if (!this.#selectedOriginVillageId) {
                toastUI.show('Selecciona una aldea de origen.', 'warning');
                return;
            }

            const selectedEntryIds = this._getSelectedEntryIdsInListOrder(selectedList?.entries || []);

            if (selectedEntryIds.length === 0) {
                toastUI.show('Selecciona al menos un objetivo.', 'warning');
                return;
            }

            gameManager.sendCommand('farm_list_send_entries', {
                ownerId,
                listId: selectedList.id,
                originVillageId: this.#selectedOriginVillageId,
                missionType: FARM_LIST_LIMITS.defaultMissionType,
                entryIds: selectedEntryIds,
                meta: {
                    source: VIEW_SOURCE,
                    action: 'send-selected',
                    listName: selectedList.name,
                },
            });
        }
    }

    _handleChange(event) {
        const target = event.target;

        if (target.matches('select[data-action="farm-view-select-origin"]')) {
            this.#selectedOriginVillageId = target.value || null;
            this._render();
            return;
        }

        if (target.matches('select[data-action="farm-view-select-list"]')) {
            this.#selectedListId = target.value || null;
            this.#selectedEntryIds.clear();
            this._render();
            return;
        }

        if (target.matches('input.farm-view-entry-select')) {
            const entryId = target.dataset.entryId;
            if (!entryId) return;
            if (target.checked) {
                this.#selectedEntryIds.add(entryId);
            } else {
                this.#selectedEntryIds.delete(entryId);
            }
            this._render();
            return;
        }

        if (!this.#entryEditorContext || this.#entryEditorContext.isSaving) {
            return;
        }

        const unitToggle = target.closest('input[data-farm-view-unit-toggle]');
        if (unitToggle) {
            const unitId = unitToggle.dataset.farmViewUnitToggle;
            const countInput = this.#rootElement.querySelector(`input[data-farm-view-unit-count="${unitId}"]`);
            if (!countInput) return;

            if (unitToggle.checked) {
                const parsedCount = this._getAutoSplitTroopAmount(
                    this.#entryEditorContext.ownerId,
                    this.#entryEditorContext.listId,
                    unitId,
                );
                countInput.disabled = false;
                countInput.value = String(parsedCount);
                this.#entryEditorContext.draftTroops[unitId] = parsedCount;
            } else {
                countInput.disabled = true;
                countInput.value = '';
                delete this.#entryEditorContext.draftTroops[unitId];
            }

            return;
        }

        const countInput = target.closest('input[data-farm-view-unit-count]');
        if (countInput) {
            const unitId = countInput.dataset.farmViewUnitCount;
            const unitToggleInput = this.#rootElement.querySelector(`input[data-farm-view-unit-toggle="${unitId}"]`);
            if (!unitToggleInput || !unitToggleInput.checked) return;

            const parsedCount = Math.floor(Number(countInput.value));
            if (!Number.isFinite(parsedCount) || parsedCount <= 0) {
                delete this.#entryEditorContext.draftTroops[unitId];
                return;
            }

            this.#entryEditorContext.draftTroops[unitId] = parsedCount;
        }
    }

    _handleFarmListCommandResult(event) {
        const detail = event?.detail;
        const command = detail?.command;
        const request = detail?.request || {};
        const result = detail?.result || {};

        if (request?.meta?.source !== VIEW_SOURCE) {
            return;
        }

        if (command === 'farm_list_send_entries') {
            return;
        }

        if (!result.success) {
            if (command === 'farm_list_update_entry_troops' && this.#entryEditorContext) {
                this.#entryEditorContext.isSaving = false;
                this._render();
            }
            toastUI.show(this._resolveFarmListReasonMessage(result.reason, result.details), 'error');
            return;
        }

        if (command === 'farm_list_create') {
            this.#selectedListId = result?.list?.id || request?.listId || this.#selectedListId;
            const input = this.#rootElement?.querySelector('#farm-view-new-list-name');
            if (input) input.value = '';
            toastUI.show(`Lista "${request?.meta?.listName || result?.list?.name || 'Nueva Lista'}" creada.`, 'success');
        } else if (command === 'farm_list_rename') {
            toastUI.show('Nombre de lista actualizado.', 'success');
        } else if (command === 'farm_list_delete') {
            if (result?.deletedListId && result.deletedListId === this.#selectedListId) {
                this.#selectedListId = null;
                this.#selectedEntryIds.clear();
            }
            if (this.#entryEditorContext && result?.deletedListId === this.#entryEditorContext.listId) {
                this.#entryEditorContext = null;
            }
            toastUI.show('Lista eliminada.', 'success');
        } else if (command === 'farm_list_add_entry_by_coords') {
            const xInput = this.#rootElement?.querySelector('#farm-view-add-x');
            const yInput = this.#rootElement?.querySelector('#farm-view-add-y');
            if (xInput) xInput.value = '';
            if (yInput) yInput.value = '';
            toastUI.show('Objetivo añadido a la lista.', 'success');
        } else if (command === 'farm_list_update_entry_troops') {
            if (this.#entryEditorContext) {
                this.#entryEditorContext = null;
            }
            toastUI.show('Preset de tropas actualizado.', 'success');
        } else if (command === 'farm_list_remove_entry') {
            const removedEntryId = result?.deletedEntryId || request?.entryId || null;
            if (this.#entryEditorContext && request?.entryId === this.#entryEditorContext.entryId) {
                this.#entryEditorContext = null;
            }
            if (removedEntryId) {
                this.#selectedEntryIds.delete(removedEntryId);
                this._clearEntryDispatchIndicator(removedEntryId);
            }
            toastUI.show('Objetivo eliminado de la lista.', 'success');
        }

        gameManager.sendCommand('get_latest_state');
    }

    _handleFarmListSendResult(event) {
        const detail = event?.detail || {};
        const request = detail.request || {};
        if (request?.meta?.source !== VIEW_SOURCE) {
            return;
        }

        const results = Array.isArray(detail.results) ? detail.results : [];
        const sentCount = Number(detail.sentCount) || 0;
        const failedCount = Number(detail.failedCount) || 0;

        results.forEach(item => {
            if (!item?.entryId) return;
            if (item.success) {
                this._setEntryDispatchIndicator(item.entryId, 'success', 'Movimiento enviado con éxito.');
                return;
            }
            const failMessage = this._resolveFarmListReasonMessage(item.reason, item.details);
            this._setEntryDispatchIndicator(item.entryId, 'error', failMessage);
        });

        if (results.length > 0) {
            this._render();
        }

        if (results.length === 0) {
            if (detail.success) {
                toastUI.show('Envío de lista completado.', 'success');
            } else {
                toastUI.show(this._resolveFarmListReasonMessage(detail.reason, detail.details), 'error');
            }
            gameManager.sendCommand('get_latest_state');
            return;
        }

        if (sentCount > 0 && failedCount === 0) {
            toastUI.show(`Envío completado: ${sentCount} objetivo(s) despachado(s).`, 'success');
            gameManager.sendCommand('get_latest_state');
            return;
        }

        const firstFailed = results.find(item => item && item.success === false) || null;
        if (sentCount > 0) {
            const failureMessage = firstFailed
                ? this._resolveFarmListReasonMessage(firstFailed.reason, firstFailed.details)
                : 'Algunas entradas fallaron.';
            toastUI.show(`Envío parcial: ${sentCount} ok, ${failedCount} fallaron. ${failureMessage}`, 'warning');
            gameManager.sendCommand('get_latest_state');
            return;
        }

        const reason = firstFailed?.reason || detail.reason;
        const details = firstFailed?.details || detail.details;
        toastUI.show(this._resolveFarmListReasonMessage(reason, details), 'error');
        gameManager.sendCommand('get_latest_state');
    }

    _resolveFarmListReasonMessage(reason, details = null) {
        if (reason === 'FARM_LIST_MAX_LISTS_REACHED') {
            return `Solo puedes tener ${details?.maxListsPerOwner || FARM_LIST_LIMITS.maxListsPerOwner} listas.`;
        }
        if (reason === 'FARM_LIST_MAX_ENTRIES_REACHED') {
            return `La lista alcanzó el máximo de ${details?.maxEntriesPerList || FARM_LIST_LIMITS.maxEntriesPerList} objetivos.`;
        }
        if (reason === 'INVALID_TARGET_COORDS') {
            return 'Debes usar coordenadas válidas.';
        }
        if (reason === 'TARGET_COORDS_OUT_OF_MAP') {
            return 'Las coordenadas están fuera del mapa.';
        }
        if (reason === 'TARGET_TILE_NOT_ELIGIBLE') {
            return 'El objetivo debe ser una aldea enemiga u oasis.';
        }
        if (reason === 'OWN_VILLAGE_NOT_ALLOWED') {
            return 'No puedes añadir tu propia aldea a la lista.';
        }
        if (reason === 'FARM_LIST_DUPLICATE_TARGET') {
            return 'Ese objetivo ya existe en la lista.';
        }
        if (reason === 'FARM_LIST_NOT_FOUND') {
            return 'No se encontró la lista seleccionada.';
        }
        if (reason === 'FARM_LIST_ENTRY_NOT_FOUND') {
            return 'No se encontró una de las entradas seleccionadas.';
        }
        if (reason === 'INVALID_FARM_LIST_TROOPS') {
            return 'Debes configurar tropas válidas para esa entrada.';
        }
        if (reason === 'NO_FARM_LIST_ENTRIES_SELECTED') {
            return 'Selecciona al menos una entrada para enviar.';
        }
        if (reason === 'INVALID_FARM_LIST_ENTRY_SELECTION') {
            return 'La selección de entradas no es válida.';
        }
        if (reason === 'ENTRY_COOLDOWN') {
            const remainingMs = Number(details?.remainingMs) || 0;
            const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
            return `Objetivo en cooldown. Espera ${remainingSeconds}s para reenviar.`;
        }
        if (reason === 'INSUFFICIENT_TROOPS') {
            return 'No hay tropas suficientes para completar el envío.';
        }
        if (reason === 'TARGET_UNDER_BEGINNER_PROTECTION') {
            return 'El objetivo está bajo protección de principiante.';
        }
        if (reason === 'ATTACKER_UNDER_BEGINNER_PROTECTION') {
            return 'Tu aldea aún está bajo protección de principiante.';
        }
        if (reason === 'VILLAGE_NOT_FOUND') {
            return 'No se encontró la aldea de origen.';
        }
        if (reason === 'OWNER_NOT_FOUND') {
            return 'No se encontró el propietario de la lista.';
        }
        if (reason === 'ORIGIN_VILLAGE_OWNER_MISMATCH') {
            return 'La aldea de origen no pertenece al dueño de la lista.';
        }
        return `No se pudo completar la operación (${reason || 'ERROR_DESCONOCIDO'}).`;
    }
}

export default FarmListsView;
