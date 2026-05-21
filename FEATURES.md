# IdleBit Feature Tracker

`game-spec.md` is the design source of truth. This tracker records what exists in the build and the active pre-live implementation target. Because IdleBit is pre-live, previously built mechanics can move back to `Deferred` when the target changes.

## Status Key

| Status | Meaning |
|---|---|
| Not Started | Planned but untouched |
| In Progress | Being implemented now |
| Built | Implemented and wired into the playable game |
| Tested | Built and covered by automated or smoke verification |
| Deferred | Tracked for a later build |

## Vertical Slice

| Feature | Status | Acceptance |
|---|---|---|
| Primitive CPU start | Tested | New save starts with 10 credits, one core, 1 Hz clock, 1 b cache, 1 Hz cache load rate, 0 b RAM, hidden 1 Hz RAM load rate, data, visible PSU power readouts, runnable Fetch Bit, and 2 b-gated Decode Bit visible |
| Bit-scale startup | Tested | Opening tasks stay as a tiny bit-scale pair before byte/cache/research concepts are introduced, with Decode using a 2 b cache footprint and overwrite bit tasks reusing 1 b footprints |
| Manual tasks | Tested | Player can start an available task/job and receive credits/data on completion |
| Task cancellation | Tested | Active tasks and queued scheduler entries can be canceled, releasing reserved work without paying rewards or removing active scheduler reservations for other queued copies |
| Resource gain flyouts | Tested | Positive credits/data gains show transient +amount labels that fly into the matching HUD total |
| Resource amount tokens | Tested | Credits/data use one icon-number-color treatment in the HUD, flyouts, task payouts, upgrade/research costs, and inspect summaries |
| Storybook component documentation | Tested | Storybook is configured for reusable UI components, with stories for resource cost states, HUD zero/high/gain states, PSU/credit failure notices, motherboard layout board/rack states, SystemRackPanel rack states, and TaskBay route/pinned-task states using static review fixtures |
| React UI module boundaries | Tested | App persistence, notice preferences, resource UI, failure notices, rack/builder UI, rack visual bays, task route/card UI, task/research panels, CPU/cache/scheduler, RAM, PSU, and shared hardware meters live in focused modules instead of one mixed hardware board file |
| CSS architecture | Tested | CSS uses ordered domain manifests and focused partials for foundation, layout, hardware, scheduler, tasks, overlays, responsive, rack, and late surface rules without adding a utility framework dependency |
| Clock upgrades | Tested | Upgrade increases CPU operation throughput, cost scales, and CPU Operation Scheduler unlock reveals upgrade-only all-core clock tuning with one combined price/refund |
| Cache upgrades | Tested | Capacity and speed upgrades are available from the start, cost more data than credits, and improve cache queue/fill behavior |
| Task operation composition | Tested | Player-facing tasks decompose into read/write/overwrite memory operations and compute operations, including paid operation totals and peak cache/RAM needs derived from per-core CPU, cache, and RAM load work |
| Runtime progress meters | Tested | Task cards show one whole-task progress value across recipe/load/compute work, RAM shows reserved/loading/ready staging progress, and CPU core meters show current CPU execution, including memory-operation cache issue cycles |
| Inferred task composition DAG | Tested | Task definitions infer cached recipe-step DAG nodes, per-step staging, and accept/execute/complete dependencies for ready/waiting reasons |
| CPU cache operation queue | Tested | Cache stores CPU operation queues instead of acting only as a percent modifier; total cache fit gates impossible tasks while active cache writes that exceed capacity create CPU-package deadlocks that halt all active work on that CPU |
| Cache-fill wait gate | Tested | Cache-required operations wait for cache fill at the graph step where that operation executes |
| Progressive task reveal | Tested | Tasks appear in small concept groups and the task panel groups visible work by CPU-bound, system, distributed, and other task categories instead of a single previous-task chain |
| Progressive research reveal | Tested | Research appears only after data/research has player-facing meaning |
| Research requirements clarity | Tested | Research cards list unmet research, task, hardware, and compute requirements before purchase |
| Task/research summary chips | Tested | Task cards and research compute rows keep operation counts, multi-core requirements above one core, cache/RAM needs, and resource payouts/costs visible, while blocked action buttons show the current blocker; task cards do not list live state or recolor while active |
| Task route picker | Tested | The task panel header uses a compact layer selector plus target dropdown: C chooses a core, CPU chooses a CPU scheduler, and Sys chooses the System Scheduler without an Auto route |
| CRON v1 timer automation | Tested | CRON Scheduler research reveals a paid CRON Job Slot install; installed slots enable timer repeats for visible repeatable system tasks only with a default minimum 60s, seconds/minutes modes, whole-second next-job countdown, increasingly expensive `cronInterval` upgrades lower the minimum by 1 second each, and skipped runs do not catch up |
| Broad auto-repeat | Deferred | General task auto-repeat remains out of scope beyond the scoped CRON v1 system-task loop |
| Research compute benchmarks | Tested | Micro, parallelism, and multi-core benchmarks run from their owning research cards and stay out of the normal task list |
| Micro Benchmark | Tested | Benchmark compute gates progression from early CPU tuning |
| Multi-core unlock | Tested | Parallelism benchmark completion enables Multi-Core Control research, which unlocks buying more cores |
| Additional cores | Tested | Cores increase parallel throughput, not single-job speed |
| Basic queue | Tested | Early queue behavior feeds operations/tasks to idle cores after queue slots are purchased; FIFO dispatch can deadlock after active cache/RAM staging exhausts capacity |
| CPU scheduler queue slots | Tested | CPU scheduler backlog capacity starts at zero in the hand-built CPU phase; catalog machines derive CPU-local scheduler slots from each CPU package's core count, and scheduler-dispatched CPU work keeps those slots occupied until completion |
| Four-core milestone | Tested | Four cores satisfy one System Scheduler requirement before the RAM gate |
| RAM Control gate | Tested | RAM Control appears with System Scheduler after Local Scheduler, reveals a paid RAM bay, and buying the first RAM Stick installs a 256 b module at 1 Hz for larger RAM/cache tasks |
| System Scheduler unlock | Tested | Local and System Scheduler unlocks are research purchases; System Scheduler requires RAM Control plus at least 1 Kb RAM and appears as a paid install outline until the first System Queue Slot is bought |
| System Scheduler queue slots | Tested | System Queue Slot upgrades are bought on the System Scheduler surface, admit whole system tasks separately from CPU Queue Slots, and stay occupied until that system task completes or is canceled |
| Deadlock runtime | Tested | Cache/RAM exhaustion during active staging creates deadlocked work, paints affected hardware/scheduler surfaces red, greys affected hardware only during post-failure lockout reset, halts the affected CPU or whole system, shows a wide high-contrast Cores/CPU/RAM header progress bar that fills toward failure and stays visible while draining back to 0, resumes when capacity is freed, and wipes active processes only if unresolved for 10 seconds |
| Second CPU unlock | Tested | Multi-core benchmark compute enables System Bus research; the CPU card offers unmatched and matched CPU installs once the package frame is visible, each listing its projected power increase, and purchasing either reveals CRON Scheduler research while PSU stays visible from the start |
| CPU package choices | Tested | Unmatched CPU purchase installs a base one-core package, while matched CPU purchase copies another owned CPU package's core count, core clocks, cache, cache speed, and scheduler slots; matched cost includes the base CPU plus copied upgrades |
| RAM reveal | Tested | RAM appears after RAM Control research, not after second CPU purchase |
| CRON module reveal | Tested | Second CPU purchase reveals CRON Scheduler research only; the CRON system module stays hidden until that research is bought, then appears as a paid CRON Job Slot install outline |
| CRON Scheduler research | Tested | Unlocks the paid CRON Job Slot install that enables CRON controls for visible repeatable system tasks only |
| PSU Management research | Deferred | Deferred until it exposes a new player-facing power decision; credits-only PSU capacity upgrades remain available from the start |
| Thermal Control research | Deferred | Thermal UI, cooling controls, and thermal research are deferred for a later system-management pass |
| Repeatable system tasks | Tested | Memory Scrub, Queue Compaction, and Power Telemetry reveal after Tiny Checksum; Bus Mirror and Shard Reconcile reveal after second CPU; Thermal Probe is deferred |
| Power reveal | Tested | PSU is visible from the first screen; Thermal remains hidden for now |
| PSU startup balance | Tested | Powered-on systems bill from startup-scale mW/uW draw, idle time drains positive credits, and active starter work remains profitable |
| RAM staging model | Tested | RAM extends the memory staging hierarchy after cache, shows task loading into RAM before CPU execution, and peak per-core RAM fit gates impossible tasks while active RAM writes that exceed capacity create system-wide deadlocks that halt all active work |
| RAM upgrades | Tested | RAM buys new base sticks, then upgrades stick capacity and frequency per selected stick or all sticks; mixed capacities and frequencies are allowed, new sticks add capacity rather than summed total speed, costs lean data-heavy, capacity starts at 256 b, and frequency starts at 1 Hz |
| Power states and billing | Tested | Power states are `on`, `shuttingDown`, `off`, and `booting`; booting/shutting-down status appears on the PSU before the system card unlocks and on the System Scheduler card afterward; off greys hardware except power/start controls, blocks work/CRON, and bills zero; graceful shutdown blocks new work while current work drains |
| Zero-credit power cutoff | Tested | Power billing clamps credits at 0, emergency-shuts down when a bill cannot be paid, shows a first-time explanation plus quick repeat popup, and allows a short no-bill bootstrap startup from 0 credits |
| PSU reliability stress | Tested | PSU affects reliability, efficiency, throttle, draw billing, and a 10-second overload failure that flashes the PSU red, hard-powers off, shows a short first-time failure popup, uses a red topbar badge for later trips, and clears active/queued work |
| Dense hardware draw curve | Tested | Dense cores/CPUs increase draw nonlinearly |
| RAM/CPU efficiency matching | Tested | Matching RAM module sizes/frequencies and CPU package specs improves power efficiency; mismatches add effective draw and reliability pressure |
| Cooling Thermal Control gate | Deferred | Cooling controls and the Thermal surface are deferred |
| Cooling power tradeoff | Deferred | Active cooling tradeoffs remain planned for the later Thermal pass |
| Browser persistence | Tested | Save/load works in browser storage, valid saves still restore when optional UI preference storage is corrupt, and malformed v2 RAM stick records are normalized before runtime materialization |
| Electron shell | Built | Desktop app opens the same game build |
| Responsive game UI | Tested | Main interface remains usable on desktop and mobile widths |
| Alert visibility | Tested | In-board PSU/deadlock alert captions scroll fully into view when they appear, including after mobile tab routing switches back to Hardware |
| Mobile unlock notifications | Tested | Mobile Tasks and R&D tabs show a red new-content notification when visible tasks or open research have unlocked since that tab was last viewed |
| Pinned task bar | Tested | Pinned tasks stay quickly runnable from the floating/embedded bar, and active pinned tasks keep their queue action available when the selected scheduler route can accept another copy |
| Hardware workbench UI | Tested | CPU board is the primary surface; top title chrome and side panels are removed |
| Board-integrated controls | Tested | Upgrades live on components and jobs sit below the system instead of in a switching inspector |
| Component-scoped controls | Tested | CPU, CPU-local cache, CPU-local scheduler, RAM, socket, and PSU expose relevant local actions and readouts; credits-only PSU wattage upgrades are available from the start while advanced PSU tuning and Thermal controls are deferred |
| Reversible upgrade tuning | Tested | Reversible hardware specs use one +/- stepper, downgrade refunds 50% of the last purchase cost, capacity removal is blocked while occupied, and unaffordable credit/data tokens dim without disabling the whole spec control |
| Core-local upgrades | Tested | Core Clock is purchased from a selected-core control strip; after CPU Operation Scheduler unlock, a Cores-header All selector retargets the same +/- clock control to the selected CPU's full core group without becoming a task route, and Add Core stays beside it instead of repeating controls in every core tile |
| Per-core job targeting | Tested | Selecting a core makes Jobs assign work directly to that core |
| Per-core clock state | Tested | Core Clock purchases apply to the targeted core without changing other cores |
| CPU-local scheduler targeting | Tested | The CPU-local scheduler turns CPU-bound tasks into queue intake when selected; system tasks stay on the visible System Scheduler instead of CPU-local whole-task queues |
| Expandable provisioning | Tested | Component upgrades needed for the current stage are visible inline without selecting the section first |
| CPU package reveal | Tested | Cores render as a standalone scalable core array before RAM; after RAM unlock, the CPU package frame wraps its scheduler, core array, and cache |
| CPU-integrated cache UI | Tested | Cache keeps capacity and speed upgrades available from the start, then nests into the CPU package frame once RAM makes the system-level package visible |
| Unified CPU/cache modules | Tested | Core/cache modules share compact stat rows, core-style upgrade controls, concise status labels, a committed/total cache readout, Cores-header deadlock pressure before CPU package reveal, and fixed-height Buffer/Ready cache lanes that use taller cache cards without enlarging buttons |
| Progressive CPU socket reveal | Tested | Single-CPU state avoids socket/package framing until RAM/system hardware makes the package meaningful |
| Hardware info controls | Tested | Hardware info icons are clickable controls that open short component explanations |
| Scheduler queue module | Tested | Scheduler modules use a compact header count plus a bounded adaptive-height slot grid; System Scheduler starts at the actual 1- and 2-slot footprint before 2x2, while larger grids step through 2x2, 4x2, 4x4, 6x4, 6x6, and 8x8 layouts without a separate status strip or queue title |
| RAM and PSU readouts | Tested | RAM appears above the CPU, shows selectable module cards in fixed small grids such as 2x2 for four sticks with an All target, reports module frequency without summing stick speeds, and exposes new-stick plus stick capacity/frequency upgrade access; PSU readouts target draw, billing, state, capacity, load, wattage upgrades, and overload failure pressure from the first screen |
| Hardware card layout | Tested | Hardware sections render as standalone cards in the hardware panel without an extra framed/background board wrapper |
| Scalable core layout | Tested | Core grids step through 1x2, 2x2, 2x4, 2x6, 2x8, 2x12, 2x16, and later Nx16 layouts; at 2x12 and wider, Cache sits beside the CPU scheduler while cores take full module width |
| CRON top module layout | Tested | CRON appears at the top of the system board after CRON Scheduler research, not as a locked second-CPU module |
| Support module rail | Tested | PSU remains an always-visible power module; Thermal is deferred |

