import { gameData } from '../core/GameData.js';
import { formatNumber } from '@shared/lib/formatters.js';
import { unitSpriteManager } from './UnitSpriteManager.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import { selectTroopsSignature } from './renderSelectors.js';

const ICONS = {
    unit: `<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" /></svg>`,
    reinforcements: `<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M15 21V5a2 2 0 00-2-2H9a2 2 0 00-2 2v16" /></svg>`
};

class TroopsUI {
    #container;
    #schedulerKey;

    constructor(containerId) {
        this.#container = document.getElementById(containerId);
        if (!this.#container) {
            console.error(`[TroopsUI] No se encontró el contenedor con el ID: ${containerId}`);
            return;
        }
        this.#schedulerKey = `troops-ui-${containerId}`;
        uiRenderScheduler.register(this.#schedulerKey, (gameState) => this.render(gameState.state), [
            selectTroopsSignature
        ]);
    }

    destroy() {
        if (this.#schedulerKey) {
            uiRenderScheduler.unregister(this.#schedulerKey);
        }
    }

    render(state) {
        if (!this.#container || !state) return;

        const activeVillage = state.villages.find(v => v.id === state.activeVillageId);
        if (!activeVillage) return;

        const unitsInVillage = activeVillage.unitsInVillage;
        const reinforcements = activeVillage.reinforcements || [];
        
        const playerState = state.players.find(p => p.id === activeVillage.ownerId);
        if (!playerState) {
            this.#container.innerHTML = '<div class="text-red-500">Error: No se pudo encontrar el estado del jugador.</div>';
            return;
        }
        const playerRace = playerState.race;

        const allUnitData = gameData.units[playerRace].troops;

        let finalHTML = '<div class="space-y-4">';
        let hasOwnTroops = false;

        let ownTroopsHTML = '<ul class="space-y-2">';
        for (const unitId in unitsInVillage) {
            const count = unitsInVillage[unitId];
            if (count === 0) continue;
            hasOwnTroops = true;

            const unitData = allUnitData.find(u => u.id === unitId);
            if (!unitData) continue;

            ownTroopsHTML += `
                <li class="flex items-center p-3 bg-gray-700/60 rounded-lg shadow-md gap-4">
                    <div class="flex-shrink-0">${unitSpriteManager.getUnitSprite(unitData.id, playerRace)}</div>
                    <div class="font-mono text-xl text-cyan-300 text-right pr-4">${formatNumber(count)}</div>
                    <div class="flex-grow font-semibold text-white">${unitData.name}</div>
                </li>
            `;
        }
        ownTroopsHTML += '</ul>';
        
        if (hasOwnTroops) {
            finalHTML += `<div><h3 class="text-lg font-semibold text-yellow-400 mb-2">Tropas Propias</h3>${ownTroopsHTML}</div>`;
        }

        const aggregatedReinforcements = {};
        reinforcements.forEach(contingent => {
            for (const unitId in contingent.troops) {
                const count = contingent.troops[unitId];
                if (count > 0) {
                    if (!aggregatedReinforcements[unitId]) {
                        aggregatedReinforcements[unitId] = { count: 0, race: contingent.race };
                    }
                    aggregatedReinforcements[unitId].count += count;
                }
            }
        });

        let reinforcementsHTML = '';
        if (Object.keys(aggregatedReinforcements).length > 0) {
            reinforcementsHTML += `<div class="p-3 bg-blue-900/30 rounded-lg"><h4 class="font-bold text-lg text-blue-300 mb-2">Refuerzos Totales</h4><ul class="space-y-2">`;
            for (const unitId in aggregatedReinforcements) {
                const { count, race } = aggregatedReinforcements[unitId];
                const unitData = gameData.units[race]?.troops.find(u => u.id === unitId);
                const unitName = unitData ? unitData.name : unitId;
                
                reinforcementsHTML += `
                    <li class="flex items-center p-2 bg-gray-800/50 rounded-md gap-4">
                        <div class="flex-shrink-0">${unitSpriteManager.getUnitSprite(unitId, race)}</div>
                        <div class="font-mono text-lg text-blue-300 text-right pr-4">${formatNumber(count)}</div>
                        <div class="flex-grow">
                            <span class="font-semibold text-white">${unitName}</span>
                            <span class="text-xs text-gray-400 ml-2">(${gameData.units[race].name})</span>
                        </div>
                    </li>
                `;
            }
            reinforcementsHTML += '</ul></div>';
            finalHTML += reinforcementsHTML;
        }

        if (!hasOwnTroops && Object.keys(aggregatedReinforcements).length === 0) {
            finalHTML += '<div class="text-center text-gray-500 text-sm py-4">No tienes tropas en la aldea.</div>';
        }

        finalHTML += '</div>';
        this.#container.innerHTML = finalHTML;
    }
}

export default TroopsUI;
