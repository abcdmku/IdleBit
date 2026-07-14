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

## Long-Form Planetary Campaign

The campaign target supersedes prototype-era rows where they conflict. Existing
hardware and scheduler coverage remains valuable foundation; status here tracks
the new end-to-end campaign acceptance.

| Feature | Status | Acceptance |
|---|---|---|
| Exact `Amount` arithmetic | In Progress | Exact resources, campaign costs/rewards, capacity vectors, throughput, and reports are string-backed; the final audit is removing remaining number-backed legacy physical cost/reward/work interfaces and enforcing bounded projections |
| Deterministic advance engine | Tested | `advanceGame` consumes full foreground/chunked/offline intervals across event boundaries, passes strict delta-invariance coverage, and batches a stable seven-day standing order in about 1 ms |
| Save-v7 campaign reset | Tested | Pre-v7 saves clean-reset; v7 persists exact balances, timestamps, the departure buffer snapshot, deterministic RNG, and campaign/runtime state; return reports are rebuilt from each catch-up instead of being carried across reloads |
| Automation Buffer | Tested | Nine sequential levels (the starting node plus eight purchases) progress from 0 to 168 hours; each late maximum has a separate chapter research gate, departure-owned capacity caps catch-up, and overflow is harmless and non-retroactive |
| Offline return reports | Tested | Reports include elapsed/simulated/overflow/productive/paused time, completions, gross earnings, expenses, utilization, and blockers |
| Standing orders | Tested | Local Scheduler completes only finite queued work; CRON renews one safe baseline order without permanently stalling |
| Live Operations | Tested | Foreground-only managed spare-core lane alternates queue triage and canary validation, pays exact compute-scaled rewards, contributes physical power/thermal/billing load, preserves offline progress without allocating cores, and rejects public task spoofing |
| Bootstrap/Coherent campaign | Tested | Data-driven opening objectives teach queue, buffer, first benchmark, multicore, RAM, schedulers, second CPU, and CRON without repeatable Data farming |
| Workshop Fleet rename and rebalance | Tested | Player-facing PC surface is Fleet; up to 16 named fully simulated systems, cooling, overclocking, saved storage staging, accelerator routing, explicit actions, and useful projections replace rack terminology and hidden gestures before later growth moves into aggregate infrastructure |
| Contracts and projects | In Progress | Deterministic sustained/burst offers enforce a 15-minute refresh cadence, three-contract capacity, active-template novelty reservation, and compact exact rate readouts; contract template eligibility and `refreshContractMarket` are CRON-gated with a public blocker and stale offers are pruned at load; the bootstrapBenchmark project is removed with its first-completion Data re-homed to early tasks; productive progress follows frozen ordered cache/RAM/CPU and later storage/network work on the assigned system, incompatible target systems are rejected with explicit lane blockers instead of fake maximum ETAs, every Credit settles from exact recipe work plus a named frozen multiplier, offer expiry remains a deadline, and phased optional arcs persist exact stage progress without blocking the mainline |
| Local Fabric and distributed work | Tested | Local Fabric progressively reveals a per-system NIC bay; project and distributed network stages use the installed machine's real ingress/egress rates, while shared queues, multi-resource placement, weighted-fair scheduling, shard DAGs, storage staging, barriers, reduce/commit, and replication are simulated and covered |
| Rack and Facility | Tested | True racks and data centers model exact procurement, rack units, compute, memory, storage, power, cooling, uplink, operating cost, utilization, reserve, and headroom |
| Resilient Cloud | Tested | SLA productive work follows routed capacity while a separately named service observation window integrates availability, replica quorum, deadlines, p95 latency, zones, explicit failover, opt-in incidents, and exact rewards |
| Planetary Commons | Tested | Regions, min-cost global routing, the three-phase finale, swappable charters, and endless postgame contracts are playable and covered |
| Campaign balance runner | In Progress | Public-action cadence profiles, seeded Monte Carlo, dominance-pruned beam search, NSGA-II, metrics, generated CSV evidence, and focused tests exist; full campaign pacing gates are not yet calibrated |
| Command-deck UI | Tested | Compact desktop-topbar and mobile-Jobs objective status, exceptional persistence status, contextual Automation Buffer controls in Work, Work taxonomy, projections, return summary, named Fleet, preset/Advanced builder, responsive mobile-first Work, zoom/reflow, touch targets, keyboard/focus, reduced motion, and zero-violation tagged WCAG Axe coverage pass the browser acceptance suite |
| Progressive hardware-owned work UI | In Progress | Opening Work exposes only playable Jobs; Campaign and Automation reveal with System Scheduler research (legacy saves with an active/completed project keep Campaign), Contract Market reveals with CRON Scheduler research (or while legacy contracts exist), Standing Orders join Automation at CRON, and Automation Buffer levels stay R&D-column purchase cards while Automation shows only buffer status/departure forecast; until Campaign reveals, the chapter objective plus its actionable blocked reason stays in the topbar/mobile objective chip; task cards avoid redundant projections; fixed-height system status shows active projects/contracts/orders/jobs without shifting surrounding UI |
| Offline Worker and persistence status | Tested | Worker catch-up has a sync fallback; departure saves, hydration, error/status UI, confirmed reset, and browser/Electron failure recovery are covered |
| Electron packaging and PR CI | Tested | Relative production assets, durable relaunch E2E, reproducible Linux directory packaging, Windows packaging CI, and PR checks cover tests, typecheck, web/Electron builds, Storybook, browser/Electron E2E, balance evidence, and packaging |

## Vertical Slice

