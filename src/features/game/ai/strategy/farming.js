import { gameData } from '../../core/GameData.js';
import { CombatFormulas } from '../../core/CombatFormulas.js';
import { getUnitTotalCost } from '../utils/AIUnitUtils.js';
import { calculateBeastBountyValue } from '../../core/OasisEconomy.js';
import { AI_STRATEGY_CONSTANTS } from '../config/AIConstants.js';

const DEFAULT_TRAVEL_COST_PER_DISTANCE = 8;
const DEFAULT_TRAVEL_COST_PER_MINUTE = 15;
const OASIS_RAID_BATCH_MAX_TARGETS = 15;
const OASIS_RAID_MISSION_TYPES = new Set(['attack', 'raid']);
const OASIS_RETURN_SOURCE_TILE_TYPE = 'oasis';
const OASIS_RAID_MIN_ATTACK_RATIO = 1.02;
const OASIS_RAID_MIN_GROSS_RETURN_RATIO = 1.10;

function getOasisRequiredGrossReward(lossValue) {
    const invested = Math.max(0, Number(lossValue) || 0);
    return invested * OASIS_RAID_MIN_GROSS_RETURN_RATIO;
}

function getOasisGrossReturnRatio(rewardGross, lossValue) {
    const invested = Math.max(0, Number(lossValue) || 0);
    const gross = Math.max(0, Number(rewardGross) || 0);

    if (invested <= 0) {
        return gross > 0 ? Number.POSITIVE_INFINITY : 0;
    }

    return gross / invested;
}

function meetsOasisGrossReturnThreshold(rewardGross, lossValue) {
    return getOasisGrossReturnRatio(rewardGross, lossValue) >= OASIS_RAID_MIN_GROSS_RETURN_RATIO;
}

function getMovementTroopCount(movement) {
    if (!movement?.payload?.troops || typeof movement.payload.troops !== 'object') return 0;
    return Object.values(movement.payload.troops).reduce((sum, amount) => sum + (amount || 0), 0);
}

function getAttackerProportions(attackPoints) {
    const total = Number(attackPoints?.total) || 0;
    if (total <= 0) return { infantry: 0.5, cavalry: 0.5 };

    const infantryRatio = Math.max(0, Math.min(1, (attackPoints.infantry || 0) / total));
    const cavalryRatio = Math.max(0, Math.min(1, (attackPoints.cavalry || 0) / total));
    const sum = infantryRatio + cavalryRatio;

    if (sum <= 0) return { infantry: 0.5, cavalry: 0.5 };
    return {
        infantry: infantryRatio / sum,
        cavalry: cavalryRatio / sum,
    };
}

function calculateLossesByRatio(troops, ratio) {
    const losses = {};
    for (const unitId in troops) {
        const originalCount = troops[unitId] || 0;
        if (originalCount <= 0) continue;
        const lost = Math.round(originalCount * ratio);
        if (lost > 0) losses[unitId] = Math.min(lost, originalCount);
    }
    return losses;
}

function simulateOasisRaidBattleModel({
    squad,
    defenderTroops,
    attRace,
    attackerSmithyUpgrades,
}) {
    const attackPoints = CombatFormulas.calculateAttackPoints(squad, attRace, attackerSmithyUpgrades || {});
    if ((attackPoints.total || 0) <= 0) {
        return {
            winner: 'defender',
            losses: calculateLossesByRatio(squad, 1),
            defenderLosses: {},
        };
    }

    const attackerProportions = getAttackerProportions(attackPoints);
    const defensePoints = CombatFormulas.calculateDefensePoints(
        [{ troops: defenderTroops, race: 'nature', smithyUpgrades: {} }],
        attackerProportions,
        'nature',
        0,
        0,
        1.0,
    );

    const attackerWins = attackPoints.total > defensePoints;
    const attackerLossPercent = attackerWins
        ? CombatFormulas.calculateRaidWinnerLosses(attackPoints.total, defensePoints)
        : 1.0 - CombatFormulas.calculateRaidWinnerLosses(defensePoints, attackPoints.total);
    const defenderLossPercent = 1.0 - attackerLossPercent;

    return {
        winner: attackerWins ? 'attacker' : 'defender',
        losses: calculateLossesByRatio(squad, attackerLossPercent),
        defenderLosses: calculateLossesByRatio(defenderTroops, defenderLossPercent),
    };
}

