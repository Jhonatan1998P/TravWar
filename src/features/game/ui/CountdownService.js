import { perfCollector } from '@shared/lib/perf.js';

const VISIBLE_TICK_MS = 1000;
const HIDDEN_TICK_MS = 3000;

class CountdownService {
    static instance;
    #entries = new Map();
    #intervalId = null;
    #currentTickMs = VISIBLE_TICK_MS;

    constructor() {
        if (CountdownService.instance) {
            return CountdownService.instance;
        }

        CountdownService.instance = this;

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.#handleVisibilityChange.bind(this));
        }
    }

    subscribe({ id, endTime, onTick, onComplete }) {
        if (!id || typeof onTick !== 'function') {
            return;
        }

        const countdownId = String(id);
        const safeEndTime = Number(endTime) || Date.now();

        this.#entries.set(countdownId, {
            endTime: safeEndTime,
            onTick,
            onComplete,
            lastReportedSeconds: null
        });

        this.#ensureRunning();
        this.#notifyEntry(countdownId, this.#entries.get(countdownId), Date.now(), true);
    }

    unsubscribe(id) {
        if (!id) return;

        const countdownId = String(id);
        if (this.#entries.delete(countdownId)) {
            perfCollector.incrementCounter('countdown.unsubscribe');
        }

        if (this.#entries.size === 0) {
            this.#stop();
        }
    }

    unsubscribeByPrefix(prefix) {
        if (!prefix) return;
        const normalizedPrefix = String(prefix);

        for (const key of this.#entries.keys()) {
            if (key.startsWith(normalizedPrefix)) {
                this.#entries.delete(key);
            }
        }

        if (this.#entries.size === 0) {
            this.#stop();
        }
    }

    #handleVisibilityChange() {
        const nextTickMs = document.visibilityState === 'hidden' ? HIDDEN_TICK_MS : VISIBLE_TICK_MS;
        if (nextTickMs === this.#currentTickMs) {
            return;
        }

        this.#currentTickMs = nextTickMs;
        perfCollector.observeGauge('countdown.tickMs', this.#currentTickMs);

        if (this.#entries.size === 0) {
            return;
        }

        this.#stop();
        this.#ensureRunning();
        this.#tick();
    }

    #ensureRunning() {
        if (this.#intervalId !== null) {
            return;
        }

        perfCollector.incrementCounter('countdown.timerStart');
        perfCollector.observeGauge('countdown.tickMs', this.#currentTickMs);

        this.#intervalId = setInterval(() => {
            this.#tick();
        }, this.#currentTickMs);
    }

    #stop() {
        if (this.#intervalId === null) {
            return;
        }

        clearInterval(this.#intervalId);
        this.#intervalId = null;
        perfCollector.incrementCounter('countdown.timerStop');
    }

    #tick() {
        const now = Date.now();
        perfCollector.observeGauge('countdown.activeSubscriptions', this.#entries.size);

        for (const [id, entry] of this.#entries.entries()) {
            this.#notifyEntry(id, entry, now, false);
        }

        if (this.#entries.size === 0) {
            this.#stop();
        }
    }

    #notifyEntry(id, entry, now, forceNotify) {
        if (!entry) return;

        const remainingSeconds = Math.max(0, Math.ceil((entry.endTime - now) / 1000));
        const shouldNotify = forceNotify || entry.lastReportedSeconds !== remainingSeconds;

        if (shouldNotify) {
            entry.lastReportedSeconds = remainingSeconds;
            entry.onTick(remainingSeconds);
            perfCollector.incrementCounter('countdown.tickNotifications');
        }

        if (remainingSeconds <= 0) {
            if (typeof entry.onComplete === 'function') {
                entry.onComplete();
            }
            this.#entries.delete(id);
            perfCollector.incrementCounter('countdown.completed');
        }
    }
}

const countdownService = new CountdownService();
export default countdownService;
