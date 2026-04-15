// RUTA: js/ai/AIActionExecutor.js
import { getTrainingBuildingForUnitId, resolveUnitIdForRace } from './utils/AIUnitUtils.js';
import { getResourceTypeFromStep, manageConstructionForGoal } from './action-executor/construction.js';
import { manageProportionalRecruitment, manageRecruitmentForGoal } from './action-executor/recruitment.js';
import { executeDefensiveStance, shouldEndDefensiveStance } from './action-executor/responses.js';
import {
    executeFarmOases,
    executeRebalanceResources,
    executeSettleNewVillage,
} from './action-executor/goal-actions.js';

class AIActionExecutor {
    _controller;
    _reputationManager;

    constructor(controller) {
        this._controller = controller;
    }

    init(reputationManager) {
        this._reputationManager = reputationManager;
    }

    executePlanStep(village, step, gameState, activeGoal) {
        if (!step) return { success: false, reason: 'INVALID_STEP' };

        switch (step.type) {
            case 'building':
            case 'resource_fields_level':
                return this._manageConstructionForGoal(village, gameState, step);
            case 'units':
                return this._manageRecruitmentForGoal(village, gameState, step, activeGoal);
            case 'research':
                return this._manageResearchForGoal(village, gameState, step);
            case 'upgrade':
                return this._manageUpgradeForGoal(village, gameState, step);
            case 'proportional_units':
                return this._manageProportionalRecruitment(village, gameState, step, activeGoal);
            default:
                return { success: false, reason: 'UNKNOWN_STEP_TYPE' };
        }
    }

    _manageProportionalRecruitment(village, gameState, step, activeGoal) {
        return manageProportionalRecruitment({
            village,
            gameState,
            step,
            activeGoal,
            ownerId: this._controller.getOwnerId(),
            resolveUnitId: this.resolveUnitId.bind(this),
            manageRecruitmentForGoal: this._manageRecruitmentForGoal.bind(this),
            log: this._controller.log.bind(this._controller),
        });
    }

    _manageRecruitmentForGoal(village, gameState, step, activeGoal = null) {
        return manageRecruitmentForGoal({
            village,
            gameState,
            step,
            ownerId: this._controller.getOwnerId(),
            race: this._controller.getRace(),
            resolveUnitId: this.resolveUnitId.bind(this),
            getTrainingBuildingForUnit: this.getTrainingBuildingForUnit.bind(this),
            sendCommand: this._controller.getSendCommand(),
            log: this._controller.log.bind(this._controller),
            goalScope: activeGoal?.scope,
            gameSpeed: this._controller.getGameConfig()?.gameSpeed || 1,
            difficulty: this._controller.getDifficulty(),
        });
    }

    _attemptUpgrade(village, building, newType = null) {
        const result = this._attemptUpgradeDetailed(village, building, newType);
        return Boolean(result?.success);
    }

    _attemptUpgradeDetailed(village, building, newType = null) {
        const typeToBuild = newType || building.type;
        const result = this._controller.getSendCommand()('upgrade_building', {
            buildingId: building.id,
            buildingType: typeToBuild,
            villageId: village.id,
        });
        return result;
    }

    getResourceTypeFromStep(step) {
        return getResourceTypeFromStep(step);
    }

    _manageConstructionForGoal(village, gameState, step) {
        return manageConstructionForGoal({
            village,
            gameState,
            step,
            attemptUpgrade: this._attemptUpgrade.bind(this),
            attemptUpgradeDetailed: this._attemptUpgradeDetailed.bind(this),
            log: this._controller.log.bind(this._controller),
        });
    }

    _manageResearchForGoal(village, gameState, step) {
        const unitId = this.resolveUnitId(step.unitType);
        if (!unitId) return { success: false, reason: 'INVALID_UNIT_ID' };

        if (village.research.completed.includes(unitId)) {
            return { success: true, reason: 'ALREADY_RESEARCHED', unitId };
        }

        if (village.research.queue.some(job => job.unitId === unitId)) {
            return { success: true, reason: 'ALREADY_QUEUED', unitId };
        }

        const result = this._controller.getSendCommand()('research_unit', { unitId, villageId: village.id });
        if (result.success) {
            this._controller.log('success', village, 'Investigación', `Orden para investigar ${unitId} enviada con éxito.`);
        } else {
            this._controller.log('fail', village, 'Investigación', `La orden para investigar ${unitId} fue rechazada. Razón: ${result.reason}`, result.details);
        }
        return { success: result.success, reason: result.reason, unitId };
    }

    _manageUpgradeForGoal(village, gameState, step) {
        const unitId = this.resolveUnitId(step.unitType);
        if (!unitId) return { success: false, reason: 'INVALID_UNIT_ID' };

        if ((village.smithy.upgrades[unitId] || 0) >= step.level) return { success: true };

        const result = this._controller.getSendCommand()('upgrade_unit', { unitId, villageId: village.id });
        if (result.success) {
            this._controller.log('success', village, 'Herrería', `Orden para mejorar ${unitId} enviada con éxito.`);
        } else {
            this._controller.log('fail', village, 'Herrería', `La orden para mejorar ${unitId} fue rechazada. Razón: ${result.reason}`, result.details);
        }
        return { success: result.success, reason: result.reason };
    }

    resolveUnitId(identifier) {
        return resolveUnitIdForRace(identifier, this._controller.getRace());
    }

    getTrainingBuildingForUnit(unitId) {
        return getTrainingBuildingForUnitId(unitId, this._controller.getRace());
    }

    shouldEndDefensiveStance(gameState, lastAttackerInfo) {
        return shouldEndDefensiveStance({
            gameState,
            lastAttackerInfo,
            log: this._controller.log.bind(this._controller),
        });
    }

    executeDefensiveStance(villages, gameState, archetype, lastAttackerInfo) {
        return executeDefensiveStance({
            villages,
            gameState,
            archetype,
            lastAttackerInfo,
            race: this._controller.getRace(),
            personality: this._controller.getPersonality(),
            manageRecruitmentForGoal: this._manageRecruitmentForGoal.bind(this),
            attemptUpgrade: this._attemptUpgrade.bind(this),
            sendCommand: this._controller.getSendCommand(),
            log: this._controller.log.bind(this._controller),
        });
    }

    executeGoalAction(action, villages, gameState) {
        switch (action.type) {
            case 'settle_new_village':
                executeSettleNewVillage({
                    villages,
                    gameState,
                    ownerId: this._controller.getOwnerId(),
                    resolveUnitId: this.resolveUnitId.bind(this),
                    sendCommand: this._controller.getSendCommand(),
                    log: this._controller.log.bind(this._controller),
                });
                break;
            case 'farm_oases_in_radius':
                executeFarmOases({
                    action,
                    villages,
                    gameState,
                    race: this._controller.getRace(),
                    troopSpeed: this._controller.getGameConfig().troopSpeed || 1,
                    sendCommand: this._controller.getSendCommand(),
                    log: this._controller.log.bind(this._controller),
                });
                break;
            case 'rebalance_resources':
                executeRebalanceResources({
                    action,
                    villages,
                    sendCommand: this._controller.getSendCommand(),
                    log: this._controller.log.bind(this._controller),
                });
                break;
        }
    }
}

export default AIActionExecutor;
