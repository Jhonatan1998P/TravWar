import { gameData } from '../../core/GameData.js';
import { CombatFormulas } from '../../core/CombatFormulas.js';
import { getUnitTotalCost } from '../utils/AIUnitUtils.js';
import { calculateBeastBountyValue } from '../../core/OasisEconomy.js';

const DEFAULT_TRAVEL_COST_PER_DISTANCE = 8;
const DEFAULT_TRAVEL_COST_PER_MINUTE = 15;

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
    simulateCombat,
}) {
    const availableUnits = getCombatCandidateUnits(availableTroops, attRace);
    if (availableUnits.length === 0) return null;

    const defPower = getDefensePower(defenderTroops, 'nature');
    if (defPower <= 0) return null;

    const targetProfiles = [
        { ratio: 1.15, sortKey: 'speedEff', label: 'ligera_rapida' },
        { ratio: 1.3, sortKey: 'attackEff', label: 'media_equilibrada' },
        { ratio: 1.5, sortKey: 'attackEff', label: 'pesada_segura' },
        { ratio: 1.35, sortKey: 'carryEff', label: 'mixta_movil' },
    ];

    const candidateSquads = [];
    const seen = new Set();

    targetProfiles.forEach(profile => {
        const targetAttack = defPower * profile.ratio;
        const candidate = buildAttackFocusedSquad(availableUnits, targetAttack, profile.sortKey);
        if (!candidate) return;

        const squadKey = Object.entries(candidate.squad)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([unitId, count]) => `${unitId}:${count}`)
            .join('|');

        if (seen.has(squadKey)) return;
        seen.add(squadKey);

        candidateSquads.push({ ...candidate, profile: profile.label });
    });

    if (candidateSquads.length === 0) return null;

    const { distanceCost, minuteCost } = getRaidTravelCostConfig();
    let best = null;

    candidateSquads.forEach(candidate => {
        const simulation = simulateCombat(candidate.squad, defenderTroops, 'nature', attRace, 0, 'raid');
        const killedEstimated = simulation.defenderLosses || {};
        const rewardGross = calculateBeastBountyValue(killedEstimated);
        const lossValue = calculateLossValue(simulation.losses, attRace);
        const travelMinutes = estimateTravelMinutes(distance, candidate.squad, attRace, troopSpeed);
        const travelCost = (distance * distanceCost) + (travelMinutes * minuteCost);
        const rewardNet = rewardGross - lossValue - travelCost;

        const evaluated = {
            squad: candidate.squad,
            profile: candidate.profile,
            rewardGross,
            lossValue,
            travelCost,
            travelMinutes,
            rewardNet,
            killedEstimated,
        };

        if (!best || evaluated.rewardNet > best.rewardNet) {
            best = evaluated;
        }
    });

    return best;
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

export function performOptimizedFarming({
    forces,
    knownTargets,
    nemesisId,
    race,
    troopSpeed = 1,
    simulateCombat,
    consumeTroops,
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

    farmTargets.forEach(target => {
        forces.forEach((force, forceIndex) => {
            if (force.power <= 0) return;

            const dist = Math.hypot(
                target.coords.x - force.village.coords.x,
                target.coords.y - force.village.coords.y,
            );
            if (dist > 50) return;

            let potentialLoot = 0;
            let defenderTroops = {};
            let defRace = 'nature';

            if (target.type === 'oasis') {
                telemetry.evaluatedOases += 1;
                const beasts = target.data.state?.beasts || {};
                defenderTroops = { ...beasts };
                const oasisConfig = calculateBestOasisRaidConfig({
                    availableTroops: force.combatTroops,
                    defenderTroops,
                    attRace: race,
                    distance: dist,
                    troopSpeed,
                    simulateCombat,
                });

                if (!oasisConfig) {
                    telemetry.rejectedNoSquad += 1;
                    logs.push(`[FARMEO ROI] Oasis ${target.coords.x}|${target.coords.y} descartado: sin escuadra viable.`);
                    return;
                }

                if (oasisConfig.rewardNet <= 0) {
                    telemetry.rejectedNonPositive += 1;
                    logs.push(
                        `[FARMEO ROI] Oasis ${target.coords.x}|${target.coords.y} descartado: ` +
                        `RewardNet ${oasisConfig.rewardNet.toFixed(0)} <= 0 ` +
                        `(Gross ${oasisConfig.rewardGross.toFixed(0)} - Loss ${oasisConfig.lossValue.toFixed(0)} - Travel ${oasisConfig.travelCost.toFixed(0)}).`,
                    );
                    return;
                }

                telemetry.profitableOases += 1;

                oasisOpportunities.push({
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
                    },
                });
                return;
            } else {
                const resources = target.intel?.payload?.resources;
                if (resources) {
                    potentialLoot = resources.wood + resources.stone + resources.iron + resources.food;
                }
                defenderTroops = target.intel?.payload?.troops || {};
                defRace = target.data.race;
            }

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

    oasisOpportunities.sort((a, b) => {
        if (b.profit !== a.profit) return b.profit - a.profit;
        return a.dist - b.dist;
    });

    nonOasisOpportunities.sort((a, b) => b.score - a.score);

    if (oasisOpportunities.length === 0) {
        telemetry.noProfitableCycle = true;
        logs.push('[FARMEO ROI] No hay oasis con RewardNet > 0 en este ciclo.');
    } else {
        const ranking = oasisOpportunities
            .slice(0, 5)
            .map(op => `${op.target.coords.x}|${op.target.coords.y}:${op.profit.toFixed(0)}`)
            .join(' > ');
        logs.push(`[FARMEO ROI] Ranking oasis por RewardNet: ${ranking}`);
    }

    const opportunities = [...oasisOpportunities, ...nonOasisOpportunities];

    opportunities.forEach(opportunity => {
        const force = forces[opportunity.forceIndex];
        if (visitedTargets.has(opportunity.target.id)) return;

        if (opportunity.target.type === 'oasis' && opportunity.profit <= 0) {
            telemetry.rejectedNonPositive += 1;
            logs.push(`[FARMEO ROI] Oasis ${opportunity.target.coords.x}|${opportunity.target.coords.y} bloqueado en emisión: RewardNet ${opportunity.profit.toFixed(0)} <= 0.`);
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
            logs.push(
                `[FARMEO ROI] ${force.village.name} -> Oasis (${opportunity.details.profile}) ` +
                `(Net: ${opportunity.profit.toFixed(0)}, Gross: ${opportunity.details.rewardGross.toFixed(0)}, ` +
                `Loss: ${opportunity.details.lossValue.toFixed(0)}, Travel: ${opportunity.details.travelCost.toFixed(0)}, Dist: ${opportunity.dist.toFixed(1)})`,
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
