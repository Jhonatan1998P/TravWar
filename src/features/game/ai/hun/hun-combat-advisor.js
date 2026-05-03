import {
    askDeepSeekAttackAdvice,
    askDeepSeekDefenseAdvice,
    buildAttackContext,
    buildDefenseContext,
} from './hun-deepseek-advisor.js';

const HUN_DEEPSEEK_FLAG_KEY = 'hun_deepseek_enabled';

export function isHunDeepSeekEnabled() {
    try {
        const envFlag = import.meta.env?.VITE_HUN_DEEPSEEK_ENABLED;
        if (envFlag === 'false') return false;
        if (envFlag === 'true') return true;
        const stored = typeof localStorage !== 'undefined'
            ? localStorage.getItem(HUN_DEEPSEEK_FLAG_KEY)
            : null;
        if (stored === 'false') return false;
        if (stored === 'true') return true;
        return true;
    } catch {
        return true;
    }
}

export function setHunDeepSeekEnabled(value) {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(HUN_DEEPSEEK_FLAG_KEY, value ? 'true' : 'false');
        }
    } catch {
        // ignore
    }
}

export function getHunDeepSeekStatus() {
    return {
        enabled: isHunDeepSeekEnabled(),
        apiKeyPresent: Boolean(import.meta.env?.VITE_DEEPSEEK_API_KEY),
    };
}

const VALID_OVERRIDE_RESPONSES = new Set(['hold', 'dodge', 'counterpressure', 'counterattack', 'reinforce']);
const MIN_CONFIDENCE_TO_OVERRIDE = 0.55;

export async function getHunAttackAdvice({
    myVillages,
    availableForces,
    targets,
    race,
    archetype,
    gameState,
    ownerId,
    log,
}) {
    if (!isHunDeepSeekEnabled()) {
        return { used: false, reason: 'DISABLED' };
    }

    if (!import.meta.env?.VITE_DEEPSEEK_API_KEY) {
        return { used: false, reason: 'NO_API_KEY' };
    }

    try {
        const context = buildAttackContext({
            myVillages,
            availableForces,
            targets,
            race,
            archetype,
            gameState,
            ownerId,
        });

        const result = await askDeepSeekAttackAdvice(context);

        if (!result.success) {
            log?.('warn', null, 'Huno DeepSeek Ataque', `Fallo al consultar DeepSeek: ${result.reason}. Usando logica estandar.`, null, 'military');
            return { used: false, reason: result.reason };
        }

        const { advice } = result;
        log?.(
            'info',
            null,
            'Huno DeepSeek Ataque',
            `DeepSeek recomienda: accion=${advice.action} prioridad=${advice.priority} confianza=${(advice.confidence * 100).toFixed(0)}% | ${advice.rationale}`,
            { targetId: advice.targetId, confidence: advice.confidence },
            'military',
        );

        return { used: true, advice };
    } catch (err) {
        log?.('warn', null, 'Huno DeepSeek Ataque', `Error inesperado: ${err.message}. Usando logica estandar.`, null, 'military');
        return { used: false, reason: 'UNEXPECTED_ERROR' };
    }
}

export async function getHunDefenseAdvice({
    movement,
    targetVillage,
    attackerVillage,
    attackPower,
    localDefense,
    canHoldLocally,
    canHoldWithReinforcements,
    threatType,
    threatLevel,
    posture,
    projectedLossSeverity,
    fallbackResponse,
    log,
}) {
    if (!isHunDeepSeekEnabled()) {
        return { used: false, reason: 'DISABLED', response: fallbackResponse };
    }

    if (!import.meta.env?.VITE_DEEPSEEK_API_KEY) {
        return { used: false, reason: 'NO_API_KEY', response: fallbackResponse };
    }

    try {
        const context = buildDefenseContext({
            movement,
            targetVillage,
            attackerVillage,
            attackPower,
            localDefense,
            canHoldLocally,
            canHoldWithReinforcements,
            threatType,
            threatLevel,
            posture,
            projectedLossSeverity,
        });

        const result = await askDeepSeekDefenseAdvice(context);

        if (!result.success) {
            log?.('warn', targetVillage, 'Huno DeepSeek Defensa', `Fallo al consultar DeepSeek: ${result.reason}. Usando respuesta estandar: ${fallbackResponse}.`, null, 'military');
            return { used: false, reason: result.reason, response: fallbackResponse };
        }

        const { advice } = result;
        const validResponse = VALID_OVERRIDE_RESPONSES.has(advice.response) && advice.confidence >= MIN_CONFIDENCE_TO_OVERRIDE
            ? advice.response
            : null;

        log?.(
            validResponse ? 'success' : 'info',
            targetVillage,
            'Huno DeepSeek Defensa',
            validResponse
                ? `DeepSeek anula respuesta: ${fallbackResponse} → ${validResponse} (confianza=${(advice.confidence * 100).toFixed(0)}%) | ${advice.rationale}`
                : `DeepSeek sugiere ${advice.response} pero confianza baja (${(advice.confidence * 100).toFixed(0)}%). Manteniendo: ${fallbackResponse}`,
            { deepseekResponse: advice.response, fallback: fallbackResponse, confidence: advice.confidence },
            'military',
        );

        return {
            used: true,
            overridden: Boolean(validResponse),
            response: validResponse || fallbackResponse,
            advice,
        };
    } catch (err) {
        log?.('warn', targetVillage, 'Huno DeepSeek Defensa', `Error inesperado: ${err.message}. Usando respuesta estandar.`, null, 'military');
        return { used: false, reason: 'UNEXPECTED_ERROR', response: fallbackResponse };
    }
}
