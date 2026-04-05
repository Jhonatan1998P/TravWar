# Project Structure

## Organization Criteria

This project uses a hybrid feature/layered architecture to keep modules cohesive and imports stable.

- `src/app/`: app entrypoint and router.
- `src/features/game/`: main game feature (`ai`, `core`, `engine`, `state`, `ui`, `views`).
- `src/shared/lib/`: reusable cross-feature utilities.
- `src/shared/state/`: global app state (Zustand store).
- `src/styles/`: global Tailwind/PostCSS styles.

## Build and Tooling

- Bundler: Vite (`vite.config.mjs`)
- CSS pipeline: Tailwind CSS + PostCSS + Autoprefixer
- Global app context: Zustand vanilla store (`src/shared/state/GlobalStore.js`)
- Static assets source: `assets/` (copied as Vite public dir)
- Path aliases: `@`, `@app`, `@game`, `@shared`, `@styles`

## Naming Conventions

- File names remain aligned with the existing codebase style.
- Domain folders are explicit and responsibility-oriented.
- New app entrypoints live under `src/app/`.
