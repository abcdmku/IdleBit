# IdleBit QA Notes

## Vertical Slice Scope

Target scope from `game-spec.md` section 13.2:

- Single-core start with 10 credits, clock speed, cache, bit-scale tasks, current task state, data, and PSU/power readouts visible.
- Bit-scale startup keeps the first task choices tiny before byte-scale/cache-sensitive work appears.
- Task and research lists reveal progressively; the first screen exposes only the Fetch Bit / Decode Bit starter pair, with Decode Bit blocked until 2 b cache.
- On mobile, the Tasks and R&D tabs show a red new-content notification when visible tasks or open research have unlocked since that tab was last viewed.
- Active pinned tasks keep their route action available when the selected scheduler can queue another copy.
- Task and research compute rows keep operation counts, multi-core requirements above one core, cache/RAM needs, and resource payouts/costs visible even when blocked.
- Task cards stay visually stable while active and do not show live state labels in the task list.
- The task list header has compact route-layer and target dropdown controls: C chooses a specific core, CPU chooses a CPU-local scheduler, and Sys chooses the System Scheduler when unlocked; there is no Auto route.
- Cores render as a standalone scalable core array before RAM; after RAM unlock, a CPU package frame wraps the CPU-local scheduler, core array, and cache.
- Hardware cards sit directly in the hardware panel without an extra framed/background board wrapper.
- Core grids step through fixed 1x2, 2x2, 2x4, 2x6, 2x8, 2x12, 2x16, and later Nx16 layouts; at 2x12 and wider, cache pairs beside the CPU-local scheduler while cores take the full module width.
- Starting cache capacity, cache speed, and PSU wattage upgrades are visible from the first screen.
- Player-facing jobs/tasks are backed by low-level CPU operations.
- Task definitions infer cached internal recipe-step DAG nodes plus deterministic accept/stage/execute/complete dependencies for ready/waiting reasons.
- Clock upgrades affect CPU operation throughput.
- After CPU Operation Scheduler unlock, the Cores header can select all cores on that CPU for upgrade tuning only, retargeting the clock +/- control to a combined all-core buy/downgrade cost without creating an all-core task route.
- Cache upgrades affect cache operation queue capacity/load behavior.
- Reversible hardware specs expose one +/- control, refund half of the last purchase cost on downgrade, and dim unaffordable credit/data tokens instead of disabling the full spec row.
- Cache-required tasks wait for cache fill before required operations execute.
- Active and queued tasks can be canceled without granting rewards.
- Multi-core unlock is gated by early benchmark progression.
- RAM Control appears alongside System Scheduler after Local Scheduler research.
- Four-core milestone plus RAM Control and 1 Kb RAM unlock System Scheduler behavior.
- Completed System Scheduler research reveals a system-level scheduler surface for whole system tasks above RAM.
- System Queue Slot upgrades are separate from CPU Queue Slot upgrades.
- Second CPU purchase reveals CRON Scheduler research only; the CRON board module stays hidden until that research is bought, while baseline PSU/power readouts are already present.
- The empty CPU socket offers unmatched and matched CPU install choices, with projected power increase shown for each option.
- RAM stays hidden/actionless before RAM Control, then becomes the staging surface needed for System Scheduler; CRON stays hidden/actionless before CRON Scheduler research, and Thermal plus advanced PSU/tuning research are deferred.
- CRON Scheduler research unlocks CRON v1 timer automation for visible repeatable system tasks only.
- PSU/power readouts, powered-on billing, power state behavior, credits-only PSU wattage upgrades, and overload failure pressure are visible from the first screen; PSU Management research is deferred until it exposes a new decision.
- Thermal Control research, Thermal UI, Cooling Loop upgrades, and Thermal Probe are deferred.
- Five repeatable system tasks reveal on the specified gates: Memory Scrub, Queue Compaction, and Power Telemetry after Tiny Checksum; Bus Mirror and Shard Reconcile after the second CPU purchase.
- CRON v1 supports seconds/minutes modes, starts with a 60s minimum interval, uses increasingly expensive `cronInterval` upgrades to reduce the minimum by 1 second per upgrade, skips duplicate/blocked/full/off-state runs, never catches up missed runs, and adds a power spike when queuing work.
- Power states are `on`, `shuttingDown`, `off`, and `booting`; `off` greys hardware except power/start controls, blocks work and CRON, and bills zero while startup/shutdown use visible delays.
- Cache/RAM exhaustion becomes an active deadlock state only when active staging would write beyond available capacity once total installed capacity fits the task; cache deadlocks halt the affected CPU package, RAM deadlocks halt the whole system, deadlocked hardware plus scheduler slots render red, and the 10-second deadlock countdown appears as a progress bar in the Cores header before CPU packages exist, then in the CPU or RAM header after those surfaces unlock.
- The first visible deadlock shows a one-time Cache/RAM help caption with a Got it dismissal stored outside the save blob, followed by a one-time cooldown caption that pauses the game while visible.
- Scheduler Watchdog and Scheduling Policy research reveal auto-kill and dispatch-policy controls.
- Broad auto-repeat outside CRON v1 remains deferred.
- Networking, data centers, SLA contracts, availability zones, and regions remain out of scope for this slice.