## Multi-System Rack Phase

| Feature | Status | Acceptance |
|---|---|---|
| Multi-system rack phase | Tested | Active pre-live target after the second-CPU/system-building slice; automated coverage now verifies save reset, rack acquisition, selected-system routing, and elastic task boundaries |
| Clean save reset for rack phase | Tested | This phase intentionally starts from a fresh local save/save version rather than migrating obsolete prototype system/rack state |
| Visual rack slots | Tested | The rack-style view shows exactly one visible slot per owned system; buying a preconfigured system or completing a custom build adds one slot |
| Preconfigured systems | Tested | Player can buy ready-made complete systems without manually choosing every component; premade cards list the full CPU/RAM/scheduler/PSU module specs |
| Tiered custom machine builder | Tested | Custom builder exposes a full-size clickable system chassis with validated premade module choices by bay, ten single-CPU die choices from starter through server-preview tiers, a top-level 1/2/4/8 CPU count selector, CPU cards listing cores/cache/clock, and local custom builds up to 512 cores |
| Static equipment tier ladder | Tested | Catalog CPU, RAM, scheduler, and PSU modules use fixed tier prices; catalog CPUs keep cache speed equal to CPU clock tier, RAM capacity/frequency increases by tier, and CPU-local scheduler width is derived from CPU cores rather than arbitrary scheduler SKU width |
| Elastic single-system tasks | Tested | Compile Code, Render Frame, and Regression Test use idle cores on the selected system with fixed work/reward and no cross-system execution |
| No distributed computing in rack phase | Tested | Shared queues, networking, sharding, cluster scheduling, and cross-system task splitting remain unavailable in this phase |