| Feature | Status | Acceptance |
|---|---|---|
| Primitive CPU start | Tested | New save starts with 10 credits, one Hz tier level-1 CPU core at 1 Hz, 1 b cache, 1 Hz cache load rate, 0 b RAM, hidden 1 Hz RAM load rate, data, visible PSU power readouts, 0.1 uW starter CPU draw, 10 uW starter PSU capacity, runnable Fetch Bit, and 2 b-gated Decode Bit visible |
| Opening physical timing | Tested | Fetch Bit is exactly two operations and two seconds at starter 1 Hz rates; one transfer bit or CPU cycle takes one second on its applicable 1 Hz lane, and Bit Flip is exactly three read/mutate/write operations, so it is strictly slower on identical hardware |
| Hardware-derived task timing | Tested | Authored cache/RAM/CPU work and fixed aggregate batch volumes determine task time; projects/contracts use ordered hardware paths, and fixed clocks are limited to explicitly named deadlines, observation windows, and physical latencies |
| Smooth exact progress meters | Tested | Work, project, contract, cluster, Cloud, storage, Live Ops, core, cache, RAM, rack, and queue fills interpolate across exact 500 ms snapshots, snap batch resets, and disable motion under reduced-motion preference |
| Bit-scale startup | Tested | Opening tasks stay as a tiny bit-scale pair before byte/cache/research concepts are introduced, with Decode using a 2 b cache footprint and overwrite bit tasks reusing 1 b footprints |
| Manual tasks | Tested | Player can start an available task/job, receive work-derived Credits on every completion, and receive authored Data only while its first-completion milestone is still pending |
| Work-derived payouts | Tested | One exact paid-work ledger covers Jobs, paid benchmarks, every project phase, contracts, Live Operations, Workshop storage, cluster work, and Cloud SLAs; sequential lane work pays one Credit per unit before an explicit named frozen multiplier, concurrent memory issue/cache transfer is counted once, hardware speed changes duration rather than gross payout, and closed-world balance tests reject untracked Credit sources |
| Manual click-rate tuning | Deferred | The prototype research path is being removed; hold-repeat remains only as an accessibility setting and cannot raise the intended progression ceiling |
| Task cancellation | Tested | Active tasks and queued scheduler entries can be canceled, releasing reserved work without paying rewards or removing active scheduler reservations for other queued copies |
| Resource gain flyouts | Tested | Positive credits/data gains show transient +amount labels above the mobile/desktop workbench that fly into the matching HUD total |
| Resource amount tokens | Tested | Credits/data use one icon-number-color treatment in the HUD, flyouts, task payouts, upgrade/research costs, graph readouts, and inspect summaries, with RuneScape-style exact/K/M/B/T/Q/Qn/S/Sp stack count formatting and spaced suffixes |
| Development-only resource shortcut | Deferred | The public simulation API and HUD shortcut are removed so production and diagnostic surfaces share the same player-visible action boundary; test fixtures fund exact resources directly |
| HUD resource graph | Tested | Desktop clicks on the HUD credits/data readouts toggle the resource graph, while mobile taps always open the graph and route to the R&D/graph column without closing it on repeated taps |
| HUD settings menu | Tested | The settings icon beside the HUD data readout opens compact toggles for showing hardware purchase controls and requesting a keep-screen-awake lock |
| Storybook component documentation | Tested | Storybook is configured for reusable UI components, with stories for resource cost states, HUD zero/high/gain states, PSU/credit failure notices, motherboard layout board/rack states, SystemRackPanel rack states, and TaskBay route/pinned-task states using static review fixtures |
| React UI module boundaries | Tested | App persistence, notice preferences, resource UI, failure notices, rack/builder UI, rack visual bays, task route/card UI, task/research panels, CPU/cache/scheduler, RAM, PSU, and shared hardware meters live in focused modules instead of one mixed hardware board file |
| CSS architecture | Tested | CSS uses ordered domain manifests and focused partials for foundation, layout, hardware, scheduler, tasks, overlays, responsive, rack, and late surface rules without adding a utility framework dependency |
| CPU Package Level upgrades | Tested | Upgrade increases CPU operation throughput for every core in the CPU package, charges the target-level CPU tier cost for each installed core, changes package draw through clock/efficiency, and uses one combined price/refund control |
| CPU tier research | Tested | Hz, kHz, MHz, and GHz tiers each have 36 bounded levels; research advances through GHz level-1 packages, physical clocks stop at 6 GHz, and larger values are aggregate Fleet/infrastructure throughput |
| C-State Control | Tested | C-State research appears after kHz CPU Research, costs the sheet `c_state unlock` value, then remains open as a global `Level up` research item using sheet C-State costs until max level while reducing idle CPU draw only across every system |
| Cache upgrades | Tested | Capacity and speed upgrades are available from the start; capacity costs more data than credits, speed follows the CPU tier frequency ladder with target-level costs multiplied by installed cores, active cache writes share the CPU-package cache lane, and both improve cache queue/fill behavior |
| Task operation composition | Tested | CPU-bound tasks decompose into read/write/overwrite memory operations and compute operations, exposed RAM page tasks unlock with RAM Control, and composed system/distributed stages preserve child provenance; cards count real operation invocations while DAG chips keep cache bits, RAM bits, and CPU cycles separate |
| Runtime progress meters | Tested | Task cards show one whole-task progress value across recipe/load/compute work, RAM shows reserved/loading/ready staging progress, and CPU core meters show current CPU execution, including memory-operation cache issue cycles |
| Inferred task composition DAG | Tested | Task definitions infer cached recipe-step DAG nodes, per-step cache/RAM staging, held RAM, and accept/execute/complete dependencies for ready/waiting reasons |
| CPU cache operation queue | Tested | Cache stores CPU operation queues instead of acting only as a percent modifier; total cache fit gates impossible tasks while active cache writes that exceed capacity create CPU-package deadlocks that halt all active work on that CPU |
| Cache-fill wait gate | Tested | Cache-required operations wait for cache fill at the graph step where that operation executes |
| Progressive task reveal | Tested | Tasks appear in small concept groups and the task panel groups visible work by CPU-bound, system, distributed, and other task categories instead of a single previous-task chain |
| Progressive research reveal | Tested | Research appears only after data/research has player-facing meaning |
| Research requirements clarity | Tested | Research cards list unmet research, task, hardware, and compute requirements before purchase |
| Task/research summary chips | Tested | Task cards and research compute rows keep real authored operation-invocation counts, multi-core requirements above one core, cache/RAM needs, and exact next-completion payouts/costs visible; first-completion Data disappears after settlement, blocked action buttons show the current blocker, and task cards do not list live state or recolor while active |
| Task route picker | Tested | The task panel header uses a compact layer selector plus target dropdown: C chooses a core, CPU chooses a CPU scheduler, and Sys chooses the System Scheduler without an Auto route |
| CRON v1 timer automation | Tested | CRON Scheduler research reveals a paid CRON Job Slot install; installed slots enable timer repeats for visible repeatable system tasks only with a default minimum 60s, seconds/minutes modes, whole-second next-job countdown, increasingly expensive `cronInterval` upgrades lower the minimum by 1 second each, and skipped runs do not catch up |
| Broad auto-repeat | Deferred | General task auto-repeat remains out of scope beyond the scoped CRON v1 system-task loop |
| Research compute benchmarks | Tested | Micro, parallelism, and multi-core benchmarks run from their owning research cards and stay out of the normal task list |
| Micro Benchmark | Tested | Benchmark compute gates progression from early CPU tuning |
| Multi-core unlock | Tested | Parallelism benchmark completion enables Multi-Core Control research, which unlocks buying more cores |
| Additional cores | Tested | Cores increase parallel throughput, not single-job speed |
| Basic queue | Tested | Early queue behavior feeds operations/tasks to idle cores after queue slots are purchased; only the None scheduler policy can dispatch into unsafe cache/RAM staging, while System Scheduler non-None policies wait for free RAM footprint |
| CPU scheduler queue slots | Tested | CPU scheduler backlog capacity starts at zero in the hand-built CPU phase; catalog machines derive CPU-local scheduler slots from each CPU package's core count, scheduler-dispatched CPU work keeps those slots occupied until completion, and composed system tasks reserve real CPU-bound child entries before cores run them |
| Four-core milestone | Tested | Four cores satisfy one System Scheduler requirement before the RAM gate |
| RAM Control gate | Tested | RAM Control appears with System Scheduler after Local Scheduler, reveals a paid RAM bay, and buying the first RAM Stick installs a 256 b module at 1 Hz for larger RAM/cache tasks |
| System Scheduler unlock | Tested | Local and System Scheduler unlocks are research purchases; System Scheduler requires RAM Control plus at least 1 Kb RAM and appears as a paid install outline until the first System Queue Slot is bought |
| System Scheduler queue slots | Tested | System Queue Slot upgrades are bought on the System Scheduler surface, admit whole composed parent entries separately from CPU Queue Slots, and stay occupied until that system task completes or is canceled while CPU schedulers own real child task entries with parent metadata |
| Bootloader Research | Tested | Bootloader Research appears after System Scheduler research, unlocks for 100,000 credits, then remains open as a repeatable `Level up` research item for levels 1-36; level costs start at 10,000 credits and multiply by 1.2 so level 36 costs about 5.9M credits, while startup and graceful shutdown time drop by the same bootloader savings and clamp to 0.10s at level 36 |
| Deadlock runtime | Tested | Cache/RAM exhaustion during active staging creates deadlocked work, paints affected hardware/scheduler surfaces red, greys affected hardware only during post-failure lockout reset, halts the affected CPU or whole system, shows a wide high-contrast Cores/CPU/RAM header progress bar that fills toward failure and stays visible while draining back to 0, resumes when capacity is freed, and wipes active processes only if unresolved for 10 seconds |
| Second CPU unlock | Tested | Multi-core benchmark compute enables System Bus research; CPU install paths add level-1 one-core packages matching the system's existing CPU tier with projected power increase, and purchasing a CPU reveals CRON Scheduler research while PSU stays visible from the start |
| CPU package choices | Tested | Existing-system CPU purchases keep the system's installed CPU tier, can scale past two packages, price the next package exponentially at 2x/4x/8x/etc. the tier base price for CPU #2/#3/#4/etc., reduce every CPU package's effective efficiency by 25% per added CPU package, and no longer copy another package's level, cores, cache, cache speed, or scheduler slots |
| RAM reveal | Tested | RAM appears after RAM Control research, not after second CPU purchase |
| CRON module reveal | Tested | Second CPU purchase reveals CRON Scheduler research only; the CRON system module stays hidden until that research is bought, then appears as a paid CRON Job Slot install outline |
| CRON Scheduler research | Tested | Unlocks the paid CRON Job Slot install that enables CRON controls for visible repeatable system tasks only |
| PSU Management research | Tested | Appears after System Scheduler plus Power Telemetry, ends the onboarding energy subsidy, and enables metered billing, unpaid cutoff, and destructive PSU failure only after the player has visible countermeasures |
| Thermal Control research | Tested | Workshop progression reveals the Thermal surface, five cooling tiers, heat/throttle status, and overclock controls when those choices become actionable |
| Repeatable system tasks | Tested | Memory Scrub, Queue Compaction, Power Telemetry, Bus Mirror, Shard Reconcile, and Thermal Probe reveal at their campaign gates |
| Power and thermal reveal | Tested | PSU is visible from the first screen; Thermal is progressively revealed in Workshop with model-owned heat and sustained-throughput status |
| PSU onboarding subsidy | Tested | PSU draw/capacity/headroom are visible from the first screen, but billing and destructive failures stay disabled until PSU Management; unsafe starts pause safely before that gate |
| RAM staging model | Tested | RAM extends the memory staging hierarchy after cache, exposes CPU-bound RAM read/write/overwrite page tasks, shows task loading into fixed per-stick address blocks before CPU execution, reuses released block locations after cancellation/completion, and peak per-core RAM fit gates impossible tasks while active RAM writes that exceed capacity create system-wide deadlocks that halt all active work |
| RAM upgrades | Tested | First RAM install presents a tier choice for each CPU-unlocked RAM tier; once RAM exists on the system, new sticks match the existing RAM tier and no tier picker is shown, then stick capacity and frequency upgrade per selected stick or all sticks; mixed capacities and frequencies are allowed, new sticks add capacity rather than summed total speed, stick and frequency costs match CPU tier level costs, frequency values match the CPU/cache tier clock ladder, capacity costs multiply that CPU-style cost by the stick's per-tier size growth, capacity doubles each level, each tier is 1024x the previous tier, capacity starts at 256 b, and frequency starts at 1 Hz |
| RAM channel research | Tested | Single-channel RAM allocations fill lower-numbered sticks first and spill to later sticks for capacity, but only one stick is actively written per channel at a time; concurrent writes on the serviced stick/channel share that lane, aggregate RAM write speed is capped by both writer-core Hz and serviced RAM-lane Hz, Dual/Quad/Oct Channel RAM research costs 200,000/20,000, 50,000,000/5,000,000, and 1,000,000,000/100,000,000 credits/data, no longer requires matching installed stick counts, and unlocks System Scheduler striping across up to 2/4/8 serviced channel lanes capped by installed sticks; later stick groups wait behind the lowest pending group instead of skipping lower-numbered sticks, unused later sticks are reserved before spare capacity on larger earlier sticks, and visible bandwidth reports the current effective write rate |
| Memory Voltage Modifier | Tested | Memory Voltage Modifier appears after RAM Control plus kHz CPU Research, unlocks for 1,000,000 credits, then remains as a repeatable `Level up` research item starting at 100,000 credits and multiplying each level by 1.8 while reducing idle RAM draw only |
| Power states and billing | Tested | Power states are `on`, `shuttingDown`, `off`, and `booting`; after PSU Management, productive powered work is metered while off bills zero, graceful shutdown drains current work, and idle/departure policy can power down safely |
| Zero-credit power cutoff | Tested | After PSU Management, billing clamps credits at 0, starts a 10-second unpaid cutoff before shutdown, and shows first/repeat notices; the opening subsidy prevents this failure before countermeasures exist |
| PSU reliability stress | Tested | Live PSU stress and safe start blockers are visible early; after PSU Management, overload pressure can throttle, flash, hard-power off, notify, and clear active/queued work after the 10-second failure window |
| CPU power curve | Tested | Active CPU draw is `clock / efficiency`, idle draw uses the C-State multiplier after C-State unlock, and starter PSU capacity is 10 uW with `10 uW * 1.7^(level - 1)` capacity progression |
| RAM/CPU efficiency matching | Tested | Matching RAM module sizes/frequencies and CPU package specs improves power efficiency; mismatches add effective draw and reliability pressure |
| Cooling Thermal Control gate | Tested | Thermal Control reveals system-scoped cooling installation and overclock controls in Workshop |
| Cooling power tradeoff | Tested | Five cooling tiers trade exact purchase/operating power against heat buildup, throttling, and sustained throughput |
| Reversible cooling tiers | Tested | Cooling tiers share the Thermal section as one telemetry-plus-ladder card; lower tiers stay clickable as downgrades that refund 50% of the installed tier's cost, with hotter running (throttling) as the only deterrent |
| Workshop storage staging | Tested | Each system saves an installable Local SSD/NVMe profile and one exact CapacityWork artifact-staging workload with capacity/read/write fit, progress, reward, power, heat, offline, cancellation, and Fleet-capacity mirroring coverage |
| Workshop accelerators | Tested | Entry GPU/NPU modules route fitted render/inference work with contention and explicit CPU fallback; Open Foundry optionally unlocks advanced modules without blocking the mainline specialization proof |
| Browser persistence | Tested | Save/load writes save-v7 exact campaign state, snapshots the owned departure buffer before absence, normalizes corrupt v7 data, and clean-resets incompatible pre-v7 prototypes |
| Electron shell | Tested | The packaged desktop build loads relative assets through a constrained preload bridge, atomically persists, flushes elapsed time before close, relaunches the same durable save, and presents the offline return report |
| Responsive game UI | Tested | Work opens first on mobile, bottom navigation and mission/active status remain visible, and browser acceptance covers 320–1920 px plus 200%-equivalent reflow |
| Alert visibility | Tested | In-board PSU/deadlock alert captions scroll fully into view when they appear, including after mobile tab routing switches back to Hardware |
| Mobile unlock notifications | Tested | Mobile Tasks and R&D tabs show a red new-content notification when visible tasks or open research have unlocked since that tab was last viewed |
| Pinned task bar | Tested | Pinned tasks stay quickly runnable from the floating/embedded bar, and active pinned tasks keep their queue action available when the selected scheduler route can accept another copy |
| Hardware workbench UI | Tested | CPU board is the primary surface; top title chrome and side panels are removed |
| Board-integrated controls | Tested | Upgrades live on components and jobs sit below the system instead of in a switching inspector |
| Component-scoped controls | Tested | CPU, CPU-local cache/scheduler, RAM, sockets, PSU, Thermal, cooling, overclocking, and GPU/NPU modules expose explicit local actions and model-owned readouts; cheap PSU capacity stays visible from the start while Workshop progressively reveals its sustained-performance controls |
| Reversible upgrade tuning | Tested | Reversible hardware specs use one +/- stepper, downgrade refunds 50% of the last purchase cost, capacity removal is blocked while occupied, and unaffordable credit/data tokens dim without disabling the whole spec control |
| CPU package tuning controls | Tested | Package frequency is purchased from the selected CPU package control strip with a Core Freq label; after CPU Operation Scheduler unlock, a Cores-header All selector targets the same package-level +/- control without becoming a task route, and Add Core lives in the Cores header instead of repeating controls in every core tile |
| Per-core job targeting | Tested | Selecting a core makes Jobs assign work directly to that core |
| Package-level clock state | Tested | CPU Package Level purchases apply to the targeted CPU package and set the clock for every core in that package |
| CPU-local scheduler targeting | Tested | The CPU-local scheduler turns CPU-bound tasks into queue intake when selected; system tasks stay on the visible System Scheduler, then feed CPU-local child entries instead of CPU-local whole-task queues |
| Expandable provisioning | Tested | Component upgrades needed for the current stage are visible inline without selecting the section first |
| CPU package reveal | Tested | Cores render as a standalone scalable core array before RAM; after RAM unlock, the CPU package frame wraps its scheduler, core array, and cache |
| CPU-integrated cache UI | Tested | Cache keeps capacity and speed upgrades available from the start, then nests into the CPU package frame once RAM makes the system-level package visible |
| Unified CPU/cache modules | Tested | Core/cache modules share compact stat rows, core-style upgrade controls, concise status labels, a committed/total cache readout, Cores-header deadlock pressure before CPU package reveal, and fixed-height Buffer/Ready cache lanes that use taller cache cards without enlarging buttons |
| Progressive CPU socket reveal | Tested | Single-CPU state avoids socket/package framing until RAM/system hardware makes the package meaningful |
| Hardware info controls | Tested | Hardware info icons are clickable controls that open short component explanations |
| Scheduler queue module | Tested | Scheduler modules use a compact header count plus a bounded adaptive-height slot grid; System Scheduler starts at the actual 1- and 2-slot footprint before 2x2, while larger grids step through 2x2, 4x2, 4x4, 6x4, 6x6, and 8x8 layouts without a separate status strip or queue title |
| RAM and PSU readouts | Tested | RAM appears above the CPU, shows selectable module cards in fixed small grids such as 2x2 for four sticks with an All target, renders fixed address bars with allocated block segments, reports active/max channels plus effective write bandwidth without summing stick speeds, exposes the new-stick control in the RAM header, and keeps stick capacity/frequency upgrade access on the RAM tuning strip; PSU readouts target draw, billing, state, capacity, load, wattage upgrades, and overload failure pressure from the first screen |
| Hardware card layout | Tested | Hardware sections render as standalone cards in the hardware panel without an extra framed/background board wrapper |
| Scalable core layout | Tested | Core grids step through 1x2, 2x2, 2x4, 3x4, 4x4, 3x8, 4x8, and later Nx8 layouts, always filling the core-array width without horizontal scrolling; eight-column desktop grids cap to six columns on medium screens and four on narrow screens; Cache sits beside the CPU scheduler for dense full-width layouts; compact/dense core tiles use the lower bar as the status/progress light and stack label over frequency |
| CRON top module layout | Tested | CRON appears at the top of the system board after CRON Scheduler research, not as a locked second-CPU module |
| Support module rail | Tested | PSU remains an always-visible power module; Thermal, cooling, overclocking, GPU/NPU slots, routing, and CPU fallback appear at their Workshop gates |

