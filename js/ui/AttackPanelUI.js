import gameManager from '../GameManager.js';
import { gameData, NON_TARGETABLE_BUILDINGS } from '../core/GameData.js';
import { formatNumber } from '../utils/formatters.js';
import toastUI from './ToastUI.js';
import { unitSpriteManager } from './UnitSpriteManager.js';

class AttackPanelUI {
    #panelElement;
    #mainContainer;
    #targetTile = null;
    #gameState = null;
    #activeVillage = null;
    #troopInputs = new Map();

    constructor() {
        this.#mainContainer = document.getElementById('village-container');
        if (!this.#mainContainer) return;
        this._createPanelHTML();
        this.#panelElement = document.getElementById('attack-panel');
        this._initializeEventListeners();
    }

    _createPanelHTML() {
        const panelHTML = `
            <div id="attack-panel" class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 transition-all duration-200 ease-out panel-hidden">
                <div class="bg-gray-800 border-2 border-gray-700/50 rounded-lg shadow-xl w-full max-w-lg m-4 text-white flex flex-col">
                    <header class="flex justify-between items-center p-4 border-b border-gray-700">
                        <h2 id="attack-panel-title" class="text-xl font-bold text-yellow-300">Enviar Tropas</h2>
                        <button data-action="close" class="text-gray-400 text-3xl leading-none hover:text-white">×</button>
                    </header>
                    <main id="attack-panel-main" class="p-4 overflow-y-auto" style="max-height: 70vh;">
                        <div id="attack-panel-info" class="grid grid-cols-2 gap-4 mb-4 text-sm"></div>
                        <div id="attack-panel-troops" class="space-y-2 mb-4"></div>
                        <div id="attack-panel-actions" class="flex justify-end gap-2 mb-4">
                            <button data-action="reset" class="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded-md">Reiniciar</button>
                            <button data-action="fill-all" class="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded-md">Todas</button>
                        </div>
                        <fieldset id="attack-panel-missions" class="border-t border-gray-700 pt-4">
                            <legend class="text-base font-semibold text-gray-300 mb-2">Tipo de Misión</legend>
                            <div class="flex flex-wrap gap-2"></div>
                        </fieldset>
                        <div id="attack-panel-catapult-targets" class="border-t border-gray-700 pt-4 mt-4 hidden"></div>
                    </main>
                    <footer class="p-4 border-t border-gray-700">
                        <button data-action="send" class="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-4 rounded-lg transition duration-300 disabled:bg-gray-600 disabled:cursor-not-allowed">
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
        });
    }

    show(targetTile, gameState) {
        this.#targetTile = targetTile;
        this.#gameState = gameState;
        this.#activeVillage = this.#gameState.villages.find(v => v.id === this.#gameState.activeVillageId);
        if (!this.#activeVillage) return;
        
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
        this._renderCatapultTargets();
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
        const playerRace = this.#gameState.players.find(p => p.id === this.#activeVillage.ownerId)?.race;
        const scoutUnit = gameData.units[playerRace]?.troops.find(t => t.type === 'scout');
        const hasScouts = scoutUnit && (this.#activeVillage.unitsInVillage[scoutUnit.id] || 0) > 0;

        const missions = [
            { id: 'settle', label: 'Fundar Aldea', available: targetType === 'valley' },
            { id: 'reinforcement', label: 'Apoyo', available: targetType === 'village' && targetData.ownerId === 'player' },
            { id: 'espionage', label: 'Espionaje', available: ((targetType === 'village' && targetData.ownerId !== 'player') || targetType === 'oasis') && hasScouts },
            { id: 'raid', label: 'Asalto', available: (targetType === 'village' && targetData.ownerId !== 'player') || targetType === 'oasis' },
            { id: 'attack', label: 'Ataque', available: (targetType === 'village' && targetData.ownerId !== 'player') || targetType === 'oasis' }
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

            const settlementCost = settlementConfig.cost;
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
            catapultTargets: []
        };

        if (missionType === 'attack') {
            const target1 = this.#panelElement.querySelector('#catapult-target-1')?.value;
            const target2 = this.#panelElement.querySelector('#catapult-target-2')?.value;
            if (target1 && target1 !== 'random') payload.catapultTargets.push(target1);
            if (target2 && target2 !== 'random') payload.catapultTargets.push(target2);
        }

        gameManager.sendCommand('send_movement', payload);
        
        toastUI.show('Movimiento de tropas enviado.', 'success');
        this.hide();
    }
}

const attackPanelUI = new AttackPanelUI();
export default attackPanelUI;