function getOffensiveRaidUnits(availableTroops, attRace, attackerSmithyUpgrades = {}) {
    const raceUnits = gameData.units[attRace].troops;
    const offensiveUnits = [];

    for (const unitId in availableTroops) {
        const count = availableTroops[unitId] || 0;
        if (count <= 0) continue;

        const unitData = raceUnits.find(unit => unit.id === unitId);
        if (!unitData) continue;
        if (unitData.role !== 'offensive') continue;
        if (unitData.type !== 'infantry' && unitData.type !== 'cavalry') continue;

        const totalCost = getUnitTotalCost(unitData);
        const smithyBonus = 1 + ((attackerSmithyUpgrades[unitId] || 0) * 0.0075);
        const effectiveAttack = unitData.stats.attack * smithyBonus;
        if (effectiveAttack <= 0 || totalCost <= 0) continue;

        offensiveUnits.push({
            id: unitId,
            count,
            unitData,
            totalCost,
            effectiveAttack,
            attackPerCost: effectiveAttack / totalCost,
        });
    }

    offensiveUnits.sort((a, b) => {
        if (b.attackPerCost !== a.attackPerCost) return b.attackPerCost - a.attackPerCost;
        return b.effectiveAttack - a.effectiveAttack;
    });

    return offensiveUnits;
}

function getPerAttackOffensiveUnitPool(offensiveUnits, plannedSlots) {
    const divisor = Math.max(1, Number(plannedSlots) || 1);

    return offensiveUnits
        .map(unit => {
            const maxCount = Math.floor(unit.count / divisor);
            if (maxCount <= 0) return null;
            return {
                ...unit,
                maxCount,
            };
        })
        .filter(Boolean);
}

function cloneSquad(squad = {}) {
    const result = {};
    Object.entries(squad).forEach(([unitId, count]) => {
        if ((count || 0) > 0) result[unitId] = count;
    });
    return result;
}

function buildBudgetAwareSquad(unitPool, usageRatio, targetAttack) {
    if (!Array.isArray(unitPool) || unitPool.length === 0) return null;

    const ratio = Math.max(0.05, Math.min(1, Number(usageRatio) || 0));
    const squad = {};
    let currentAttack = 0;

    unitPool.forEach(unit => {
        const take = Math.max(0, Math.floor(unit.maxCount * ratio));
        if (take <= 0) return;

        squad[unit.id] = take;
        currentAttack += take * unit.effectiveAttack;
    });

    if (Object.keys(squad).length === 0) {
        const fallback = unitPool[0];
        if (!fallback) return null;
        squad[fallback.id] = 1;
        currentAttack = fallback.effectiveAttack;
    }

    if (currentAttack >= targetAttack) return squad;

    const byAttackEfficiency = [...unitPool].sort((a, b) => {
        if (b.attackPerCost !== a.attackPerCost) return b.attackPerCost - a.attackPerCost;
        return b.effectiveAttack - a.effectiveAttack;
    });

    byAttackEfficiency.forEach(unit => {
        if (currentAttack >= targetAttack) return;

        const used = squad[unit.id] || 0;
        const remaining = Math.max(0, unit.maxCount - used);
        if (remaining <= 0 || unit.effectiveAttack <= 0) return;

        const needed = Math.ceil((targetAttack - currentAttack) / unit.effectiveAttack);
        const add = Math.min(remaining, Math.max(0, needed));
        if (add <= 0) return;

        squad[unit.id] = used + add;
        currentAttack += add * unit.effectiveAttack;
    });

    return currentAttack >= targetAttack ? squad : null;
}

function evaluateOasisRaidOption({
    squad,
    defenderTroops,
    attRace,
    distance,
    troopSpeed,
    attackerSmithyUpgrades,
    attackerPopulation,
    profile,
}) {
    if (!squad || Object.keys(squad).length === 0) return null;

    const simulation = simulateOasisRaidBattleModel({
        squad,
        defenderTroops,
        attRace,
        attackerSmithyUpgrades,
        attackerPopulation,
    });

    if (simulation.winner !== 'attacker') return null;

    const killedEstimated = simulation.defenderLosses || {};
    const rewardGross = calculateBeastBountyValue(killedEstimated);
    const lossValue = calculateLossValue(simulation.losses, attRace);
    const { distanceCost, minuteCost } = getRaidTravelCostConfig();
    const travelMinutes = estimateTravelMinutes(distance, squad, attRace, troopSpeed);
    const travelCost = (distance * distanceCost) + (travelMinutes * minuteCost);
    const rewardNet = rewardGross - lossValue - travelCost;

    return {
        squad,
        profile,
        rewardGross,
        lossValue,
        travelCost,
        travelMinutes,
        rewardNet,
        grossReturnRatio: getOasisGrossReturnRatio(rewardGross, lossValue),
        minRequiredGrossReward: getOasisRequiredGrossReward(lossValue),
        killedEstimated,
        selectedUnitId: null,
    };
}