## Fleet Foundation

This section tracks the earlier PC-scale implementation under its current
player-facing name. The Long-Form Planetary Campaign table above is
authoritative for later cluster, rack, facility, Cloud, and Planetary layers.

| Feature | Status | Acceptance |
|---|---|---|
| Multi-system Fleet | Tested | Fleet Orchestrator unlocks named PC-scale systems; coverage verifies save reset, acquisition, selected-system routing, task boundaries, and aggregate active-work status |
| Clean save reset for campaign | Tested | Save-v7 intentionally resets incompatible pre-v7 prototypes and normalizes all current campaign, Workshop, infrastructure, Cloud, and exact-amount state |
| Named Fleet systems | Tested | The Fleet view shows exactly one explicit, named entry per owned system; completing a custom build adds one entry and makes all actions discoverable |
| Preset systems | Tested | The builder offers useful presets plus an Advanced editor, all with throughput, idle/peak power, operating-cost, profitability, and comparison projections |
| Tiered custom machine builder | Tested | Custom Machine Assembly reveals Advanced mode with linked or independent CPU packages, cores, RAM, schedulers, cache, and PSU controls, a persistent draft, projections, and confirmed exact purchase. V1 bounds physical builds at 8 packages and 64 cores per package (512 cores), with all runtime/save actions clamped to explicit component limits. Physical CPU choices stop at the 6 GHz ceiling; larger-scale throughput belongs to aggregate Fleet and infrastructure profiles. |
| Static equipment tier ladder | Tested | Catalog CPU, RAM, scheduler, and PSU modules use fixed, research-gated prices with visible clock, efficiency, draw, fit, and peak-load validation; CPU-local scheduler width derives from installed cores. |
| Chunked single-system tasks | Tested | Compile Code, Render Frame, and Regression Test are fixed-count chunk workloads; idle eligible cores across all CPU packages on the selected system each process one chunk at a time with per-chunk cache/RAM fit, explicit per-work-unit child stages before single global barrier/output stages, and no cross-system execution |
| Fleet-to-Fabric boundary | Tested | Fleet jobs stay system-scoped until Local Fabric unlocks; Local Fabric then adds explicit shared queues, placement, networking, sharding, barriers, and cross-system scheduling |

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
| Storage load speeds | Tested |
| Power reliability | Tested |
| Power billing | Tested |
| Power states | Tested |
| Heat | Tested |
| Cooling reliability | Tested |
| Operating cost | Tested |

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
| Thermal Probe | Tested |
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
| PSU Management research | Tested |
| Thermal Control research | Tested |
| Scheduler Watchdog | Tested |
| Deadlock Cooldown | Tested |
| Scheduler policies | Tested |
| System Scheduler | Tested |
| Cluster scheduler | Tested |
| Regional scheduler | Tested |
| Preconfigured systems | Tested |
| Tiered custom machine builder | Tested |
| System templates | Tested |
| Shared queue | Tested |
| Rack templates | Tested |
| Data center procurement policies | Tested |
| SLA-safe scheduling | Tested |
| Failover policy | Tested |
| Global scheduler | Tested |
| Infrastructure policy | Tested |

