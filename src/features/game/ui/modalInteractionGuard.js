const DEFAULT_MODAL_GUARD_MS = 280;

export function markModalOpened() {
    return Date.now();
}

export function shouldIgnoreModalAction(openedAt, thresholdMs = DEFAULT_MODAL_GUARD_MS) {
    const safeOpenedAt = Number(openedAt);
    if (!Number.isFinite(safeOpenedAt) || safeOpenedAt <= 0) {
        return false;
    }

    const safeThreshold = Math.max(0, Number(thresholdMs) || DEFAULT_MODAL_GUARD_MS);
    return (Date.now() - safeOpenedAt) < safeThreshold;
}

export { DEFAULT_MODAL_GUARD_MS };
