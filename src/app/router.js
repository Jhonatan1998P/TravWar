import gameManager from '@game/state/GameManager.js';
import { checkAccess } from './router-guard.js';
import appStore from '@shared/state/GlobalStore.js';
import uiMainManager from '@game/ui/UIMainManager.js';
import uiRenderScheduler from '@game/ui/UIRenderScheduler.js';
import { perfCollector } from '@shared/lib/perf.js';

let tooltipUILoadPromise = null;

async function ensureTooltipUILoaded() {
    if (!tooltipUILoadPromise) {
        tooltipUILoadPromise = import('@game/ui/TooltipUI.js');
    }

    return tooltipUILoadPromise;
}


class Router {
    #appRoot;
    #routes;
    #currentView = null;
    #isInitialized = false;
    #appHeader; 
    #appFooter; 
    #resourceBar; 
    #villageContainer; 
    #navigationRequestId = 0;

    constructor() {
        this.#appRoot = document.getElementById('app-root');
        this.#routes = {
            '/': () => import('@game/views/ConfigView.js').then(module => module.default),
            '/config': () => import('@game/views/ConfigView.js').then(module => module.default),
            '/village': () => import('@game/views/VillageView.js').then(module => module.default),
            '/village-center': () => import('@game/views/VillageCenterView.js').then(module => module.default),
            '/reports': () => import('@game/views/ReportsView.js').then(module => module.default),
            '/map': () => import('@game/views/MapView.js').then(module => module.default)
        };
    }

    init() {
        if (this.#isInitialized) return;

        const store = appStore.getState();
        store.setAppReady(false);
        store.setGameInitialized(false);
        store.setLastError(null);

        this.#appHeader = document.getElementById('app-header');
        this.#appFooter = document.getElementById('app-footer');
        this.#resourceBar = document.getElementById('resource-bar'); 
        this.#villageContainer = document.getElementById('village-container');

        uiMainManager.initialize();
        uiRenderScheduler.init();

        document.addEventListener('game:access_denied', (event) => {
            console.warn('Game access denied:', event.detail.reason);
            appStore.getState().setLastError(event.detail.reason);
            appStore.getState().setGameInitialized(false);
            this.navigate('/config', true); 
        });

        document.addEventListener('gamestate:initialized', (event) => {
            console.log('Game state initialized, navigating to /village');
            appStore.getState().setGameInitialized(true);
            this.navigate('/village', true); 
        });

        document.addEventListener('game:resumed', (event) => {
            console.log('Game resumed, navigating to /village');
            appStore.getState().setGameInitialized(true);
            this.navigate('/village', true);
        });

        window.addEventListener('popstate', () => {
            void this.#loadView(window.location.pathname);
        });

        const path = window.location.pathname;
        if (path === '/' || path === '/config') {
            this.navigate('/config', true);
        } else {
            const accessResult = checkAccess();
            if (accessResult.granted) {
                gameManager.start();
            } else {
                this.navigate('/config', true); 
            }
        }
        
        this.#isInitialized = true;
        store.setAppReady(true);
    }

    navigate(path, replace = false) {
        if (path === window.location.pathname && !replace) {
            return;
        }

        if (replace) {
            window.history.replaceState(null, '', path);
        } else {
            window.history.pushState(null, '', path);
        }
        void this.#loadView(path);
    }

    async #loadView(path) {
        const navigationRequestId = ++this.#navigationRequestId;
        const routeMetricKey = `route.${(path || 'unknown').replace(/\//g, '_') || 'root'}.load`;
        perfCollector.markStart(routeMetricKey);

        appStore.getState().setCurrentRoute(path);

        const loadViewClass = this.#routes[path];

        if (!loadViewClass) {
            console.error(`No route found for path: ${path}. Navigating to config.`);
            perfCollector.markEnd(routeMetricKey);
            this.navigate('/config', true);
            return;
        }

        if (this.#currentView && typeof this.#currentView.unmount === 'function') {
            this.#currentView.unmount();
        }

        this.#currentView = null;
        this.#appRoot.innerHTML = '<div class="h-full flex items-center justify-center text-sm text-gray-400">Cargando vista...</div>';

        let ViewClass;
        try {
            ViewClass = await loadViewClass();
        } catch (error) {
            console.error(`Error loading route ${path}:`, error);
            appStore.getState().setLastError('route_load_error');
            perfCollector.incrementCounter('router.routeLoadErrors');
            perfCollector.markEnd(routeMetricKey);

            if (path !== '/config') {
                this.navigate('/config', true);
            }
            return;
        }

        if (navigationRequestId !== this.#navigationRequestId) {
            perfCollector.markEnd(routeMetricKey);
            return;
        }

        if (path === '/village' || path === '/village-center') {
            await ensureTooltipUILoaded();
        }

        this.#currentView = new ViewClass();
        this.#appRoot.innerHTML = this.#currentView.html;
        
        if (typeof this.#currentView.mount === 'function') {
            this.#currentView.mount();
        }

        if (path === '/config') {
            this.#appHeader.classList.add('hidden');
            this.#appFooter.classList.add('hidden');
            this.#resourceBar.classList.add('hidden');
            this.#villageContainer.classList.remove('max-w-md');
            this.#villageContainer.classList.add('max-w-3xl');
        } else {
            this.#villageContainer.classList.remove('max-w-3xl');
            this.#villageContainer.classList.add('max-w-md');

            if (path === '/map' ) {
                this.#appHeader.classList.add('hidden');
                this.#resourceBar.classList.add('hidden');
            } else {
                this.#appHeader.classList.remove('hidden');
                this.#appFooter.classList.remove('hidden');
                this.#resourceBar.classList.remove('hidden'); 
            }
        }

        const navButtons = document.querySelectorAll('#main-nav .nav-button');
        navButtons.forEach(btn => {
            btn.classList.remove('active');
            const route = btn.dataset.route;
            if (route && path.startsWith(route)) { 
                btn.classList.add('active');
            }
        });

        perfCollector.markEnd(routeMetricKey);
    }
}

export const router = new Router();
document.addEventListener('DOMContentLoaded', () => router.init());
