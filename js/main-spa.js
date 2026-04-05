import gameManager from './GameManager.js';
import uiMainManager from './ui/UIMainManager.js';
import { checkAccess } from './router-guard.js';
import uiRenderScheduler from './ui/UIRenderScheduler.js';

import buildingInfoUI from './ui/BuildingInfoUI.js';
import attackPanelUI from './ui/AttackPanelUI.js';
import tradePanelUI from './ui/TradePanelUI.js';
import battleReportUI from './ui/BattleReportUI.js';
import toastUI from './ui/ToastUI.js';
import tooltipUI from './ui/TooltipUI.js'; 


import ConfigView from './views/ConfigView.js';
import VillageView from './views/VillageView.js';
import VillageCenterView from './views/VillageCenterView.js';
import ReportsView from './views/ReportsView.js';
import MapView from './views/MapView.js';
import AIEditorView from './views/AIEditorView.js';


class Router {
    #appRoot;
    #routes;
    #currentView = null;
    #isInitialized = false;
    #appHeader; 
    #appFooter; 
    #resourceBar; 
    #villageContainer; 

    constructor() {
        this.#appRoot = document.getElementById('app-root');
        this.#routes = {
            '/': ConfigView, 
            '/config': ConfigView,
            '/village': VillageView,
            '/village-center': VillageCenterView,
            '/reports': ReportsView,
            '/map': MapView,
            '/ai-editor': AIEditorView,
        };
    }

    init() {
        if (this.#isInitialized) return;

        this.#appHeader = document.getElementById('app-header');
        this.#appFooter = document.getElementById('app-footer');
        this.#resourceBar = document.getElementById('resource-bar'); 
        this.#villageContainer = document.getElementById('village-container');

        uiMainManager.initialize();
        uiRenderScheduler.init();
        
        buildingInfoUI; 
        attackPanelUI;
        tradePanelUI;
        battleReportUI;
        toastUI;
        tooltipUI; 

        document.addEventListener('game:access_denied', (event) => {
            console.warn('Game access denied:', event.detail.reason);
            this.navigate('/config', true); 
        });

        document.addEventListener('gamestate:initialized', (event) => {
            console.log('Game state initialized, navigating to /village');
            this.navigate('/village', true); 
        });

        document.addEventListener('game:resumed', (event) => {
            console.log('Game resumed, navigating to /village');
            this.navigate('/village', true);
        });

        window.addEventListener('popstate', () => this.#loadView(window.location.pathname));

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
        this.#loadView(path);
    }

    #loadView(path) {
        const ViewClass = this.#routes[path];

        if (!ViewClass) {
            console.error(`No route found for path: ${path}. Navigating to config.`);
            this.navigate('/config', true);
            return;
        }

        if (this.#currentView && typeof this.#currentView.unmount === 'function') {
            this.#currentView.unmount();
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

            if (path === '/ai-editor' || path === '/map' ) {
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
    }
}

export const router = new Router();
document.addEventListener('DOMContentLoaded', () => router.init());