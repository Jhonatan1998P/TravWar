import { RESOURCE_LABEL_TO_BUILDING_TYPE } from '../../core/data/constants.js';

function getBuildingLevel(village, type) {
    return (village.buildings.find(building => building.type === type) || { level: 0 }).level;
}

function getResourceFieldsLevel(village, resourceType) {
    const typeToFind = RESOURCE_LABEL_TO_BUILDING_TYPE[resourceType] || null;
    const fields = village.buildings.filter(building => /^[wcif]/.test(building.id) && (typeToFind ? building.type === typeToFind : true));
    if (fields.length === 0) return 0;
    return Math.min(...fields.map(field => field.level));
}

function getPlayerProperty(gameState, ownerId, property) {
    if (property === 'population') {
        return gameState.villages
            .filter(village => village.ownerId === ownerId)
            .reduce((sum, village) => sum + village.population.current, 0);
    }
    return 0;
}

function getVillageCount(gameState, ownerId) {
    return gameState.villages.filter(village => village.ownerId === ownerId).length;
}

function evaluateRule(rule, context) {
    const { village, gameState, resolveUnitId } = context;

    let value;
    switch (rule.type) {
        case 'building_level':
            value = getBuildingLevel(village, rule.building);
            break;
        case 'resource_fields_level':
            value = getResourceFieldsLevel(village, rule.resourceType);
            break;
        case 'player_property':
            value = getPlayerProperty(gameState, village.ownerId, rule.property);
            break;
        case 'research_completed': {
            const resolvedUnitId = resolveUnitId(rule.unit);
            if (!resolvedUnitId) return false;
            return village.research.completed.includes(resolvedUnitId);
        }
        case 'village_count':
            value = getVillageCount(gameState, village.ownerId);
            break;
        default:
            return true;
    }

    const targetValue = rule.value;
    switch (rule.operator) {
        case '>=': return value >= targetValue;
        case '<=': return value <= targetValue;
        case '==': return value == targetValue;
        case '!=': return value != targetValue;
        case '>': return value > targetValue;
        case '<': return value < targetValue;
        default: return true;
    }
}

function parseConditionNode(node, context) {
    if (node.type === 'AND') return node.conditions.every(subNode => parseConditionNode(subNode, context));
    if (node.type === 'OR') return node.conditions.some(subNode => parseConditionNode(subNode, context));
    return evaluateRule(node, context);
}

export function evaluateCondition(condition, context) {
    if (!condition) return true;

    switch (typeof condition) {
        case 'function':
            return condition(context.village, context.gameState);
        case 'string':
            context.onUnsupportedString?.();
            return false;
        case 'object':
            return parseConditionNode(condition, context);
        default:
            return true;
    }
}
