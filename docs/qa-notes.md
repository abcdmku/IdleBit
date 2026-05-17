# IdleBit QA Notes

## Vertical Slice Scope

Target scope from `game-spec.md` section 13.2:

- Single-core start with clock speed, cache, bit-scale tasks, current task state, credits, and data visible.
- Bit-scale startup keeps the first task choices tiny before byte-scale/cache-sensitive work appears.
- Task and research lists reveal progressively; the first screen exposes only the Fetch Bit / Decode Bit starter pair, with Decode Bit blocked until 2 b cache.
- Starting cache capacity and cache speed upgrades are visible from the first screen and cost more data than credits.
- Player-facing jobs/tasks are backed by low-level CPU operations.
- Task definitions infer cached internal recipe-step DAG nodes plus deterministic accept/stage/execute/complete dependencies for ready/waiting reasons.
- Clock upgrades affect CPU operation throughput.
- Cache upgrades affect cache operation queue capacity/load behavior.
- Cache-required tasks wait for cache fill before required operations execute.
- Active and queued tasks can be canceled without granting rewards.
- Multi-core unlock is gated by early benchmark progression.
- RAM Control appears alongside System Scheduler after Local Scheduler research.
- Four-core milestone plus RAM Control and 1 Kb RAM unlock System Scheduler behavior.
- Completed System Scheduler research reveals a system-level scheduler surface for whole system tasks.
- System Queue Slot upgrades are separate from CPU Queue Slot upgrades.
- Second CPU unlock reveals power.
- RAM stays hidden/actionless before RAM Control, then becomes the staging surface needed for System Scheduler; power stays hidden/actionless before the matched CPU stage.
- Cooling controls are gated by Thermal Control research after PSU/heat pressure is visible.
- Auto-repeat is out of scope for the early slice and should remain deferred.
- Cooling, networking, data centers, SLA contracts, availability zones, and regions remain out of scope for this slice.

## Unit Coverage Checklist

- Task timing:
  - `required_cpu_operations / effective_clock` is the baseline for executable CPU operations.
  - Clock upgrades reduce single-task operation time.
  - Tasks decompose into low-level operations, with explicit read/write/overwrite memory actions and counted operation nodes available for large repeated work.
  - Task progress is a single whole-recipe meter and does not restart at each internal operation.
  - CPU core progress tracks CPU execution only, not cache/RAM loading.
  - Canceling active tasks removes active work and releases cache/RAM reservations without paying completion rewards.
  - Task composition is acyclic and produces stable ready/waiting reasons.
  - Cache-required operations wait for cache fill at the operation's own DAG step instead of only applying a flat penalty or one task-wide prefill.
  - Fetch Bit uses a 1 b cache footprint; Decode Bit uses a 2 b cache footprint; Bit Flip and Bit Shift reuse their 1 b overwrite footprints.
  - Read/write/overwrite operations require cache for the amount of data they touch, spend CPU cycles while buffering cache writes, then wait idle if cache load has not caught up.
  - Task-level cache provisioning sums distinct read/write footprints while overwrite reuses the touched footprint.
  - Parallel cache-backed operations provision their per-core footprint across the required cores.
  - Cache residency preserves completed read/write footprints until task completion, while overwrite updates the existing footprint instead of adding another segment.
  - Cache capacity controls how much CPU operation queue can be loaded and ready.
  - Manual starts and scheduler pulls use free cache after active reservations, while queue acceptance uses total hardware fit so cache-heavy work can wait pending instead of over-committing active cache.
  - Cache load speed controls how quickly cache-required operations become ready, with cache load cycles matching touched bits so the displayed rate reads as bits per second.
  - When CPU clock and cache load rate are equal for a memory operation with matching cycle/bit counts, Buffer and cache-write progress stay aligned.
  - Byte Copy is modeled as counted byte-scale work: 8 read ops and 8 write ops with a 16 b total cache footprint, paying 32 operations after cache-load work is counted.
  - Counted memory-operation cache fill uses the total touched bits once, so an 8 b Byte Copy phase at 4.4 Hz advances in roughly two seconds instead of count-squared time.
