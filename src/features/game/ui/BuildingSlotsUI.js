import { generateLayout, generateVillageCenterLayout } from '../core/LayoutManager.js';
import { gameData } from '../core/GameData.js';
import tooltipUI from './TooltipUI.js';

let buildingInfoUILoadPromise = null;
const MOBILE_TAP_CONFIRM_WINDOW_MS = 1400;
const SLOT_TAP_MAX_MOVEMENT_PX = 16;
const SLOT_TAP_MAX_DURATION_MS = 450;

let lastMobileTappedSlotId = null;
let lastMobileTapAt = 0;
const initializedContainers = new WeakSet();

function isCoarsePointerDevice() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

async function getBuildingInfoUI() {
    if (!buildingInfoUILoadPromise) {
        buildingInfoUILoadPromise = import('./BuildingInfoUI.js')
            .then(module => module.default);
    }

    return buildingInfoUILoadPromise;
}

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

const layoutCacheByVillageType = new Map();
const villageCenterLayout = generateVillageCenterLayout();
const renderStateByContainer = new WeakMap();

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

function getLayoutForVillageType(villageType) {
    const normalizedVillageType = villageType || '4-4-4-6';
    if (!layoutCacheByVillageType.has(normalizedVillageType)) {
        layoutCacheByVillageType.set(normalizedVillageType, generateLayout(normalizedVillageType));
    }
    return layoutCacheByVillageType.get(normalizedVillageType);
}

function getContainerRenderState(container, mode) {
    const previousState = renderStateByContainer.get(container);
    if (!previousState || previousState.mode !== mode) {
        const nextState = {
            mode,
            slots: new Map(),
        };
        renderStateByContainer.set(container, nextState);
        container.replaceChildren();
        return nextState;
    }

    return previousState;
}

function createSlotElement(slotId, options = {}) {
    const {
        circleSizeClass = '',
        labelClass = '',
        isWallSlot = false,
    } = options;

    const slotElement = document.createElement('div');
    slotElement.className = `building-slot${isWallSlot ? ' wall-slot' : ''}`;
    slotElement.dataset.slotId = slotId;

    const circleElement = document.createElement('div');
    circleElement.className = [
        'building-circle',
        'border-royal-blue-border',
        'pointer-events-none',
        circleSizeClass,
    ].filter(Boolean).join(' ');

    const levelElement = document.createElement('div');
    levelElement.className = 'building-level';
    circleElement.appendChild(levelElement);
    slotElement.appendChild(circleElement);

    let labelElement = null;
    if (labelClass) {
        labelElement = document.createElement('span');
        labelElement.className = labelClass;
        slotElement.appendChild(labelElement);
    }

    slotElement.__refs = {
        circleElement,
        levelElement,
        labelElement,
    };

    return slotElement;
}

function ensureSlotElement(containerState, slotId, options = {}) {
    let slotElement = containerState.slots.get(slotId);
    if (!slotElement) {
        slotElement = createSlotElement(slotId, options);
        containerState.slots.set(slotId, slotElement);
    }
    return slotElement;
}

function setSlotColorClass(slotElement, nextColorClass) {
    const refs = slotElement.__refs;
    if (!refs?.circleElement) return;

    const previousColorClass = slotElement.dataset.colorClass;
    if (previousColorClass && previousColorClass !== nextColorClass) {
        refs.circleElement.classList.remove(previousColorClass);
    }

    if (!refs.circleElement.classList.contains(nextColorClass)) {
        refs.circleElement.classList.add(nextColorClass);
    }

    slotElement.dataset.colorClass = nextColorClass;
}

