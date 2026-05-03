const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const REQUEST_TIMEOUT_MS = 8000;

function getApiKey() {
    return import.meta.env?.VITE_DEEPSEEK_API_KEY || null;
}

function buildAttackContext({ myVillages, availableForces, targets, race, archetype, gameState, ownerId }) {
    const forcesSummary = availableForces.slice(0, 3).map(force => ({
        village: force.village.name,
        attackPower: Math.round(force.power),
        totalPower: Math.round(force.totalPower),
        scoutCount: force.scoutCount,
        isArmyBusy: force.isArmyBusy,
    }));

    const knownTargets = (targets.known || []).slice(0, 5).map(t => ({
        id: t.id,
        ownerId: t.ownerId,
        type: t.targetType,
        spyStatus: t.spyStatus,
        coords: t.coords,
        estimatedDefense: t.estimatedDefense ? Math.round(t.estimatedDefense) : null,
        intel: t.intel ? {
            population: t.intel.population,
            wallLevel: t.intel.wallLevel,
        } : null,
    }));

    const myPlayer = gameState.players.find(p => p.id === ownerId);

    return {
        race,
        archetype,
        playerScore: myPlayer?.score || 0,
        forces: forcesSummary,
        knownTargets,
        unknownTargetCount: (targets.unknown || []).length,
    };
}

function buildDefenseContext({ movement, targetVillage, attackerVillage, attackPower, localDefense, canHoldLocally, canHoldWithReinforcements, threatType, threatLevel, posture, projectedLossSeverity }) {
    return {
        incomingMovementType: movement.type,
        attackPower: Math.round(attackPower),
        localDefenseEstimate: Math.round(localDefense),
        canHoldLocally,
        canHoldWithReinforcements,
        threatType,
        threatLevel,
        currentPosture: posture,
        projectedLossSeverity,
        targetVillagePopulation: targetVillage.population?.current || 0,
        hasAttackerData: Boolean(attackerVillage),
    };
}

function parseAttackAdvice(content) {
    try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        const raw = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
        const parsed = JSON.parse(raw);

        return {
            action: parsed.action || 'hold',
            priority: parsed.priority || 'farming',
            targetId: parsed.targetId || null,
            rationale: parsed.rationale || '',
            confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
        };
    } catch {
        return null;
    }
}

function parseDefenseAdvice(content) {
    try {
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        const raw = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
        const parsed = JSON.parse(raw);

        const VALID_RESPONSES = new Set(['hold', 'dodge', 'counterpressure', 'counterattack', 'reinforce']);
        const response = VALID_RESPONSES.has(parsed.response) ? parsed.response : null;

        return {
            response,
            rationale: parsed.rationale || '',
            confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
        };
    } catch {
        return null;
    }
}

async function callDeepSeek(messages) {
    const apiKey = getApiKey();
    if (!apiKey) {
        return { success: false, reason: 'NO_API_KEY' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: DEEPSEEK_MODEL,
                messages,
                temperature: 0.3,
                max_tokens: 300,
                response_format: { type: 'json_object' },
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            return { success: false, reason: `HTTP_${response.status}`, details: errorText };
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content || '';
        return { success: true, content };
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            return { success: false, reason: 'TIMEOUT' };
        }
        return { success: false, reason: 'FETCH_ERROR', details: err.message };
    }
}

export async function askDeepSeekAttackAdvice(context) {
    const systemPrompt = `Eres el general de una tribu Huna en un juego de estrategia. 
Tu tribu es ofensiva y rápida. Debes decidir la táctica de ataque óptima.
Responde SOLO con JSON válido en este formato exacto:
{"action":"attack|raid|spy|hold","priority":"nemesis|farming|strategic|scouting","targetId":null,"rationale":"breve razón en español","confidence":0.0-1.0}`;

    const userPrompt = `Contexto de combate huno:
${JSON.stringify(context, null, 2)}

Decide la mejor acción de ataque. Si hay objetivos conocidos con buenas posibilidades, sugiere atacar. Si no, sugiere farmeo u obtener inteligencia (spy).`;

    const result = await callDeepSeek([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ]);

    if (!result.success) {
        return { success: false, reason: result.reason, advice: null };
    }

    const advice = parseAttackAdvice(result.content);
    if (!advice) {
        return { success: false, reason: 'PARSE_ERROR', advice: null };
    }

    return { success: true, advice };
}

export async function askDeepSeekDefenseAdvice(context) {
    const systemPrompt = `Eres el general de una tribu Huna en un juego de estrategia.
Tu tribu prefiere preservar sus tropas ofensivas y contraatacar cuando es ventajoso.
Responde SOLO con JSON válido en este formato exacto:
{"response":"hold|dodge|counterpressure|counterattack|reinforce","rationale":"breve razón en español","confidence":0.0-1.0}`;

    const userPrompt = `Un ataque enemigo se aproxima a tu aldea:
${JSON.stringify(context, null, 2)}

Decide la mejor respuesta defensiva. Si puedes aguantar, mantén posición. Si las pérdidas serán graves, esquiva. Si tienes ventaja clara, contraataca.`;

    const result = await callDeepSeek([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ]);

    if (!result.success) {
        return { success: false, reason: result.reason, advice: null };
    }

    const advice = parseDefenseAdvice(result.content);
    if (!advice) {
        return { success: false, reason: 'PARSE_ERROR', advice: null };
    }

    return { success: true, advice };
}

export { buildAttackContext, buildDefenseContext };
