import gameManager from '@game/state/GameManager.js';
import GameConfig from '@game/state/GameConfig.js';
import { gameData, NON_TARGETABLE_BUILDINGS } from '../core/GameData.js';
import { formatNumber } from '@shared/lib/formatters.js';
import toastUI from './ToastUI.js';
import { markModalOpened, shouldIgnoreModalAction } from './modalInteractionGuard.js';
import { unitSpriteManager } from './UnitSpriteManager.js';
import { scaleCapacityByGameSpeed } from '../core/capacityScaling.js';

const OASIS_CAPTURE_RANGE = 7;

class AttackPanelUI {
    #panelElement;
    #mainContainer;
    #targetTile = null;
    #gameState = null;
    #activeVillage = null;
    #troopInputs = new Map();
    #lastOpenedAt = 0;
    #movementResultHandler = null;

    constructor() {
        this.#mainContainer = document.getElementById('village-container');
        if (!this.#mainContainer) return;
        this._createPanelHTML();
        this.#panelElement = document.getElementById('attack-panel');
        this._initializeEventListeners();
        this.#movementResultHandler = this._handleMovementResult.bind(this);
        document.addEventListener('send_movement:result', this.#movementResultHandler);
    }

    _createPanelHTML() {
        const panelHTML = `
            <div id="attack-panel" class="fixed inset-0 h-[var(--app-viewport-height)] bg-primary-bg/80 backdrop-blur-sm flex items-start sm:items-center justify-center overflow-y-auto p-2 sm:p-4 z-50 transition-all duration-200 ease-out panel-hidden">
                <div class="bg-glass-bg border border-primary-border rounded-[2rem] shadow-2xl w-full max-w-lg my-2 sm:my-4 text-war-mist flex flex-col max-h-[calc(var(--app-viewport-height)-1rem)] backdrop-blur-2xl">
                    <header class="flex justify-between items-center p-4 border-b border-primary-border">
                        <h2 id="attack-panel-title" class="text-xl font-display font-bold text-war-gold">Enviar Tropas</h2>
                        <button data-action="close" class="min-h-11 min-w-11 text-gray-400 text-3xl leading-none hover:text-white" aria-label="Cerrar">×</button>
                    </header>
                    <main id="attack-panel-main" class="p-4 overflow-y-auto min-h-0 max-h-[calc(var(--app-viewport-height)-12rem)]">
                        <div id="attack-panel-info" class="grid grid-cols-2 gap-4 mb-4 text-sm"></div>
                        <div id="attack-panel-troops" class="space-y-2 mb-4"></div>
                        <div id="attack-panel-actions" class="flex justify-end gap-2 mb-4">
                            <button data-action="reset" class="min-h-11 px-3 py-1 text-xs bg-btn-secondary-bg hover:bg-btn-secondary-hover rounded-xl border border-primary-border">Reiniciar</button>
                            <button data-action="fill-all" class="min-h-11 px-3 py-1 text-xs bg-btn-primary-bg hover:bg-btn-primary-hover rounded-xl border border-primary-border">Todas</button>
                        </div>
                        <fieldset id="attack-panel-missions" class="border-t border-primary-border pt-4">
                            <legend class="text-base font-semibold text-gray-300 mb-2">Tipo de Misión</legend>
                            <div class="flex flex-wrap gap-2"></div>
                        </fieldset>
<div id="attack-panel-oasis-conquest" class="border-t border-primary-border pt-4 mt-4 hidden"></div>
            <div id="attack-panel-settlement-info" class="border-t border-primary-border pt-4 mt-4 hidden"></div>
            <div id="attack-panel-catapult-targets" class="border-t border-primary-border pt-4 mt-4 hidden"></div>
                    </main>
                    <footer class="p-4 border-t border-primary-border">
                        <button data-action="send" class="w-full bg-btn-primary-bg hover:bg-btn-primary-hover text-war-mist font-bold py-3 px-4 rounded-xl transition duration-300 disabled:bg-btn-secondary-bg disabled:cursor-not-allowed border border-primary-border">
                            Enviar
                        </button>
                    </footer>
                </div>
            </div>`;
        this.#mainContainer.insertAdjacentHTML('beforeend', panelHTML);
    }

    _initializeEventListeners() {
        this.#panelElement.addEventListener('click', e => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (!action) return;

            if (action !== 'close' && shouldIgnoreModalAction(this.#lastOpenedAt)) return;

            switch (action) {
                case 'close': this.hide(); break;
                case 'send': this._handleSendClick(); break;
                case 'fill-all': this._handleFillAllClick(); break;
                case 'reset': this._handleResetClick(); break;
            }
        });
        
        this.#panelElement.addEventListener('input', e => {
            if (e.target.matches('input[type="number"]')) {
                this._handleInputValidation(e.target);
                this.#troopInputs.set(e.target.dataset.unitId, e.target.value);

                const playerRace = this.#gameState.players.find(p => p.id === this.#activeVillage.ownerId)?.race;
                if (!playerRace) return;
                const unitData = gameData.units[playerRace].troops.find(u => u.id === e.target.dataset.unitId);
                if (unitData?.role === 'catapult') {
                    this._updateCatapultTargetsVisibility();
                }
            }
            if(e.target.matches('input[name="mission-type"]')) {
                this._handleMissionChange(e.target.value);
            }
            if (e.target.matches('#oasis-conquest-checkbox') && e.target.checked) {
                const attackMission = this.#panelElement.querySelector('#mission-attack');
                if (attackMission) {
                    attackMission.checked = true;
                    this._handleMissionChange('attack');
                }
            }
        });
    }

