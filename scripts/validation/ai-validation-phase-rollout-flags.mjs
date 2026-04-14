import AIController from '../../src/features/game/ai/AIController.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const checks = [];
const runCheck = (name, fn) => {
    try {
        fn();
        checks.push({ name, ok: true });
    } catch (error) {
        checks.push({ name, ok: false, error: error.message });
    }
};

const sendCommand = () => ({ success: true });

runCheck('Rollout default mantiene phase engine activo en Germans', () => {
    const ai = new AIController('ai_g_default', 'balanced', 'germans', 'aggressive', sendCommand, { gameSpeed: 1 }, 'Pesadilla');
    assert(ai.getGoalManager() === null, 'german por defecto debe usar phase engine sin GoalManager');
});

runCheck('Rollout por tribu desactiva phase engine en Germans', () => {
    const ai = new AIController(
        'ai_g_flag_off',
        'balanced',
        'germans',
        'aggressive',
        sendCommand,
        { gameSpeed: 1, aiPhaseEngineRollout: { germans: false } },
        'Pesadilla',
    );
    assert(ai.getGoalManager() !== null, 'con rollout off german debe volver a GoalManager');
});

runCheck('Rollout por all=false desactiva phase engine en Egyptians', () => {
    const ai = new AIController(
        'ai_e_flag_off',
        'balanced',
        'egyptians',
        'aggressive',
        sendCommand,
        { gameSpeed: 1, aiPhaseEngineRollout: { all: false } },
        'Pesadilla',
    );
    assert(ai.getGoalManager() !== null, 'con rollout all=false egyptian debe volver a GoalManager');
});

runCheck('Raza legacy mantiene GoalManager', () => {
    const ai = new AIController('ai_r_legacy', 'balanced', 'romans', 'aggressive', sendCommand, { gameSpeed: 1 }, 'Pesadilla');
    assert(ai.getGoalManager() !== null, 'romans siempre debe usar GoalManager');
});

checks.forEach(check => {
    if (check.ok) {
        console.log(`OK   ${check.name}`);
        return;
    }
    console.log(`FAIL ${check.name}`);
    console.log(`     ${check.error}`);
});

const failed = checks.filter(check => !check.ok);
if (failed.length > 0) {
    console.error(`\nValidacion de rollout por flags fallo (${failed.length}/${checks.length}).`);
    process.exit(1);
}

console.log(`\nValidacion de rollout por flags aprobada (${checks.length}/${checks.length}).`);