## Core Resources

| Feature | Status |
|---|---|
| Credits | Tested |
| Data | Tested |
| Compute throughput | Tested |
| Capacity | Tested |
| Cache operation queues | Tested |
| RAM staging | Tested |
| Cache/RAM load speeds | Tested |
| Storage load speeds | Deferred |
| Power reliability | Tested |
| Power billing | Tested |
| Power states | Tested |
| Heat | Tested |
| Cooling reliability | Tested |
| Operating cost | Deferred |

## Jobs

| Feature | Status |
|---|---|
| Fetch Bit | Tested |
| Decode Bit | Tested |
| Bit Flip | Tested |
| Bit Shift | Tested |
| Byte Copy | Tested |
| Packet Check | Tested |
| Tiny Checksum | Tested |
| Memory Scrub | Tested |
| Queue Compaction | Tested |
| Power Telemetry | Tested |
| Bus Mirror | Tested |
| Thermal Probe | Deferred |
| Shard Reconcile | Tested |
| Micro Benchmark | Tested |
| Parallelism Benchmark | Tested |
| Multi-Core Benchmark | Tested |
| Compression | Deferred |
| Compile Code | Tested |
| Database Query | Deferred |
| Render Frame | Tested |
| Regression Test | Tested |
| Simulation Tick | Deferred |
| Data Sort | Deferred |
| Video Chunk | Deferred |
| Game Server Tick | Deferred |
| AI Training Batch | Deferred |
| API Hosting | Deferred |

