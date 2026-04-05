import EditorRenderer from '../ai-editor/Renderer.js';
import DomParser from '../ai-editor/DomParser.js';
import TooltipManager from '../ai-editor/TooltipManager.js';

class AIEditorView {
    #inputJs;
    #outputJson;
    #loadBtn;
    #exportBtn;
    #editorContainer;
    #fileInput;
    #downloadBtn;
    #renderer;
    #parser;
    #tooltipManager;

    constructor() {
        this.#renderer = new EditorRenderer();
        this.#parser = new DomParser();
    }

    get html() {
        return `
            <div class="w-full max-w-7xl mx-auto space-y-6 p-4 md:p-6 lg:p-8">
                <header class="text-center">
                    <h1 class="h1-fluid" data-tooltip="Define la lógica de decisión de los oponentes de IA.">Editor de Estrategias de IA</h1>
                    <p class="text-gray-400 mt-2 text-sm md:text-base">Carga, modifica y exporta la lógica de \`AIPersonality.js\` de forma segura.</p>
                </header>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label for="file-input" class="text-white font-medium">1. Carga \`AIPersonality.js\`</label>
                        <input type="file" id="file-input" accept=".js" class="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-500/10 file:text-blue-300 hover:file:bg-blue-500/20 cursor-pointer" data-tooltip="Selecciona tu archivo 'AIPersonality.js' local para cargarlo en el editor."/>
                        <textarea id="input-js" class="w-full h-40 md:h-56 bg-gray-800 rounded-md p-3 font-mono text-sm ring-1 ring-gray-700 focus:ring-blue-500" placeholder="O pega el contenido manualmente aquí..." data-tooltip="Pega aquí el contenido de tu archivo JS si prefieres no usar el selector de archivos."></textarea>
                        <button id="load-btn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg" data-tooltip="Analiza el código JS de entrada y construye el editor visual interactivo de abajo.">Cargar y Renderizar Editor</button>
                    </div>
                    <div class="space-y-2 relative">
                        <label for="output-json" class="text-white font-medium">3. Exporta la configuración</label>
                        <button id="download-btn" class="absolute top-8 right-2 p-2 rounded-full bg-gray-600 hover:bg-gray-500 transition-colors" title="Descargar archivo AIPersonality.js" data-tooltip="Descarga el contenido generado como un archivo 'AIPersonality.js' directamente.">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                        </button>
                        <textarea id="output-json" readonly class="w-full h-48 md:h-64 bg-gray-900/50 rounded-md p-3 font-mono text-sm ring-1 ring-gray-700" data-tooltip="Aquí aparecerá el código JS final. Puedes copiarlo manualmente."></textarea>
                        <button id="export-btn" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg" data-tooltip="Convierte el estado del editor visual a código JS formateado, listo para copiar o descargar.">Generar Contenido para Exportar</button>
                    </div>
                </div>

                <div class="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 md:p-6 ring-1 ring-white/10" data-tooltip="Área principal de edición. Arrastra y suelta para reordenar objetivos y pasos.">
                    <h2 class="text-2xl font-bold text-white mb-4">2. Editor Visual</h2>
                    <div id="editor-container" class="space-y-4">
                        <p class="text-gray-500">Carga los datos para empezar a editar...</p>
                    </div>
                </div>
            </div>
            
            <div id="tooltip-element" role="tooltip"></div>
        `;
    }

    mount() {
        this.#tooltipManager = new TooltipManager('tooltip-element');
        this.#cacheDOMElements();
        this.#initializeEventListeners();
        if (typeof Sortable === 'undefined') {
            console.error("Sortable.js no está cargado. Asegúrate de que el script CDN está en index.html.");
        }
    }

