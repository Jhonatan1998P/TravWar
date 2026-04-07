import fs from 'node:fs/promises';
import { AIController, AIPersonality } from './src/features/game/ai/index.js';
import { gameData } from './src/features/game/core/GameData.js';
import { CombatEngine } from './src/features/game/engine/CombatEngine.js';
import { GameStateFactory } from './src/features/game/engine/GameStateFactory.js';
import { VillageProcessor } from './src/features/game/engine/VillageProcessor.js';
import { processMovements as processMovementsStep } from './src/features/game/state/worker/movements.js';
import {
    processOasisRegeneration as processOasisRegenerationStep,
    registerOasisAttack as registerOasisAttackStep,
} from './src/features/game/state/worker/oasis.js';
import {
    handleSendMerchantsCommand as handleSendMerchantsCommandStep,
    handleSendMovementCommand as handleSendMovementCommandStep,
} from './src/features/game/state/worker/commands.js';
import {
    addResourceIncomeToVillage,
    initializeAIVillageBudget,
} from './src/features/game/state/worker/budget.js';

const RESOURCE_KEYS = ['wood', 'stone', 'iron', 'food'];
const STORAGE_SUBGOAL_PATTERN = /^SUB_GOAL:(UPGRADE|BUILD_NEW)_(WAREHOUSE|GRANARY)$/;
const PROTECTION_POPULATION_THRESHOLD = 1;

function createGameConfig({ aiCount, worldSeed, gameSpeed = 20 }) {
    return {
        gameSpeed,
        troopSpeed: 1,
        tradeCapacityMultiplier: 1,
        playerRace: 'gauls',
        aiCount,
        aiRaces: ['germans', 'gauls', 'huns'],
        maxGameDays: 30,
        worldSeed,
    };
}

function formatNumber(value, digits = 3) {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(digits));
}

function collectAiVillages(gameState) {
    return gameState.villages.filter(village => village.ownerId.startsWith('ai_'));
}

function createMetricsContainer() {
    const byResource = {};
    RESOURCE_KEYS.forEach(resource => {
        byResource[resource] = { sum: 0, count: 0 };
    });

    return {
        ratioDeviation: { sum: 0, count: 0, byResource },
        queueIdleSeconds: { construction: 0, recruitment: 0 },
        recruitedUnits: {},
        storageSubgoalTriggers: 0,
        storageSubgoalById: {},
        ratioShiftEvents: 0,
    };
}