- Progression gates:
  - Cache capacity and speed upgrades are available immediately and use data-weighted costs.
  - Auto-repeat does not unlock in the early slice.
  - Multi-core research requires the micro/parallelism benchmark path.
  - RAM Control unlocks RAM at 256 b capacity and a 1 Hz load rate.
  - RAM capacity and RAM speed upgrade separately, with data as the larger cost.
  - System Scheduler unlocks at the four-core milestone after RAM Control and at least 1 Kb RAM.
  - Second CPU unlock requires System Scheduler, multi-core benchmark completion, and System Bus research.
  - Matched CPU purchase copies the source CPU's cores, core clocks, cache, cache speed, and scheduler slots, and charges for the base CPU plus copied upgrades.
  - Thermal Control research does not appear before PSU/heat pressure is relevant.
- Parallelism:
  - Extra cores increase concurrent throughput.
  - Extra cores do not reduce one non-parallel task's duration before scheduler support.
  - Basic queue assigns ready operations/tasks to idle cores after queue slots are purchased.
  - CPU scheduler backlog capacity starts at 0; CPU Queue Slot upgrades add finite CPU queued-task capacity, full queues block additional CPU queue intake, and multicore tasks cannot provision more cores on a CPU than that CPU's scheduler slots support.
  - System tasks enter the visible System Scheduler as whole tasks through separate System Queue Slot capacity; CPU-local scheduler targeting only accepts CPU-bound tasks and reserves system task CPU work at dispatch time.
  - Scheduler pulls can skip pending cache/RAM-blocked queue entries and dispatch later ready CPU work when idle cores and staging capacity remain available.
  - Scheduler-dispatched tasks stay in the scheduler queue and keep their queue slot occupied until completion.
  - Scheduler queue slots render as a horizontal active/available strip instead of count badges, and queued scheduler tasks list their current waiting or active reason.
  - Canceling pending queued work removes only the unreserved queue entry and leaves already active scheduler reservations intact.
- Staging and reliability:
  - RAM extends the memory staging hierarchy after cache and stages larger active/intermediate work after RAM Control.
  - RAM load progress is visible as reserved/loading/ready staging, and CPU processing waits until the RAM-backed work is loaded.
  - Manual starts and scheduler pulls use free RAM after active reservations, while queue acceptance uses total hardware fit so RAM-heavy work can wait pending instead of spawning as waiting over-commit work.
  - RAM loading does not prevent unrelated manual or queued CPU-level work from starting when enough idle cores and cache remain.
  - Cache/RAM/storage load speeds are modeled as upgrade paths.
  - Tasks do not require power directly.
  - PSU stress derives from active hardware draw.
  - Dense cores/CPUs increase draw nonlinearly.
  - Severe PSU stress can throttle and later raise restart risk.
  - Cooling improves efficiency and reliability when implemented.
- Visibility rules:
  - RAM is hidden before RAM Control.
  - Power is hidden before matched CPU system building.
  - RAM becomes visible/actionable immediately after RAM Control.
  - PSU becomes visible/actionable after the matched CPU stage.
  - Cooling controls remain hidden until Thermal Control research is completed.
  - Research options are hidden until the player has earned starter resources.
  - Later tasks are hidden until their concept gate is met.
  - Out-of-scope systems are not exposed early.
- Economy:
  - Completed jobs pay credits equal to derived operation count, including CPU cycles plus cache/RAM load work, and data exactly once.
  - Upgrade purchases debit the correct currency and cannot underflow balances.
  - Unlock currency and spendable currency remain distinct.

## Web Smoke Checklist