## Upgrade And Automation Roadmap

| Feature | Status |
|---|---|
| Clock speed | Tested |
| Cache | Tested |
| CRON Scheduler | Tested |
| CRON interval upgrades | Tested |
| Broad auto-repeat | Deferred |
| Benchmarks | Tested |
| Additional cores | Tested |
| Basic queue | Tested |
| CPU scheduler queue slots | Tested |
| System Scheduler queue slots | Tested |
| CPU Operation Scheduler | Tested |
| PSU Management research | Deferred |
| Thermal Control research | Deferred |
| Scheduler Watchdog | Tested |
| Deadlock Cooldown | Tested |
| Scheduler policies | Tested |
| System Scheduler | Tested |
| Cluster scheduler | Deferred |
| Regional scheduler | Deferred |
| Preconfigured systems | Tested |
| Tiered custom machine builder | Tested |
| System templates | Deferred |
| Shared queue | Deferred |
| Rack templates | Deferred |
| Data center procurement policies | Deferred |
| SLA-safe scheduling | Deferred |
| Failover policy | Deferred |
| Global scheduler | Deferred |
| Infrastructure policy | Deferred |

## Later Stages

| Stage Or System | Status |
|---|---|
| Second CPU automation research | Tested |
| Stage 4: full system building | Deferred |
| Multi-system rack phase | Tested |
| Stage 5: cooling controls | Deferred |
| Stage 5: overclocking | Deferred |
| Stage 6: expansion slots and specialized compute | Deferred |
| Stage 7: multiple systems | Tested |
| Stage 8: networking and local cluster | Deferred |
| Stage 9: sharding and distributed computing | Deferred |
| Stage 10: servers and racks | Deferred |
| Stage 11: data centers | Deferred |
| SLA contracts | Deferred |
| Availability zones | Deferred |
| Regions | Deferred |
| Planetary computing | Deferred |

