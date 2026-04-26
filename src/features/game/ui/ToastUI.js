const ICONS = {
    success: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
    info: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`,
    error: `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`,
};

class ToastUI {
    #container;
    #position = 'bottom-left';

    constructor(containerId = 'toast-container') {
        this.#container = document.getElementById(containerId);
        if (!this.#container) {
            console.error(`[ToastUI] Contenedor de notificaciones con ID "${containerId}" no encontrado.`);
            return;
        }
        this._setupContainer();
    }

    _setupContainer() {
        this.#container.className = 'fixed bottom-24 left-4 z-[1000] flex max-w-[calc(100vw-2rem)] flex-col items-start gap-3 pointer-events-none';
    }
    
    setPosition(newPosition) {
        if (newPosition === this.#position || (newPosition !== 'bottom-left' && newPosition !== 'bottom-right')) {
            return;
        }

        if (newPosition === 'bottom-right') {
            this.#container.classList.remove('left-4', 'items-start');
            this.#container.classList.add('right-4', 'items-end');
        } else {
            this.#container.classList.remove('right-4', 'items-end');
            this.#container.classList.add('left-4', 'items-start');
        }
        this.#position = newPosition;
    }

    show(message, type = 'info', duration = 3000) {
        if (!this.#container) return;

        const toastElement = document.createElement('div');
        
        toastElement.className = `
            flex items-center gap-3 w-auto max-w-xs
            bg-glass-bg backdrop-blur-md text-war-mist 
            p-3 rounded-2xl shadow-2xl border border-primary-border
            transform transition-all duration-300 ease-out
            opacity-0 translate-y-10
        `;
        
        toastElement.innerHTML = `
            <div class="flex-shrink-0">${ICONS[type] || ICONS.info}</div>
            <p class="text-sm font-semibold text-stone-100">${message}</p>
        `;

        requestAnimationFrame(() => {
            this.#container.appendChild(toastElement);
            requestAnimationFrame(() => {
                toastElement.classList.remove('opacity-0', 'translate-y-10');
            });
        });

        setTimeout(() => {
            toastElement.classList.add('opacity-0', 'translate-y-10');
            toastElement.addEventListener('transitionend', () => {
                toastElement.remove();
            }, { once: true });
        }, duration);
    }
}

const toastUI = new ToastUI();
export default toastUI;
