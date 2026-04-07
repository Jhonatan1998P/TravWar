const PERF_DEBUG_STORAGE_KEY = 'ui_perf_debug';
const DEFAULT_REPORT_INTERVAL_MS = 10000;
const MAX_SAMPLES = 240;

function hasBrowserRuntime() {
    return typeof window !== 'undefined' && typeof performance !== 'undefined';
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function clampSamples(samples) {
    if (samples.length <= MAX_SAMPLES) {
        return samples;
    }
    return samples.slice(samples.length - MAX_SAMPLES);
}

function getSampleStats(samples) {
    if (!samples || samples.length === 0) {
        return { count: 0, avg: 0, min: 0, max: 0, p95: 0 };
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const count = sorted.length;
    const total = sorted.reduce((sum, item) => sum + item, 0);
    const p95Index = Math.min(count - 1, Math.max(0, Math.floor(count * 0.95) - 1));

    return {
        count,
        avg: total / count,
        min: sorted[0],
        max: sorted[count - 1],
        p95: sorted[p95Index]
    };
}

export function isPerfDebugEnabled() {
    if (!hasBrowserRuntime()) {
        return false;
    }

    if (window.__PERF_DEBUG__ === true) {
        return true;
    }

    try {
        return window.localStorage.getItem(PERF_DEBUG_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

class PerfCollector {
    #marks = new Map();
    #durations = new Map();
    #gauges = new Map();
    #counters = new Map();
    #longTaskObserver = null;
    #mutationObserver = null;
    #reportTimer = null;
    #fpsRafId = null;
    #fpsLastSecondTs = 0;
    #fpsFrames = 0;
    #fpsSamples = [];
    #longTaskSamples = [];
    #mutationTotals = {
        addedNodes: 0,
        removedNodes: 0,
        attributes: 0,
        characterData: 0,
        childList: 0
    };
    #isEnabled = false;

    enable(reportIntervalMs = DEFAULT_REPORT_INTERVAL_MS) {
        if (!hasBrowserRuntime() || this.#isEnabled || !isPerfDebugEnabled()) {
            return;
        }

        this.#isEnabled = true;
        this.#startLongTaskObserver();
        this.#startMutationObserver();
        this.#startFpsProbe();
        this.#startReporter(reportIntervalMs);
    }

    disable() {
        if (!this.#isEnabled) {
            return;
        }

        this.#isEnabled = false;

        if (this.#longTaskObserver) {
            this.#longTaskObserver.disconnect();
            this.#longTaskObserver = null;
        }

        if (this.#mutationObserver) {
            this.#mutationObserver.disconnect();
            this.#mutationObserver = null;
        }

        if (this.#reportTimer) {
            clearInterval(this.#reportTimer);
            this.#reportTimer = null;
        }

        if (this.#fpsRafId !== null) {
            cancelAnimationFrame(this.#fpsRafId);
            this.#fpsRafId = null;
        }
    }

    markStart(name) {
        if (!this.#isEnabled) {
            return;
        }
        this.#marks.set(name, performance.now());
    }

    markEnd(name, metricName = name) {
        if (!this.#isEnabled) {
            return 0;
        }

        const startedAt = this.#marks.get(name);
        if (startedAt === undefined) {
            return 0;
        }

        const durationMs = performance.now() - startedAt;
        this.#marks.delete(name);
        this.observeDuration(metricName, durationMs);
        return durationMs;
    }

    observeDuration(name, durationMs) {
        if (!this.#isEnabled) {
            return;
        }

        const value = Math.max(0, toNumber(durationMs));
        const samples = this.#durations.get(name) || [];
        samples.push(value);
        this.#durations.set(name, clampSamples(samples));
    }

    observeGauge(name, value) {
        if (!this.#isEnabled) {
            return;
        }

        const numeric = toNumber(value);
        const samples = this.#gauges.get(name) || [];
        samples.push(numeric);
        this.#gauges.set(name, clampSamples(samples));
    }

    incrementCounter(name, delta = 1) {
        if (!this.#isEnabled) {
            return;
        }

        const current = this.#counters.get(name) || 0;
        this.#counters.set(name, current + toNumber(delta));
    }

    getSnapshot() {
        const durations = {};
        for (const [name, samples] of this.#durations.entries()) {
            durations[name] = getSampleStats(samples);
        }

        const gauges = {};
        for (const [name, samples] of this.#gauges.entries()) {
            gauges[name] = getSampleStats(samples);
        }

        const fpsStats = getSampleStats(this.#fpsSamples);
        const longTaskStats = getSampleStats(this.#longTaskSamples);

        return {
            enabled: this.#isEnabled,
            counters: Object.fromEntries(this.#counters.entries()),
            durations,
            gauges,
            fps: fpsStats,
            longTasks: longTaskStats,
            mutations: { ...this.#mutationTotals },
            timestamp: new Date().toISOString()
        };
    }

    logSummary() {
        if (!this.#isEnabled) {
            return;
        }

        const snapshot = this.getSnapshot();

        const topDurationEntries = Object.entries(snapshot.durations)
            .sort((a, b) => b[1].avg - a[1].avg)
            .slice(0, 8)
            .map(([name, stats]) => ({
                metric: name,
                samples: stats.count,
                avg_ms: Number(stats.avg.toFixed(2)),
                p95_ms: Number(stats.p95.toFixed(2)),
                max_ms: Number(stats.max.toFixed(2))
            }));

        const topGaugeEntries = Object.entries(snapshot.gauges)
            .sort((a, b) => b[1].avg - a[1].avg)
            .slice(0, 6)
            .map(([name, stats]) => ({
                metric: name,
                samples: stats.count,
                avg: Number(stats.avg.toFixed(2)),
                p95: Number(stats.p95.toFixed(2)),
                max: Number(stats.max.toFixed(2))
            }));

        const overview = {
            fps_avg: Number(snapshot.fps.avg.toFixed(2)),
            fps_p95: Number(snapshot.fps.p95.toFixed(2)),
            longtask_count: snapshot.longTasks.count,
            longtask_avg_ms: Number(snapshot.longTasks.avg.toFixed(2)),
            longtask_p95_ms: Number(snapshot.longTasks.p95.toFixed(2)),
            mutations_added_nodes: snapshot.mutations.addedNodes,
            mutations_removed_nodes: snapshot.mutations.removedNodes,
            counters_total: Object.keys(snapshot.counters).length
        };

        console.groupCollapsed('[PERF] UI summary');
        console.table(overview);
        if (topDurationEntries.length > 0) {
            console.table(topDurationEntries);
        }
        if (topGaugeEntries.length > 0) {
            console.table(topGaugeEntries);
        }
        console.table(snapshot.counters);
        console.groupEnd();
    }

    #startReporter(reportIntervalMs) {
        if (this.#reportTimer) {
            clearInterval(this.#reportTimer);
        }

        this.#reportTimer = setInterval(() => {
            this.logSummary();
        }, Math.max(1000, toNumber(reportIntervalMs) || DEFAULT_REPORT_INTERVAL_MS));
    }

    #startLongTaskObserver() {
        if (typeof PerformanceObserver !== 'function') {
            return;
        }

        try {
            this.#longTaskObserver = new PerformanceObserver((entryList) => {
                for (const entry of entryList.getEntries()) {
                    this.#longTaskSamples.push(entry.duration);
                    this.#longTaskSamples = clampSamples(this.#longTaskSamples);
                }
            });

            this.#longTaskObserver.observe({ entryTypes: ['longtask'] });
        } catch {
            this.#longTaskObserver = null;
        }
    }

    #startMutationObserver() {
        if (typeof MutationObserver !== 'function' || !document?.body) {
            return;
        }

        this.#mutationObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    this.#mutationTotals.childList += 1;
                    this.#mutationTotals.addedNodes += mutation.addedNodes.length;
                    this.#mutationTotals.removedNodes += mutation.removedNodes.length;
                } else if (mutation.type === 'attributes') {
                    this.#mutationTotals.attributes += 1;
                } else if (mutation.type === 'characterData') {
                    this.#mutationTotals.characterData += 1;
                }
            }
        });

        this.#mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        });
    }

    #startFpsProbe() {
        const step = (timestamp) => {
            if (!this.#isEnabled) {
                return;
            }

            if (this.#fpsLastSecondTs === 0) {
                this.#fpsLastSecondTs = timestamp;
            }

            this.#fpsFrames += 1;
            const elapsed = timestamp - this.#fpsLastSecondTs;

            if (elapsed >= 1000) {
                const fps = (this.#fpsFrames * 1000) / elapsed;
                this.#fpsSamples.push(fps);
                this.#fpsSamples = clampSamples(this.#fpsSamples);

                this.#fpsFrames = 0;
                this.#fpsLastSecondTs = timestamp;
            }

            this.#fpsRafId = requestAnimationFrame(step);
        };

        this.#fpsRafId = requestAnimationFrame(step);
    }
}

export const perfCollector = new PerfCollector();

if (hasBrowserRuntime()) {
    window.__UI_PERF__ = perfCollector;
    window.__UI_PERF_SNAPSHOT__ = () => perfCollector.getSnapshot();
}

if (isPerfDebugEnabled()) {
    perfCollector.enable();
}

export function markStart(name) {
    perfCollector.markStart(name);
}

export function markEnd(name, metricName = name) {
    return perfCollector.markEnd(name, metricName);
}

export function measure(name, fn) {
    if (typeof fn !== 'function') {
        return undefined;
    }

    markStart(name);
    const result = fn();

    if (result && typeof result.then === 'function' && typeof result.finally === 'function') {
        return result.finally(() => {
            markEnd(name);
        });
    }

    markEnd(name);
    return result;
}