## Later Stages

| Stage Or System | Status |
|---|---|
| Second CPU automation research | Tested |
| Stage 4: full system building | Tested |
| Workshop Fleet | Tested |
| Stage 5: cooling controls | Tested |
| Stage 5: overclocking | Tested |
| Stage 6: expansion slots and specialized compute | Tested |
| Stage 7: multiple systems | Tested |
| Stage 8: networking and local cluster | Tested |
| Stage 9: sharding and distributed computing | Tested |
| Stage 10: servers and racks | Tested |
| Stage 11: data centers | Tested |
| SLA contracts | Tested |
| Availability zones | Tested |
| Regions | Tested |
| Planetary computing | Tested |

## Current Build Notes

- Multi-agent review + fix pass completed July 11, 2026 (tracker:
  `docs/review-2026-07-11-findings.md`, 94 findings, 89 fixed / 4 partial /
  1 skipped / 6 designer questions). Highlights: delta-invariance event
  boundaries for billing/cutoff/grace/overload/thermal/deadlock recovery;
  managed-work rates sampled from slice-start state; offline advancement no
  longer stalls a whole absence after a deadlock wipe; save-v7 hardening
  (per-resource exact fallback, no reward-minting from unknown operation
  statuses, full normalization for every saved system, resilient
  deserialization); departure-save/catch-up race fixed with pre-seed save
  backup and durable-close handshake; composed-task paid work now matches
  runtime RAM staging (no cross-child residency); RAM stick sell-refund
  exploit closed; Scheduler Watchdog gated behind System Scheduler (softlock);
  managed Fleet capacity + aggregate-server procurement now reachable in
  production UI; Live Operations costs scoped to the spare-core lane;
  reserved-geometry violations fixed across queue/CPU/PSU/project/contract/
  research/pinned surfaces; balance harness de-scripted (no calendar
  admission dates) — which exposed a real accelerator-era Data pacing stall
  that blocks canonical evidence regeneration pending designer review of
  GPU/NPU Data prices; new `?seed=workshop-ready`/`?seed=cloud-ready`/
  `?seed=planetary-ready` dev seeds. Verification: 970 tests across 116
  files, typecheck (app/e2e/electron), and production web+electron build all
  pass.
