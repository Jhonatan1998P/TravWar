// js/ui/MovementsUI.js
import { gameData } from '../core/GameData.js';
import { formatTime, formatNumber } from '../utils/formatters.js';
import toastUI from './ToastUI.js';
import uiRenderScheduler from './UIRenderScheduler.js';

class MovementsUI {
    #container;
    #countdownIntervals = new Map();
    #gameState = null;
    #notifiedAttackIds = new Set();

    constructor(containerId) {
        this.#container = document.getElementById(containerId);
        if (!this.#container) {
            console.error(`[MovementsUI] No se encontró el contenedor con el ID: ${containerId}`);
            return;
        }
        uiRenderScheduler.register(`movements-ui-${containerId}`, (gameState) => this.render(gameState.state));
    }

    _startCountdown(movement) {
        if (this.#countdownIntervals.has(movement.id)) {
            clearInterval(this.#countdownIntervals.get(movement.id));
        }

        const timerElement = this.#container.querySelector(`[data-timer-for="${movement.id}"]`);
        if (!timerElement) return;

        const intervalId = setInterval(() => {
            const remainingMs = movement.arrivalTime - Date.now();
            const currentRemainingSeconds = remainingMs / 1000;

            if (currentRemainingSeconds <= 0) {
                timerElement.textContent = formatTime(0);
                clearInterval(intervalId);
                this.#countdownIntervals.delete(movement.id);
            } else {
                timerElement.textContent = formatTime(currentRemainingSeconds);
            }
        }, 250);

        this.#countdownIntervals.set(movement.id, intervalId);
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
        // Si el movimiento NO es mío (es un ataque entrante), mostrar origen -> destino
        if (movement.ownerId !== currentOwnerId && (movement.type === 'attack' || movement.type === 'raid')) {
            const originVillage = this.#gameState.villages.find(v => v.id === movement.originVillageId);
            const originCoords = originVillage ? `${originVillage.coords.x}|${originVillage.coords.y}` : 'Origen Desconocido';
            // Para el defensor, el target es su propia aldea (o una de ellas)
            return `Ataque desde (${originCoords})`;
        }
        
        // Si el movimiento ES mío (saliente o retorno), mostrar tipo y destino
        const originVillage = this.#gameState.villages.find(v => v.id === movement.originVillageId);
        const originName = originVillage ? originVillage.name : 'Desconocido';
        const targetName = this._getVillageName(movement.targetCoords);

        switch(movement.type) {
            case 'attack': return `Ataque a ${targetName}`;
            case 'raid': return `Asalto a ${targetName}`;
            case 'reinforcement': return `Apoyo a ${targetName}`;
            case 'settle': return `Fundación en ${targetName}`;
            case 'return': return `Regreso a ${originName}`; // El retorno siempre es propio
            case 'trade': return `Comercio hacia ${targetName}`;
            case 'trade_return': return `Mercaderes de vuelta a ${originName}`;
            case 'espionage': return `Espionaje a ${targetName}`;
            default: return 'Movimiento desconocido';
        }
    }
    
    _renderPayload(movement, isDetailsVisible) {
        // Si no tengo permiso para ver los detalles (es ataque/refuerzo entrante), ocultar info
        if (!isDetailsVisible) {
            return `
                <div class="flex items-center justify-center py-2 opacity-50">
                    <span class="text-2xl font-bold tracking-widest text-gray-500">???</span>
                </div>
            `;
        }

        let contentHTML = '';

        // Renderizar Recursos (Comercio o Botín de retorno)
        const resourcesToRender = movement.type === 'trade' ? movement.payload.resources : 
                                  (movement.type === 'return' && (movement.payload.plunder || movement.payload.bounty)) ? 
                                  { ...movement.payload.plunder, ...movement.payload.bounty } : null;

        if (resourcesToRender) {
            const resourceMap = { wood: 'Madera', stone: 'Barro', iron: 'Hierro', food: 'Cereal' };
            const resHTML = Object.entries(resourcesToRender)
                .filter(([_, count]) => count > 0)
                .map(([res, count]) => `<div class="flex justify-between text-xs"><span class="text-gray-400">${resourceMap[res]}</span><span>${formatNumber(count)}</span></div>`)
                .join('');
            
            if (resHTML) {
                contentHTML += `<div class="mb-2 border-b border-gray-700 pb-1">${resHTML}</div>`;
            }
        }
        
        // Renderizar Tropas
        if (movement.payload.troops) {
            const ownerPlayer = this.#gameState.players.find(p => p.id === movement.ownerId);
            if (!ownerPlayer) return '<div class="text-xs text-red-500">Error: Datos de jugador no disponibles.</div>';
            const ownerRace = ownerPlayer.race;

            const troopsHTML = Object.entries(movement.payload.troops)
                .map(([unitId, count]) => {
                    const unitName = gameData.units[ownerRace]?.troops.find(u => u.id === unitId)?.name || unitId;
                    return `<div class="flex justify-between text-xs"><span class="text-gray-400">${unitName}</span><span>${formatNumber(count)}</span></div>`;
                }).join('');
            
            contentHTML += troopsHTML;
        }
        
        return contentHTML || '<div class="text-xs text-gray-500 italic">Sin carga</div>';
    }

    render(state) {
        if (!this.#container || !state) return;
        this.#gameState = state;

        // 1. Determinar el dueño de la aldea activa (Player o IA)
        const activeVillage = state.villages.find(v => v.id === state.activeVillageId);
        const currentOwnerId = activeVillage ? activeVillage.ownerId : 'player';

        // 2. Obtener coordenadas de TODAS las aldeas de ese dueño
        const currentOwnerVillageCoords = new Set(
            state.villages.filter(v => v.ownerId === currentOwnerId).map(v => `${v.coords.x}|${v.coords.y}`)
        );

        // 3. Filtrar movimientos dinámicamente
        const movements = state.movements.filter(m => 
            // Mostrar si el dueño actual envió el movimiento (Saliente / Retorno)
            m.ownerId === currentOwnerId ||
            (
                // O si es un movimiento dirigido a una de las aldeas del dueño actual (Entrante)
                (m.type === 'attack' || m.type === 'raid' || m.type === 'espionage' || m.type === 'reinforcement' || m.type === 'trade') &&
                currentOwnerVillageCoords.has(`${m.targetCoords.x}|${m.targetCoords.y}`)
            )
        );

        // Notificaciones Toast (Solo si el dueño actual es el jugador humano)
        if (currentOwnerId === 'player') {
            const incomingAttacks = movements.filter(m => m.ownerId !== 'player' && (m.type === 'attack' || m.type === 'raid'));
            
            incomingAttacks.forEach(attack => {
                if (!this.#notifiedAttackIds.has(attack.id)) {
                    const targetName = this._getVillageName(attack.targetCoords);
                    toastUI.show(`¡Ataque enemigo en camino a ${targetName}!`, 'error', 5000);
                    this.#notifiedAttackIds.add(attack.id);
                }
            });

            const currentAttackIds = new Set(incomingAttacks.map(a => a.id));
            this.#notifiedAttackIds.forEach(id => {
                if (!currentAttackIds.has(id)) {
                    this.#notifiedAttackIds.delete(id);
                }
            });
        }

        // Limpieza de intervalos
        const currentMovementIds = new Set(movements.map(m => m.id));
        this.#countdownIntervals.forEach((intervalId, movementId) => {
            if (!currentMovementIds.has(movementId)) {
                clearInterval(intervalId);
                this.#countdownIntervals.delete(movementId);
            }
        });

        if (!movements || movements.length === 0) {
            this.#container.innerHTML = '<div class="text-center text-gray-500 text-sm py-4">No hay movimientos de tropas.</div>';
            return;
        }

        let movementsHTML = '<ul class="space-y-3">';
        movements.forEach(movement => {
            const initialRemainingSeconds = (movement.arrivalTime - Date.now()) / 1000;
            
            // Lógica de Visibilidad:
            // Solo mostrar detalles si el movimiento es propiedad del jugador actual.
            // Esto cubre: Ataques salientes, Refuerzos salientes, Retornos, Comercio saliente.
            // Oculta: Ataques entrantes, Refuerzos entrantes (de otros), Comercio entrante.
            const isOwnMovement = movement.ownerId === currentOwnerId;
            
            const payloadContent = this._renderPayload(movement, isOwnMovement);
            
            const isIncomingHostile = !isOwnMovement && (movement.type === 'attack' || movement.type === 'raid');
            
            const titleClass = isIncomingHostile ? 'text-red-400' : (isOwnMovement ? 'text-yellow-400' : 'text-blue-300');
            const timerClass = isIncomingHostile ? 'text-red-400' : 'text-yellow-300';
            const bgClass = isIncomingHostile ? 'bg-red-900/20 border-red-700/30' : 'bg-gray-900/50 border-gray-700/30';

            movementsHTML += `
                <li class="p-3 rounded-lg shadow-md border ${bgClass}">
                    <div class="flex items-center justify-between mb-2">
                        <span class="font-semibold ${titleClass} text-xs uppercase tracking-wide truncate pr-2" title="${this._getMovementTitle(movement, currentOwnerId)}">
                            ${this._getMovementTitle(movement, currentOwnerId)}
                        </span>
                        <div class="font-mono text-sm ${timerClass} font-bold whitespace-nowrap" data-timer-for="${movement.id}">
                            ${formatTime(initialRemainingSeconds)}
                        </div>
                    </div>
                    <div class="p-2 bg-gray-800/60 rounded-md min-h-[2rem]">
                        ${payloadContent}
                    </div>
                </li>
            `;
        });
        movementsHTML += '</ul>';

        this.#container.innerHTML = movementsHTML;
        
        movements.forEach(movement => {
            this._startCountdown(movement);
        });
    }
}

export default MovementsUI;