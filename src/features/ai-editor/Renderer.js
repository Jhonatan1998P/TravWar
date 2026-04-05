import { BUILDING_TYPES, GENERIC_UNIT_TYPES, RESOURCE_TYPES, AI_ACTION_TYPES, AI_ACTION_TRIGGERS, AI_CONDITION_TYPES, AI_CONDITION_OPERATORS, AI_PLAYER_PROPERTIES, AI_STEP_TYPES, AI_GOAL_CATEGORIES } from '@game/core/GameDataProxy.js';

export default class EditorRenderer {
    render(data) {
        const fragment = document.createDocumentFragment();
        Object.entries(data).forEach(([difficulty, config]) => {
            const difficultySection = this.#createDOMElement('div', 'difficulty-section bg-gray-800 rounded-lg');
            difficultySection.dataset.difficulty = difficulty;

            const contentDiv = this.#createDOMElement('div', 'collapsible-content p-4 space-y-6');
            this.#renderProperties(contentDiv, config);

            Object.entries(config.archetypes).forEach(([archetypeName, archetypeConfig]) => {
                const archetypeFieldset = this.#createDOMElement('fieldset', 'border border-gray-700 p-4 rounded-md space-y-4', { 'data-archetype': archetypeName });
                archetypeFieldset.appendChild(this.#createDOMElement('legend', 'text-lg font-semibold px-2 text-cyan-400', {}, `Arquetipo: ${archetypeName}`));
                
                const goalsContainer = this.#createDOMElement('div', 'goals-list space-y-3');
                const goals = Array.isArray(archetypeConfig.strategicGoals) 
                    ? archetypeConfig.strategicGoals 
                    : (Array.isArray(archetypeConfig.tactics) ? archetypeConfig.tactics.map(t => ({
                        id: t.id || t.name || 'GOAL',
                        priority: 50,
                        category: t.type || 'general',
                        scope: 'global',
                        condition: typeof t.conditions === 'string' ? t.conditions : '',
                        plan: []
                    })) : []);
                goals.forEach(goal => this.#renderGoal(goalsContainer, goal));
                archetypeFieldset.appendChild(goalsContainer);
                
                const addGoalBtn = this.#createDOMElement('button', 'bg-green-500/20 hover:bg-green-500/40 text-green-300 py-1 px-3 rounded text-sm mt-4', {}, '+ Añadir Objetivo');
                addGoalBtn.onclick = () => this.#renderGoal(goalsContainer, { id: 'NUEVO_OBJETIVO', priority: 50, plan: [] });

                archetypeFieldset.appendChild(addGoalBtn);
                contentDiv.appendChild(archetypeFieldset);
            });
            
            const header = this.#createCollapsibleHeader(difficulty, 'text-xl font-bold px-2 text-purple-400');
            difficultySection.append(header, contentDiv);
            fragment.appendChild(difficultySection);
        });
        return fragment;
    }

    #renderProperties(container, config) {
        const grid = this.#createDOMElement('div', 'property-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4');
        Object.entries(config).forEach(([key, value]) => {
            if (typeof value !== 'object' || value === null) {
                grid.appendChild(this.#createPropertyInput(key, value));
            } else if (key !== 'archetypes') {
                 Object.entries(value).forEach(([subKey, subValue]) => {
                    if (typeof subValue !== 'object' || subValue === null) {
                        grid.appendChild(this.#createPropertyInput(subKey, subValue, key));
                    } else {
                        Object.entries(subValue).forEach(([nestedKey, nestedValue]) => {
                            grid.appendChild(this.#createPropertyInput(nestedKey, nestedValue, `${key}.${subKey}`));
                        });
                    }
                });
            }
        });
        container.appendChild(grid);
    }

    #createPropertyInput(key, value, parentKey = '') {
        const div = this.#createDOMElement('div', '');
        const label = this.#createDOMElement('label', 'block text-sm font-medium text-gray-400', {}, `${parentKey ? parentKey+'.' : ''}${key}`);
        const inputType = typeof value === 'number' ? 'number' : 'text';
        const input = this.#createDOMElement('input', 'mt-1 w-full bg-gray-700 border-gray-600 rounded-md p-2 text-sm focus:ring-2 focus:ring-blue-500', {
            type: inputType,
            value: value,
            'data-key': key,
            ...(parentKey && { 'data-parent': parentKey })
        });
        if(inputType === 'number') input.step = 'any';
        div.append(label, input);
        return div;
    }

    #createSelect(dataAttributeName, dataAttributeValue, options, selectedValue, addEmpty = false) {
        const select = this.#createDOMElement('select', 'input-field', { [dataAttributeName]: dataAttributeValue });
        if (addEmpty) {
            select.appendChild(this.#createDOMElement('option', '', {value: ''}, '---'));
        }
        options.forEach(optionValue => {
            const option = this.#createDOMElement('option', '', { value: optionValue }, optionValue);
            if (selectedValue === optionValue) option.selected = true;
            select.appendChild(option);
        });
        return select;
    }

    #renderGoal(container, goal) {
        const goalDiv = this.#createDOMElement('div', 'goal-container bg-gray-900/50 rounded-md', { 'data-goal-id': `goal_${Date.now()}` });
        const contentDiv = this.#createDOMElement('div', 'collapsible-content collapsed p-4 space-y-3 border-t border-gray-700');
        
        const grid = this.#createDOMElement('div', 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3');
        
        const idContainer = this.#createDOMElement('div');
        idContainer.innerHTML = `<label class="text-xs text-gray-400">ID</label>`;
        idContainer.appendChild(this.#createDOMElement('input', 'input-field', { 'data-goal-prop': 'id', type: 'text', value: goal.id || '' }));

        const priorityContainer = this.#createDOMElement('div');
        priorityContainer.innerHTML = `<label class="text-xs text-gray-400">Prioridad</label>`;
        priorityContainer.appendChild(this.#createDOMElement('input', 'input-field', { 'data-goal-prop': 'priority', type: 'number', value: goal.priority || 50 }));

        const categoryContainer = this.#createDOMElement('div');
        categoryContainer.innerHTML = `<label class="text-xs text-gray-400">Categoría</label>`;
        const categorySelect = this.#createSelect('data-goal-prop', 'category', AI_GOAL_CATEGORIES, goal.category || 'economic');
        categoryContainer.appendChild(categorySelect);

        const scopeOuterContainer = this.#createDOMElement('div');
        scopeOuterContainer.innerHTML = `<label class="text-xs text-gray-400">Ámbito (Scope)</label>`;
        const scopeContainer = this.#createDOMElement('div', 'flex items-center gap-2');
        const scopeSelect = this.#createDOMElement('select', 'input-field flex-grow', { 'data-goal-prop': 'scope_type' });
        scopeSelect.innerHTML = `
            <option value="global">Global</option>
            <option value="per_village">Por Aldea (Todas)</option>
            <option value="village_index">Aldea Específica (índice)</option>
        `;
        const scopeIndexInput = this.#createDOMElement('input', 'input-field w-20', { 'data-goal-prop': 'scope_index', type: 'number', min: '0', placeholder: 'Índice' });

        let currentScopeType = 'global';
        let currentScopeIndex = '';

        if (goal.scope) {
            if (goal.scope.startsWith('village_index:')) {
                currentScopeType = 'village_index';
                currentScopeIndex = goal.scope.split(':')[1] || '0';
            } else {
                currentScopeType = goal.scope;
            }
        }
        
        scopeSelect.value = currentScopeType;
        scopeIndexInput.value = currentScopeIndex;
        scopeIndexInput.style.display = currentScopeType === 'village_index' ? 'block' : 'none';

        scopeSelect.onchange = () => {
            scopeIndexInput.style.display = scopeSelect.value === 'village_index' ? 'block' : 'none';
        };
        scopeContainer.append(scopeSelect, scopeIndexInput);
        scopeOuterContainer.appendChild(scopeContainer);
        
        const recurringContainer = this.#createDOMElement('div', 'flex items-end pb-1 lg:col-span-4');
        recurringContainer.innerHTML = `<label class="flex items-center gap-2 cursor-pointer"><input data-goal-prop="isRecurring" type="checkbox" ${goal.isRecurring ? 'checked' : ''}> Es Recurrente</label>`;

        grid.append(idContainer, priorityContainer, categoryContainer, scopeOuterContainer, recurringContainer);

        const conditionContainer = this.#createDOMElement('div', 'md:col-span-3');
        conditionContainer.appendChild(this.#createDOMElement('label', 'text-xs text-gray-400', {}, 'Condición'));
        
        this.#renderConditionBuilder(conditionContainer, goal.condition);

        const actionGrid = this.#createDOMElement('div', 'action-grid grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-gray-700 pt-3');
        const actionTypeContainer = this.#createDOMElement('div', 'md:col-span-1');
        const actionTriggerContainer = this.#createDOMElement('div', 'md:col-span-1');
        const actionParamsContainer = this.#createDOMElement('div', 'action-params-container md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-3 mt-2');
        
        actionTypeContainer.innerHTML = `<label class="text-xs text-gray-400">Acción Final (opcional)</label>`;
        actionTriggerContainer.innerHTML = `<label class="text-xs text-gray-400">Disparador</label>`;

        const actionTypeSelect = this.#createSelect('data-goal-prop', 'action.type', AI_ACTION_TYPES, goal.action?.type, true);
        actionTypeSelect.options[0].textContent = 'Ninguna';
        const triggerSelect = this.#createSelect('data-goal-prop', 'action.trigger', AI_ACTION_TRIGGERS, goal.action?.trigger || 'on_plan_complete');
        
        actionTypeContainer.appendChild(actionTypeSelect);
        actionTriggerContainer.appendChild(triggerSelect);
        actionGrid.append(actionTypeContainer, actionTriggerContainer, actionParamsContainer);
        this.renderActionParams(actionParamsContainer, goal.action?.type, goal.action);

        const planContainer = this.#createDOMElement('div', 'steps-list space-y-2');
        planContainer.appendChild(this.#createDOMElement('h5', 'text-sm font-semibold text-gray-300 mt-2', {}, 'Plan de Ejecución'));
        goal.plan.forEach(step => this.#renderStep(planContainer, step));

        const addStepBtn = this.#createDOMElement('button', 'bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 py-1 px-3 rounded text-sm', {}, '+ Añadir Paso');
        addStepBtn.onclick = (e) => { e.stopPropagation(); this.#renderStep(planContainer, { type: 'building' }); };

        const header = this.#createCollapsibleHeader(goal.id, 'text-md font-bold text-yellow-300', true);
        const deleteGoalBtn = this.#createDOMElement('button', 'text-red-400 hover:text-red-300 text-xs font-semibold ml-4', {}, 'ELIMINAR');
        deleteGoalBtn.onclick = (e) => { e.stopPropagation(); goalDiv.remove(); };
        header.querySelector('h3').after(deleteGoalBtn);

        contentDiv.append(grid, conditionContainer, actionGrid, planContainer, addStepBtn);
        goalDiv.append(header, contentDiv);
        
        container.appendChild(goalDiv);
        goalDiv.querySelectorAll('.input-field').forEach(el => el.classList.add('w-full', 'bg-gray-700', 'border-gray-600', 'rounded-md', 'p-1', 'text-sm'));
    }

    #renderConditionBuilder(container, conditionData) {
        const builderContainer = this.#createDOMElement('div', 'condition-builder-container mt-1');

        if (typeof conditionData === 'object' && conditionData !== null) {
            if (conditionData.type === 'AND' || conditionData.type === 'OR') {
                const groupEl = this.renderConditionGroup(conditionData);
                builderContainer.appendChild(groupEl);
            } else {
                builderContainer.classList.add('condition-root');
                const ruleEl = this.renderConditionRule(conditionData);
                builderContainer.appendChild(ruleEl);
            }
        } else if (typeof conditionData === 'string' && conditionData.trim()) {
            const fallbackTextarea = this.#createDOMElement('textarea', 'input-field h-16', {
                'data-goal-prop': 'condition',
                'placeholder': 'Escribe una función JS aquí: (v, gs) => v.population.current > 100'
            }, conditionData);
            builderContainer.appendChild(fallbackTextarea);
        } else {
            const buttonContainer = this.#createDOMElement('div', 'flex items-center gap-2');
            const addRuleBtn = this.#createDOMElement('button', 'btn-control btn-start', { 'data-action': 'start-with-rule' }, '+ Añadir Regla');
            const addGroupBtn = this.#createDOMElement('button', 'btn-control btn-start', { 'data-action': 'start-with-group' }, '+ Añadir Grupo');
            addRuleBtn.type = 'button';
            addGroupBtn.type = 'button';
            buttonContainer.append(addRuleBtn, addGroupBtn);
            builderContainer.appendChild(buttonContainer);
        }
        container.appendChild(builderContainer);
    }

    renderConditionGroup(groupData) {
        const groupEl = this.#createDOMElement('div', 'condition-group', { 'data-group-type': groupData.type });
        const typeLabel = this.#createDOMElement('span', 'group-type-label', { 'data-action': 'toggle-group-type' }, groupData.type);
        
        const conditionsContainer = this.#createDOMElement('div', 'conditions-list space-y-2');
        if (groupData.conditions) {
            groupData.conditions.forEach(item => {
                const itemEl = (item.type === 'AND' || item.type === 'OR')
                    ? this.renderConditionGroup(item)
                    : this.renderConditionRule(item);
                conditionsContainer.appendChild(itemEl);
            });
        }

        const controlsDiv = this.#createDOMElement('div', 'condition-control-buttons');
        const addRuleBtn = this.#createDOMElement('button', 'btn-control btn-add-rule', {'data-action': 'add-rule'}, '+ Regla');
        const addGroupBtn = this.#createDOMElement('button', 'btn-control btn-add-group', {'data-action': 'add-group'}, '+ Grupo');
        const removeBtn = this.#createDOMElement('button', 'btn-remove-item ml-auto', {'data-action': 'remove-item'}, '×');
        addRuleBtn.type = 'button'; addGroupBtn.type = 'button'; removeBtn.type = 'button';
        controlsDiv.append(addRuleBtn, addGroupBtn, removeBtn);

        groupEl.append(typeLabel, conditionsContainer, controlsDiv);
        return groupEl;
    }

    renderConditionRule(ruleData) {
        const ruleEl = this.#createDOMElement('div', 'condition-rule', { 'data-type': 'rule' });
        
        const typeSelect = this.#createSelect('data-rule-prop', 'type', AI_CONDITION_TYPES, ruleData.type);
        const fieldsContainer = this.#createDOMElement('div', 'flex-grow grid grid-cols-3 gap-2');
        const removeBtn = this.#createDOMElement('button', 'btn-remove-item', {'data-action': 'remove-item'}, '×');
        removeBtn.type = 'button';

        this.#renderRuleFields(fieldsContainer, ruleData.type, ruleData);
        typeSelect.onchange = () => this.#renderRuleFields(fieldsContainer, typeSelect.value);
        
        ruleEl.append(typeSelect, fieldsContainer, removeBtn);
        return ruleEl;
    }

    #renderRuleFields(container, ruleType, data = {}) {
        container.innerHTML = '';
        const commonClasses = 'input-field w-full bg-gray-600 border-gray-500 rounded p-1 text-xs';

        const createSelectHTML = (prop, options, selectedValue, addEmpty = false) => {
            let optionsHTML = '';
            if (addEmpty) optionsHTML += `<option value=""></option>`;
            optionsHTML += options.map(opt => `<option value="${opt}" ${opt === selectedValue ? 'selected' : ''}>${opt}</option>`).join('');
            return `<select class="${commonClasses}" data-rule-prop="${prop}">${optionsHTML}</select>`;
        };

        const createInputHTML = (prop, type, value) => {
            return `<input class="${commonClasses}" data-rule-prop="${prop}" type="${type}" value="${value || ''}">`;
        };

        switch (ruleType) {
            case 'building_level':
                container.innerHTML = createSelectHTML('building', BUILDING_TYPES, data.building) +
                                      createSelectHTML('operator', AI_CONDITION_OPERATORS, data.operator || '>=') +
                                      createInputHTML('value', 'number', data.value);
                break;
            case 'resource_fields_level':
                 container.innerHTML = createSelectHTML('resourceType', RESOURCE_TYPES, data.resourceType, true) +
                                      createSelectHTML('operator', AI_CONDITION_OPERATORS, data.operator || '>=') +
                                      createInputHTML('value', 'number', data.value);
                break;
            case 'player_property':
                container.innerHTML = createSelectHTML('property', AI_PLAYER_PROPERTIES, data.property) +
                                      createSelectHTML('operator', AI_CONDITION_OPERATORS, data.operator || '>=') +
                                      createInputHTML('value', 'number', data.value);
                break;
            case 'research_completed':
                container.innerHTML = `<div class="col-span-3">${createSelectHTML('unit', GENERIC_UNIT_TYPES, data.unit)}</div>`;
                break;
            case 'village_count':
                 container.innerHTML = `<div class="col-span-2">${createSelectHTML('operator', AI_CONDITION_OPERATORS, data.operator || '>=')}</div>` +
                                      createInputHTML('value', 'number', data.value);
                break;
        }
    }

    renderActionParams(container, actionType, data = {}) {
        container.innerHTML = '';
        const commonClasses = 'w-full bg-gray-600 border-gray-500 rounded p-1 text-xs focus:ring-1 focus:ring-blue-400';
        
        const createParamInput = (key, type, placeholder, value) => `
            <div>
                <label class="text-xs text-gray-400">${placeholder}</label>
                <input data-param-key="${key}" class="${commonClasses}" type="${type}" placeholder="${placeholder}" value="${value || ''}">
            </div>
        `;

        switch (actionType) {
            case 'farm_oases_in_radius':
                container.innerHTML += createParamInput('radius', 'number', 'Radius', data.radius ?? 5);
                container.innerHTML += createParamInput('maxArmyPercentageToSend', 'number', 'Max Army %', data.maxArmyPercentageToSend ?? 0.25);
                break;
            case 'rebalance_resources':
                container.innerHTML += createParamInput('threshold', 'number', 'Threshold %', data.threshold ?? 0.9);
                break;
        }
    }

    #renderStep(container, step) {
        const stepDiv = this.#createDOMElement('div', 'step-container bg-gray-800 p-3 rounded-md step-layout', {});
        const dragHandle = this.#createDragHandle();
        
        const typeSelect = this.#createSelect('data-step-prop', 'type', AI_STEP_TYPES, step.type);
        typeSelect.className += ' step-layout-type';

        const fieldsDiv = this.#createDOMElement('div', 'step-layout-fields flex-grow', {});
        
        const deleteStepBtn = this.#createDOMElement('button', 'flex-shrink-0 text-red-500 hover:text-red-400 font-bold text-lg leading-none step-layout-delete', {}, '×');
        deleteStepBtn.onclick = () => stepDiv.remove();

        typeSelect.onchange = () => this.renderStepFields(fieldsDiv, typeSelect.value);
        this.renderStepFields(fieldsDiv, step.type, step);
        
        stepDiv.append(dragHandle, typeSelect, fieldsDiv, deleteStepBtn);
        container.appendChild(stepDiv);
    }
    
    renderStepFields(container, type, data = {}) {
        container.innerHTML = '';
        const commonClasses = 'input-field w-full bg-gray-600 border-gray-500 rounded p-1 text-xs';
        
        const createSelectHTML = (prop, options, selectedValue) => {
            let optionsHTML = options.map(opt => `<option value="${opt}" ${opt === selectedValue ? 'selected' : ''}>${opt}</option>`).join('');
            return `<select class="${commonClasses}" data-step-prop="${prop}">${optionsHTML}</select>`;
        };

        if (type === 'proportional_units') {
            this.#renderProportionalUnitsStep(container, data);
            return;
        }

        container.classList.remove('space-y-2');
        container.classList.add('grid', 'grid-cols-1', 'sm:grid-cols-2', 'gap-2');

        switch (type) {
            case 'building':
                container.innerHTML = `
                    ${createSelectHTML('buildingType', BUILDING_TYPES, data.buildingType || 'mainBuilding')}
                    <input class="${commonClasses}" data-step-prop="level" type="number" placeholder="level" value="${data.level || ''}">`;
                break;
            case 'units':
                container.innerHTML = `
                    ${createSelectHTML('unitType', GENERIC_UNIT_TYPES, data.unitType || 'offensive_infantry')}
                    <input class="${commonClasses}" data-step-prop="count" type="number" placeholder="count" value="${data.count || ''}">`;
                break;
            case 'research':
            case 'upgrade':
                container.innerHTML = `
                    <div class="sm:col-span-2">${createSelectHTML('unitType', GENERIC_UNIT_TYPES, data.unitType || 'offensive_infantry')}</div>
                    ${type === 'upgrade' ? `<input class="${commonClasses}" data-step-prop="level" type="number" placeholder="level" value="${data.level || ''}">` : ''}`;
                break;
            case 'resource_fields_level':
                container.innerHTML = `
                    <input class="${commonClasses}" data-step-prop="level" type="number" placeholder="level" value="${data.level || ''}">
                    ${createSelectHTML('resourceType', RESOURCE_TYPES, data.resourceType || '')}`;
                break;
        }
    }

    #renderProportionalUnitsStep(container, data) {
        container.classList.remove('grid', 'grid-cols-1', 'sm:grid-cols-2', 'gap-2');
        container.classList.add('space-y-2');
        
        const baseContainer = this.#createDOMElement('div', 'grid grid-cols-2 gap-2');
        const baseUnitSelect = this.#createSelect('data-step-prop', 'baseUnit', GENERIC_UNIT_TYPES, data.baseUnit || 'offensive_infantry');
        baseUnitSelect.className = 'input-field w-full bg-gray-600 border-gray-500 rounded p-1 text-xs';
        const baseTargetInput = this.#createDOMElement('input', 'input-field w-full bg-gray-600 border-gray-500 rounded p-1 text-xs', {
            'data-step-prop': 'baseTarget',
            type: 'number',
            placeholder: 'Cantidad Base',
            value: data.baseTarget || ''
        });
        baseContainer.append(baseUnitSelect, baseTargetInput);

        const proportionsHeader = this.#createDOMElement('h6', 'text-xs font-bold text-gray-400 pt-2', {}, 'Unidades Proporcionales (Ordenadas)');
        const proportionsList = this.#createDOMElement('div', 'proportions-list space-y-1');
        
        if (data.proportions) {
            data.proportions.forEach(p => {
                proportionsList.appendChild(this.renderProportionRow(p));
            });
        }

        const addProportionBtn = this.#createDOMElement('button', 'text-xs bg-blue-900/70 hover:bg-blue-800/70 text-blue-300 py-1 px-2 rounded mt-1', {
            'data-action': 'add-proportion',
            type: 'button'
        }, '+ Añadir Proporción');
        
        container.append(baseContainer, proportionsHeader, proportionsList, addProportionBtn);
    }

    renderProportionRow(proportion = {}) {
        const row = this.#createDOMElement('div', 'proportion-row flex items-center gap-2 bg-gray-700/50 p-1 rounded');
        const handle = this.#createDragHandle();
        
        const unitSelect = this.#createSelect('data-proportion-prop', 'unit', GENERIC_UNIT_TYPES, proportion.unit || 'offensive_cavalry');
        unitSelect.className = 'flex-grow input-field bg-gray-600 border-gray-500 rounded p-1 text-xs';

        const ratioInput = this.#createDOMElement('input', 'w-20 input-field bg-gray-600 border-gray-500 rounded p-1 text-xs', {
            'data-proportion-prop': 'ratio',
            type: 'number',
            placeholder: 'Ratio %',
            value: proportion.ratio || ''
        });

        const removeBtn = this.#createDOMElement('button', 'text-red-500 hover:text-red-400 font-bold text-sm leading-none', {
            'data-action': 'remove-proportion',
            type: 'button'
        }, '×');

        row.append(handle, unitSelect, ratioInput, removeBtn);
        return row;
    }

    #createCollapsibleHeader(title, titleClasses, startCollapsed = false) {
        const header = this.#createDOMElement('div', 'toggle-trigger flex justify-between items-center cursor-pointer p-3 bg-gray-700/50 hover:bg-gray-700/80 transition-colors');
        const leftSide = this.#createDOMElement('div', 'flex items-center gap-2');
        const dragHandle = this.#createDragHandle();
        const titleEl = this.#createDOMElement('h3', titleClasses, {}, title);
        const icon = this.#createDOMElement('div', `toggle-icon ${startCollapsed ? '' : 'rotated'}`);
        icon.innerHTML = `<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>`;
        
        leftSide.append(dragHandle, titleEl);
        header.append(leftSide, icon);
        return header;
    }
    
    #createDragHandle() {
        const handle = this.#createDOMElement('div', 'drag-handle text-gray-500');
        handle.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M9,4H7V6H9V4M13,4H11V6H13V4M17,4H15V6H17V4M9,8H7V10H9V8M13,8H11V10H13V8M17,8H15V10H17V8M9,12H7V14H9V12M13,12H11V14H13V12M17,12H15V14H17V12M9,16H7V18H9V16M13,16H11V18H13V16M17,16H15V18H17V16M9,20H7V22H9V20M13,20H11V22H13V20M17,20H15V22H17V20Z" /></svg>`;
        return handle;
    }

    #createDOMElement(tag, classes = '', attributes = {}, content = '') {
        const el = document.createElement(tag);
        if (classes) el.className = classes;
        Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
        if (content) el.textContent = content;
        return el;
    }
}