## Unit Coverage Checklist

- Task timing:
  - `required_cpu_operations / effective_clock` is the baseline for executable CPU operations.
  - Clock upgrades reduce single-task operation time.
  - All-core clock tuning is hidden before CPU Operation Scheduler unlock, then sums selected CPU core costs/refunds and applies grouped buy/downgrade actions to those core clocks without acting as task provisioning.
  - Tasks decompose into low-level operations, with explicit read/write/overwrite memory actions and counted operation nodes available for large repeated work.
  - Task progress is a single whole-recipe meter and does not restart at each internal operation.
  - CPU core progress tracks CPU execution only, not cache/RAM loading.
  - Canceling active tasks removes active work and releases cache/RAM reservations without paying completion rewards.
  - Task composition is acyclic and produces stable ready/waiting reasons.
  - Cache-required operations wait for cache fill at the operation's own DAG step instead of only applying a flat penalty or one task-wide prefill.
  - Fetch Bit uses a 1 b cache footprint; Decode Bit uses a 2 b cache footprint; Bit Flip and Bit Shift reuse their 1 b overwrite footprints.
  - Read/write/overwrite operations require cache for the amount of data they touch, spend CPU cycles issuing cache writes, then wait idle if cache load has not caught up.
  - Task-level cache provisioning sums distinct read/write footprints while overwrite reuses the touched footprint.
  - Parallel cache-backed operations provision their per-core footprint across the required cores.
  - Cache residency preserves completed read/write footprints until task completion, while overwrite updates the existing footprint instead of adding another segment.
  - Cache capacity controls how much CPU operation queue can be loaded and ready.
  - Total cache fit still blocks impossible tasks; cache exhaustion during active writes creates CPU-local deadlocks instead of blocking starts, and all active work on that CPU stops while the deadlock is unresolved.
  - Deadlock pressure rises to a 10-second failure threshold while unresolved, cools down after recovery, does not block starts when cleared early, wipes active processes if it reaches the threshold, and blocks new starts only during that post-failure lockout until pressure drains back to 0.
  - Cache load speed controls how quickly cache-required operations become ready, with cache load cycles matching touched bits so the displayed rate reads as bits per second.
  - When CPU clock and cache load rate are equal for a memory operation with matching cycle/bit counts, committed cache moves directly into Ready without Buffer buildup.
  - Buffer is only the committed backlog created when CPU issue outruns cache write speed; total committed cache is Buffer plus Ready.
  - Byte Copy is modeled as counted byte-scale work: 8 read ops and 8 write ops with a 16 b total cache footprint, paying 32 operations after cache-load work is counted.
  - Counted memory-operation cache fill uses the total touched bits once, so an 8 b Byte Copy phase at 4.4 Hz advances in roughly two seconds instead of count-squared time.
- Progression gates:
  - Cache capacity and speed upgrades are available immediately and use data-weighted costs.
  - Reversible hardware upgrades can be downgraded for a 50% refund of the last level cost, while occupied scheduler/cache/RAM/core capacity blocks unsafe removal.
  - Broad auto-repeat does not unlock in the early slice; only CRON v1 can automate repeatable system tasks after CRON Scheduler research.
  - Multi-core research requires the micro/parallelism benchmark path.
  - RAM Control unlocks one 256 b RAM stick and a 1 Hz load rate.
  - RAM buys new base sticks, then upgrades selected-stick or all-stick capacity and frequency independently; mixed capacity and frequency are allowed, and data is the larger cost.
  - RAM readouts report module frequency from the installed sticks and do not sum stick speeds into a total RAM speed.
  - System Scheduler unlocks at the four-core milestone after RAM Control and at least 1 Kb RAM.
  - Second CPU unlock requires System Scheduler, multi-core benchmark completion, and System Bus research.
  - Second CPU purchase reveals CRON Scheduler research while baseline PSU/power readouts were already visible; locked CRON, advanced PSU/tuning, and Thermal modules stay hidden.
  - Unmatched CPU installs a base package, matched CPU copies the current package, and both socket choices list projected power increase.
  - Matched CPU purchase copies the source CPU's cores, core clocks, cache, cache speed, and scheduler slots, and charges for the base CPU plus copied upgrades.
  - CRON Scheduler research unlocks CRON v1 controls and no other task classes.
  - PSU Capacity upgrades are credits-only and available from the first screen; PSU Management research is deferred.
  - Thermal Control research, Thermal controls, and cooling loop upgrades are deferred.
