class TooltipUI {
    #tooltipElement;
    #container;
    #hideTimeoutId = null;

    constructor(containerId = 'village-container') { // Default to global container
        this.#container = document.getElementById(containerId);
        this.#tooltipElement = document.getElementById('building-tooltip');

        if (!this.#container || !this.#tooltipElement) {
            console.error('[TooltipUI] No se encontraron el contenedor o el elemento del tooltip.');
            return;
        }

        this._handleMouseOver = this._handleMouseOver.bind(this);
        this._handleMouseLeave = this._handleMouseLeave.bind(this);
        this._initializeEventListeners();
    }

    _initializeEventListeners() {
        this.#container.addEventListener('mouseover', this._handleMouseOver);
        this.#container.addEventListener('mouseleave', this._handleMouseLeave);
    }

    unmount() {
        // This unmount is primarily for consistency, but for a global tooltip,
        // listeners might only be removed on full page unload.
        this.#container.removeEventListener('mouseover', this._handleMouseOver);
        this.#container.removeEventListener('mouseleave', this._handleMouseLeave);
        clearTimeout(this.#hideTimeoutId);
        this.hide();
    }

    _handleMouseOver(event) {
        clearTimeout(this.#hideTimeoutId);

        const target = event.target.closest('[data-tooltip-text]');
        if (!target) return;

        this.showForElement(target);
    }

    _handleMouseLeave() {
        clearTimeout(this.#hideTimeoutId);
        this.hide();
    }

    hide() {
        this.#tooltipElement.classList.add('opacity-0'); // Add opacity for fade out
        this.#tooltipElement.addEventListener('transitionend', () => {
            if (this.#tooltipElement.classList.contains('opacity-0')) {
                this.#tooltipElement.classList.add('hidden'); // Hide after fade out
            }
        }, { once: true });
    }

    showForElement(targetElement, durationMs = 3000) {
        if (!targetElement) return;
        const text = targetElement.dataset?.tooltipText;
        if (!text) return;

        clearTimeout(this.#hideTimeoutId);
        this.#tooltipElement.textContent = text;
        this._positionTooltip();
        this.#tooltipElement.classList.remove('hidden');

        this.#hideTimeoutId = setTimeout(() => {
            this.hide();
        }, Math.max(300, Number(durationMs) || 3000));
    }

    _positionTooltip() {
        const resourceBar = document.getElementById('resource-bar');
        if (!resourceBar) return;

        const containerRect = this.#container.getBoundingClientRect();
        const resourceBarRect = resourceBar.getBoundingClientRect();

        this.#tooltipElement.classList.remove('hidden', 'opacity-0'); // Show and prepare for fade in
        const tooltipRect = this.#tooltipElement.getBoundingClientRect();

        // Position relative to the resource bar, but within the main container
        const top = (resourceBarRect.bottom - containerRect.top) + 23;
        
        let left = (resourceBarRect.left - containerRect.left) + (resourceBarRect.width / 2) - (tooltipRect.width / 2);

        // Clamp to container boundaries
        if (left < 4) {
            left = 4;
        }
        if (left + tooltipRect.width > containerRect.width) {
            left = containerRect.width - tooltipRect.width - 4;
        }

        this.#tooltipElement.style.top = `${top}px`;
        this.#tooltipElement.style.left = `${left}px`;
    }
}

const tooltipUI = new TooltipUI(); // Instantiate globally
export default tooltipUI;