function refineWinningSquad(option, context) {
    if (!option?.squad) return option;

    let bestOption = option;
    const unitOrder = Object.entries(option.squad)
        .filter(([, count]) => (count || 0) > 1)
        .map(([unitId]) => unitId);

    unitOrder.forEach(unitId => {
        let keepTrying = true;
        while (keepTrying) {
            keepTrying = false;
            const currentCount = bestOption.squad[unitId] || 0;
            if (currentCount <= 1) break;

            const reduceBy = Math.max(1, Math.floor(currentCount * 0.08));
            const nextCount = Math.max(1, currentCount - reduceBy);
            const trialSquad = cloneSquad(bestOption.squad);
            trialSquad[unitId] = nextCount;

            const trialOption = evaluateOasisRaidOption({
                ...context,
                squad: trialSquad,
                profile: `${bestOption.profile}_trim_${unitId}`,
            });

            if (!trialOption) continue;

            if (compareOasisRaidOptions(bestOption, trialOption) > 0) {
                bestOption = trialOption;
                keepTrying = true;
            }
        }
    });

    return bestOption;
}

function compareOasisRaidOptions(left, right) {
    if (!left) return 1;
    if (!right) return -1;

    if (right.rewardNet !== left.rewardNet) return right.rewardNet - left.rewardNet;
    if (left.lossValue !== right.lossValue) return left.lossValue - right.lossValue;

    const leftTroops = Object.values(left.squad).reduce((sum, value) => sum + value, 0);
    const rightTroops = Object.values(right.squad).reduce((sum, value) => sum + value, 0);
    return leftTroops - rightTroops;
}

function isOutboundOasisAttackMovement(movement, ownerId, resolveTileTypeFromCoords) {
    if (!movement || movement.ownerId !== ownerId) return false;
    if (!OASIS_RAID_MISSION_TYPES.has(movement.type)) return false;
    if (!movement.targetCoords || typeof resolveTileTypeFromCoords !== 'function') return false;
    return resolveTileTypeFromCoords(movement.targetCoords) === OASIS_RETURN_SOURCE_TILE_TYPE;
}

function isOasisReturnMovement(movement, ownerId) {
    if (!movement || movement.ownerId !== ownerId) return false;
    if (movement.type !== 'return') return false;
    return movement.payload?.returnContext?.sourceTileType === OASIS_RETURN_SOURCE_TILE_TYPE;
}

function getActiveOasisBatchState({ currentMovements, ownerId, resolveTileTypeFromCoords }) {
    const movements = Array.isArray(currentMovements) ? currentMovements : [];

    let outboundCount = 0;
    let returnCount = 0;
    let totalTroops = 0;

    movements.forEach(movement => {
        if (isOutboundOasisAttackMovement(movement, ownerId, resolveTileTypeFromCoords)) {
            outboundCount += 1;
            totalTroops += getMovementTroopCount(movement);
            return;
        }

        if (isOasisReturnMovement(movement, ownerId)) {
            returnCount += 1;
            totalTroops += getMovementTroopCount(movement);
        }
    });

    return {
        hasActiveBatch: (outboundCount + returnCount) > 0,
        outboundCount,
        returnCount,
        totalTroops,
    };
}

function getCombatCandidateUnits(availableTroops, attRace) {
    const raceUnits = gameData.units[attRace].troops;
    const availableUnits = [];

    for (const unitId in availableTroops) {
        const unitData = raceUnits.find(unit => unit.id === unitId);
        if (!unitData || availableTroops[unitId] <= 0) continue;
        if (['settler', 'chief', 'ram', 'catapult', 'scout'].includes(unitData.role)) continue;

        const totalCost = getUnitTotalCost(unitData);
        availableUnits.push({
            id: unitId,
            count: availableTroops[unitId],
            data: unitData,
            attackEff: unitData.stats.attack / totalCost,
            carryEff: (unitData.stats.capacity * unitData.stats.speed) / totalCost,
            speedEff: (unitData.stats.attack * Math.max(unitData.stats.speed, 1)) / totalCost,
            totalCost,
        });
    }

    return availableUnits;
}