function updateSlotElement(slotElement, nextState) {
    const refs = slotElement.__refs;
    if (!refs) return;

    const {
        tooltipText,
        transform,
        isUnderConstruction,
        colorClass,
        level,
        label,
    } = nextState;

    if (slotElement.dataset.tooltipText !== tooltipText) {
        slotElement.dataset.tooltipText = tooltipText;
    }

    if (slotElement.style.transform !== transform) {
        slotElement.style.transform = transform;
    }

    slotElement.classList.toggle('under-construction', Boolean(isUnderConstruction));
    setSlotColorClass(slotElement, colorClass);

    const levelText = String(level);
    if (refs.levelElement.textContent !== levelText) {
        refs.levelElement.textContent = levelText;
    }

    if (refs.labelElement && refs.labelElement.textContent !== String(label || '')) {
        refs.labelElement.textContent = String(label || '');
    }
}

function pruneUnusedSlotElements(containerState, seenSlotIds) {
    for (const [slotId, slotElement] of containerState.slots.entries()) {
        if (seenSlotIds.has(slotId)) continue;
        slotElement.remove();
        containerState.slots.delete(slotId);
    }
}

export function initializeBuildingSlotClicks(container) {
    if (!container || initializedContainers.has(container)) return;
    initializedContainers.add(container);

    const pointerTapStateById = new Map();

    const clearPressedState = slotElement => {
        if (!slotElement) return;
        slotElement.classList.remove('slot-pressed');
    };

    const activateSlot = async slotElement => {
        if (!slotElement) return;

        const slotId = slotElement.dataset.slotId;
        if (!slotId) return;

        const bypassTapConfirm = slotId === 'v_wall';

        if (isCoarsePointerDevice() && !bypassTapConfirm) {
            const now = Date.now();
            const isSecondTap = lastMobileTappedSlotId === slotId
                && (now - lastMobileTapAt) <= MOBILE_TAP_CONFIRM_WINDOW_MS;

            if (!isSecondTap) {
                lastMobileTappedSlotId = slotId;
                lastMobileTapAt = now;
                tooltipUI.showForElement(slotElement, MOBILE_TAP_CONFIRM_WINDOW_MS);
                return;
            }
        }

        const buildingInfoUI = await getBuildingInfoUI();
        buildingInfoUI.show(slotId);

        lastMobileTappedSlotId = null;
        lastMobileTapAt = 0;
    };

    container.addEventListener('pointerdown', event => {
        const slotElement = event.target.closest('.building-slot');
        if (!slotElement) return;

        pointerTapStateById.set(event.pointerId, {
            slotElement,
            startX: event.clientX,
            startY: event.clientY,
            startedAt: Date.now(),
        });

        slotElement.classList.add('slot-pressed');
    });

    container.addEventListener('pointerup', event => {
        const tapState = pointerTapStateById.get(event.pointerId);
        pointerTapStateById.delete(event.pointerId);
        if (!tapState) return;

        const { slotElement, startX, startY, startedAt } = tapState;
        clearPressedState(slotElement);

        const movedDistance = Math.hypot(event.clientX - startX, event.clientY - startY);
        const elapsed = Date.now() - startedAt;
        const isTap = movedDistance <= SLOT_TAP_MAX_MOVEMENT_PX && elapsed <= SLOT_TAP_MAX_DURATION_MS;
        if (!isTap) return;

        if (event.pointerType === 'touch') {
            event.preventDefault();
        }

        void activateSlot(slotElement);
    });

    const cancelPointer = event => {
        const tapState = pointerTapStateById.get(event.pointerId);
        pointerTapStateById.delete(event.pointerId);
        if (!tapState) return;
        clearPressedState(tapState.slotElement);
    };

    container.addEventListener('pointercancel', cancelPointer);
    container.addEventListener('pointerleave', cancelPointer);

    container.addEventListener('click', event => {
        if (typeof window !== 'undefined' && window.PointerEvent) return;
        if (isCoarsePointerDevice()) return;
        const slotElement = event.target.closest('.building-slot');
        if (!slotElement) return;
        void activateSlot(slotElement);
    });
}

