class UIRenderScheduler {
    static instance;
    #components = new Map();
    #dirtyComponents = new Set();
    #latestGameState = null;
    #isRenderScheduled = false;

    constructor() {
        if (UIRenderScheduler.instance) {
            return UIRenderScheduler.instance;
        }
        UIRenderScheduler.instance = this;
    }

    init() {
        document.addEventListener('gamestate:refreshed', this.#handleGameStateUpdate.bind(this));
    }

    register(key, renderCallback) {
        if (typeof renderCallback !== 'function') {
            console.error(`[UIRenderScheduler] El callback para la clave "${key}" no es una función.`);
            return;
        }
        this.#components.set(key, renderCallback);
    }

    unregister(key) {
        this.#components.delete(key);
        this.#dirtyComponents.delete(key);
    }

    #handleGameStateUpdate(event) {
        this.#latestGameState = event.detail;
        
        for (const key of this.#components.keys()) {
            this.#dirtyComponents.add(key);
        }
        
        this.#scheduleRender();
    }

    #scheduleRender() {
        if (this.#isRenderScheduled) {
            return;
        }
        this.#isRenderScheduled = true;
        requestAnimationFrame(this.#renderLoop.bind(this));
    }

    #renderLoop() {
        if (this.#dirtyComponents.size === 0 || !this.#latestGameState) {
            this.#isRenderScheduled = false;
            return;
        }

        const componentsToUpdate = new Set(this.#dirtyComponents);
        this.#dirtyComponents.clear();

        for (const key of componentsToUpdate) {
            const renderCallback = this.#components.get(key);
            if (renderCallback) {
                try {
                    renderCallback(this.#latestGameState);
                } catch (error) {
                    console.error(`[UIRenderScheduler] Error al renderizar el componente "${key}":`, error);
                }
            }
        }

        this.#isRenderScheduled = false;
    }
}

const uiRenderScheduler = new UIRenderScheduler();
export default uiRenderScheduler;