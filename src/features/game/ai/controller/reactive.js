import { gameData } from '../../core/GameData.js';
import { CombatFormulas } from '../../core/CombatFormulas.js';

const HOSTILE_MOVEMENT_TYPES = new Set(['attack', 'raid']);
const MULTI_WAVE_WINDOW_MS = 90000;
const DEFAULT_DODGE_CONFIG = Object.freeze({
    offensivePartialRatio: 0.75,
    defensivePartialRatio: 0.35,
    hybridPartialRatio: 0.55,
    minGarrisonUnits: 30,
    minDefensiveGarrisonUnits: 20,
    fullDodgeMaxStrategicScore: 55,
    fullDodgeMinLossSeverity: 'high',
});
const LOSS_SEVERITY_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
const DEFAULT_COUNTER_CONFIG = Object.freeze({
    windowTtlMs: 45000,
    retaliationCooldownMs: 90000,
    threatLookaheadMs: 60000,
    minResidualDefenseRatio: 0.45,
    maxCounterpressureRatio: 0.25,
    maxCounterattackRatio: 0.45,
    maxPunitiveSiegeRatio: 0.6,
    minCounterTroops: 20,
});

function getDodgeConfig(gameConfig) {
    const cfg = gameConfig?.aiReactive?.dodge || {};
    return {
        offensivePartialRatio: cfg.offensivePartialRatio ?? DEFAULT_DODGE_CONFIG.offensivePartialRatio,
        defensivePartialRatio: cfg.defensivePartialRatio ?? DEFAULT_DODGE_CONFIG.defensivePartialRatio,
        hybridPartialRatio: cfg.hybridPartialRatio ?? DEFAULT_DODGE_CONFIG.hybridPartialRatio,
        minGarrisonUnits: cfg.minGarrisonUnits ?? DEFAULT_DODGE_CONFIG.minGarrisonUnits,
        minDefensiveGarrisonUnits: cfg.minDefensiveGarrisonUnits ?? DEFAULT_DODGE_CONFIG.minDefensiveGarrisonUnits,
        fullDodgeMaxStrategicScore: cfg.fullDodgeMaxStrategicScore ?? DEFAULT_DODGE_CONFIG.fullDodgeMaxStrategicScore,
        fullDodgeMinLossSeverity: cfg.fullDodgeMinLossSeverity ?? DEFAULT_DODGE_CONFIG.fullDodgeMinLossSeverity,
    };
}

