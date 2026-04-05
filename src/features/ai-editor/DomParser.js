export default class DomParser {
    reconstructFromDOM(editorContainer) {
        const data = {};
        const difficultySections = editorContainer.querySelectorAll(':scope > .difficulty-section');

        difficultySections.forEach(diffSection => {
            const difficultyName = diffSection.dataset.difficulty;
            data[difficultyName] = {};
            const contentDiv = diffSection.querySelector('.collapsible-content');

            const propInputs = contentDiv.querySelectorAll('.property-grid input, .property-grid select');
            propInputs.forEach(input => {
                const key = input.dataset.key;
                const parentKey = input.dataset.parent;
                const value = this.#getInputValue(input);
                if (value === undefined) return;

                if (parentKey) {
                    if (!data[difficultyName][parentKey]) data[difficultyName][parentKey] = {};
                    data[difficultyName][parentKey][key] = value;
                } else {
                    data[difficultyName][key] = value;
                }
            });

            data[difficultyName].archetypes = {};
            const archetypeFieldsets = contentDiv.querySelectorAll('fieldset[data-archetype]');
            archetypeFieldsets.forEach(archFs => {
                const archetypeName = archFs.dataset.archetype;
                data[difficultyName].archetypes[archetypeName] = { strategicGoals: [], tactics: [] };
                
                const goalContainers = archFs.querySelectorAll('.goal-container');
                goalContainers.forEach(goalDiv => {
                    const goalContent = goalDiv.querySelector('.collapsible-content');
                    
                    const scopeType = goalContent.querySelector('[data-goal-prop="scope_type"]').value;
                    let scopeValue;
                    if (scopeType === 'village_index') {
                        const index = goalContent.querySelector('[data-goal-prop="scope_index"]').value || '0';
                        scopeValue = `village_index:${index}`;
                    } else {
                        scopeValue = scopeType;
                    }

                    const goal = {
                        id: goalContent.querySelector('[data-goal-prop="id"]').value,
                        priority: parseInt(goalContent.querySelector('[data-goal-prop="priority"]').value, 10),
                        category: goalContent.querySelector('[data-goal-prop="category"]').value,
                        scope: scopeValue,
                        isRecurring: goalContent.querySelector('[data-goal-prop="isRecurring"]').checked,
                        plan: []
                    };
                    
                    const conditionBuilder = goalContent.querySelector('.condition-builder-container');
                    if (conditionBuilder) {
                        const conditionValue = this.#parseConditionBuilder(conditionBuilder);
                        if (conditionValue) {
                            goal.condition = conditionValue;
                        }
                    }

                    const actionTypeInput = goalContent.querySelector('[data-goal-prop="action.type"]');
                    if (actionTypeInput && actionTypeInput.value) {
                        goal.action = {
                            type: actionTypeInput.value,
                            trigger: goalContent.querySelector('[data-goal-prop="action.trigger"]').value
                        };
                        
                        const paramsContainer = goalContent.querySelector('.action-params-container');
                        paramsContainer.querySelectorAll('input, select').forEach(paramInput => {
                            const paramKey = paramInput.dataset.paramKey;
                            const paramValue = this.#getInputValue(paramInput);
                            if(paramKey && paramValue !== undefined) goal.action[paramKey] = paramValue;
                        });
                    
                // --- Parse tactics ---
                const tacticContainers = archFs.querySelectorAll('.tactic-container');
                tacticContainers.forEach(tacticDiv => {
                    const tObj = {};
                    const tInputs = tacticDiv.querySelectorAll('[data-tactic-prop]');
                    tInputs.forEach(input => {
                        const key = input.getAttribute('data-tactic-prop');
                        if (input.tagName.toLowerCase() === 'textarea') {
                            tObj[key] = input.value || '';
                        } else {
                            tObj[key] = input.value || '';
                        }
                    });
                    data[difficultyName].archetypes[archetypeName].tactics.push(tObj);
                });}

                    const stepContainers = goalContent.querySelectorAll('.step-container');
                    stepContainers.forEach(stepDiv => {
                        const step = {};
                        const type = stepDiv.querySelector('[data-step-prop="type"]').value;
                        step.type = type;

                        if (type === 'proportional_units') {
                            step.baseUnit = stepDiv.querySelector('[data-step-prop="baseUnit"]').value;
                            step.baseTarget = this.#getInputValue(stepDiv.querySelector('[data-step-prop="baseTarget"]'));
                            step.proportions = [];
                            stepDiv.querySelectorAll('.proportion-row').forEach(row => {
                                const proportion = {
                                    unit: row.querySelector('[data-proportion-prop="unit"]').value,
                                    ratio: this.#getInputValue(row.querySelector('[data-proportion-prop="ratio"]'))
                                };
                                step.proportions.push(proportion);
                            });
                        } else {
                            stepDiv.querySelectorAll('input, select, textarea').forEach(input => {
                                const prop = input.dataset.stepProp;
                                if (prop && prop !== 'type') {
                                    const value = this.#getInputValue(input);
                                    if (value !== undefined) step[prop] = value;
                                }
                            });
                        }
                        goal.plan.push(step);
                    });
                    data[difficultyName].archetypes[archetypeName].strategicGoals.push(goal);
                });
            });
        });

        return data;
    }

    #parseConditionBuilder(container) {
        const topGroup = container.querySelector(':scope > .condition-group');
        if (topGroup) {
            return this.#parseConditionGroup(topGroup);
        }

        const topRule = container.querySelector(':scope > .condition-rule');
        if (topRule) {
            return this.#parseConditionRule(topRule);
        }

        const fallbackTextarea = container.querySelector('textarea[data-goal-prop="condition"]');
        if (fallbackTextarea && fallbackTextarea.value.trim()) {
            return fallbackTextarea.value.trim();
        }

        return undefined;
    }

    #parseConditionGroup(groupElement) {
        const groupData = {
            type: groupElement.dataset.groupType,
            conditions: []
        };

        const conditionsContainer = groupElement.querySelector('.conditions-list');
        conditionsContainer.querySelectorAll(':scope > .condition-group, :scope > .condition-rule').forEach(childElement => {
            if (childElement.classList.contains('condition-group')) {
                groupData.conditions.push(this.#parseConditionGroup(childElement));
            } else if (childElement.classList.contains('condition-rule')) {
                groupData.conditions.push(this.#parseConditionRule(childElement));
            }
        });
        
        return groupData;
    }

    #parseConditionRule(ruleElement) {
        const ruleData = {};
        ruleElement.querySelectorAll('select[data-rule-prop], input[data-rule-prop]').forEach(input => {
            const prop = input.dataset.ruleProp;
            const value = this.#getInputValue(input);
            if (value !== undefined && value !== '') {
                ruleData[prop] = value;
            }
        });
        return ruleData;
    }

    #getInputValue(input) {
        switch (input.type) {
            case 'checkbox':
                return input.checked;
            case 'number':
                if (input.value === null || input.value.trim() === '') return undefined;
                return parseFloat(input.value);
            default:
                if (input.value === null || input.value.trim() === '') return undefined;
                return input.value;
        }
    }
}