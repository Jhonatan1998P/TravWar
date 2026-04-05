// js/ai-editor/TooltipManager.js

class TooltipManager {
    #tooltipElement;
    #hideTimeout = null;

    constructor(tooltipId) {
        this.#tooltipElement = document.getElementById(tooltipId);
        if (!this.#tooltipElement) {
            console.error(`Tooltip element with id "${tooltipId}" not found.`);
        }
    }

    show(targetElement) {
        if (!this.#tooltipElement || !targetElement.dataset.tooltip) return;

        // Cancelar cualquier desaparición programada
        if (this.#hideTimeout) {
            clearTimeout(this.#hideTimeout);
            this.#hideTimeout = null;
        }

        // Configurar contenido y mostrar
        this.#tooltipElement.textContent = targetElement.dataset.tooltip;
        this.#tooltipElement.classList.remove('hidden', 'opacity-0');
        
        this.#positionTooltip(targetElement);

        // Programar la desaparición automática
        this.#hideTimeout = setTimeout(() => this.hide(), 3000);
    }

    hide() {
        if (this.#hideTimeout) {
            clearTimeout(this.#hideTimeout);
            this.#hideTimeout = null;
        }
        if (this.#tooltipElement) {
            this.#tooltipElement.classList.add('opacity-0');
            // La clase 'hidden' se añade después de la transición para evitar saltos
            setTimeout(() => this.#tooltipElement.classList.add('hidden'), 150);
        }
    }

    #positionTooltip(targetElement) {
        const targetRect = targetElement.getBoundingClientRect();
        const tooltipRect = this.#tooltipElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const margin = 8;

        let top = targetRect.top - tooltipRect.height - margin;
        let left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);

        // Ajustar si se sale por arriba
        if (top < margin) {
            top = targetRect.bottom + margin;
        }
        
        // Ajustar si se sale por la izquierda o derecha
        if (left < margin) {
            left = margin;
        } else if (left + tooltipRect.width > viewportWidth - margin) {
            left = viewportWidth - tooltipRect.width - margin;
        }

        this.#tooltipElement.style.top = `${top + window.scrollY}px`;
        this.#tooltipElement.style.left = `${left + window.scrollX}px`;
    }
}

export default TooltipManager;