- Designer rulings implemented July 11-12, 2026: metered power billing is live
  from the first tick of a fresh save (unpaid cutoff and destructive PSU
  failure remain gated behind PSU Management, which now arms those
  countermeasures); the flat 25%-per-socket CPU efficiency penalty is replaced
  by a graduated hardware-rarity schedule (1.0/0.95/0.88/0.80/0.72/0.68/0.60/
  0.55 for 1-8 sockets — dual common, quad rare, oct very rare), which also
  resolved the full-idle pre-CRON stall (CRON buffer now banks at ~day 1.3
  full-idle); contract offers let the player choose the target system at
  accept time with shared lane-blocker validation; opening task timing is
  hardware-derived by ruling (2 s Fetch Bit canonical — the 5-30 s QA band is
  retired). Open designer question: accelerator-era Data pricing (GPU 240 /
  NPU 320 Data vs ~111 banked) still blocks canonical balance-evidence
  regeneration.
- The active pre-live target is the complete Long-Form Planetary Campaign. The
  former vertical-slice and “Multi-System Rack Phase” notes below are retained
  only as dated implementation history; their old scope boundaries and save
  versions are superseded by save-v7 and the campaign table above.
- Progression now runs from Bootstrap Node through Planetary Commons, with
  exact string-backed economy amounts, deterministic foreground/offline
  advancement, the purchased 0–168 hour Automation Buffer, standing orders,
  managed contracts, phased projects, and model-owned departure forecasts.
- Fleet is the PC-scale surface. Workshop adds cooling, overclocking, and
  GPU/NPU specialization; Local Fabric adds shared placement and distributed
  DAG work; Rack/Facility adds aggregate server infrastructure; Cloud and
  Planetary add zones, SLAs, failover, regions, routing, finale, charters, and
  endless postgame contracts.
- Work exposes Missions, Projects, Contracts, Standing Orders, Jobs, the
  Automation Buffer, and whole-world Active Work. The desktop topbar and mobile
  Jobs view keep the current objective available, while exceptional persistence
  status stays visible without a second global strip; start/departure
  projections retain responsive, keyboard, reduced-motion, focus, zoom, and
  touch-target coverage.
- Final campaign profile calibration and the last cross-surface acceptance run
  are tracked separately in the top table until their generated evidence and
  full verification commands pass.
