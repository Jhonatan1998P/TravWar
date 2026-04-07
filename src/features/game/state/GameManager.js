import GameConfig from './GameConfig.js';
import appStore from '@shared/state/GlobalStore.js';
import GameWorker from './GameWorker.js?worker&inline';
import { perfCollector } from '@shared/lib/perf.js';

const STATE_STORAGE_KEY = 'game_state_v2';
const CONFIG_STORAGE_KEY = 'game_config';
const SESSION_ID_KEY = 'game_session_id';
const FORCE_NEW_GAME_SESSION_KEY = 'force_new_game_session';
const SAVE_STATE_DEBOUNCE_MS = 3000;
const DEBUG = false;

class GameManager {
    #worker;
    #config;
    #sessionId;
    #isInitialized = false;
    #persistTimerId = null;
    #pendingPersistState = null;
    #pendingPersistLastTick = null;
    #lastPersistedSerializedData = null;

    constructor() {
        if (GameManager.instance) {
            return GameManager.instance;
        }

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    this.#flushPendingStatePersist();
                }
            });
        }

        if (typeof window !== 'undefined') {
            window.addEventListener('pagehide', () => {
                this.#flushPendingStatePersist();
            });
        }

        GameManager.instance = this;
    }

    resetAndStart() {
        this.#flushPendingStatePersist();

        if (this.#worker) {
            this.#worker.terminate();
            this.#worker = null;
        }
        this.#isInitialized = false;
        appStore.getState().setGameInitialized(false);
        this.start();
    }

    start() {
        if (this.#isInitialized) {
            console.log("GameManager ya inicializado, solicitando último estado y reanudando.");
            this.sendCommand('get_latest_state');
            appStore.getState().setGameInitialized(true);
            document.dispatchEvent(new CustomEvent('game:resumed'));
            return;
        }

        if (!localStorage.getItem(CONFIG_STORAGE_KEY)) {
            console.log("No se encontró configuración de juego en localStorage.");
            appStore.getState().setLastError('no_config');
            document.dispatchEvent(new CustomEvent('game:access_denied', { detail: { reason: 'no_config' } }));
            return; 
        }
        
        if (!window.Worker) {
            console.error("Los Web Workers no son soportados por este navegador.");
            appStore.getState().setLastError('web_worker_not_supported');
            document.dispatchEvent(new CustomEvent('system:error', { 
                detail: "Tu navegador no soporta Web Workers. El juego no puede funcionar." 
            }));
            return;
        }
        
        this.#worker = new GameWorker();
        this.#config = new GameConfig();

        const forcedSessionId = sessionStorage.getItem(FORCE_NEW_GAME_SESSION_KEY);
        const savedRawData = localStorage.getItem(STATE_STORAGE_KEY);
        let savedState = null;

        this.#lastPersistedSerializedData = savedRawData || null;

        if (forcedSessionId) {
            console.log("Señal de reinicio forzado detectada. Creando nueva partida.");
            this.#sessionId = forcedSessionId;
            localStorage.removeItem(STATE_STORAGE_KEY);
            this.#lastPersistedSerializedData = null;
            sessionStorage.removeItem(FORCE_NEW_GAME_SESSION_KEY);
            savedState = null;
        } else if (savedRawData) {
            try {
                const parsedData = JSON.parse(atob(savedRawData));
                this.#sessionId = parsedData.sessionId; 
                savedState = parsedData;
                console.log("Loaded game state from localStorage. Session ID:", this.#sessionId);
            } catch (error) {
                console.error("Error al parsear el estado guardado. Forzando nueva partida.", error);
                localStorage.removeItem(STATE_STORAGE_KEY);
                this.#sessionId = Date.now().toString(36) + Math.random().toString(36).substring(2);
                savedState = null;
            }
        } else {
            console.log("No se encontró partida guardada ni señal de reinicio forzado.");
            appStore.getState().setLastError('no_saved_game_or_force_signal');
            document.dispatchEvent(new CustomEvent('game:access_denied', { detail: { reason: 'no_saved_game_or_force_signal' } }));
            return;
        }

        sessionStorage.setItem(SESSION_ID_KEY, this.#sessionId);
        appStore.getState().setSessionId(this.#sessionId);
        console.log("GameManager inicializando Web Worker con Session ID:", this.#sessionId);

        const initPayload = {
            config: this.#config.getSettings(),
            savedState: savedState,
            sessionId: this.#sessionId
        };
        
        this.sendCommand('init', initPayload);
        this.#worker.onmessage = this.#handleWorkerMessage.bind(this);
        this.#worker.onerror = this.#handleWorkerError.bind(this);
        this.#isInitialized = true;
    }

    #handleWorkerMessage(event) {
        if (!event.data) {
            console.warn("Mensaje vacío o malformado recibido del GameWorker.");
            return;
        }

        const { type, payload } = event.data;

        if (!type || !payload) {
             console.warn("Mensaje incompleto recibido del GameWorker.", { type, payload });
             return;
        }

        switch (type) {
            case 'gamestate:initialized':
                appStore.getState().setGameInitialized(true);
                this.#queueStatePersist(payload.state, payload.lastTick, { immediate: true });
                document.dispatchEvent(new CustomEvent('gamestate:initialized', { detail: payload }));
                document.dispatchEvent(new CustomEvent('gamestate:refreshed', { detail: payload }));
                break;
            
            case 'gamestate:updated':
                this.#queueStatePersist(payload.state, payload.lastTick);
                document.dispatchEvent(new CustomEvent('gamestate:refreshed', { detail: payload }));
                break;
            
            case 'worker:error':
                console.error("🔥 Error Reportado desde GameWorker:", payload.message);
                console.error("   --- Stack Trace del Worker ---");
                console.groupCollapsed("Click para ver el Stack Trace completo");
                console.error(payload.stack);
                console.groupEnd();
                appStore.getState().setLastError(payload.message || 'worker_error');
                document.dispatchEvent(new CustomEvent('system:error', { 
                    detail: "Error crítico en el motor del juego. Revisa la consola para más detalles." 
                }));
                break;

            case 'construction:finished':
                document.dispatchEvent(new CustomEvent('notify:construction_finished', { detail: payload }));
                break;

            case 'recruitment:finished':
                document.dispatchEvent(new CustomEvent('notify:recruitment_finished', { detail: payload }));
                break;

            case 'research:finished':
                document.dispatchEvent(new CustomEvent('notify:research_finished', { detail: payload }));
                break;

            case 'smithy:finished':
                document.dispatchEvent(new CustomEvent('notify:smithy_finished', { detail: payload }));
                break;

            case 'battle:report_ready':
                document.dispatchEvent(new CustomEvent('notify:battle_report', { detail: payload }));
                break;

            case 'ai_log_content':
                document.dispatchEvent(new CustomEvent('ai_log_ready_for_download', { detail: payload }));
                break;
        }
    }

    #handleWorkerError(error) {
        const diagnosticPayload = {
            errorType: error?.type || 'worker_error_event',
            message: error?.message || 'Unknown catastrophic worker error',
            filename: error?.filename || null,
            lineno: error?.lineno || null,
            colno: error?.colno || null,
            isTrusted: error?.isTrusted ?? null
        };

        console.error("🚨 Error Catastrófico en el Web Worker (posiblemente de carga o sintaxis inicial).");
        console.error("Este error indica que el Worker no pudo iniciarse o se rompió de forma irrecuperable.");
        console.error("Diagnóstico detallado del evento de error del Worker:", diagnosticPayload);
        console.dir(error);

        appStore.getState().setLastError(diagnosticPayload.message || 'catastrophic_worker_error');

        document.dispatchEvent(new CustomEvent('system:error', { 
            detail: "Error crítico en el motor del juego. Revisa la consola para más detalles." 
        }));
    }

    #queueStatePersist(state, lastTick, options = {}) {
        if (!state || !lastTick || state.sessionId !== this.#sessionId) {
            console.warn("Intento de guardado de estado con sessionId incorrecto. Abortando.", {
                stateSession: state?.sessionId,
                managerSession: this.#sessionId
            });
            return;
        }

        const { immediate = false } = options;

        this.#pendingPersistState = state;
        this.#pendingPersistLastTick = lastTick;
        perfCollector.incrementCounter('persist.queueUpdates');

        if (immediate) {
            this.#flushPendingStatePersist();
            return;
        }

        if (this.#persistTimerId !== null) {
            return;
        }

        this.#persistTimerId = setTimeout(() => {
            this.#persistTimerId = null;
            this.#flushPendingStatePersist();
        }, SAVE_STATE_DEBOUNCE_MS);

        perfCollector.observeGauge('persist.debounceMs', SAVE_STATE_DEBOUNCE_MS);
    }

    #flushPendingStatePersist() {
        if (this.#persistTimerId !== null) {
            clearTimeout(this.#persistTimerId);
            this.#persistTimerId = null;
        }

        const state = this.#pendingPersistState;
        const lastTick = this.#pendingPersistLastTick;

        this.#pendingPersistState = null;
        this.#pendingPersistLastTick = null;

        if (!state || !lastTick) {
            return;
        }

        if (state.sessionId !== this.#sessionId) {
            console.warn("Se omitio persistencia por sessionId inconsistente.", {
                stateSession: state.sessionId,
                managerSession: this.#sessionId
            });
            return;
        }

        const dataToStore = { ...state, lastTick };

        try {
            const serializeStart = performance.now();
            const serializedData = btoa(JSON.stringify(dataToStore));

            perfCollector.observeDuration('persist.serializeDuration', performance.now() - serializeStart);

            if (serializedData === this.#lastPersistedSerializedData) {
                perfCollector.incrementCounter('persist.skippedSamePayload');
                return;
            }

            const storageStart = performance.now();
            localStorage.setItem(STATE_STORAGE_KEY, serializedData);
            perfCollector.observeDuration('persist.storageWriteDuration', performance.now() - storageStart);

            this.#lastPersistedSerializedData = serializedData;
            perfCollector.incrementCounter('persist.writes');

            if (DEBUG) {
                console.log("Game state saved to localStorage. Session ID:", this.#sessionId);
                console.log("Saved data size:", serializedData.length, "bytes.");
            }
            } catch (e) {
            console.error("Error saving game state to localStorage:", e);
            perfCollector.incrementCounter('persist.errors');
        }
    }

    sendCommand(commandType, payload) {
        if (!this.#worker) {
            console.error("Worker no está inicializado, no se puede enviar el comando.");
            return;
        }
        this.#worker.postMessage({
            type: commandType,
            payload: payload
        });
    }
}

const gameManager = new GameManager();
export default gameManager;
