import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PRESET_TRIBUS = Object.freeze(['germanos', 'egipcios']);
const PRESET_VELOCIDADES = Object.freeze([
    Object.freeze({ velocidad: 100, maxTicks: 900000 }),
    Object.freeze({ velocidad: 500, maxTicks: 300000 }),
    Object.freeze({ velocidad: 1000, maxTicks: 300000 }),
    Object.freeze({ velocidad: 5000, maxTicks: 300000 }),
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LEGACY_SCRIPT_PATH = resolve(__dirname, 'simulate-german-phases.mjs');

function runLegacyScript(args, { captureOutput = false } = {}) {
    const result = spawnSync(process.execPath, [LEGACY_SCRIPT_PATH, ...args], {
        encoding: 'utf8',
        stdio: captureOutput ? 'pipe' : 'inherit',
        maxBuffer: 1024 * 1024 * 128,
    });

    if (result.error) {
        throw result.error;
    }

    const acceptedExitCodes = new Set([0, 2]);
    if (!acceptedExitCodes.has(result.status)) {
        const stderr = (result.stderr || '').trim();
        throw new Error(stderr || `La simulacion fallo con codigo ${result.status}.`);
    }

    return result.stdout;
}

function extractSummary(simulationResult) {
    const village = simulationResult?.aldeas?.[0] || null;
    const history = village?.historial || [];
    const troopsByPhase = {};

    for (let index = 1; index < history.length; index += 1) {
        const phaseName = history[index - 1]?.nombreFase;
        if (!phaseName) continue;
        troopsByPhase[phaseName] = history[index]?.unidadesReclutadas || {};
    }

    return {
        completada: Boolean(simulationResult?.completada),
        completadoEnTick: simulationResult?.completadoEnTick ?? null,
        faseFinal: village?.nombreFaseFinal || null,
        velocidades: {
            velocidadJuego: simulationResult?.configuracion?.velocidadJuego ?? null,
            maximoTicks: simulationResult?.configuracion?.maximoTicks ?? null,
        },
        entradasFase: history.map(entry => ({
            fase: entry?.nombreFase || null,
            tiempoReal: entry?.tiempoReal || null,
            tiempoJuego: entry?.tiempoJuego || null,
        })),
        tropasPorFase: troopsByPhase,
        progresoCiclos: village?.diagnosticos?.progresoCiclos || {},
    };
}

function runPresetMatrix() {
    const report = {};

    PRESET_TRIBUS.forEach(tribu => {
        report[tribu] = {};

        PRESET_VELOCIDADES.forEach(({ velocidad, maxTicks }) => {
            const rawOutput = runLegacyScript([
                tribu,
                String(velocidad),
                String(maxTicks),
            ], { captureOutput: true });

            const parsed = JSON.parse(rawOutput);
            report[tribu][`x${velocidad}`] = extractSummary(parsed);
        });
    });

    return report;
}

function printHelp() {
    const lines = [
        'Uso (simulacion individual):',
        '  node scripts/ai/simulate-phases.mjs <tribu> <velocidad> <maxTicks> [verbose]',
        'Ejemplo:',
        '  node scripts/ai/simulate-phases.mjs egipcios 5000 300000',
        '',
        'Uso (reporte preset 100/500/1000/5000):',
        '  node scripts/ai/simulate-phases.mjs reporte',
        '  node scripts/ai/simulate-phases.mjs matriz',
    ];

    console.log(lines.join('\n'));
}

function main() {
    const args = process.argv.slice(2);
    const command = (args[0] || '').toLowerCase();

    if (command === '--help' || command === '-h') {
        printHelp();
        return;
    }

    if (!command || command === 'reporte' || command === 'matriz' || command === '--reporte' || command === '--matriz') {
        const report = runPresetMatrix();
        console.log(JSON.stringify({
            configuracion: {
                tribus: PRESET_TRIBUS,
                velocidadesPreset: PRESET_VELOCIDADES,
            },
            reporte: report,
        }, null, 2));
        return;
    }

    runLegacyScript(args, { captureOutput: false });
}

main();
