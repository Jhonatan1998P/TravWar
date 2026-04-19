import gameManager from '@game/state/GameManager.js';
import { router } from '@app/router.js';
import uiRenderScheduler from './UIRenderScheduler.js';
import {
    selectActiveVillageId,
    selectUnreadPlayerReports,
    selectVillageListSignature
} from './renderSelectors.js';

const DEV_MODE_AI_VIEW = true;

function getPerspectiveOwnerId(state) {
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
    #mainNav;

    #isInitialized = false;
    #isDropdownOpen = false;
    #clickTimeout = null;
    #isRenaming = false;

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
        this.#mainNav = document.getElementById('main-nav');

        if (!this.#villageSelector || !this.#unreadBadge || !this.#downloadLogButton || !this.#mainNav) {
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
        this.#downloadLogButton.addEventListener('click', this.#handleDownloadLogClick.bind(this));
        document.addEventListener('click', this.#handleGlobalClick.bind(this));
        
        this.#mainNav.addEventListener('click', this.#handleNavLinkClick.bind(this));

        this.#isInitialized = true;
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
            li.className = `px-4 py-2 hover:bg-glass-bg/80 cursor-pointer z-500 text-sm flex justify-between items-center ${village.id === activeVillageId ? 'font-bold text-yellow-300' : 'text-white'}`;
            li.dataset.villageId = village.id;

            const nameSpan = document.createElement('span');
            nameSpan.textContent = `${village.name} (${village.coords.x}|${village.coords.y})`;
            li.appendChild(nameSpan);
            
            if (village.ownerId !== 'player') {
                const aiLabel = document.createElement('span');
                aiLabel.textContent = `[${village.ownerId}]`;
                aiLabel.className = 'text-xs text-cyan-400 ml-2 z-500';
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
        input.className = 'bg-btn-secondary-bg text-white w-full text-sm p-1 rounded border border-primary-border';
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
    
    #handleDownloadLogClick() {
        const firstAiId = 'ai_0';
        gameManager.sendCommand('download_ai_log', { aiId: firstAiId });
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