- App boots to the first actionable CPU screen without console errors.
- Starting state matches the spec: 1 core, 1 Hz clock, 1 b cache, 1 Hz cache load rate, hidden 1 Hz RAM load rate with 0 b RAM capacity, Fetch Bit and Decode Bit visible, no visible RAM or power.
- First screen does not show byte-scale tasks, RAM/PSU actions, cooling actions, or the full research tree.
- Player can start and complete Fetch Bit, then reveal Decode Logic; Decode Bit remains visible but waits for the first 2 b cache upgrade.
- Credits/data increase after completion.
- Positive credits/data gains show +amount flyouts that travel into the matching HUD total.
- Clock upgrade can be purchased and visibly shortens subsequent job duration.
- Cache upgrade can be purchased and visibly affects cache queue/fill behavior for cache-sensitive tasks.
- Cache-required tasks show a wait/fill state before their required operations run.
- Cache meter states are visually distinct as Buffer, Load, and Ready; CPU-filled cache buffers fill a dashed track at CPU speed with a solid cache-write overlay at cache speed; completed tasks release cache immediately and do not leave held/resident bits.
- CPU core meters remain idle during cache fill; task cards continue showing aggregate task progress through load and compute phases.
- Task wait reasons match the inferred composition DAG.
- Auto-repeat controls do not appear in the early slice.
- Queue/scheduler controls appear only after their unlock gates.
- Multi-core flow allows multiple jobs to run concurrently after core unlock.
- CPU Operation Scheduler/basic queue flow pulls ready operations/tasks onto idle cores after the player buys CPU-local scheduler queue slots.
- RAM Control reveals RAM at 256 b/1 Hz and enables larger RAM/cache tasks before System Scheduler.
- System Scheduler remains blocked until RAM reaches at least 1 Kb.
- System Scheduler appears as a hardware surface after research, exposes separate System Queue Slot purchases, and selected system tasks dispatch through it instead of the CPU-local scheduler.
- Second CPU flow reveals power without revealing later systems.
- RAM readouts communicate active/intermediate staging.
- PSU readouts communicate draw, headroom, stress, and restart risk without making power a per-task requirement.
- Thermal Control research unlocks cooling controls only after PSU/heat pressure is visible.

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
- Cache fill/wait states remain readable without blocking primary controls.
- Unlock messaging does not occlude active job controls.
- No hidden early systems appear due to responsive layout changes.
- Keyboard, pointer, and touch input all operate the primary job and upgrade flow.

## FEATURES.md Status Verification

- Confirm `FEATURES.md` exists before release gating.
- Cross-check every implemented feature against the vertical slice scope above.
- Mark in-scope, implemented, and manually verified items separately.
- Confirm out-of-scope systems are listed as planned or omitted, not marked done.
- Verify feature status matches actual UI behavior, not only reducer/model support.
- Verify `In Progress` target rows have matching tests before they move to `Tested`.
- Verify `Built` rows are reachable in the playable UI and `Tested` rows cite automated or smoke evidence.
- Verify auto-repeat remains `Deferred` until later automation work.
- Add check evidence: unit command, web smoke command, Electron smoke command, and responsive viewport pass date.

Current `FEATURES.md` observations:

