const CONFIG_STORAGE_KEY = 'game_config';
const SIGNATURE_SECRET = 'sglp_2024_!#';

class GameConfig {
    #gameSpeed;
    #troopSpeed;
    #tradeCapacityMultiplier;
    #playerRace;
    #aiCount;
    #aiRaces;
    #maxGameDays;
    #worldSeed;

    constructor() {
        this.#load();
    }

    #load() {
        const rawData = localStorage.getItem(CONFIG_STORAGE_KEY);
        if (!rawData) {
            this.#loadDefaults();
            return;
        }
        
        try {
            const decodedData = atob(rawData);
            const { payload, signature } = JSON.parse(decodedData);
            
            const expectedSignature = this.#createSignature(payload);

            if (signature !== expectedSignature) {
                this.#loadDefaults();
                return;
            }

            this.#applySettings(payload);

        } catch (error) {
            this.#loadDefaults();
        }
    }

    save() {
        const payload = this.getSettings();
        const signature = this.#createSignature(payload);
        const dataToStore = {
            payload,
            signature
        };
        const encodedData = btoa(JSON.stringify(dataToStore));
        localStorage.setItem(CONFIG_STORAGE_KEY, encodedData);
    }

    #createSignature(payload) {
        const dataString = JSON.stringify(payload) + SIGNATURE_SECRET;
        let hash = 0;
        for (let i = 0; i < dataString.length; i++) {
            const char = dataString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; 
        }
        return hash.toString();
    }

    #loadDefaults() {
        const defaults = {
            gameSpeed: 1,
            troopSpeed: 1,
            tradeCapacityMultiplier: 1,
            playerRace: 'gauls',
            aiCount: 1,
            aiRaces: ['germans', 'gauls', 'huns'],
            maxGameDays: 30,
            worldSeed: 'LOVE'
        };
        this.#applySettings(defaults);
    }

    #applySettings(settings) {
        this.#gameSpeed = settings.gameSpeed;
        this.#troopSpeed = settings.troopSpeed;
        this.#tradeCapacityMultiplier = settings.tradeCapacityMultiplier;
        this.#playerRace = settings.playerRace;
        this.#aiCount = settings.aiCount;
        this.#aiRaces = settings.aiRaces;
        this.#maxGameDays = settings.maxGameDays;
        this.#worldSeed = settings.worldSeed;
    }

    getSettings() {
        return {
            gameSpeed: this.#gameSpeed,
            troopSpeed: this.#troopSpeed,
            tradeCapacityMultiplier: this.#tradeCapacityMultiplier,
            playerRace: this.#playerRace,
            aiCount: this.#aiCount,
            aiRaces: this.#aiRaces,
            maxGameDays: this.#maxGameDays,
            worldSeed: this.#worldSeed,
        };
    }
    
    updateAndSave(newSettings) {
        this.#applySettings({ ...this.getSettings(), ...newSettings });
        this.save();
    }
}

export default GameConfig;