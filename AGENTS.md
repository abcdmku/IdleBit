# IdleBit Agent Guide

## Project Shape

- `src/game`: pure simulation, content definitions, selectors, save schema, and tests.
- `src/ui`: React components, CSS, icons, layout, and browser interaction.
- `src/platform`: persistence and platform adapters used by the web app.
- `electron`: Electron main and preload code.
- `docs`: QA notes, implementation notes, and non-runtime documentation.

Game rules belong in `src/game`. React and Electron call game functions; they do not own progression, unlocks, rewards, timers, or balancing rules.

All simulation timing is hardware-derived: explicit bit/operation/work volumes
advance through real component rates. Do not add wall-clock task timers where a
cache, CPU, RAM, storage, network, accelerator, cluster, or Cloud capacity lane
can own the work.

Fixed clocks are only deadlines, offer expiry, observation windows, or physical
latencies, and must be named as such. Never reverse-engineer workload size from
a target duration. Repeatable Credit payouts derive from the same exact paid
bit/cycle work volume; managed-work premiums multiply that volume instead of
replacing it with a hand-authored task payout.

## Pre-Live Design Policy

IdleBit is pre-live. Breaking save schema, UI, and mechanic changes are allowed when they move the prototype toward the current spec. Keep `game-spec.md`, `FEATURES.md`, and `docs/qa-notes.md` aligned with those changes, and prefer clear migration/reset notes over preserving obsolete behavior.

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
- Add tests for progression math, unlock gates, operation queue behavior, cache/RAM/storage staging, reliability stress, and save migration.

## UI Standards

- The first screen is playable.
- Use concise, useful copy: labels, values, unlock reasons, warnings, and short tooltips.
- Do not add descriptive filler just to occupy space.
- Keep controls discoverable through familiar buttons, icons, tabs, toggles, and concise labels.
- Use the reference images for tone only: dark hardware console, neon accents, visible compute systems.
- Keep the interface readable on desktop and mobile.
- Count real operation invocations as `ops`; show cache/RAM bits and CPU cycles
  separately instead of adding unlike units and labeling the sum as operations.
- Never move controls, cards, menus, or hardware regions in response to starting,
  queueing, completing, pausing, or failing work. Reserve stable geometry for
  runtime status and update content in place; overflow must scroll or clip
  inside that reserved region rather than reflow neighboring UI.

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