export function renderBuildingSlots(container, gameState) {
    if (!container || !gameState || container.offsetWidth === 0) return;

    const activeVillage = gameState.villages.find(v => v.id === gameState.activeVillageId);
    if (!activeVillage) return;

    const buildingsState = activeVillage.buildings;
    const constructionQueue = activeVillage.constructionQueue;
    const layout = getLayoutForVillageType(activeVillage.villageType);
    const containerSize = container.offsetWidth;
    const renderState = getContainerRenderState(container, 'resource');
    const seenSlotIds = new Set();

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

        const slotElement = ensureSlotElement(renderState, slotLayout.id, {
            circleSizeClass: 'w-[52px] h-[52px]',
            labelClass: 'text-[10px] font-semibold text-gray-300 mt-1.5',
        });

        updateSlotElement(slotElement, {
            tooltipText,
            transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
            isUnderConstruction: Boolean(constructionClass),
            colorClass,
            level: state.level,
            label: buildingName,
        });

        container.appendChild(slotElement);
        seenSlotIds.add(slotLayout.id);
    });

    pruneUnusedSlotElements(renderState, seenSlotIds);
}

export function renderVillageCenterSlots(container, gameState) {
    if (!container || !gameState || container.offsetWidth === 0) return;
    
    const activeVillage = gameState.villages.find(v => v.id === gameState.activeVillageId);
    if (!activeVillage) return;

    const buildingsState = activeVillage.buildings;
    const constructionQueue = activeVillage.constructionQueue;
    const layout = villageCenterLayout;
    const containerSize = container.offsetWidth;
    const nonWallSlotYOffsetPx = -15;
    const renderState = getContainerRenderState(container, 'village-center');
    const seenSlotIds = new Set();

    layout.forEach(slotLayout => {
        const state = getBuildingState(buildingsState, constructionQueue, slotLayout.id);
        
        const angleRad = (slotLayout.angle - 90) * (Math.PI / 180);
        const radiusInPixels = (containerSize / 2) * (slotLayout.radiusPercent / 100);
        const x = radiusInPixels * Math.cos(angleRad);
        const y = radiusInPixels * Math.sin(angleRad) + nonWallSlotYOffsetPx;
        
        const colorClass = typeToClassMap[state.type] || 'bg-blue-500';
        const buildingName = gameData.buildings[state.type]?.name || 'Construir';
        const tooltipText = `${buildingName} (Nivel ${state.level})`;
        const constructionClass = state.isUnderConstruction ? 'under-construction' : '';
        
        const slotElement = ensureSlotElement(renderState, slotLayout.id);

        updateSlotElement(slotElement, {
            tooltipText,
            transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
            isUnderConstruction: Boolean(constructionClass),
            colorClass,
            level: state.level,
            label: '',
        });

        container.appendChild(slotElement);
        seenSlotIds.add(slotLayout.id);
    });

    const wallState = getBuildingState(buildingsState, constructionQueue, 'v_wall');
    const wallName = gameData.buildings[wallState.type]?.name || 'Muralla';
    const wallTooltipText = `${wallName} (Nivel ${wallState.level})`;
    const wallConstructionClass = wallState.isUnderConstruction ? 'under-construction' : '';
    const wallColorClass = typeToClassMap[wallState.type] || typeToClassMap.cityWall || 'bg-gray-500';
    const wallBottomOffset = Math.floor(Math.max(18, containerSize * 0.06) * 1.5);
    const wallYOffset = Math.floor((containerSize / 2) + wallBottomOffset);

    const wallSlotElement = ensureSlotElement(renderState, 'v_wall', {
        isWallSlot: true,
        circleSizeClass: 'w-[54px] h-[54px]',
        labelClass: 'text-[10px] font-semibold text-gray-300 mt-1',
    });

    updateSlotElement(wallSlotElement, {
        tooltipText: wallTooltipText,
        transform: `translate(-50%, -50%) translate(0px, ${wallYOffset}px)`,
        isUnderConstruction: Boolean(wallConstructionClass),
        colorClass: wallColorClass,
        level: wallState.level,
        label: wallName,
    });

    container.appendChild(wallSlotElement);
    seenSlotIds.add('v_wall');

    pruneUnusedSlotElements(renderState, seenSlotIds);
}