function buildInitialState({ scenario }) {
    const personality = AIPersonality.Pesadilla;
    const gameConfig = createGameConfig({
        aiCount: scenario.aiCount,
        worldSeed: scenario.worldSeed,
        gameSpeed: scenario.gameSpeed,
    });
    const factory = new GameStateFactory(gameConfig);
    const gameState = factory.create(`phase0-${scenario.name}`);

    const aiControllers = [];
    const villageProcessors = [];

    function getActiveVillage() {
        if (!gameState.activeVillageId) return null;
        return gameState.villages.find(v => v.id === gameState.activeVillageId);
    }

    function handleSettleArrival(movement) {
        const { originVillageId, targetCoords, payload } = movement;
        const originVillage = gameState.villages.find(v => v.id === originVillageId);
        const targetTileIndex = gameState.mapData.findIndex(t => t.x === targetCoords.x && t.y === targetCoords.y);
        const targetTile = gameState.mapData[targetTileIndex];

        if (!originVillage || !targetTile || targetTile.type !== 'valley') {
            handleSendMovementCommand({
                originVillageId,
                targetCoords: originVillage?.coords,
                troops: payload.troops,
                missionType: 'return',
            });
            return;
        }

        originVillage.settlementsFounded = (originVillage.settlementsFounded || 0) + 1;

        const localFactory = new GameStateFactory(gameConfig);
        const newVillage = localFactory.createVillageObject(
            `v_${Date.now()}`,
            'Nueva Aldea',
            originVillage.race,
            originVillage.ownerId,
            targetCoords,
            targetTile.valleyType,
        );

        let bonusToPass = 1;
        let budgetConfig = null;

        if (originVillage.ownerId.startsWith('ai_')) {
            const aiController = aiControllers.find(controller => controller.getOwnerId() === originVillage.ownerId);
            if (aiController) {
                const aiPersonality = aiController.getPersonality();
                bonusToPass = aiPersonality.bonusMultiplier || 1;
                budgetConfig = aiPersonality.buildRatio;
            }

            initializeAIVillageBudget(newVillage, budgetConfig || originVillage.budgetRatio);
        }

        const newProcessor = new VillageProcessor(newVillage, gameConfig, gameState.alliance.bonuses, bonusToPass, budgetConfig);
        newProcessor.update(Date.now(), Date.now());
        villageProcessors.push(newProcessor);

        gameState.villages.push(newVillage);
        gameState.mapData[targetTileIndex] = {
            x: targetCoords.x,
            y: targetCoords.y,
            type: 'village',
            villageId: newVillage.id,
            ownerId: originVillage.ownerId,
            race: originVillage.race,
        };
        gameState.spatialIndex.set(`${targetCoords.x}|${targetCoords.y}`, gameState.mapData[targetTileIndex]);
    }

    function handleReturnArrival(movement) {
        const village = gameState.villages.find(v => v.id === movement.originVillageId);
        if (!village) return;

        for (const unitId in movement.payload.troops) {
            village.unitsInVillage[unitId] = (village.unitsInVillage[unitId] || 0) + movement.payload.troops[unitId];
        }

        const allLootKeys = new Set([
            ...Object.keys(movement.payload.bounty || {}),
            ...Object.keys(movement.payload.plunder || {}),
        ]);

        for (const res of allLootKeys) {
            const bountyAmount = movement.payload.bounty?.[res] || 0;
            const plunderAmount = movement.payload.plunder?.[res] || 0;
            const totalAmount = bountyAmount + plunderAmount;

            if (totalAmount <= 0) continue;

            addResourceIncomeToVillage(village, res, totalAmount);
        }
    }

    function handleReinforcementArrival(movement) {
        const targetVillage = gameState.villages.find(v => v.coords.x === movement.targetCoords.x && v.coords.y === movement.targetCoords.y);
        if (!targetVillage) return;

        const originVillage = gameState.villages.find(v => v.id === movement.originVillageId);
        if (!originVillage) return;

        const existingReinforcement = targetVillage.reinforcements.find(r => r.fromVillageId === movement.originVillageId);
        if (existingReinforcement) {
            for (const unitId in movement.payload.troops) {
                existingReinforcement.troops[unitId] = (existingReinforcement.troops[unitId] || 0) + movement.payload.troops[unitId];
            }
            return;
        }

        targetVillage.reinforcements.push({
            fromVillageId: movement.originVillageId,
            race: originVillage.race,
            troops: movement.payload.troops,
            smithyUpgradesSnapshot: { ...(originVillage.smithy.upgrades || {}) },
        });
    }

    function handleTradeArrival(movement) {
        const targetVillage = gameState.villages.find(v => v.coords.x === movement.targetCoords.x && v.coords.y === movement.targetCoords.y);
        if (!targetVillage) return;

        for (const res in movement.payload.resources) {
            const amount = movement.payload.resources[res];
            if (amount <= 0) continue;

            addResourceIncomeToVillage(targetVillage, res, amount);
        }

        const originVillage = gameState.villages.find(v => v.id === movement.originVillageId);
        if (!originVillage) return;

        const returnTravelTime = movement.arrivalTime - movement.startTime;
        const now = Date.now();

        gameState.movements.push({
            id: `${now}-mov-trade_return-${originVillage.id}`,
            type: 'trade_return',
            ownerId: movement.ownerId,
            originVillageId: movement.originVillageId,
            targetCoords: { x: originVillage.coords.x, y: originVillage.coords.y },
            payload: { merchants: movement.payload.merchants },
            startTime: now,
            arrivalTime: now + returnTravelTime,
        });

        gameState.movements.sort((a, b) => a.arrivalTime - b.arrivalTime);
    }

    function handleTradeReturnArrival() {
        return undefined;
    }

    function processMovements(currentTime) {
        processMovementsStep({
            gameState,
            currentTime,
            aiControllers,
            maxReports: 20,
            postMessage: () => undefined,
            createCombatEngine: () => new CombatEngine(gameState),
            updateAIProfiles: () => undefined,
            registerOasisAttack: ({ tile, currentTime: attackTime }) => {
                registerOasisAttackStep({
                    tile,
                    currentTime: attackTime,
                    gameData,
                });
            },
            handlers: {
                reinforcement: handleReinforcementArrival,
                settle: handleSettleArrival,
                return: handleReturnArrival,
                trade: handleTradeArrival,
                tradeReturn: handleTradeReturnArrival,
            },
        });
    }

    function processOasisRegeneration(currentTime) {
        processOasisRegenerationStep({
            gameState,
            currentTime,
            gameData,
        });
    }

    function handleSendMovementCommand(payload) {
        return handleSendMovementCommandStep({
            payload,
            gameState,
            gameConfig,
            gameData,
            aiControllers,
        });
    }

    function handleSendMerchantsCommand(payload) {
        return handleSendMerchantsCommandStep({
            payload,
            gameState,
            gameConfig,
            gameData,
        });
    }

    function handleAICommand(commandType, payload) {
        const villageId = payload.villageId || getActiveVillage()?.id;
        if (!villageId) return { success: false, reason: 'NO_VILLAGE_ID' };

        const processor = villageProcessors.find(item => item.getVillageId() === villageId);
        if (!processor) return { success: false, reason: 'PROCESSOR_NOT_FOUND' };

        switch (commandType) {
            case 'upgrade_building':
                return processor.queueBuildingUpgrade(payload);
            case 'recruit_units':
                return processor.queueRecruitment(payload);
            case 'research_unit':
                return processor.queueResearch(payload);
            case 'upgrade_unit':
                return processor.queueSmithyUpgrade(payload);
            case 'send_movement':
                return handleSendMovementCommand(payload);
            case 'send_merchants':
                return handleSendMerchantsCommand(payload);
            default:
                return { success: false, reason: 'UNKNOWN_COMMAND' };
        }
    }

    const aiBonus = personality.bonusMultiplier || 1;
    gameState.villages.forEach(village => {
        const isAI = village.ownerId.startsWith('ai_');
        const bonusToPass = isAI ? aiBonus : 1;
        const budgetConfig = isAI ? personality.buildRatio : null;
        if (isAI) {
            initializeAIVillageBudget(village, budgetConfig);
        }
        villageProcessors.push(new VillageProcessor(village, gameConfig, gameState.alliance.bonuses, bonusToPass, budgetConfig));
    });

    const availableArchetypes = Object.keys(personality.archetypes);
    const aiPlayers = gameState.players.filter(player => player.id.startsWith('ai_'));
    aiPlayers.forEach((player, index) => {
        const archetype = availableArchetypes[index % availableArchetypes.length];
        const aiPlayerState = gameState.aiState[player.id] || {};
        gameState.aiState[player.id] = aiPlayerState;

        const controller = new AIController(player.id, personality, player.race, archetype, handleAICommand, gameConfig);
        controller.init(gameState, aiPlayerState);
        aiControllers.push(controller);
    });

    return {
        scenario,
        personality,
        gameConfig,
        gameState,
        aiControllers,
        villageProcessors,
        processMovements,
        processOasisRegeneration,
    };
}