- Progression gating rework completed July 10, 2026: Work opens Jobs-only, with
  Campaign and Automation revealed by System Scheduler research (legacy saves
  with an active/completed project keep Campaign; Live Operations anchors
  Automation), Contract Market revealed by CRON Scheduler research (legacy
  contracts persist), and Standing Orders inside Automation at CRON; contract
  template eligibility and `refreshContractMarket` are CRON-gated with a public
  blocker, stale offers are pruned at load, and Automation Buffer levels stay
  R&D-column purchase cards while the Automation view shows only buffer
  status/departure forecast. Rationale: contracts model unattended client
  workloads (requiring CRON) and projects are background system workloads
  (requiring the System Scheduler), so each era's surface funds the next era's
  unlocks—task first-completions fund research through System Scheduler,
  projects plus Live Ops fund System Bus/second CPU/CRON, and contracts fund
  Fleet expansion. Content: bootstrapBenchmark is removed and its 9
  first-completion Data re-homed (bitFlip 5, bitShift 5, byteCopy 5,
  packetCheck 4); RAM-era first-completions raised
  (readRamPage/writeRamPage/overwriteRamPage 3 each, tinyChecksum 8) to fund
  System Scheduler research; schedulerIntegration requires System Scheduler
  research to start; early costs retuned for the Jobs-only opening (Benchmark
  Harness 28c+1d, Multi-Core Control 56c+6d, Local Scheduler research 80c+6d,
  Local Scheduler buffer 70c+8d). Balance harness: the policy budgets shared
  cache across planned manual dispatches, routes post-Local-Scheduler income
  through CPU queue slots (`queueTask`), deprioritizes manual repeats near the
  ten-completion promise, exempts objective-critical research from the savings
  reserve, and gates market refresh on CRON.

## Historical Build Notes