    unmount() {
        this.#loadBtn.removeEventListener('click', this.#handleLoad);
        this.#exportBtn.removeEventListener('click', this.#handleExport);
        this.#outputJson.removeEventListener('click', () => this.#outputJson.select());
        this.#fileInput.removeEventListener('change', this.#handleFileSelect);
        this.#downloadBtn.removeEventListener('click', this.#handleDownload);

        this.#editorContainer.removeEventListener('click', this.#handleEditorClick);
        this.#editorContainer.removeEventListener('change', this.#handleEditorChange);

        const mainContainer = document.querySelector('main');
        if (mainContainer) {
            mainContainer.removeEventListener('mouseover', this.#handleMouseOver);
            mainContainer.removeEventListener('mouseout', this.#handleMouseOut);
        }
        
        if (this.#tooltipManager && typeof this.#tooltipManager.hide === 'function') {
            this.#tooltipManager.hide();
        }
    }

    #cacheDOMElements() {
        this.#inputJs = document.getElementById('input-js');
        this.#outputJson = document.getElementById('output-json');
        this.#loadBtn = document.getElementById('load-btn');
        this.#exportBtn = document.getElementById('export-btn');
        this.#editorContainer = document.getElementById('editor-container');
        this.#fileInput = document.getElementById('file-input');
        this.#downloadBtn = document.getElementById('download-btn');
    }

    #initializeEventListeners() {
        this.#loadBtn.addEventListener('click', this.#handleLoad.bind(this));
        this.#exportBtn.addEventListener('click', this.#handleExport.bind(this));
        this.#outputJson.addEventListener('click', () => this.#outputJson.select());
        this.#fileInput.addEventListener('change', this.#handleFileSelect.bind(this));
        this.#downloadBtn.addEventListener('click', this.#handleDownload.bind(this));

        this.#editorContainer.addEventListener('click', this.#handleEditorClick.bind(this));
        this.#editorContainer.addEventListener('change', this.#handleEditorChange.bind(this));

        const mainContainer = document.querySelector('main');
        if (mainContainer) {
            mainContainer.addEventListener('mouseover', this.#handleMouseOver.bind(this));
            mainContainer.addEventListener('mouseout', this.#handleMouseOut.bind(this));
        }
    }

    #handleMouseOver(e) {
        const tooltipTarget = e.target.closest('[data-tooltip]');
        if (tooltipTarget) {
            this.#tooltipManager.show(tooltipTarget);
        }
    }

    #handleMouseOut(e) {
        const tooltipTarget = e.target.closest('[data-tooltip]');
        if (tooltipTarget) {
            this.#tooltipManager.hide();
        }
    }