function getDefensePower(defenderTroops, defRace) {
    return CombatFormulas.calculateDefensePoints(
        [{ troops: defenderTroops, race: defRace, smithyUpgrades: {} }],
        { infantry: 0.5, cavalry: 0.5 },
        defRace,
        0,
        0,
    );
}

function estimateTravelMinutes(distance, squad, attRace, troopSpeed = 1) {
    const raceUnits = gameData.units[attRace].troops;
    let slowestSpeed = Infinity;

    for (const [unitId, amount] of Object.entries(squad)) {
        if (!amount || amount <= 0) continue;
        const unitData = raceUnits.find(unit => unit.id === unitId);
        if (!unitData) continue;
        if (unitData.stats.speed < slowestSpeed) slowestSpeed = unitData.stats.speed;
    }

    if (!Number.isFinite(slowestSpeed)) return 0;

    const effectiveSpeed = Math.max(slowestSpeed * (troopSpeed || 1), 0.1);
    return (distance / effectiveSpeed) * 60;
}

function calculateLossValue(losses, attRace) {
    const raceUnits = gameData.units[attRace].troops;
    let lossValue = 0;

    for (const [unitId, lostCount] of Object.entries(losses || {})) {
        if (!lostCount || lostCount <= 0) continue;
        const unitData = raceUnits.find(unit => unit.id === unitId);
        if (!unitData) continue;
        lossValue += getUnitTotalCost(unitData) * lostCount;
    }

    return lossValue;
}

function buildAttackFocusedSquad(availableUnits, targetAttack, sortKey) {
    const squad = {};
    let currentAttack = 0;

    const sorted = [...availableUnits].sort((a, b) => b[sortKey] - a[sortKey]);
    for (const unit of sorted) {
        if (currentAttack >= targetAttack) break;
        if (unit.data.stats.attack <= 0) continue;

        const needed = Math.ceil((targetAttack - currentAttack) / unit.data.stats.attack);
        const take = Math.min(unit.count, needed);
        if (take <= 0) continue;

        squad[unit.id] = (squad[unit.id] || 0) + take;
        currentAttack += take * unit.data.stats.attack;
    }

    if (Object.keys(squad).length === 0) return null;
    return { squad, currentAttack };
}

function getRaidTravelCostConfig() {
    const oasisConfig = gameData.config.oasis || {};
    return {
        distanceCost: oasisConfig.raidTravelCostPerDistance || DEFAULT_TRAVEL_COST_PER_DISTANCE,
        minuteCost: oasisConfig.raidTravelCostPerMinute || DEFAULT_TRAVEL_COST_PER_MINUTE,
    };
}

function calculateBestOasisRaidConfig({
    availableTroops,
    defenderTroops,
    attRace,
    distance,
    troopSpeed,
    attackerSmithyUpgrades,
    attackerPopulation,
    plannedSlots,
}) {
    const offensiveUnits = getOffensiveRaidUnits(availableTroops, attRace, attackerSmithyUpgrades);
    if (offensiveUnits.length === 0) return null;

    const defPower = getDefensePower(defenderTroops, 'nature');
    if (defPower <= 0) return null;

    const perAttackUnitPool = getPerAttackOffensiveUnitPool(offensiveUnits, plannedSlots);
    if (perAttackUnitPool.length === 0) return null;

    const targetAttack = defPower * OASIS_RAID_MIN_ATTACK_RATIO;
    const candidateUsageRatios = [0.24, 0.32, 0.40, 0.50, 0.62, 0.76, 0.9, 1.0];
    let bestOption = null;

    const evaluationContext = {
        defenderTroops,
        attRace,
        distance,
        troopSpeed,
        attackerSmithyUpgrades,
        attackerPopulation,
    };

    candidateUsageRatios.forEach(ratio => {
        const squad = buildBudgetAwareSquad(perAttackUnitPool, ratio, targetAttack);
        if (!squad) return;

        const option = evaluateOasisRaidOption({
            ...evaluationContext,
            squad,
            profile: `ratio_${Math.round(ratio * 100)}`,
        });
        if (!option) return;

        const refinedOption = refineWinningSquad(option, evaluationContext);
        if (!bestOption || compareOasisRaidOptions(bestOption, refinedOption) > 0) {
            bestOption = refinedOption;
        }
    });

    return bestOption;
}

