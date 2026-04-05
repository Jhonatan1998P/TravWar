import { RESOURCE_FIELD_BUILDING_TYPES } from '../../core/data/constants.js';

export function applyDevelopmentBudgetMode({ myVillages, personality, log }) {
    if (myVillages.length === 0) return;

    const capital = myVillages[0];
    const fields = capital.buildings.filter(building => RESOURCE_FIELD_BUILDING_TYPES.includes(building.type));
    const allLevel3 = fields.length > 0 && fields.every(field => field.level >= 3);

    if (!allLevel3) {
        if (!capital.budgetRatio || capital.budgetRatio.econ !== 1.0) {
            log('info', capital, 'Ajuste Estratégico', 'Modo Desarrollo Activado: Priorizando economía (100%) hasta alcanzar nivel 3 en recursos.');
            capital.budgetRatio = { econ: 1.0, mil: 0.0 };
        }
        return;
    }

    const defaultRatio = personality.buildRatio || { econ: 0.5, mil: 0.5 };
    if (capital.budgetRatio && capital.budgetRatio.econ === 1.0 && defaultRatio.econ !== 1.0) {
        log('info', capital, 'Ajuste Estratégico', 'Modo Desarrollo Completado: Restaurando balance económico/militar estándar.');
        capital.budgetRatio = { ...defaultRatio };
    }
}