- Parallelism:
  - Extra cores increase concurrent throughput.
  - Extra cores do not reduce one non-parallel task's duration before scheduler support.
  - Basic queue assigns ready operations/tasks to idle cores after queue slots are purchased.
  - CPU scheduler backlog capacity starts at 0; CPU Queue Slot upgrades add finite CPU queued-task capacity, full queues block additional CPU queue intake, and multicore tasks cannot provision more cores on a CPU than that CPU's scheduler slots support.
  - System tasks enter the visible System Scheduler as whole tasks through separate System Queue Slot capacity; CPU-local scheduler targeting only accepts CPU-bound tasks and reserves system task CPU work at dispatch time.
  - FIFO scheduler pulls can dispatch into cache/RAM deadlock; Deadlock-safe CPU schedulers use active footprint lookahead for CPU-local cache and system RAM, while Deadlock-safe System Scheduler intake checks RAM footprint only and leaves CPU cache pressure to the selected CPU scheduler. Shortest task and Smallest memory reorder eligible queue entries.
  - Scheduler Watchdog auto-kill applies only to scheduler-owned active deadlocks, shows the pending kill victim with its target core and a countdown, waits for 3 seconds of continuous deadlock, and obeys the configured kill policy.
  - System Scheduler watchdogs own RAM deadlocks only; CPU-cache deadlocks from system-scheduled CPU work surface on the affected CPU scheduler watchdog.
  - Deadlock Cooldown upgrades become available after Scheduler Watchdog and increase the post-deadlock pressure drain rate.
  - Scheduler-dispatched tasks stay in the scheduler queue and keep their queue slot occupied until completion.
  - Scheduler queue slots render as a compact header count plus a bounded adaptive-height slot grid without a separate status strip or queue title; the System Scheduler starts at one-slot and two-slot footprints before 2x2, larger grids step through 2x2, 4x2, 4x4, 6x4, 6x6, and 8x8 layouts, early low-row grids stay shorter so slots do not become giant, queued scheduler tasks list their current waiting or active reason in taller slot cells, core/provisioning blockers take priority over free cache/RAM pressure when both apply, at least 24 slots fit before internal scrolling, and processing updates do not resize neighboring hardware.
  - Canceling pending queued work removes only the unreserved queue entry and leaves already active scheduler reservations intact.
- CRON automation:
  - CRON remains hidden until CRON Scheduler research, then appears at the top of the system board.
  - CRON can target only visible repeatable system tasks: Memory Scrub, Queue Compaction, Power Telemetry, Bus Mirror, and Shard Reconcile as each task reveals.
  - CRON cannot target hidden tasks, research compute, normal CPU-bound tasks, or later locked task groups.
  - CRON supports seconds and minutes interval modes.
  - CRON rows show a whole-second countdown until the next scheduled job.
  - A new CRON entry defaults to the current minimum interval, starting at 60 seconds.
  - Each `cronInterval` upgrade lowers the minimum interval by 1 second, gets more expensive, and never below the intended implementation floor.
  - If a CRON tick finds the same task active or queued, the task blocked, the target queue full, or the system `off`, `booting`, or `shuttingDown`, the run is skipped without adding work.
  - Time spent offline, blocked, or overfull does not catch up; only future due ticks can enqueue work.
  - CRON queue insertion adds the documented short power spike and uses the same queue capacity rules as manual scheduling.
- Staging and reliability:
  - RAM extends the memory staging hierarchy after cache and stages larger active/intermediate work after RAM Control.
  - RAM appears above the CPU package, shows one selectable module-card strip with fixed small-grid sizing such as 2x2 for four sticks, and System Scheduler appears above RAM after research.
  - RAM load progress is visible as reserved/loading/ready staging, and CPU processing waits until the RAM-backed work is loaded.
  - Total RAM fit still blocks impossible tasks; RAM exhaustion during active writes creates system-wide deadlocks instead of blocking starts, and all active system work stops while the deadlock is unresolved.
  - RAM loading does not prevent unrelated manual or queued CPU-level work from starting when enough idle cores and cache remain.
  - Cache/RAM/storage load speeds are modeled as upgrade paths.
  - Tasks do not require power directly, but powered-on hardware bills immediately even when idle.
  - PSU/power readouts are visible from the first screen and show current state, scaled draw, billing pressure, load, capacity, and remaining credits.
  - Billing draw is scaled to mW/uW, tied primarily to CPU frequency, and can still reflect active hardware draw and CRON queue-start spikes.
  - Idle powered-on time drains positive credits, billing clamps credits at 0, and unpaid billing auto-shuts down the system with a first-time explanation plus quick repeat popup.
  - Powering on at 0 credits grants a short bootstrap no-bill grace window; earning credits exits grace, while grace expiration at 0 credits shuts the system down again.
  - Active starter work remains profitable after immediate powered-on billing.
  - Power states are `on`, `shuttingDown`, `off`, and `booting`.
  - `off` systems grey hardware except power/start controls, block manual work, scheduler dispatch, and CRON, and bill zero.
  - Startup and shutdown delays make state changes visible on the PSU before the system layer unlocks, then on the System Scheduler card; graceful shutdown blocks new work while active work drains.
  - Dense cores/CPUs increase draw nonlinearly.
  - RAM/CPU efficiency matching rewards matched RAM module sizes/frequencies and CPU package specs; mismatches raise effective draw and reliability pressure.
  - Severe PSU stress can throttle; draw above capacity flashes the full PSU red, fills a larger centered header overload meter in about 10 seconds at the threshold and faster at higher overload, then hard-powers off, shows a short first-time failure popup, uses a red topbar badge for later trips, and clears active/queued work.
  - Cooling improves efficiency and reliability when implemented later, but active cooling is deferred for this slice.