## Current Build Notes

- The first build targeted the vertical slice; the active docs target is now the Multi-System Rack Phase.
- Docs target for this slice: bit-scale startup, visible-from-start PSU billing, grouped task/research reveal, internal recipe DAG, RAM Control before System Scheduler, CPU-local cache/scheduler packages, unmatched and matched CPU purchases, second-CPU CRON Scheduler research reveal, and CRON Scheduler controls.
- Multi-System Rack Phase target: clean save reset, visual rack growth at exactly one visible slot per owned system, preconfigured system purchases, tiered custom machine building, and elastic single-system Compile Code, Render Frame, and Regression Test tasks. Networking, shared queues, sharding, cluster scheduling, and distributed computing remain out of scope for this phase.
- Rack-phase rows are marked `Tested` after automated coverage for save reset, one-slot-per-owned-system rack visuals, system acquisition, selected-system routing, elastic selected-system tasks, and no distributed-computing boundary.
- Active pre-live target: tasks are composed from low-level and counted operations; paid operation totals include CPU cycles, cache load bits, and RAM staging bits, so a 256 b RAM load contributes 256 paid operations; counted memory-operation cache fill uses total touched bits once; task-level cache provisioning and active residency sum distinct reads/writes, multiply parallel per-core cache footprints, include later primary-core work while other cores retain their footprints, and let overwrites reuse the touched footprint; RAM need is the peak per-core resident footprint while RAM load work counts each required staged load; cache stores CPU operation queues; cache-required operations wait for cache fill at their DAG step; cache UI reports committed cache as Buffer plus Ready, where Buffer is only issue work that outruns cache write speed and Ready includes cache load/ready residency; cache and RAM upgrade costs are weighted toward data over credits; CPU scheduler backlog and multicore provisioning width come from purchased per-CPU CPU Queue Slot upgrades instead of infinite default slots; system tasks are admitted by separate System Queue Slot upgrades on the visible System Scheduler as whole tasks, then reserve CPU scheduler slots only for their CPU-bound execution portions, including while target CPU cores are currently busy or CPU-local cache policy is holding execution; scheduler-dispatched tasks stay in their scheduler queue and keep their slot occupied until completion; cache/RAM total fit gates impossible tasks, while cache/RAM deadlocks happen only when active staging would write beyond capacity, halting the affected CPU package for cache or the whole system for RAM until the player cancels work or adds capacity; unresolved deadlocks build 10 seconds of pressure, clear early into a nonblocking cooldown, and only wipe active processes plus lock starts when the full timer is reached; FIFO can dispatch into deadlock, Deadlock-safe CPU schedulers use active footprint lookahead to skip dispatches that can eventually exhaust CPU-local cache or system RAM, Deadlock-safe System Scheduler intake checks RAM footprint only and leaves CPU cache safety to the target CPU scheduler, Shortest task and Smallest memory can reorder scheduler-owned queue entries, Scheduler Watchdog can preview its auto-kill victim, target core, and countdown before killing scheduler-owned deadlocks after 3 seconds, and Deadlock Cooldown upgrades drain post-deadlock pressure faster; newly researched RAM, CPU scheduler, System Scheduler, and CRON hardware render as paid outline bays until the first module is purchased; RAM stages larger active/intermediate work as the next memory tier after cache, shows loading before CPU execution, starts only after buying the first 256 b 1 Hz RAM Stick after RAM Control, buys new base sticks, lets selected sticks or all sticks upgrade capacity and frequency independently without summing stick speeds into a total RAM frequency, sits above the CPU package, and gates System Scheduler at 1 Kb; cache, CPU scheduler slots, and cores are CPU-local; unmatched CPU purchase installs a base one-core package, matched CPU purchase cost includes the base CPU plus copied upgrades, and both second-CPU choices list projected power increase on the CPU package card once visible; reversible hardware specs use +/- controls and refund half of the last purchase cost when downgraded.
- CRON target: CRON v1 automates only visible repeatable system tasks after the first CRON Job Slot is bought, starts with a 60s minimum interval, supports seconds/minutes modes, uses increasingly expensive `cronInterval` upgrades to lower the minimum by 1 second each, skips duplicate/blocked/full/off-state runs, never catches up missed runs, and adds a power spike when it queues work.
- Power target: tasks do not require power directly; PSU is visible from the first screen; draw is mW/uW-scale and primarily frequency-driven; positive-credit idle time drains money; power billing clamps credits at 0 and emergency-shuts down if a bill cannot be paid, with a first-time explanation and quick repeat popup; startup from 0 credits grants a short no-bill bootstrap window; credits-only PSU wattage upgrades are purchasable from the start, and capacity is a reliability/stress system with throttle plus a 10-second overload failure that fills faster above 100% load, flashes the full PSU red with a larger centered header progress meter, hard-powers off, shows a short first-time failure popup, uses a red topbar badge for repeat trips, and clears active/queued work; dense compute draw scales nonlinearly; `off` greys hardware except power/start controls while blocking work/CRON and billing zero; graceful shutdown blocks new work while current work drains; startup/shutdown have delays; and RAM/CPU package matching should reward efficient builds.
- Cooling target: Thermal UI, Thermal Control research, Thermal Probe, and active cooling tradeoffs are deferred until a later system-management pass.
- Research target: new task groups and hardware categories unlock through research cards; benchmark-style compute is launched from research cards, each card lists the research/task/hardware/compute requirements blocking it, and task/research rows keep needed operations/resources plus payouts visible even when blocked.
- Scheduler naming target: CPU Operation Scheduler first, then system, cluster, regional, and later global/planetary layers.
- Broad auto-repeat is deferred until much later automation work; CRON v1 is the scoped early timer for repeatable system tasks.
- New CRON, power-state, first-screen PSU Capacity, PSU overload failure, and deferred Thermal/PSU research gates are covered by automated verification in this implementation slice.
- Save/load hardening now sanitizes stale pre-live task references from completed counts, active tasks, queue entries, CRON schedules, benchmark completions, autorepeat targets, optional UI preference reads, and malformed v2 RAM stick records before selectors or ticks can read them.
- Previous breaking save reset: browser persistence used `save-v2` for the bit-scale pre-live schema.
- Rack phase clean save reset: browser persistence now uses `save-v3` with a v2 save envelope so obsolete vertical-slice system state does not migrate into the multi-system rack phase.
- Verification completed May 19, 2026: `npm test` passed with 137 tests for the Multi-System Rack Phase, including clean pre-v2 save reset, preconfigured and custom system purchase, one visible rack slot per owned system, selected-system upgrade routing, elastic Compile Code on selected-system idle cores only, and rack/custom-builder UI coverage. `npm run typecheck`, `npm run build`, and `git diff --check` were also part of final verification.
- Verification completed May 20, 2026: `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed for paid first-module installs on newly researched RAM, CPU scheduler, System Scheduler, and CRON hardware. Browser smoke at `http://127.0.0.1:6174/?seed=rack-ready` loaded without console errors.
- Verification completed May 20, 2026: React refactor and Storybook checks passed with `npm test` (147 tests across 11 files), `npm run typecheck`, strict TypeScript cleanup flags in project configs, `npm run build`, `npm run storybook:build`, `npm audit --audit-level=high`, `npm audit --omit=dev`, `git diff --check`, and browser smoke at `http://127.0.0.1:6173/?seed=rack-ready`. `HardwareBoard.tsx` is now a 186-line system/rack assembly shell, rack rows/bays and task cards/routes were split into focused components, CSS was reorganized into domain manifests plus focused partials, the former monolithic UI test file was split by behavior, Storybook stories use direct imports/static fixtures with docgen disabled to avoid oversized app-story chunks, Vitest was upgraded to 4.1.6, and Tailwind was intentionally not introduced because this pass preserves existing selector-driven visual behavior. Storybook build still reports Vite's large-chunk warning for the Storybook iframe runtime only.
- The reference PNGs guide visual tone, not mechanics.
- UI copy should be short and useful.
- Verification completed May 18, 2026: `npm test`, `npm run typecheck`, and `npm run build` passed for this bit-scale/reveal/DAG/deadlock slice, including CPU-issued cache writes, CPU-faster-than-cache Buffer buildup, equal-rate cache Ready behavior, counted cache-fill timing, paid cache/RAM load operation totals, per-core derived task resource needs, distinct read/write cache residency, overwrite cache reuse, per-operation cache staging, finite CPU scheduler queue slots, separate System Scheduler queue slots, system scheduler intake for whole system tasks, dispatch-time CPU scheduler reservation for system task CPU work even while CPU cores are busy or CPU-local cache policy is blocking execution, lower-level CPU scheduler wait reasons bubbling up to System Scheduler slots, active scheduler queue reservations until completion, scheduler width gating for multicore tasks, CPU-local cache/scheduler gates, no cross-CPU core splitting for multicore tasks, RAM Control and 1 Kb System Scheduler gates, mixed-size/mixed-frequency RAM sticks with per-stick and all-stick upgrades, data-weighted cache/RAM upgrade costs, reversible hardware downgrade refunds and capacity blockers, RAM loading progress before CPU execution, cache/RAM deadlocks with CPU-local or system-wide halt behavior and manual recovery, 10-second deadlock failure and cooldown lockout behavior, Deadlock Cooldown upgrade drain rate, FIFO and split deadlock-safe scheduler footprint behavior for CPU cache vs System Scheduler RAM, watchdog auto-kill victim/core/countdown display, scheduler policy controls, completed-task cache release, cached DAG-derived totals, research-card compute benchmarks, scheduler research unlock gates, compact task route controls, adaptive scheduler slot grids, duplicate scheduled-copy status display, deadlocked hardware/help UI, post-failure greyed lockout hardware, wide high-contrast deadlock countdown header bars, CPU package reveal, fixed-step core-grid layouts through 16-column width, cache/scheduler pairing at 2x12 core layout, RAM above CPU and System Scheduler above RAM, always-visible task/research requirement and payout summaries, blocked action-button reasons, Buffer/Ready cache and RAM state visuals, unlit unaffordable cost tokens, and shared resource tokens. Browser smoke evidence is recorded in `docs/qa-notes.md`.
- Verification completed May 19, 2026: `npm test -- src/ui/HardwareBoard.test.tsx`, `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed for listing multi-core requirements above one core on task cards and research compute rows while leaving single-core task cards unlabeled.
- Verification completed May 19, 2026: `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed for unmatched/matched CPU socket choices with power-delta readouts, credits-only first-screen PSU Capacity, compact PSU readouts, compact header power controls, larger centered PSU overload header progress, full-card red PSU over-power flashing, first-time short PSU failure popup with repeat-failure topbar badge, first-time/repeat out-of-credits popups, removed headroom/efficiency row, and the 10-second PSU overload failure pressure.