export function calculateBestRaidConfig({
    availableTroops,
    defenderTroops,
    defRace,
    attRace,
    potentialLoot,
    simulateCombat,
}) {
    const raceUnits = gameData.units[attRace].troops;
    const availableUnits = getCombatCandidateUnits(availableTroops, attRace);
    const defPower = getDefensePower(defenderTroops, defRace);

    const squad = {};
    let currentAttack = 0;
    let currentCapacity = 0;

    if (defPower > 0) {
        const targetAttack = defPower * 1.3;
        availableUnits.sort((a, b) => b.attackEff - a.attackEff);

        for (const unit of availableUnits) {
            if (currentAttack >= targetAttack) break;

            const needed = Math.ceil((targetAttack - currentAttack) / unit.data.stats.attack);
            const take = Math.min(unit.count, needed);
            if (take <= 0) continue;

            squad[unit.id] = (squad[unit.id] || 0) + take;
            unit.count -= take;
            currentAttack += take * unit.data.stats.attack;
            currentCapacity += take * unit.data.stats.capacity;
        }

        if (currentAttack < defPower * 1.1) return null;
    }

    if (currentCapacity < potentialLoot) {
        availableUnits.sort((a, b) => b.carryEff - a.carryEff);

        for (const unit of availableUnits) {
            if (currentCapacity >= potentialLoot) break;
            if (unit.count <= 0) continue;

            const needed = Math.ceil((potentialLoot - currentCapacity) / unit.data.stats.capacity);
            const take = Math.min(unit.count, needed);
            if (take <= 0) continue;

            squad[unit.id] = (squad[unit.id] || 0) + take;
            unit.count -= take;
            currentCapacity += take * unit.data.stats.capacity;
        }
    }

    if (Object.keys(squad).length === 0) return null;

    const simulation = simulateCombat(squad, defenderTroops, defRace, attRace, 0, 'raid');
    let lossValue = 0;
    for (const unitId in simulation.losses) {
        const unitData = raceUnits.find(unit => unit.id === unitId);
        lossValue += getUnitTotalCost(unitData) * simulation.losses[unitId];
    }

    return {
        squad,
        netProfit: potentialLoot - lossValue,
    };
}

function createForceTroopPool(forces) {
    return forces.map(force => ({ ...force.combatTroops }));
}

function hasTroopsForSquad(troopPool, squad) {
    for (const unitId in squad) {
        if ((troopPool[unitId] || 0) < squad[unitId]) return false;
    }
    return true;
}

function consumeSquadFromPool(troopPool, squad) {
    for (const unitId in squad) {
        troopPool[unitId] = Math.max(0, (troopPool[unitId] || 0) - squad[unitId]);
    }
}

