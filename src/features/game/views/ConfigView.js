import GameConfig from '../state/GameConfig.js';
import { gameData } from '../core/GameData.js';
import gameManager from '@game/state/GameManager.js';
import { router } from '@app/router.js';

const STATE_STORAGE_KEY = 'game_state_v2';
const CONFIG_STORAGE_KEY = 'game_config';
const ACCESS_PASS_KEY = 'village_access_granted';
const FORCE_NEW_GAME_SESSION_KEY = 'force_new_game_session';

class ConfigView {
    #config;
    #form;
    #inputs = {};
    #valueDisplays = {};
    #hasExistingGame = false;
    #confirmDialog;
    #confirmCancelBtn;
    #confirmOverwriteBtn;
    #continueButtonContainer;
    #mainTitle;

    constructor() {
        this.#config = new GameConfig();
    }

    get html() {
        return `
            <div class="w-full max-w-3xl mx-auto p-4 md:p-6 lg:p-8">
                <div id="continue-game-container" class="hidden text-center border-b border-primary-border pb-8 mb-8">
                    <a href="#" id="continue-game-link" class="w-full md:w-auto inline-block bg-gradient-to-r from-war-blood via-btn-primary-bg to-war-ember hover:from-red-800 hover:to-orange-600 text-war-mist font-display font-bold py-4 px-8 rounded-2xl text-2xl transition-transform duration-200 hover:scale-[1.02] focus:outline-none focus:ring-4 focus:ring-war-gold/40 border border-war-gold/60 shadow-[0_0_28px_rgba(249,115,22,0.25)]">
                        Continuar Partida
                    </a>
                    <p class="text-gray-400 mt-3 text-sm">Se encontró una partida en curso.</p>
                </div>

                <header class="text-center mb-8">
                    <p class="text-xs uppercase tracking-[0.35em] text-war-gold/80 mb-3">Estrategia PBBG de guerra tribal</p>
                    <h1 id="main-title" class="text-4xl md:text-5xl font-display font-extrabold text-war-mist tracking-wide">Crea un Mundo Nuevo</h1>
                    <p class="text-stone-300 mt-3 max-w-2xl mx-auto">Forja tu linaje, elige enemigos y levanta una conquista sobre territorios hostiles.</p>
                </header>
                
                <div class="bg-glass-bg backdrop-blur-2xl rounded-[2rem] p-5 md:p-8 border border-primary-border shadow-2xl">
                    <form id="config-form" class="space-y-6">
                        
                        <fieldset class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                            <div>
                                <label for="player-race" class="text-war-mist font-semibold">Tu Raza</label>
                                <select id="player-race" class="mt-2 w-full bg-btn-secondary-bg border border-primary-border text-war-mist rounded-xl p-3 focus:ring-2 focus:ring-war-gold focus:border-war-gold">
                                </select>
                            </div>
                        </fieldset>

                        <fieldset class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6 border-t border-primary-border pt-6">
                            <div>
                                <label for="game-speed" class="flex justify-between text-war-mist font-semibold">Velocidad de Juego <span id="game-speed-value" class="font-mono text-war-gold">1x</span></label>
                                <input id="game-speed" type="range" min="10" max="5000" value="1" step="10" class="w-full h-2 bg-btn-secondary-bg rounded-lg appearance-none cursor-pointer accent-war-gold input-range">
                            </div>
                            <div>
                                <label for="troop-speed" class="flex justify-between text-war-mist font-semibold">Velocidad de Tropas <span id="troop-speed-value" class="font-mono text-war-gold">1x</span></label>
                                <input id="troop-speed" type="range" min="1" max="500" value="1" step="1" class="w-full h-2 bg-btn-secondary-bg rounded-lg appearance-none cursor-pointer accent-war-gold input-range">
                            </div>
                        </fieldset>

                        <fieldset class="border-t border-primary-border pt-6">
                            <legend class="text-war-mist font-semibold text-lg mb-2">Ajustes de Oponentes (IA)</legend>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                                <div>
                                    <label for="ai-count" class="flex justify-between text-war-mist font-semibold">Número de Oponentes <span id="ai-count-value" class="font-mono text-war-gold">3</span></label>
                                    <input id="ai-count" type="range" min="0" max="30" value="3" step="1" class="w-full h-2 bg-btn-secondary-bg rounded-lg appearance-none cursor-pointer accent-war-gold input-range">
                                </div>
                            </div>
                            <div id="ai-races-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6 mt-6">
                            </div>
                        </fieldset>
                        
                        <fieldset class="border-t border-primary-border pt-6">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                            <div>
                                <label for="world-seed" class="text-war-mist font-semibold">Semilla del Mundo (Opcional)</label>
                                <div class="flex mt-1">
                                    <input id="world-seed" type="text" placeholder="Mapa aleatorio" class="flex-grow bg-btn-secondary-bg border border-primary-border text-war-mist rounded-l-xl p-3 focus:ring-2 focus:ring-war-gold focus:border-war-gold font-mono">
                                    <button id="random-seed-btn" type="button" class="bg-btn-secondary-bg hover:bg-btn-secondary-hover text-war-mist font-bold py-2 px-4 rounded-r-xl border border-primary-border" aria-label="Generar semilla aleatoria">Aleatoria</button>
                                </div>
                            </div>
                            <div>
                                <label for="map-size" class="text-war-mist font-semibold">Tamaño de Mapa</label>
                                <select id="map-size" class="mt-1 w-full bg-btn-secondary-bg border border-primary-border text-war-mist rounded-xl p-3 focus:ring-2 focus:ring-war-gold focus:border-war-gold">
                                    <option value="25">Por defecto (-25 a 25)</option>
                                    <option value="35">Grande (-35 a 35)</option>
                                    <option value="50">Extra grande (-50 a 50)</option>
                                </select>
                                <p class="mt-1 text-xs text-gray-400">A mayor mapa, más oasis y más tierras raras distribuidas por semilla.</p>
                            </div>
                            </div>
                        </fieldset>

                        <div class="pt-6 border-t border-primary-border">
                            <button type="submit" class="w-full bg-gradient-to-r from-war-blood via-btn-primary-bg to-war-ember hover:from-red-800 hover:to-orange-600 text-war-mist font-display font-bold py-4 px-4 rounded-2xl text-xl transition-transform duration-200 hover:scale-[1.01] focus:outline-none focus:ring-4 focus:ring-war-gold/40 border border-war-gold/60 shadow-[0_0_24px_rgba(249,115,22,0.22)]">
                                Iniciar Nueva Conquista
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    mount() {
        this.#form = document.getElementById('config-form');
        this.#confirmDialog = document.getElementById('confirm-dialog');
        this.#confirmCancelBtn = document.getElementById('confirm-cancel');
        this.#confirmOverwriteBtn = document.getElementById('confirm-overwrite');
        this.#continueButtonContainer = document.getElementById('continue-game-container');
        this.#mainTitle = document.getElementById('main-title');
        
        this.#cacheDOMElements();
        this._populateRaceDropdowns();
        this._loadConfigIntoUI();
        this._checkForExistingGame();
        this._initializeEventListeners();
        this._updateAISelectors();
    }

    unmount() {
        if (this.#form) {
            this.#form.removeEventListener('submit', this._handleFormSubmit);
        }
        
        const continueLink = this.#continueButtonContainer ? this.#continueButtonContainer.querySelector('a') : null;
        if (continueLink) {
            continueLink.removeEventListener('click', this._handleContinueClick);
        }
        
        Object.values(this.#inputs).forEach(input => {
            if (input && input.type === 'range') {
                input.removeEventListener('input', this._updateAllValueDisplays);
            }
        });

        if(this.#inputs['ai-count']) {
            this.#inputs['ai-count'].removeEventListener('input', this._updateAISelectors);
        }

        if (this.#confirmCancelBtn) {
            this.#confirmCancelBtn.removeEventListener('click', this._handleConfirmCancelClick);
        }
        if (this.#confirmOverwriteBtn) {
            this.#confirmOverwriteBtn.removeEventListener('click', this._handleConfirmOverwriteClick);
        }
        
        const randomSeedBtn = document.getElementById('random-seed-btn');
        if (randomSeedBtn) {
            randomSeedBtn.removeEventListener('click', this._handleRandomSeedClick);
        }
    }

    #cacheDOMElements() {
        this.ids = [
            'game-speed', 'troop-speed', 'ai-count', 
            'player-race', 'world-seed', 'map-size'
        ];
        this.ids.forEach(id => {
            this.#inputs[id] = document.getElementById(id);
            this.#valueDisplays[id] = document.getElementById(`${id}-value`);
        });
    }
    
    _checkForExistingGame() {
        if (localStorage.getItem(STATE_STORAGE_KEY)) {
            this.#hasExistingGame = true;
            this.#continueButtonContainer.classList.remove('hidden');
            this.#mainTitle.textContent = 'O crea un Mundo Nuevo';
        }
    }

    _populateRaceDropdowns() {
        const playableRaces = Object.keys(gameData.units).filter(r => !['nature', 'natars'].includes(r));
        const playerRaceSelect = this.#inputs['player-race'];
        
        if (!playerRaceSelect) return;

        playerRaceSelect.innerHTML = '';
        playableRaces.forEach(raceKey => {
            const option = document.createElement('option');
            option.value = raceKey;
            option.textContent = gameData.units[raceKey].name;
            playerRaceSelect.appendChild(option);
        });
    }

    _loadConfigIntoUI() {
        const settings = this.#config.getSettings();
        for (const key in settings) {
            const inputId = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            if (this.#inputs[inputId]) {
                this.#inputs[inputId].value = settings[key];
            }
        }
        this._updateAllValueDisplays();
    }

    _initializeEventListeners() {
        this._handleFormSubmit = this._handleFormSubmit.bind(this);
        this._handleContinueClick = this._handleContinueClick.bind(this);
        this._updateAllValueDisplays = this._updateAllValueDisplays.bind(this);
        this._updateAISelectors = this._updateAISelectors.bind(this);
        this._handleConfirmCancelClick = () => this.#confirmDialog.classList.add('hidden');
        this._handleConfirmOverwriteClick = this._startNewGame.bind(this);
        this._handleRandomSeedClick = this._handleRandomSeedClick.bind(this);

        this.#form.addEventListener('submit', this._handleFormSubmit);
        
        const continueLink = this.#continueButtonContainer.querySelector('a');
        if (continueLink) {
            continueLink.addEventListener('click', this._handleContinueClick);
        }
        
        Object.values(this.#inputs).forEach(input => {
            if (input && input.type === 'range') {
                input.addEventListener('input', this._updateAllValueDisplays);
            }
        });

        if(this.#inputs['ai-count']) {
            this.#inputs['ai-count'].addEventListener('input', this._updateAISelectors);
        }

        this.#confirmCancelBtn.addEventListener('click', this._handleConfirmCancelClick);
        this.#confirmOverwriteBtn.addEventListener('click', this._handleConfirmOverwriteClick);

        const randomSeedBtn = document.getElementById('random-seed-btn');
        if (randomSeedBtn) {
            randomSeedBtn.addEventListener('click', this._handleRandomSeedClick);
        }
    }

    _handleRandomSeedClick() {
        if (this.#inputs['world-seed']) {
            this.#inputs['world-seed'].value = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
        }
    }
    
    _updateAISelectors() {
        const count = parseInt(this.#inputs['ai-count'].value, 10);
        const container = document.getElementById('ai-races-container');
        const existingSelections = Array.from(container.querySelectorAll('select')).map(select => select.value);
        const savedRaces = this.#config.getSettings().aiRaces || [];
        container.innerHTML = '';

        const playableRaces = Object.keys(gameData.units).filter(r => !['nature', 'natars'].includes(r));

        for (let i = 0; i < count; i++) {
            const div = document.createElement('div');
            const label = document.createElement('label');
            label.htmlFor = `ai-race-${i}`;
            label.className = "text-war-mist font-semibold mb-1 block";
            label.textContent = `Raza Oponente ${i + 1}`;
            
            const select = document.createElement('select');
            select.id = `ai-race-${i}`;
            select.className = "mt-1 w-full bg-btn-secondary-bg border border-primary-border text-war-mist rounded-xl p-3 focus:ring-2 focus:ring-war-gold focus:border-war-gold";
            const selectedRace = playableRaces.includes(existingSelections[i])
                ? existingSelections[i]
                : (playableRaces.includes(savedRaces[i]) ? savedRaces[i] : playableRaces[(i + 1) % playableRaces.length]);
            
            playableRaces.forEach(raceKey => {
                const option = document.createElement('option');
                option.value = raceKey;
                option.textContent = gameData.units[raceKey].name;
                if (raceKey === selectedRace) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
            
            div.appendChild(label);
            div.appendChild(select);
            container.appendChild(div);
        }
    }

    _updateAllValueDisplays() {
        if(this.#valueDisplays['game-speed']) this.#valueDisplays['game-speed'].textContent = `${this.#inputs['game-speed'].value}x`;
        if(this.#valueDisplays['troop-speed']) this.#valueDisplays['troop-speed'].textContent = `${this.#inputs['troop-speed'].value}x`;
        if(this.#valueDisplays['ai-count']) this.#valueDisplays['ai-count'].textContent = this.#inputs['ai-count'].value;
    }

    _handleFormSubmit(event) {
        event.preventDefault();
        if (this.#hasExistingGame) {
            this.#confirmDialog.classList.remove('hidden');
        } else {
            this._startNewGame();
        }
    }

    _handleContinueClick(e) {
        e.preventDefault();
        gameManager.start();
    }

    _startNewGame() {
        this.#confirmDialog.classList.add('hidden');

        const newSessionId = Date.now().toString(36) + Math.random().toString(36).substring(2);
        sessionStorage.setItem(FORCE_NEW_GAME_SESSION_KEY, newSessionId);

        const aiRaceSelectors = document.querySelectorAll('#ai-races-container select');
        const aiRaces = Array.from(aiRaceSelectors).map(select => select.value);

        const newSettings = {
            gameSpeed: parseFloat(this.#inputs['game-speed'].value),
            troopSpeed: parseFloat(this.#inputs['troop-speed'].value),
            tradeCapacityMultiplier: this.#config.getSettings().tradeCapacityMultiplier || 1,
            playerRace: this.#inputs['player-race'].value,
            aiCount: parseInt(this.#inputs['ai-count'].value, 10),
            aiRaces: aiRaces,
            worldSeed: this.#inputs['world-seed'].value || Date.now().toString(36),
            mapSize: parseInt(this.#inputs['map-size'].value, 10),
        };

        this.#config.updateAndSave(newSettings);

        sessionStorage.setItem(ACCESS_PASS_KEY, 'forced_new');
        
        // Delegate all state cleanup to GameManager to prevent race conditions
        gameManager.resetAndStart({ forceNew: true });
    }
}

export default ConfigView;
