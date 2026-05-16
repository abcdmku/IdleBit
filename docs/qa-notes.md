# IdleBit QA Notes

## Vertical Slice Scope

Target scope from `game-spec.md` section 13.2:

- Single-core start with clock speed, cache, current job, job duration, credits, and data visible.
- Clock and cache upgrades are purchasable and affect job completion as specified.
- Multi-core unlock is gated by early benchmark progression.
- Four-core milestone unlocks scheduler behavior.
- Second CPU unlock reveals RAM and power.
- RAM and power stay hidden before the second CPU stage.
- Cooling, networking, data centers, SLA contracts, availability zones, and regions remain out of scope for this slice.

## Unit Coverage Checklist

- Job timing:
  - `required_cycles / effective_clock` is the baseline.
  - Clock upgrades reduce single-job time.
  - Cache below requirement penalizes job time.
  - Cache meeting or exceeding requirement applies the intended bonus.
- Progression gates:
  - Cache upgrades unlock only after the intended early job count.
  - Auto-repeat unlocks after the intended early job count.
  - Multi-core research requires the micro/parallelism benchmark path.
  - Scheduler unlocks at the four-core milestone.
  - Second CPU unlock requires four cores plus multi-core benchmark completion.
- Parallelism:
  - Extra cores increase concurrent throughput.
  - Extra cores do not reduce one non-parallel job's duration before scheduler support.
  - Basic queue assigns waiting jobs to idle cores.
- Visibility rules:
  - RAM and power are hidden before second CPU.
  - RAM and power become visible immediately after second CPU unlock.
  - Out-of-scope systems are not exposed early.
- Economy:
  - Completed jobs pay credits and data exactly once.
  - Upgrade purchases debit the correct currency and cannot underflow balances.
  - Unlock currency and spendable currency remain distinct.

## Web Smoke Checklist

- App boots to the first actionable CPU screen without console errors.
- Starting state matches the spec: 1 core, 10 Hz clock, 1 B cache, no visible RAM or power.
- Player can start and complete a Bit Flip-style job.
- Credits/data increase after completion.
- Clock upgrade can be purchased and visibly shortens subsequent job duration.
- Cache upgrade can be purchased and visibly improves cache-sensitive jobs.
- Auto-repeat or queue controls appear only after their unlock gates.
- Multi-core flow allows multiple jobs to run concurrently after core unlock.
- Scheduler/basic queue flow pulls jobs onto idle cores at the four-core milestone.
- Second CPU flow reveals RAM and power without revealing later systems.

## Electron Smoke Checklist

- Electron shell launches the same first actionable CPU screen as the web build.
- App menu/window controls do not block gameplay controls.
- Reload preserves or resets state according to the chosen save design.
- Main/renderer startup has no unhandled exceptions.
- Production package opens without dev-server-only assumptions.
- Window resize keeps core stats, job controls, upgrade controls, and unlock messaging visible.

## Responsive UI Checklist

- Test at 390x844, 768x1024, 1366x768, and 1920x1080.
- Core status, current job, currency, and primary action remain visible without overlap.
- Upgrade controls fit their labels and disabled/locked states.
- Job list or queue remains readable as core count increases.
- Unlock messaging does not occlude active job controls.
- No hidden early systems appear due to responsive layout changes.
- Keyboard, pointer, and touch input all operate the primary job and upgrade flow.

## FEATURES.md Status Verification

- Confirm `FEATURES.md` exists before release gating.
- Cross-check every implemented feature against the vertical slice scope above.
- Mark in-scope, implemented, and manually verified items separately.
- Confirm out-of-scope systems are listed as planned or omitted, not marked done.
- Verify feature status matches actual UI behavior, not only reducer/model support.
- Add check evidence: unit command, web smoke command, Electron smoke command, and responsive viewport pass date.

Current `FEATURES.md` observations:

- `FEATURES.md` exists and names `game-spec.md` as the source of truth.
- Vertical slice simulation and responsive UI features are marked `Tested`.
- Browser persistence and Electron shell are marked `Built`.
- Later-stage systems are marked `Deferred`, which matches the first vertical slice scope.
- Status granularity is intentional: `Power reveal` is `Tested`, while full `Power` simulation is `Deferred`.
- Stage wording is intentional: `Stage 4: full system building` is `Deferred`, while second CPU, RAM reveal, and power reveal are tracked in the vertical slice.

## Checks Run

- `npm test`: passed with 6 game simulation tests.
- `npm run typecheck`: passed for app and Electron TypeScript.
- `npm run build`: passed for Vite production output and Electron compile.
- Desktop browser smoke: passed at `http://127.0.0.1:4173`; Bit Flip run completed and paid credits.
- Mobile browser smoke: passed at 390x844 viewport with no visible overlap.
- Electron launch smoke: not run interactively; Electron compile passed.

## Current Repository Check

Current files include the React/Vite app, pure `src/game` simulation, platform persistence adapter, Electron shell, feature tracker, QA notes, and reference PNGs.