- The first build targeted the vertical slice, followed by the historical Multi-System Rack Phase.
- Docs target for this slice: bit-scale startup, visible-from-start PSU billing, grouped task/research reveal, internal recipe DAG, RAM Control before System Scheduler, CPU-local cache/scheduler packages, CSV-backed CPU tier research, package-level CPU upgrades, level-1 CPU purchases, C-State idle draw, second-CPU CRON Scheduler research reveal, and CRON Scheduler controls.
- Historical Multi-System Rack Phase target: rack acquisition after System Catalog research following CRON/system-bus progression, visual rack growth at exactly one visible slot per owned system, tiered custom machine building without a separate custom-machine research gate or premade config cards, confirmed custom purchase, and chunked single-system Compile Code, Render Frame, and Regression Test tasks that fill idle cores across CPU packages on the selected system. Its former networking/distributed boundary is superseded by Local Fabric.
- Rack-phase rows are marked `Tested` after automated coverage for save reset, one-slot-per-owned-system rack visuals, system acquisition, selected-system routing, chunked selected-system tasks, and no distributed-computing boundary.
- Active pre-live target: tasks are composed from low-level and counted operations; the paid-work ledger keeps CPU cycles, cache/RAM/storage/network transfer bits, and real operation invocations as separate quantities, so a 256 b RAM load contributes 256 paid-work units without being mislabeled as 256 operations; counted memory-operation cache fill uses total touched bits once; task-level cache provisioning and active residency sum distinct reads/writes, multiply parallel per-core cache footprints, include later primary-core work while other cores retain their footprints, and let overwrites reuse the touched footprint; RAM need is the peak per-core resident footprint while RAM load work counts each required staged load; cache stores CPU operation queues; cache-required operations wait for cache fill at their DAG step; cache UI reports committed cache as Buffer plus Ready, where Buffer is only issue work that outruns cache write speed and Ready includes cache load/ready residency; cache capacity upgrade costs are weighted toward data over credits while cache speed uses the CPU tier frequency/cost ladder with per-core pricing, RAM new-stick costs use CPU-style tier credit costs with CPU-package-style per-stick doubling, RAM frequency costs use CPU-style tier credit costs, RAM frequency values use the same CPU/cache tier clock ladder, and RAM capacity costs multiply the CPU-style tier cost by stick size growth within that tier; CPU scheduler backlog and multicore provisioning width come from purchased per-CPU CPU Queue Slot upgrades instead of infinite default slots; system tasks are admitted by separate System Queue Slot upgrades on the visible System Scheduler as parent entries, then reserve CPU scheduler slots for real CPU-bound child entries before cores can execute them, including while target CPU cores are currently busy, CPU hardware cannot currently start the child, or CPU-local cache policy is holding execution; scheduler-dispatched tasks stay in their scheduler queue and keep their slot occupied until completion, with queue-entry metadata tracking parent/child CPU work, composition stage, and chunk work-unit index; cache/RAM total fit gates impossible tasks, while cache/RAM deadlocks happen only when active staging would write beyond capacity, halting the affected CPU package for cache or the whole system for RAM until the player cancels work or adds capacity; unresolved deadlocks build 10 seconds of pressure, clear early into a nonblocking cooldown, and only wipe active processes plus lock starts when the full timer is reached; only the None scheduler policy ignores deadlock lookahead, System Scheduler FIFO/None routing feeds the least-filled eligible CPU scheduler in stable CPU order on the selected system, Least queued and Most headroom route by queued runtime and cache headroom while non-None policies wait for RAM-safe admission, FIFO/Shortest task/Smallest memory CPU schedulers use active footprint lookahead to skip dispatches that can eventually exhaust CPU-local cache or CPU-owned RAM, CPU cache safety and CPU hardware fit for system work stay with the target CPU scheduler, and Shortest task/Smallest memory can reorder scheduler-owned queue entries, Scheduler Watchdog can preview its auto-kill victim, target core, and countdown before killing scheduler-owned deadlocks after 3 seconds, and Deadlock Cooldown upgrades drain post-deadlock pressure faster; newly researched RAM, CPU scheduler, System Scheduler, and CRON hardware render as paid outline bays until the first module is purchased; RAM stages larger active/intermediate work as the next memory tier after cache, exposes CPU-bound RAM read/write/overwrite page tasks after RAM Control, shows fixed-address block loading before CPU execution, starts only after buying the first 256 b 1 Hz RAM Stick after RAM Control, buys new base sticks, lets selected sticks or all sticks upgrade capacity and frequency independently without summing stick speeds into a total RAM frequency, unlocks RAM tiers through CPU tier research, services one stick per RAM channel at a time, can stripe System Scheduler writes across researched 2/4/8-channel RAM while later stick groups wait behind the lowest pending group and unused later sticks reserve before larger earlier-stick spare capacity, sits above the CPU package, and gates System Scheduler at 1 Kb; Memory Voltage Modifier reduces idle RAM draw without changing active write bandwidth; cache, CPU scheduler slots, and cores are CPU-local; CPU purchases on existing systems install a level-1 one-core package matching that system's CPU tier with projected power increase, copied-package install semantics are hidden, CPU Package Level upgrades tune all cores in the package with per-core level pricing, and Add Core includes the selected CPU package tier's level-1 core cost plus current CPU level and cache-frequency backfill costs; reversible hardware specs use +/- controls and refund half of the last purchase cost when downgraded.
- CRON target: CRON v1 automates only visible repeatable system tasks after the first CRON Job Slot is bought, starts with a 60s minimum interval, supports seconds/minutes modes, uses increasingly expensive `cronInterval` upgrades to lower the minimum by 1 second each, skips duplicate/blocked/full/off-state runs, never catches up missed runs, and adds a power spike when it queues work.
- Power target: tasks do not require power directly; PSU is visible from the first screen; active CPU draw is `clock / efficiency`, idle draw uses the C-State multiplier after C-State unlock, starter draw is 0.1 uW, billing is 1 credit/sec per 1 uW, and starter PSU capacity is 10 uW with `10 uW * 1.7^(level - 1)` progression; positive-credit idle time drains money; power billing clamps credits at 0, shows a 10-second unpaid-credit cutoff warning, and emergency-shuts down if the warning expires, with a first-time explanation and quick repeat popup after cutoff; startup from 0 credits grants a short no-bill bootstrap window before the same unpaid-credit warning if no credits are earned; cheap credits-only PSU wattage upgrades are purchasable from the start, and capacity is a reliability/stress system with throttle plus a 10-second overload failure that fills faster above 100% load, flashes the full PSU red with a larger centered header progress meter, hard-powers off, shows a short first-time failure popup, uses a red topbar badge for repeat trips, and clears active/queued work; `off` greys hardware but keeps hardware edits plus power/start controls available while blocking work/CRON and billing zero; graceful shutdown blocks new work while current work drains; startup/shutdown have delays; and RAM/CPU package matching should reward efficient builds.
- Historical cooling target: Thermal UI, Thermal Control research, Thermal Probe, and active cooling tradeoffs were deferred at that checkpoint and are now implemented in Workshop.
- Research target: new task groups and hardware categories unlock through research cards; benchmark-style compute is launched from research cards, each card lists the research/task/hardware/compute requirements blocking it, and task/research rows keep needed operations/resources plus payouts visible even when blocked.
- Scheduler naming target: CPU Operation Scheduler first, then system, cluster, regional, and later global/planetary layers.
- Broad auto-repeat is deferred until much later automation work; CRON v1 is the scoped early timer for repeatable system tasks.
- New CRON, CPU tier research, C-State, power-state, first-screen PSU Capacity, PSU overload failure, and deferred Thermal/PSU research gates are covered by automated verification in this implementation slice.
- Save/load hardening now sanitizes stale pre-live task references from completed counts, active tasks, queue entries, CRON schedules, benchmark completions, autorepeat targets, optional UI preference reads, and current runtime state before selectors or ticks can read them.
- Previous breaking save reset: browser persistence used `save-v2` for the bit-scale pre-live schema.
- CPU tier clean save reset: browser persistence now writes true save version 3, and incompatible v2 saves reset to a clean v3 initial state because per-core clock and copied CPU package state are no longer compatible.
- RAM block/channel clean save reset: browser persistence now writes true save version 4, and incompatible v3 saves reset to a clean v4 initial state because the old RAM residency stream is not compatible with fixed stick addresses, channel striping, or Memory Voltage Modifier levels.
- CPU child queue clean save reset: browser persistence now writes true save version 6, and incompatible v5-or-older saves reset to a clean v6 initial state because System Scheduler parent entries and CPU scheduler child entries now have different queue-entry shapes.
- System-to-CPU child scheduling completed May 25, 2026: System Scheduler queue slots now hold parent system entries, CPU scheduler queues hold CPU-bound child entries, CPU scheduler grids label child work with parent context, parent rewards pay once after all child stages or chunk work units finish, and parent cancellation removes queued/active child work.
- RAM tier/cost correction completed May 23, 2026: `C:\Users\Borg\Downloads\ram_game_spec_sheet.csv` now uses CPU-style tier base costs, RAM capacity costs of `base cost * 2^(level - 1)`, per-level doubled capacity, 1024x tier jumps, CPU-research tier unlock metadata, and iterative 1.8x Memory Voltage costs. `npx vitest run src/game/simulation.test.ts`, `npm test`, `npm run typecheck`, and `npm run build` passed; browser smoke at `http://127.0.0.1:6173/?seed=rack-ready` loaded IdleBit with RAM visible and no warnings/errors; targeted RAM/doc `git diff --check` passed, while full `git diff --check` remains blocked by the unrelated pre-existing blank EOF in `src/ui/rack/types.ts`.
- CPU core tier correction completed May 23, 2026: Add Core now includes the selected CPU package tier's level-1 cost before current level and cache-frequency backfill costs, so higher-tier packages cannot add old-tier cheap cores.
- System Scheduler RAM intake correction completed May 24, 2026: queued system tasks now wait for enough free RAM footprint before dispatching, preventing multiple system tasks from stalling in RAM loading by creating avoidable whole-system RAM deadlocks. Focused RAM scheduler coverage, `npm test`, `npm run typecheck`, `npm run build`, and scoped `git diff --check` passed; full `git diff --check` remains blocked by the unrelated pre-existing blank EOF in `src/ui/rack/types.ts`.
- Verification completed May 23, 2026: generated `C:\Users\Borg\Downloads\ram_game_spec_sheet.csv` and `C:\Users\Borg\Downloads\ram-overhaul-plan.md`; CSV validation parsed all 6 RAM tier blocks with 36 levels each; `npx vitest run src/game/simulation.test.ts`, `npm test`, `npm run typecheck`, and `npm run build` passed. Browser smoke at `http://127.0.0.1:6175/?seed=rack-ready` opened the RAM panel with channel/write labels and no console warnings/errors. RAM-scope `git diff --check` passed; full `git diff --check` is still blocked by an unrelated pre-existing blank EOF in `src/ui/rack/types.ts`.
- Verification completed May 19, 2026: `npm test` passed with 137 tests for the Multi-System Rack Phase, including clean pre-v2 save reset, preconfigured and custom system purchase, one visible rack slot per owned system, selected-system upgrade routing, selected-system Compile Code boundaries, and rack/custom-builder UI coverage. `npm run typecheck`, `npm run build`, and `git diff --check` were also part of final verification.
- Verification completed May 20, 2026: `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed for paid first-module installs on newly researched RAM, CPU scheduler, System Scheduler, and CRON hardware. Browser smoke at `http://127.0.0.1:6174/?seed=rack-ready` loaded without console errors.
- Verification completed May 20, 2026: React refactor and Storybook checks passed with `npm test` (147 tests across 11 files), `npm run typecheck`, strict TypeScript cleanup flags in project configs, `npm run build`, `npm run storybook:build`, `npm audit --audit-level=high`, `npm audit --omit=dev`, `git diff --check`, and browser smoke at `http://127.0.0.1:6173/?seed=rack-ready`. `HardwareBoard.tsx` is now a 186-line system/rack assembly shell, rack rows/bays and task cards/routes were split into focused components, CSS was reorganized into domain manifests plus focused partials, the former monolithic UI test file was split by behavior, Storybook stories use direct imports/static fixtures with docgen disabled to avoid oversized app-story chunks, Vitest was upgraded to 4.1.6, and Tailwind was intentionally not introduced because this pass preserves existing selector-driven visual behavior. Storybook build still reports Vite's large-chunk warning for the Storybook iframe runtime only.
- The reference PNGs guide visual tone, not mechanics.
- UI copy should be short and useful.
- Verification completed May 21, 2026: `npm test -- src/game/simulation.test.ts`, `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed after lowering PSU Capacity cost from `130 * 1.9^level` to `24 * 1.42^level`.
- Verification completed May 21, 2026: `npm test -- src/game/simulation.test.ts`, `npm test`, `npm run typecheck`, `npm run build`, `git diff --check`, and browser smoke at `http://127.0.0.1:6174/?seed=rack-ready` passed for credits-only cache speed and RAM frequency costs while cache/RAM capacity costs still show data.
- Verification completed May 22, 2026: `npm test` passed with 160 tests, `npm run typecheck`, `npm run build`, and `git diff --check` passed for the CPU tier research and power rework. Browser smoke at `http://127.0.0.1:6176/?smoke=cpu-tier` verified the first screen renders Fetch Bit/Decode Bit, completing Fetch Bit reveals Decode Logic, and the console has no errors after restarting Vite with `--force`; the later 10 uW starter PSU verification below supersedes the original PSU capacity readout from that pass.
- Dev rack seed now accepts `?seed=trillion` as an alias for `?seed=rack-ready` and starts with 100 quintillion credits for high-tier build testing.
- Seed schema refresh completed May 24, 2026: rack-ready/trillion seeds now build current save-v6 CPU packages, RAM sticks, PSU capacity, disabled empty CRON slots, and unlocked CPU/RAM tiers through the current constructors; seed coverage round-trips through `serializeSave`/`deserializeSave` to catch stale schema fields.
- Preconfigured system prices and purchase deductions still share the same machine-selection cost helper for later template work, while the current custom builder opens directly into a system-board view and shows selected build power need against selected PSU capacity with a met/short summary chip.
- Verification completed May 22, 2026: `npx vitest run src/game/simulation.test.ts src/ui/HardwareBoard.power.test.tsx src/ui/HardwareBoard.rack.test.tsx -t "PSU|power|micro-watt|starter|tiered custom builder"`, `npm test`, `npm run typecheck`, `npm run build`, and targeted `git diff --check` passed after raising starter PSU capacity to 10 uW. Browser smoke at `http://127.0.0.1:6178/` verified the first-screen PSU reads `0.1 uW / 10 uW`, `0.1 cr/s`, and `1% load` without console errors.
- Verification completed May 22, 2026: `npx vitest run src/game/simulation.test.ts src/ui/HardwareBoard.power.test.tsx -t "unpaid|credit shutdown|power billing|bootstrap grace|PSU"`, `npm test`, `npm run typecheck`, and `npm run build` passed after adding the 10-second unpaid-credit cutoff warning. Coverage verifies the countdown starts when billing reaches 0 credits, stays powered for the warning window, shuts down after the warning expires, clears when active work earns credits, starts after expired 0-credit bootstrap grace, and renders the PSU warning state. Browser smoke at `http://127.0.0.1:6179/` verified the first-screen PSU renders without console errors.
- Verification completed May 22, 2026: `npx vitest run src/game/simulation.test.ts -t "kHz CPU|CPU tiers|CRON scheduler"`, `npm test`, `npm run typecheck`, `npm run build`, and targeted `git diff --check` passed after moving kHz CPU Research to the System Automation stage and making each completed CPU tier research reveal the next tier research.
- Verification completed May 18, 2026, and superseded by later scheduler-policy checks: `npm test`, `npm run typecheck`, and `npm run build` passed for this bit-scale/reveal/DAG/deadlock slice, including CPU-issued cache writes, CPU-faster-than-cache Buffer buildup, equal-rate cache Ready behavior, counted cache-fill timing, paid cache/RAM load operation totals, per-core derived task resource needs, distinct read/write cache residency, overwrite cache reuse, per-operation cache staging, finite CPU scheduler queue slots, separate System Scheduler queue slots, system scheduler intake for whole system tasks, dispatch-time CPU scheduler reservation for system task CPU work even while CPU cores are busy or CPU-local cache policy is blocking execution, lower-level CPU scheduler wait reasons bubbling up to System Scheduler slots, active scheduler queue reservations until completion, scheduler width gating for multicore tasks, CPU-local cache/scheduler gates, no cross-CPU core splitting for multicore tasks, RAM Control and 1 Kb System Scheduler gates, mixed-size/mixed-frequency RAM sticks with per-stick and all-stick upgrades, data-weighted cache/RAM capacity costs plus credits-only cache/RAM frequency costs, reversible hardware downgrade refunds and capacity blockers, RAM loading progress before CPU execution, cache deadlocks with CPU-local halt behavior, System Scheduler RAM footprint waiting, 10-second deadlock failure and cooldown lockout behavior, Deadlock Cooldown upgrade drain rate, None-policy unsafe dispatch and System Scheduler RAM-footprint intake gating, watchdog auto-kill victim/core/countdown display, scheduler policy controls, completed-task cache release, cached DAG-derived totals, research-card compute benchmarks, scheduler research unlock gates, compact task route controls, adaptive scheduler slot grids, duplicate scheduled-copy status display, deadlocked hardware/help UI, post-failure greyed lockout hardware, wide high-contrast deadlock countdown header bars, CPU package reveal, fixed-step core-grid layouts through eight-column width, dense cache/scheduler pairing, RAM above CPU and System Scheduler above RAM, always-visible task/research requirement and payout summaries, blocked action-button reasons, Buffer/Ready cache and RAM state visuals, unlit unaffordable cost tokens, and shared resource tokens. Browser smoke evidence is recorded in `docs/qa-notes.md`.
- Verification completed May 19, 2026: `npm test -- src/ui/HardwareBoard.test.tsx`, `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed for listing multi-core requirements above one core on task cards and research compute rows while leaving single-core task cards unlabeled.
- Verification completed May 19, 2026: `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check` passed for the earlier CPU socket power-delta pass, credits-only first-screen PSU Capacity, compact PSU readouts, compact header power controls, larger centered PSU overload header progress, full-card red PSU over-power flashing, first-time short PSU failure popup with repeat-failure topbar badge, first-time/repeat out-of-credits popups, removed headroom/efficiency row, and the 10-second PSU overload failure pressure. CPU socket copy choices are superseded by researched tier level-1 installs.