function collectRatioDeviation(metrics, village) {
    if (!village.budgetRatio || !village.budget) return;

    const targetEconRatio = village.budgetRatio.econ ?? 0.5;

    RESOURCE_KEYS.forEach(resource => {
        const econ = Number(village.budget.econ[resource]) || 0;
        const mil = Number(village.budget.mil[resource]) || 0;
        const total = econ + mil;
        if (total <= 0) return;

        const actual = econ / total;
        const deviation = Math.abs(actual - targetEconRatio);

        metrics.ratioDeviation.sum += deviation;
        metrics.ratioDeviation.count += 1;

        metrics.ratioDeviation.byResource[resource].sum += deviation;
        metrics.ratioDeviation.byResource[resource].count += 1;
    });
}

function collectStorageSubgoalTriggers({ gameState, aiControllers, previousGoals, metrics }) {
    aiControllers.forEach(controller => {
        const aiId = controller.getOwnerId();
        const aiState = gameState.aiState[aiId] || controller.getState();
        const villageStates = aiState.goalState || {};

        Object.entries(villageStates).forEach(([villageId, villageState]) => {
            const key = `${aiId}|${villageId}`;
            const previous = previousGoals.get(key) || new Set();
            const current = new Set();

            const goals = [
                ...(villageState.economicGoalStack || []),
                ...(villageState.militaryGoalStack || []),
            ];

            goals.forEach(goal => {
                current.add(goal.id);
                if (!previous.has(goal.id) && STORAGE_SUBGOAL_PATTERN.test(goal.id)) {
                    metrics.storageSubgoalTriggers += 1;
                    metrics.storageSubgoalById[goal.id] = (metrics.storageSubgoalById[goal.id] || 0) + 1;
                }
            });

            previousGoals.set(key, current);
        });
    });
}

