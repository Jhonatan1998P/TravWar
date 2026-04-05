// START OF FILE MemoryManager.js
import { gameData } from '../core/GameData.js';

const MAX_MEMORY_ENTRIES = 200;

export class MemoryManager {
    constructor(gameState) {
        this.memoryLog = gameState.memory.log || [];
    }

    recordBattleOutcome(report, ownerId) {
        const isMyAttack = report.attacker.ownerId === ownerId;
        const enemyPlayerId = isMyAttack ? (report.defender.contingents?.[0]?.ownerId || 'nature') : report.attacker.ownerId;

        if (!enemyPlayerId || enemyPlayerId === 'nature') return;

        const mySummary = isMyAttack ? report.summary.attacker : report.summary.defender;
        const enemySummary = isMyAttack ? report.summary.defender : report.summary.attacker;
        const myInitialTroops = isMyAttack ? report.attacker.troops : report.defender.tropas_totales;
        const enemyInitialTroops = isMyAttack ? report.defender.tropas_totales : report.attacker.troops;

        const myLossesRatio = this.calculateLossRatio(mySummary, myInitialTroops);
        const enemyLossesRatio = this.calculateLossRatio(enemySummary, enemyInitialTroops);

        const myPlayerName = isMyAttack ? report.attacker.playerName : report.defender.contingents.find(c => c.ownerId === ownerId)?.playerName;
        const outcome = report.winner === myPlayerName ? 1 : (report.winner === "Empate" ? 0 : -1);

        const embedding = [
            isMyAttack ? 1 : 0,
            outcome,
            parseFloat(myLossesRatio.toFixed(2)),
            parseFloat(enemyLossesRatio.toFixed(2)),
            report.time
        ];

        let analysis = 'inconclusive';
        if (isMyAttack && outcome === -1 && myLossesRatio > 0.8 && enemyLossesRatio < 0.2) {
            analysis = 'baiting_trap';
        } else if (!isMyAttack && outcome === 1 && myLossesRatio < 0.1 && enemyLossesRatio > 0.9) {
            analysis = 'strong_defense';
        }

        const memoryEntry = {
            enemyPlayerId,
            type: isMyAttack ? 'attack' : 'defense',
            embedding,
            analysis
        };

        this.addMemory(memoryEntry);
    }

    recordEspionage(report) {
        if (!report.payload) return;
        const enemyPlayerId = report.defender.ownerId;
        if (!enemyPlayerId || enemyPlayerId === 'nature') return;

        const memoryEntry = {
            enemyPlayerId,
            type: 'espionage',
            embedding: [
                report.payload.resources.wood,
                report.payload.resources.stone,
                report.payload.resources.iron,
                report.payload.resources.food,
                report.payload.poder_defensivo_calculado || 0,
                report.time
            ],
            analysis: 'successful_espionage',
            details: {
                troops: report.payload.troops
            }
        };
        this.addMemory(memoryEntry);
    }

    addMemory(entry) {
        this.memoryLog.push(entry);
        if (this.memoryLog.length > MAX_MEMORY_ENTRIES) {
            this.memoryLog.shift();
        }
    }

    calculateLossRatio(summary, initialTroops) {
        const initialUpkeep = Object.entries(initialTroops).reduce((sum, [unitId, count]) => {
            const unitData = this.findUnitData(unitId);
            return sum + (unitData ? unitData.upkeep * count : 0);
        }, 0);

        if (initialUpkeep === 0) return 0;
        return (summary.lostUpkeep || 0) / initialUpkeep;
    }

    findUnitData(unitId) {
        for (const race in gameData.units) {
            const troop = gameData.units[race].troops.find(t => t.id === unitId);
            if (troop) return troop;
        }
        return null;
    }
}