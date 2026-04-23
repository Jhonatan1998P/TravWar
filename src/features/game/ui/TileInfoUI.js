import gameManager from '@game/state/GameManager.js';
import { router } from '@app/router.js';
import { FARM_LIST_LIMITS, gameData } from '../core/GameData.js';
import { formatNumber } from '@shared/lib/formatters.js';
import attackPanelUI from './AttackPanelUI.js';
import tradePanelUI from './TradePanelUI.js';
import toastUI from './ToastUI.js';
import { unitSpriteManager } from './UnitSpriteManager.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import { selectTileInfoPanelSignature } from './renderSelectors.js';

const ICON_PATHS = {
    wood: '/icons/wood.png',
    clay: '/icons/clay.png',
    iron: '/icons/iron.png',
    wheat: '/icons/wheat.png',
    beast: '/icons/sword.png',
    protection: '/icons/shield.png'
};

const ICONS = {
    wood: `<img src="${ICON_PATHS.wood}" class="h-5 w-5 inline-block" alt="Madera">`,
    clay: `<img src="${ICON_PATHS.clay}" class="h-5 w-5 inline-block" alt="Barro">`,
    iron: `<img src="${ICON_PATHS.iron}" class="h-5 w-5 inline-block" alt="Hierro">`,
    wheat: `<img src="${ICON_PATHS.wheat}" class="h-5 w-5 inline-block" alt="Cereal">`,
    beast: `<img src="${ICON_PATHS.beast}" class="h-5 w-5 inline-block" alt="Bestias">`,
    protection: `<img src="${ICON_PATHS.protection}" class="h-5 w-5 inline-block" alt="Protección">`
};

class TileInfoUI {
    #panelElement;
    #mainContainer;
    #currentTile = null;
    #gameState = null;
    #schedulerKey = 'tile-info-ui';
    #boundCloseClick;
    #boundFooterClick;
    #boundGameStateUpdate;
    #boundFarmListCommandResult;

    constructor() {
        this.#mainContainer = document.getElementById('village-container');
        if (!this.#mainContainer) {
            return;
        }
        this._init();
    }

