import '@styles/main.css';
import './router.js';

const interactiveSelector = 'input, textarea, select, [contenteditable="true"]';
let viewportUpdateFrame = null;

function isEditingText() {
    return Boolean(document.activeElement?.matches?.(interactiveSelector));
}

function setStableViewportHeight({ force = false } = {}) {
    if (!force && isEditingText()) return;

    document.documentElement.style.setProperty('--app-viewport-height', `${window.innerHeight}px`);
}

function scheduleStableViewportHeightUpdate(options) {
    if (viewportUpdateFrame) {
        cancelAnimationFrame(viewportUpdateFrame);
    }

    viewportUpdateFrame = requestAnimationFrame(() => {
        viewportUpdateFrame = null;
        setStableViewportHeight(options);
    });
}

setStableViewportHeight({ force: true });
window.addEventListener('resize', () => scheduleStableViewportHeightUpdate(), { passive: true });
window.addEventListener('orientationchange', () => {
    window.setTimeout(() => scheduleStableViewportHeightUpdate({ force: true }), 250);
}, { passive: true });
document.addEventListener('focusout', () => {
    window.setTimeout(() => scheduleStableViewportHeightUpdate({ force: true }), 80);
});
