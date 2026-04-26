import gameManager from '@game/state/GameManager.js';
import { router } from '@app/router.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import ActivityModalUI from './ActivityModalUI.js';
import {
    selectActiveVillageId,
    selectUnreadPlayerReports,
    selectVillageListSignature
} from './renderSelectors.js';

const DEV_MODE_AI_VIEW = true;

function getPerspectiveOwnerId(state) {
    const activeVillage = state?.villages?.find(village => village.id === state.activeVillageId);
    if (activeVillage?.ownerId) return activeVillage.ownerId;

    if (!state?.players) return 'player';

    const explicitPlayer = state.players.find(player => player.id === 'player');
    if (explicitPlayer) return explicitPlayer.id;

    const firstHuman = state.players.find(player => !String(player.id || '').startsWith('ai_'));
    return firstHuman?.id || 'player';
}

class UIMainManager {
    static instance;

    #villageSelector;
    #villageNameDisplay;
    #villageDropdown;
    #unreadBadge;
    #downloadLogButton;
    #configMenuButton;
    #mainNav;
    #activityModalUI;

    #isInitialized = false;
    #isDropdownOpen = false;
    #clickTimeout = null;
    #isRenaming = false;

    #boundFullscreenChange;

    constructor() {
        if (UIMainManager.instance) {
            return UIMainManager.instance;
        }
        UIMainManager.instance = this;
    }

    initialize() {
        if (this.#isInitialized) return;

        this.#villageSelector = document.getElementById('village-selector');
        this.#villageNameDisplay = document.getElementById('village-name-display');
        this.#villageDropdown = document.getElementById('village-dropdown');
        this.#unreadBadge = document.getElementById('unread-reports-badge');
        this.#downloadLogButton = document.getElementById('download-ai-log-btn');
        this.#configMenuButton = document.getElementById('open-config-menu-btn');
        this.#mainNav = document.getElementById('main-nav');

        if (!this.#villageSelector || !this.#unreadBadge || !this.#downloadLogButton || !this.#configMenuButton || !this.#mainNav) {
            console.error('[UIMainManager] No se pudieron encontrar los elementos esenciales de la UI.');
            return;
        }

        uiRenderScheduler.register('ui-main-manager', this.#handleGameStateUpdate.bind(this), [
            selectActiveVillageId,
            selectVillageListSignature,
            selectUnreadPlayerReports
        ]);
        document.addEventListener('ai_log_ready_for_download', this.#handleLogReadyForDownload.bind(this));
        
        this.#villageSelector.addEventListener('click', this.#toggleDropdown.bind(this));
        this.#configMenuButton.addEventListener('click', this.#handleConfigMenuClick.bind(this));
        this.#downloadLogButton.addEventListener('click', this.#handleFullscreenToggleClick.bind(this));
        document.addEventListener('click', this.#handleGlobalClick.bind(this));
        this.#boundFullscreenChange = this.#updateFullscreenButtonState.bind(this);
        document.addEventListener('fullscreenchange', this.#boundFullscreenChange);
        document.addEventListener('webkitfullscreenchange', this.#boundFullscreenChange);
        
        this.#mainNav.addEventListener('click', this.#handleNavLinkClick.bind(this));
        this.#activityModalUI = new ActivityModalUI();
        this.#updateFullscreenButtonState();

        this.#isInitialized = true;
    }

    #isFullscreenActive() {
        return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    }

    #requestFullscreen() {
        const root = document.documentElement;
        if (root.requestFullscreen) {
            return root.requestFullscreen();
        }
        if (root.webkitRequestFullscreen) {
            return root.webkitRequestFullscreen();
        }
        return null;
    }

    #exitFullscreen() {
        if (document.exitFullscreen) {
            return document.exitFullscreen();
        }
        if (document.webkitExitFullscreen) {
            return document.webkitExitFullscreen();
        }
        return null;
    }

    #updateFullscreenButtonState() {
        if (!this.#downloadLogButton) return;

        const isFullscreen = this.#isFullscreenActive();
        this.#downloadLogButton.classList.toggle('active', isFullscreen);
        this.#downloadLogButton.setAttribute('aria-label', isFullscreen ? 'Salir de pantalla completa' : 'Entrar en pantalla completa');
        this.#downloadLogButton.title = isFullscreen ? 'Salir de pantalla completa' : 'Entrar en pantalla completa';

        if (isFullscreen) {
            this.#downloadLogButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.9"><path stroke-linecap="round" stroke-linejoin="round" d="M9 4H5a1 1 0 00-1 1v4m16 0V5a1 1 0 00-1-1h-4m0 16h4a1 1 0 001-1v-4M4 15v4a1 1 0 001 1h4" /></svg><span>Salir</span>`;
            return;
        }

        this.#downloadLogButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.9"><path stroke-linecap="round" stroke-linejoin="round" d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4" /></svg><span>Pantalla</span>`;
    }

    async #handleFullscreenToggleClick() {
        try {
            if (this.#isFullscreenActive()) {
                await this.#exitFullscreen();
            } else {
                const requestResult = this.#requestFullscreen();
                if (requestResult && typeof requestResult.then === 'function') {
                    await requestResult;
                }
            }
        } catch (error) {
            console.warn('[UIMainManager] No se pudo alternar pantalla completa.', error);
        }

        this.#updateFullscreenButtonState();
    }

