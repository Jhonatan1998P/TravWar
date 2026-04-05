import { countCombatTroopsInVillages } from '../utils/AITroopUtils.js';

export function runMilitaryDecision({
    gameState,
    ownerId,
    race,
    archetype,
    personality,
    gameConfig,
    strategicAI,
    executeCommands,
    log,
}) {
    log('info', null, 'INICIO_CICLO_MILITAR', 'Evaluating military actions (Deterministic).');

    const aiPlayerState = gameState.players.find(player => player.id === ownerId);
    if (!aiPlayerState) return;

    if (aiPlayerState.isUnderProtection) {
        log('info', null, 'Ciclo Militar Omitido', 'AI is under beginner protection.', null, 'military');
        return;
    }

    const myVillages = gameState.villages.filter(village => village.ownerId === ownerId);
    const totalPopulation = myVillages.reduce((sum, village) => sum + village.population.current, 0);
    const combatTroopCount = countCombatTroopsInVillages(myVillages, race);

    const requiredTroops = totalPopulation * 0.15;
    if (combatTroopCount < requiredTroops) {
        log('warn', null, 'Ciclo Militar Omitido', `Gathering forces. Combat troops (${combatTroopCount}) are below the required threshold (${requiredTroops.toFixed(0)}).`, null, 'military');
        return;
    }

    log('info', null, 'Strategic AI', 'Computing utility scores for potential targets...', null, 'military');
    const gameSpeed = gameConfig.gameSpeed || 1;

    const response = strategicAI.computeMilitaryTurn(
        gameState,
        ownerId,
        race,
        archetype,
        personality,
        gameSpeed,
    );

    if (response.razonamiento) {
        log('goal', null, 'Razonamiento Estratégico', 'The General has issued the following analysis:', response.razonamiento, 'military');
    }

    if (response.comandos && response.comandos.length > 0) {
        log('success', null, 'Órdenes Recibidas', `Executing ${response.comandos.length} military commands.`, response.comandos, 'military');
        executeCommands(response.comandos, gameState);
    } else {
        log('info', null, 'Sin Comandos', 'The AI General issued no commands this cycle.', null, 'military');
    }
}
