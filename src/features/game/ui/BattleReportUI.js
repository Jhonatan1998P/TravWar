import { gameData } from '../core/GameData.js';
import { formatNumber } from '@shared/lib/formatters.js';
import { unitSpriteManager } from './UnitSpriteManager.js';
import uiRenderScheduler from './UIRenderScheduler.js';

const ICONS = {
    unit: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" /></svg>`,
    sword: `<img src="/icons/sword.png" alt="Ataque" class="h-5 w-5">`,
    shield: `<img src="/icons/shield.png" alt="Defensa" class="h-5 w-5">`,
    wood: `<img src="/icons/wood.png" alt="Madera" class="h-5 w-5">`,
    stone: `<img src="/icons/clay.png" alt="Barro" class="h-5 w-5">`,
    iron: `<img src="/icons/iron.png" alt="Hierro" class="h-5 w-5">`,
    food: `<img src="/icons/wheat.png" alt="Cereal" class="h-5 w-5">`,
    bounty: `<img src="/icons/bolsa.png" alt="Recompensa" class="h-5 w-5">`,
    capacity: `<img src="/icons/bolsa.png" alt="Capacidad" class="h-5 w-5">`,
    settlement: `<svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>`,
    siege: `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>`
};

const FORBIDDEN_ANALYTICS_KEYS = [
    'rewardNet',
    'roi',
    'netProfit',
    'expectedRewardNet',
    'recommendedTarget',
    'recommendation',
    'targetRanking',
    'opportunityScore',
];

const FORBIDDEN_ANALYTICS_PATTERNS = [
    /roi/i,
    /reward[_-]?net/i,
    /net[_-]?profit/i,
    /recommend/i,
    /target[_-]?ranking/i,
    /opportunity[_-]?score/i,
];

