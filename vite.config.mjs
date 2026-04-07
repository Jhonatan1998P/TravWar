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
    target: 'esnext',
    chunkSizeWarningLimit: 420,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/features/game/core/GameData.js')) {
            return 'game-data';
          }

          if (id.includes('/src/features/game/views/')) {
            if (id.includes('ConfigView.js')) return 'view-config';
            if (id.includes('VillageView.js') || id.includes('VillageCenterView.js')) return 'view-village';
            if (id.includes('ReportsView.js')) return 'view-reports';
            if (id.includes('MapView.js')) return 'view-map';
          }

          if (id.includes('/src/features/game/ui/')) {
            if (
              id.includes('BuildingInfoUI.js')
              || id.includes('BattleReportUI.js')
              || id.includes('AttackPanelUI.js')
              || id.includes('TradePanelUI.js')
            ) {
              return 'ui-panels';
            }

            if (
              id.includes('ConstructionQueueUI.js')
              || id.includes('RecruitmentQueueUI.js')
              || id.includes('ResearchQueueUI.js')
              || id.includes('SmithyQueueUI.js')
              || id.includes('MovementsUI.js')
              || id.includes('TroopsUI.js')
            ) {
              return 'ui-activity';
            }
          }
        }
      }
    }
  }
});
