import { gameData } from '../../core/GameData.js';
import { CombatFormulas } from '../../core/CombatFormulas.js';
import { getUnitTotalCost } from '../utils/AIUnitUtils.js';

export function calculateBestRaidConfig({
    availableTroops,
    defenderTroops,
    defRace,
    attRace,
    potentialLoot,
    simulateCombat,
}) {
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
        });
    }

    const defPower = CombatFormulas.calculateDefensePoints(
        [{ troops: defenderTroops, race: defRace, smithyUpgrades: {} }],
        { infantry: 0.5, cavalry: 0.5 },
        defRace,
        0,
        0,
    );

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
    simulateCombat,
    consumeTroops,
}) {
    const commands = [];
    const logs = [];
    const opportunities = [];
    const visitedTargets = new Set();

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
                const beasts = target.data.state?.beasts || {};
                defenderTroops = { ...beasts };
                const multiplier = gameData.config.oasis.beastBountyMultiplier || 40;
                const natureUnits = gameData.units.nature.troops;

                for (const [beastId, count] of Object.entries(beasts)) {
                    const beastData = natureUnits.find(unit => unit.id === beastId);
                    if (beastData) {
                        potentialLoot += beastData.upkeep * count * multiplier;
                    }
                }
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

            opportunities.push({
                score: squadConfig.netProfit / (dist + 10),
                forceIndex,
                target,
                squad: squadConfig.squad,
                profit: squadConfig.netProfit,
                dist,
            });
        });
    });

    opportunities.sort((a, b) => b.score - a.score);

    opportunities.forEach(opportunity => {
        const force = forces[opportunity.forceIndex];
        if (visitedTargets.has(opportunity.target.id)) return;

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

        logs.push(`[FARMEO ROI] ${force.village.name} -> ${opportunity.target.type === 'oasis' ? 'Oasis' : opportunity.target.data.name} (Profit: ${opportunity.profit.toFixed(0)}, Dist: ${opportunity.dist.toFixed(1)})`);

        consumeTroops(force, opportunity.squad);
        visitedTargets.add(opportunity.target.id);
    });

    return { commands, logs };
}