function normalizeKey(key) {
    return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

class BattleReportUI {
    #panelElement;
    #mainContainer;
    #gameState = null;

    constructor() {
        this.#mainContainer = document.getElementById('village-container');
        if (!this.#mainContainer) return;
        this._createPanelHTML();
        this.#panelElement = document.getElementById('battle-report-panel');
        this._initializeEventListeners();
    }

    _createPanelHTML() {
        const panelHTML = `
            <div id="battle-report-panel" class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 transition-all duration-200 ease-out panel-hidden">
                <div class="bg-gray-800 border-2 border-gray-700/50 rounded-lg shadow-xl w-full max-w-2xl m-4 text-white flex flex-col">
                    <header id="report-header" class="flex justify-between items-center p-4 border-b border-gray-700"></header>
                    <main id="report-main" class="p-4 overflow-y-auto" style="max-height: 70vh;"></main>
                    <footer class="p-4 border-t border-gray-700">
                        <button data-action="close" class="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition duration-300">Cerrar</button>
                    </footer>
                </div>
            </div>`;
        this.#mainContainer.insertAdjacentHTML('beforeend', panelHTML);
    }

    _initializeEventListeners() {
        this.#panelElement.querySelector('[data-action="close"]').addEventListener('click', () => this.hide());
        document.addEventListener('notify:battle_report', e => this.show(e.detail.report, e.detail.state));
        uiRenderScheduler.register('battle-report-ui', (gameStatePayload) => {
            this.#gameState = gameStatePayload.state;
        });
    }

    show(report, gameState) {
        if (!report) return;
        this.#gameState = gameState;
        const sanitizedReport = this._sanitizePlayerFacingReport(report);
        this._render(sanitizedReport);
        this.#panelElement.classList.remove('panel-hidden');
        this.#panelElement.classList.add('panel-visible');
    }

    _sanitizePlayerFacingReport(report) {
        const forbiddenKeys = new Set(FORBIDDEN_ANALYTICS_KEYS);
        const forbiddenNormalizedKeys = new Set(FORBIDDEN_ANALYTICS_KEYS.map(normalizeKey));

        const sanitize = (value) => {
            if (Array.isArray(value)) return value.map(sanitize);
            if (!value || typeof value !== 'object') return value;

            const cleaned = {};
            for (const [key, nestedValue] of Object.entries(value)) {
                const normalizedKey = normalizeKey(key);
                const isForbidden = forbiddenKeys.has(key)
                    || forbiddenNormalizedKeys.has(normalizedKey)
                    || FORBIDDEN_ANALYTICS_PATTERNS.some(pattern => pattern.test(key));

                if (isForbidden) continue;
                cleaned[key] = sanitize(nestedValue);
            }
            return cleaned;
        };

        return sanitize(report);
    }

    hide() {
        this.#panelElement.classList.remove('panel-visible');
        this.#panelElement.classList.add('panel-hidden');
    }

    _render(report) {
        this._renderHeader(report);
        this._renderMain(report);
    }

    _renderHeader(report) {
        const header = this.#panelElement.querySelector('#report-header');
        const date = new Date(report.time).toLocaleString();
        let title = 'Informe del Sistema';
        let titleColorClass = 'text-yellow-300';
        const activeVillage = this.#gameState?.villages?.find(village => village.id === this.#gameState?.activeVillageId);
        const perspectiveOwnerId = activeVillage?.ownerId || 'player';
    
        if (report.type === 'settlement_success') {
            title = 'Fundación de Aldea Exitosa';
            titleColorClass = 'text-blue-400';
        } else if (report.attacker && report.defender) {
            const attackerName = report.attacker.villageName || 'Aldea desconocida';
            const defenderName = report.defender.villageName || `Oasis (${report.defender.coords.x}|${report.defender.coords.y})`;
    
            let missionType = 'Ataque';
            if (report.type === 'raid') missionType = 'Asalto';
            if (report.type === 'espionage') missionType = 'Espionaje';
            if (report.type === 'espionage_defense') missionType = 'Espionaje';
    
            title = `${missionType} de ${attackerName} a ${defenderName}`;
            
            const isPerspectiveAttacker = report.attacker.ownerId === perspectiveOwnerId;
            if (report.type.includes('espionage')) {
                if (isPerspectiveAttacker) {
                    const totalLosses = Object.values(report.attacker.losses || {}).reduce((s, v) => s + v, 0);
                    const totalTroops = Object.values(report.attacker.troops || {}).reduce((s, v) => s + v, 0);
                    if (totalLosses === 0) titleColorClass = 'text-green-400';
                    else if (totalLosses < totalTroops) titleColorClass = 'text-yellow-300';
                    else titleColorClass = 'text-red-400';
                } else {
                    titleColorClass = report.espionageDetected ? 'text-green-400' : 'text-red-400';
                }
            } else if (report.summary) {
                const didAttackerWin = report.winner === report.attacker.playerName;
                if (isPerspectiveAttacker) {
                    const hadLosses = Object.keys(report.attacker.losses || {}).length > 0;
                    if (didAttackerWin) {
                        titleColorClass = hadLosses ? 'text-yellow-300' : 'text-green-400';
                    } else {
                        titleColorClass = 'text-red-400';
                    }
                } else {
                    const perspectiveContingent = report.defender.contingents.find(c => c.ownerId === perspectiveOwnerId);
                    const perspectiveHasLosses = perspectiveContingent && perspectiveContingent.losses && Object.keys(perspectiveContingent.losses).length > 0;
                    if (didAttackerWin) {
                        titleColorClass = 'text-red-400';
                    } else {
                        titleColorClass = perspectiveHasLosses ? 'text-yellow-300' : 'text-green-400';
                    }
                }
            }
        }
    
        header.innerHTML = `
            <div>
                <h2 class="text-xl font-bold ${titleColorClass}">${title}</h2>
                <p class="text-xs text-gray-400">${date}</p>
            </div>
        `;
    }
    
    _renderMain(report) {
        const main = this.#panelElement.querySelector('#report-main');
        
        switch (report.type) {
            case 'settlement_success':
                main.innerHTML = this._renderSettlementReport(report);
                return;
            case 'espionage':
                main.innerHTML = this._renderEspionageReport(report);
                return;
            case 'espionage_defense':
                main.innerHTML = this._renderEspionageDefenseReport(report);
                return;
            case 'attack':
            case 'raid':
                let defenderHTML = '';
                if (report.defender && report.defender.contingents) {
                    report.defender.contingents.forEach((contingent) => {
                        defenderHTML += this._renderSide(contingent, 'Defensor');
                    });
                }
            
                main.innerHTML = `
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        ${this._renderSide(report.attacker, 'Atacante')}
                        ${defenderHTML}
                    </div>
                    ${this._renderLootSection(report)}
                    ${this._renderSiegeDamageSection(report)}
                    ${this._renderSummary(report.summary)}
                `;
                return;
            default:
                main.innerHTML = `<p class="text-center text-gray-400">Tipo de informe no reconocido.</p>`;
        }
    }

    _renderSettlementReport(report) {
        return `
            <div class="flex flex-col items-center text-center p-6">
                ${ICONS.settlement}
                <h3 class="text-2xl font-bold text-green-400 mt-4">¡Nueva Aldea Fundada!</h3>
                <p class="text-gray-300 mt-2">
                    Tus valientes colonos de <span class="font-semibold text-white">${report.originVillageName || 'una de tus aldeas'}</span> han establecido con éxito una nueva aldea.
                </p>
                <div class="mt-4 bg-gray-900/50 p-4 rounded-lg">
                    <p class="text-lg font-semibold text-yellow-300">${report.newVillageName} (${report.newVillageCoords.x}|${report.newVillageCoords.y})</p>
                </div>
                <p class="text-xs text-gray-500 mt-6">Ahora puedes cambiar a tu nueva aldea desde el menú desplegable en la parte superior de la pantalla.</p>
            </div>
        `;
    }
    
    _renderEspionageDefenseReport(report) {
        const attackerName = report.attacker.villageName || 'una aldea desconocida';
        let resultText = '';
        let colorClass = '';

        if (report.payload) {
            resultText = '¡Espionaje Exitoso! El enemigo ha obtenido información sobre tus recursos y tropas.';
            colorClass = 'text-red-400';
        } else {
            resultText = 'Tus defensas han detectado y repelido con éxito el intento de espionaje.';
            colorClass = 'text-green-400';
        }
    
        return `
            <div class="text-center p-4 bg-gray-900/30 rounded-lg">
                <h3 class="text-xl font-bold ${colorClass}">¡Intento de Espionaje!</h3>
                <p class="text-gray-300 mt-2">Has sido espiado por un jugador de ${attackerName}.</p>
                <p class="text-gray-300 mt-2">${resultText}</p>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                ${this._renderSide(report.attacker, 'Atacante')}
                ${this._renderSide(report.defender, 'Defensor')}
            </div>
        `;
    }

    _renderEspionageReport(report) {
        const { payload, defender } = report;
    
        if (!payload) {
            return `<div class="text-center p-6 bg-red-900/30 rounded-lg">
                        <h3 class="text-xl font-bold text-red-400">Espionaje Fallido</h3>
                        <p class="text-gray-300 mt-2">Tus espías fueron detectados y eliminados. No se ha obtenido información.</p>
                    </div>`;
        }
    
        let resourcesHTML = '';
        if (payload.resources) {
            resourcesHTML = `
                <div class="mb-4">
                    <h4 class="font-bold text-lg text-yellow-300 mb-2">Recursos</h4>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div class="flex items-center gap-2 p-2 bg-gray-900/50 rounded-md">${ICONS.wood} ${formatNumber(payload.resources.wood)}</div>
                        <div class="flex items-center gap-2 p-2 bg-gray-900/50 rounded-md">${ICONS.stone} ${formatNumber(payload.resources.stone)}</div>
                        <div class="flex items-center gap-2 p-2 bg-gray-900/50 rounded-md">${ICONS.iron} ${formatNumber(payload.resources.iron)}</div>
                        <div class="flex items-center gap-2 p-2 bg-gray-900/50 rounded-md">${ICONS.food} ${formatNumber(payload.resources.food)}</div>
                    </div>
                </div>`;
        }
    
        let buildingsHTML = '';
        if (payload.buildings) {
            buildingsHTML = `
                <div class="mb-4">
                    <h4 class="font-bold text-lg text-yellow-300 mb-2">Edificios</h4>
                    <div class="grid grid-cols-2 gap-2 text-sm">
                        <div class="p-2 bg-gray-900/50 rounded-md">Muralla: Nivel ${payload.buildings.wallLevel}</div>
                        <div class="p-2 bg-gray-900/50 rounded-md">Residencia/Palacio: Nivel ${payload.buildings.residenceLevel}</div>
                    </div>
                </div>`;
        }
    
        let troopsHTML = '';
        if (payload.troops && Object.keys(payload.troops).length > 0) {
            const title = defender.race === 'nature' ? 'Bestias en el Oasis' : 'Tropas en la Aldea';
            troopsHTML += `<h4 class="font-bold text-lg text-yellow-300 mb-2">${title}</h4><ul class="space-y-2">`;
            for (const unitId in payload.troops) {
                const count = payload.troops[unitId];
                if (count > 0) {
                    const race = defender.race || 'romans';
                    const unitData = gameData.units[race].troops.find(u => u.id === unitId);
                    if (unitData) {
                        troopsHTML += `
                            <li class="flex items-center p-2 bg-gray-900/50 rounded-md gap-4">
                                <div class="flex-shrink-0">${unitSpriteManager.getUnitSprite(unitId, race)}</div>
                                <div class="flex-grow font-semibold text-white">${unitData.name}</div>
                                <div class="font-mono text-lg text-cyan-300">${formatNumber(count)}</div>
                            </li>`;
                    }
                }
            }
            troopsHTML += `</ul>`;
        } else {
             troopsHTML = `<div class="text-center p-4 bg-gray-900/30 rounded-lg">
                            <p class="text-gray-300">No se han detectado tropas en el objetivo.</p>
                         </div>`;
        }
    
        return `<div>${resourcesHTML}${buildingsHTML}${troopsHTML}</div>`;
    }

    _renderSide(sideData, fallbackTitle) {
        let troopRows = '';
        const troopsToShow = new Set([...Object.keys(sideData.troops || {}), ...Object.keys(sideData.losses || {})]);

        if (sideData && sideData.race && troopsToShow.size > 0) {
            const raceData = gameData.units[sideData.race];
            if (raceData && raceData.troops) {
                const raceUnits = raceData.troops;
                troopRows = Array.from(troopsToShow)
                    .map(unitId => ({ unit: raceUnits.find(u => u.id === unitId), unitId }))
                    .filter(item => item.unit)
                    .map(({ unit, unitId }) => `
                        <tr class="border-b border-gray-700/50">
                            <td class="p-2 flex items-center gap-2">
                                ${unitSpriteManager.getUnitSprite(unit.id, sideData.race)}
                                <span>${unit.name}</span>
                            </td>
                            <td class="p-2 text-center font-mono">${formatNumber(sideData.troops ? (sideData.troops[unitId] || 0) : 0)}</td>
                            <td class="p-2 text-center font-mono text-red-400">${formatNumber(sideData.losses ? (sideData.losses[unitId] || 0) : 0)}</td>
                        </tr>
                    `).join('');
            }
        }

        let title;
        if (sideData.playerName === 'Naturaleza') {
            title = fallbackTitle;
        } else {
            title = `${fallbackTitle} de ${sideData.villageName || 'origen desconocido'}`;
        }

        return `
            <div class="bg-gray-900/50 p-3 rounded-lg">
                <h3 class="font-bold text-lg mb-2">${title}</h3>
                <table class="w-full text-sm">
                    <thead>
                        <tr class="text-left text-gray-400">
                            <th class="p-2">Unidad</th>
                            <th class="p-2 text-center">Cantidad</th>
                            <th class="p-2 text-center">Bajas</th>
                        </tr>
                    </thead>
                    <tbody>${troopRows}</tbody>
                </table>
            </div>
        `;
    }
    
    _renderLootSection(report) {
        if (!report || !report.plunder) return '';
        const totalPlunder = Object.values(report.plunder).reduce((a, b) => a + b, 0);
        const totalBounty = Object.values(report.bounty || {}).reduce((a, b) => a + b, 0);

        if (totalPlunder === 0 && totalBounty === 0) return '';

        let plunderHTML = '';
        if (totalPlunder > 0) {
            plunderHTML = `
                <div class="flex items-center gap-4">
                    <span class="font-semibold w-20">Saqueo:</span>
                    <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        <div class="flex items-center gap-1">${ICONS.wood} ${formatNumber(report.plunder.wood)}</div>
                        <div class="flex items-center gap-1">${ICONS.stone} ${formatNumber(report.plunder.stone)}</div>
                        <div class="flex items-center gap-1">${ICONS.iron} ${formatNumber(report.plunder.iron)}</div>
                        <div class="flex items-center gap-1">${ICONS.food} ${formatNumber(report.plunder.food)}</div>
                    </div>
                </div>`;
        }
        
        let bountyHTML = '';
        if (totalBounty > 0) {
            bountyHTML = `
                <div class="flex items-center gap-4">
                    <span class="font-semibold w-20">Botín:</span>
                    <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        <div class="flex items-center gap-1">${ICONS.wood} ${formatNumber(report.bounty.wood)}</div>
                        <div class="flex items-center gap-1">${ICONS.stone} ${formatNumber(report.bounty.stone)}</div>
                        <div class="flex items-center gap-1">${ICONS.iron} ${formatNumber(report.bounty.iron)}</div>
                        <div class="flex items-center gap-1">${ICONS.food} ${formatNumber(report.bounty.food)}</div>
                    </div>
                </div>`;
        }
        
        const totalCarried = totalPlunder + totalBounty;
        const capacity = report.attacker.carryCapacity || 0;

        return `
            <div class="mt-4 bg-gray-900/50 p-3 rounded-lg space-y-2">
                ${plunderHTML}
                ${bountyHTML}
                <div class="pt-2 border-t border-gray-700/50 flex items-center gap-4">
                     <span class="font-semibold w-20">Total:</span>
                     <div class="flex items-center gap-1 text-sm font-mono">
                        ${ICONS.capacity} ${formatNumber(totalCarried)} / ${formatNumber(capacity)}
                     </div>
                </div>
            </div>
        `;
    }

    _renderSiegeDamageSection(report) {
        const { wallDamage, buildingDamage } = report;
        if (!wallDamage && (!buildingDamage || buildingDamage.length === 0)) {
            return '';
        }

        let contentHTML = '';

        if (wallDamage) {
            if (wallDamage.error) {
                contentHTML += `<p class="text-red-400">${wallDamage.error}</p>`;
            } else if (wallDamage.damageDone) {
                contentHTML += `<p>Muralla dañada. Nivel ${wallDamage.initial} ➔ <span class="font-bold text-red-400">Nivel ${wallDamage.final}</span></p>`;
            } else {
                contentHTML += `<p>La Muralla no ha sido dañada.</p>`;
            }
        }

        if (buildingDamage && buildingDamage.length > 0) {
            buildingDamage.forEach(damage => {
                if (damage.error) {
                    contentHTML += `<p class="text-red-400">${damage.error}</p>`;
                } else if (damage.damageDone) {
                    contentHTML += `<p>${damage.name} dañado. Nivel ${damage.initial} ➔ <span class="font-bold text-red-400">Nivel ${damage.final}</span></p>`;
                } else {
                    contentHTML += `<p>${damage.name} no ha sido dañado.</p>`;
                }
            });
        }

        return `
            <div class="mt-4 bg-red-900/30 p-3 rounded-lg text-sm">
                <h4 class="font-bold text-lg text-orange-400 mb-2 flex items-center gap-2">${ICONS.siege} Información de Asedio</h4>
                <div class="space-y-1">${contentHTML}</div>
            </div>
        `;
    }

    _renderSummary(summary) {
        if (!summary) return '';
        const { attacker, defender } = summary;
        const renderLostResources = (resources) => Object.entries(resources)
            .map(([res, val]) => `<div class="flex items-center gap-1">${ICONS[res]} ${formatNumber(val)}</div>`).join('');

        return `
            <div class="mt-4 bg-gray-900/50 p-3 rounded-lg">
                <h3 class="font-bold text-lg mb-2">Resumen</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                        <h4 class="font-semibold text-gray-300 mb-2">Atacante</h4>
                        <div class="space-y-1">
                            <div class="flex justify-between"><span>Poder de Ataque:</span> <span class="font-mono flex items-center gap-1">${ICONS.sword} ${formatNumber(attacker.attackPower)}</span></div>
                            <div class="flex justify-between"><span>Consumo Tropas Perdidas:</span> <span class="font-mono flex items-center gap-1">${ICONS.food} ${formatNumber(attacker.lostUpkeep)}</span></div>
                            <div class="mt-2 pt-2 border-t border-gray-700/50">
                                <p class="text-gray-400">Recursos perdidos:</p>
                                <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs mt-1">${renderLostResources(attacker.lostResources)}</div>
                            </div>
                        </div>
                    </div>
                    <div>
                        <h4 class="font-semibold text-gray-300 mb-2">Defensor</h4>
                        <div class="space-y-1">
                            <div class="flex justify-between"><span>Poder de Defensa:</span> <span class="font-mono flex items-center gap-1">${ICONS.shield} ${formatNumber(defender.defensePower)}</span></div>
                            <div class="flex justify-between"><span>Consumo Tropas Perdidas:</span> <span class="font-mono flex items-center gap-1">${ICONS.food} ${formatNumber(defender.lostUpkeep)}</span></div>
                            <div class="mt-2 pt-2 border-t border-gray-700/50">
                                <p class="text-gray-400">Recursos perdidos:</p>
                                <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs mt-1">${renderLostResources(defender.lostResources)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

const battleReportUI = new BattleReportUI();
export default battleReportUI;