- Visibility rules:
  - RAM is hidden before RAM Control.
  - Basic PSU/power readouts and credits-only PSU wattage upgrades are visible from the first screen.
  - CRON is hidden before CRON Scheduler research; Thermal and advanced PSU/tuning research are deferred.
  - RAM becomes visible/actionable immediately after RAM Control.
  - CRON Scheduler research appears after the second CPU purchase, while baseline PSU/power readouts remain visible earlier.
  - CRON becomes actionable after CRON Scheduler research.
  - Advanced PSU tuning and Thermal controls are deferred.
  - Research options are hidden until the player has earned starter resources.
  - Later tasks are hidden until their concept gate is met.
  - Out-of-scope systems are not exposed early.
- Economy:
  - Completed jobs pay credits equal to derived operation count, including CPU cycles plus cache/RAM load work, and data exactly once.
  - Upgrade purchases debit the correct currency and cannot underflow balances.
  - Unlock currency and spendable currency remain distinct.

## CRON And Power Acceptance Checklist

- First screen shows PSU/power readouts alongside the starter CPU/cache economy.
- PSU Capacity upgrades are buyable with credits from the first screen.
- Billing starts immediately while the system is powered on, including idle time, with draw scaled to mW/uW and tied primarily to CPU frequency.
- Idle powered-on time drains positive credits, billing clamps credits at 0, and unpaid billing auto-shuts down the system with a first-time explanation plus quick repeat popup.
- Powering on at 0 credits grants a short bootstrap no-bill grace window; earning credits exits grace, while letting grace expire at 0 credits shuts the system down again.
- Active starter work remains profitable after immediate powered-on billing.
- Second CPU purchase reveals CRON Scheduler research; baseline PSU/power readouts were already visible.
- CRON Scheduler appears as the only second-CPU support research gate in this slice.
- Memory Scrub, Queue Compaction, and Power Telemetry reveal after Tiny Checksum.
- Bus Mirror and Shard Reconcile reveal with the second CPU purchase; Thermal Probe is deferred.
- CRON can schedule only visible repeatable system tasks and never research benchmarks or hidden/locked tasks.
- CRON entries support seconds and minutes modes, default to a 60s minimum, and respect `cronInterval` minimum-interval reductions of 1 second per upgrade.
- CRON skips rather than queues when the same task is active/queued, requirements are blocked, the target queue is full, or the system is `off`, `booting`, or `shuttingDown`.
- CRON does not catch up missed runs after blocked time, full queues, sleep, reload, shutdown, or offline simulation gaps.
- CRON-created queue entries apply the short power spike and are visible in PSU draw/stress.
- Power bills over time from scaled draw with no free threshold except the 0-credit bootstrap grace window.
- `off` systems allow configuration but block work, scheduler dispatch, CRON, and billing.
- Startup and shutdown delays are visible on the PSU before the system layer unlocks and on the System Scheduler card afterward, block work/CRON during transition, and end in the expected `on` or `off` state.
- PSU Management research is deferred rather than exposing no-op advanced controls.
- RAM/CPU efficiency matching affects draw/stress so mismatched modules and CPU packages are meaningfully worse than matched builds.
- The CPU socket presents unmatched and matched purchase options and lists each option's projected power increase.
- Active cooling tradeoffs are deferred with Thermal Control.

## Web Smoke Checklist