    #handleAddProportion(button) {
        const list = button.previousElementSibling;
        if (list && list.classList.contains('proportions-list')) {
            const newRow = this.#renderer.renderProportionRow();
            list.appendChild(newRow);
        }
    }

    #handleRemoveProportion(button) {
        const row = button.closest('.proportion-row');
        if (row) {
            row.remove();
        }
    }

    #handleInitConditionBuilder(button) {
        const container = button.closest('.condition-builder-container');
        container.innerHTML = '';
        const groupEl = this.#renderer.renderConditionGroup({ type: 'AND', conditions: [] });
        container.appendChild(groupEl);
    }
    
    #handleStartWith(button, type) {
        const container = button.closest('.condition-builder-container');
        container.innerHTML = '';
        let element;
        if (type === 'rule') {
            element = this.#renderer.renderConditionRule({ type: 'building_level', operator: '>=', value: 1 });
            container.classList.add('condition-root');
        } else {
            element = this.#renderer.renderConditionGroup({ type: 'AND', conditions: [] });
            container.classList.remove('condition-root');
        }
        container.appendChild(element);
    }

    #handleAddRule(button) {
        const conditionsList = button.closest('.condition-group').querySelector('.conditions-list');
        const ruleEl = this.#renderer.renderConditionRule({ type: 'building_level' });
        conditionsList.appendChild(ruleEl);
    }

    #handleAddGroup(button) {
        const conditionsList = button.closest('.condition-group').querySelector('.conditions-list');
        const groupEl = this.#renderer.renderConditionGroup({ type: 'AND', conditions: [] });
        conditionsList.appendChild(groupEl);
    }

    #handleRemoveItem(button) {
        const item = button.closest('.condition-rule, .condition-group');
        if (!item) return;

        const container = item.parentElement;
        item.remove();
        
        if (container.classList.contains('condition-builder-container') && container.children.length === 0) {
             const buttonContainer = document.createElement('div');
             buttonContainer.className = 'flex items-center gap-2';
             buttonContainer.innerHTML = `
                <button type="button" class="btn-control btn-start" data-action="start-with-rule">+ Añadir Regla</button>
                <button type="button" class="btn-control btn-start" data-action="start-with-group">+ Añadir Grupo</button>
             `;
             container.appendChild(buttonContainer);
             container.classList.remove('condition-root');
        }
    }

    #handleToggleGroupType(label) {
        const group = label.closest('.condition-group');
        if (!group) return;
        const currentType = group.dataset.groupType;
        const newType = currentType === 'AND' ? 'OR' : 'AND';
        group.dataset.groupType = newType;
        label.textContent = newType;
    }

    #handleEditorClick(e) {
        const target = e.target;
        const action = target.dataset.action;

        const trigger = target.closest('.toggle-trigger');
        if (trigger) {
            const content = trigger.nextElementSibling;
            const icon = trigger.querySelector('.toggle-icon');
            content.classList.toggle('collapsed');
            icon.classList.toggle('rotated');
        }

        if (!action) return;
        
        e.preventDefault();
        e.stopPropagation();

        switch (action) {
            case 'init-condition-builder':
                this.#handleInitConditionBuilder(target);
                break;
            case 'start-with-rule':
                this.#handleStartWith(target, 'rule');
                break;
            case 'start-with-group':
                this.#handleStartWith(target, 'group');
                break;
            case 'add-rule':
                this.#handleAddRule(target);
                break;
            case 'add-group':
                this.#handleAddGroup(target);
                break;
            case 'remove-item':
                this.#handleRemoveItem(target);
                break;
            case 'toggle-group-type':
                this.#handleToggleGroupType(target);
                break;
            case 'add-proportion':
                this.#handleAddProportion(target);
                break;
            case 'remove-proportion':
                this.#handleRemoveProportion(target);
                break;
        }
    }

    #handleEditorChange(e) {
        const target = e.target;
        if (target.dataset.goalProp === 'action.type') {
            const actionParamsContainer = target.closest('.action-grid').querySelector('.action-params-container');
            this.#renderer.renderActionParams(actionParamsContainer, target.value);
        }
        if (target.dataset.stepProp === 'type') {
            const fieldsContainer = target.closest('.step-container').querySelector('.step-layout-fields');
            this.#renderer.renderStepFields(fieldsContainer, target.value);
        }
        if (target.dataset.goalProp === 'scope_type') {
            const scopeIndexInput = target.closest('div').querySelector('[data-goal-prop="scope_index"]');
            if (scopeIndexInput) {
                scopeIndexInput.style.display = target.value === 'village_index' ? 'block' : 'none';
            }
        }
    }

    #handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => { this.#inputJs.value = e.target.result; };
        reader.onerror = () => { alert('Error al leer el archivo.'); };
        reader.readAsText(file);
    }

    #handleDownload() {
        const content = this.#outputJson.value;
        if (!content.trim()) {
            alert('No hay contenido para descargar. Por favor, genera el contenido primero.');
            return;
        }
        const blob = new Blob([content], { type: 'text/javascript;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'AIPersonality.js';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    #initializeSortable() {
        const options = {
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            handle: '.drag-handle',
            forceFallback: true,
        };
        this.#editorContainer.querySelectorAll('.goals-list').forEach(list => new Sortable(list, options));
        this.#editorContainer.querySelectorAll('.steps-list').forEach(list => new Sortable(list, options));
        this.#editorContainer.querySelectorAll('.proportions-list').forEach(list => new Sortable(list, options));
    }

    #handleLoad() {
        const jsCode = this.#inputJs.value;
        if (!jsCode.trim()) {
            alert("El área de texto de entrada está vacía.");
            return;
        }
        this.#loadBtn.disabled = true;
        this.#loadBtn.textContent = 'Cargando...';

        setTimeout(() => {
            try {
                const sanitizedCode = jsCode.replace('export const AIPersonality =', '').replace(/;$/, '');
                const data = new Function(`return ${sanitizedCode}`)();
                
                const fragment = this.#renderer.render(data);
                this.#editorContainer.innerHTML = '';
                this.#editorContainer.appendChild(fragment);

                this.#initializeSortable();
            } catch (error) {
                alert("Error al parsear el código JavaScript. Asegúrate de que el formato es correcto.");
                console.error("Error de parseo:", error);
            } finally {
                this.#loadBtn.disabled = false;
                this.#loadBtn.textContent = 'Cargar y Renderizar Editor';
            }
        }, 10);
    }
    
    #handleExport() {
        this.#exportBtn.disabled = true;
        this.#exportBtn.textContent = 'Generando...';

        setTimeout(() => {
            try {
                const reconstructedData = this.#parser.reconstructFromDOM(this.#editorContainer);
                const finalString = `export const AIPersonality = ${this.#formatAsJavaScriptObject(reconstructedData)};`;
                this.#outputJson.value = finalString;
                alert("Contenido generado exitosamente. ¡Listo para copiar o descargar!");
            } catch (error) {
                alert("Ocurrió un error al generar el JSON.");
                console.error("Error de exportación:", error);
            } finally {
                this.#exportBtn.disabled = false;
                this.#exportBtn.textContent = 'Generar Contenido para Exportar';
            }
        }, 10);
    }

    #formatAsJavaScriptObject(obj, indentLevel = 0, forceSingleLine = false) {
        const baseIndent = ' '.repeat(indentLevel);
        const innerIndent = ' '.repeat(indentLevel + 4);

        if (obj === null) return 'null';
        if (typeof obj === 'string') {
            if (obj.startsWith('(v, gs) =>') || obj.startsWith('(village, gameState) =>')) return obj;
            return `"${obj.replace(/"/g, '\\"')}"`;
        }
        if (typeof obj !== 'object') return obj.toString();
        if (Object.keys(obj).length === 0) return Array.isArray(obj) ? '[]' : '{}';

        const isSimpleObject = (o) => typeof o === 'object' && o !== null && !Array.isArray(o) && Object.values(o).every(v => typeof v !== 'object' || v === null);

        if (Array.isArray(obj)) {
            const isArrayOfPrimitives = obj.every(item => typeof item !== 'object' || item === null);
            if (isArrayOfPrimitives) {
                return `[${obj.map(item => this.#formatAsJavaScriptObject(item, 0, true)).join(', ')}]`;
            }

            const isArrayOfSimpleObjects = obj.every(isSimpleObject);
            if (isArrayOfSimpleObjects) {
                let result = '[\n';
                result += obj.map(item => `${innerIndent}${this.#formatAsJavaScriptObject(item, indentLevel + 4, true)}`).join(',\n');
                result += `\n${baseIndent}]`;
                return result;
            }
            
            let result = '[\n';
            result += obj.map(item => `${innerIndent}${this.#formatAsJavaScriptObject(item, indentLevel + 4)}`).join(',\n');
            result += `\n${baseIndent}]`;
            return result;
        }
        
        if (isSimpleObject(obj) || forceSingleLine) {
            const pairs = Object.keys(obj).map(key => {
                const formattedKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `"${key}"`;
                const value = this.#formatAsJavaScriptObject(obj[key], 0, true);
                return `${formattedKey}: ${value}`;
            });
            return `{ ${pairs.join(', ')} }`;
        }

        let result = '{\n';
        result += Object.keys(obj).map(key => {
            const formattedKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `"${key}"`;
            const value = this.#formatAsJavaScriptObject(obj[key], indentLevel + 4);
            return `${innerIndent}${formattedKey}: ${value}`;
        }).join(',\n');
        result += `\n${baseIndent}}`;
        return result;
    }
}

export default AIEditorView;