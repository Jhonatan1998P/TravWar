# AGENTS.md

## Project Overview
- **Name**: Project Genesis - Guerra de Tribus (Tribal Wars clone)
- **Type**: Browser-based strategy game (Vite + TailwindCSS + vanilla JS)
- **Stack**: Vite 5, TailwindCSS 3, Zustand 5, vanilla JS (no framework)

## Dev Commands
```bash
npm run dev      # Start dev server (port via $PORT env, default 5173)
npm run build    # Production build
npm run build:check  # Build + performance budget check
npm run preview  # Preview production build
```

## Architecture
- **Entry point**: `index.html` → `/src/app/main.js`
- **Aliases**: `@` → `src/`, `@app` → `src/app`, `@game` → `src/features/game`, `@shared` → `src/shared`, `@styles` → `src/styles`
- **State**: Zustand store (`@shared/state/GlobalStore.js`)
- **Routing**: Client-side router in `src/app/router.js` with SPA navigation

## Key Directories
- `src/features/game/` - Game logic (AI, engine, state, views, UI)
- `src/app/` - App entry, router, guard
- `src/shared/` - Utilities, state
- `src/styles/` - Tailwind entry (`main.css`)

## Build Notes
- Vite chunks are manually split for game-data, views, and UI panels
- Target is `esnext`; no TypeScript in this project
- Custom Tailwind colors and fonts defined in `tailwind.config.js`

## Project-specific Conventions
- AI logic lives in `src/features/game/ai/` with phase engines per tribe
- `src/features/game/core/data/` contains buildings/units constants
- UI components are large single-file modules (e.g., `BuildingInfoUI.js` at ~96KB)

## Performance
- Performance budget check: `npm run perf:budget`
- Performance utilities in `src/shared/lib/perf.js`

## Replit-Specific
- `.replit` configures port 5000 (internal) → 80 (external)
- `PORT=5000 npm run dev` runs in Replit workflows