import { generateLayout, generateVillageCenterLayout } from '../core/LayoutManager.js';
import buildingInfoUI from './BuildingInfoUI.js';
import { gameData } from '../core/GameData.js';

const typeToClassMap = {
    'woodcutter': 'bg-resource-wood',
    'clayPit': 'bg-resource-clay',
    'ironMine': 'bg-resource-iron',
    'cropland': 'bg-resource-wheat',
    'mainBuilding': 'bg-red-700',
    'rallyPoint': 'bg-purple-700',
    'empty': 'bg-gray-600',
    'cityWall': 'bg-gray-500',
    'warehouse': 'bg-orange-700',
    'granary': 'bg-yellow-700',
    'barracks': 'bg-red-500',
    'stable': 'bg-blue-500',
    'workshop': 'bg-indigo-500',
    'smithy': 'bg-gray-400',
    'marketplace': 'bg-green-500',
    'embassy': 'bg-pink-500',
    'cranny': 'bg-teal-700',
    'heroMansion': 'bg-amber-500',
    'hospital': 'bg-sky-500',
    'palace': 'bg-fuchsia-600',
    'tradeOffice': 'bg-lime-500',
    'greatBarracks': 'bg-red-600',
    'greatStable': 'bg-blue-600',
    'tournamentSquare': 'bg-cyan-500',
    'sawmill': 'bg-orange-900',
    'brickyard': 'bg-red-900',
    'ironFoundry': 'bg-stone-700',
    'grainMill': 'bg-yellow-800',
    'bakery': 'bg-yellow-600',
};

function getBuildingState(buildings, constructionQueue, id) {
    const queuedJob = constructionQueue.find(j => j.buildingId === id);
    if (queuedJob) {
        return { 
            level: queuedJob.targetLevel - 1, 
            type: queuedJob.buildingType,
            isUnderConstruction: true
        };
    }
    const existingBuilding = buildings.find(b => b.id === id);
    return existingBuilding 
        ? { ...existingBuilding, isUnderConstruction: false }
        : { level: 0, type: 'empty', isUnderConstruction: false };
}

export function initializeBuildingSlotClicks(container) {
    if (!container) return;

    container.addEventListener('click', (event) => {
        const slotElement = event.target.closest('.building-slot');
        if (!slotElement) return;

        const slotId = slotElement.dataset.slotId;
        if (slotId) {
            buildingInfoUI.show(slotId);
        }
    });
}

export function renderBuildingSlots(container, gameState) {
    if (!container || !gameState || container.offsetWidth === 0) return;

    const activeVillage = gameState.villages.find(v => v.id === gameState.activeVillageId);
    if (!activeVillage) return;

    const buildingsState = activeVillage.buildings;
    const constructionQueue = activeVillage.constructionQueue;
    const layout = generateLayout(activeVillage.villageType);
    let slotsHTML = '';
    const containerSize = container.offsetWidth;

    layout.forEach(slotLayout => {
        const state = getBuildingState(buildingsState, constructionQueue, slotLayout.id);
        const angleRad = (slotLayout.angle - 90) * (Math.PI / 180);
        const radiusInPixels = (containerSize / 2) * (slotLayout.radiusPercent / 100);
        const x = radiusInPixels * Math.cos(angleRad);
        const y = radiusInPixels * Math.sin(angleRad);
        const colorClass = typeToClassMap[state.type] || 'bg-blue-500';
        const buildingName = gameData.buildings[state.type]?.name || slotLayout.name;
        const tooltipText = `${buildingName} (Nivel ${state.level})`;
        const constructionClass = state.isUnderConstruction ? 'under-construction' : '';

        slotsHTML += `
            <div class="building-slot ${constructionClass}" data-slot-id="${slotLayout.id}" data-tooltip-text="${tooltipText}" style="transform: translate(-50%, -50%) translate(${x}px, ${y}px);">
                <div class="building-circle w-[52px] h-[52px] ${colorClass} border-royal-blue-border pointer-events-none">
                    <div class="building-level text-xs w-6 h-6">${state.level}</div>
                </div>
                <span class="text-[10px] font-semibold text-gray-300 mt-1.5">${buildingName}</span>
            </div>
        `;
    });
    
    container.innerHTML = slotsHTML;
}

export function renderVillageCenterSlots(container, gameState) {
    if (!container || !gameState || container.offsetWidth === 0) return;
    
    const activeVillage = gameState.villages.find(v => v.id === gameState.activeVillageId);
    if (!activeVillage) return;

    const buildingsState = activeVillage.buildings;
    const constructionQueue = activeVillage.constructionQueue;
    const layout = generateVillageCenterLayout();
    let slotsHTML = '';
    const containerSize = container.offsetWidth;

    layout.forEach(slotLayout => {
        const state = getBuildingState(buildingsState, constructionQueue, slotLayout.id);
        
        const angleRad = (slotLayout.angle - 90) * (Math.PI / 180);
        const radiusInPixels = (containerSize / 2) * (slotLayout.radiusPercent / 100);
        const x = radiusInPixels * Math.cos(angleRad);
        const y = radiusInPixels * Math.sin(angleRad);
        
        const colorClass = typeToClassMap[state.type] || 'bg-blue-500';
        const buildingName = gameData.buildings[state.type]?.name || 'Construir';
        const tooltipText = `${buildingName} (Nivel ${state.level})`;
        const constructionClass = state.isUnderConstruction ? 'under-construction' : '';
        
        slotsHTML += `
            <div class="building-slot ${constructionClass}" data-slot-id="${slotLayout.id}" data-tooltip-text="${tooltipText}" style="transform: translate(-50%, -50%) translate(${x}px, ${y}px);">
                <div class="building-circle ${colorClass} border-royal-blue-border pointer-events-none">
                    <div class="building-level">${state.level}</div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = slotsHTML;

    const wallSlot = document.querySelector('[data-slot-id="v_wall"]');
    if (wallSlot) {
        const wallState = getBuildingState(buildingsState, constructionQueue, 'v_wall');
        const wallName = gameData.buildings[wallState.type]?.name || 'Muralla';
        const wallTooltipText = `${wallName} (Nivel ${wallState.level})`;
        
        wallSlot.dataset.tooltipText = wallTooltipText;
        wallSlot.querySelector('.building-level').textContent = wallState.level;
        if (wallState.isUnderConstruction) {
            wallSlot.classList.add('under-construction');
        } else {
            wallSlot.classList.remove('under-construction');
        }
    }
}