- `FEATURES.md` exists and names `game-spec.md` as the source of truth.
- Vertical slice simulation and responsive UI features that match the current operation-task build are marked `Tested` when existing notes cite automated or smoke evidence.
- Bit-scale startup, progressive task/research reveal, inferred task composition DAG, and Thermal Control gate are now tracked as `Tested` after automated verification and browser smoke.
- Operation composition, cache queue/fill behavior, paid cache/RAM load operation totals, finite CPU-local scheduler queue slots, separate System Scheduler queue slots, system-vs-CPU scheduler task routing, active scheduler queue reservations until completion, scheduler waiting/active reasons, scheduler width gating for multicore tasks, CPU-local cache/scheduler gates, RAM Control and 1 Kb System Scheduler gates, matched CPU package costing/spec copies, data-weighted cache/RAM upgrade costs, cache/RAM staging free-capacity start and scheduler pull gates, visible RAM load progress before CPU execution, RAM-load coexistence with unrelated manual CPU work and queued CPU work, queue acceptance under active pressure, PSU stress, dense hardware draw, separate cache/RAM capacity-speed upgrades, and cooling reliability are covered by automated or smoke verification.
- Browser persistence and Electron shell are marked `Built`.
- Auto-repeat is marked `Deferred` under the new target even if old prototype behavior existed.
- Later-stage systems are marked `Deferred`, which matches the first vertical slice scope.
- Status granularity is intentional: `Power reveal` and `PSU reliability stress` are separate `Tested` rows.
- Stage wording is intentional: `Stage 4: full system building` is `Deferred`, while RAM Control, matched CPU, and power reveal are tracked in the vertical slice.
- Research cards now list requirement rows and own benchmark compute actions; benchmark tasks are intentionally hidden from the normal task catalog after this pass.

## Checks Run

