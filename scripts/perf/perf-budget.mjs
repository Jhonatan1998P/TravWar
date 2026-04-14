import fs from 'node:fs';
import path from 'node:path';

const DIST_DIR = path.resolve('dist');
const INDEX_HTML_PATH = path.join(DIST_DIR, 'index.html');
const ENTRY_JS_BUDGET_BYTES = 400 * 1024;
const ENTRY_CSS_BUDGET_BYTES = 60 * 1024;

function fail(message) {
  console.error(`[perf:budget] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(INDEX_HTML_PATH)) {
  fail('No se encontro dist/index.html. Ejecuta primero `npm run build`.');
}

const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

const scriptMatch = html.match(/<script[^>]+src="([^"]+\.js)"/);
if (!scriptMatch) {
  fail('No se encontro script JS de entrada en dist/index.html.');
}

const cssMatch = html.match(/<link[^>]+href="([^"]+\.css)"/);

const entryJsPath = path.join(DIST_DIR, scriptMatch[1].replace(/^\//, ''));
if (!fs.existsSync(entryJsPath)) {
  fail(`No se encontro el archivo JS de entrada: ${entryJsPath}`);
}

const entryJsSize = fs.statSync(entryJsPath).size;

let entryCssSize = 0;
if (cssMatch) {
  const entryCssPath = path.join(DIST_DIR, cssMatch[1].replace(/^\//, ''));
  if (fs.existsSync(entryCssPath)) {
    entryCssSize = fs.statSync(entryCssPath).size;
  }
}

const formatKb = (bytes) => `${(bytes / 1024).toFixed(2)} kB`;

console.log('[perf:budget] Resultado');
console.log(`[perf:budget] JS entrada: ${formatKb(entryJsSize)} (max ${formatKb(ENTRY_JS_BUDGET_BYTES)})`);
console.log(`[perf:budget] CSS entrada: ${formatKb(entryCssSize)} (max ${formatKb(ENTRY_CSS_BUDGET_BYTES)})`);

if (entryJsSize > ENTRY_JS_BUDGET_BYTES) {
  fail('Presupuesto excedido: JS de entrada demasiado grande.');
}

if (entryCssSize > ENTRY_CSS_BUDGET_BYTES) {
  fail('Presupuesto excedido: CSS de entrada demasiado grande.');
}

console.log('[perf:budget] OK - presupuestos cumplidos.');
