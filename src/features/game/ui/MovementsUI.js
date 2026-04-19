import { gameData } from '../core/GameData.js';
import { formatTime, formatNumber } from '@shared/lib/formatters.js';
import toastUI from './ToastUI.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import { selectMovementsSignature } from './renderSelectors.js';
import { reconcileList } from './reconcileList.js';
import countdownService from './CountdownService.js';

function getPerspectiveOwnerId(state) {
    if (!state?.players) return 'player';

    const explicitPlayer = state.players.find(player => player.id === 'player');
    if (explicitPlayer) return explicitPlayer.id;

    const firstHuman = state.players.find(player => !String(player.id || '').startsWith('ai_'));
    return firstHuman?.id || 'player';
}

function mergeLoot(plunder = {}, bounty = {}) {
    const resources = ['wood', 'stone', 'iron', 'food'];
    return resources.reduce((accumulator, resource) => {
        accumulator[resource] = (plunder?.[resource] || 0) + (bounty?.[resource] || 0);
        return accumulator;
    }, {});
}

class MovementsUI {
    #container;
    #activeCountdownKeys = new Set();
    #gameState = null;
    #notifiedAttackIds = new Set();
    #movementNodes = new Map();
    #list;
    #emptyState;
    #countdownScope;
    #schedulerKey;

