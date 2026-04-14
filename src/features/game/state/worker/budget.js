import { BUDGET_RATIO_REBALANCE_INTERVAL_MS } from '../../core/data/constants.js';

const RESOURCE_KEYS = ['wood', 'stone', 'iron', 'food'];
const DEFAULT_RATIO = Object.freeze({ econ: 0.5, mil: 0.5 });
export const BUDGET_REBALANCE_INTERVAL_GAME_MS = BUDGET_RATIO_REBALANCE_INTERVAL_MS;
export const BUDGET_REBALANCE_INTERVAL_GAME_MINUTES = BUDGET_REBALANCE_INTERVAL_GAME_MS / (60 * 1000);

function getNormalizedRatio(budgetRatio) {
    const rawEcon = Number.isFinite(budgetRatio?.econ) ? Math.max(0, budgetRatio.econ) : DEFAULT_RATIO.econ;
    const rawMil = Number.isFinite(budgetRatio?.mil) ? Math.max(0, budgetRatio.mil) : DEFAULT_RATIO.mil;
    const ratioSum = rawEcon + rawMil;

    if (ratioSum <= 0) {
        return { ...DEFAULT_RATIO };
    }

    return {
        econ: rawEcon / ratioSum,
        mil: rawMil / ratioSum,
    };
}

function ensureVillageBudget(village) {
    village.budget ??= {
        econ: { wood: 0, stone: 0, iron: 0, food: 0 },
        mil: { wood: 0, stone: 0, iron: 0, food: 0 },
    };

    RESOURCE_KEYS.forEach(resource => {
        if (!Number.isFinite(village.budget.econ[resource])) village.budget.econ[resource] = 0;
        if (!Number.isFinite(village.budget.mil[resource])) village.budget.mil[resource] = 0;
    });
}

function getCapacity(resourceData, fallback) {
    const capacity = Number(resourceData?.capacity);
    if (Number.isFinite(capacity) && capacity > 0) return capacity;
    return Math.max(0, fallback);
}

export function initializeAIVillageBudget(village, budgetRatio) {
    rebalanceVillageBudgetToRatio(village, budgetRatio);
}

export function rebalanceVillageBudgetToRatio(village, budgetRatio = village?.budgetRatio) {
    if (!village?.ownerId?.startsWith('ai_') || !village.resources) return;

    const ratio = getNormalizedRatio(budgetRatio || village.budgetRatio || DEFAULT_RATIO);
    village.budgetRatio = { ...ratio };

    ensureVillageBudget(village);

    RESOURCE_KEYS.forEach(resource => {
        const resourceData = village.resources[resource];
        if (!resourceData) return;

        const current = Number(resourceData.current);
        const currentBudgetTotal = (Number(village.budget.econ[resource]) || 0) + (Number(village.budget.mil[resource]) || 0);
        const baseTotal = Number.isFinite(current) ? Math.max(0, current) : Math.max(0, currentBudgetTotal);
        const capacity = getCapacity(resourceData, baseTotal);
        const total = Math.min(baseTotal, capacity);

        const econValue = total * ratio.econ;
        const milValue = total - econValue;

        village.budget.econ[resource] = econValue;
        village.budget.mil[resource] = milValue;
        resourceData.current = econValue + milValue;
    });
}

export function rebalanceAIVillageBudgets(villages = []) {
    let rebalancedCount = 0;

    villages.forEach(village => {
        if (!village?.ownerId?.startsWith('ai_')) return;
        rebalanceVillageBudgetToRatio(village, village.budgetRatio);
        rebalancedCount += 1;
    });

    return rebalancedCount;
}

export function addResourceIncomeToVillage(village, resource, amount, options = {}) {
    if (!village?.resources?.[resource] || !Number.isFinite(amount) || amount <= 0) return;

    const resourceData = village.resources[resource];
    const current = Math.max(0, Number(resourceData.current) || 0);
    const capacity = getCapacity(resourceData, current + amount);

    if (!village.ownerId?.startsWith('ai_')) {
        resourceData.current = Math.min(capacity, current + amount);
        return;
    }

    ensureVillageBudget(village);

    const ratio = getNormalizedRatio(village.budgetRatio || DEFAULT_RATIO);
    village.budgetRatio = { ...ratio };
    const budgetBucket = options?.budgetBucket;

    if (budgetBucket === 'mil') {
        const econValue = Math.max(0, Number(village.budget.econ[resource]) || 0);
        let milValue = (Number(village.budget.mil[resource]) || 0) + amount;

        const maxMil = Math.max(0, capacity - econValue);
        if (milValue > maxMil) milValue = maxMil;

        village.budget.econ[resource] = econValue;
        village.budget.mil[resource] = Math.max(0, milValue);
        resourceData.current = village.budget.econ[resource] + village.budget.mil[resource];
        return;
    }

    let econValue = (Number(village.budget.econ[resource]) || 0) + (amount * ratio.econ);
    let milValue = (Number(village.budget.mil[resource]) || 0) + (amount * ratio.mil);

    let total = econValue + milValue;
    if (total > capacity) {
        const overflow = total - capacity;
        econValue -= overflow * ratio.econ;
        milValue -= overflow * ratio.mil;
        total = econValue + milValue;
    }

    if (econValue < 0 || milValue < 0 || !Number.isFinite(total)) {
        const safeTotal = Math.max(0, Math.min(capacity, current + amount));
        econValue = safeTotal * ratio.econ;
        milValue = safeTotal - econValue;
    }

    village.budget.econ[resource] = Math.max(0, econValue);
    village.budget.mil[resource] = Math.max(0, milValue);
    resourceData.current = village.budget.econ[resource] + village.budget.mil[resource];

    if (resourceData.current > capacity) {
        const overflow = resourceData.current - capacity;
        village.budget.econ[resource] = Math.max(0, village.budget.econ[resource] - (overflow * ratio.econ));
        village.budget.mil[resource] = Math.max(0, village.budget.mil[resource] - (overflow * ratio.mil));
        resourceData.current = village.budget.econ[resource] + village.budget.mil[resource];
    }
}
