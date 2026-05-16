# IdleBit Agent Guide

## Project Shape

- `src/game`: pure simulation, content definitions, selectors, save schema, and tests.
- `src/ui`: React components, CSS, icons, layout, and browser interaction.
- `src/platform`: persistence and platform adapters used by the web app.
- `electron`: Electron main and preload code.
- `docs`: QA notes, implementation notes, and non-runtime documentation.

Game rules belong in `src/game`. React and Electron call game functions; they do not own progression, unlocks, rewards, timers, or balancing rules.

## Coding Standards

- Use strict TypeScript.
- Prefer pure functions for simulation and selectors.
- Keep functions focused on one job.
- Keep files grouped by one logical purpose.
- Keep files under a few hundred lines when practical. Split by domain before files become hard to scan.
- Avoid duplication. Extract shared math, formatting, and state transitions when the same logic appears twice.
- Model state with explicit types instead of loose objects.
- Use immutable updates for game state.
- Save serializable game state, not UI or Electron objects.
- Keep renderer code deterministic where possible.
- Add tests for progression math, unlock gates, queue behavior, and save migration.

## UI Standards

- The first screen is playable.
- Use concise, useful copy: labels, values, unlock reasons, warnings, and short tooltips.
- Do not add descriptive filler just to occupy space.
- Keep controls discoverable through familiar buttons, icons, tabs, toggles, and concise labels.
- Use the reference images for tone only: dark hardware console, neon accents, visible compute systems.
- Keep the interface readable on desktop and mobile.

## Subagent Ownership

- Lead/integrator owns root docs, configs, dependency choices, and final consistency.
- Simulation agent owns `src/game/**`.
- UI agent owns `src/ui/**`.
- Platform agent owns `electron/**` and `src/platform/**`.
- QA agent owns `docs/qa-notes.md` and verification notes.

Agents are not alone in this repository. Do not revert edits made by others. Keep changes scoped to your owned area and adapt to nearby work.

## Feature Tracking

Update `FEATURES.md` whenever a feature changes status. Use:

- `Not Started`: planned but untouched.
- `In Progress`: currently being implemented.
- `Built`: implemented and manually reachable or wired.
- `Tested`: covered by automated tests or documented smoke checks.
- `Deferred`: intentionally outside the current build.