    #handleNavLinkClick(event) {
        const target = event.target.closest('a[data-route]');
        if (target) {
            event.preventDefault();
            const route = target.dataset.route;
            router.navigate(route);
            this.#mainNav.querySelectorAll('.nav-button').forEach(btn => {
                btn.classList.remove('active');
            });
            target.classList.add('active');
        }
    }

    #handleConfigMenuClick() {
        this.#closeDropdown();
        router.navigate('/config');
    }

    #handleGameStateUpdate(gameStatePayload) {
        const { state } = gameStatePayload;
        if (!state) return;

        if (!this.#isRenaming) {
            const activeVillage = state.villages.find(v => v.id === state.activeVillageId);
            if (activeVillage) {
                this.#villageNameDisplay.textContent = `${activeVillage.name} (${activeVillage.coords.x}|${activeVillage.coords.y})`;
            }
            this.#renderVillageList(state.villages, state.activeVillageId);
        }
        
        this.#updateUnreadBadge(state);
    }    

    #renderVillageList(villages, activeVillageId) {
        if (!this.#villageDropdown) return;
        
        this.#villageDropdown.innerHTML = '';

        villages.forEach(village => {
            if (!DEV_MODE_AI_VIEW && village.ownerId !== 'player') return;

            const li = document.createElement('li');
            li.className = `px-4 py-3 min-h-11 hover:bg-btn-secondary-bg/80 cursor-pointer z-500 text-sm flex justify-between items-center border-b border-primary-border/30 last:border-b-0 ${village.id === activeVillageId ? 'font-bold text-war-gold' : 'text-war-mist'}`;
            li.dataset.villageId = village.id;

            const nameSpan = document.createElement('span');
            nameSpan.textContent = `${village.name} (${village.coords.x}|${village.coords.y})`;
            li.appendChild(nameSpan);
            
            if (village.ownerId !== 'player') {
                const aiLabel = document.createElement('span');
                aiLabel.textContent = `[${village.ownerId}]`;
                aiLabel.className = 'text-xs text-orange-300 ml-2 z-500';
                li.appendChild(aiLabel);
            }

            li.addEventListener('click', (e) => {
                e.stopPropagation();
                clearTimeout(this.#clickTimeout);

                if (e.target.tagName === 'INPUT') return;

                this.#clickTimeout = setTimeout(() => {
                    gameManager.sendCommand('switch_village', { villageId: village.id });
                    this.#closeDropdown();
                }, 250);
            });

            li.addEventListener('dblclick', (e) => {
                if (village.ownerId !== 'player') return;
                e.stopPropagation();
                clearTimeout(this.#clickTimeout);
                this.#enableVillageRename(li, village);
            });

            this.#villageDropdown.appendChild(li);
        });
    }

    #enableVillageRename(listItem, village) {
        this.#isRenaming = true;
        const originalText = listItem.querySelector('span');
        originalText.style.display = 'none';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = village.name;
        input.className = 'bg-btn-secondary-bg text-war-mist w-full text-sm p-2 rounded-xl border border-primary-border';
        input.onclick = (e) => e.stopPropagation();

        listItem.appendChild(input);
        input.focus();
        input.select();

        const saveRename = () => {
            const newName = input.value.trim();
            if (newName && newName !== village.name) {
                gameManager.sendCommand('rename_village', { villageId: village.id, newName });
            }
            input.remove();
            originalText.style.display = 'block';
            this.#isRenaming = false;
            
            if (newName && newName !== village.name) {
                originalText.textContent = `${newName} (${village.coords.x}|${village.coords.y})`;
            }
        };

        input.addEventListener('blur', saveRename);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                input.blur();
            } else if (e.key === 'Escape') {
                input.value = village.name;
                input.blur();
            }
        });
    }

    #toggleDropdown(event) {
        event.stopPropagation();
        this.#isDropdownOpen = !this.#isDropdownOpen;
        if (this.#villageDropdown) {
            this.#villageDropdown.classList.toggle('hidden', !this.#isDropdownOpen);
        }
    }

    #closeDropdown() {
        if (this.#isDropdownOpen && this.#villageDropdown) {
            this.#isDropdownOpen = false;
            this.#villageDropdown.classList.add('hidden');
        }
    }

    #handleGlobalClick(event) {
        if (this.#isDropdownOpen && this.#villageSelector && !this.#villageSelector.contains(event.target)) {
            this.#closeDropdown();
        }
    }

    #updateUnreadBadge(state) {
        if (!this.#unreadBadge) return;
        const perspectiveOwnerId = getPerspectiveOwnerId(state);
        const count = state.unreadCounts?.[perspectiveOwnerId] || 0;
        if (count > 0) {
            this.#unreadBadge.textContent = count > 9 ? '9+' : count;
            this.#unreadBadge.classList.remove('hidden');
        } else {
            this.#unreadBadge.classList.add('hidden');
        }
    }
    
    #handleLogReadyForDownload(event) {
        const { logContent, aiId } = event.detail;
        this.#downloadTextFile(logContent, `ia_decision_log_${aiId}.txt`);
    }

    #downloadTextFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

const uiMainManager = new UIMainManager();
export default uiMainManager;