function applyRatioShiftIfNeeded({ scenario, gameState, metrics, simTime, shiftState }) {
    if (!scenario.ratioShiftEveryMinutes) return;
    if (simTime < shiftState.nextShiftAt) return;

    const personalityRatio = AIPersonality.Pesadilla.buildRatio || { econ: 0.5, mil: 0.5 };
    const aiVillages = collectAiVillages(gameState);

    aiVillages.forEach(village => {
        if (shiftState.useDevelopmentMode) {
            village.budgetRatio = { econ: 1.0, mil: 0.0 };
        } else {
            village.budgetRatio = { ...personalityRatio };
        }
    });

    metrics.ratioShiftEvents += 1;
    shiftState.useDevelopmentMode = !shiftState.useDevelopmentMode;
    shiftState.nextShiftAt += scenario.ratioShiftEveryMinutes * 60 * 1000;
}

function updateProtectionStatus(gameState) {
    gameState.players.forEach(player => {
        if (!player.isUnderProtection) return;
        const totalPopulation = gameState.villages
            .filter(village => village.ownerId === player.id)
            .reduce((sum, village) => sum + village.population.current, 0);
        if (totalPopulation >= PROTECTION_POPULATION_THRESHOLD) {
            player.isUnderProtection = false;
        }
    });
}

