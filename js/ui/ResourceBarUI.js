import { formatNumber } from '../utils/formatters.js';

const ICON_PATHS = {
    wood: 'assets/icons/wood.png',
    clay: 'assets/icons/clay.png',
    iron: 'assets/icons/iron.png',
    wheat: 'assets/icons/wheat.png'
};

const RESOURCE_UI_MAP = {
    wood: { iconKey: 'wood', colorKey: 'wood' },
    stone: { iconKey: 'clay', colorKey: 'clay' },
    iron: { iconKey: 'iron', colorKey: 'iron' },
    food: { iconKey: 'wheat', colorKey: 'wheat' }
};

let uiElements = {};
let isInitialized = false;
let lastRenderedState = {};

function initialize(container, resources) {
    container.innerHTML = '';
    uiElements = {};
    lastRenderedState = {};

    for (const resName in resources) {
        const uiMap = RESOURCE_UI_MAP[resName];
        if (!uiMap) continue;

        const wrapper = document.createElement('div');
        wrapper.className = 'relative p-1.5 bg-glass-bg rounded-lg flex flex-col gap-1 resource-bar-item cursor-pointer border border-primary-border';
        
        const colorClass = `bg-resource-${uiMap.colorKey}`;
        
        wrapper.innerHTML = `
            <div class="flex items-center gap-1.5">
                <img src="${ICON_PATHS[uiMap.iconKey]}" alt="${uiMap.colorKey}" class="h-4 w-4">
                <span class="font-bold text-base" data-prop="current"></span>
            </div>
            <div class="w-full bg-primary-bg rounded-full h-1.5">
                <div class="${colorClass} h-1.5 rounded-full" data-prop="progress"></div>
            </div>
            
            <div class="resource-details hidden absolute top-full left-0 mt-1 p-2 bg-glass-bg rounded-lg shadow-lg w-32 z-20 border border-primary-border">
                 <div class="flex justify-between items-center text-gray-400 font-mono text-xs">
                    <span>Prod:</span>
                    <span class="font-semibold text-white" data-prop="production"></span>
                </div>
                <div class="flex justify-between items-center text-gray-400 font-mono text-xs">
                    <span>Cap:</span>
                    <span class="font-semibold text-white" data-prop="capacity"></span>
                </div>
            </div>`;
        container.appendChild(wrapper);
        
        wrapper.addEventListener('click', (e) => {
            e.stopPropagation();
            const detailsPanel = wrapper.querySelector('.resource-details');
            const isHidden = detailsPanel.classList.contains('hidden');

            document.querySelectorAll('.resource-details').forEach(panel => {
                panel.classList.add('hidden');
            });

            if (isHidden) {
                detailsPanel.classList.remove('hidden');
            }
        });

        uiElements[resName] = {
            current: wrapper.querySelector('[data-prop="current"]'),
            progress: wrapper.querySelector('[data-prop="progress"]'),
            production: wrapper.querySelector('[data-prop="production"]'),
            capacity: wrapper.querySelector('[data-prop="capacity"]')
        };
        lastRenderedState[resName] = { current: -1, production: -1, capacity: -1 };
    }

    if (!document.body.hasAttribute('data-resource-bar-listener')) {
        document.body.setAttribute('data-resource-bar-listener', 'true');
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.resource-bar-item')) {
                document.querySelectorAll('.resource-details').forEach(panel => {
                    panel.classList.add('hidden');
                });
            }
        });
    }

    isInitialized = true;
}

export function renderResourceBar(container, resources) {
    if (!container || !resources) return;
    if (!isInitialized) {
        initialize(container, resources);
    }

    for (const resName in resources) {
        if (!uiElements[resName]) continue;

        const resData = resources[resName];
        const elements = uiElements[resName];
        const lastState = lastRenderedState[resName];

        const currentAmount = Math.floor(resData.current);
        const production = resData.production;
        const capacity = resData.capacity;

        if (currentAmount !== lastState.current) {
            elements.current.textContent = formatNumber(currentAmount);
            const percentage = capacity > 0 ? (currentAmount / capacity) * 100 : 0;
            elements.progress.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
            lastState.current = currentAmount;
        }

        if (production !== lastState.production) {
            elements.production.textContent = `${production >= 0 ? '+' : ''}${formatNumber(production)}/hr`;
            lastState.production = production;
        }

        if (capacity !== lastState.capacity) {
            elements.capacity.textContent = formatNumber(capacity);
            lastState.capacity = capacity;
        }
    }
}