- App boots to the first actionable CPU screen without console errors.
- Starting state matches the spec: 1 core, 1 Hz clock, 1 b cache, 1 Hz cache load rate, hidden 1 Hz RAM load rate with 0 b RAM capacity, Fetch Bit and Decode Bit visible, PSU/power readouts visible, and no visible RAM.
- First screen does not show byte-scale tasks, RAM actions, advanced PSU/tuning actions, cooling actions, or the full research tree.
- Player can start and complete Fetch Bit, then reveal Decode Logic; Decode Bit remains visible but waits for the first 2 b cache upgrade.
- Credits/data increase after completion.
- Positive credits/data gains show +amount flyouts that travel into the matching HUD total.
- Clock upgrade can be purchased and visibly shortens subsequent job duration.
- After CPU Operation Scheduler unlock, selecting All in the Cores header changes the clock stepper to an all-core clock control with a combined price/refund; the task route picker still offers only C/CPU/Sys routing and never treats all-core tuning as task provisioning.
- Cache upgrade can be purchased and visibly affects cache queue/fill behavior for cache-sensitive tasks.
- Cache-required tasks show a wait/fill state before their required operations run.
- Cache meter states are visually distinct as fixed-height Buffer and Ready lanes; Buffer appears only when CPU issue outruns cache write speed, Ready includes loaded/resident cache, and completed tasks release cache immediately without held/resident bits.
- Cache module stat readout shows committed cache as `used / total`.
- CPU core meters remain idle during cache fill; task cards continue showing aggregate task progress through load and compute phases.
- Task wait reasons match the inferred composition DAG.
- Blocked task and research action buttons show the current blocker, while the row still shows needed operations/resources and payout; active task cards keep the same list color treatment.
- CRON controls do not appear before CRON Scheduler research.
- Queue/scheduler controls appear only after their unlock gates.
- Multi-core flow allows multiple jobs to run concurrently after core unlock.
- Hardware layout keeps the core grid independent of the CPU package before RAM, uses fixed compact/dense core-grid breakpoints for high-core CPU counts, and moves cache beside the CPU-local scheduler once the core grid reaches 2x12.
- CPU Operation Scheduler/basic queue flow pulls ready operations/tasks onto idle cores after the player buys CPU-local scheduler queue slots.
- Duplicate scheduled copies of the same task show per-row status; one copy can show active work while another shows a resource blocker.
- RAM Control reveals a 256 b/1 Hz RAM stick above the CPU package and enables larger RAM/cache tasks before System Scheduler.
- System Scheduler remains blocked until RAM reaches at least 1 Kb.
- System Scheduler appears above RAM after research, exposes separate System Queue Slot purchases, and selected system tasks dispatch through it instead of the CPU-local scheduler.
- Second CPU flow reveals CRON Scheduler research without revealing locked automation, advanced PSU/tuning, or Thermal modules.
- Memory Scrub, Queue Compaction, and Power Telemetry appear after Tiny Checksum, and Bus Mirror plus Shard Reconcile appear after the second CPU purchase.
- CRON Scheduler research unlocks CRON controls, seconds/minutes interval modes, and visible-task-only scheduling.
- CRON skips duplicate active/queued tasks, blocked tasks, full target queues, and `off`/`booting`/`shuttingDown` system states without catch-up.
- CRON queue insertion creates a short visible power spike.
- PSU state, draw, billing, shutdown/startup behavior, basic power readouts, credits-only PSU Capacity upgrades, and overload failure pressure are available from the first screen; PSU Management research is deferred.
- RAM readouts communicate active/intermediate staging.
- PSU readouts communicate draw, billing, capacity, state, load, and overload failure pressure without making power a per-task requirement.
- Leaving the powered-on system idle with positive credits drains credits over time, clamps credits at 0, and then auto-shuts down for unpaid billing with a first-time explanation plus quick repeat popup.
- Powering on at 0 credits enters the short no-bill bootstrap grace window; completing starter work exits grace and remains net-profitable, while grace expiration at 0 credits shuts down again.
- Power-off blocks manual work, scheduler dispatch, and CRON, greys hardware except power/start controls, and bills zero.
- Deadlocked cache/RAM surfaces render red, affected hardware greys out only during post-failure lockout reset, the deadlock countdown appears as a wider fill/drain progress bar with a high-contrast time label in the affected Cores/CPU/RAM header rather than inside individual core cards, stays anchored there until pressure reaches 0, and the first deadlock plus cooldown help captions appear over the affected Cache or RAM section without a modal or layout shift while scrolling fully into view.
- Thermal Control research, Thermal controls, and cooling loop upgrades are deferred.

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
- Verify broad auto-repeat remains `Deferred`, while CRON v1 rows are `Tested` only with matching automation coverage.
- Add check evidence: unit command, web smoke command, Electron smoke command, and responsive viewport pass date.

Current `FEATURES.md` observations:

- `FEATURES.md` exists and names `game-spec.md` as the source of truth.
- Vertical slice simulation and responsive UI features that match the current operation-task build are marked `Tested` when existing notes cite automated or smoke evidence.
- Bit-scale startup, progressive task/research reveal, inferred task composition DAG, and deferred Thermal gate evidence remain tracked from automated verification and browser smoke.
- Operation composition, cache queue/fill behavior, paid cache/RAM load operation totals, per-core derived task resource needs, finite CPU-local scheduler queue slots, separate System Scheduler queue slots, system-vs-CPU scheduler task routing, adaptive scheduler slot grids, duplicate scheduled-copy status display, compact task route controls, CPU package reveal, fixed-step core grid layouts and 2x12 cache/scheduler pairing, active scheduler queue reservations until completion, System Scheduler routing into available CPU scheduler slots while CPU cores are busy or CPU-local cache policy is blocking execution, lower-level CPU scheduler wait reasons bubbling up to System Scheduler slots, scheduler waiting/active reasons and core-first pickup blocker priority, scheduler width gating for multicore tasks, CPU-local cache/scheduler gates, RAM Control and 1 Kb System Scheduler gates, System Scheduler above RAM, RAM above CPU, unmatched CPU base package installs, matched CPU package costing/spec copies, socket power-delta readouts, data-weighted cache/RAM upgrade costs, reversible upgrade refunds and occupied-capacity downgrade blockers, cache/RAM deadlocks with CPU-local or system-wide halt behavior, 10-second deadlock failure and cooldown lockout behavior, high-contrast deadlock countdown header placement with persistent fill/drain progress bars, post-failure greyed lockout hardware, split deadlock-safe footprint dispatch for CPU-local cache vs System Scheduler RAM, watchdog auto-kill core/countdown display, scheduler policy controls, visible RAM load progress before CPU execution, queue acceptance under active pressure, previous PSU stress, dense hardware draw, mixed-size/mixed-frequency RAM sticks with per-stick and all-stick upgrades, and non-summed RAM module frequency readouts are covered by automated or smoke verification.
- New CRON, hidden pre-research automation, deferred PSU Management/Thermal, first-screen PSU Capacity, paid-over-time power billing, power state, PSU overload failure, and RAM/CPU efficiency matching rows are tracked with automated coverage.
- The first-screen PSU/readout, immediate billing, 0-credit bootstrap grace, unpaid auto-shutdown, first-time/repeat out-of-credits popups that mention restart grace, early PSU Capacity, graceful shutdown drain, hard PSU failure, full-card PSU over-power flashing, header overload progress, first-time overload-failure popup, and repeat-failure topbar badge expectations above have automated verification; browser smoke evidence should still be refreshed after UI changes.
- Browser persistence and Electron shell are marked `Built`.
- Broad auto-repeat is marked `Deferred`; CRON v1 is tracked separately as the scoped early timer.
- Later-stage systems are marked `Deferred`, which matches the first vertical slice scope.
- Status granularity is intentional: CRON Scheduler, deferred PSU Management/Thermal, power states/billing, PSU reliability stress, and PSU overload failure are separate rows with targeted test evidence.
- Stage wording is intentional: `Stage 4: full system building` is `Deferred`, while RAM Control, second-CPU package choices, and power reveal are tracked in the vertical slice.
- Research cards now list requirement rows, own benchmark compute actions, keep compute requirements/payouts visible, and put blocker copy directly in disabled action buttons; benchmark tasks are intentionally hidden from the normal task catalog after this pass.

## Checks Run

