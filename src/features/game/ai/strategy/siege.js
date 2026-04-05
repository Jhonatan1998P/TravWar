import { gameData } from '../../core/GameData.js';

export function planSiegeTrain(force, target, log, options = {}) {
    const {
        minCatsForTrain,
        maxWaves,
        consumeTroops,
    } = options;

    const catapultId = Object.keys(force.siegeTroops).find(unitId => {
        const unit = gameData.units[force.village.race].troops.find(troop => troop.id === unitId);
        return unit && unit.role === 'catapult';
    });

    if (!catapultId || !force.siegeTroops[catapultId]) return [];

    const totalCats = force.siegeTroops[catapultId];
    if (totalCats < minCatsForTrain) {
        const troopsToSend = {
            ...force.combatTroops,
            ...force.siegeTroops,
        };

        consumeTroops(force, troopsToSend);
        log.push('[ASEDIO] Ataque único de limpieza.');

        return [{
            comando: 'ATTACK',
            villageId: force.village.id,
            parametros: {
                targetCoords: target.coords,
                tropas: troopsToSend,
                mision: 'attack',
                catapultTargets: ['cropland', 'warehouse'],
            },
        }];
    }

    const waves = Math.min(maxWaves, Math.floor(totalCats / 10));
    const catsPerWave = Math.floor(totalCats / waves);

    const commands = [];
    const targetsList = [
        ['cropland', 'granary'],
        ['mainBuilding', 'warehouse'],
        ['barracks', 'stable'],
        ['marketplace', 'wall'],
        ['cropland', 'cropland'],
    ];
    const unitTypes = Object.keys(force.combatTroops);

    for (let i = 0; i < waves; i++) {
        const waveTroops = { [catapultId]: catsPerWave };
        unitTypes.forEach(unitId => {
            const amount = Math.floor(force.combatTroops[unitId] / waves);
            if (amount > 0) {
                waveTroops[unitId] = amount;
            }
        });

        commands.push({
            comando: 'ATTACK',
            villageId: force.village.id,
            parametros: {
                targetCoords: target.coords,
                tropas: waveTroops,
                mision: 'attack',
                catapultTargets: targetsList[i % targetsList.length],
            },
        });
    }

    consumeTroops(force, force.combatTroops);
    consumeTroops(force, force.siegeTroops);
    log.push(`[ASEDIO] ¡TREN DE DESTRUCCIÓN LANZADO! ${waves} oleadas.`);

    return commands;
}
