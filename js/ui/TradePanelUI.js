import gameManager from '../GameManager.js';
import { gameData } from '../core/GameData.js';
import { formatNumber } from '../utils/formatters.js';
import toastUI from './ToastUI.js';

const ICONS = {
    wood: `<img src="assets/icons/wood.png" alt="Madera" class="h-5 w-5">`,
    clay: `<img src="assets/icons/clay.png" alt="Barro" class="h-5 w-5">`,
    iron: `<img src="assets/icons/iron.png" alt="Hierro" class="h-5 w-5">`,
    wheat: `<img src="assets/icons/wheat.png" alt="Cereal" class="h-5 w-5">`,
    merchant: `<img src="assets/icons/merchant.png" alt="Mercader" class="h-6 w-6">`
};

class TradePanelUI {
    #panelElement;
    #mainContainer;
    #targetTile = null;
    #gameState = null;
    #activeVillage = null;
    #merchantCapacity = 0;
    #availableMerchants = 0;

    constructor() {
        this.#mainContainer = document.getElementById('village-container');
        if (!this.#mainContainer) return;
        this._createPanelHTML();
        this.#panelElement = document.getElementById('trade-panel');
        this._initializeEventListeners();
    }

    _createPanelHTML() {
        const panelHTML = `
            <div id="trade-panel" class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 transition-all duration-200 ease-out panel-hidden">
                <div class="bg-gray-800 border-2 border-gray-700/50 rounded-lg shadow-xl w-full max-w-lg m-4 text-white flex flex-col">
                    <header class="flex justify-between items-center p-4 border-b border-gray-700">
                        <h2 id="trade-panel-title" class="text-xl font-bold text-yellow-300">Enviar Recursos</h2>
                        <button data-action="close" class="text-gray-400 text-3xl leading-none hover:text-white">×</button>
                    </header>
                    <main id="trade-panel-main" class="p-4 overflow-y-auto" style="max-height: 70vh;">
                        <div id="trade-panel-info" class="grid grid-cols-2 gap-4 mb-4 text-sm"></div>
                        <div id="trade-panel-merchants" class="p-3 bg-gray-900/50 rounded-lg flex justify-between items-center mb-4"></div>
                        <div id="trade-panel-inputs" class="space-y-2"></div>
                    </main>
                    <footer class="p-4 border-t border-gray-700 space-y-2">
                        <div class="flex justify-between text-sm">
                            <span class="text-gray-400">Total a enviar:</span>
                            <span id="trade-total-sent" class="font-mono font-semibold">0</span>
                        </div>
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
                case 'max': this._handleMaxClick(e.target.dataset.res); break;
            }
        });
        
        this.#panelElement.addEventListener('input', e => {
            if (e.target.matches('input[type="number"]')) {
                this._handleInputValidation(e.target);
                this._updateTotalAndButtonState();
            }
        });
    }

    show(targetTile, gameState) {
        this.#targetTile = targetTile;
        this.#gameState = gameState;
        this.#activeVillage = this.#gameState.villages.find(v => v.id === this.#gameState.activeVillageId);
        if (!this.#activeVillage) return;

        this._render();
        this.#panelElement.classList.remove('panel-hidden');
        this.#panelElement.classList.add('panel-visible');
    }

    hide() {
        this.#panelElement.classList.remove('panel-visible');
        this.#panelElement.classList.add('panel-hidden');
    }

    _render() {
        this._renderInfo();
        this._renderInputsAndCapacity();
        this._updateTotalAndButtonState();
    }

    _renderInfo() {
        const targetVillage = this.#gameState.villages.find(v => v.coords.x === this.#targetTile.x && v.coords.y === this.#targetTile.y);
        const infoContainer = this.#panelElement.querySelector('#trade-panel-info');
        infoContainer.innerHTML = `
            <div class="bg-gray-900/50 p-3 rounded-lg">
                <div class="text-xs text-gray-400">Origen</div>
                <div class="font-semibold text-white">${this.#activeVillage.name}</div>
                <div class="font-mono text-gray-300">(${this.#activeVillage.coords.x}|${this.#activeVillage.coords.y})</div>
            </div>
            <div class="bg-gray-900/50 p-3 rounded-lg">
                <div class="text-xs text-gray-400">Destino</div>
                <div class="font-semibold text-white">${targetVillage.name}</div>
                <div class="font-mono text-gray-300">(${targetVillage.coords.x}|${targetVillage.coords.y})</div>
            </div>
        `;
    }

    _renderInputsAndCapacity() {
        const merchantsContainer = this.#panelElement.querySelector('#trade-panel-merchants');
        const inputsContainer = this.#panelElement.querySelector('#trade-panel-inputs');
        
        const marketplace = this.#activeVillage.buildings.find(b => b.type === 'marketplace');

        // --- INICIO DE LA CORRECCIÓN ---
        const ownerPlayer = this.#gameState.players.find(p => p.id === this.#activeVillage.ownerId);
        if (!ownerPlayer) return;
        const merchantUnit = gameData.units[ownerPlayer.race].troops.find(t => t.type === 'merchant');
        // --- FIN DE LA CORRECCIÓN ---
        
        this.#availableMerchants = marketplace ? gameData.buildings.marketplace.levels[marketplace.level - 1].attribute.merchantCapacity : 0;
        this.#merchantCapacity = this.#availableMerchants * (merchantUnit?.stats.capacity || 0);

        merchantsContainer.innerHTML = `
            <div class="flex items-center gap-2">${ICONS.merchant} <span class="font-semibold">${this.#availableMerchants} Mercaderes</span></div>
            <div class="text-sm font-mono">Capacidad Total: <span class="font-bold text-white">${formatNumber(this.#merchantCapacity)}</span></div>
        `;

        const resources = ['wood', 'stone', 'iron', 'food'];
        const iconMap = { wood: ICONS.wood, stone: ICONS.clay, iron: ICONS.iron, food: ICONS.wheat };

        inputsContainer.innerHTML = resources.map(res => {
            const available = Math.floor(this.#activeVillage.resources[res].current);
            return `
                <div class="flex items-center gap-3 p-2 bg-gray-700/50 rounded-lg">
                    <div class="w-8 h-8 flex items-center justify-center">${iconMap[res]}</div>
                    <div class="flex-grow font-semibold capitalize">${res === 'stone' ? 'Barro' : (res === 'food' ? 'Cereal' : res)}</div>
                    <div class="flex items-center gap-2">
                        <span class="text-sm text-gray-400">(${formatNumber(available)})</span>
                        <input type="number" min="0" max="${available}" data-res="${res}" placeholder="0" class="w-32 bg-gray-900 border border-gray-600 text-white rounded-md p-1 text-center font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                        <button data-action="max" data-res="${res}" class="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded-md">Máx</button>
                    </div>
                </div>
            `;
        }).join('');
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

    _updateTotalAndButtonState() {
        const totalDisplay = this.#panelElement.querySelector('#trade-total-sent');
        const sendButton = this.#panelElement.querySelector('[data-action="send"]');
        const inputs = this.#panelElement.querySelectorAll('input[type="number"]');
        
        let totalSent = 0;
        inputs.forEach(input => {
            totalSent += parseInt(input.value, 10) || 0;
        });

        totalDisplay.textContent = formatNumber(totalSent);
        sendButton.disabled = totalSent === 0 || totalSent > this.#merchantCapacity || this.#availableMerchants === 0;
    }
    
    _handleMaxClick(res) {
        const inputs = Array.from(this.#panelElement.querySelectorAll('input[type="number"]'));
        const otherInputs = inputs.filter(i => i.dataset.res !== res);
        const targetInput = inputs.find(i => i.dataset.res === res);

        let otherTotal = 0;
        otherInputs.forEach(input => {
            otherTotal += parseInt(input.value, 10) || 0;
        });

        const remainingCapacity = this.#merchantCapacity - otherTotal;
        const availableResource = parseInt(targetInput.max, 10);

        targetInput.value = Math.max(0, Math.min(remainingCapacity, availableResource));
        this._updateTotalAndButtonState();
    }

    _handleSendClick() {
        const payload = {
            originVillageId: this.#activeVillage.id,
            targetCoords: this.#targetTile,
            resources: {}
        };
        
        let totalSent = 0;
        this.#panelElement.querySelectorAll('input[type="number"]').forEach(input => {
            const count = parseInt(input.value, 10) || 0;
            if (count > 0) {
                payload.resources[input.dataset.res] = count;
                totalSent += count;
            }
        });

        if (totalSent === 0) {
            toastUI.show('Debes enviar al menos 1 recurso.', 'warning');
            return;
        }
        
        if (totalSent > this.#merchantCapacity) {
            toastUI.show('La cantidad de recursos excede la capacidad de tus mercaderes.', 'error');
            return;
        }

        if (this.#availableMerchants === 0) {
            toastUI.show('No tienes mercaderes disponibles.', 'error');
            return;
        }

        gameManager.sendCommand('send_merchants', payload);
        toastUI.show('Envío de mercaderes en camino.', 'success');
        this.hide();
    }
}

const tradePanelUI = new TradePanelUI();
export default tradePanelUI;