- Task core requirement display on May 19, 2026: `npm test -- src/ui/HardwareBoard.test.tsx`, `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed. Coverage now checks that multi-core task cards and research compute rows list the required core count while single-core task cards do not.
- PSU socket/power UI pass on May 19, 2026: `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed. Coverage now includes unmatched and matched CPU socket choices with projected power increase, credits-only PSU Capacity in first-screen upgrades, buying PSU wattage without PSU Management, 10-second overload-failure pressure just above 100% load, faster failure pressure at higher overload, cooldown when draw returns under capacity, no PSU headroom/efficiency row, compact header Boot/Kill controls, compact load-meter placement, larger centered PSU overload header progress, full-card red PSU over-power flashing, a short first-time PSU failure popup after overload cutoff, repeat-failure topbar badge, first-time/repeat out-of-credits popups, boot/shutdown transition handoff from PSU to System Scheduler, and overload-failure UI.
- Alert visibility on May 19, 2026: `npm test -- src/ui/HardwareBoard.test.tsx`, `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check` passed. Coverage verifies the PSU/deadlock alert caption calls `scrollIntoView` with centered block alignment, and mobile hardware routing scrolls alert captions after switching back to Hardware.
- Hardware card layout on May 19, 2026: `npm test -- src/ui/HardwareBoard.test.tsx`, `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check` passed. Coverage verifies the old `.system-board-frame` wrapper is not rendered, leaving hardware modules as standalone cards.
- Mobile unlock tab notifications on May 19, 2026: `npm test -- src/ui/HardwareBoard.test.tsx`, `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed. Coverage verifies red mobile Tasks/R&D tab notifications for unseen unlocked task/research IDs and clears/persists each notification when the tab is opened.
- Pinned task queue action on May 19, 2026: `npm test -- src/ui/HardwareBoard.test.tsx`, `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check` passed. Coverage verifies an active pinned task keeps its scheduler-route action button and dispatches `queueTask` for another copy.
- Browser smoke on May 19, 2026: `http://127.0.0.1:6173/` loaded without console errors other than the React DevTools info message. Desktop and 390x844 mobile snapshots verified the compact PSU section with no headroom/efficiency row, power controls in the header, load adjacent to the meter, and a first-screen PSU Capacity upgrade row.
- Task resource reconciliation on May 18, 2026: `npm test`, `npm run typecheck`, and `npm run build` passed. Coverage now checks every task definition against per-core operation residency for operation count, cache need, and RAM need; Shard Reconcile is blocked at 1 Kb RAM because its four parallel shard pages peak at 4 Kb, and Bus Mirror reports its 1 Kb two-core RAM footprint.
- Crash/restart hardening on May 18, 2026: `npm test`, `npm run typecheck`, and `npm run build` passed. Coverage now includes a stale pre-live save with removed task IDs in completed counts, active tasks, queue, CRON, benchmarks, and autorepeat loading into a renderable/tickable state. Vite, Electron, and `wait-on` now share fixed dev renderer port `6173` with strict-port startup so the desktop shell cannot silently load another project or a stale renderer.
- CRON/power implementation update on May 18, 2026: `npm test`, `npm run typecheck`, and `npm run build` passed for the implemented CRON, PSU, Thermal, power-state, efficiency, and popup slice.
- `npm test`: passed with 234 tests across 6 files on May 18, 2026, including the new CRON/power simulation and HardwareBoard/App UI coverage.
- `npm test`: passed with 97 tests on May 18, 2026: 66 game simulation tests plus 31 UI tests covering armed-only credits/data gain flyouts, cleanup, Buffer/Ready cache layers, CPU-faster-than-cache Buffer rendering, Byte Copy split read/write committed cache segments, core-style cache capacity/speed controls, single +/- reversible upgrade controls, unlit unaffordable cost tokens, RAM loading segment progress in cache-style lanes, RAM above CPU ordering, System Scheduler above RAM ordering, standalone pre-RAM core/cache/scheduler labels, CPU package reveal after RAM, CPU deadlock countdown placement in the Cores header before CPU packages and CPU header after RAM unlock, deadlock countdown fill and lockout reset drain progress bars, resolved-deadlock cooldown bars that stay visible until pressure reaches 0 without greying hardware, post-failure lockout bars that grey affected hardware, cooldown help caption routing/copy, fixed 1x2 through Nx16 core-grid layouts, cache/scheduler pairing at the 2x12 core layout, adaptive scheduler slot grids without status/title rows, deadlocked hardware coloring and first-deadlock help caption, scheduler policy/auto-kill controls, scheduler watchdog victim/core/countdown display, duplicate scheduled-copy status display and cancel routing, scheduler queued-task waiting reasons and cancel controls, lower-level CPU scheduler waiting reasons bubbled into System Scheduler slots, visible System Scheduler routing for system tasks, compact task route controls, CPU scheduler blocking for whole system tasks, active/queued task cancellation, always-visible task/research requirement and payout summaries, disabled action-button blocker copy, stable active task-card list styling without live state labels, equal-rate cache Ready behavior, research-card benchmark compute, and research-only scheduler unlock gates. Simulation coverage includes 1 Hz/1 b initial state, zero default CPU and System Scheduler queue slots, purchased CPU Queue Slot capacity, separate System Queue Slot capacity, system scheduler intake for whole system tasks, dispatch-time CPU scheduler reservation for system task CPU work even when CPU cores are busy or CPU-local cache policy is blocking execution, active scheduler queue reservations until completion, scheduler width blocking for multicore provisioning, full-queue intake blocking, CPU-local cache/scheduler routing, System Scheduler RAM-only deadlock-safe gating with CPU scheduler-owned cache gating, System Scheduler watchdog ignoring CPU-cache deadlocks owned by CPU scheduler watchdogs, no cross-CPU core splitting for multicore tasks, RAM Control reveal, 256 b/1 Hz RAM stick start, mixed-size/mixed-frequency RAM stick capacity and frequency upgrades, data-weighted cache/RAM upgrade costs, hardware downgrade half-refunds, occupied scheduler downgrade blocking, paid cache/RAM load operation totals, 1 Kb System Scheduler gate, legacy System Scheduler research id migration, matched CPU package copies/costing, cache/RAM load starts, cache/RAM deadlocks with CPU-local or system-wide halt behavior and manual recovery, remembered deadlock pressure scope until cooldown reaches 0, 10-second deadlock failure, post-failure lockout cooldown, Deadlock Cooldown upgrade drain rate, FIFO and split deadlock-safe scheduler footprint behavior, watchdog auto-kill policies plus visible countdown preview, shortest-task and smallest-memory policies, visible RAM loading before CPU execution, starter cache footprints, counted task work, Byte Copy counted cache-fill timing plus partial read/write committed residency, overwrite residency reuse, parallel per-core cache provisioning, cache-backed operation actions, CPU-issued memory cache writes, CPU/cache equal-rate Ready commits, no early cache deadlock while cache writes outrun CPU issue, CPU-idle cache waits, active-only cache reservation, completed-task cache release, active task cancel reward blocking, queued task cancel reservation preservation, legacy cache residency save cleanup, starting cache capacity/speed upgrades, grouped progressive reveal, cached internal recipe DAG data, per-operation cache staging, DAG-derived op-count task credit rewards, whole-task progress vs CPU-only execution progress, cache/RAM total fit gates, RAM reveal/upgrades, scheduler queue intake, multicore completion without reruns, PSU throttling without restarts, cooling improvement, and job action aliases.
- RAM frequency verification passed on May 18, 2026 with `npm test` and `npm run typecheck`; coverage includes adding RAM sticks without increasing a summed total speed, all-stick frequency upgrades using the per-module rate, and the RAM summary hiding legacy aggregate speed values.
- `npm run typecheck`: passed for app and Electron TypeScript on May 18, 2026.
- `npm run build`: passed for Vite production output and Electron compile on May 18, 2026.
- `http://localhost:5176/` Playwright smoke on May 17, 2026: app loaded as IdleBit at 1365x900, first screen showed grouped CPU Bound Fetch Bit/Decode Bit work with generic CPU/cache labels, and RAM/PSU/System Scheduler text was absent from the opening view. The PSU absence in this older smoke is superseded by the first-screen power readout and PSU Capacity expectation above.
- Desktop browser smoke: passed at `http://127.0.0.1:4173` via local Playwright fallback; first screen is bit-scale with Fetch Bit and Decode Bit visible, research initially hidden/empty, RAM/PSU/cooling status entries absent, centered `CPU` header, `Cache` title, and row-aligned core/cache upgrade buttons. The PSU absence in this older smoke is superseded by the first-screen power readout and PSU Capacity expectation above.
- Mobile browser smoke: passed at 390x844 viewport via local Chrome CDP fallback; the task DAG modal opens from Fetch Bit and remains usable without horizontal layout overflow.
- Interaction smoke: automated coverage verifies Fetch Bit as the first runnable task, Decode Bit as a visible 2 b cache-gated starter goal, and Decode Logic as the first research reveal.
- Progressive reveal smoke: previous pass verified RAM hidden/actionless before RAM Control and later systems hidden before second-CPU system building; the current power plan supersedes the older PSU-hidden expectation with baseline PSU/power readouts plus PSU Capacity visible from the first screen and advanced PSU/tuning deferred.
- Research/task comment pass: automated coverage verifies Bit Flip and Bit Shift unlock together from Decode Logic, Byte Copy unlocks from Byte Operations, Packet Check remains gated by Cache Mapping, benchmark compute runs from research cards, completed benchmarks do not linger in the task list, and scheduler unlocks require research instead of direct upgrade shortcuts.
- Hardware inline control pass: passed; the CPU header is centered and no longer shows an active-count suffix, the core and cache modules share header/status, aligned stat rows, compact upgrade steppers with icon-number credit/data costs, and meter styling, the cache header reads `Cache`, cache capacity and speed upgrades are visible from the first screen, cache speed is visible, cache shows committed/total bits in the stat row, cache-fill shows active core-colored committed segments inside fixed Buffer/Ready lanes, Buffer appears only when CPU issue outruns cache write speed, completed tasks release cache immediately without held or resident cache styling, the single-CPU hardware stack is centered in the motherboard, and core/task card heights stay stable while runtime text changes above the progress bars.
- Cache usability visual pass: passed on May 16, 2026 via isolated Chrome CDP against `http://127.0.0.1:4173`; seeded and screenshotted idle, buffering, loading/waiting, ready, mixed four-core, and mobile mixed cache states. A follow-up `http://localhost:5176/` seed verified partial cache buffer rendering: a 50% cache buffer displayed `0.5 b Buffer` and colored only half of the 1-bit footprint instead of snapping to the full bit. The May 17 automated UI pass verifies the cache module now uses `Buffer` and `Ready` lanes only, equal 1 Hz CPU/cache rates move committed bits directly into Ready, and faster CPU issue creates Buffer equal to the backlog over cache write speed. Completed Fetch Bit released cache to `0 b` with no held/resident segment. Overflow probe returned no overflowing nodes for core status, task status, cache state labels, or compact resource costs. CPU runtime labels stayed compact (`Read 1 b`, `Cache wait 1 b`, `Processing`) without increasing core card height.
- Resource token visual pass: passed on May 16, 2026; HUD totals, gain flyouts, task payouts, upgrade costs, research costs, and inspect payout summaries use the shared data/credits icon-number-color treatment.
- Electron launch smoke: not run interactively; Electron compile passed as part of `npm run build`.
- Save migration note: browser persistence now uses `save-v2`, intentionally giving the bit-scale pre-live schema a clean local save.

## Existing Verification Notes To Preserve

- Earlier implementation notes reported passing `npm test`, `npm run typecheck`, `npm run build`, desktop browser smoke, and mobile browser smoke on May 16, 2026.
- Earlier smoke notes reported operation-backed tasks, research, cache/memory/PSU/cooling status, core targeting, scheduler targeting, expandable provisioning, and responsive layout behavior.
- This DAG/staging pass reran `npm test`, `npm run typecheck`, and `npm run build`; browser smoke notes above remain previous evidence.

## Current Repository Check

Current files include the React/Vite app, pure `src/game` simulation, platform persistence adapter, Electron shell, feature tracker, QA notes, and reference PNGs.