- `npm test`: passed with 55 tests on May 17, 2026: 46 game simulation tests plus 9 UI tests covering armed-only credits/data gain flyouts, cleanup, Buffer/Load/Ready dashed/solid cache layers, Byte Copy split read/write cache segments, RAM loading segment progress, generic single-CPU labels, horizontal scheduler slot strips, scheduler queued-task waiting reasons and cancel controls, visible System Scheduler routing for system tasks, CPU scheduler blocking for whole system tasks, active/queued task cancellation, equal-rate CPU/cache buffer alignment, research-card benchmark compute, and research-only scheduler unlock gates. Simulation coverage includes 1 Hz/1 b initial state, zero default CPU and System Scheduler queue slots, purchased CPU Queue Slot capacity, separate System Queue Slot capacity, system scheduler intake for whole system tasks, dispatch-time CPU scheduler reservation for system task CPU work, active scheduler queue reservations until completion, scheduler width blocking for multicore provisioning, full-queue intake blocking, CPU-local cache/scheduler routing, no cross-CPU core splitting for multicore tasks, RAM Control reveal, 256 b/1 Hz RAM start, separate RAM speed upgrades, data-weighted cache/RAM upgrade costs, paid cache/RAM load operation totals, 1 Kb System Scheduler gate, legacy System Scheduler research id migration, matched CPU package copies/costing, cache/RAM load starts, visible RAM loading before CPU execution, RAM-load coexistence with unrelated manual CPU work and later queued CPU-ready dispatch, starter cache footprints, counted task work, Byte Copy counted cache-fill timing plus 16 b read/write residency, overwrite residency reuse, parallel per-core cache provisioning, cache-backed operation actions, CPU-buffered memory cache writes, CPU/cache equal-rate alignment, CPU-idle cache waits, active-only cache reservation, completed-task cache release, active task cancel reward blocking, queued task cancel reservation preservation, legacy cache residency save cleanup, starting cache capacity/speed upgrades, grouped progressive reveal, cached internal recipe DAG data, per-operation cache staging, DAG-derived op-count task credit rewards, whole-task progress vs CPU-only execution progress, cache/RAM fit gates, cache/RAM free-capacity manual and scheduler pull gates, queue acceptance while active cache/RAM is full, RAM reveal/upgrades, scheduler queue intake, multicore completion, PSU restart risk, cooling improvement, and job action aliases.
- `npm run typecheck`: passed for app and Electron TypeScript on May 17, 2026.
- `npm run build`: passed for Vite production output and Electron compile on May 17, 2026.
- `http://localhost:5176/` Playwright smoke on May 17, 2026: app loaded as IdleBit at 1365x900, first screen showed grouped CPU Bound Fetch Bit/Decode Bit work with generic CPU/cache labels, and RAM/PSU/System Scheduler text was absent from the opening view.
- Desktop browser smoke: passed at `http://127.0.0.1:4173` via local Playwright fallback; first screen is bit-scale with Fetch Bit and Decode Bit visible, research initially hidden/empty, RAM/PSU/cooling status entries absent, centered `CPU` header, `Cache` title, and row-aligned core/cache upgrade buttons.
- Mobile browser smoke: passed at 390x844 viewport via local Chrome CDP fallback; the task DAG modal opens from Fetch Bit and remains usable without horizontal layout overflow.
- Interaction smoke: automated coverage verifies Fetch Bit as the first runnable task, Decode Bit as a visible 2 b cache-gated starter goal, and Decode Logic as the first research reveal.
- Progressive reveal smoke: passed; before RAM Control, RAM remains hidden/actionless; before matched CPU system building, PSU remains hidden/actionless; the full research tree is hidden, and cooling controls are unavailable.
- Research/task comment pass: automated coverage verifies Bit Flip and Bit Shift unlock together from Decode Logic, Byte Copy unlocks from Byte Operations, Packet Check remains gated by Cache Mapping, benchmark compute runs from research cards, completed benchmarks do not linger in the task list, and scheduler unlocks require research instead of direct upgrade shortcuts.
- Hardware inline control pass: passed; the CPU header is centered and no longer shows an active-count suffix, the core and cache modules share header/status, aligned stat rows, row-aligned 58px by 27px upgrade buttons with icon-number credit/data costs, and meter styling, the cache header reads `Cache`, cache capacity and speed upgrades are visible from the first screen, cache speed is visible, cache-fill shows active core-colored reservation segments with explicit Buffer/Load/Ready labels, CPU-filled cache buffers fill a dashed track at CPU speed with a solid cache-write overlay at cache speed, completed tasks release cache immediately without held or resident cache styling, the single-CPU hardware stack is centered in the motherboard, and core/task card heights stay stable while runtime text changes above the progress bars.
- Cache usability visual pass: passed on May 16, 2026 via isolated Chrome CDP against `http://127.0.0.1:4173`; seeded and screenshotted idle, buffering, loading/waiting, ready, mixed four-core, and mobile mixed cache states. A follow-up `http://localhost:5176/` seed verified partial cache buffer rendering: a 50% cache buffer displayed `0.5 b Buffer` and colored only half of the 1-bit footprint instead of snapping to the full bit. The latest `http://localhost:5176/` Playwright smoke verified the cache module uses the new `Buffer` label, the old label is absent from the page, equal 1 Hz CPU/cache rates keep dashed Buffer and solid cache-write progress aligned, and the Buffer/Load/Ready number slots share the same rendered width. Completed Fetch Bit released cache to `0 b` with no held/resident segment. Overflow probe returned no overflowing nodes for core status, task status, cache state labels, or compact resource costs. CPU runtime labels stayed compact (`Read 1 b`, `Cache wait 1 b`, `Processing`) without increasing core card height.
- Resource token visual pass: passed on May 16, 2026; HUD totals, gain flyouts, task payouts, upgrade costs, research costs, and inspect payout summaries use the shared data/credits icon-number-color treatment.
- Electron launch smoke: not run interactively; Electron compile passed as part of `npm run build`.
- Save migration note: browser persistence now uses `save-v2`, intentionally giving the bit-scale pre-live schema a clean local save.

## Existing Verification Notes To Preserve

- Earlier implementation notes reported passing `npm test`, `npm run typecheck`, `npm run build`, desktop browser smoke, and mobile browser smoke on May 16, 2026.
- Earlier smoke notes reported operation-backed tasks, research, cache/memory/PSU/cooling status, core targeting, scheduler targeting, expandable provisioning, and responsive layout behavior.
- This DAG/staging pass reran `npm test`, `npm run typecheck`, and `npm run build`; browser smoke notes above remain previous evidence.

## Current Repository Check

Current files include the React/Vite app, pure `src/game` simulation, platform persistence adapter, Electron shell, feature tracker, QA notes, and reference PNGs.