function getCounterConfig(gameConfig, doctrine = null) {
    const cfg = gameConfig?.aiReactive?.counterattack || {};
    const resolved = {
        windowTtlMs: cfg.windowTtlMs ?? DEFAULT_COUNTER_CONFIG.windowTtlMs,
        retaliationCooldownMs: cfg.retaliationCooldownMs ?? DEFAULT_COUNTER_CONFIG.retaliationCooldownMs,
        threatLookaheadMs: cfg.threatLookaheadMs ?? DEFAULT_COUNTER_CONFIG.threatLookaheadMs,
        minResidualDefenseRatio: cfg.minResidualDefenseRatio ?? DEFAULT_COUNTER_CONFIG.minResidualDefenseRatio,
        maxCounterpressureRatio: cfg.maxCounterpressureRatio ?? DEFAULT_COUNTER_CONFIG.maxCounterpressureRatio,
        maxCounterattackRatio: cfg.maxCounterattackRatio ?? DEFAULT_COUNTER_CONFIG.maxCounterattackRatio,
        maxPunitiveSiegeRatio: cfg.maxPunitiveSiegeRatio ?? DEFAULT_COUNTER_CONFIG.maxPunitiveSiegeRatio,
        minCounterTroops: cfg.minCounterTroops ?? DEFAULT_COUNTER_CONFIG.minCounterTroops,
    };

    if (!doctrine?.counter) {
        return resolved;
    }

    const doctrineCounter = doctrine.counter;
    if (Number.isFinite(doctrineCounter.minResidualDefenseRatio)) {
        resolved.minResidualDefenseRatio = doctrineCounter.minResidualDefenseRatio;
    }
    if (Number.isFinite(doctrineCounter.maxCounterpressureRatio)) {
        resolved.maxCounterpressureRatio = doctrineCounter.maxCounterpressureRatio;
    }
    if (Number.isFinite(doctrineCounter.maxCounterattackRatio)) {
        resolved.maxCounterattackRatio = doctrineCounter.maxCounterattackRatio;
    }
    if (Number.isFinite(doctrineCounter.maxPunitiveSiegeRatio)) {
        resolved.maxPunitiveSiegeRatio = doctrineCounter.maxPunitiveSiegeRatio;
    }
    if (Number.isFinite(doctrineCounter.minCounterTroops)) {
        resolved.minCounterTroops = doctrineCounter.minCounterTroops;
    }

    return resolved;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function getUnitData(race, unitId) {
    return gameData.units[race]?.troops?.find(unit => unit.id === unitId) || null;
}

function toPositiveTroopMap(troops = {}) {
    const clean = {};
    for (const unitId in troops) {
        const count = troops[unitId] || 0;
        if (count > 0) clean[unitId] = count;
    }
    return clean;
}

function getTroopCount(troops = {}) {
    return Object.values(troops).reduce((sum, count) => sum + (count || 0), 0);
}

function subtractTroops(baseTroops = {}, toSubtract = {}) {
    const result = {};
    const unitIds = new Set([...Object.keys(baseTroops), ...Object.keys(toSubtract)]);
    unitIds.forEach(unitId => {
        const remaining = (baseTroops[unitId] || 0) - (toSubtract[unitId] || 0);
        if (remaining > 0) result[unitId] = remaining;
    });
    return result;
}

function addTroopCount(map, unitId, count) {
    if (count <= 0) return;
    map[unitId] = (map[unitId] || 0) + count;
}

function getVillageStrategicValueScore(village, race) {
    let score = 0;
    const buildings = village.buildings || [];

    const hasPalace = buildings.some(building => building.type === 'palace' && building.level >= 10);
    const hasAcademy = buildings.some(building => building.type === 'academy' && building.level >= 10);
    const hasWorkshop = buildings.some(building => building.type === 'workshop' && building.level >= 5);
    if (hasPalace) score += 20;
    if (hasAcademy) score += 10;
    if (hasWorkshop) score += 8;

    const troops = village.unitsInVillage || {};
    const roles = getRoleCompositionScore(troops, race);
    if (roles.offensiveRatio >= 0.65 && getTroopCount(troops) >= 140) score += 20;

    for (const unitId in troops) {
        const unitData = getUnitData(race, unitId);
        const count = troops[unitId] || 0;
        if (!unitData || count <= 0) continue;
        if (unitData.type === 'chief' || unitData.type === 'settler' || unitData.role === 'conquest' || unitData.role === 'colonization') {
            score += 15;
            break;
        }
    }

    if ((village.population?.current || 0) >= 600) score += 8;

    return score;
}

function shouldAllowFullDodge({ evaluation, targetVillage, race, gameConfig, doctrine }) {
    const dodgeConfig = getDodgeConfig(gameConfig);
    const strategicValueScore = getVillageStrategicValueScore(targetVillage, race);
    const roleScore = getRoleCompositionScore(targetVillage.unitsInVillage || {}, race);
    const lossSeverityOrder = LOSS_SEVERITY_ORDER[evaluation.projectedLossSeverity] ?? LOSS_SEVERITY_ORDER.low;
    const requiredSeverityName = doctrine?.fullDodgeMinLossSeverity || dodgeConfig.fullDodgeMinLossSeverity;
    const requiredSeverityOrder = LOSS_SEVERITY_ORDER[requiredSeverityName] ?? LOSS_SEVERITY_ORDER.high;
    const maxStrategicScore = Number.isFinite(doctrine?.fullDodgeMaxStrategicScore)
        ? doctrine.fullDodgeMaxStrategicScore
        : dodgeConfig.fullDodgeMaxStrategicScore;

    const clearDefeat = !evaluation.canHoldWithReinforcements;
    const severeLosses = lossSeverityOrder >= requiredSeverityOrder;
    const offensiveCorePresent = roleScore.offensiveRatio >= (doctrine?.preserveOffenseRatio || 0.62);
    const acceptableStrategicLoss = strategicValueScore <= maxStrategicScore;

    let allow = clearDefeat && severeLosses && acceptableStrategicLoss;

    if (!allow && doctrine?.id === 'germanic_reactive') {
        const highThreat = evaluation.threatLevel === 'high' || evaluation.threatLevel === 'critical';
        const eligibleByCore = doctrine.fullDodgeAllowForOffenseCore && offensiveCorePresent && highThreat;
        allow = clearDefeat && severeLosses && (acceptableStrategicLoss || eligibleByCore);
    }

    if (doctrine?.id === 'egyptian_reactive') {
        const criticalThreat = evaluation.threatType === 'conquest_attack'
            || evaluation.threatType === 'siege_attack'
            || evaluation.projectedLossSeverity === 'critical';
        allow = allow && criticalThreat;
    }

    return {
        allow,
        strategicValueScore,
        clearDefeat,
        severeLosses,
        acceptableStrategicLoss,
        offensiveCorePresent,
        doctrineId: doctrine?.id || 'unknown',
    };
}

function collectTroopsByPriority(village, race, priorityGroups) {
    const orderedCandidates = [];
    const troops = village.unitsInVillage || {};

    for (const unitId in troops) {
        const count = troops[unitId] || 0;
        if (count <= 0) continue;

        const unitData = getUnitData(race, unitId);
        if (!unitData) continue;

        const groupIndex = priorityGroups.findIndex(group => group(unitData));
        if (groupIndex === -1) continue;

        orderedCandidates.push({ unitId, count, groupIndex });
    }

    orderedCandidates.sort((a, b) => a.groupIndex - b.groupIndex);
    return orderedCandidates;
}

function splitTroopsByPriorityRatio({ village, race, dodgeRatio, minGarrisonUnits, priorityGroups }) {
    const allTroops = toPositiveTroopMap(village.unitsInVillage || {});
    const totalUnits = getTroopCount(allTroops);
    const targetDodgeUnits = Math.floor(totalUnits * dodgeRatio);
    const maxDodgeUnits = Math.max(0, totalUnits - minGarrisonUnits);
    const effectiveDodgeUnits = Math.min(targetDodgeUnits, maxDodgeUnits);
    const troopsToDodge = {};

    const candidates = collectTroopsByPriority(village, race, priorityGroups);

    let selected = 0;
    for (const candidate of candidates) {
        if (selected >= effectiveDodgeUnits) break;
        const remaining = effectiveDodgeUnits - selected;
        const take = Math.min(candidate.count, remaining);
        addTroopCount(troopsToDodge, candidate.unitId, take);
        selected += take;
    }

    return {
        troopsToDodge: toPositiveTroopMap(troopsToDodge),
        troopsToHold: subtractTroops(allTroops, troopsToDodge),
        targetDodgeUnits: effectiveDodgeUnits,
    };
}

function isConquestUnit(unitData) {
    if (!unitData) return false;
    return unitData.type === 'chief'
        || unitData.type === 'settler'
        || unitData.role === 'conquest'
        || unitData.role === 'colonization';
}

function splitTroopsForOffensivePartialDodge(village, race, gameConfig) {
    const dodgeConfig = getDodgeConfig(gameConfig);
    const allTroops = toPositiveTroopMap(village.unitsInVillage || {});
    const totalUnits = getTroopCount(allTroops);
    const targetDodgeUnits = Math.floor(totalUnits * dodgeConfig.offensivePartialRatio);
    const maxDodgeUnits = Math.max(0, totalUnits - dodgeConfig.minGarrisonUnits);
    const effectiveDodgeUnits = Math.min(targetDodgeUnits, maxDodgeUnits);
    const troopsToDodge = {};

    const candidates = collectTroopsByPriority(village, race, [
        unit => unit.type === 'infantry' && unit.role === 'offensive',
        unit => unit.type === 'cavalry' && unit.role === 'offensive',
        unit => unit.type === 'siege' || unit.role === 'ram' || unit.role === 'catapult',
        unit => unit.type === 'scout' || unit.role === 'scout',
        unit => unit.type === 'settler' || unit.type === 'chief' || unit.role === 'conquest' || unit.role === 'colonization',
        unit => unit.role === 'versatile',
    ]);

    let selected = 0;
    for (const candidate of candidates) {
        if (selected >= effectiveDodgeUnits) break;
        const remaining = effectiveDodgeUnits - selected;
        const take = Math.min(candidate.count, remaining);
        addTroopCount(troopsToDodge, candidate.unitId, take);
        selected += take;
    }

    return {
        troopsToDodge: toPositiveTroopMap(troopsToDodge),
        troopsToHold: subtractTroops(allTroops, troopsToDodge),
        targetDodgeUnits: effectiveDodgeUnits,
    };
}

function splitTroopsForDefensivePartialDodge(village, race, gameConfig) {
    const dodgeConfig = getDodgeConfig(gameConfig);
    const allTroops = toPositiveTroopMap(village.unitsInVillage || {});
    const totalUnits = getTroopCount(allTroops);
    const targetDodgeUnits = Math.floor(totalUnits * dodgeConfig.defensivePartialRatio);
    const maxDodgeUnits = Math.max(0, totalUnits - dodgeConfig.minDefensiveGarrisonUnits);
    const effectiveDodgeUnits = Math.min(targetDodgeUnits, maxDodgeUnits);
    const troopsToDodge = {};

    const candidates = collectTroopsByPriority(village, race, [
        unit => unit.type === 'settler' || unit.type === 'chief' || unit.role === 'conquest' || unit.role === 'colonization',
        unit => unit.type === 'scout' || unit.role === 'scout',
        unit => unit.role === 'offensive' || unit.role === 'catapult' || unit.role === 'ram' || unit.type === 'siege',
        unit => unit.role === 'versatile',
    ]);

    let selected = 0;
    for (const candidate of candidates) {
        if (selected >= effectiveDodgeUnits) break;
        const remaining = effectiveDodgeUnits - selected;
        const take = Math.min(candidate.count, remaining);
        addTroopCount(troopsToDodge, candidate.unitId, take);
        selected += take;
    }

    return {
        troopsToDodge: toPositiveTroopMap(troopsToDodge),
        troopsToHold: subtractTroops(allTroops, troopsToDodge),
        targetDodgeUnits: effectiveDodgeUnits,
    };
}

function splitTroopsForHybridPartialDodge(village, race, gameConfig) {
    const dodgeConfig = getDodgeConfig(gameConfig);
    const allTroops = toPositiveTroopMap(village.unitsInVillage || {});
    const totalUnits = getTroopCount(allTroops);
    const targetDodgeUnits = Math.floor(totalUnits * dodgeConfig.hybridPartialRatio);
    const maxDodgeUnits = Math.max(0, totalUnits - dodgeConfig.minGarrisonUnits);
    const effectiveDodgeUnits = Math.min(targetDodgeUnits, maxDodgeUnits);
    const troopsToDodge = {};

    const candidates = collectTroopsByPriority(village, race, [
        unit => unit.type === 'settler' || unit.type === 'chief' || unit.role === 'conquest' || unit.role === 'colonization',
        unit => unit.role === 'offensive',
        unit => unit.type === 'siege' || unit.role === 'ram' || unit.role === 'catapult',
        unit => unit.type === 'scout' || unit.role === 'scout',
        unit => unit.role === 'versatile',
    ]);

    let selected = 0;
    for (const candidate of candidates) {
        if (selected >= effectiveDodgeUnits) break;
        const remaining = effectiveDodgeUnits - selected;
        const take = Math.min(candidate.count, remaining);
        addTroopCount(troopsToDodge, candidate.unitId, take);
        selected += take;
    }

    return {
        troopsToDodge: toPositiveTroopMap(troopsToDodge),
        troopsToHold: subtractTroops(allTroops, troopsToDodge),
        targetDodgeUnits: effectiveDodgeUnits,
    };
}

function splitTroopsForGermanicPartialDodge(village, race, evaluation, gameConfig) {
    const dodgeConfig = getDodgeConfig(gameConfig);
    const roleScore = getRoleCompositionScore(village.unitsInVillage || {}, race);
    const severeThreat = evaluation.threatLevel === 'high'
        || evaluation.threatLevel === 'critical'
        || evaluation.threatType === 'siege_attack'
        || evaluation.threatType === 'conquest_attack';
    const baseRatio = severeThreat ? 0.82 : 0.72;
    const offenseBias = roleScore.offensiveRatio >= 0.62 ? 0.06 : 0;
    const dodgeRatio = Math.min(0.92, Math.max(baseRatio + offenseBias, dodgeConfig.offensivePartialRatio));

    return {
        ...splitTroopsByPriorityRatio({
            village,
            race,
            dodgeRatio,
            minGarrisonUnits: Math.max(10, Math.floor(dodgeConfig.minGarrisonUnits * 0.6)),
            priorityGroups: [
                unit => isConquestUnit(unit),
                unit => unit.type === 'siege' || unit.role === 'catapult' || unit.role === 'ram',
                unit => unit.role === 'offensive',
                unit => unit.type === 'scout' || unit.role === 'scout',
                unit => unit.role === 'versatile',
                unit => unit.role === 'defensive',
            ],
        }),
        planType: 'partial_germanic_core_preserve',
    };
}

function splitTroopsForEgyptianPartialDodge(village, race, evaluation, gameConfig) {
    const dodgeConfig = getDodgeConfig(gameConfig);
    const roleScore = getRoleCompositionScore(village.unitsInVillage || {}, race);
    const underHeavyPressure = evaluation.threatLevel === 'high'
        || evaluation.threatLevel === 'critical'
        || !evaluation.canHoldWithReinforcements;
    const baseRatio = underHeavyPressure ? 0.48 : 0.34;
    const offenseBias = roleScore.offensiveRatio >= 0.5 ? 0.08 : 0;
    const dodgeRatio = Math.min(0.62, Math.max(baseRatio + offenseBias, dodgeConfig.defensivePartialRatio));

    return {
        ...splitTroopsByPriorityRatio({
            village,
            race,
            dodgeRatio,
            minGarrisonUnits: Math.max(30, dodgeConfig.minDefensiveGarrisonUnits + 12),
            priorityGroups: [
                unit => unit.type === 'scout' || unit.role === 'scout',
                unit => unit.role === 'offensive' || unit.type === 'siege' || unit.role === 'catapult' || unit.role === 'ram',
                unit => isConquestUnit(unit),
                unit => unit.role === 'versatile',
                unit => unit.role === 'defensive',
            ],
        }),
        planType: 'partial_egyptian_guarded_dodge',
    };
}

function buildDodgeTroopPlan({ targetVillage, race, posture, responseType, evaluation, doctrine, gameConfig }) {
    const allTroops = toPositiveTroopMap(targetVillage.unitsInVillage || {});

    if (responseType === 'full_dodge') {
        return {
            troopsToDodge: allTroops,
            troopsToHold: {},
            planType: 'full_dodge',
        };
    }

    if (doctrine?.dodgeProfile === 'germanic') {
        return splitTroopsForGermanicPartialDodge(targetVillage, race, evaluation, gameConfig);
    }

    if (doctrine?.dodgeProfile === 'egyptian') {
        return splitTroopsForEgyptianPartialDodge(targetVillage, race, evaluation, gameConfig);
    }

    if (posture === 'offensive') {
        const split = splitTroopsForOffensivePartialDodge(targetVillage, race, gameConfig);
        return {
            ...split,
            planType: 'partial_offensive',
        };
    }

    if (posture === 'defensive') {
        const split = splitTroopsForDefensivePartialDodge(targetVillage, race, gameConfig);
        return {
            ...split,
            planType: 'partial_defensive',
        };
    }

    const split = splitTroopsForHybridPartialDodge(targetVillage, race, gameConfig);
    return {
        ...split,
        planType: 'partial_hybrid',
        projectedLossSeverity: evaluation.projectedLossSeverity,
    };
}

function getSlowestUnitSpeed(troops, race) {
    let slowestSpeed = Infinity;
    for (const unitId in troops) {
        if ((troops[unitId] || 0) <= 0) continue;
        const unitData = getUnitData(race, unitId);
        if (unitData && unitData.stats.speed < slowestSpeed) {
            slowestSpeed = unitData.stats.speed;
        }
    }
    return slowestSpeed === Infinity ? 0 : slowestSpeed;
}

function calculateTravelTime(originCoords, targetCoords, slowestSpeed, troopSpeed) {
    if (slowestSpeed <= 0) return Infinity;
    const distance = Math.hypot(targetCoords.x - originCoords.x, targetCoords.y - originCoords.y);
    return ((distance / (slowestSpeed * troopSpeed)) * 3600) * 1000;
}

function toTroopSubsetByRoles(troops, race, acceptedRoles = []) {
    const accepted = new Set(acceptedRoles);
    const filtered = {};

    for (const unitId in troops) {
        const count = troops[unitId] || 0;
        if (count <= 0) continue;

        const unitData = getUnitData(race, unitId);
        if (!unitData) continue;
        if (!accepted.has(unitData.role)) continue;
        filtered[unitId] = count;
    }

    return filtered;
}

function toTroopSubsetByPredicate(troops, race, predicate) {
    const filtered = {};
    for (const unitId in troops) {
        const count = troops[unitId] || 0;
        if (count <= 0) continue;
        const unitData = getUnitData(race, unitId);
        if (!unitData || !predicate(unitData, count, unitId)) continue;
        filtered[unitId] = count;
    }
    return filtered;
}

function getOffensiveCoreTroops(troops, race) {
    return toTroopSubsetByPredicate(troops, race, unit =>
        unit.role === 'offensive'
        || unit.role === 'catapult'
        || unit.role === 'ram'
        || unit.role === 'conquest'
        || unit.role === 'colonization'
        || unit.type === 'chief'
        || unit.type === 'settler',
    );
}

function buildReservedTroopsForReactiveState({ targetVillage, race, preferredResponse, doctrine, evaluation }) {
    const allTroops = toPositiveTroopMap(targetVillage.unitsInVillage || {});

    if (preferredResponse === 'full_dodge'
        || preferredResponse === 'partial_dodge'
        || preferredResponse === 'hold_with_reinforcements'
        || preferredResponse === 'reinforce') {
        return allTroops;
    }

    const threatLevel = evaluation?.threatLevel || 'none';
    if (threatLevel === 'low' && preferredResponse === 'hold') {
        return {};
    }

    if (doctrine?.id === 'egyptian_reactive') {
        const defensiveCore = toTroopSubsetByRoles(allTroops, race, ['defensive', 'versatile']);
        const strategicCore = toTroopSubsetByPredicate(allTroops, race, unit =>
            unit.type === 'scout' || isConquestUnit(unit),
        );
        return toPositiveTroopMap({ ...defensiveCore, ...strategicCore });
    }

    if (evaluation?.shouldPreserveOffense) {
        return getOffensiveCoreTroops(allTroops, race);
    }

    return toTroopSubsetByRoles(allTroops, race, ['defensive', 'versatile']);
}

function isCombatTroop(unitData) {
    if (!unitData) return false;
    return unitData.type !== 'merchant';
}

function getRoleCompositionScore(troops, race) {
    let offensive = 0;
    let defensive = 0;

    for (const unitId in troops) {
        const count = troops[unitId] || 0;
        if (count <= 0) continue;

        const unitData = getUnitData(race, unitId);
        if (!isCombatTroop(unitData)) continue;

        const weightedCount = count * (unitData.upkeep || 1);
        if (unitData.role === 'offensive' || unitData.role === 'catapult' || unitData.role === 'ram') {
            offensive += weightedCount;
        } else if (unitData.role === 'defensive') {
            defensive += weightedCount;
        } else if (unitData.role === 'versatile' || unitData.role === 'scout') {
            offensive += weightedCount * 0.5;
            defensive += weightedCount * 0.5;
        }
    }

    const total = offensive + defensive;
    return {
        offensive,
        defensive,
        offensiveRatio: total > 0 ? offensive / total : 0,
        defensiveRatio: total > 0 ? defensive / total : 0,
    };
}

function getRaceDoctrinePosture(race) {
    if (race === 'germans' || race === 'huns') return 'offensive';
    if (race === 'gauls' || race === 'egyptians') return 'defensive';
    if (race === 'romans') return 'hybrid';
    return 'hybrid';
}

function getReactiveDoctrine(race, archetype) {
    const isGermanic = race === 'germans' || race === 'huns' || archetype === 'rusher';
    const isEgyptian = race === 'egyptians' || archetype === 'turtle';

    if (isGermanic) {
        return {
            id: 'germanic_reactive',
            preserveOffenseRatio: 0.55,
            reinforcePreference: 'situational',
            dodgeProfile: 'germanic',
            fullDodgeMinLossSeverity: 'high',
            fullDodgeMaxStrategicScore: 85,
            fullDodgeAllowForOffenseCore: true,
            counter: {
                minCounterpressureVulnerability: 0.55,
                minCounterattackVulnerability: 0.9,
                minResidualDefenseRatio: 0.38,
                maxCounterpressureRatio: 0.33,
                maxCounterattackRatio: 0.5,
                maxPunitiveSiegeRatio: 0.62,
                minCounterTroops: 18,
                minOffensiveCoreRetentionRatio: 0.55,
                futureThreatResidualRatio: 0.55,
            },
        };
    }

    if (isEgyptian) {
        return {
            id: 'egyptian_reactive',
            preserveOffenseRatio: 0.7,
            reinforcePreference: 'high',
            dodgeProfile: 'egyptian',
            fullDodgeMinLossSeverity: 'critical',
            fullDodgeMaxStrategicScore: 42,
            fullDodgeAllowForOffenseCore: false,
            counter: {
                minCounterpressureVulnerability: 0.95,
                minCounterattackVulnerability: 1.2,
                minResidualDefenseRatio: 0.62,
                maxCounterpressureRatio: 0.18,
                maxCounterattackRatio: 0.3,
                maxPunitiveSiegeRatio: 0.38,
                minCounterTroops: 26,
                minOffensiveCoreRetentionRatio: 0.88,
                futureThreatResidualRatio: 0.85,
            },
        };
    }

    return {
        id: 'balanced_reactive',
        preserveOffenseRatio: 0.62,
        reinforcePreference: 'normal',
        dodgeProfile: 'hybrid',
        fullDodgeMinLossSeverity: 'high',
        fullDodgeMaxStrategicScore: 55,
        fullDodgeAllowForOffenseCore: false,
        counter: {
            minCounterpressureVulnerability: 0.65,
            minCounterattackVulnerability: 0.98,
            minResidualDefenseRatio: 0.48,
            maxCounterpressureRatio: 0.24,
            maxCounterattackRatio: 0.42,
            maxPunitiveSiegeRatio: 0.55,
            minCounterTroops: 20,
            minOffensiveCoreRetentionRatio: 0.7,
            futureThreatResidualRatio: 0.65,
        },
    };
}

function getAttackerTroopFlags(troops, attackerRace) {
    let hasSiege = false;
    let hasConquest = false;

    for (const unitId in troops) {
        const count = troops[unitId] || 0;
        if (count <= 0) continue;

        const unitData = getUnitData(attackerRace, unitId);
        if (!unitData) continue;

        if (unitData.role === 'catapult' || unitData.role === 'ram') {
            hasSiege = true;
        }
        if (
            unitData.role === 'conquest' ||
            unitData.role === 'colonization' ||
            unitData.type === 'chief' ||
            unitData.type === 'settler'
        ) {
            hasConquest = true;
        }
    }

    return { hasSiege, hasConquest };
}

function classifyThreat({ movement, gameState, targetVillage, attackerRace, attackPower }) {
    const now = Date.now();
    const payloadTroops = movement.payload?.troops || {};
    const { hasSiege, hasConquest } = getAttackerTroopFlags(payloadTroops, attackerRace);

    const incomingToSameVillage = gameState.movements.filter(candidate => {
        if (!HOSTILE_MOVEMENT_TYPES.has(candidate.type)) return false;
        if (candidate.ownerId === targetVillage.ownerId) return false;
        if (!candidate.targetCoords) return false;
        if (candidate.targetCoords.x !== targetVillage.coords.x || candidate.targetCoords.y !== targetVillage.coords.y) return false;
        if ((candidate.arrivalTime || now) < now) return false;
        return Math.abs((candidate.arrivalTime || now) - (movement.arrivalTime || now)) <= MULTI_WAVE_WINDOW_MS;
    });

    const hasMultiWave = incomingToSameVillage.length >= 2;
    const raidLike = movement.type === 'raid' || attackPower <= (targetVillage.population?.current || 0);

    if (hasConquest) {
        return { threatType: 'conquest_attack', threatLevel: 'critical', hasSiege, hasConquest, hasMultiWave };
    }
    if (hasSiege) {
        return { threatType: 'siege_attack', threatLevel: 'high', hasSiege, hasConquest, hasMultiWave };
    }
    if (hasMultiWave) {
        return { threatType: 'multi_wave_attack', threatLevel: 'high', hasSiege, hasConquest, hasMultiWave };
    }
    if (raidLike) {
        return { threatType: 'light_raid', threatLevel: 'low', hasSiege, hasConquest, hasMultiWave };
    }
    return { threatType: 'standard_attack', threatLevel: 'medium', hasSiege, hasConquest, hasMultiWave };
}

function resolveCombatPosture({ race, archetype, targetVillage, threatType }) {
    let posture = getRaceDoctrinePosture(race);

    if (archetype === 'rusher') {
        posture = 'offensive';
    } else if (archetype === 'turtle') {
        posture = 'defensive';
    }

    const roleScore = getRoleCompositionScore(targetVillage.unitsInVillage || {}, race);
    const doctrinalDefensive = race === 'gauls' || race === 'egyptians';

    if (roleScore.defensiveRatio >= 0.62) {
        posture = 'defensive';
    } else if (roleScore.offensiveRatio >= (doctrinalDefensive ? 0.72 : 0.65)) {
        posture = 'offensive';
    }

    if ((threatType === 'siege_attack' || threatType === 'conquest_attack') && roleScore.defensiveRatio >= 0.45 && archetype !== 'rusher') {
        posture = 'defensive';
    }

    return {
        posture,
        roleScore,
    };
}

function getAttackerProportions(attackBreakdown) {
    const inf = attackBreakdown.infantry || 0;
    const cav = attackBreakdown.cavalry || 0;
    const total = inf + cav;

    if (total <= 0) {
        return { infantry: 0.5, cavalry: 0.5 };
    }

    return {
        infantry: inf / total,
        cavalry: cav / total,
    };
}

function estimateLocalDefense({ targetVillage, race, attackerProportions }) {
    const wallLevel = targetVillage.buildings.find(building => building.type === 'cityWall')?.level || 0;
    const palaceLevel = targetVillage.buildings.find(building => building.type === 'palace')?.level || 0;

    const defendingContingents = [{
        troops: targetVillage.unitsInVillage || {},
        race,
        smithyUpgrades: targetVillage.smithy?.upgrades || {},
    }];

    (targetVillage.reinforcements || []).forEach(reinforcement => {
        defendingContingents.push({
            troops: reinforcement.troops || {},
            race: reinforcement.race || race,
            smithyUpgrades: reinforcement.smithyUpgradesSnapshot || {},
        });
    });

    return CombatFormulas.calculateDefensePoints(
        defendingContingents,
        attackerProportions,
        race,
        wallLevel,
        palaceLevel,
    );
}

function hasCriticalIncomingThreat({ gameState, village, ownerId, lookaheadMs }) {
    const now = Date.now();

    return gameState.movements.some(movement => {
        if (!HOSTILE_MOVEMENT_TYPES.has(movement.type)) return false;
        if (movement.ownerId === ownerId) return false;
        if (!movement.targetCoords) return false;
        if (movement.targetCoords.x !== village.coords.x || movement.targetCoords.y !== village.coords.y) return false;

        const eta = (movement.arrivalTime || now) - now;
        if (eta < 0 || eta > lookaheadMs) return false;

        const enemyRace = gameState.players.find(player => player.id === movement.ownerId)?.race || 'romans';
        const flags = getAttackerTroopFlags(movement.payload?.troops || {}, enemyRace);
        return flags.hasConquest || flags.hasSiege || movement.type === 'attack';
    });
}

function openCounterWindow({ villageCombatState, villageId, movementId, ttlMs, reason }) {
    const now = Date.now();
    villageCombatState?.upsert?.(villageId, {
        counterWindowOpen: true,
        counterWindowExpiresAt: now + ttlMs,
        counterDecisionState: 'pending',
        counterDecisionReason: reason,
        counterDecisionAt: now,
    }, {
        sourceMovementIds: [movementId],
        ttlMs,
        lastDecisionReason: reason,
    });
}

function isCounterWindowAvailable(villageCombatState, villageId) {
    const state = villageCombatState?.get?.(villageId);
    if (!state || !state.counterWindowOpen || !state.counterWindowExpiresAt) {
        return false;
    }
    return state.counterWindowExpiresAt > Date.now();
}

function getCounterMode(evaluation, doctrine) {
    if (doctrine?.id === 'egyptian_reactive') {
        return 'counterpressure';
    }

    if (evaluation.preferredResponse === 'counterattack') {
        if (evaluation.analysis?.hasSiege && evaluation.canHoldLocally) return 'punitive_siege';
        return 'counterattack';
    }
    return 'counterpressure';
}

function getCounterDispatchRatio(counterMode, gameConfig, doctrine) {
    const counterConfig = getCounterConfig(gameConfig, doctrine);
    if (counterMode === 'punitive_siege') return counterConfig.maxPunitiveSiegeRatio;
    if (counterMode === 'counterattack') return counterConfig.maxCounterattackRatio;
    return counterConfig.maxCounterpressureRatio;
}

function estimateIncomingAttackPowerLookahead({ gameState, targetVillage, ownerId, lookaheadMs, excludeMovementId = null }) {
    const now = Date.now();
    const windowEnd = now + lookaheadMs;

    return gameState.movements.reduce((sum, movement) => {
        if (!movement || !HOSTILE_MOVEMENT_TYPES.has(movement.type)) return sum;
        if (movement.id === excludeMovementId) return sum;
        if (movement.ownerId === ownerId) return sum;
        if (!movement.targetCoords) return sum;
        if (movement.targetCoords.x !== targetVillage.coords.x || movement.targetCoords.y !== targetVillage.coords.y) return sum;

        const arrival = Number(movement.arrivalTime || 0);
        if (arrival < now || arrival > windowEnd) return sum;

        const attackerVillage = gameState.villages.find(village => village.id === movement.originVillageId);
        const attackerRace = attackerVillage?.race || gameState.players.find(player => player.id === movement.ownerId)?.race || 'romans';
        const attackerSmithy = attackerVillage?.smithy?.upgrades || {};
        const power = CombatFormulas.calculateAttackPoints(movement.payload?.troops || {}, attackerRace, attackerSmithy).total;
        return sum + power;
    }, 0);
}

function buildCounterTroopPlan({ targetVillage, attackerVillage, race, ownerId, gameState, movementId, evaluation, doctrine, gameConfig }) {
    if (!attackerVillage) {
        return { allowed: false, reason: 'NO_TARGET', counterMode: 'counterpressure' };
    }

    const counterConfig = getCounterConfig(gameConfig, doctrine);
    const counterMode = getCounterMode(evaluation, doctrine);
    const dispatchRatio = getCounterDispatchRatio(counterMode, gameConfig, doctrine);
    const allTroops = toPositiveTroopMap(targetVillage.unitsInVillage || {});
    const totalUnits = getTroopCount(allTroops);

    const offensivePool = collectTroopsByPriority(targetVillage, race, [
        unit => unit.type === 'siege' || unit.role === 'catapult' || unit.role === 'ram',
        unit => unit.role === 'offensive',
        unit => unit.role === 'versatile',
        unit => unit.type === 'scout' || unit.role === 'scout',
    ]);

    const targetDispatchUnits = Math.max(counterConfig.minCounterTroops, Math.floor(totalUnits * dispatchRatio));
    const selectedTroops = {};
    let selected = 0;

    for (const candidate of offensivePool) {
        if (selected >= targetDispatchUnits) break;
        const remaining = targetDispatchUnits - selected;
        const take = Math.min(candidate.count, remaining);
        addTroopCount(selectedTroops, candidate.unitId, take);
        selected += take;
    }

    if (Object.keys(selectedTroops).length === 0) {
        return { allowed: false, reason: 'NO_COUNTER_TROOPS', counterMode };
    }

    const remainingTroops = subtractTroops(allTroops, selectedTroops);
    const residualDefense = CombatFormulas.calculateDefensePoints(
        [{ troops: remainingTroops, race, smithyUpgrades: targetVillage.smithy?.upgrades || {} }],
        { infantry: 0.5, cavalry: 0.5 },
        race,
        targetVillage.buildings.find(building => building.type === 'cityWall')?.level || 0,
        targetVillage.buildings.find(building => building.type === 'palace')?.level || 0,
    );
    const requiredResidualDefense = Math.max(
        100,
        (evaluation.attackPowerEstimate || 0) * counterConfig.minResidualDefenseRatio,
    );
    const incomingLookaheadPower = estimateIncomingAttackPowerLookahead({
        gameState,
        targetVillage,
        ownerId,
        lookaheadMs: counterConfig.threatLookaheadMs,
        excludeMovementId: movementId,
    });
    const requiredByIncoming = incomingLookaheadPower * (doctrine?.counter?.futureThreatResidualRatio || 0.6);
    const finalRequiredResidualDefense = Math.max(requiredResidualDefense, requiredByIncoming);

    if (residualDefense < finalRequiredResidualDefense) {
        return {
            allowed: false,
            reason: 'LOW_RESIDUAL_DEFENSE',
            counterMode,
            residualDefense,
            requiredResidualDefense: finalRequiredResidualDefense,
            requiredResidualBase: requiredResidualDefense,
            incomingLookaheadPower,
        };
    }

    const attackerDefenseEstimate = CombatFormulas.calculateDefensePoints(
        [{ troops: attackerVillage.unitsInVillage || {}, race: attackerVillage.race, smithyUpgrades: attackerVillage.smithy?.upgrades || {} }],
        evaluation.attackerProportions || { infantry: 0.5, cavalry: 0.5 },
        attackerVillage.race,
        attackerVillage.buildings.find(building => building.type === 'cityWall')?.level || 0,
        attackerVillage.buildings.find(building => building.type === 'palace')?.level || 0,
    );
    const outgoingAttackEstimate = CombatFormulas.calculateAttackPoints(selectedTroops, race, targetVillage.smithy?.upgrades || {}).total;
    const vulnerabilityRatio = outgoingAttackEstimate / Math.max(attackerDefenseEstimate, 1);

    const minVulnerabilityRatio = counterMode === 'counterpressure'
        ? (doctrine?.counter?.minCounterpressureVulnerability || 0.6)
        : (doctrine?.counter?.minCounterattackVulnerability || 0.95);
    if (vulnerabilityRatio < minVulnerabilityRatio) {
        return {
            allowed: false,
            reason: 'TARGET_NOT_VULNERABLE',
            counterMode,
            outgoingAttackEstimate,
            attackerDefenseEstimate,
            vulnerabilityRatio,
            minVulnerabilityRatio,
        };
    }

    const offensiveCoreBefore = CombatFormulas.calculateAttackPoints(
        getOffensiveCoreTroops(allTroops, race),
        race,
        targetVillage.smithy?.upgrades || {},
    ).total;
    const offensiveCoreAfter = CombatFormulas.calculateAttackPoints(
        getOffensiveCoreTroops(remainingTroops, race),
        race,
        targetVillage.smithy?.upgrades || {},
    ).total;
    const offensiveCoreRetention = offensiveCoreBefore > 0 ? offensiveCoreAfter / offensiveCoreBefore : 1;
    const minOffensiveCoreRetentionRatio = doctrine?.counter?.minOffensiveCoreRetentionRatio || 0.7;

    if (offensiveCoreRetention < minOffensiveCoreRetentionRatio) {
        return {
            allowed: false,
            reason: 'OFFENSIVE_WINDOW_COMPROMISED',
            counterMode,
            offensiveCoreBefore,
            offensiveCoreAfter,
            offensiveCoreRetention,
            minOffensiveCoreRetentionRatio,
        };
    }

    return {
        allowed: true,
        counterMode,
        troops: selectedTroops,
        residualDefense,
        requiredResidualDefense: finalRequiredResidualDefense,
        outgoingAttackEstimate,
        attackerDefenseEstimate,
        vulnerabilityRatio,
        offensiveCoreRetention,
    };
}

function evaluateImperialDefense({ targetVillage, gameState, ownerId, gameConfig, attackPower, attackerProportions, movementArrivalTime, doctrine, threatType }) {
    const now = Date.now();
    const arrivalTime = movementArrivalTime || now;
    const myOtherVillages = gameState.villages.filter(village => village.ownerId === ownerId && village.id !== targetVillage.id);

    const reinforcementRoles = doctrine?.id === 'germanic_reactive'
        ? ((threatType === 'conquest_attack' || threatType === 'siege_attack') ? ['defensive', 'versatile'] : ['defensive'])
        : ['defensive', 'versatile'];

    let projectedDefense = 0;
    const reinforcementPlan = [];

    for (const village of myOtherVillages) {
        const defensiveTroops = toTroopSubsetByRoles(village.unitsInVillage || {}, village.race, reinforcementRoles);
        if (Object.keys(defensiveTroops).length === 0) continue;

        const slowestSpeed = getSlowestUnitSpeed(defensiveTroops, village.race);
        const travelTime = calculateTravelTime(village.coords, targetVillage.coords, slowestSpeed, gameConfig.troopSpeed || 1);
        if (now + travelTime > arrivalTime) continue;

        const power = CombatFormulas.calculateDefensePoints(
            [{ troops: defensiveTroops, race: village.race, smithyUpgrades: village.smithy?.upgrades || {} }],
            attackerProportions,
            targetVillage.race,
            targetVillage.buildings.find(building => building.type === 'cityWall')?.level || 0,
            targetVillage.buildings.find(building => building.type === 'palace')?.level || 0,
        );

        projectedDefense += power;
        reinforcementPlan.push({
            village,
            troops: defensiveTroops,
            power,
            travelTime,
        });
    }

    reinforcementPlan.sort((a, b) => a.travelTime - b.travelTime);

    return {
        projectedDefense,
        reinforcementPlan,
        canContribute: projectedDefense > 0,
        neededForParity: Math.max(0, attackPower - projectedDefense),
    };
}

function getLossSeverity(attackPower, defensePower) {
    if (attackPower <= 0) return 'low';
    const ratio = defensePower / attackPower;
    if (ratio >= 1) return 'low';
    if (ratio >= 0.75) return 'medium';
    if (ratio >= 0.5) return 'high';
    return 'critical';
}

function chooseResponse({
    doctrine,
    threatType,
    threatLevel,
    posture,
    canHoldLocally,
    canHoldWithReinforcements,
    shouldPreserveOffense,
    shouldCounterattack,
    projectedLossSeverity,
}) {
    const isSiegeOrConquest = threatType === 'conquest_attack' || threatType === 'siege_attack';

    if (doctrine?.id === 'egyptian_reactive') {
        if (canHoldLocally) {
            if (shouldCounterattack && threatType === 'standard_attack' && projectedLossSeverity === 'low') {
                return 'counterpressure';
            }
            return 'hold';
        }

        if (canHoldWithReinforcements) {
            return 'hold_with_reinforcements';
        }

        if (isSiegeOrConquest && threatLevel === 'critical') {
            return 'full_dodge';
        }

        return 'partial_dodge';
    }

    if (doctrine?.id === 'germanic_reactive') {
        if (canHoldLocally) {
            if (shouldCounterattack) {
                return threatType === 'standard_attack' ? 'counterattack' : 'counterpressure';
            }
            if (projectedLossSeverity === 'critical' && shouldPreserveOffense) {
                return 'partial_dodge';
            }
            return 'hold';
        }

        if (isSiegeOrConquest || threatLevel === 'high' || threatLevel === 'critical') {
            if (canHoldWithReinforcements && !shouldPreserveOffense) {
                return 'hold_with_reinforcements';
            }
            return shouldPreserveOffense ? 'full_dodge' : 'partial_dodge';
        }

        if (canHoldWithReinforcements && posture !== 'offensive') {
            return 'hold_with_reinforcements';
        }

        return 'partial_dodge';
    }

    if (isSiegeOrConquest) {
        if (canHoldWithReinforcements) return 'hold_with_reinforcements';
        return shouldPreserveOffense ? 'full_dodge' : 'partial_dodge';
    }

    if (threatType === 'light_raid') {
        if (canHoldLocally) return 'hold';
        if (canHoldWithReinforcements && posture !== 'offensive') return 'hold_with_reinforcements';
        return 'partial_dodge';
    }

    if (canHoldLocally) {
        if (shouldCounterattack) {
            return threatType === 'standard_attack' ? 'counterattack' : 'counterpressure';
        }
        return 'hold';
    }

    if (canHoldWithReinforcements && posture !== 'offensive') {
        return 'hold_with_reinforcements';
    }

    if (shouldPreserveOffense || posture === 'offensive') {
        return 'full_dodge';
    }

    return 'partial_dodge';
}

function buildReactiveCombatContract({ targetVillage, race, preferredResponse, threatLevel, doctrine, evaluation }) {
    const suppressByResponse = preferredResponse === 'partial_dodge'
        || preferredResponse === 'full_dodge'
        || preferredResponse === 'hold_with_reinforcements'
        || preferredResponse === 'reinforce';
    const suppressByThreat = threatLevel === 'high' || threatLevel === 'critical';
    const suppressByDoctrine = doctrine?.id === 'egyptian_reactive'
        && preferredResponse === 'hold'
        && threatLevel !== 'low';
    const offenseSuppressed = suppressByResponse || suppressByThreat || suppressByDoctrine;
    const reservedTroops = buildReservedTroopsForReactiveState({
        targetVillage,
        race,
        preferredResponse,
        doctrine,
        evaluation,
    });

    return {
        offenseSuppressed,
        reservedTroops,
    };
}

export function evaluateThreatAndChooseResponse({
    movement,
    gameState,
    race,
    archetype,
    ownerId,
    gameConfig,
    targetVillage,
    attackerVillage,
}) {
    const evaluationTime = Date.now();
    const doctrine = getReactiveDoctrine(race, archetype);
    const attackerRace = gameState.players.find(player => player.id === movement.ownerId)?.race || 'romans';
    const attackerSmithy = attackerVillage?.smithy?.upgrades || {};
    const attackBreakdown = CombatFormulas.calculateAttackPoints(movement.payload?.troops || {}, attackerRace, attackerSmithy);
    const attackPower = attackBreakdown.total;
    const attackerProportions = getAttackerProportions(attackBreakdown);
    const intelFresh = Object.keys(movement.payload?.troops || {}).length > 0;
    const lastIntelAt = intelFresh ? evaluationTime : null;

    const threatInfo = classifyThreat({
        movement,
        gameState,
        targetVillage,
        attackerRace,
        attackPower,
    });

    const { posture, roleScore } = resolveCombatPosture({
        race,
        archetype,
        targetVillage,
        threatType: threatInfo.threatType,
    });

    const localDefenseEstimate = estimateLocalDefense({
        targetVillage,
        race,
        attackerProportions,
    });

    const imperialDefenseData = evaluateImperialDefense({
        targetVillage,
        gameState,
        ownerId,
        gameConfig,
        attackPower,
        attackerProportions,
        movementArrivalTime: movement.arrivalTime,
        doctrine,
        threatType: threatInfo.threatType,
    });

    const imperialDefenseEstimate = localDefenseEstimate + imperialDefenseData.projectedDefense;

    const canHoldLocally = localDefenseEstimate >= attackPower * 1.02;
    const canHoldWithReinforcements = imperialDefenseEstimate >= attackPower * 1.02;
    const projectedLocalOutcome = canHoldLocally ? 'hold' : 'break';
    const projectedEmpireOutcome = canHoldWithReinforcements ? 'hold' : 'break';
    const projectedLossSeverity = getLossSeverity(attackPower, localDefenseEstimate);
    const survivalProbability = clamp01(Math.max(localDefenseEstimate, imperialDefenseEstimate) / Math.max(attackPower, 1));

    const offenseWeight = roleScore.offensiveRatio;
    const shouldPreserveOffense = posture === 'offensive' || offenseWeight >= (doctrine?.preserveOffenseRatio || 0.62);
    const counterMinHoldRatio = doctrine?.id === 'egyptian_reactive'
        ? 1.28
        : doctrine?.id === 'germanic_reactive'
            ? 1.06
            : 1.15;
    const counterThreatEligible = threatInfo.threatType === 'standard_attack' || threatInfo.threatType === 'light_raid';
    const shouldCounterattack = (
        counterThreatEligible &&
        (posture !== 'defensive' || doctrine?.id === 'egyptian_reactive') &&
        canHoldLocally &&
        attackPower > 0 &&
        localDefenseEstimate >= attackPower * counterMinHoldRatio &&
        !threatInfo.hasMultiWave &&
        !threatInfo.hasConquest &&
        !(threatInfo.hasSiege && doctrine?.id === 'egyptian_reactive') &&
        !(doctrine?.id === 'egyptian_reactive' && projectedLossSeverity !== 'low') &&
        Boolean(attackerVillage)
    );

    const preferredResponse = chooseResponse({
        doctrine,
        threatType: threatInfo.threatType,
        threatLevel: threatInfo.threatLevel,
        posture,
        canHoldLocally,
        canHoldWithReinforcements,
        shouldPreserveOffense,
        shouldCounterattack,
        projectedLossSeverity,
    });
    const contract = buildReactiveCombatContract({
        targetVillage,
        race,
        preferredResponse,
        threatLevel: threatInfo.threatLevel,
        doctrine,
        evaluation: {
            threatLevel: threatInfo.threatLevel,
            shouldPreserveOffense,
        },
    });

    const shouldPauseEconomicConstruction = threatInfo.threatLevel === 'high' || threatInfo.threatLevel === 'critical';
    const shouldBoostEmergencyRecruitment = threatInfo.threatLevel !== 'low';
    const shouldRescoutAttacker = Boolean(attackerVillage) && (
        threatInfo.hasMultiWave
        || threatInfo.hasSiege
        || threatInfo.hasConquest
        || threatInfo.threatLevel === 'high'
        || threatInfo.threatLevel === 'critical'
        || attackPower >= (localDefenseEstimate * 0.8)
    );
    let rescoutReason = null;
    if (shouldRescoutAttacker) {
        if (threatInfo.hasConquest) rescoutReason = 'conquest_detected';
        else if (threatInfo.hasSiege) rescoutReason = 'siege_detected';
        else if (threatInfo.hasMultiWave) rescoutReason = 'multi_wave_detected';
        else if (threatInfo.threatLevel === 'high' || threatInfo.threatLevel === 'critical') rescoutReason = 'high_threat_detected';
        else rescoutReason = 'important_attack_defended';
    }

    return {
        threatType: threatInfo.threatType,
        threatLevel: threatInfo.threatLevel,
        intelFresh,
        lastIntelAt,
        posture,
        preferredResponse,
        offenseSuppressed: contract.offenseSuppressed,
        reservedTroops: contract.reservedTroops,
        attackPowerEstimate: attackPower,
        localDefenseEstimate,
        imperialDefenseEstimate,
        canHoldLocally,
        canHoldWithReinforcements,
        shouldPreserveOffense,
        shouldCounterattack,
        shouldPauseEconomicConstruction,
        shouldBoostEmergencyRecruitment,
        shouldRescoutAttacker,
        rescoutReason,
        doctrine,
        doctrineId: doctrine.id,
        counterWindowOpen: false,
        counterWindowExpiresAt: null,
        projectedLocalOutcome,
        projectedEmpireOutcome,
        projectedLossSeverity,
        survivalProbability,
        attackerProportions,
        attackerRace,
        attackerVillageId: attackerVillage?.id || null,
        reinforcementPlan: imperialDefenseData.reinforcementPlan,
        analysis: {
            hasSiege: threatInfo.hasSiege,
            hasConquest: threatInfo.hasConquest,
            hasMultiWave: threatInfo.hasMultiWave,
            incomingReinforcementPower: imperialDefenseData.projectedDefense,
        },
    };
}

function executeDodge({ village, troopsToDodge, gameState, ownerId, sendCommand, log }) {
    if (Object.keys(troopsToDodge).length === 0) {
        log('info', village, 'Dodge Maneuver Skipped', 'No troops specified to dodge.', null, 'military');
        return;
    }

    if (ownerId) {
        const myOtherVillages = gameState.villages.filter(candidate => candidate.ownerId === ownerId && candidate.id !== village.id);

        const safeHavens = myOtherVillages.filter(candidate => {
            const hasIncoming = gameState.movements.some(movement => {
                if (!HOSTILE_MOVEMENT_TYPES.has(movement.type)) return false;
                if (movement.ownerId === ownerId) return false;
                return movement.targetCoords?.x === candidate.coords.x && movement.targetCoords?.y === candidate.coords.y;
            });
            return !hasIncoming;
        });

        if (safeHavens.length > 0) {
            const sortedHavens = safeHavens.slice().sort((a, b) => {
                const da = Math.hypot(a.coords.x - village.coords.x, a.coords.y - village.coords.y);
                const db = Math.hypot(b.coords.x - village.coords.x, b.coords.y - village.coords.y);
                return da - db;
            });

            const safeTarget = sortedHavens[0];
            sendCommand('send_movement', {
                originVillageId: village.id,
                targetCoords: { x: safeTarget.coords.x, y: safeTarget.coords.y },
                troops: troopsToDodge,
                missionType: 'reinforcement',
            }, {
                reactiveIntent: 'dodge',
            });
            log('success', village, 'Dodge Maneuver', `Tropas enviadas a aldea propia segura en (${safeTarget.coords.x}|${safeTarget.coords.y}) como refugio.`, { troops: troopsToDodge, safeHavenId: safeTarget.id }, 'military');
            return;
        }
    }

    const nearbyOases = gameState.mapData.filter(tile => tile.type === 'oasis' && Math.hypot(tile.x - village.coords.x, tile.y - village.coords.y) <= 10);
    if (nearbyOases.length === 0) {
        log('fail', village, 'Dodge Maneuver', 'No nearby oases found to dodge troops.', null, 'military');
        return;
    }

    const targetOasis = nearbyOases[Math.floor(Math.random() * nearbyOases.length)];
    sendCommand('send_movement', {
        originVillageId: village.id,
        targetCoords: { x: targetOasis.x, y: targetOasis.y },
        troops: troopsToDodge,
        missionType: 'raid',
    }, {
        reactiveIntent: 'dodge',
    });
    log('success', village, 'Dodge Maneuver', `Troops sent to raid oasis at (${targetOasis.x}|${targetOasis.y}) to avoid combat.`, { troops: troopsToDodge }, 'military');
}

function planDodgeTask({ dodgeTasks, movementId, movementArrivalTime, village, troops }) {
    dodgeTasks.set(movementId, {
        arrivalTime: movementArrivalTime,
        villageId: village.id,
        troops,
    });
}

function manageReinforcements({
    targetVillage,
    attackPower,
    gameState,
    ownerId,
    race,
    doctrine,
    threatType,
    gameConfig,
    sendCommand,
    log,
    movementArrivalTime,
    ignoreTravelTime = false,
}) {
    const raceUnits = gameData.units[race]?.troops || [];
    const reinforcementRoles = doctrine?.id === 'germanic_reactive'
        ? ((threatType === 'conquest_attack' || threatType === 'siege_attack') ? new Set(['defensive', 'versatile']) : new Set(['defensive']))
        : new Set(['defensive', 'versatile']);

    const getDefensiveTroops = units => {
        const defensive = {};
        for (const unitId in units) {
            const count = units[unitId] || 0;
            if (count <= 0) continue;

            const role = raceUnits.find(unit => unit.id === unitId)?.role;
            if (reinforcementRoles.has(role)) {
                defensive[unitId] = count;
            }
        }
        return defensive;
    };

    const wallLevel = targetVillage.buildings.find(building => building.type === 'cityWall')?.level || 0;
    const localDefensePower = CombatFormulas.calculateDefensePoints(
        [{ troops: getDefensiveTroops(targetVillage.unitsInVillage || {}), race, smithyUpgrades: targetVillage.smithy?.upgrades || {} }],
        { infantry: 0.5, cavalry: 0.5 },
        race,
        wallLevel,
        0,
    );

    const neededPower = attackPower * 1.1;
    const deficit = neededPower - localDefensePower;
    if (deficit <= 0) {
        log('info', targetVillage, 'Defensa Coordinada', 'La defensa local es suficiente.', null, 'military');
        return {
            canHold: true,
            totalProjectedDefense: localDefensePower,
            sentReinforcements: 0,
        };
    }

    const myOtherVillages = gameState.villages.filter(village => village.ownerId === ownerId && village.id !== targetVillage.id);
    const potentialReinforcements = [];

    for (const village of myOtherVillages) {
        const defensiveTroops = getDefensiveTroops(village.unitsInVillage || {});
        if (Object.keys(defensiveTroops).length === 0) continue;

        const slowestSpeed = getSlowestUnitSpeed(defensiveTroops, race);
        const travelTime = calculateTravelTime(village.coords, targetVillage.coords, slowestSpeed, gameConfig.troopSpeed || 1);
        if (!ignoreTravelTime && Date.now() + travelTime >= (movementArrivalTime || Date.now() + 999999)) continue;

        const power = CombatFormulas.calculateDefensePoints(
            [{ troops: defensiveTroops, race: village.race, smithyUpgrades: village.smithy?.upgrades || {} }],
            { infantry: 0.5, cavalry: 0.5 },
            village.race,
            wallLevel,
            0,
        );

        potentialReinforcements.push({ village, troops: defensiveTroops, power, travelTime });
    }

    potentialReinforcements.sort((a, b) => a.travelTime - b.travelTime);

    let accumulatedPower = 0;
    const reinforcementsToSend = [];
    for (const reinforcement of potentialReinforcements) {
        if (accumulatedPower >= deficit) break;
        reinforcementsToSend.push(reinforcement);
        accumulatedPower += reinforcement.power;
    }

    const totalProjectedDefense = localDefensePower + accumulatedPower;
    if (totalProjectedDefense >= attackPower) {
        log('success', targetVillage, 'Defensa Coordinada', `Enjambre activado. ${reinforcementsToSend.length} aldeas enviando ayuda. Poder Total: ${totalProjectedDefense.toFixed(0)} vs Ataque: ${attackPower.toFixed(0)}`, null, 'military');
        reinforcementsToSend.forEach(({ village, troops }) => {
            sendCommand('send_movement', {
                originVillageId: village.id,
                targetCoords: targetVillage.coords,
                troops,
                missionType: 'reinforcement',
            }, {
                reactiveIntent: 'reinforce',
            });
        });

        return {
            canHold: true,
            totalProjectedDefense,
            sentReinforcements: reinforcementsToSend.length,
        };
    }

    log('warn', targetVillage, 'Defensa Coordinada Fallida', `Ni con todo el imperio (${totalProjectedDefense.toFixed(0)}) podemos parar el ataque (${attackPower.toFixed(0)}).`, null, 'military');
    return {
        canHold: false,
        totalProjectedDefense,
        sentReinforcements: reinforcementsToSend.length,
    };
}

function launchCounterAction({
    targetVillage,
    attackerVillage,
    race,
    ownerId,
    movementId,
    gameState,
    gameConfig,
    evaluation,
    doctrine,
    villageCombatState,
    sendCommand,
    log,
}) {
    const counterConfig = getCounterConfig(gameConfig, doctrine);

    if (hasCriticalIncomingThreat({
        gameState,
        village: targetVillage,
        ownerId,
        lookaheadMs: counterConfig.threatLookaheadMs,
    })) {
        return { launched: false, reason: 'CRITICAL_THREAT_ACTIVE' };
    }

    if (!isCounterWindowAvailable(villageCombatState, targetVillage.id)) {
        return { launched: false, reason: 'COUNTER_WINDOW_CLOSED' };
    }

    const plan = buildCounterTroopPlan({
        targetVillage,
        attackerVillage,
        race,
        ownerId,
        gameState,
        movementId,
        evaluation,
        doctrine,
        gameConfig,
    });

    if (!plan.allowed) {
        return { launched: false, reason: plan.reason, plan };
    }

    sendCommand('send_movement', {
        originVillageId: targetVillage.id,
        targetCoords: attackerVillage.coords,
        troops: plan.troops,
        missionType: plan.counterMode === 'counterpressure' ? 'raid' : 'attack',
    }, {
        reactiveIntent: 'counter',
        counterMode: plan.counterMode,
    });

    villageCombatState?.upsert?.(targetVillage.id, {
        counterWindowOpen: false,
        counterWindowExpiresAt: null,
        counterDecisionState: 'immediate_executed',
        counterDecisionReason: `immediate_${plan.counterMode}`,
        counterDecisionAt: Date.now(),
    }, {
        lastDecisionReason: `counter_${plan.counterMode}_launched`,
    });

    log('success', targetVillage, 'Counter Action', `Launched ${plan.counterMode} with safety limits.`, {
        counterMode: plan.counterMode,
        troops: plan.troops,
        residualDefense: Math.round(plan.residualDefense || 0),
        requiredResidualDefense: Math.round(plan.requiredResidualDefense || 0),
        outgoingAttackEstimate: Math.round(plan.outgoingAttackEstimate || 0),
        attackerDefenseEstimate: Math.round(plan.attackerDefenseEstimate || 0),
        vulnerabilityRatio: Number((plan.vulnerabilityRatio || 0).toFixed(3)),
    }, 'military');

    return { launched: true, plan };
}

export function handleEspionageReact({
    movement,
    gameState,
    race,
    dodgeTasks,
    villageCombatState,
    locks,
    cooldowns,
    log,
}) {
    const targetVillage = gameState.villages.find(village => village.coords.x === movement.targetCoords.x && village.coords.y === movement.targetCoords.y);
    if (!targetVillage) return;

    if (cooldowns?.hasReactionCooldown?.(movement.id)) {
        return;
    }

    if (locks?.hasMovementLock?.(targetVillage.id)) {
        return;
    }

    const raceUnits = gameData.units[race]?.troops || [];
    const scoutUnit = raceUnits.find(unit => unit.type === 'scout');
    const hasScouts = scoutUnit && (targetVillage.unitsInVillage[scoutUnit.id] || 0) > 0;

    const troopsToDodge = {};
    if (hasScouts) {
        for (const unitId in targetVillage.unitsInVillage) {
            if (raceUnits.find(unit => unit.id === unitId)?.type !== 'scout') {
                troopsToDodge[unitId] = targetVillage.unitsInVillage[unitId];
            }
        }
        log('info', targetVillage, 'Counter-espionage', 'Espionage detected. Keeping scouts and dodging other troops.', { troopsToDodge }, 'military');
    } else {
        Object.assign(troopsToDodge, targetVillage.unitsInVillage);
        log('info', targetVillage, 'Counter-espionage', 'Espionage detected. No scouts to defend. Dodging all troops.', null, 'military');
    }

    if (Object.keys(troopsToDodge).length > 0) {
        planDodgeTask({
            dodgeTasks,
            movementId: movement.id,
            movementArrivalTime: movement.arrivalTime,
            village: targetVillage,
            troops: troopsToDodge,
        });
    }

    const preferredResponse = hasScouts ? 'partial_dodge' : 'full_dodge';
    const doctrine = getReactiveDoctrine(race, null);
    const contract = buildReactiveCombatContract({
        targetVillage,
        race,
        preferredResponse,
        threatLevel: 'low',
        doctrine,
        evaluation: {
            threatLevel: 'low',
            shouldPreserveOffense: true,
        },
    });

    villageCombatState?.upsert?.(targetVillage.id, {
        threatLevel: 'low',
        threatType: 'espionage',
        intelFresh: true,
        lastIntelAt: Date.now(),
        posture: 'hybrid',
        preferredResponse,
        offenseSuppressed: contract.offenseSuppressed,
        reservedTroops: contract.reservedTroops,
        attackPowerEstimate: 0,
        localDefenseEstimate: 0,
        imperialDefenseEstimate: 0,
        canHoldLocally: true,
        canHoldWithReinforcements: true,
        shouldPreserveOffense: true,
        shouldCounterattack: false,
        shouldPauseEconomicConstruction: false,
        shouldBoostEmergencyRecruitment: false,
        shouldRescoutAttacker: false,
        rescoutReason: null,
        counterWindowOpen: false,
        counterWindowExpiresAt: null,
        sourceMovementIds: [movement.id],
        lastDecisionReason: 'espionage_detected',
    }, {
        sourceMovementIds: [movement.id],
        lastDecisionReason: 'espionage_detected',
    });

    locks?.setMovementLock?.(targetVillage.id, 12000, { reason: 'espionage_react', sourceMovementId: movement.id });
    cooldowns?.setReactionCooldown?.(movement.id, 20000, { reason: 'espionage_react', sourceMovementId: movement.id });
}

function classifyIncomingMovement(movement, payloadTroops, attackerRace) {
    const totalUnits = getTroopCount(payloadTroops);

    if (totalUnits === 0) {
        return { isFake: false, reason: 'no_intel' };
    }

    if (totalUnits === 1) {
        return { isFake: true, reason: 'single_unit' };
    }

    if (movement.type === 'raid' && totalUnits < 5) {
        return { isFake: true, reason: 'raid_minimal_units' };
    }

    if (movement.type === 'attack' && totalUnits <= 3) {
        const { hasSiege, hasConquest } = getAttackerTroopFlags(payloadTroops, attackerRace);
        if (!hasSiege && !hasConquest) {
            return { isFake: true, reason: 'attack_minimal_units_no_siege' };
        }
    }

    const { hasSiege } = getAttackerTroopFlags(payloadTroops, attackerRace);
    if (!hasSiege && movement.type === 'raid' && totalUnits < 10) {
        return { isFake: true, reason: 'small_raid_no_siege' };
    }

    return { isFake: false, reason: 'real_threat' };
}

export function handleAttackReact({
    movement,
    gameState,
    race,
    archetype,
    ownerId,
    gameConfig,
    dodgeTasks,
    villageCombatState,
    locks,
    cooldowns,
    sendCommand,
    log,
}) {
    const targetVillage = gameState.villages.find(village => village.coords.x === movement.targetCoords.x && village.coords.y === movement.targetCoords.y);
    if (!targetVillage) return;

    if (cooldowns?.hasReactionCooldown?.(movement.id)) {
        log('info', targetVillage, 'Reactive Cooldown', 'Skipping duplicate reaction due movement cooldown.', { movementId: movement.id }, 'military');
        return;
    }

    if (locks?.hasMovementLock?.(targetVillage.id)) {
        log('info', targetVillage, 'Reactive Lock', 'Skipping reaction due active village movement lock.', { villageId: targetVillage.id }, 'military');
        return;
    }

    const payloadTroops = movement.payload?.troops || {};
    const attackerRace = gameState.players.find(player => player.id === movement.ownerId)?.race || 'romans';
    const fakeClassification = classifyIncomingMovement(movement, payloadTroops, attackerRace);

    if (fakeClassification.isFake) {
        log('info', targetVillage, 'Fake Detectado', `Movimiento clasificado como FAKE (${fakeClassification.reason}). Sin reaccion defensiva.`, {
            movementId: movement.id,
            movementType: movement.type,
            totalUnits: getTroopCount(payloadTroops),
            reason: fakeClassification.reason,
        }, 'military');

        villageCombatState?.upsert?.(targetVillage.id, {
            threatLevel: 'none',
            threatType: 'fake',
            isFake: true,
            lastDecisionReason: `fake_detected:${fakeClassification.reason}`,
        }, {
            sourceMovementIds: [movement.id],
            lastDecisionReason: `fake_detected:${fakeClassification.reason}`,
        });

        cooldowns?.setReactionCooldown?.(movement.id, 20000, { reason: 'fake_classified', sourceMovementId: movement.id });
        return { isFake: true };
    }

    const attackerVillage = gameState.villages.find(village => village.id === movement.originVillageId);
    const evaluation = evaluateThreatAndChooseResponse({
        movement,
        gameState,
        race,
        archetype,
        ownerId,
        gameConfig,
        targetVillage,
        attackerVillage,
    });

    villageCombatState?.upsert?.(targetVillage.id, {
        threatLevel: evaluation.threatLevel,
        threatType: evaluation.threatType,
        intelFresh: evaluation.intelFresh,
        lastIntelAt: evaluation.lastIntelAt,
        posture: evaluation.posture,
        preferredResponse: evaluation.preferredResponse,
        offenseSuppressed: evaluation.offenseSuppressed,
        reservedTroops: evaluation.reservedTroops,
        attackPowerEstimate: evaluation.attackPowerEstimate,
        localDefenseEstimate: evaluation.localDefenseEstimate,
        imperialDefenseEstimate: evaluation.imperialDefenseEstimate,
        canHoldLocally: evaluation.canHoldLocally,
        canHoldWithReinforcements: evaluation.canHoldWithReinforcements,
        shouldPreserveOffense: evaluation.shouldPreserveOffense,
        shouldCounterattack: evaluation.shouldCounterattack,
        shouldPauseEconomicConstruction: evaluation.shouldPauseEconomicConstruction,
        shouldBoostEmergencyRecruitment: evaluation.shouldBoostEmergencyRecruitment,
        attackerVillageId: evaluation.attackerVillageId,
        shouldRescoutAttacker: evaluation.shouldRescoutAttacker,
        rescoutReason: evaluation.rescoutReason,
        doctrineId: evaluation.doctrineId,
        attackerRace: evaluation.attackerRace,
        counterWindowOpen: evaluation.counterWindowOpen,
        counterWindowExpiresAt: evaluation.counterWindowExpiresAt,
        sourceMovementIds: [movement.id],
        lastDecisionReason: `reactive:${evaluation.preferredResponse}`,
    }, {
        sourceMovementIds: [movement.id],
        lastDecisionReason: `reactive:${evaluation.preferredResponse}`,
    });

    log(
        'info',
        targetVillage,
        'Reactive Eval',
        `Threat=${evaluation.threatType}/${evaluation.threatLevel} posture=${evaluation.posture} response=${evaluation.preferredResponse}.`,
        {
            attackPower: Math.round(evaluation.attackPowerEstimate),
            localDefense: Math.round(evaluation.localDefenseEstimate),
            imperialDefense: Math.round(evaluation.imperialDefenseEstimate),
            canHoldLocally: evaluation.canHoldLocally,
            canHoldWithReinforcements: evaluation.canHoldWithReinforcements,
            projectedLocalOutcome: evaluation.projectedLocalOutcome,
            projectedEmpireOutcome: evaluation.projectedEmpireOutcome,
            projectedLossSeverity: evaluation.projectedLossSeverity,
            survivalProbability: Number(evaluation.survivalProbability.toFixed(3)),
            intelFresh: evaluation.intelFresh,
            lastIntelAt: evaluation.lastIntelAt,
            offenseSuppressed: evaluation.offenseSuppressed,
            reservedTroopsCount: getTroopCount(evaluation.reservedTroops || {}),
            shouldRescoutAttacker: evaluation.shouldRescoutAttacker,
            rescoutReason: evaluation.rescoutReason,
            doctrineId: evaluation.doctrineId,
            analysis: evaluation.analysis,
        },
        'military',
    );

    const setBaseLocks = () => {
        locks?.setMovementLock?.(targetVillage.id, 15000, { reason: `reactive_${evaluation.preferredResponse}`, sourceMovementId: movement.id });
        cooldowns?.setReactionCooldown?.(movement.id, 20000, { reason: `reactive_${evaluation.preferredResponse}`, sourceMovementId: movement.id });
    };

    const maybeOpenCounterWindow = (reason = 'counter_window_opened') => {
        const eligibleThreat = evaluation.threatType === 'standard_attack' || evaluation.threatType === 'siege_attack' || evaluation.threatType === 'conquest_attack' || evaluation.threatType === 'multi_wave_attack';
        if (!eligibleThreat) return;

        openCounterWindow({
            villageCombatState,
            villageId: targetVillage.id,
            movementId: movement.id,
            ttlMs: getCounterConfig(gameConfig, evaluation.doctrine).windowTtlMs,
            reason,
        });
    };

    if (evaluation.preferredResponse === 'hold') {
        log('info', targetVillage, 'Local Defense', 'Holding position with local defense.', null, 'military');
        maybeOpenCounterWindow('counter_window_after_hold');
        setBaseLocks();
        return;
    }

    if (evaluation.preferredResponse === 'hold_with_reinforcements' || evaluation.preferredResponse === 'reinforce') {
        const reinforcementResult = manageReinforcements({
            targetVillage,
            attackPower: evaluation.attackPowerEstimate,
            gameState,
            ownerId,
            race,
            doctrine: evaluation.doctrine,
            threatType: evaluation.threatType,
            gameConfig,
            sendCommand,
            log,
            movementArrivalTime: movement.arrivalTime,
            ignoreTravelTime: evaluation.threatType === 'siege_attack' || evaluation.threatType === 'conquest_attack',
        });

        if (!reinforcementResult.canHold) {
            const fullDodgePolicy = shouldAllowFullDodge({
                evaluation,
                targetVillage,
                race,
                gameConfig,
                doctrine: evaluation.doctrine,
            });

            const fallbackResponse = fullDodgePolicy.allow ? 'full_dodge' : 'partial_dodge';
            const fallbackPlan = buildDodgeTroopPlan({
                targetVillage,
                race,
                posture: evaluation.posture,
                responseType: fallbackResponse,
                evaluation,
                doctrine: evaluation.doctrine,
                gameConfig,
            });

            const fallbackTroops = fallbackPlan.troopsToDodge;
            planDodgeTask({
                dodgeTasks,
                movementId: movement.id,
                movementArrivalTime: movement.arrivalTime,
                village: targetVillage,
                troops: fallbackTroops,
            });
            log('warn', targetVillage, 'Reactive Fallback', `Reinforcements are insufficient. Fallback to ${fallbackResponse} (${fallbackPlan.planType}).`, {
                strategicValueScore: fullDodgePolicy.strategicValueScore,
                clearDefeat: fullDodgePolicy.clearDefeat,
                severeLosses: fullDodgePolicy.severeLosses,
                acceptableStrategicLoss: fullDodgePolicy.acceptableStrategicLoss,
                dodgeTroops: fallbackTroops,
            }, 'military');
            const fallbackContract = buildReactiveCombatContract({
                targetVillage,
                race,
                preferredResponse: fallbackResponse,
                threatLevel: evaluation.threatLevel,
                doctrine: evaluation.doctrine,
                evaluation,
            });
            villageCombatState?.upsert?.(targetVillage.id, {
                preferredResponse: fallbackResponse,
                offenseSuppressed: fallbackContract.offenseSuppressed,
                reservedTroops: fallbackContract.reservedTroops,
                lastDecisionReason: `fallback_${fallbackResponse}_after_failed_reinforce`,
            }, {
                sourceMovementIds: [movement.id],
                lastDecisionReason: `fallback_${fallbackResponse}_after_failed_reinforce`,
            });
            maybeOpenCounterWindow('counter_window_after_fallback_dodge');
        } else {
            maybeOpenCounterWindow('counter_window_after_reinforced_hold');
        }

        setBaseLocks();
        return;
    }

    if (evaluation.preferredResponse === 'partial_dodge' || evaluation.preferredResponse === 'full_dodge') {
        const fullDodgePolicy = shouldAllowFullDodge({
            evaluation,
            targetVillage,
            race,
            gameConfig,
            doctrine: evaluation.doctrine,
        });

        const effectiveResponse = evaluation.preferredResponse === 'full_dodge' && !fullDodgePolicy.allow
            ? 'partial_dodge'
            : evaluation.preferredResponse;

        const dodgePlan = buildDodgeTroopPlan({
            targetVillage,
            race,
            posture: evaluation.posture,
            responseType: effectiveResponse,
            evaluation,
            doctrine: evaluation.doctrine,
            gameConfig,
        });

        const troopsToDodge = dodgePlan.troopsToDodge;
        if (Object.keys(troopsToDodge).length === 0) {
            log('info', targetVillage, 'Tactical Evasion', 'Dodge plan generated no movable troops. Holding.', {
                effectiveResponse,
                planType: dodgePlan.planType,
            }, 'military');
            setBaseLocks();
            return;
        }

        planDodgeTask({
            dodgeTasks,
            movementId: movement.id,
            movementArrivalTime: movement.arrivalTime,
            village: targetVillage,
            troops: troopsToDodge,
        });

        if (effectiveResponse !== evaluation.preferredResponse) {
            const effectiveContract = buildReactiveCombatContract({
                targetVillage,
                race,
                preferredResponse: effectiveResponse,
                threatLevel: evaluation.threatLevel,
                doctrine: evaluation.doctrine,
                evaluation,
            });
            villageCombatState?.upsert?.(targetVillage.id, {
                preferredResponse: effectiveResponse,
                offenseSuppressed: effectiveContract.offenseSuppressed,
                reservedTroops: effectiveContract.reservedTroops,
                lastDecisionReason: 'full_dodge_blocked_by_policy',
            }, {
                sourceMovementIds: [movement.id],
                lastDecisionReason: 'full_dodge_blocked_by_policy',
            });
        }

        log('warn', targetVillage, 'Tactical Evasion', `${effectiveResponse} scheduled (${dodgePlan.planType}).`, {
            originalResponse: evaluation.preferredResponse,
            strategicValueScore: fullDodgePolicy.strategicValueScore,
            clearDefeat: fullDodgePolicy.clearDefeat,
            severeLosses: fullDodgePolicy.severeLosses,
            acceptableStrategicLoss: fullDodgePolicy.acceptableStrategicLoss,
            troopsToDodge,
            troopsToHold: dodgePlan.troopsToHold,
        }, 'military');
        maybeOpenCounterWindow('counter_window_after_dodge');
        setBaseLocks();
        return;
    }

    if (evaluation.preferredResponse === 'counterpressure' || evaluation.preferredResponse === 'counterattack') {
        const inCounterCooldown = cooldowns?.hasCounterattackCooldown?.(targetVillage.id);
        if (inCounterCooldown) {
            villageCombatState?.upsert?.(targetVillage.id, {
                counterDecisionState: 'none',
                counterDecisionReason: 'counter_cooldown_active',
                counterDecisionAt: Date.now(),
            }, {
                sourceMovementIds: [movement.id],
                lastDecisionReason: 'counter_skipped_cooldown',
            });
            log('info', targetVillage, 'Counter Reaction', 'Counter action skipped due village cooldown. Holding instead.', null, 'military');
            setBaseLocks();
            return;
        }

        if (!isCounterWindowAvailable(villageCombatState, targetVillage.id)) {
            maybeOpenCounterWindow('counter_window_pre_counter_attempt');
        }

        const counterResult = launchCounterAction({
            targetVillage,
            attackerVillage,
            race,
            ownerId,
            movementId: movement.id,
            gameState,
            gameConfig,
            evaluation,
            doctrine: evaluation.doctrine,
            villageCombatState,
            sendCommand,
            log,
        });

        if (!counterResult.launched) {
            villageCombatState?.upsert?.(targetVillage.id, {
                counterDecisionState: counterResult.reason === 'COUNTER_WINDOW_CLOSED' ? 'none' : 'deferred_pending',
                counterDecisionReason: `immediate_counter_blocked:${counterResult.reason}`,
                counterDecisionAt: Date.now(),
            }, {
                sourceMovementIds: [movement.id],
                lastDecisionReason: `counter_blocked_${counterResult.reason}`,
            });
            log('warn', targetVillage, 'Counter Reaction', `Counter action blocked (${counterResult.reason}). Holding.`, counterResult.plan || null, 'military');
            setBaseLocks();
            return;
        }

        cooldowns?.setCounterattackCooldown?.(targetVillage.id, getCounterConfig(gameConfig, evaluation.doctrine).retaliationCooldownMs, {
            reason: `counter_${counterResult.plan?.counterMode || 'action'}_launched`,
            sourceMovementId: movement.id,
        });
        setBaseLocks();
        return;
    }

    setBaseLocks();
}

export function planResourceEvacuation({
    targetVillage,
    gameState,
    ownerId,
    sendCommand,
    log,
}) {
    const cranny = targetVillage.buildings.find(b => b.type === 'cranny');
    const crannyLevel = cranny?.level || 0;
    const crannyCapacityPerResource = crannyLevel > 0 ? crannyLevel * 400 : 0;

    const resources = targetVillage.resources || {};
    const resourceKeys = ['wood', 'stone', 'iron', 'food'];
    const evacuationPackage = {};
    let totalToEvacuate = 0;

    for (const key of resourceKeys) {
        const current = resources[key] || 0;
        const crannyProtected = Math.min(current, crannyCapacityPerResource);
        const atRisk = current - crannyProtected;
        if (atRisk > 500) {
            evacuationPackage[key] = Math.floor(atRisk * 0.9);
            totalToEvacuate += evacuationPackage[key];
        }
    }

    if (totalToEvacuate === 0) {
        log('info', targetVillage, 'Escondite de Recursos', 'No hay recursos en riesgo suficiente para evacuar.', null, 'military');
        return { evacuated: false, reason: 'NO_RESOURCES_AT_RISK' };
    }

    const marketBuilding = targetVillage.buildings.find(b => b.type === 'marketplace');
    if (!marketBuilding || marketBuilding.level < 1) {
        log('info', targetVillage, 'Escondite de Recursos', 'Sin mercado disponible para evacuacion.', null, 'military');
        return { evacuated: false, reason: 'NO_MARKETPLACE' };
    }

    const myOtherVillages = gameState.villages.filter(v => v.ownerId === ownerId && v.id !== targetVillage.id);

    const candidateVillages = myOtherVillages
        .filter(v => {
            const hasIncoming = gameState.movements.some(m => {
                if (!HOSTILE_MOVEMENT_TYPES.has(m.type)) return false;
                if (m.ownerId === ownerId) return false;
                return m.targetCoords?.x === v.coords.x && m.targetCoords?.y === v.coords.y;
            });
            return !hasIncoming;
        })
        .map(v => ({
            village: v,
            dist: Math.hypot(v.coords.x - targetVillage.coords.x, v.coords.y - targetVillage.coords.y),
        }))
        .sort((a, b) => a.dist - b.dist);

    if (candidateVillages.length === 0) {
        log('warn', targetVillage, 'Escondite de Recursos', 'No hay aldeas propias seguras como destino.', null, 'military');
        return { evacuated: false, reason: 'NO_SAFE_DESTINATION' };
    }

    const destination = candidateVillages[0].village;

    const result = sendCommand('send_merchants', {
        originVillageId: targetVillage.id,
        targetCoords: destination.coords,
        resources: evacuationPackage,
    }, {
        reactiveIntent: 'evacuate_resources',
    });

    if (result?.success === false) {
        log('warn', targetVillage, 'Escondite de Recursos', `Fallo el envio de mercaderes: ${result.reason || 'desconocido'}.`, null, 'military');
        return { evacuated: false, reason: result.reason || 'SEND_MERCHANTS_FAILED' };
    }

    log('success', targetVillage, 'Escondite de Recursos', `Evacuando ${totalToEvacuate} recursos a aldea (${destination.coords.x}|${destination.coords.y}).`, { evacuationPackage, destinationId: destination.id }, 'military');
    return { evacuated: true, destinationId: destination.id, evacuationPackage };
}

export function processDodgeTasks({ gameState, dodgeTasks, dodgeTimeThresholdMs, ownerId, sendCommand, log }) {
    if (dodgeTasks.size === 0) return;
    const now = Date.now();

    for (const [movementId, task] of dodgeTasks.entries()) {
        if (task.arrivalTime - now >= dodgeTimeThresholdMs) continue;

        const village = gameState.villages.find(candidate => candidate.id === task.villageId);
        if (village) {
            log('warn', village, 'Executing Dodge', `Imminent hostile movement (${((task.arrivalTime - now) / 1000).toFixed(1)}s). Dodging troops.`, task.troops, 'military');
            executeDodge({ village, troopsToDodge: task.troops, gameState, ownerId, sendCommand, log });
        }
        dodgeTasks.delete(movementId);
    }
}

export function processReinforcementRecalls({ gameState, reinforcementTasks, sendCommand, log }) {
    const now = Date.now();
    const activeTasks = [];

    for (const task of reinforcementTasks) {
        if (now < task.expiryTime) {
            activeTasks.push(task);
            continue;
        }

        log('info', null, 'Reinforcement Recall', 'Initiating recall of reinforcement troops post-battle.', task, 'military');
        for (const reinforcement of task.reinforcements) {
            const reinforcedVillage = gameState.villages.find(village => village.id === reinforcement.to);
            if (!reinforcedVillage) continue;

            const reinforcementData = reinforcedVillage.reinforcements.find(entry => entry.fromVillageId === reinforcement.from);
            if (!reinforcementData || Object.keys(reinforcementData.troops).length === 0) continue;

            const originVillage = gameState.villages.find(village => village.id === reinforcement.from);
            if (!originVillage) continue;

            sendCommand('send_movement', {
                originVillageId: reinforcedVillage.id,
                targetCoords: originVillage.coords,
                troops: reinforcementData.troops,
                missionType: 'reinforcement',
            });
        }
    }

    return activeTasks;
}
