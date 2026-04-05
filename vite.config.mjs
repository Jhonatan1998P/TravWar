import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const replitDomains = (process.env.REPLIT_DOMAINS || '')
  .split(',')
  .map((domain) => domain.trim())
  .filter(Boolean);

const allowedHosts = ['localhost', '127.0.0.1', '.replit.dev', '.replit.app', ...replitDomains];

const devPort = Number(process.env.PORT || 5173);
const isReplit = Boolean(process.env.REPL_ID || process.env.REPL_SLUG || process.env.REPLIT_DOMAINS);

export default defineConfig({
  publicDir: 'assets',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
      '@game': fileURLToPath(new URL('./src/features/game', import.meta.url)),
      '@aiEditor': fileURLToPath(new URL('./src/features/ai-editor', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@styles': fileURLToPath(new URL('./src/styles', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: devPort,
    strictPort: true,
    allowedHosts,
    hmr: isReplit
      ? {
          clientPort: 443
        }
      : undefined
  },
  build: {
    target: 'esnext'
  }
});