    constructor(containerId) {
        this.#container = document.getElementById(containerId);
        if (!this.#container) {
            console.error(`[MovementsUI] No se encontro el contenedor con el ID: ${containerId}`);
            return;
        }

        this.#countdownScope = `movements:${containerId}`;
        this.#schedulerKey = `movements-ui-${containerId}`;

        this.#setupStaticMarkup();

        uiRenderScheduler.register(this.#schedulerKey, (gameState) => this.render(gameState.state), [
            selectMovementsSignature
        ]);
    }

    destroy() {
        if (this.#schedulerKey) {
            uiRenderScheduler.unregister(this.#schedulerKey);
        }

        countdownService.unsubscribeByPrefix(`${this.#countdownScope}:`);
        this.#activeCountdownKeys.clear();
        this.#movementNodes.clear();
        this.#notifiedAttackIds.clear();
    }

    #setupStaticMarkup() {
        this.#container.replaceChildren();

        this.#list = document.createElement('ul');
        this.#list.className = 'space-y-3';

        this.#emptyState = document.createElement('div');
        this.#emptyState.className = 'text-center text-gray-500 text-sm py-4';
        this.#emptyState.textContent = 'No hay movimientos de tropas.';

        this.#container.append(this.#list, this.#emptyState);
    }

    _subscribeCountdown(movement, nextCountdownKeys) {
        const countdownKey = `${this.#countdownScope}:${movement.id}`;
        nextCountdownKeys.add(countdownKey);

        const timerElement = this.#list.querySelector(`[data-timer-for="${movement.id}"]`);
        if (!timerElement) return;

        countdownService.subscribe({
            id: countdownKey,
            endTime: movement.arrivalTime,
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

    _getVillageName(coords) {
        const tile = this.#gameState.mapData.find(t => t.x === coords.x && t.y === coords.y);
        if (tile) {
            if (tile.type === 'village') {
                const village = this.#gameState.villages.find(v => v.id === tile.villageId);
                return village ? village.name : `Aldea (${coords.x}|${coords.y})`;
            }
            if (tile.type === 'oasis') {
                return `Oasis (${coords.x}|${coords.y})`;
            }
        }
        return `Terreno (${coords.x}|${coords.y})`;
    }

    _getMovementTitle(movement, currentOwnerId) {
        if (movement.ownerId !== currentOwnerId && (movement.type === 'attack' || movement.type === 'raid')) {
            const originVillage = this.#gameState.villages.find(v => v.id === movement.originVillageId);
            const originCoords = originVillage ? `${originVillage.coords.x}|${originVillage.coords.y}` : 'Origen Desconocido';
            return `Ataque desde (${originCoords})`;
        }

        const originVillage = this.#gameState.villages.find(v => v.id === movement.originVillageId);
        const originName = originVillage ? originVillage.name : 'Desconocido';
        const targetName = this._getVillageName(movement.targetCoords);

        switch (movement.type) {
            case 'attack': return `Ataque a ${targetName}`;
            case 'raid': return `Asalto a ${targetName}`;
            case 'reinforcement': return `Apoyo a ${targetName}`;
            case 'settle': return `Fundacion en ${targetName}`;
            case 'return': return `Regreso a ${originName}`;
            case 'trade': return `Comercio hacia ${targetName}`;
            case 'trade_return': return `Mercaderes de vuelta a ${originName}`;
            case 'espionage': return `Espionaje a ${targetName}`;
            default: return 'Movimiento desconocido';
        }
    }

    _renderPayload(movement, isDetailsVisible) {
        if (!isDetailsVisible) {
            return '<div class="flex items-center justify-center py-2 opacity-50"><span class="text-2xl font-bold tracking-widest text-gray-500">???</span></div>';
        }

        let contentHTML = '';

        const resourcesToRender = movement.type === 'trade'
            ? movement.payload.resources
            : (movement.type === 'return' && (movement.payload.plunder || movement.payload.bounty))
                ? mergeLoot(movement.payload.plunder, movement.payload.bounty)
                : null;

        if (resourcesToRender) {
            const resourceMap = { wood: 'Madera', stone: 'Barro', iron: 'Hierro', food: 'Cereal' };
            const resHTML = Object.entries(resourcesToRender)
                .filter(([, count]) => count > 0)
                .map(([resource, count]) => `<div class="flex justify-between text-xs"><span class="text-gray-400">${resourceMap[resource]}</span><span>${formatNumber(count)}</span></div>`)
                .join('');

            if (resHTML) {
                contentHTML += `<div class="mb-2 border-b border-gray-700 pb-1">${resHTML}</div>`;
            }
        }

        if (movement.payload.troops) {
            const ownerPlayer = this.#gameState.players.find(player => player.id === movement.ownerId);
            if (!ownerPlayer) {
                return '<div class="text-xs text-red-500">Error: Datos de jugador no disponibles.</div>';
            }
            const ownerRace = ownerPlayer.race;

            const troopsHTML = Object.entries(movement.payload.troops)
                .map(([unitId, count]) => {
                    const unitName = gameData.units[ownerRace]?.troops.find(unit => unit.id === unitId)?.name || unitId;
                    return `<div class="flex justify-between text-xs"><span class="text-gray-400">${unitName}</span><span>${formatNumber(count)}</span></div>`;
                })
                .join('');

            contentHTML += troopsHTML;
        }

        return contentHTML || '<div class="text-xs text-gray-500 italic">Sin carga</div>';
    }

    #createMovementNode() {
        const item = document.createElement('li');
        item.className = 'p-3 rounded-lg shadow-md border';

        const topRow = document.createElement('div');
        topRow.className = 'flex items-center justify-between mb-2';

        const title = document.createElement('span');
        title.className = 'font-semibold text-xs uppercase tracking-wide truncate pr-2';

        const timer = document.createElement('div');
        timer.className = 'font-mono text-sm font-bold whitespace-nowrap';

        topRow.append(title, timer);

        const payloadWrapper = document.createElement('div');
        payloadWrapper.className = 'p-2 bg-gray-800/60 rounded-md min-h-[2rem]';

        item.append(topRow, payloadWrapper);

        item.__refs = {
            title,
            timer,
            payloadWrapper
        };

        return item;
    }

    #updateMovementNode(node, movement, currentOwnerId) {
        const refs = node.__refs;
        const isOwnMovement = movement.ownerId === currentOwnerId;
        const isIncomingHostile = !isOwnMovement && (movement.type === 'attack' || movement.type === 'raid');

        const title = this._getMovementTitle(movement, currentOwnerId);
        const titleClass = isIncomingHostile ? 'text-red-400' : (isOwnMovement ? 'text-yellow-400' : 'text-blue-300');
        const timerClass = isIncomingHostile ? 'text-red-400' : 'text-yellow-300';
        const bgClass = isIncomingHostile ? 'bg-red-900/20 border-red-700/30' : 'bg-gray-900/50 border-gray-700/30';

        node.className = `p-3 rounded-lg shadow-md border ${bgClass}`;

        refs.title.className = `font-semibold ${titleClass} text-xs uppercase tracking-wide truncate pr-2`;
        refs.title.title = title;
        refs.title.textContent = title;

        refs.timer.className = `font-mono text-sm ${timerClass} font-bold whitespace-nowrap`;
        refs.timer.dataset.timerFor = movement.id;
        refs.timer.textContent = formatTime((movement.arrivalTime - Date.now()) / 1000);

        refs.payloadWrapper.innerHTML = this._renderPayload(movement, isOwnMovement);
    }

    render(state) {
        if (!this.#container || !state) return;
        this.#gameState = state;

        const currentOwnerId = getPerspectiveOwnerId(state);

        const currentOwnerVillageCoords = new Set(
            state.villages
                .filter(village => village.ownerId === currentOwnerId)
                .map(village => `${village.coords.x}|${village.coords.y}`)
        );

        const movements = state.movements.filter(movement =>
            movement.ownerId === currentOwnerId
            || (
                (movement.type === 'attack'
                    || movement.type === 'raid'
                    || movement.type === 'espionage'
                    || movement.type === 'reinforcement'
                    || movement.type === 'trade')
                && currentOwnerVillageCoords.has(`${movement.targetCoords.x}|${movement.targetCoords.y}`)
            )
        );

        const incomingAttacks = movements.filter(movement =>
            movement.ownerId !== currentOwnerId && (movement.type === 'attack' || movement.type === 'raid')
        );

        incomingAttacks.forEach(attack => {
            if (!this.#notifiedAttackIds.has(attack.id)) {
                const targetName = this._getVillageName(attack.targetCoords);
                toastUI.show(`¡Ataque enemigo en camino a ${targetName}!`, 'error', 5000);
                this.#notifiedAttackIds.add(attack.id);
            }
        });

        const currentAttackIds = new Set(incomingAttacks.map(attack => attack.id));
        this.#notifiedAttackIds.forEach(id => {
            if (!currentAttackIds.has(id)) {
                this.#notifiedAttackIds.delete(id);
            }
        });

        this.#emptyState.classList.toggle('hidden', movements.length > 0);

        reconcileList(
            this.#list,
            movements,
            movement => movement.id,
            this.#movementNodes,
            () => this.#createMovementNode(),
            (node, movement) => this.#updateMovementNode(node, movement, currentOwnerId)
        );

        const nextCountdownKeys = new Set();
        for (const movement of movements) {
            this._subscribeCountdown(movement, nextCountdownKeys);
        }
        this.#syncCountdownSubscriptions(nextCountdownKeys);
    }
}

export default MovementsUI;