export function performOptimizedFarming({
    forces,
    knownTargets,
    nemesisId,
    ownerId,
    race,
    attackerPopulation = 0,
    troopSpeed = 1,
    simulateCombat,
    consumeTroops,
    currentMovements,
    resolveTileTypeFromCoords,
}) {
    const commands = [];
    const logs = [];
    const oasisOpportunities = [];
    const nonOasisOpportunities = [];
    const visitedTargets = new Set();
    const attackedOasisIds = new Set();
    const telemetry = {
        evaluatedOases: 0,
        profitableOases: 0,
        rejectedNoSquad: 0,
        rejectedNonPositive: 0,
        attacksIssued: 0,
        attacksIssuedNonPositive: 0,
        rewardNetSum: 0,
        rewardGrossSum: 0,
        lossValueSum: 0,
        travelCostSum: 0,
        attackNonPositiveRate: 0,
        avgRewardNet: 0,
        lossToGrossRatio: 0,
        noProfitableCycle: false,
        uniqueOasesAttacked: 0,
        attackedOasisIds: [],
    };

    const farmTargets = knownTargets.filter(target => target.ownerId !== nemesisId);
    const oasisBatchState = getActiveOasisBatchState({
        currentMovements,
        ownerId,
        resolveTileTypeFromCoords,
    });

    if (oasisBatchState.hasActiveBatch) {
        logs.push(
            '[FARMEO ROI] Lote de oasis en curso. Esperando regreso total antes de lanzar otro lote: ' +
            `${oasisBatchState.outboundCount} ida, ${oasisBatchState.returnCount} regreso, ` +
            `${oasisBatchState.totalTroops} tropas en ciclo.`,
        );
    }

    const oasisTargets = farmTargets.filter(target => target.type === 'oasis');
    let targetSlotsForCycle = 0;

    const evaluateOasisSlots = plannedSlots => {
        const slotTelemetry = {
            evaluatedOases: 0,
            profitableOases: 0,
            rejectedNoSquad: 0,
            rejectedNonPositive: 0,
        };
        const candidates = [];

        oasisTargets.forEach(target => {
            forces.forEach((force, forceIndex) => {
                if (force.power <= 0) return;

                const dist = Math.hypot(
                    target.coords.x - force.village.coords.x,
                    target.coords.y - force.village.coords.y,
                );
                if (dist > AI_STRATEGY_CONSTANTS.searchRadius) return;

                slotTelemetry.evaluatedOases += 1;
                const beasts = target.data.state?.beasts || {};
                const oasisConfig = calculateBestOasisRaidConfig({
                    availableTroops: force.combatTroops,
                    defenderTroops: { ...beasts },
                    attRace: race,
                    distance: dist,
                    troopSpeed,
                    attackerSmithyUpgrades: force.village?.smithy?.upgrades || {},
                    attackerPopulation,
                    plannedSlots,
                });

                if (!oasisConfig) {
                    slotTelemetry.rejectedNoSquad += 1;
                    return;
                }
                if (!meetsOasisGrossReturnThreshold(oasisConfig.rewardGross, oasisConfig.lossValue)) {
                    slotTelemetry.rejectedNonPositive += 1;
                    return;
                }

                slotTelemetry.profitableOases += 1;
                candidates.push({
                    forceIndex,
                    target,
                    squad: oasisConfig.squad,
                    profit: oasisConfig.rewardNet,
                    dist,
                    details: {
                        rewardGross: oasisConfig.rewardGross,
                        lossValue: oasisConfig.lossValue,
                        travelCost: oasisConfig.travelCost,
                        travelMinutes: oasisConfig.travelMinutes,
                        profile: oasisConfig.profile,
                        selectedUnitId: oasisConfig.selectedUnitId,
                    },
                });
            });
        });

        candidates.sort((a, b) => {
            if (b.profit !== a.profit) return b.profit - a.profit;
            return a.dist - b.dist;
        });

        const troopPoolByForce = createForceTroopPool(forces);
        const visitedOases = new Set();
        const selected = [];

        candidates.forEach(candidate => {
            if (selected.length >= plannedSlots) return;
            if (visitedOases.has(candidate.target.id)) return;

            const troopPool = troopPoolByForce[candidate.forceIndex];
            if (!hasTroopsForSquad(troopPool, candidate.squad)) return;

            consumeSquadFromPool(troopPool, candidate.squad);
            selected.push(candidate);
            visitedOases.add(candidate.target.id);
        });

        return {
            selected,
            telemetry: slotTelemetry,
        };
    };

    if (!oasisBatchState.hasActiveBatch) {
        let selectedPlan = null;

        for (let plannedSlots = 1; plannedSlots <= OASIS_RAID_BATCH_MAX_TARGETS; plannedSlots++) {
            logs.push(`[FARMEO LOTE] Evaluando lote oasis con ${plannedSlots} slots (division de tropas por ${plannedSlots}).`);
            const slotResult = evaluateOasisSlots(plannedSlots);
            const viableSlots = slotResult.selected.length;

            logs.push(`[FARMEO LOTE] slots=${plannedSlots} | viables=${viableSlots}/${plannedSlots}.`);

            if (viableSlots >= plannedSlots) {
                selectedPlan = slotResult;
                targetSlotsForCycle = plannedSlots;
                logs.push(`[FARMEO LOTE] Lote viable: ${plannedSlots} ataques oasis rentables. Probando expansion.`);
                continue;
            }

            if (selectedPlan) {
                logs.push(
                    `[FARMEO LOTE] Expansion detenida: ${viableSlots}/${plannedSlots} viables. ` +
                    `Usando ultimo lote completo rentable de ${targetSlotsForCycle} ataques.`,
                );
                break;
            } else {
                selectedPlan = slotResult;
                targetSlotsForCycle = 1;
                logs.push('[FARMEO LOTE] No hay ningun oasis rentable ni siquiera para 1 ataque.');
                break;
            }
        }

        if (selectedPlan && selectedPlan.selected.length >= targetSlotsForCycle && targetSlotsForCycle > 0) {
            logs.push(`[FARMEO LOTE] Lote confirmado: ${targetSlotsForCycle} ataques oasis rentables en este ciclo.`);
        }

        if (selectedPlan) {
            telemetry.evaluatedOases += selectedPlan.telemetry.evaluatedOases;
            telemetry.profitableOases += selectedPlan.telemetry.profitableOases;
            telemetry.rejectedNoSquad += selectedPlan.telemetry.rejectedNoSquad;
            telemetry.rejectedNonPositive += selectedPlan.telemetry.rejectedNonPositive;
            oasisOpportunities.push(...selectedPlan.selected);
        }

        const sentSlots = oasisOpportunities.length;
        const committedTroops = oasisOpportunities.reduce(
            (sum, opportunity) => sum + Object.values(opportunity.squad || {}).reduce((inner, count) => inner + (count || 0), 0),
            0,
        );
        const avgNet = sentSlots > 0
            ? oasisOpportunities.reduce((sum, opportunity) => sum + (opportunity.profit || 0), 0) / sentSlots
            : 0;

        logs.push(
            `[FARMEO LOTE] Resumen ciclo: objetivoSlots=${targetSlotsForCycle} enviados=${sentSlots} ` +
            `tropasComprometidas=${committedTroops} avgNet=${avgNet.toFixed(0)}.`,
        );
    }

    farmTargets.forEach(target => {
        if (target.type === 'oasis') return;

        forces.forEach((force, forceIndex) => {
            if (force.power <= 0) return;

            const dist = Math.hypot(
                target.coords.x - force.village.coords.x,
                target.coords.y - force.village.coords.y,
            );
            if (dist > AI_STRATEGY_CONSTANTS.searchRadius) return;

            const resources = target.intel?.payload?.resources;
            const potentialLoot = resources
                ? (resources.wood + resources.stone + resources.iron + resources.food)
                : 0;
            const defenderTroops = target.intel?.payload?.troops || {};
            const defRace = target.data.race;

            if (potentialLoot === 0 && Object.keys(defenderTroops).length === 0) return;

            const squadConfig = calculateBestRaidConfig({
                availableTroops: force.combatTroops,
                defenderTroops,
                defRace,
                attRace: race,
                potentialLoot,
                simulateCombat,
            });

            if (!squadConfig || squadConfig.netProfit <= 0) return;

            nonOasisOpportunities.push({
                score: squadConfig.netProfit / (dist + 10),
                forceIndex,
                target,
                squad: squadConfig.squad,
                profit: squadConfig.netProfit,
                dist,
            });
        });
    });

    nonOasisOpportunities.sort((a, b) => b.score - a.score);

    if (oasisOpportunities.length === 0) {
        telemetry.noProfitableCycle = !oasisBatchState.hasActiveBatch;
        if (!oasisBatchState.hasActiveBatch) {
            logs.push(`[FARMEO ROI] No hay oasis con retorno bruto >= ${Math.round((OASIS_RAID_MIN_GROSS_RETURN_RATIO - 1) * 100)}% sobre inversion en tropas (RewardGross/LossValue >= ${OASIS_RAID_MIN_GROSS_RETURN_RATIO.toFixed(2)}).`);
        }
    } else {
        const ranking = oasisOpportunities
            .slice(0, OASIS_RAID_BATCH_MAX_TARGETS)
            .map(op => `${op.target.coords.x}|${op.target.coords.y}:${op.profit.toFixed(0)}`)
            .join(' > ');
        logs.push(`[FARMEO ROI] Ranking oasis por RewardNet: ${ranking}`);
    }

    const opportunities = [...oasisOpportunities, ...nonOasisOpportunities];
    let oasisRaidsIssuedThisCycle = 0;

    opportunities.forEach(opportunity => {
        const force = forces[opportunity.forceIndex];
        if (visitedTargets.has(opportunity.target.id)) return;

        if (opportunity.target.type === 'oasis') {
            if (oasisBatchState.hasActiveBatch) return;
            if (oasisRaidsIssuedThisCycle >= OASIS_RAID_BATCH_MAX_TARGETS) return;
        }

        if (opportunity.target.type === 'oasis' && !meetsOasisGrossReturnThreshold(opportunity.details?.rewardGross || 0, opportunity.details?.lossValue || 0)) {
            telemetry.rejectedNonPositive += 1;
            const minRequiredGross = getOasisRequiredGrossReward(opportunity.details?.lossValue || 0);
            const grossReturnRatio = getOasisGrossReturnRatio(opportunity.details?.rewardGross || 0, opportunity.details?.lossValue || 0);
            logs.push(`[FARMEO ROI] Oasis ${opportunity.target.coords.x}|${opportunity.target.coords.y} bloqueado en emision: Gross ${Number(opportunity.details?.rewardGross || 0).toFixed(0)} / Loss ${Number(opportunity.details?.lossValue || 0).toFixed(0)} = ${grossReturnRatio.toFixed(2)} < ${OASIS_RAID_MIN_GROSS_RETURN_RATIO.toFixed(2)} (gross minimo ${minRequiredGross.toFixed(0)}).`);
            return;
        }

        let hasTroops = true;
        for (const unitId in opportunity.squad) {
            if ((force.combatTroops[unitId] || 0) < opportunity.squad[unitId]) {
                hasTroops = false;
                break;
            }
        }

        if (!hasTroops) return;

        commands.push({
            comando: 'ATTACK',
            villageId: force.village.id,
            parametros: {
                targetCoords: opportunity.target.coords,
                tropas: opportunity.squad,
                mision: 'raid',
            },
        });

        if (opportunity.target.type === 'oasis') {
            oasisRaidsIssuedThisCycle += 1;
            telemetry.attacksIssued += 1;
            telemetry.rewardNetSum += opportunity.profit;
            if (opportunity.profit <= 0) telemetry.attacksIssuedNonPositive += 1;

            if (opportunity.details) {
                telemetry.rewardGrossSum += opportunity.details.rewardGross || 0;
                telemetry.lossValueSum += opportunity.details.lossValue || 0;
                telemetry.travelCostSum += opportunity.details.travelCost || 0;
            }

            attackedOasisIds.add(opportunity.target.id);
        }

        if (opportunity.target.type === 'oasis' && opportunity.details) {
            const unitBreakdown = Object.entries(opportunity.squad)
                .map(([unitId, count]) => `${unitId}:${count}`)
                .join(',');
            logs.push(
                `[FARMEO ROI] ${force.village.name} -> Oasis (${opportunity.details.profile}) ` +
                `(Net: ${opportunity.profit.toFixed(0)}, Gross: ${opportunity.details.rewardGross.toFixed(0)}, ` +
                `Loss: ${opportunity.details.lossValue.toFixed(0)}, Travel: ${opportunity.details.travelCost.toFixed(0)}, Dist: ${opportunity.dist.toFixed(1)}, ` +
                `Unidad: ${opportunity.details.selectedUnitId || 'n/a'}, Tropas: ${unitBreakdown})`,
            );
        } else {
            logs.push(`[FARMEO ROI] ${force.village.name} -> ${opportunity.target.type === 'oasis' ? 'Oasis' : opportunity.target.data.name} (Profit: ${opportunity.profit.toFixed(0)}, Dist: ${opportunity.dist.toFixed(1)})`);
        }

        consumeTroops(force, opportunity.squad);
        visitedTargets.add(opportunity.target.id);
    });

    telemetry.uniqueOasesAttacked = attackedOasisIds.size;
    telemetry.attackedOasisIds = Array.from(attackedOasisIds);

    telemetry.attackNonPositiveRate = telemetry.attacksIssued > 0
        ? (telemetry.attacksIssuedNonPositive / telemetry.attacksIssued)
        : 0;
    telemetry.avgRewardNet = telemetry.attacksIssued > 0
        ? (telemetry.rewardNetSum / telemetry.attacksIssued)
        : 0;
    telemetry.lossToGrossRatio = telemetry.rewardGrossSum > 0
        ? (telemetry.lossValueSum / telemetry.rewardGrossSum)
        : 0;

    return { commands, logs, telemetry };
}