function createResultSummary({ scenario, metrics, aiVillageCount, simulatedDurationHours }) {
    const totalRatioAvg = metrics.ratioDeviation.count > 0
        ? metrics.ratioDeviation.sum / metrics.ratioDeviation.count
        : 0;

    const ratioByResource = {};
    RESOURCE_KEYS.forEach(resource => {
        const entry = metrics.ratioDeviation.byResource[resource];
        ratioByResource[resource] = entry.count > 0 ? (entry.sum / entry.count) : 0;
    });

    const totalDurationSeconds = simulatedDurationHours * 3600;
    const denominator = Math.max(totalDurationSeconds * Math.max(aiVillageCount, 1), 1);
    const constructionIdleRate = metrics.queueIdleSeconds.construction / denominator;
    const recruitmentIdleRate = metrics.queueIdleSeconds.recruitment / denominator;

    const troopsPerHourByType = {};
    Object.entries(metrics.recruitedUnits)
        .sort((a, b) => b[1] - a[1])
        .forEach(([unitId, total]) => {
            troopsPerHourByType[unitId] = formatNumber(total / Math.max(simulatedDurationHours, 0.001), 2);
        });

    const totalRecruited = Object.values(metrics.recruitedUnits).reduce((sum, value) => sum + value, 0);

    return {
        scenario: scenario.name,
        description: scenario.description,
        config: {
            aiCount: scenario.aiCount,
            gameSpeed: scenario.gameSpeed,
            durationMinutes: scenario.durationMinutes,
            tickMs: scenario.tickMs,
            worldSeed: scenario.worldSeed,
            ratioShiftEveryMinutes: scenario.ratioShiftEveryMinutes || null,
        },
        kpis: {
            ratioDeviationAvg: formatNumber(totalRatioAvg, 5),
            ratioDeviationByResource: Object.fromEntries(
                Object.entries(ratioByResource).map(([key, value]) => [key, formatNumber(value, 5)]),
            ),
            constructionQueueIdleRate: formatNumber(constructionIdleRate, 5),
            recruitmentQueueIdleRate: formatNumber(recruitmentIdleRate, 5),
            recruitedUnitsTotal: totalRecruited,
            troopsPerHourTotal: formatNumber(totalRecruited / Math.max(simulatedDurationHours, 0.001), 2),
            troopsPerHourByType,
            storageSubgoalTriggers: metrics.storageSubgoalTriggers,
            storageSubgoalById: metrics.storageSubgoalById,
            ratioShiftEvents: metrics.ratioShiftEvents,
        },
    };
}

async function runScenario(scenario) {
    const baseline = buildInitialState({ scenario });
    const metrics = createMetricsContainer();

    const previousGoals = new Map();
    const aiVillageCount = collectAiVillages(baseline.gameState).length;
    const simulatedDurationMs = scenario.durationMinutes * 60 * 1000;
    const simulatedDurationHours = simulatedDurationMs / 3600000;

    const originalDateNow = Date.now;
    const originalLog = console.log;
    const originalDir = console.dir;

    let simTime = originalDateNow();
    const endTime = simTime + simulatedDurationMs;

    const shiftState = {
        useDevelopmentMode: true,
        nextShiftAt: simTime + ((scenario.ratioShiftEveryMinutes || 0) * 60 * 1000),
    };

    try {
        Date.now = () => simTime;
        console.log = () => undefined;
        console.dir = () => undefined;

        while (simTime < endTime) {
            const nextTime = Math.min(simTime + scenario.tickMs, endTime);
            const deltaSeconds = (nextTime - simTime) / 1000;

            applyRatioShiftIfNeeded({
                scenario,
                gameState: baseline.gameState,
                metrics,
                simTime: nextTime,
                shiftState,
            });

            baseline.villageProcessors.forEach(processor => {
                const notifications = processor.update(nextTime, simTime);

                notifications.forEach(notification => {
                    if (notification.type !== 'recruitment:finished') return;
                    (notification.payload.completed || []).forEach(entry => {
                        metrics.recruitedUnits[entry.unitId] = (metrics.recruitedUnits[entry.unitId] || 0) + entry.count;
                    });
                });
            });

            baseline.processMovements(nextTime);
            baseline.processOasisRegeneration(nextTime);
            updateProtectionStatus(baseline.gameState);

            baseline.aiControllers.forEach(controller => controller.makeDecision(baseline.gameState));
            baseline.aiControllers.forEach(controller => {
                baseline.gameState.aiState[controller.getOwnerId()] = controller.getState();
            });

            collectAiVillages(baseline.gameState).forEach(village => {
                if (village.constructionQueue.length === 0) metrics.queueIdleSeconds.construction += deltaSeconds;
                if (village.recruitmentQueue.length === 0) metrics.queueIdleSeconds.recruitment += deltaSeconds;
                collectRatioDeviation(metrics, village);
            });

            collectStorageSubgoalTriggers({
                gameState: baseline.gameState,
                aiControllers: baseline.aiControllers,
                previousGoals,
                metrics,
            });

            simTime = nextTime;
        }
    } finally {
        Date.now = originalDateNow;
        console.log = originalLog;
        console.dir = originalDir;
    }

    return createResultSummary({
        scenario,
        metrics,
        aiVillageCount,
        simulatedDurationHours,
    });
}

