import gameManager from '@game/state/GameManager.js';
import { router } from '@app/router.js';
import { FARM_LIST_LIMITS, gameData, resolveDefaultFarmTroops } from '../core/GameData.js';
import toastUI from '../ui/ToastUI.js';
import { unitSpriteManager } from '../ui/UnitSpriteManager.js';
import uiRenderScheduler from '../ui/UIRenderScheduler.js';
import { perfCollector } from '@shared/lib/perf.js';
import { selectFarmListsViewSignature } from '../ui/renderSelectors.js';

const VIEW_SOURCE = 'farm-lists-view';

function getPerspectiveOwnerId(state) {
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
            <main id="farm-lists-view-root" class="flex-grow overflow-y-auto p-3 md:p-4">
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

    _resolveEntryCooldownLabel(entry, originVillageId) {
        const lastDispatch = Number(entry?.lastDispatchAtByOrigin?.[originVillageId]) || 0;
        if (!lastDispatch) return '';

        const elapsed = Date.now() - lastDispatch;
        if (elapsed >= FARM_LIST_LIMITS.minDispatchCooldownMs) {
            return 'Listo';
        }

        const remainingMs = FARM_LIST_LIMITS.minDispatchCooldownMs - elapsed;
        const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
        return `Cooldown ${remainingSeconds}s`;
    }

    _normalizeDefaultTroops(ownerRace) {
        const defaults = resolveDefaultFarmTroops(ownerRace);
        if (defaults && Object.keys(defaults).length > 0) {
            return defaults;
        }

        const firstUnit = (gameData.units?.[ownerRace]?.troops || []).find(unit => unit.type !== 'merchant');
        return firstUnit ? { [firstUnit.id]: FARM_LIST_LIMITS.defaultUnitCount } : {};
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
        const entriesHtml = entries.length === 0
            ? '<p class="text-sm text-gray-400">Esta lista no tiene objetivos todavía.</p>'
            : entries.map(entry => {
                const troops = entry.troops || this._normalizeDefaultTroops(ownerRace);
                const currentUnitId = Object.keys(troops)[0] || troopCatalog[0]?.id || '';
                const currentCount = Math.max(1, Number(troops[currentUnitId]) || FARM_LIST_LIMITS.defaultUnitCount);
                const unitOptions = troopCatalog
                    .map(unit => `<option value="${unit.id}" ${unit.id === currentUnitId ? 'selected' : ''}>${unit.name}</option>`)
                    .join('');
                const currentUnitName = troopCatalog.find(unit => unit.id === currentUnitId)?.name || currentUnitId || 'Unidad';
                const cooldownLabel = this._resolveEntryCooldownLabel(entry, selectedOriginVillageId);
                const cooldownClass = cooldownLabel.startsWith('Cooldown') ? 'text-yellow-300' : 'text-emerald-300';

                return `
                    <article class="rounded-lg border border-primary-border bg-glass-bg p-3 space-y-3" data-entry-id-row="${entry.id}">
                        <div class="flex items-start gap-2">
                            <input type="checkbox" class="farm-view-entry-select mt-1 h-4 w-4" data-entry-id="${entry.id}">
                            <div class="min-w-0 flex-grow">
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                    <p class="font-semibold text-yellow-300 break-words">${this._resolveTargetLabel(entry)}</p>
                                    <div class="flex items-center gap-2">
                                        <span class="text-xs ${cooldownClass}">${cooldownLabel || 'Sin cooldown'}</span>
                                        <button data-action="farm-view-remove-entry" data-entry-id="${entry.id}" class="text-xs px-2 py-1 rounded bg-red-700 hover:bg-red-600 border border-primary-border">Eliminar</button>
                                    </div>
                                </div>

                                <div class="mt-2 grid grid-cols-1 sm:grid-cols-[auto_1fr_auto_auto] gap-2 items-center">
                                    <div class="flex items-center gap-2" data-entry-unit-preview="${entry.id}">
                                        ${unitSpriteManager.getUnitSprite(currentUnitId, ownerRace)}
                                        <span class="text-xs text-gray-200" data-entry-unit-name="${entry.id}">${currentUnitName}</span>
                                    </div>
                                    <select data-entry-unit-select="${entry.id}" class="bg-btn-secondary-bg border-primary-border text-white rounded-md p-2 text-sm">
                                        ${unitOptions}
                                    </select>
                                    <input type="number" min="1" step="1" value="${currentCount}" data-entry-count-input="${entry.id}" class="w-full sm:w-24 bg-btn-secondary-bg border-primary-border text-white rounded-md p-2 text-center font-mono">
                                    <button data-action="farm-view-save-entry" data-entry-id="${entry.id}" class="bg-btn-primary-bg hover:bg-btn-primary-hover text-white text-xs font-semibold py-2 px-3 rounded-md border border-primary-border">Guardar</button>
                                </div>
                            </div>
                        </div>
                    </article>
                `;
            }).join('');

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
                        <div class="grid grid-cols-[1fr_1fr_auto] gap-2">
                            <input id="farm-view-add-x" type="number" placeholder="X" class="bg-btn-secondary-bg border-primary-border text-white rounded-md p-2 text-sm" ${selectedList ? '' : 'disabled'}>
                            <input id="farm-view-add-y" type="number" placeholder="Y" class="bg-btn-secondary-bg border-primary-border text-white rounded-md p-2 text-sm" ${selectedList ? '' : 'disabled'}>
                            <button data-action="farm-view-add-entry" class="px-3 py-2 text-xs font-semibold rounded-md bg-amber-600 hover:bg-amber-500 text-black border border-primary-border" ${selectedList ? '' : 'disabled'}>Añadir</button>
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
                            <button data-action="farm-view-send-selected" class="px-3 py-2 text-xs rounded-md bg-amber-600 hover:bg-amber-500 text-black font-semibold border border-primary-border" ${selectedList && selectedOriginVillage ? '' : 'disabled'}>Enviar seleccionadas</button>
                        </div>
                    </div>

                    <div class="space-y-2">
                        ${entriesHtml}
                    </div>
                </section>
            </div>
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

        if (action === 'farm-view-remove-entry') {
            if (!selectedList) return;
            const entryId = actionButton.dataset.entryId;
            if (!entryId) return;

            gameManager.sendCommand('farm_list_remove_entry', {
                ownerId,
                listId: selectedList.id,
                entryId,
                meta: {
                    source: VIEW_SOURCE,
                    action: 'remove-entry',
                    listName: selectedList.name,
                },
            });
            return;
        }

        if (action === 'farm-view-save-entry') {
            if (!selectedList) return;
            const entryId = actionButton.dataset.entryId;
            if (!entryId) return;

            const row = this.#rootElement.querySelector(`[data-entry-id-row="${entryId}"]`);
            if (!row) return;

            const unitSelect = row.querySelector(`select[data-entry-unit-select="${entryId}"]`);
            const countInput = row.querySelector(`input[data-entry-count-input="${entryId}"]`);
            const unitId = unitSelect?.value || '';
            const count = Number.parseInt(countInput?.value ?? '', 10);

            if (!unitId || !Number.isInteger(count) || count <= 0) {
                toastUI.show('Configura una unidad y una cantidad válidas.', 'warning');
                return;
            }

            gameManager.sendCommand('farm_list_update_entry_troops', {
                ownerId,
                listId: selectedList.id,
                entryId,
                troops: { [unitId]: count },
                meta: {
                    source: VIEW_SOURCE,
                    action: 'save-entry-troops',
                    listName: selectedList.name,
                },
            });
            return;
        }

        if (action === 'farm-view-select-all') {
            this.#rootElement.querySelectorAll('.farm-view-entry-select').forEach(input => {
                input.checked = true;
            });
            return;
        }

        if (action === 'farm-view-clear-selection') {
            this.#rootElement.querySelectorAll('.farm-view-entry-select').forEach(input => {
                input.checked = false;
            });
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

            const selectedEntryIds = [...this.#rootElement.querySelectorAll('.farm-view-entry-select:checked')]
                .map(input => input.dataset.entryId)
                .filter(Boolean);

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
            this._render();
            return;
        }

        if (target.matches('select[data-entry-unit-select]')) {
            const entryId = target.dataset.entryUnitSelect;
            const row = target.closest(`[data-entry-id-row="${entryId}"]`);
            if (!row || !this.#gameState) return;

            const ownerId = getPerspectiveOwnerId(this.#gameState);
            const ownerRace = this._getOwnerRace(ownerId);
            const unitId = target.value;
            const unitName = gameData.units?.[ownerRace]?.troops?.find(unit => unit.id === unitId)?.name || unitId;
            const preview = row.querySelector(`[data-entry-unit-preview="${entryId}"]`);
            const unitNameLabel = row.querySelector(`[data-entry-unit-name="${entryId}"]`);
            if (preview) {
                preview.innerHTML = `${unitSpriteManager.getUnitSprite(unitId, ownerRace)}<span class="text-xs text-gray-200" data-entry-unit-name="${entryId}">${unitName}</span>`;
            } else if (unitNameLabel) {
                unitNameLabel.textContent = unitName;
            }
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
            }
            toastUI.show('Lista eliminada.', 'success');
        } else if (command === 'farm_list_add_entry_by_coords') {
            const xInput = this.#rootElement?.querySelector('#farm-view-add-x');
            const yInput = this.#rootElement?.querySelector('#farm-view-add-y');
            if (xInput) xInput.value = '';
            if (yInput) yInput.value = '';
            toastUI.show('Objetivo añadido a la lista.', 'success');
        } else if (command === 'farm_list_update_entry_troops') {
            toastUI.show('Preset de tropas actualizado.', 'success');
        } else if (command === 'farm_list_remove_entry') {
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
