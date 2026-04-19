import { rebalanceVillageBudgetToRatio } from '../../state/worker/budget.js';
import { getQueuedTrainingMs } from './phase-engine-common.js';

const RESOURCE_KEYS = Object.freeze(['wood', 'stone', 'iron', 'food']);

export function getCommittedRecruitmentMsFromResult(result) {
    if (Number.isFinite(result?.committedRealMs) && result.committedRealMs > 0) {
        return Math.floor(result.committedRealMs);
    }

    return getQueuedTrainingMs(result?.count, result?.timePerUnit);
}

export function getBudgetTotalResources(bucket) {
    return RESOURCE_KEYS.reduce((sum, resource) => sum + Math.max(0, Number(bucket?.[resource]) || 0), 0);
}

export function maybeRebalanceVillageBudgetOnSkew({
    village,
    phaseState,
    now,
    log,
    reason = 'phase_tick',
    logTitle = 'Macro',
    logCategory = 'economic',
    expectedEconShare = 0.65,
    severeSkewMultiplier = 0.5,
    minMilShare = 0.4,
    minLogIntervalMs = 20_000,
}) {
    if (!village?.budget?.econ || !village?.budget?.mil) return false;

    const ratio = village.budgetRatio || { econ: expectedEconShare, mil: 1 - expectedEconShare };
    const econTotal = getBudgetTotalResources(village.budget.econ);
    const milTotal = getBudgetTotalResources(village.budget.mil);
    const total = econTotal + milTotal;
    if (total <= 0) return false;

    const targetEcon = total * (Number(ratio.econ) || expectedEconShare);
    const severeSkew = econTotal < (targetEcon * severeSkewMultiplier) && milTotal > (total * minMilShare);
    if (!severeSkew) return false;

    rebalanceVillageBudgetToRatio(village, ratio);

    if (typeof log === 'function') {
        const shouldLog = !Number.isFinite(phaseState?.lastConstructionReserveLogAt)
            || (now - phaseState.lastConstructionReserveLogAt) >= minLogIntervalMs;
        if (shouldLog) {
            if (phaseState && typeof phaseState === 'object') {
                phaseState.lastConstructionReserveLogAt = now;
            }
            const econAfter = getBudgetTotalResources(village.budget.econ);
            const milAfter = getBudgetTotalResources(village.budget.mil);
            log(
                'info',
                village,
                logTitle,
                `Rebalanceo ECO/MIL aplicado por desbalance severo (${reason}). ECO ${Math.round(econTotal)}->${Math.round(econAfter)}, MIL ${Math.round(milTotal)}->${Math.round(milAfter)}.`,
                null,
                logCategory,
            );
        }
    }

    return true;
}
