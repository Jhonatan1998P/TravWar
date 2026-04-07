import { perfCollector } from '@shared/lib/perf.js';

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
        perfCollector.enable();
        document.addEventListener('gamestate:refreshed', this.#handleGameStateUpdate.bind(this));
    }

    register(key, renderCallback, selectors = []) {
        if (typeof renderCallback !== 'function') {
            console.error(`[UIRenderScheduler] El callback para la clave "${key}" no es una función.`);
            return;
        }

        const normalizedSelectors = Array.isArray(selectors)
            ? selectors.filter(selector => typeof selector === 'function')
            : [];

        this.#components.set(key, {
            renderCallback,
            selectors: normalizedSelectors,
            lastSelectorValues: null
        });
    }

    unregister(key) {
        this.#components.delete(key);
        this.#dirtyComponents.delete(key);
    }

    #handleGameStateUpdate(event) {
        this.#latestGameState = event.detail;

        perfCollector.incrementCounter('scheduler.gamestateEvents');

        let skippedComponents = 0;
        let dirtyComponents = 0;
        
        for (const [key, component] of this.#components.entries()) {
            if (this.#isComponentDirty(component, this.#latestGameState, key)) {
                this.#dirtyComponents.add(key);
                dirtyComponents += 1;
            } else {
                skippedComponents += 1;
            }
        }

        perfCollector.observeGauge('scheduler.dirtyComponentsPerUpdate', this.#dirtyComponents.size);
        perfCollector.observeGauge('scheduler.skippedComponentsPerUpdate', skippedComponents);
        perfCollector.observeGauge('scheduler.dirtyComponentsEvaluatedPerUpdate', dirtyComponents);
        
        this.#scheduleRender();
    }

    #isComponentDirty(component, gameStatePayload, componentKey) {
        const selectors = component.selectors;
        if (!selectors || selectors.length === 0) {
            return true;
        }

        const nextSelectorValues = [];
        for (const selector of selectors) {
            try {
                nextSelectorValues.push(selector(gameStatePayload));
            } catch (error) {
                console.error(`[UIRenderScheduler] Error en selector del componente "${componentKey}":`, error);
                perfCollector.incrementCounter('scheduler.selectorErrors');
                return true;
            }
        }

        const previousSelectorValues = component.lastSelectorValues;
        component.lastSelectorValues = nextSelectorValues;

        if (!previousSelectorValues) {
            perfCollector.incrementCounter('scheduler.selective.firstRender');
            return true;
        }

        if (previousSelectorValues.length !== nextSelectorValues.length) {
            perfCollector.incrementCounter('scheduler.selective.changed');
            return true;
        }

        for (let index = 0; index < nextSelectorValues.length; index += 1) {
            if (!Object.is(previousSelectorValues[index], nextSelectorValues[index])) {
                perfCollector.incrementCounter('scheduler.selective.changed');
                return true;
            }
        }

        perfCollector.incrementCounter('scheduler.selective.skipped');
        return false;
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

        const frameStart = performance.now();
        perfCollector.incrementCounter('scheduler.frames');

        const componentsToUpdate = new Set(this.#dirtyComponents);
        this.#dirtyComponents.clear();
        perfCollector.observeGauge('scheduler.componentsPerFrame', componentsToUpdate.size);

        for (const key of componentsToUpdate) {
            const component = this.#components.get(key);
            const renderCallback = component?.renderCallback;
            if (renderCallback) {
                try {
                    const renderStartedAt = performance.now();
                    renderCallback(this.#latestGameState);
                    perfCollector.observeDuration(`render.${key}`, performance.now() - renderStartedAt);
                    perfCollector.incrementCounter('scheduler.renderedComponents');
                } catch (error) {
                    console.error(`[UIRenderScheduler] Error al renderizar el componente "${key}":`, error);
                    perfCollector.incrementCounter('scheduler.renderErrors');
                }
            }
        }

        perfCollector.observeDuration('scheduler.frameRenderDuration', performance.now() - frameStart);

        this.#isRenderScheduled = false;
    }
}

const uiRenderScheduler = new UIRenderScheduler();
export default uiRenderScheduler;