function buildMarkdownReport(results) {
    const lines = [];
    lines.push('# Fase 0 Baseline - Resultados');
    lines.push('');
    lines.push(`Generado: ${new Date().toISOString()}`);
    lines.push('');

    results.forEach(result => {
        lines.push(`## ${result.scenario}`);
        lines.push('');
        lines.push(`- Descripcion: ${result.description}`);
        lines.push(`- Config: aiCount=${result.config.aiCount}, gameSpeed=${result.config.gameSpeed}, duration=${result.config.durationMinutes}m, tick=${result.config.tickMs}ms, seed=${result.config.worldSeed}`);
        if (result.config.ratioShiftEveryMinutes) {
            lines.push(`- Ratio shift stress: cada ${result.config.ratioShiftEveryMinutes} minutos`);
        }
        lines.push(`- Ratio deviation avg: ${result.kpis.ratioDeviationAvg}`);
        lines.push(`- Ratio deviation by resource: wood=${result.kpis.ratioDeviationByResource.wood}, stone=${result.kpis.ratioDeviationByResource.stone}, iron=${result.kpis.ratioDeviationByResource.iron}, food=${result.kpis.ratioDeviationByResource.food}`);
        lines.push(`- Queue idle rate: construction=${result.kpis.constructionQueueIdleRate}, recruitment=${result.kpis.recruitmentQueueIdleRate}`);
        lines.push(`- Recruited units total: ${result.kpis.recruitedUnitsTotal}`);
        lines.push(`- Troops/hour total: ${result.kpis.troopsPerHourTotal}`);
        lines.push(`- Storage subgoal triggers: ${result.kpis.storageSubgoalTriggers}`);
        lines.push(`- Ratio shift events: ${result.kpis.ratioShiftEvents}`);

        const topUnits = Object.entries(result.kpis.troopsPerHourByType).slice(0, 8);
        if (topUnits.length > 0) {
            lines.push('- Top troops/hour by unit:');
            topUnits.forEach(([unitId, tph]) => {
                lines.push(`  - ${unitId}: ${tph}`);
            });
        }
        lines.push('');
    });

    return lines.join('\n');
}

async function main() {
    const scenarios = [
        {
            name: 'A - 1 AI village',
            description: 'Escenario minimo para baseline funcional y estabilidad de ratio.',
            aiCount: 1,
            gameSpeed: 20,
            durationMinutes: 120,
            tickMs: 5000,
            worldSeed: 'PHASE0_A',
        },
        {
            name: 'B - 3 AI villages',
            description: 'Escenario ampliado multi-aldea para throughput y colas.',
            aiCount: 3,
            gameSpeed: 20,
            durationMinutes: 120,
            tickMs: 5000,
            worldSeed: 'PHASE0_B',
        },
        {
            name: 'C - 3 AI villages stress ratio',
            description: 'Stress con cambios periodicos de ratio para detectar desalineaciones.',
            aiCount: 3,
            gameSpeed: 20,
            durationMinutes: 120,
            tickMs: 5000,
            worldSeed: 'PHASE0_C',
            ratioShiftEveryMinutes: 15,
        },
    ];

    const results = [];
    for (const scenario of scenarios) {
        const result = await runScenario(scenario);
        results.push(result);
    }

    const output = {
        phase: 'Fase 0',
        generatedAt: new Date().toISOString(),
        results,
    };

    const markdown = buildMarkdownReport(results);

    await fs.writeFile('docs/ai-phase0-baseline-results.json', `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    await fs.writeFile('docs/ai-phase0-baseline-results.md', `${markdown}\n`, 'utf8');

    process.stdout.write('Fase 0 baseline generado en docs/ai-phase0-baseline-results.{json,md}\n');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