    _init() {
        if (!document.getElementById('tile-info-panel')) {
            this._createPanelHTML();
        }

        this.#panelElement = document.getElementById('tile-info-panel');
        if (!this.#panelElement) {
            return;
        }

        this.#boundGameStateUpdate = this._handleGameStateUpdate.bind(this);
        this.#boundCloseClick = this.hide.bind(this);
        this.#boundFooterClick = this._handleFooterClick.bind(this);
        this.#boundFarmListCommandResult = this._handleFarmListCommandResult.bind(this);

        uiRenderScheduler.register(this.#schedulerKey, this.#boundGameStateUpdate, [selectTileInfoPanelSignature]);
        this.#panelElement.querySelector('[data-action="close"]').addEventListener('click', this.#boundCloseClick);
        this.#panelElement.querySelector('#panel-footer').addEventListener('click', this.#boundFooterClick);
        document.addEventListener('farm_list:command_result', this.#boundFarmListCommandResult);
    }

    destroy() {
        uiRenderScheduler.unregister(this.#schedulerKey);

        if (this.#panelElement) {
            this.#panelElement.querySelector('[data-action="close"]')?.removeEventListener('click', this.#boundCloseClick);
            this.#panelElement.querySelector('#panel-footer')?.removeEventListener('click', this.#boundFooterClick);
            this.#panelElement.remove();
        }

        document.removeEventListener('farm_list:command_result', this.#boundFarmListCommandResult);

        this.#panelElement = null;
        this.#currentTile = null;
        this.#gameState = null;
    }

    _createPanelHTML() {
        const panelHTML = `
            <div id="tile-info-panel" class="fixed inset-0 h-[100dvh] bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center overflow-y-auto p-2 sm:p-4 z-50 transition-all duration-200 ease-out panel-hidden">
                <div class="bg-gray-800 border-2 border-gray-700/50 rounded-lg shadow-xl w-full max-w-md my-2 sm:my-4 text-white flex flex-col max-h-[calc(100dvh-1rem)]">
                    <header id="panel-header" class="flex justify-between items-center p-4 border-b border-gray-700">
                        <h2 id="panel-title" class="text-xl font-bold text-yellow-300"></h2>
                        <button data-action="close" class="text-gray-400 text-3xl leading-none hover:text-white">×</button>
                    </header>
                    <main id="panel-main" class="p-4 overflow-y-auto min-h-0 max-h-[calc(100dvh-12rem)]"></main>
                    <footer id="panel-footer" class="p-4 border-t border-gray-700 grid grid-cols-2 gap-2"></footer>
                </div>
            </div>`;
        this.#mainContainer.insertAdjacentHTML('beforeend', panelHTML);
    }

    _handleFooterClick(event) {
        const button = event.target.closest('button[data-action]');
        if (!button || button.disabled) return;

        const action = button.dataset.action;

        if (action === 'found-village') {
            const originVillageId = button.dataset.origin;
            const targetX = button.dataset.x;
            const targetY = button.dataset.y;
            const activeVillage = this.#gameState.villages.find(v => v.id === this.#gameState.activeVillageId);
            const perspectiveRace = this.#gameState.players.find(p => p.id === activeVillage?.ownerId)?.race;

            if (!perspectiveRace) {
                toastUI.show('Error: No se pudo determinar la raza de la aldea activa.', 'error');
                return;
            }

            const settlerUnit = gameData.units[perspectiveRace].troops.find(t => t.type === 'settler');

            if (!originVillageId || !targetX || !targetY || !settlerUnit) {
                toastUI.show('Error interno al intentar fundar.', 'error');
                return;
            }

            gameManager.sendCommand('send_movement', {
                originVillageId: originVillageId,
                targetCoords: { x: parseInt(targetX, 10), y: parseInt(targetY, 10) },
                troops: { [settlerUnit.id]: 3 },
                missionType: 'settle'
            });

            toastUI.show('¡Colonos en camino!', 'success');
            this.hide();
            
        } else if (action === 'send-troops') {
            attackPanelUI.show(this.#currentTile, this.#gameState);
            this.hide();
        } else if (action === 'send-merchants') {
            tradePanelUI.show(this.#currentTile, this.#gameState);
            this.hide();
        } else if (action === 'add-to-farm-list') {
            this._handleAddToFarmList();
        } else if (action === 'open-farm-lists') {
            this.hide();
            router.navigate('/farm-lists');
        }
    }

    _handleAddToFarmList() {
        const activeVillage = this.#gameState?.villages?.find(village => village.id === this.#gameState.activeVillageId);
        if (!activeVillage) {
            toastUI.show('No se encontró la aldea activa.', 'error');
            return;
        }

        const targetTile = this.#gameState?.mapData?.find(tile => tile.x === this.#currentTile?.x && tile.y === this.#currentTile?.y);
        if (!targetTile) {
            toastUI.show('No se pudo resolver el objetivo seleccionado.', 'error');
            return;
        }

        const perspectiveOwnerId = activeVillage.ownerId;
        if (targetTile.type === 'village' && targetTile.ownerId === perspectiveOwnerId) {
            toastUI.show('No puedes añadir tu propia aldea a una Lista de Vacas.', 'warning');
            return;
        }

        if (targetTile.type !== 'village' && targetTile.type !== 'oasis') {
            toastUI.show('Solo puedes añadir aldeas enemigas u oasis.', 'warning');
            return;
        }

        const ownerLists = this.#gameState?.farmListsByOwnerId?.[perspectiveOwnerId]?.lists || [];
        const listSelection = this._promptFarmListSelection(ownerLists);
        if (!listSelection) {
            return;
        }

        let targetList = ownerLists.find(list => list.id === listSelection.listId) || null;
        let targetListId = listSelection.listId;
        let targetListName = targetList?.name || '';

        if (listSelection.createNew) {
            if (ownerLists.length >= FARM_LIST_LIMITS.maxListsPerOwner) {
                toastUI.show(`Ya alcanzaste el máximo de ${FARM_LIST_LIMITS.maxListsPerOwner} listas.`, 'error');
                return;
            }

            const createdListName = this._promptFarmListName(ownerLists.length + 1);
            if (createdListName === null) {
                return;
            }

            targetListId = `farm_list_ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
            targetListName = createdListName;
            targetList = { id: targetListId, name: createdListName, entries: [] };

            gameManager.sendCommand('farm_list_create', {
                ownerId: perspectiveOwnerId,
                listId: targetListId,
                name: createdListName,
                meta: {
                    source: 'tile-info',
                    listName: createdListName,
                },
            });
        }

        const targetCoords = { x: this.#currentTile.x, y: this.#currentTile.y };
        if (this._listHasTarget(targetList, targetCoords)) {
            toastUI.show(`El objetivo ya está registrado en "${targetListName || 'esta lista'}".`, 'warning');
            return;
        }

        gameManager.sendCommand('farm_list_add_entry_from_tile', {
            ownerId: perspectiveOwnerId,
            listId: targetListId,
            targetCoords,
            meta: {
                source: 'tile-info',
                listName: targetListName || targetList?.name || 'Lista de Vacas',
            },
        });
    }

    _getFarmListTargetMatches(ownerId, targetCoords) {
        if (!ownerId || !targetCoords) return [];
        const ownerLists = this.#gameState?.farmListsByOwnerId?.[ownerId]?.lists || [];
        const matches = [];

        ownerLists.forEach(list => {
            (list.entries || []).forEach(entry => {
                if (entry?.targetCoords?.x === targetCoords.x && entry?.targetCoords?.y === targetCoords.y) {
                    matches.push({
                        listId: list.id,
                        listName: list.name,
                        entryId: entry.id,
                        entry,
                    });
                }
            });
        });

        return matches;
    }

    _handleFarmListCommandResult(event) {
        const detail = event?.detail;
        const command = detail?.command;
        const request = detail?.request || {};
        const result = detail?.result || {};
        const source = request?.meta?.source;

        if (source !== 'tile-info') {
            return;
        }

        if (!result.success) {
            const message = this._resolveFarmListReasonMessage(result.reason, result.details);
            toastUI.show(message, 'error');
            return;
        }

        if (command === 'farm_list_add_entry_from_tile') {
            const listName = request?.meta?.listName || 'Lista de Vacas';
            toastUI.show(`Objetivo añadido a "${listName}".`, 'success');
        }
    }

    _resolveFarmListReasonMessage(reason, details = null) {
        if (reason === 'FARM_LIST_MAX_LISTS_REACHED') {
            return `Ya alcanzaste el máximo de ${details?.maxListsPerOwner || FARM_LIST_LIMITS.maxListsPerOwner} listas.`;
        }
        if (reason === 'FARM_LIST_MAX_ENTRIES_REACHED') {
            return `La lista alcanzó el máximo de ${details?.maxEntriesPerList || FARM_LIST_LIMITS.maxEntriesPerList} objetivos.`;
        }
        if (reason === 'FARM_LIST_DUPLICATE_TARGET') {
            return 'Ese objetivo ya existe en la lista seleccionada.';
        }
        if (reason === 'OWN_VILLAGE_NOT_ALLOWED') {
            return 'No puedes añadir tu propia aldea a una Lista de Vacas.';
        }
        if (reason === 'TARGET_COORDS_OUT_OF_MAP') {
            return 'Las coordenadas del objetivo están fuera del mapa.';
        }
        if (reason === 'TARGET_TILE_NOT_ELIGIBLE') {
            return 'Solo puedes añadir aldeas enemigas u oasis.';
        }
        if (reason === 'INVALID_TARGET_COORDS') {
            return 'Las coordenadas objetivo no son válidas.';
        }
        if (reason === 'FARM_LIST_NOT_FOUND') {
            return 'No se encontró la lista seleccionada.';
        }
        if (reason === 'OWNER_NOT_FOUND') {
            return 'No se encontró el propietario de la lista.';
        }
        if (reason === 'INVALID_FARM_LIST_TROOPS') {
            return 'Debes seleccionar tropas válidas para guardar este objetivo.';
        }
        return `No se pudo completar la acción (${reason || 'ERROR_DESCONOCIDO'}).`;
    }

    _promptFarmListSelection(lists) {
        if (!Array.isArray(lists) || lists.length === 0) {
            return { createNew: true, listId: null };
        }

        const options = lists
            .map((list, index) => `${index + 1}. ${list.name} (${list.entries.length}/${FARM_LIST_LIMITS.maxEntriesPerList})`)
            .join('\n');
        const selectionRaw = window.prompt(
            `Selecciona una Lista de Vacas:\n${options}\n0. Crear nueva lista`,
            '1',
        );

        if (selectionRaw === null) {
            return null;
        }

        const selectedIndex = Number.parseInt(selectionRaw, 10);
        if (!Number.isInteger(selectedIndex)) {
            toastUI.show('Selección inválida de lista.', 'warning');
            return null;
        }

        if (selectedIndex === 0) {
            return { createNew: true, listId: null };
        }

        if (selectedIndex < 1 || selectedIndex > lists.length) {
            toastUI.show('La lista seleccionada no existe.', 'warning');
            return null;
        }

        return {
            createNew: false,
            listId: lists[selectedIndex - 1].id,
        };
    }

    _promptFarmListName(listNumber) {
        const defaultName = `Lista ${listNumber}`;
        const enteredValue = window.prompt('Nombre de la nueva Lista de Vacas:', defaultName);
        if (enteredValue === null) {
            return null;
        }
        const trimmedValue = enteredValue.trim();
        return trimmedValue || defaultName;
    }

    _listHasTarget(list, targetCoords) {
        if (!list || !Array.isArray(list.entries)) {
            return false;
        }
        return list.entries.some(entry => entry?.targetCoords?.x === targetCoords.x && entry?.targetCoords?.y === targetCoords.y);
    }
    
    _handleGameStateUpdate(gameStatePayload) {
        const { state } = gameStatePayload;
        this.#gameState = state;
        if (this.#panelElement.classList.contains('panel-visible') && this.#currentTile) {
            this._render();
        }
    }

    show(tileInfo, gameState) {
        if (!gameState) return;

        this.#currentTile = tileInfo;
        this.#gameState = gameState;

        this.#panelElement.classList.remove('panel-hidden');
        this.#panelElement.classList.add('panel-visible');
        this._render();
    }

    hide() {
        this.#panelElement.classList.remove('panel-visible');
        this.#panelElement.classList.add('panel-hidden');
        this.#currentTile = null;
    }

    _render() {
        if (!this.#currentTile || !this.#gameState) return;

        const { x, y } = this.#currentTile;
        const data = this.#gameState.mapData.find(t => t.x === x && t.y === y);
        
        const mainPanel = this.#panelElement.querySelector('#panel-main');
        const footerPanel = this.#panelElement.querySelector('#panel-footer');
        const title = this.#panelElement.querySelector('#panel-title');

        title.textContent = `Detalles (${x}|${y})`;

        let content = { main: '', footer: '' };

        if (!data || data.type === 'valley') {
            content = this._getWastelandContent(data);
        } else if (data.type === 'oasis') {
            content = this._getOasisContent(data);
        } else if (data.type === 'village') {
            content = this._getVillageContent(data);
        }

        mainPanel.innerHTML = content.main;
        footerPanel.innerHTML = content.footer;
    }

    _getWastelandContent(data) {
        const valleyType = data ? data.valleyType : '4-4-4-6';
        const [wood, clay, iron, wheat] = valleyType.split('-').map(Number);
        const main = `<h3 class="font-semibold text-lg text-yellow-300 mb-2">Terreno Baldío</h3>
                      <p class="text-gray-400 text-sm mb-4">Esta casilla está desocupada y lista para ser colonizada.</p>
                      <div class="grid grid-cols-2 gap-2 text-sm">
                        <div class="flex items-center gap-2 p-2 bg-gray-900/50 rounded-md">${ICONS.wood} Madera: ${wood}</div>
                        <div class="flex items-center gap-2 p-2 bg-gray-900/50 rounded-md">${ICONS.clay} Barro: ${clay}</div>
                        <div class="flex items-center gap-2 p-2 bg-gray-900/50 rounded-md">${ICONS.iron} Hierro: ${iron}</div>
                        <div class="flex items-center gap-2 p-2 bg-gray-900/50 rounded-md">${ICONS.wheat} Cereal: ${wheat}</div>
                      </div>`;

        const settlementConfig = gameData.config.settlement;
        if (!settlementConfig) {
            return { main, footer: '<p class="col-span-2 text-center text-red-500">Error: Configuración de fundación no encontrada.</p>' };
        }

        const activeVillage = this.#gameState.villages.find(v => v.id === this.#gameState.activeVillageId);
        const perspectiveRace = this.#gameState.players.find(p => p.id === activeVillage?.ownerId)?.race;
        if (!activeVillage || !perspectiveRace) {
            return { main, footer: '<p class="col-span-2 text-center text-red-500">Error: No se pudo encontrar la aldea activa o su raza.</p>' };
        }
        
        const settlerUnit = gameData.units[perspectiveRace].troops.find(t => t.type === 'settler');
        const settlersRequired = settlementConfig.settlersRequired;
        
        const canFound = activeVillage && settlerUnit && (activeVillage.unitsInVillage[settlerUnit.id] || 0) >= settlersRequired;
        
        const disabledAttr = canFound ? '' : 'disabled';
        let footer = `<button data-action="found-village" data-origin="${activeVillage.id}" data-x="${this.#currentTile.x}" data-y="${this.#currentTile.y}" class="w-full col-span-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-lg transition duration-300 disabled:bg-gray-600 disabled:cursor-not-allowed" ${disabledAttr}>Fundar Nueva Aldea</button>`;

        if (!canFound) {
            footer += `<p class="col-span-2 text-center text-xs text-red-400 mt-2">Necesitas al menos ${settlersRequired} colonos en esta aldea para fundar.</p>`;
        }

        return { main, footer };
    }

    _getOasisContent(data) {
        const oasisData = gameData.oasisTypes[data.oasisType];
        if (!oasisData) return { main: '', footer: '' };

        const iconMap = { wood: 'wood', stone: 'clay', iron: 'iron', food: 'wheat' };
        const bonusResourceIconKey = iconMap[oasisData.bonus.resource];
        const bonusHTML = bonusResourceIconKey ? `<div class="flex items-center gap-2 text-lg">
                            <span class="font-semibold">Bono:</span>
                            <span class="flex items-center gap-1">${ICONS[bonusResourceIconKey]} +${oasisData.bonus.percentage}%</span>
                         </div>` : '';

        let beastsHTML = '<h4 class="font-semibold text-md text-red-400 mt-4 mb-2">Bestias</h4><ul class="space-y-2">';
        const currentBeasts = data.state?.beasts || {};

        for (const unitId in currentBeasts) {
            const count = Math.floor(currentBeasts[unitId]);
            if (count === 0) continue;
            
            const beastData = gameData.units.nature.troops.find(t => t.id === unitId);
            if (beastData) {
                beastsHTML += `<li class="flex justify-between items-center bg-gray-900/50 p-2 rounded-md">
                                <span class="flex items-center gap-3">
                                    ${unitSpriteManager.getUnitSprite(unitId, 'nature')}
                                    ${beastData.name}
                                </span>
                                <span class="font-mono text-gray-300">${formatNumber(count)}</span>
                               </li>`;
            }
        }
        beastsHTML += '</ul>';

        const main = `<h3 class="font-semibold text-lg text-yellow-300 mb-2">${oasisData.name}</h3>
                      ${bonusHTML}
                      ${Object.keys(currentBeasts).some(k => currentBeasts[k] > 0) ? beastsHTML : ''}`;
        
        const activeVillage = this.#gameState.villages.find(v => v.id === this.#gameState.activeVillageId);
        const canSendTroops = activeVillage && Object.values(activeVillage.unitsInVillage).some(count => count > 0);
        const disabledAttr = canSendTroops ? '' : 'disabled';
        const farmMatches = this._getFarmListTargetMatches(activeVillage?.ownerId, { x: data.x, y: data.y });
        const isAlreadyInFarmList = farmMatches.length > 0;
        const farmButtonAction = isAlreadyInFarmList ? 'open-farm-lists' : 'add-to-farm-list';
        const farmButtonLabel = isAlreadyInFarmList ? 'Gestionar listas' : 'Añadir a Lista de Vacas';
        const footer = `<button data-action="send-troops" class="w-full bg-yellow-600 hover:bg-yellow-500 text-black font-bold py-2 px-4 rounded-lg transition duration-300 disabled:bg-gray-600 disabled:cursor-not-allowed" ${disabledAttr}>Enviar Movimiento</button>
                        <button data-action="${farmButtonAction}" class="w-full bg-amber-600 hover:bg-amber-500 text-black font-bold py-2 px-4 rounded-lg transition duration-300">${farmButtonLabel}</button>`;

        return { main, footer };
    }

    _getVillageContent(data) {
        const village = this.#gameState.villages.find(v => v.id === data.villageId);
        if (!village) return { main: '', footer: '' };
        
        const owner = this.#gameState.players.find(p => p.id === village.ownerId);
        const activeVillage = this.#gameState.villages.find(v => v.id === this.#gameState.activeVillageId);
        const perspectiveOwnerId = activeVillage?.ownerId || 'player';
        const ownerName = data.ownerId === perspectiveOwnerId ? 'Tú' : `IA (${data.race})`;
        const raceName = gameData.units[data.race]?.name || 'Desconocida';
        const isProtected = owner && owner.isUnderProtection;

        let protectionHTML = '';
        if (isProtected) {
            protectionHTML = `<li><span class="font-semibold text-gray-400 flex items-center gap-2">${ICONS.protection} Estado:</span> <span class="text-sky-400">Bajo protección</span></li>`;
        }

        const main = `<h3 class="font-semibold text-lg text-blue-400 mb-2">${village.name}</h3>
                      <ul class="space-y-1 text-gray-300">
                        <li><span class="font-semibold text-gray-400">Jugador:</span> ${ownerName}</li>
                        <li><span class="font-semibold text-gray-400">Raza:</span> ${raceName}</li>
                        <li><span class="font-semibold text-gray-400">Población:</span> ${formatNumber(village.population.current)}</li>
                        ${protectionHTML}
                      </ul>`;

        let footer = '';
        const canSendTroops = activeVillage && Object.values(activeVillage.unitsInVillage).some(count => count > 0);
        const canSendMerchants = Boolean(
            activeVillage
            && data.ownerId === perspectiveOwnerId
            && village.id !== activeVillage.id
            && activeVillage.buildings.some(b => b.type === 'marketplace' && b.level > 0),
        );
        
        const attackIsDisabled = !canSendTroops || (isProtected && data.ownerId !== perspectiveOwnerId);
        const sendTroopsDisabledAttr = attackIsDisabled ? 'disabled' : '';
        const sendMerchantsDisabled = canSendMerchants ? '' : 'disabled';
        const farmMatches = this._getFarmListTargetMatches(perspectiveOwnerId, { x: data.x, y: data.y });
        const isAlreadyInFarmList = farmMatches.length > 0;
        const farmButtonAction = isAlreadyInFarmList ? 'open-farm-lists' : 'add-to-farm-list';
        const farmButtonLabel = isAlreadyInFarmList ? 'Gestionar listas' : 'Añadir a Lista de Vacas';
        
        footer = `<button data-action="send-troops" class="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-lg transition duration-300 disabled:bg-gray-600 disabled:cursor-not-allowed" ${sendTroopsDisabledAttr}>Enviar Movimiento</button>
                  <button data-action="send-merchants" class="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded-lg transition duration-300 disabled:bg-gray-600 disabled:cursor-not-allowed" ${sendMerchantsDisabled}>Enviar Recursos</button>`;

        if (data.ownerId !== perspectiveOwnerId) {
            footer += `<button data-action="${farmButtonAction}" class="w-full col-span-2 bg-amber-600 hover:bg-amber-500 text-black font-bold py-2 px-4 rounded-lg transition duration-300">${farmButtonLabel}</button>`;
        }
        
        if (attackIsDisabled && isProtected && data.ownerId !== perspectiveOwnerId) {
             footer += `<p class="col-span-2 text-center text-xs text-sky-400 mt-2">Este jugador está bajo protección de principiante.</p>`;
        }

        return { main, footer };
    }
}

export default TileInfoUI;