    show(targetTile, gameState) {
        this.#targetTile = targetTile;
        this.#gameState = gameState;
        this.#activeVillage = this.#gameState.villages.find(v => v.id === this.#gameState.activeVillageId);
        if (!this.#activeVillage) return;
        this.#lastOpenedAt = markModalOpened();
        
        this.#troopInputs.clear();
        this._render();
        this.#panelElement.classList.remove('panel-hidden');
        this.#panelElement.classList.add('panel-visible');
    }

    hide() {
        this.#panelElement.classList.remove('panel-visible');
        this.#panelElement.classList.add('panel-hidden');
        this.#troopInputs.clear();
    }

    _render() {
        this._renderInfo();
        this._renderTroops();
        this._renderMissions();
        this._renderOasisConquestOption();
        this._renderCatapultTargets();
    }

    _getHeroMansionOasisSlots() {
        const level = this.#activeVillage?.buildings.find(building => building.type === 'heroMansion')?.level || 0;
        if (level >= 20) return 3;
        if (level >= 15) return 2;
        if (level >= 10) return 1;
        return 0;
    }

    _isTargetOasisInCaptureRange() {
        if (!this.#activeVillage || !this.#targetTile) return false;
        return Math.abs(this.#targetTile.x - this.#activeVillage.coords.x) <= OASIS_CAPTURE_RANGE
            && Math.abs(this.#targetTile.y - this.#activeVillage.coords.y) <= OASIS_CAPTURE_RANGE;
    }

    _getPendingOasisCaptures() {
        return (this.#gameState.movements || []).filter(movement => {
            return movement.originVillageId === this.#activeVillage.id
                && movement.type === 'attack'
                && movement.payload?.conquerOasis === true;
        }).length;
    }

    _renderInfo() {
        const targetData = this.#gameState.mapData.find(t => t.x === this.#targetTile.x && t.y === this.#targetTile.y);
        let targetName = 'Terreno Baldío';
        if (targetData?.type === 'village') {
            targetName = this.#gameState.villages.find(v => v.id === targetData.villageId)?.name || 'Aldea';
        } else if (targetData?.type === 'oasis') {
            targetName = gameData.oasisTypes[targetData.oasisType]?.name || 'Oasis';
        }

        const infoContainer = this.#panelElement.querySelector('#attack-panel-info');
        infoContainer.innerHTML = `
            <div class="bg-gray-900/50 p-3 rounded-lg">
                <div class="text-xs text-gray-400">Origen</div>
                <div class="font-semibold text-white">${this.#activeVillage.name}</div>
                <div class="font-mono text-gray-300">(${this.#activeVillage.coords.x}|${this.#activeVillage.coords.y})</div>
            </div>
            <div class="bg-gray-900/50 p-3 rounded-lg">
                <div class="text-xs text-gray-400">Destino</div>
                <div class="font-semibold text-white">${targetName}</div>
                <div class="font-mono text-gray-300">(${this.#targetTile.x}|${this.#targetTile.y})</div>
            </div>
        `;
    }

    _renderTroops() {
        const troopsContainer = this.#panelElement.querySelector('#attack-panel-troops');
        const unitsInVillage = this.#activeVillage.unitsInVillage;
        const playerRace = this.#gameState.players.find(p => p.id === this.#activeVillage.ownerId)?.race;
        if (!playerRace) return;

        const allUnitData = gameData.units[playerRace].troops;

        let troopsHTML = '';
        allUnitData.forEach(unit => {
            const count = unitsInVillage[unit.id] || 0;
            if (count > 0) {
                const inputValue = this.#troopInputs.get(unit.id) || '';
                troopsHTML += `
                    <div class="flex items-center gap-3 p-2 bg-gray-700/50 rounded-lg troop-row" data-unit-type="${unit.type}" data-unit-role="${unit.role || 'none'}" data-unit-id-row="${unit.id}">
                        <div class="flex-shrink-0">${unitSpriteManager.getUnitSprite(unit.id, playerRace)}</div>
                        <div class="flex-grow font-semibold">${unit.name}</div>
                        <div class="flex items-center gap-2">
                            <span class="text-sm text-gray-400">(${formatNumber(count)})</span>
                            <input type="number" min="0" max="${count}" value="${inputValue}" data-unit-id="${unit.id}" data-unit-type="${unit.type}" placeholder="0" class="w-24 bg-gray-900 border border-gray-600 text-white rounded-md p-1 text-center font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                        </div>
                    </div>
                `;
            }
        });

        if (troopsHTML === '') {
            troopsHTML = '<p class="text-center text-gray-500 text-sm py-4">No tienes tropas disponibles en esta aldea.</p>';
        }
        troopsContainer.innerHTML = troopsHTML;
    }

    _renderMissions() {
        const missionsContainer = this.#panelElement.querySelector('#attack-panel-missions > div');
        const targetData = this.#gameState.mapData.find(t => t.x === this.#targetTile.x && t.y === this.#targetTile.y);
        const targetType = targetData?.type || 'valley';
        const perspectiveOwnerId = this.#activeVillage.ownerId;
        const playerRace = this.#gameState.players.find(p => p.id === perspectiveOwnerId)?.race;
        const scoutUnit = gameData.units[playerRace]?.troops.find(t => t.type === 'scout');
        const hasScouts = scoutUnit && (this.#activeVillage.unitsInVillage[scoutUnit.id] || 0) > 0;

        const missions = [
            { id: 'settle', label: 'Fundar Aldea', available: targetType === 'valley' },
            { id: 'reinforcement', label: 'Apoyo', available: targetType === 'village' && targetData.ownerId === perspectiveOwnerId },
            { id: 'espionage', label: 'Espionaje', available: ((targetType === 'village' && targetData.ownerId !== perspectiveOwnerId) || targetType === 'oasis') && hasScouts },
            { id: 'raid', label: 'Asalto', available: (targetType === 'village' && targetData.ownerId !== perspectiveOwnerId) || targetType === 'oasis' },
            { id: 'attack', label: 'Ataque', available: (targetType === 'village' && targetData.ownerId !== perspectiveOwnerId) || targetType === 'oasis' }
        ];

        let missionsHTML = '';
        let firstAvailable = true;
        missions.forEach(mission => {
            if (mission.available) {
                const checked = firstAvailable ? 'checked' : '';
                firstAvailable = false;
                missionsHTML += `
                    <div>
                        <input type="radio" name="mission-type" id="mission-${mission.id}" value="${mission.id}" class="hidden peer" ${checked}>
                        <label for="mission-${mission.id}" class="block cursor-pointer select-none rounded-lg p-2 text-center text-sm font-semibold text-gray-300 bg-gray-700 peer-checked:bg-blue-600 peer-checked:text-white transition-colors">
                            ${mission.label}
                        </label>
                    </div>
                `;
            }
        });
        missionsContainer.innerHTML = missionsHTML;
        const initialMission = this.#panelElement.querySelector('input[name="mission-type"]:checked');
        if (initialMission) {
            this._handleMissionChange(initialMission.value);
        }
    }

    _renderOasisConquestOption() {
        const container = this.#panelElement.querySelector('#attack-panel-oasis-conquest');
        const targetData = this.#gameState.mapData.find(t => t.x === this.#targetTile.x && t.y === this.#targetTile.y);
        if (targetData?.type !== 'oasis') {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        const slots = this._getHeroMansionOasisSlots();
        const usedSlots = (this.#activeVillage.oases?.length || 0) + this._getPendingOasisCaptures();
        const inRange = this._isTargetOasisInCaptureRange();
        const isOwnOasis = targetData.villageId === this.#activeVillage.id;
        const canConquer = slots > usedSlots && inRange && !isOwnOasis;

        let hint = `Slots de oasis: ${usedSlots}/${slots}. Requiere Mansión del Héroe nivel 10, 15 o 20 y rango de ${OASIS_CAPTURE_RANGE} casillas.`;
        if (isOwnOasis) hint = 'Este oasis ya pertenece a esta aldea.';
        else if (!inRange) hint = `Este oasis está fuera del rango de ${OASIS_CAPTURE_RANGE} casillas de la aldea activa.`;
        else if (slots <= usedSlots) hint = 'No tienes slots de oasis disponibles en esta aldea.';

        container.innerHTML = `
            <label class="flex items-start gap-3 rounded-xl border border-primary-border bg-gray-900/50 p-3 ${canConquer ? 'cursor-pointer' : 'opacity-60'}">
                <input id="oasis-conquest-checkbox" type="checkbox" class="mt-1 h-5 w-5 accent-war-gold" ${canConquer ? '' : 'disabled'}>
                <span>
                    <span class="block font-semibold text-war-gold">Conquistar oasis</span>
                    <span class="block text-xs text-gray-400 mt-1">${hint}</span>
                </span>
            </label>`;
        container.classList.remove('hidden');
    }

    _renderCatapultTargets() {
        const container = this.#panelElement.querySelector('#attack-panel-catapult-targets');
        const mainBuildingLevel = this.#activeVillage.buildings.find(b => b.type === 'mainBuilding')?.level || 0;
        const targetableBuildings = Object.entries(gameData.buildings)
            .filter(([id, _]) => !NON_TARGETABLE_BUILDINGS.includes(id))
            .sort((a, b) => a[1].name.localeCompare(b[1].name));

        const optionsHTML = targetableBuildings.map(([id, data]) => `<option value="${id}">${data.name}</option>`).join('');

        let contentHTML = `<legend class="text-base font-semibold text-gray-300 mb-2">Objetivos de Catapulta</legend>`;
        if (mainBuildingLevel < 10) {
            contentHTML += `<p class="text-sm text-gray-400 p-2 bg-gray-900/50 rounded-md">El objetivo será aleatorio. Mejora tu Edificio Principal a nivel 10 para poder apuntar.</p>`;
        } else if (mainBuildingLevel < 20) {
            contentHTML += `
                <select id="catapult-target-1" class="w-full bg-gray-700 border border-gray-600 rounded-md p-2">
                    <option value="random">Objetivo Aleatorio</option>
                    ${optionsHTML}
                </select>`;
        } else {
            contentHTML += `
                <div class="space-y-2">
                    <select id="catapult-target-1" class="w-full bg-gray-700 border border-gray-600 rounded-md p-2">
                        <option value="random">Objetivo 1 (Aleatorio)</option>
                        ${optionsHTML}
                    </select>
                    <select id="catapult-target-2" class="w-full bg-gray-700 border border-gray-600 rounded-md p-2">
                        <option value="random">Objetivo 2 (Aleatorio)</option>
                        ${optionsHTML}
                    </select>
                </div>`;
        }
        container.innerHTML = contentHTML;
    }

    _getComputedSettlementCost() {
        const settlementConfig = gameData.config.settlement;
        if (!settlementConfig) return null;
        const gameConfig = new GameConfig().getSettings();
        const ratio = settlementConfig.startResourcesBaseCapacityRatio;
        const scaledWarehouse = scaleCapacityByGameSpeed(gameData.config.initialStorage.warehouse, gameConfig.gameSpeed);
        const scaledGranary = scaleCapacityByGameSpeed(gameData.config.initialStorage.granary, gameConfig.gameSpeed);
        return {
            wood: Math.floor(scaledWarehouse * ratio),
            stone: Math.floor(scaledWarehouse * ratio),
            iron: Math.floor(scaledWarehouse * ratio),
            food: Math.floor(scaledGranary * ratio),
        };
    }

    _renderSettlementInfo() {
        const container = this.#panelElement.querySelector('#attack-panel-settlement-info');
        const settlementConfig = gameData.config.settlement;
        if (!settlementConfig || !this.#activeVillage) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        const playerRace = this.#gameState.players.find(p => p.id === this.#activeVillage.ownerId)?.race;
        if (!playerRace) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        const settlerData = gameData.units[playerRace].troops.find(t => t.type === 'settler');
        const settlersAvailable = this.#activeVillage.unitsInVillage[settlerData?.id] || 0;
        const settlersRequired = settlementConfig.settlersRequired;
        const settlementCost = this._getComputedSettlementCost();
        if (!settlementCost) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        const hasEnoughSettlers = settlersAvailable >= settlersRequired;
        const resNames = { wood: 'Madera', stone: 'Barro', iron: 'Hierro', food: 'Cereal' };
        const resIcons = { wood: '🪵', stone: '🧱', iron: '⛏️', food: '🌾' };

        const foundedCount = this.#activeVillage.settlementsFounded || 0;
        const maxSlots = 3;
        const usedSlots = foundedCount;
        const slotAvailable = usedSlots < maxSlots;
        const slotLabel = slotAvailable
            ? `Slot ${usedSlots + 1} de ${maxSlots}`
            : `Sin slots disponibles (${maxSlots}/${maxSlots} usados)`;

        const popRequirements = [150, 300, 600];
        const requiredPop = slotAvailable ? (popRequirements[usedSlots] || null) : null;
        const currentPop = this.#activeVillage.population?.current || 0;
        const hasEnoughPop = requiredPop !== null ? currentPop >= requiredPop : false;

        let costHTML = '';
        for (const res in settlementCost) {
            const current = Math.floor(this.#activeVillage.resources[res].current);
            const enough = current >= settlementCost[res];
            costHTML += `
            <div class="flex items-center justify-between gap-2 ${enough ? '' : 'text-red-400'}">
                <span class="text-sm">${resIcons[res]} ${resNames[res]}</span>
                <span class="font-mono text-sm">${formatNumber(current)} / ${formatNumber(settlementCost[res])}</span>
            </div>`;
        }

        const slotHTML = `
            <div class="flex items-center justify-between ${slotAvailable ? '' : 'text-red-400'}">
                <span class="text-sm">📌 Slot de fundación</span>
                <span class="font-mono text-sm">${slotLabel}</span>
            </div>`;

        const popHTML = requiredPop !== null ? `
            <div class="flex items-center justify-between ${hasEnoughPop ? '' : 'text-red-400'}">
                <span class="text-sm">👥 Población requerida</span>
                <span class="font-mono text-sm">${formatNumber(currentPop)} / ${formatNumber(requiredPop)}</span>
            </div>` : '';

        container.innerHTML = `
        <div class="space-y-3">
            <h3 class="text-base font-semibold text-war-gold">Requisitos de Fundación</h3>
            <div class="bg-gray-900/50 rounded-lg p-3 space-y-2">
                ${slotHTML}
                ${popHTML}
                <div class="flex items-center justify-between ${hasEnoughSettlers ? '' : 'text-red-400'}">
                    <span class="text-sm">🏛️ Colonos requeridos</span>
                    <span class="font-mono text-sm">${settlersAvailable} / ${settlersRequired}</span>
                </div>
            </div>
            <div class="bg-gray-900/50 rounded-lg p-3 space-y-2">
                <div class="text-sm font-semibold text-gray-300 mb-1">Costo de recursos (disponible / necesario)</div>
                ${costHTML}
            </div>
        </div>`;
        container.classList.remove('hidden');
    }

    _updateSettlementInfoVisibility() {
        const container = this.#panelElement.querySelector('#attack-panel-settlement-info');
        const missionType = this.#panelElement.querySelector('input[name="mission-type"]:checked')?.value;
        if (missionType === 'settle') {
            this._renderSettlementInfo();
        } else {
            container.classList.add('hidden');
            container.innerHTML = '';
        }
    }

    _handleMovementResult(event) {
        const { result, missionType } = event.detail;
        if (!result) return;
        if (missionType === 'settle') {
            if (result.success) {
                toastUI.show('Colonos enviados a fundar nueva aldea.', 'success');
            } else {
                const reasons = {
                    INSUFFICIENT_SETTLERS: 'No tienes suficientes colonos.',
                    INSUFFICIENT_POPULATION: 'No tienes suficiente población para fundar.',
                    INSUFFICIENT_RESOURCES: 'No tienes suficientes recursos para fundar.',
                    MAX_SETTLEMENTS_REACHED: 'Has alcanzado el máximo de aldeas fundables desde esta aldea.',
                    VILLAGE_NOT_FOUND: 'Aldea de origen no encontrada.',
                    NO_VALID_UNITS: 'No hay unidades válidas para el viaje.',
                };
                toastUI.show(reasons[result.reason] || `Error al fundar: ${result.reason}`, 'error');
            }
        }
    }
    
    _updateCatapultTargetsVisibility() {
        const container = this.#panelElement.querySelector('#attack-panel-catapult-targets');
        const missionType = this.#panelElement.querySelector('input[name="mission-type"]:checked')?.value;
        
        const playerRace = this.#gameState.players.find(p => p.id === this.#activeVillage.ownerId)?.race;
        if (!playerRace) {
            container.classList.add('hidden');
            return;
        }
        
        const catapultUnit = gameData.units[playerRace].troops.find(t => t.role === 'catapult');
        if (!catapultUnit) {
            container.classList.add('hidden');
            return;
        }

        const catapultInput = this.#panelElement.querySelector(`input[data-unit-id="${catapultUnit.id}"]`);
        const catapultsToSend = parseInt(catapultInput?.value || '0', 10);

        const shouldBeVisible = missionType === 'attack' && catapultsToSend > 0;
        container.classList.toggle('hidden', !shouldBeVisible);
    }

    _handleMissionChange(missionType) {
        if (missionType !== 'attack') {
            const conquestCheckbox = this.#panelElement.querySelector('#oasis-conquest-checkbox');
            if (conquestCheckbox) conquestCheckbox.checked = false;
        }

        const troopRows = this.#panelElement.querySelectorAll('.troop-row');
        const settlerInput = this.#panelElement.querySelector('input[data-unit-type="settler"]');
        const settlementConfig = gameData.config.settlement;
        
        troopRows.forEach(row => {
            const input = row.querySelector('input[data-unit-id]');
            input.disabled = false;
            row.classList.remove('hidden');

            if (missionType === 'settle') {
                if (row.dataset.unitType !== 'settler') {
                    row.classList.add('hidden');
                    input.value = '';
                    this.#troopInputs.delete(input.dataset.unitId);
                }
            } else if (missionType === 'espionage') {
                if (row.dataset.unitType !== 'scout') {
                    row.classList.add('hidden');
                    input.value = '';
                    this.#troopInputs.delete(input.dataset.unitId);
                }
            }
        });

        if (missionType === 'settle' && settlerInput && settlementConfig) {
            settlerInput.value = settlementConfig.settlersRequired;
            settlerInput.disabled = true;
            this.#troopInputs.set(settlerInput.dataset.unitId, settlerInput.value);
        }

        this._updateSettlementInfoVisibility();
        this._updateCatapultTargetsVisibility();
    }

    _handleInputValidation(input) {
        const max = parseInt(input.max, 10);
        let value = parseInt(input.value, 10);
        if (isNaN(value) || value < 0) {
            value = 0;
        }
        if (value > max) {
            value = max;
        }
        input.value = value > 0 ? value : '';
    }

    _handleFillAllClick() {
        const missionType = this.#panelElement.querySelector('input[name="mission-type"]:checked')?.value;
        
        this.#panelElement.querySelectorAll('.troop-row:not(.hidden) input[type="number"]').forEach(input => {
            if (missionType === 'settle') return;
            input.value = input.max;
            this.#troopInputs.set(input.dataset.unitId, input.max);
        });

        this._updateCatapultTargetsVisibility();
    }

    _handleResetClick() {
        this.#panelElement.querySelectorAll('.troop-row:not(.hidden) input[type="number"]').forEach(input => {
            if (input.disabled) return;
            input.value = '';
            this.#troopInputs.delete(input.dataset.unitId);
        });

        this._updateCatapultTargetsVisibility();
    }

    _handleSendClick() {
        const troops = {};
        this.#troopInputs.forEach((value, unitId) => {
            const count = parseInt(value, 10);
            if (count > 0) {
                troops[unitId] = count;
            }
        });

        if (Object.keys(troops).length === 0) {
            toastUI.show('Debes seleccionar al menos una tropa.', 'warning');
            return;
        }

        const missionTypeInput = this.#panelElement.querySelector('input[name="mission-type"]:checked');
        if (!missionTypeInput) {
            toastUI.show('Debes seleccionar un tipo de misión.', 'warning');
            return;
        }
        const missionType = missionTypeInput.value;
        const conquerOasis = this.#panelElement.querySelector('#oasis-conquest-checkbox')?.checked === true;

        if (conquerOasis && missionType !== 'attack') {
            toastUI.show('La conquista de oasis debe enviarse como Ataque.', 'warning');
            return;
        }

if (missionType === 'settle') {
            const settlementConfig = gameData.config.settlement;
            if (!settlementConfig) {
                toastUI.show('Error de configuración: Faltan datos de fundación.', 'error');
                return;
            }

            const playerRace = this.#gameState.players.find(p => p.id === this.#activeVillage.ownerId)?.race;
            if (!playerRace) return;

            const settlerData = gameData.units[playerRace].troops.find(t => t.type === 'settler');
            const settlersRequired = settlementConfig.settlersRequired;
            const settlersSent = troops[settlerData.id] || 0;

            if (settlersSent !== settlersRequired) {
                toastUI.show(`Debes enviar exactamente ${settlersRequired} colonos.`, 'error');
                return;
            }

            const settlementCost = this._getComputedSettlementCost();
            for (const res in settlementCost) {
                if (this.#activeVillage.resources[res].current < settlementCost[res]) {
                    toastUI.show(`No tienes suficientes recursos para fundar. (Necesitas ${formatNumber(settlementCost[res])} de ${res})`, 'error');
                    return;
                }
            }
        }

        const payload = {
            originVillageId: this.#activeVillage.id,
            targetCoords: this.#targetTile,
            troops: troops,
            missionType: missionType,
            catapultTargets: [],
            conquerOasis,
        };

        if (missionType === 'attack') {
            const target1 = this.#panelElement.querySelector('#catapult-target-1')?.value;
            const target2 = this.#panelElement.querySelector('#catapult-target-2')?.value;
            if (target1 && target1 !== 'random') payload.catapultTargets.push(target1);
            if (target2 && target2 !== 'random') payload.catapultTargets.push(target2);
        }

        gameManager.sendCommand('send_movement', payload);

        if (missionType !== 'settle') {
            toastUI.show('Movimiento de tropas enviado.', 'success');
        }
        this.hide();
    }
}

const attackPanelUI = new AttackPanelUI();
export default attackPanelUI;
