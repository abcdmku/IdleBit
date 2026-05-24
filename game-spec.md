# IdleBit

## 1. Product Summary

IdleBit is an incremental systems-building game where the player starts with a primitive single-core CPU and eventually scales into server racks, data centers, availability zones, regions, and planetary compute.

The core gameplay loop remains consistent at every scale:

**Accept jobs → process work → earn credits/data → buy upgrades → unlock larger jobs and larger infrastructure.**

Player-facing jobs are implemented as **tasks**. A task is composed from lower-level operations such as CPU operations, cache fills, RAM staging, and later storage/network transfer. The UI can keep short job labels, but the simulation should reason about the operation queues that make each task run.

The first minutes are deliberately bit-scale. The player should start by flipping bits and copying tiny values before the game reveals byte-scale work, research, multicore scheduling, RAM staging, PSU stress, and cooling. Each new concept should feel discovered from the previous bottleneck rather than dumped into the first screen.

The game starts with only two concepts: **clock speed** and **cache**. Complexity is introduced gradually. As the player progresses, lower-tier management is automated or abstracted so the player always focuses on the newest scale of compute.

The game should feel like the player is repeatedly solving the same class of problem at larger scales:

- A CPU can be overstrained by clock, heat, and power.
- A system can be overstrained by CPU, RAM, power supply, and cooling.
- A rack can be overstrained by server density, power, heat, and network bandwidth.
- A data center can be overstrained by facility power, cooling, uplink, and workload demand.
- An availability zone or region can be overstrained by latency, coverage, replication, and SLA requirements.

Reliability is not a standalone abstract stat. Uptime comes from whether the player has built enough power, cooling, spare capacity, redundancy, geographic coverage, and routing capability to satisfy job requirements.

---

## 2. Design Pillars

### 2.1 Start Minimal

The game begins with 10 credits, one core, clock speed, cache, and tiny jobs. RAM, heat, cores, sockets, scheduling, cooling, networking, and infrastructure are hidden until they matter, while basic PSU readouts are visible from the first screen.

The first player lesson is:

**More clock speed makes jobs finish faster. Cache makes certain jobs more efficient.**

In the current target, cache is not only a percent modifier. Cache holds CPU operation queues. Tasks with cache-required operations wait for the needed cache fill before those operations can execute.

### 2.2 Add One Major Concept at a Time

Each new layer should introduce either:

1. More throughput.
2. A new constraint.
3. A way to reduce micromanagement.

Examples:

| Unlock | Function |
|---|---|
| Clock speed | Adds throughput |
| Cache | Adds efficiency |
| Cores | Adds parallel throughput |
| Scheduler | Reduces job-assignment micromanagement |
| Second CPU | Expands into system-level building |
| RAM | Adds job size and queue constraints |
| Power supply | Adds system strain and throttling |
| Cooling | Solves heat/overclocking constraints |
| Expansion slots | Adds specialization |
| Networking | Connects multiple systems |
| Racks | Abstracts many servers |
| Data centers | Scales power/cooling/network constraints |
| SLA jobs | Adds uptime constraints |
| Availability zones | Adds coverage, latency, and redundancy constraints |
| Regions | Adds geography and global routing |

### 2.3 Preserve Familiar Mechanics Across Scales

The player should recognize the same logic as they scale:

| CPU/System Scale | Data Center Scale |
|---|---|
| Clock speed | Total compute throughput |
| Cache | Edge/cache efficiency, workload locality |
| Cores | Servers / compute nodes |
| RAM | Memory pools / workload capacity |
| Power supply | Data center power feed |
| Cooling | Facility cooling |
| Heat throttling | Facility thermal throttling |
| Scheduler | Cluster/data center scheduler |
| Overclocking | Overcommitting infrastructure |
| Job queue | Workload queue / contracts |
| Hardware templates | Server/rack templates |

The game should avoid inventing disconnected late-game systems. Data centers should feel like CPUs at building scale.

### 2.4 Automate Lower Layers Over Time

The player should not manually manage early-game objects forever.

| Player Unlocks | Previous Layer Should Become Easier Through |
|---|---|
| Basic queue | Manual per-core assignment |
| Multiple cores | Auto-fill idle cores |
| CPU Operation Scheduler | Core operation policies and cache queue feeding |
| Second CPU | Preconfigured CPU packages |
| Full system building | System templates |
| Multiple systems | Prebuilt machines |
| Networking | Shared queues |
| Racks | Rack templates |
| Data centers | Procurement policies |
| Availability zones | Failover/routing policies |
| Regions | Global scheduler policies |

The player should always manage the newest interesting layer, not every layer at once.

Broad auto-repeat stays tightly scoped. Early automation should teach scheduling and queues before hiding task choice. The first timer automation is CRON v1 at the second-CPU/system stage: it repeats only visible repeatable system tasks after CRON Scheduler research, never hidden tasks, research benchmarks, or normal CPU task progression.

---

## 3. Core Resources

### 3.1 Credits

Credits are the primary spendable currency.

Earned from:

- Completing jobs.
- Completing contracts.
- Meeting SLA requirements.
- Serving low-latency or high-coverage workloads.

Spent on:

- CPU upgrades.
- Core purchases.
- Power supply.
- Cooling.
- Expansion cards.
- Systems.
- Servers.
- Racks.
- Data center capacity.
- Availability zones.
- Regions.

### 3.2 Data

Data is the progression and unlock currency.

Earned from:

- Benchmark jobs.
- Research jobs.
- First-time job completions.
- Higher-tier contracts.
- Specialized workloads.

Spent on:

- Architecture unlocks.
- Scheduler unlocks.
- New job families.
- Cache capacity and cache speed tuning.
- RAM capacity and RAM speed tuning.
- Automation systems.
- Cluster features.
- Data center management tools.
- Availability zone and region unlocks.

Cache capacity upgrades can still include a small credit installation cost, but their primary cost should be data. Cache speed tuning uses the same CPU tier frequency values and target-level per-core credit costs as CPU package levels. RAM new-stick and frequency tuning use CPU-style tier credit costs; RAM capacity tuning multiplies that CPU-style cost by `2^(level - 1)` within the tier so larger sticks are materially more expensive. RAM capacity doubles each level, and completing CPU tier research opens the matching RAM tier at 1024x the previous tier's same level. Broader CPU, power, and facility purchases can stay more credit-heavy.

Hardware upgrades should be reversible where doing so supports CPU/system matching or efficiency tuning. Downgrading returns 50% of the last purchased level's credit/data cost, rounded down per resource. Capacity downgrades are blocked when active work, queued scheduler entries, cache/RAM reservations, or an occupied removable core would no longer fit. The control surface should present each reversible spec as one compact +/- control: the minus side removes a level, the plus side buys the next level, and unaffordable credit/data costs appear unlit instead of disabling the whole spec row. CPU Package Level tuning is package-wide: buying a level charges the target CPU tier level cost for each installed core, and adding a core to an upgraded package costs the base core plus the cumulative CPU level and cache-frequency costs needed to match the package. The Cores-header all selection is an upgrade-only selection, not a task provisioning route; it shows the combined next-level cost or downgrade refund and applies the package level step to every core in the selected CPU.

### 3.3 Compute

Compute is the ability to process cycles or work units.

At CPU scale, compute comes from:

- Clock speed.
- Cores.
- Cache efficiency.
- Instruction sets.

At infrastructure scale, compute comes from:

- Servers.
- Racks.
- Cluster scheduling.
- Specialized accelerators.
- Data center capacity.

### 3.4 Capacity

Capacity determines whether jobs can be accepted or held in queue.

At CPU scale, cache capacity determines how much of the CPU operation queue is committed. Ready cache is data already written into cache; Buffer is only the issued cache work that is arriving faster than cache load speed can absorb it. A cache-required task waits while its required operation queue fills.

At system scale, RAM stages larger active work and intermediate results. RAM decides which larger tasks can be active at all, how much intermediate work can be retained, and how quickly memory-heavy operations can move between CPU, RAM, and later storage. Active RAM writes own fixed address blocks on specific sticks instead of appending to an abstract ever-growing progress lane.

Cache is the first active staging tier, and RAM is the next tier in the same memory hierarchy. Task starts and FIFO scheduler pulls require total installed cache/RAM fit, but competing CPU-local cache work may begin staging even when combined cache footprint will eventually exceed free capacity. System Scheduler RAM intake always waits for enough free RAM footprint before dispatching another system task, so queued system work does not create a whole-system RAM loading deadlock. A deadlock is created only when active cache/RAM loading would write more staged bits than the hardware can hold. Deadlocked cache halts every active process on that CPU package until resolved; deadlocked RAM halts every active process in the system until resolved. Deadlock pressure counts up to 10 seconds while a deadlock is unresolved. If the player clears the deadlock before 10 seconds, the pressure cools down while work continues. If pressure reaches 10 seconds, all active processes are lost and new work stays locked out until pressure drains back to 0. Deadlock-safe CPU scheduler policy uses active-work footprint lookahead for CPU-local cache and CPU-owned RAM. System Scheduler dispatch always gates whole-task intake on RAM; CPU-local cache safety remains the responsibility of the selected CPU scheduler. FIFO can still dispatch CPU-cache work into deadlock. System Scheduler intake can reserve CPU scheduler work when the target CPU has scheduler-slot capacity even if all of that CPU's cores are currently busy or its CPU scheduler policy is waiting on CPU-local cache; execution starts when the CPU scheduler can pick it up. Scheduler unlocks do not grant infinite backlog capacity or infinite multicore provisioning width by default.

Cache load speed, RAM load speed, and storage load speed are explicit upgrade paths. Capacity answers "how much can be staged"; load speed answers "how quickly staged work becomes executable." Cache capacity upgrades should cost more data than credits, cache speed follows the CPU tier frequency/cost ladder with per-core pricing, RAM new-stick and frequency upgrades use CPU-style tier credit costs, and RAM capacity upgrades use `cpuTierCost * 2^(level - 1)` to price the doubled stick size. RAM load speed uses the same bit-scale start as CPU throughput: RAM begins as one 256 b stick at a 1 Hz load rate when RAM Control is researched, capacity doubles each RAM level, each new RAM tier is 1024x the previous tier at the same level, and CPU tier research unlocks the matching RAM tier. Installing the first RAM stick on an empty system must present the unlocked RAM tiers as explicit choices rather than automatically buying the highest unlocked tier. After a system owns RAM, new stick installs must match the existing RAM tier and must not show alternate tier choices; CPU and RAM package tier changes happen only at install time, not through later upgrades. RAM sticks can mix capacity and frequency; stick frequencies are not added into a total RAM speed, and each module reports and loads at its own frequency. Single-channel RAM allocations fill lower-numbered sticks first and spill to later sticks when the active footprint needs more capacity, but only one stick is actively written on that channel at a time; spilled blocks on other sticks stay staged until the channel advances to them. Concurrent writes to different blocks on the serviced stick/channel share that channel lane. Aggregate RAM write speed is capped by both the sum of writer-core Hz writing to the serviced lane and that RAM lane Hz, so two 20 Hz cores writing to a 60 Hz RAM lane write 40 b/s, not 60 b/s. System Scheduler-owned tasks can stripe writes across 2, 4, or 8 serviced channel lanes only after Dual, Quad, or Oct Channel RAM research; larger allocations can continue onto later sticks through those same lanes, but each lane still services one stick at a time. Effective write bandwidth is the current applied write rate after both CPU-writer and RAM-lane caps, so four 1 kHz writer cores into quad 1 kHz channels can write 4 Kb/s. The RAM surface should show a selectable stick array with an All target for applying capacity or frequency upgrades across installed sticks, fixed per-stick address bars with reusable block locations, Stage/Load/Ready state per block, active channel count, write bandwidth, per-stick frequency, and blocked channel reasons.

At data center scale, capacity includes:

- Available compute headroom.
- Available memory.
- Available power headroom.
- Available cooling headroom.
- Available network headroom.

### 3.5 Power

Tasks do not require power directly. Power draw comes from the hardware doing the work: active cores, dense CPUs, memory, storage, accelerators, cooling, and network gear.

At system scale:

- The PSU is a system reliability component, not a per-task requirement.
- The PSU is visible from the first screen so power is part of the opening earn-vs-idle balance.
- Basic PSU wattage upgrades are cheap and purchasable with credits from the first screen so the player can buy headroom before deeper management research.
- Power billing is paid over time from actual draw. There is no free threshold; even tiny powered-on systems accrue a small bill once the player has credits.
- CPU draw is micro-watt based: active core draw is `clockHz / efficiency / 1_000_000` W, idle cores use the same draw until C-State Control is researched, and purchased C-State levels multiply idle draw down from there.
- RAM draw is micro-watt based: each stick's active write draw is about `clockHz / efficiency * 0.1`, so memory remains roughly one tenth of equivalent CPU draw at the same clock. Memory Voltage Modifier levels reduce idle RAM draw only and do not change active write bandwidth.
- The starter PSU capacity is `10 uW`; power billing is `1 credit/sec` per `1 uW`, so the starter `0.1 uW` draw bills `0.1 cr/s`.
- PSU capacity progression is `10 uW * 1.7^(level - 1)`. The existing credits-only PSU upgrade cost curve stays in place until a PSU sheet replaces it.
- If power billing reaches 0 credits, the PSU shows a 10-second unpaid-credit cutoff warning instead of allowing negative credits. If the warning expires before credits are earned or the system finishes shutting down, the system performs an emergency shutdown. The first shutdown shows an explanatory popup; later shutdowns show a quick popup.
- Powering on from 0 credits grants a short bootstrap grace window with no billing, enough to run starter work and recover.
- If hardware draw approaches PSU capacity, stress increases and efficiency drops.
- If hardware draw exceeds PSU capacity, overload failure pressure begins filling in the PSU header while the whole PSU module flashes red. It reaches failure in about 10 seconds just above 100% load and fills faster the farther draw exceeds capacity; the failure instantly cuts power, shows a short explanatory popup the first time, uses a red topbar badge for later trips, and clears active/queued work.
- Dense cores and additional CPUs increase draw nonlinearly. Packing more compute into one system should be powerful but harder to cool and power reliably.
- A system has four power states: `on`, `shuttingDown`, `off`, and `booting`.
- `off` systems grey out hardware except power/start controls, block work starts, scheduler dispatch, CRON runs, and power billing.
- Startup and shutdown use short delays so power state changes are deliberate and visible; graceful shutdown blocks new work but lets in-progress work finish before power drops. The transition callout lives on the PSU before the system layer unlocks, then moves to the System Scheduler card.
- RAM and CPU package efficiency should reward matching module sizes/frequencies and CPU package specs. Mismatches increase effective draw and reliability pressure.
- Cooling is a tradeoff: stronger active cooling can reduce thermal waste and improve sustained throughput, but it adds its own draw and billing while the system is on.

At rack scale:

- If rack draw exceeds rack power distribution, servers throttle.

At data center scale:

- If facility draw approaches or exceeds power input, data center throughput and uptime degrade.

Power should be one of the main sources of reliability risk. Uptime is not a flat stat; uptime emerges from whether the player leaves enough PSU, rack, and facility headroom to handle active workloads without stress spikes, throttling, or later SLA misses.

### 3.6 Heat and Cooling

Heat is generated by active compute and excess power draw.

Cooling determines how much sustained workload the infrastructure can support before throttling. Better cooling also improves efficiency and reliability by reducing thermal stress, lowering wasted power, and reducing SLA risk.

At CPU scale:

- High heat reduces effective clock.

At rack/data center scale:

- High thermal load reduces server efficiency, increases operating cost, and can cause SLA misses.

### 3.7 Operating Cost

Operating cost is a recurring cost that represents maintenance, staff, automation systems, monitoring, facilities, and baseline administration.

Maintenance staff and automation should not be separate micromanaged systems unless a later expansion explicitly adds them. They are included in operating cost.

Operating cost should increase with:

- Number of systems.
- Number of servers.
- Number of racks.
- Data center size.
- SLA tier being served.
- Geographic spread.
- Redundancy level.
- Cooling intensity.
- Power draw.

Operating cost should be a balancing pressure against brute-force scaling.

---

## 4. Core Processing Model

### 4.1 Task Requirements

Each player-facing job is a task. Each task expands into low-level operations that are scheduled and staged through cache, RAM, and later storage.

Each task can define:

| Field | Meaning |
|---|---|
| Required CPU operations | Amount of CPU/compute work needed |
| Required memory | RAM or memory capacity needed for active/intermediate work |
| Cache operation queue | CPU operations that must be loaded into cache before execution |
| Cache fill size | How much cache capacity must be available before cache-required operations can run |
| RAM staging size | How much active/intermediate work must be staged in RAM |
| Storage staging size | Later requirement for large inactive or bulk data work |
| Memory intensity | How much RAM load speed/bandwidth matters |
| Parallelizable | Whether the job can be split across cores/systems |
| Hardware stress | Derived from the active hardware executing the task, not a direct task requirement |
| Reward credits | Main payout |
| Reward data | Progression payout |
| SLA requirement | Optional uptime target |
| Latency requirement | Optional max latency target |
| Coverage requirement | Optional geographic/service coverage target |

Early tasks should only expose CPU operations, reward, and eventually cache needs. Later tasks expose memory staging, parallelization, storage staging, SLA, latency, and coverage. Task and research compute rows should keep the operation count, multi-core requirement when above one core, resource/staging needs, and payout visible even when the action is blocked; the disabled action button should carry the current blocker, such as "Cache capacity too low." The task list should stay a stable catalog: do not add live state labels or recolor a task card just because that task is active. The task panel header should expose a compact route-layer selector instead of an Auto route: `C` targets a specific core from a dropdown, `CPU` targets a CPU-local scheduler from a CPU dropdown, and `Sys` targets the System Scheduler when unlocked. Later system, rack, cluster, and region routing should extend this same layer-plus-target pattern instead of adding one button per destination. Assigning a task uses the selected route without adding routing text to each task card. Power is never exposed as a task requirement; it is reflected through PSU/system stress while hardware runs the operations.

### 4.2 Operation Queue Pipeline

The operation pipeline is:

1. The player accepts a task.
2. The task expands into low-level operations.
3. Cache-required CPU operations wait for cache fill.
4. RAM stages larger active work and intermediate results.
5. Storage later stages large inactive inputs/outputs before they can move into RAM/cache.
6. The scheduler assigns ready operations to cores or later systems.
7. Completion pays credits/data once the task's required CPU, cache-load, and RAM-load operations finish.

Cache stores CPU operation queues. If the next operation requires cache and the cache queue is empty or incomplete, the task waits for cache load instead of running with a simple speed penalty.

Players should be able to cancel active tasks and pending queued tasks. Canceling active work releases its cache/RAM reservations and any scheduler queue reservation without paying completion rewards. Canceling pending queued work removes only an unstarted queue entry, so an already active scheduler-dispatched copy of the same task keeps its reservation until it completes or is canceled directly.

### 4.3 Inferred Task Composition DAG

Tasks should be authored and surfaced as concise player goals, but the simulation should infer a small directed acyclic graph of internal work from each task definition. The graph is not player-authored; it is derived from task requirements so future UI can explain why a task is waiting without exposing every operation as a separate job.

Operation nodes may represent counted work, such as "Fetch Bit x3000" or a later streamed data size, without expanding into thousands or billions of child nodes. Task totals, rewards, cache footprint, RAM footprint, and visible operation counts should be derived once from the cached graph definition, then reused by simulation and selectors. The player-facing operation count is the paid work total: CPU execution cycles plus cache load bits plus RAM staging bits.

Task operations should follow a small authoring pattern:

- `memory` operations must declare `read`, `write`, or `overwrite`.
- Read/write/overwrite operations spend CPU cycles while buffering cache writes. If the CPU finishes buffering before cache load completes, that core waits idle on cache before the operation advances.
- Read/write/overwrite operations require cache for the amount of data they touch, so an 8 b byte read or write needs an 8 b cache footprint.
- Task-level cache provisioning sums distinct read and write footprints, so reading 8 b and writing 8 b needs 16 b total; overwrite reuses that footprint and only needs the overwritten size.
- Parallel cache-backed operations provision their per-core footprint across the required cores.
- Cache residency and the cache meter should preserve completed read/write footprints until the task completes, while overwrite updates the existing footprint instead of adding another segment. The cache UI should show fixed-height Buffer and Ready lanes. Load and Ready are the same committed cache lane; total committed cache is Buffer plus Ready.
- Counted memory operations use that total touched cache footprint once for cache fill; operation count affects CPU cycles and rewards, not a second cache-size multiplier.
- Cache load cycles equal touched bits, so cache load rate is readable as bits per second. A 1 b memory operation on a 1 Hz CPU and 1 Hz cache load rate should move straight into Ready with no Buffer buildup.
- RAM load cycles equal staged bits, so loading 256 b into RAM contributes 256 paid operations before the CPU can process that staged work.
- Compute operations may still require cache, but their CPU compute cycles run after their cache load is ready.
- Transform tasks should avoid redundant "copy then write" phases; writing the copied value is the copy.
- Task credit rewards are derived from the paid operation total: CPU cycles plus cache-load work plus RAM-load work. Data rewards can remain hand-authored progression payouts.

Example early DAG shape:

| Node | Depends On | Purpose |
|---|---|---|
| Accept task | None | Reserves the task in the active/queued work list |
| Fill cache queue | Accept task or previous recipe step | Loads cache-required CPU operations at the recipe step that needs them |
| Stage RAM work | Accept task, previous recipe step, or fill cache queue | Holds active/intermediate work at the recipe step that needs it |
| Execute CPU operations | Required staging nodes for that recipe step | Spends core throughput on ready operations |
| Complete task | Execute CPU operations | Pays credits/data and unlock progress |

Early bit-scale tasks may only have accept, execute, and complete nodes. Cache-sensitive tasks add cache fill immediately before the operation or recipe step that needs that cache queue, not only as a single task-wide prelude. Larger tasks add RAM and later storage/network nodes. The graph must remain acyclic so selectors can produce deterministic ready/waiting reasons and the scheduler can safely choose the next executable operation.

Task UI progress should stay at the player-facing task layer: one aggregate meter covers the full recipe, including cache/RAM load and every internal operation, so progress does not restart at each step. CPU core meters represent only CPU execution on that core; cache and RAM loading should appear as runtime state, not as CPU processing progress. The cache module should show active committed cache as `used / total` while leaving unused capacity grey; segment color should map to the core writing that cache data. Buffer shows only the backlog created when CPU issue gets ahead of cache writes, while Ready shows cache bits already written or otherwise resident. Cache load/ready segments grow with committed progress instead of snapping to the full required footprint. RAM segments should show reserved, loading, and ready task staging; CPU execution for RAM-backed work begins only after the required RAM load is ready. Completed tasks release cache and RAM reservations immediately and should not leave a held or resident footprint.

When tasks pay out, credits and data gains should be visible as short reward feedback that travels toward the matching resource total without covering the main controls.

### 4.4 Effective Clock

At CPU scale:

`effective_clock = base_clock × clock_multiplier × thermal_modifier × power_stress_modifier`

Clock speed is the main early-game speed driver. Cache affects whether operations are ready to execute; power affects the clock only through system stress.

### 4.5 Task Time

Base task time:

`base_seconds = required_cpu_operations / effective_clock`

Final task time:

`final_seconds = base_seconds + sum(operation_cache_fill_wait + operation_ram_stage_wait + storage_stage_wait)`

Scheduler quality can reduce wait and routing overhead by keeping ready operations flowing to the right cores or systems.

### 4.6 Cache, RAM, And Storage Staging

Cache should be simple early and deeper later.

Early version:

- If a task has no cache-required operations, it can run directly on available CPU throughput.
- If a task has cache-required operations, each operation waits at its own graph step until its cache fill completes.
- More cache holds larger CPU operation queues.
- Faster cache load speed fills the queue sooner.
- Repeated similar tasks can gain additional cache efficiency after scheduler upgrades.

RAM and storage follow the same family of decisions at larger scales:

- More RAM stages larger active/intermediate work.
- Faster RAM load speed moves work between memory and compute sooner.
- More storage holds larger inactive inputs/outputs.
- Faster storage load speed moves work into RAM sooner.

The old cache modifier model can remain as a temporary balancing approximation during prototype work, but the target behavior is staged operation readiness rather than a pure percent modifier.

### 4.7 Power Stress

At all scales, power should work similarly, but tasks do not directly request power.

`power_stress = active_hardware_draw / safe_power_capacity`

Power cost accrues continuously while the system is powered on:

`power_bill = active_hardware_draw_uW * elapsed_seconds * 1 credit`

CPU draw uses `active_core_uW = clockHz / efficiency`. Idle cores use the active draw until C-State Control is researched, then use the current C-State idle multiplier. PSU readouts show the live rate as `cr/s`.

There is no free wattage threshold. Low early draw should make the first bill forgiving, not free.

Credits cannot go negative from power billing. If the next bill cannot be paid, credits clamp to 0 and the PSU shows a 10-second unpaid-credit cutoff warning while powered work can still finish and recover the balance. Earning any credits clears the warning and normal billing resumes; if the warning expires at 0 credits, the system enters `off`, work stops progressing, billing stops, and the player sees an out-of-credits popup. The first popup explains idle draw and billing; later popups are brief. From 0 credits, startup grants a short no-bill bootstrap grace period; earning any credits exits grace and normal billing resumes. If grace expires while credits are still 0, the same 10-second unpaid-credit cutoff warning starts before shutdown.

System power state controls whether work can run:

| State | Work / CRON | Billing | Notes |
|---|---|---|---|
| `on` | Allowed | Draw-based billing over time unless bootstrap grace is active at 0 credits | Normal running state |
| `shuttingDown` | New starts, scheduler pulls, and CRON blocked; active work continues | Bills until active work drains and the shutdown delay completes | Makes graceful power-off deliberate |
| `off` | Blocked | Zero | Hardware is greyed except power/start controls |
| `booting` | Blocked | Bills during startup delay | Returns to `on` after startup completes |

Booting and shutting-down state should be visible near the player’s current system surface. Before the system layer unlocks, show it on the PSU. After the System Scheduler card exists, show it there instead.

If draw approaches or exceeds available power:

- Overload failure pressure fills once draw exceeds 100% capacity, reaching failure in roughly 10 seconds at the threshold and faster at higher overload.
- PSU failure immediately powers the computer off, shows a short explanatory popup the first time and a red topbar badge after later trips, and clears active plus queued work; the player must reboot.
- Efficiency drops.
- Jobs may slow down.
- Heat increases.
- Restart risk increases at severe stress.
- SLA risk increases for SLA jobs.
- Severe overstrain can pause jobs or cause contract failure later in the game.

### 4.8 Heat Modifier

At all scales, cooling determines how much sustained load the build can handle.

Simple version:

- Heat rises while hardware is active.
- Heat falls based on cooling capacity.
- If heat exceeds safe threshold, throughput is throttled.

At data center scale, heat should represent facility thermal pressure rather than individual CPU temperature.

---

## 5. Progression Roadmap

## Stage 0 — Primitive CPU

### Theme

One tiny CPU doing primitive jobs.

### Player Sees

- One CPU core.
- Clock speed.
- Cache.
- Bit-scale task list.
- Current task state.
- Credits.
- Data.
- PSU draw, capacity, stress, state, and live billing.

### Hidden

- RAM.
- Heat.
- Cooling.
- Scheduler.
- Sockets.
- Expansion slots.
- Networking.

### Starting State

| Stat | Value |
|---|---:|
| Cores | 1 |
| Clock | 1 Hz |
| Cache | 1 b |
| Cache load rate | 1 Hz |
| RAM | Hidden |
| Power | Visible PSU readouts, powered on |
| Cooling | Hidden |
| Scheduler | None |

The opening hardware view should treat cores as the primary visible compute units, not as contents inside a CPU package card. Hardware cards should sit directly in the hardware panel without an additional decorative background card around the whole board. Cache and any CPU-local scheduler controls can sit near the core array, but the CPU package frame itself should remain hidden until RAM/system hardware is unlocked. Once RAM is visible, each CPU package frame should wrap that CPU's scheduler, scalable core array, and cache. CPU cache-deadlock countdowns should appear as prominent progress bars in the Cores header before the CPU package exists, then move to the CPU package header after RAM/system hardware reveals the package. RAM deadlock countdowns belong in the RAM header. The active lock timer fills toward failure; cooldown or post-failure reset drains the same bar back toward 0, and the bar remains visible on the affected hardware header until it reaches 0. The timer text should sit on a high-contrast label inside the wider bar so it stays legible over empty and filled states. Affected hardware is red while actively deadlocked and greyed out only during the post-failure lockout reset, not during a harmless early cooldown. The core array layout must support common high-core CPUs by stepping through fixed row/column layouts: 1x2, 2x2, 2x4, 2x6, 2x8, then 2x12. At the 2x12 layout, cache should sit next to the CPU-local scheduler and the core array should take the full module width. Past that point the grid expands to 2x16, then 3x16, 4x16, 5x16, and later rows while 16 columns remains the maximum width. CPU Package Level tuning replaces per-core clock tuning. CPU packages are bought only at tier level 1, package level upgrades set the clock for every core in that package, and package level cost is multiplied by installed core count. After CPU Operation Scheduler unlock, the Cores header can target the selected CPU package level as one combined +/- control; Add Core remains separate and includes the selected package tier's level-1 core cost plus current package level backfill cost.

Component upgrade controls should stay compact and stable during high-frequency processing. Reversible specs use a single +/- stepper so buy and downgrade actions read as tuning the same hardware spec rather than separate unrelated buttons.

### Tasks

Early tasks should be tiny and direct. The first visible work should be a bit-scale starter pair; byte-scale and cache-sensitive tasks appear only after the player has seen simple CPU operations complete and spent earned resources on research.
Task credit payouts should match the derived paid operation count for the started parent task, including cache and RAM loading work; data rewards can still mark progression milestones.
Tasks can show internal recipe steps, but later tasks should not literally rerun the whole previous visible task chain.
Research is the player-facing unlock surface. New task groups and hardware categories should be unlocked by completing research, not by hidden completion side effects or direct upgrade shortcuts.
The task panel should group available work by mechanical category, starting with CPU-bound work and system work; later distributed work should land in its own group rather than blending into the CPU task list.
On mobile, the Tasks and R&D tabs should show a red new-content notification when newly visible tasks or open research have not been viewed yet; opening that tab marks the currently visible IDs as seen.
Pinned task controls should remain useful for repeatable work: an active pinned task should still expose the selected scheduler route action when another copy can be queued.

| Task | Purpose |
|---|---|
| Fetch Bit | First runnable task; teaches 1 b cache-backed work at 1 Hz |
| Decode Bit | Visible starter goal that needs a 2 b cache footprint |
| Bit Flip | Unlocks with Decode Logic and teaches 2 b mutation-style CPU operations |
| Bit Shift | Unlocks with Decode Logic and introduces 2 b shifted bit work |
| Byte Copy | Reveals with the byte/cache research group; starts after Byte Operations |
| Packet Check | Reveals with the byte/cache research group; starts after Cache Mapping |
| Tiny Checksum | Unlocks after RAM Control and teaches larger RAM/cache staging |

### Repeatable System Tasks

Repeatable system tasks are the only tasks CRON v1 can automate. They are system-stage jobs, not research benchmarks, and they should reveal only when their supporting concept is visible.

| Task | Reveal Timing | Purpose |
|---|---|---|
| Memory Scrub | After first Tiny Checksum | Introduces repeatable RAM maintenance work before automation is unlocked |
| Queue Compaction | After first Tiny Checksum | Repeats scheduler maintenance work that CRON can later automate |
| Power Telemetry | After first Tiny Checksum | Teaches draw observation before PSU controls are researched |
| Bus Mirror | Second CPU purchase | Teaches multi-CPU system work after another CPU joins the board |
| Thermal Probe | Deferred | Reserved for the later Thermal pass |
| Shard Reconcile | Second CPU purchase | Introduces wider repeatable system work for a growing CPU package |

### Research Compute

Some research needs benchmark-style compute before the research can be purchased. These benchmark tasks are internal work items launched from the research card, not lingering normal task cards.

| Research | Compute Work | Notes |
|---|---|---|
| Multi-Core Control | Micro Benchmark, Parallelism Benchmark | The card lists clock/cache prerequisites and runs both benchmarks before the multi-core unlock can be purchased |
| System Bus | Multi-Core Benchmark | The card runs the four-core benchmark before second CPU purchase is unlocked |

### System Research Gates

The second CPU purchase reveals the automation research gate, but system modules should stay hidden until their controls are meaningful.

| Research | Appears After | Unlocks |
|---|---|---|
| CRON Scheduler | Second CPU purchase | CRON v1 timer automation for visible repeatable system tasks |
| PSU Management | Deferred | Advanced PSU tuning when it exposes a new power decision |
| Thermal Control | Deferred | Thermal controls, cooling loop upgrades, and cooling tradeoffs |

### Progressive Task And Research Reveal

| Reveal | Requirement | Notes |
|---|---|---|
| Fetch Bit | New save | First actionable task |
| Decode Bit | New save | Second bit-scale starter task, blocked until 2 b cache |
| Decode Logic research | Starter task resources | Unlocks the paired bit-operation tasks |
| Bit Flip | Decode Logic research | First mutation task |
| Bit Shift | Decode Logic research | First shift task |
| Byte Copy | Decode Logic research, blocked until Byte Operations research | First byte-scale task, modeled as 8 read ops and 8 write ops with a 16 b cache footprint |
| Cache upgrades | New save | Cache capacity upgrades are data-weighted; cache speed upgrades are available immediately and use the CPU tier frequency/cost ladder with per-core pricing |
| Packet Check | Decode Logic research, blocked until Cache Mapping research | First cache-fill waiting task |
| Research panel | First starter completion | Research should not crowd the first screen before the player has earned resources |
| Byte Operations, Cache Mapping, and Benchmark Harness research | Decode Logic research | Reveal together as the byte/cache research group; Cache Mapping still requires Byte Operations plus Byte Copy, and Benchmark Harness still requires Cache Mapping plus Packet Check and clock tuning |
| Multi-Core Control research | Run Micro Benchmark and Parallelism Benchmark from the research card | Gates additional cores |
| RAM Control research | Local Scheduler research | Appears alongside System Scheduler and reveals a paid RAM bay; the first RAM Stick purchase installs 256 b at 1 Hz |
| System Scheduler research | Four cores, RAM Control, and at least 1 Kb RAM | Gates barrier-aware system scheduling |
| CPU tier research | kHz after System Automation; later tiers after previous tier research | Unlocks the next level-1 CPU package tier from kHz through PHz using the CSV research costs, and unlocks the matching RAM tier at the same time |
| C-State Control research | kHz CPU Research | Stays in research as a global `Level up` item after unlock until max C-State level; levels reduce idle CPU draw only across every system |
| Memory Voltage Modifier research | RAM Control and kHz CPU Research | Stays in research as a global `Level up` item after unlock until max level; levels reduce idle RAM draw only, with repeat costs starting at 100,000 credits and multiplying by 1.8 |
| PSU readouts | New save | Shows draw, capacity, load/stress, state, cr/s, and overload failure pressure from the first screen |
| PSU Capacity upgrade | New save | Lets the player buy more PSU wattage with credits from the first screen |
| CRON module | CRON Scheduler research | CRON appears at the top of the system board as a paid CRON Job Slot install after research is bought |
| Memory Scrub, Queue Compaction, and Power Telemetry | After first Tiny Checksum | First repeatable system tasks; runnable manually only while the system is on |
| CRON Scheduler research | Second CPU purchase | Unlocks CRON v1 automation for visible repeatable system tasks only |
| Bus Mirror and Shard Reconcile | Second CPU purchase | Later repeatable system tasks for multi-CPU system management |
| PSU Management research | Deferred | Reserved until it exposes a new power decision |
| Thermal Control research | Deferred | Reserved for the later Thermal pass |
| Broad auto-repeat | Deferred until later scheduler/automation layers | CRON v1 is the scoped early timer; general task auto-repeat stays out of the bit-scale opening |

---

## Stage 1 — Single CPU Optimization

### Theme

The player improves a single-core CPU through clock and cache.

### Main Decisions

- Buy clock speed for broad speed.
- Buy cache capacity with data-heavy costs and cache speed with CPU tier target-level per-core credit costs for operation queue/fill efficiency.
- Choose jobs that match current hardware.

### New Mechanics

- Benchmarks.
- Cache operation queues.
- Cache capacity and cache speed upgrades.
- Cache fill wait for cache-required tasks.

### Design Goal

The player should understand:

- Clock makes everything faster.
- Cache makes certain jobs much faster.
- Benchmarks unlock new capabilities.

---

## Stage 2 — Multi-Core CPU

### Theme

Parallel job processing.

### Unlock Condition

Multi-core CPU unlocks after:

- Benchmark Harness research.
- Several clock/cache upgrades shown as Multi-Core Control requirements.
- Completion of Micro Benchmark and Parallelism Benchmark from the Multi-Core Control research card.
- Purchase of Multi-Core Control research.

### New Mechanics

- Buy additional cores.
- Each core can process one job at a time.
- Multiple small jobs can run in parallel.
- Single large jobs do not automatically become faster.

### Design Rule

Cores should increase throughput, not single-job speed, until later scheduler upgrades allow splitting eligible jobs.

### Important Lesson

Clock helps one job finish faster.

Cores help many jobs run at once.

### Unlocks

| Unlock | Requirement |
|---|---|
| Second core | Multi-Core Control research |
| Basic queue | Own 2 cores and complete Local Scheduler research |
| More cores | Buy core slots / reach CPU tier |
| Scheduler | Own 4 cores, complete RAM Control, install at least 1 Kb RAM, and complete System Scheduler research |

---

## Stage 3 — Scheduler and Four-Core Milestone

### Theme

The player has enough parallelism that manual assignment becomes annoying. The scheduler solves that problem.

### Unlock Condition

RAM Control and System Scheduler appear together after Local Scheduler research. RAM Control reveals an empty RAM bay; buying the first RAM Stick installs one 256 b stick at 1 Hz. The RAM hardware surface should sit above the CPU package; after System Scheduler research completes, the System Scheduler surface should sit above RAM as an empty paid first-slot bay until the player buys a System Queue Slot. System Scheduler unlocks when the player reaches 4 cores, completes RAM Control, and upgrades installed RAM capacity to at least 1 Kb.

Local Scheduler research enables per-CPU queue-slot purchases. The default CPU scheduler backlog is 0 slots; until the first CPU Queue Slot is bought, the CPU scheduler renders as a faded paid install outline with that first slot price. Each CPU Queue Slot upgrade adds one held CPU task. Once the CPU scheduler dispatches a queued CPU task, that task stays in the scheduler queue and keeps its queue slot occupied until the task completes, even if it later deadlocks. The scheduler UI should use one compact header count and a bounded adaptive-height slot grid, not a separate status meter, queue title, redundant progress bar, or large resizing rows, so high-frequency processing updates never reflow neighboring hardware. The slot grid should step through 2x2, 4x2, 4x4, 6x4, 6x6, 8x8, and later square-ish dense layouts as queue-slot capacity grows; the System Scheduler should start at the actual purchased footprint for one and two slots before growing to 2x2. Early low-row grids may be shorter and grow into the dense height so the first slots are readable without becoming giant. At least 24 scheduler slots should fit in the visible grid before the scheduler scrolls internally. Each queued task should list its current waiting, active, or deadlocked reason inside its slot. Duplicate queued copies of the same task must be displayed by queue occurrence, so one copy can show active work while another copy is deadlocked. CPU-bound tasks can be queued directly on a CPU Operation Scheduler. Completing System Scheduler research should reveal a system-level scheduler install outline for whole system tasks. System Queue Slot upgrades are bought on that System Scheduler surface and admit whole system tasks separately from per-CPU queue slots. A system-scheduled task holds its system queue slot until it completes or is canceled; when its CPU-bound portions become executable, the CPU scheduler reserves the chosen CPU's slots and handles whether the task's operations may fan out across multiple cores. Those CPU-local scheduler slots still cap multicore provisioning width: a CPU with 2 purchased CPU Queue Slots cannot dispatch a system task onto 4 cores until its CPU scheduler is upgraded.

Scheduler Watchdog research appears after Local Scheduler and unlocks per-scheduler auto-kill controls plus the kill policy selector. It also reveals Deadlock Cooldown upgrades that increase the post-deadlock pressure drain rate. Auto-kill applies only to scheduler-owned active tasks, waits for 3 seconds of continuous deadlock, shows the selected victim, target core, and countdown while armed, and kills at most one task per scheduler per tick. The System Scheduler watchdog only owns RAM deadlocks; cache deadlocks from system-scheduled CPU work are owned by the affected CPU scheduler watchdog. Scheduling Policy appears after Scheduler Watchdog and unlocks dispatch policy controls: FIFO, Deadlock-safe, Shortest task, and Smallest memory. These policies affect scheduler dispatch order only, not direct core assignment. System Scheduler dispatch always waits for free RAM footprint before admitting another whole system task; CPU cache pressure is evaluated by each CPU scheduler's own policy.

### Scheduler Layers

| Level | Name | Effect |
|---:|---|---|
| 0 | None | Player manually starts tasks |
| 1 | CPU Operation Scheduler | Feeds cache-backed CPU operation queues to idle cores |
| 2 | Scheduler Watchdog | Auto-kills scheduler-owned deadlocks after a delay when enabled |
| 3 | Scheduling Policy | Adds FIFO, Deadlock-safe, Shortest task, and Smallest memory policies |
| 4 | System Scheduler | Coordinates RAM-staged work and eligible multicore dispatch inside one system |
| 5 | Cluster Scheduler | Routes work across networked systems |
| 6 | Regional Scheduler | Routes work across data centers, availability zones, and regions |

The named scheduler path begins with the CPU Operation Scheduler, then moves to System Scheduler for one built machine. Later layers should be named by the scale they coordinate: cluster scheduler, regional scheduler, and eventually global/planetary policy.

### Scheduler Policies

| Policy | Behavior |
|---|---|
| Max Credits | Prioritize highest credit/sec |
| Max Data | Prioritize unlock currency |
| Shortest First | Keeps job flow fast |
| Benchmark Focus | Prioritizes milestone jobs |
| Cache Efficient | Groups similar work |
| Power Safe | Avoids power throttling |
| Thermal Safe | Avoids heat throttling |
| SLA Safe | Later policy for contract uptime |
| Latency Safe | Later policy for regional work |

---

## Stage 4 — Second CPU and Full System Building

### Theme

The player moves from CPU tuning to full computer building.

### Unlock Condition

Second CPU unlocks after:

- Completing System Scheduler research.
- Completing the multi-core benchmark from the System Bus research card.
- Purchasing System Bus research.

### Major Rule

When the player buys another CPU, CRON Scheduler research becomes visible, but the CRON board module stays hidden until that research is bought. Empty sockets install a level-1 CPU package matching the system's existing CPU tier; CPU purchases no longer copy another package's level, cores, cache, cache speed, or scheduler slots. RAM is already introduced by RAM Control before System Scheduler, and PSU stress has been visible since the start; this stage is where repeatable system tasks, power-state strategy, and broader system building become player-facing. Advanced PSU tuning and Thermal are deferred until they create new decisions.

### New Mechanics

- CPU sockets.
- Second CPU.
- Researched CPU tier packages bought at level 1.
- CPU Package Level upgrades that tune every core in the package.
- CRON Scheduler research.
- CRON v1 timer automation for repeatable system tasks.
- Power state controls.
- System-level throttling.

### RAM Role

RAM determines:

- Which jobs can start.
- How many active/intermediate task stages can be held.
- How many simultaneous jobs can be held in memory.
- How well memory-heavy jobs perform.
- How quickly larger staged work can move when RAM load speed is upgraded from the 1 Hz bit-scale start.
- Capacity and load speed as separate upgrade decisions.
- RAM new-stick and frequency upgrades that use CPU-style tier credit costs, plus RAM capacity upgrades that multiply the CPU-style tier cost by `2^(level - 1)`; RAM capacity doubles each level, and each RAM tier is 1024x the previous tier at the same level.
- Cache capacity upgrades that cost more data than credits, while cache frequency stays on the CPU tier per-core cost ladder.

RAM should not be heavily exposed before RAM Control. After RAM Control it becomes the required staging layer for System Scheduler and larger cache-backed tasks. RAM should use compact +/- controls and a single selectable module-card strip that can show mixed stick sizes and mixed per-module frequencies without presenting a summed total speed; four sticks should render as a 2x2 grid instead of stretching into a wide row. Cache uses the matching compact lane treatment with Buffer and Ready only.

Cache and RAM pressure uses deadlocks instead of invisible start blockers once total installed capacity is sufficient. CPU-local work may start or FIFO-dispatch when combined cache footprint is risky, but System Scheduler RAM dispatch waits until enough RAM footprint is free. Deadlock-safe CPU scheduler dispatch is stricter: it accounts for active work on the affected CPU and CPU-owned RAM and will not start CPU-owned work whose eventual cache/RAM footprint cannot fit. System Scheduler dispatch always accounts for active system RAM footprint; CPU-local cache footprint is delegated to the selected CPU scheduler. When an active load/write would push CPU-local cache or system-wide RAM beyond capacity, that operation enters `deadlocked`, holds its task/core, and turns the affected core, CPU package, cache/RAM section, and scheduler slot red. A cache deadlock freezes all active work on that CPU package, including the task currently holding cache. A RAM deadlock freezes all active work across the system, including unrelated CPU work, until the deadlock is cleared. The pressure timer gives the player 10 seconds to clear the problem; resolving it earlier lets work resume while the timer cools down, but hitting the full timer wipes active processes and blocks new starts until pressure returns to 0. Canceling active or queued work remains the baseline manual fix, and adding capacity can also let the deadlocked task continue. The first deadlock help caption and follow-up cooldown caption pause the game while visible unless a scheduler watchdog auto-kill countdown is active, scroll fully into view when they appear, and are one-time UI hints stored outside the save blob.

### CRON Role

CRON is the first explicit timer automation layer. It is hidden after the second CPU purchase until the player buys CRON Scheduler research, then appears as a paid CRON Job Slot install outline. Buying the first slot creates the first schedule row.

CRON v1 rules:

- CRON can schedule only visible repeatable system tasks.
- CRON cannot schedule hidden tasks, research benchmark compute, normal CPU-bound task progression, or later locked task groups.
- Each scheduled entry has seconds and minutes interval modes.
- Each visible schedule row shows a whole-second countdown to its next job.
- The default minimum interval is 60 seconds after a CRON Job Slot exists.
- Each `cronInterval` upgrade lowers the minimum interval by 1 second, with credit costs scaling steeply and data costs scaling moderately so low-second automation remains a long-term target.
- CRON skips a tick if the same task is already active or queued, if the task is blocked, if the target scheduler queue is full, or if the system is `off`, `booting`, or `shuttingDown`.
- Skipped or offline time does not catch up later. A missed run is simply missed.
- Adding work to the queue through CRON creates a short power spike, so automation interacts with PSU capacity and power billing instead of being free.

### Power Supply Role

The PSU is visible from the first screen. It shows draw, capacity, load, state, live billing, prominent overload failure pressure when draw exceeds capacity, and a cheap credits-only wattage upgrade so the player immediately understands that powered-on idle time has a cost and headroom can be bought. PSU Management research is deferred until advanced tuning or telemetry exposes a new player-facing decision. The power supply determines whether the system can support active hardware draw reliably. Tasks do not spend or require power directly.

Power is paid over time while the system is powered on. The early draw curve should be tiny but meaningful: the starter CPU draws `0.1 uW` and bills `0.1 cr/s`, active starter work should be profitable, and idling with positive credits should slowly drain money. Fully `off` systems bill zero, grey hardware, and leave only power/start controls active; they cannot start work, dispatch queues, or run CRON. If billing would take credits below 0, credits clamp at 0 and the PSU shows a 10-second unpaid-credit cutoff warning; if the warning expires, the system emergency-shuts down and shows a first-time explanatory popup or a brief repeat popup. Starting again from 0 credits provides a short bootstrap grace window before the same warning applies.

If active draw exceeds PSU capacity:

- Overload failure pressure fills in a large centered PSU header meter, taking about 10 seconds just above 100% load and filling faster at higher overload.
- The whole PSU module flashes red while draw is above the rated power.
- Failure hard-powers off, clears active/queued work, shows a short explanatory popup the first time and a red topbar badge after later trips, and requires a reboot.
- Effective clock is throttled.
- Heat increases.
- Job completion slows.
- Reliability margin shrinks.

At this point, power should still be forgiving. It should show stress and throttle without rewinding active work. CPU Package Level upgrades and higher tiers increase draw through clock and efficiency, while C-State upgrades reduce idle-only waste. Matching RAM module size/speed and CPU package specs should improve effective draw and reliability, while mismatches make optimization meaningfully worse.

---

## Stage 5 — Cooling and Overclocking

### Theme

The player learns sustained performance.

### Unlock Condition

Cooling is deferred beyond the current second-CPU automation slice. When it returns, it should unlock after:

- A visible thermal problem or tradeoff exists.
- Player completes Thermal Control research.
- Player first sees heat and cooling tradeoffs as part of system management.

Thermal Control will be the player-facing gate for cooling controls when the Thermal pass returns. Until then, cooling can be represented internally for balance or future migration, but the UI should not ask the player to manage it.

### Cooling Tiers

| Tier | Effect |
|---|---|
| Passive heatsink | Raises heat threshold |
| Fan cooling | Improves cooldown rate |
| Case airflow | Reduces system heat buildup |
| Liquid cooling | Enables stronger overclocking |
| Rack airflow | Server-scale cooling later |
| Data center cooling | Facility-scale cooling later |

### Design Rule

Cooling should be introduced as the solution to a visible problem, not as an arbitrary early upgrade. Cooling improves sustained throughput, power efficiency, and reliability by lowering thermal stress and SLA risk. Active cooling is not free: stronger cooling can add power draw and billing while reducing thermal waste, so the player should balance PSU headroom against thermal control.

---

## Stage 6 — Expansion Slots and Specialized Compute

### Theme

Different hardware is better for different jobs.

### Unlock Condition

Expansion slots unlock after:

- Scheduler is active.
- RAM/power/cooling are visible.
- Player completes workstation benchmark.

### Expansion Types

| Component | Best For | Constraint |
|---|---|---|
| GPU | Rendering, vector math, ML batches | High power and heat |
| NPU | AI inference and model workloads | Model memory and batch size |
| Network card | Remote/distributed work | Bandwidth and latency |
| Storage controller | Data-heavy workloads | I/O throughput |

### Design Rule

Accelerators should specialize. They should not make CPUs obsolete.

The scheduler should eventually route workloads automatically.

---

## Stage 7 — Multiple Systems

### Theme

The player stops building only one machine and begins managing a small fleet.
This is the Multi-System Rack Phase: the rack is first a visual fleet surface,
not full server-rack infrastructure.

### Unlock Condition

The Multi-System Rack Phase unlocks through `System Catalog` research after the
CRON/system-bus slice. That research reveals the visual rack and the system
purchase path for buying a second PC. `Custom Machine Assembly` no longer gates
the v1 custom builder separately; the custom path appears with the catalog.

### New Mechanics

- Buy additional systems.
- Buy preconfigured systems.
- Build custom systems through tiered builder choices.
- View owned systems in a rack-style surface.
- Assign eligible jobs to one selected system.
- Compare machine roles.
- Run chunked single-system tasks.

### Visual Rack Rule

The rack surface grows from ownership, not from theoretical capacity. It should
show exactly one visible slot for each owned system. Buying a preconfigured
system or completing a custom build adds one occupied slot. Do not show empty
future rack capacity, server rack units, rack power distribution, rack heat, or
backplane bandwidth in this phase. Those are Stage 10 rack mechanics.

Each visible slot maps to one system and should keep the system's power state,
role, current work, and upgrade/build entry points easy to inspect. A powered-off
system still occupies its slot.

### Preconfigured Systems

| Package | Purpose |
|---|---|
| Barebones PC | The same minimal one-core, no-RAM, no-scheduler PC the game starts with |
| Starter Node | Compact rack node for familiar system work |
| Compile Box | CPU/RAM-heavy Compile Code and Regression Test work |
| Render Brick | Core-heavy Render Frame work before distributed rendering exists |

Preconfigured systems are the fast purchase path. They should let the player add
another useful machine without picking every component. They cost the sum of
their off-the-shelf parts and do not add discounts. The premade system view
lists the complete CPU, RAM, scheduler, and PSU module specs and price before
purchase, without exposing internal hardware part names.

### Tiered Custom Machine Builder

The custom builder is the deliberate purchase path. It appears with `System
Catalog` and should expose compatible v1 choices without requiring separate
`Custom Machine Assembly` research.

| Tier | Builder Scope |
|---|---|
| Tier 1: Basic PC | CPU package count, core count, cache, RAM, PSU capacity, and queue slots from already understood parts |
| Tier 2: Workstation | Larger CPU/RAM/PSU ranges and role presets for compile, render, or test workloads |
| Tier 3: Specialist | Later expansion-slot and accelerator choices after specialized compute is introduced |

The builder creates one complete system at a time through a full-size system
chassis view. Each visible bay is clickable and opens the curated premade module
choices for that part. The CPU bay should offer at least ten single-CPU die
choices and a separate top-level CPU count selector for 1, 2, 4, or 8 packages,
with current server-preview systems reaching up to 512 total cores.
CPU module cards list cores, tier, level, clock, efficiency, and cache directly
so the choice is scannable before purchase: `cores @ speed` on the first line
and `tier L1, efficiency, cache capacity @ speed` on the second line. Catalog
and builder CPU choices are research-gated by unlocked CPU tiers, and each CPU
purchase path instantiates level-1 packages rather than copied package specs.
Other builder module cards follow the same single spec-block pattern with actual
values, such as RAM capacity at speed, stick count and stick size, scheduler
slots, or PSU watt capacity. The RAM bay should offer only the CPU-unlocked
Hz/kHz/MHz/GHz/THz/PHz tier modules, with each store option represented as a
four-stick kit at that tier's base capacity and frequency. Module choice lists
show specs and price only rather than internal hardware part names. Module
selection configures the build
only; it never buys the part immediately. All v1 parts are compatible. It should
validate costs before purchase, require an explicit purchase confirmation, show
projected draw/stress, allow risky PSU choices with warnings, then add exactly
one owned-system rack slot.

### Chunked Single-System Tasks

This phase introduces three chunked tasks:

| Task | Bottleneck | Rule |
|---|---|---|
| Compile Code | CPU/RAM | Fixed number of compile units; idle cores across all CPU packages each run one unit at a time |
| Render Frame | Parallel compute inside one system | Fixed number of render tiles; local cores and scheduler width shorten duration by processing more tiles at once |
| Regression Test | CPU/cache/RAM balance | Fixed number of test cases that remains selected-system only |

Chunked means the task is made from many smaller work units. At dispatch time,
the selected system assigns currently idle eligible cores across every CPU
package to those units. Each core runs one unit at a time, then pulls another
unit while work remains. Reward and total operation count scale with the number
of units, but cache and RAM fit are evaluated per active unit so a CPU only needs
the cache for the section of work it is actually running. It does not mean
distributed execution. Each accepted task runs on one selected system and uses
that system's CPU packages, RAM, PSU, and local scheduler constraints. Later
distributed workloads can use the same unit/shard shape with thousands of shards
once networking and cluster schedulers exist.

### Automation

The player should be able to buy preconfigured systems instead of manually
picking every component. Saved reusable system templates can come later after
the custom builder is stable.

---

## Stage 8 — Networking and Local Cluster

### Theme

Systems cooperate.

### Unlock Condition

Networking unlocks after the player owns multiple systems.

Networking is not part of the Multi-System Rack Phase. Owning multiple systems
does not automatically grant shared queues, network routing, sharding, or
distributed compute.

### New Mechanics

- Local network.
- Shared job queue.
- Job routing between systems.
- Bandwidth.
- Latency.
- Network congestion.

### Networking Stats

| Stat | Meaning |
|---|---|
| Bandwidth | Amount of job data that can move per second |
| Latency | Delay before remote work begins |
| Switch capacity | Number of systems supported |
| Congestion | Penalty from too much traffic |

### Design Rule

Networking should initially be simple:

**Networked systems can share jobs.**

Complexity appears later through sharding, distributed computing, SLA jobs, and regional latency.

---

## Stage 9 — Sharding and Distributed Computing

### Theme

Large jobs are split across machines.

This stage remains deferred during the Multi-System Rack Phase. Compile Code,
Render Frame, and Regression Test are chunked single-system tasks until
networking and cluster scheduling are introduced.

### Sharding

Sharding is data splitting.

Used for:

- Database scans.
- Data sort.
- Search indexing.
- Analytics jobs.
- Large memory-heavy workloads.

Mechanic:

- Job is split into shards.
- Each shard runs on a different machine.
- Results are merged afterward.

Important stats:

| Stat | Meaning |
|---|---|
| Shard count | Number of pieces |
| Shard overhead | Cost of splitting |
| Merge cost | Cost of combining results |
| Replication factor | Number of copies for safety/performance |
| Network transfer | Data movement cost |

### Distributed Computing

Distributed computing is work splitting.

Used for:

- Simulations.
- Rendering.
- AI batches.
- Scientific workloads.

Mechanic:

- Job has parallelizable work.
- Scheduler distributes work across systems.
- Network and merge overhead reduce efficiency.

### Difference

| Concept | Splits | Main Bottleneck |
|---|---|---|
| Sharding | Data | Network, memory, merge cost |
| Distributed computing | Work | Scheduler, latency, compute efficiency |

---

## Stage 10 — Servers and Racks

### Theme

The player moves from individual computers to infrastructure units.

### Unlock Condition

Servers and racks unlock after:

- Networking is active.
- The player owns several systems.
- A cluster benchmark is completed.

### Server Types

| Server Type | Purpose |
|---|---|
| Compute Server | CPU-heavy jobs |
| GPU Server | Render and ML jobs |
| Memory Server | Database and sort workloads |
| Storage Server | Data-heavy workloads |
| Network Appliance | Bandwidth and routing |

### Rack Mechanics

A rack contains servers and has its own constraints.

The Stage 7 visual rack is only an owned-system display. The constraints below
belong to true server/rack infrastructure and should stay hidden until this
stage unlocks.

| Constraint | Meaning |
|---|---|
| Rack units | Physical space |
| Rack power | Power distribution limit |
| Rack heat | Cooling pressure |
| Backplane bandwidth | Internal server communication |
| Operating cost | Maintenance/automation overhead |

### Design Rule

Racks should simplify server sprawl while adding density constraints.

The player should be able to buy rack templates:

- Compute rack.
- GPU rack.
- Memory rack.
- Storage rack.
- Balanced rack.
- Low-power rack.

---

## Stage 11 — Data Centers

### Theme

The player scales from racks to facilities.

### Unlock Condition

Data centers unlock after:

- Filling a first rack, or
- Completing a cluster benchmark.

### Core Idea

A data center is a larger version of the same power/heat/compute balancing loop.

The player is not managing staff as a separate system. Staff, maintenance, monitoring, and automation are included in operating cost.

### Data Center Stats

| Stat | Meaning |
|---|---|
| Compute capacity | Total available work throughput |
| Memory capacity | Total memory pool available to workloads |
| Rack capacity | Number of racks supported |
| Power input | Facility-level power cap |
| Cooling capacity | Facility-level thermal cap |
| Network uplink | External bandwidth |
| Internal fabric | Intra-data-center bandwidth |
| Operating cost | Recurring cost for maintenance, staff, automation, monitoring |
| Utilization | Percentage of active capacity in use |
| Headroom | Spare power/cooling/compute/network capacity |

### Data Center Throttling

Data centers should use familiar rules from system-level power and heat.

If facility power draw exceeds safe power input:

- Compute throughput is throttled.
- Heat increases.
- SLA jobs become more likely to miss uptime targets.
- Operating cost may rise due to emergency handling.

If heat exceeds cooling capacity:

- Servers throttle.
- Jobs take longer.
- SLA risk increases.

If network uplink is saturated:

- External jobs experience latency or transfer delays.
- Latency-sensitive contracts may fail.

### Utilization and Headroom

Data center reliability should emerge from headroom.

A data center running at 95–100% utilization should be profitable but risky.

A data center running at 60–75% utilization should be less profitable per hardware unit but more likely to satisfy SLA jobs.

### Suggested Headroom Bands

| Headroom | Gameplay Meaning |
|---|---|
| 30%+ | Very safe, lower profit density |
| 15–30% | Good operating range |
| 5–15% | Risky under load spikes |
| 0–5% | High risk of throttling/SLA misses |
| Below 0% | Active overstrain and throttling |

### Data Center Upgrade Categories

| Upgrade | Effect |
|---|---|
| Add racks | More physical capacity |
| Upgrade power feed | Higher power input |
| Upgrade cooling plant | Higher sustained thermal capacity |
| Upgrade network uplink | More external bandwidth |
| Upgrade internal fabric | Better distributed workload performance |
| Improve power efficiency | Less draw per server |
| Improve cooling efficiency | Lower operating cost per heat unit |
| Automation software | Included as reduced operating cost or better scheduler behavior |

---

## 6. SLA Contract System

### 6.1 Purpose

SLA contracts give the player a reason to build stable, under-strained infrastructure instead of always maximizing raw throughput.

SLA stands for service level agreement. In gameplay terms, it is an uptime target required by a job or contract.

Higher SLA jobs pay more but require safer infrastructure.

### 6.2 SLA Tiers

| SLA Tier | Uptime Target | Gameplay Meaning | Reward Multiplier |
|---|---:|---|---:|
| None | No uptime requirement | Batch/offline work | 1.0x |
| Low | 80% | Tolerates downtime and delays | 1.2x |
| Standard | 98% | Needs generally stable infrastructure | 1.8x |
| High | 99.9% | Needs strong headroom and redundancy | 3.0x |
| Critical | 99.99% | Needs excellent headroom, redundancy, and routing | 5.0x+ |

Exact multipliers should be tuned during balancing.

### 6.3 SLA Success Inputs

SLA success should be calculated from player choices, not from a flat reliability stat.

Important inputs:

| Input | Effect |
|---|---|
| Power headroom | Lowers risk of power throttling |
| Cooling headroom | Lowers risk of thermal throttling |
| Compute headroom | Handles demand spikes |
| Network headroom | Prevents latency and transfer delays |
| Redundancy | Allows work to continue if one component/site is strained |
| Scheduler quality | Routes work away from overloaded resources |
| Replication | Keeps data/work available during failures |
| Geographic spread | Helps later with coverage and regional latency |

### 6.4 SLA Risk Model

The game does not need a complex simulation at first. SLA risk can be estimated from stress scores.

Example stress factors:

`power_stress = active_power_draw / safe_power_input`

`cooling_stress = active_heat_load / cooling_capacity`

`compute_stress = active_compute_demand / compute_capacity`

`network_stress = active_network_demand / network_capacity`

Overall stress:

`infrastructure_stress = max(power_stress, cooling_stress, compute_stress, network_stress)`

SLA jobs should become risky as stress approaches or exceeds 1.0.

Suggested interpretation:

| Stress | Meaning |
|---:|---|
| 0.00–0.70 | Safe |
| 0.70–0.85 | Stable but less headroom |
| 0.85–0.95 | Risky for high SLA |
| 0.95–1.00 | Very risky |
| 1.00+ | Overstrained; throttling and SLA misses likely |

### 6.5 SLA Contract Examples

| Contract | SLA | Other Requirement | Reward Logic |
|---|---:|---|---|
| Offline Data Sort | None | High memory | Normal payout |
| Research Batch | 80% | Compute capacity | Low SLA bonus |
| Business API | 98% | Network capacity | Good payout |
| Game Backend | 99.9% | Latency + compute | High payout |
| Payment Processor | 99.99% | Redundancy + power/cooling headroom | Very high payout |
| Emergency Simulation | 99.99% | High compute + scheduler priority | Very high payout |

### 6.6 SLA Failure

If the player fails to meet SLA:

- Contract payout is reduced or lost.
- Some data reward may be lost.
- Reputation or contract availability can be temporarily reduced later in development.

Failure should be legible. The game should explain why an SLA was missed:

- Power overstrain.
- Cooling overstrain.
- Compute saturation.
- Network saturation.
- Insufficient redundancy.
- Latency exceeded.
- Coverage requirement unmet.

---

## 7. Availability Zones

### 7.1 Theme

Availability zones introduce location-aware redundancy and service coverage.

An availability zone is not just a second data center. It is a separate failure domain that helps satisfy high-SLA, low-latency, or high-coverage jobs.

### 7.2 Unlock Condition

Availability zones unlock after:

- The player owns at least one data center.
- SLA contracts have been introduced.
- The player completes an uptime benchmark or successfully completes several 98% SLA contracts.

### 7.3 Core Mechanics

Availability zones add:

- Separate facility power.
- Separate cooling.
- Separate network uplink.
- Workload replication.
- Failover.
- Geographic coverage.
- Latency targets.

### 7.4 Why Build Multiple AZs?

Some jobs require:

- Higher SLA than one data center can easily provide.
- Low latency to a specific user area.
- High coverage across a region.
- Redundant execution.
- Data replication.

Players can try to brute force these jobs from one giant data center, but it should be harder and less efficient.

Brute force should require:

- Much more power headroom.
- Much more cooling headroom.
- Much larger network uplinks.
- More expensive routing upgrades.
- Higher operating cost.

Distributed AZ builds should usually be more efficient for high SLA, low latency, and coverage jobs.

### 7.5 AZ Stats

| Stat | Meaning |
|---|---|
| Local compute | Compute capacity in this AZ |
| Local power | Power input in this AZ |
| Local cooling | Cooling capacity in this AZ |
| Local network | Network capacity in this AZ |
| Latency radius | Area this AZ can serve well |
| Coverage | Percent of target population/area served |
| Replication capacity | Ability to mirror jobs/data to other AZs |
| Failover capacity | Spare capacity for taking over failed/strained workloads |
| Operating cost | Cost of running this AZ |

### 7.6 AZ Job Requirements

Jobs can require:

| Requirement | Meaning |
|---|---|
| SLA target | Uptime required |
| Max latency | Maximum allowed service latency |
| Coverage target | Required percent of region covered |
| Redundancy level | Number of AZs that must hold the workload |
| Replication factor | Number of copies of data/job state |

### 7.7 AZ Contract Examples

| Contract | Requirement | Design Purpose |
|---|---|---|
| Regional Website | 98% SLA, moderate latency | Introduces AZ routing |
| Game Matchmaking | 99.9% SLA, low latency | Rewards nearby AZs |
| Telemetry Ingest | 80% SLA, high coverage | Rewards geographic spread |
| Payment API | 99.99% SLA, redundancy | Requires failover capacity |
| AI Inference Edge Service | Low latency, high coverage | Rewards many smaller AZs |

---

## 8. Regions

### 8.1 Theme

Regions introduce geography at larger scale.

Regions are groups of availability zones serving broader areas.

### 8.2 Unlock Condition

Regions unlock after:

- The player operates multiple AZs.
- The player completes a regional SLA or coverage benchmark.

### 8.3 Regional Mechanics

Regions add:

- User demand by geography.
- Power cost differences.
- Cooling cost differences.
- Land/facility cost differences.
- Latency between regions.
- Inter-region bandwidth.
- Coverage requirements.
- Data locality requirements later if needed.

### 8.4 Regional Tradeoffs

| Region Type | Benefit | Drawback |
|---|---|---|
| Cold region | Lower cooling cost | May be far from users |
| Urban region | Low latency and high demand | High operating cost |
| Remote region | Cheap land/power | High latency and weaker network |
| Renewable region | Lower power cost | Variable power availability |
| Dense market | High-value jobs | Expensive expansion |

### 8.5 Regional Job Examples

| Contract | Requirement | Reward Reason |
|---|---|---|
| Regional Streaming Cache | Low latency, high bandwidth | Rewards placement |
| Multi-Region Business API | 99.9% SLA, 2+ regions | Rewards redundancy |
| Global Game Launch | Low latency, high coverage | Rewards many AZs |
| Scientific Compute Burst | No SLA, huge compute | Can use cheap remote regions |
| Critical Infrastructure Cloud | 99.99% SLA, multiple regions | Highest reward class |

---

## 9. Planetary Computing

### 9.1 Theme

The player manages global compute policy instead of individual infrastructure pieces.

### 9.2 Unlock Condition

Planetary computing unlocks after:

- Multiple regions are active.
- Global scheduler is unlocked.
- The player completes a global benchmark.

### 9.3 Gameplay Focus

The player manages policies:

- Max profit.
- Max data.
- Max uptime.
- Low latency.
- Low operating cost.
- Low power strain.
- Fast expansion.
- Balanced growth.

### 9.4 Planetary Mechanics

Potential late-game systems:

- Global scheduler.
- Edge compute.
- Orbital relays.
- Climate-aware routing.
- Continental power grids.
- Planet-scale AI workloads.
- Autonomous procurement.
- Global SLA markets.

These should be built on existing systems, not introduced as unrelated mechanics.

---

## 10. Job Families

### 10.1 Early Jobs

| Family | Bottleneck | Purpose |
|---|---|---|
| Ping | CPU-light | Starter income |
| Bit/Byte Operations | Clock | Teaches cycles |
| Checksum | CPU/cache | Teaches cache |
| Packet Check | Cache | Early optimization |

### 10.2 Midgame Jobs

| Family | Bottleneck | Purpose |
|---|---|---|
| Compression | CPU/cache | Rewards instruction/cache upgrades |
| Compile Code | CPU/RAM | Chunked single-system software build workload |
| Database Query | RAM/cache | Rewards memory and cache |
| Render Frame | Parallel compute inside one system | Rewards cores/scheduler before distributed rendering |
| Regression Test | CPU/cache/RAM | Chunked single-system validation workload |
| Simulation Tick | CPU-heavy | Benchmark/boss jobs |

### 10.3 Late System/Fleet Jobs

| Family | Bottleneck | Purpose |
|---|---|---|
| Data Sort | Memory/network | Introduces sharding |
| Video Chunk | Parallel compute | Rewards distributed work |
| Game Server Tick | Latency/compute | Introduces SLA/latency |
| AI Training Batch | GPU/NPU/memory | Rewards specialization |
| API Hosting | SLA/network | Introduces reliability contracts |

### 10.4 Infrastructure Jobs

| Family | Bottleneck | Purpose |
|---|---|---|
| Business API | SLA + network | Rewards stable data centers |
| Payment Processor | 99.99% SLA | Rewards headroom/redundancy |
| Streaming Cache | Latency + bandwidth | Rewards regional placement |
| Global Game Backend | Coverage + latency | Rewards AZ/region spread |
| Planetary AI Service | Compute + coverage + SLA | Endgame workload |

---

## 11. Unlock Roadmap

| Order | Unlock | Reason |
|---:|---|---|
| 1 | Single core | Starting point |
| 2 | CPU package level and clock speed | Primary throughput mechanic |
| 3 | Cache | First efficiency mechanic |
| 4 | Cache operation queues | Makes cache-required tasks wait for cache fill |
| 5 | Benchmarks | Adds progression gates |
| 6 | Second core | Introduces parallelism |
| 7 | More cores | Builds pressure for scheduling |
| 8 | Basic queue | Reduces manual core assignment |
| 9 | Four-core milestone | First major CPU achievement |
| 10 | RAM Control | Adds active/intermediate staging constraints before System Scheduler |
| 11 | System Scheduler | Automates RAM-staged multicore task scheduling after 1 Kb RAM |
| 12 | Dual/Quad/Oct Channel RAM | Lets System Scheduler stripe RAM writes across 2, 4, then 8 installed sticks |
| 13 | Second CPU package purchase | Transitions to full system building |
| 14 | CRON Scheduler research reveal | Shows automation research after the second CPU purchase; CRON module stays hidden until researched |
| 15 | CRON Scheduler | Adds scoped timer automation for visible repeatable system tasks |
| 16 | CPU tier research | Unlocks kHz after System Automation; completing kHz reveals MHz, completing MHz reveals GHz, and the chain continues through PHz level-1 CPU package purchases |
| 17 | C-State Control | Adds global idle CPU draw reduction after kHz CPU Research and levels from the research list until max |
| 18 | Memory Voltage Modifier | Adds RAM idle draw reduction after RAM Control and kHz CPU Research and levels from the research list until max |
| 19 | PSU Management | Deferred until advanced power tuning exposes a new decision |
| 20 | Thermal Control | Deferred until the cooling/power tradeoff is ready |
| 21 | Multi-system rack phase | Introduces the owned-system rack surface |
| 22 | Preconfigured systems | Adds ready-made system purchases |
| 23 | Tiered custom machine builder | Adds curated custom system construction |
| 24 | Chunked single-system tasks | Adds Compile Code, Render Frame, and Regression Test without distributed compute |
| 25 | Multiple systems | Fleet management begins; each owned system adds one visible rack slot |
| 26 | Expansion slots | Adds specialization |
| 27 | GPU/NPU | Adds specialized workloads |
| 28 | Workload routing | Scheduler becomes smarter within and later between systems |
| 29 | System templates | Reduces machine micromanagement after the builder stabilizes |
| 30 | Networking | Systems cooperate |
| 31 | Sharding | Splits data across systems |
| 32 | Distributed computing | Splits work across systems |
| 33 | Server chassis | Systems become server units |
| 34 | Racks | Servers become infrastructure |
| 35 | Rack templates | Reduces server micromanagement |
| 36 | Data centers | Facility-scale power/cooling/network constraints |
| 37 | SLA contracts | Rewards stable infrastructure |
| 38 | Data center procurement policies | Reduces rack/server micromanagement |
| 39 | Availability zones | Adds failover, latency, and coverage |
| 40 | Region expansion | Adds geography and demand |
| 41 | Global scheduler | Automates regional placement |
| 42 | Planetary computing | Endgame policy layer |

---

## 12. Automation Roadmap

| Stage | Automation Unlock | What It Replaces |
|---|---|---|
| Early CPU | Manual task choice | Player learns task requirements before automation hides decisions |
| 2 cores | Basic queue | Manually assigning jobs to each core |
| 4 cores | System Scheduler | Core-by-core operation management and cache/RAM queue feeding |
| Scheduler Watchdog | Auto-kill controls | Manually clearing long deadlocked scheduler-owned work |
| Scheduling Policy | Scheduler policy controls | Manually avoiding risky dispatch order |
| Second CPU | CRON v1 | Manually relaunching visible repeatable system tasks |
| Full system | Preconfigured CPUs | Manual CPU package tuning |
| Multi-system rack | Preconfigured systems | Building every additional machine from parts |
| Custom system tiers | Tiered custom builder | Exposes only validated build choices per progression tier |
| Workstation | Scheduler policies | Manual CPU/GPU/NPU/RAM/storage assignment |
| Multiple systems | System templates | Rebuilding machines by hand after custom builds are stable |
| Networking | Shared queue | Manual per-system job assignment |
| Cluster | Cluster scheduler | Manual distributed job placement |
| Racks | Rack templates | Manual server purchasing |
| Data center | Procurement policy | Manual rack expansion |
| SLA phase | SLA-safe scheduling | Manual risk management |
| AZ phase | Failover policy | Manual redundancy handling |
| Region phase | Regional scheduler | Manual regional routing |
| Planetary phase | Global scheduler / infrastructure policy | Most low-level operations |
| Much later automation | Broad auto-repeat | Manual relaunch of non-system and cross-scale recurring work |

---

## 13. Build Notes for Implementation

### 13.1 Minimum Viable Prototype Scope

The first prototype should include only:

- One core.
- Clock speed.
- Cache.
- A few tasks made from CPU operations.
- Cache operation queues.
- Cache fill waits for cache-required tasks.
- Credits.
- Data.
- CPU package level upgrades.
- Cache upgrades.
- Multi-core unlock.
- Basic queue.

Do not implement auto-repeat, RAM, power, heat, cooling, networking, data centers, or SLA in the first playable prototype unless the early loop already feels good.

### 13.2 First Vertical Slice Scope

A strong first vertical slice should include progression through:

1. Single core.
2. CPU package level/cache upgrades.
3. Multi-core unlock.
4. Four-core milestone.
5. RAM Control reveal with a paid 256 b / 1 Hz first-stick install.
6. 1 Kb RAM gate for System Scheduler.
7. System Scheduler unlock.
8. Second CPU package unlock.
9. Second CPU purchase reveals CRON Scheduler research; PSU has been visible since the start.
10. CRON Scheduler reveals a paid CRON Job Slot install; buying it unlocks CRON v1 for visible repeatable system tasks only.
11. PSU Management remains deferred until it exposes a new power decision.
12. Thermal Control remains deferred until the cooling/power tradeoff is ready.

This validates the most important design promise: complexity appears only after the player understands the previous layer.

### 13.3 Multi-System Rack Phase Scope

The next pre-live phase should include:

- A clean save reset for this phase instead of preserving obsolete prototype
  state.
- A rack-style owned-system view that grows exactly one visible slot per owned
  system.
- Preconfigured system purchases.
- A tiered custom machine builder that creates one complete system at a time.
- Chunked single-system tasks: Compile Code, Render Frame, and Regression Test.
- Per-system task targeting and local system constraints.

This phase should not include shared queues, networking, sharding, distributed
computing, true server rack constraints, data centers, or SLA contracts. Those
remain later stages until implementation and tests explicitly prove otherwise.

The RAM block/channel overhaul uses save version 4 and intentionally resets
v3 and older saves to a clean initial state. The older RAM residency stream is
incompatible with fixed per-stick block addresses, channel striping state, and
Memory Voltage Modifier levels.

### 13.4 Full Midgame Scope

The midgame should include:

- RAM.
- Power.
- Cooling.
- Expansion slots.
- GPU/NPU.
- Multiple systems.
- Networking.
- Sharding.
- Distributed computing.
- Servers.
- Racks.
- Data centers.

### 13.5 Late Game Scope

Late game should include:

- SLA contracts.
- Data center headroom management.
- Availability zones.
- Latency requirements.
- Coverage requirements.
- Regions.
- Global scheduler.
- Planetary computing.

---

## 14. Key Balancing Rules

1. CPU Package Level should always help, but should not remain the only optimal path.
2. Cache should be introduced early as CPU operation queue capacity and fill speed, not only as a flat speed modifier.
3. Cache-required tasks should wait for cache fill before their required operations execute.
4. Cores should improve parallel throughput, not single-job speed, until scheduler upgrades.
5. RAM should become visible only when the player has enough parallelism for active/intermediate staging to matter.
6. Cache, RAM, and storage load speeds should be meaningful upgrade paths.
7. Tasks should not require power directly; active hardware creates power draw and stress.
8. Power should be billed over time from actual draw with no free threshold; the starting draw should be tiny but meaningful.
9. CPU draw should scale from package tier, package level, clock, efficiency, active core count, and C-State idle multipliers.
10. Power billing should clamp at 0 credits, show a 10-second unpaid-credit cutoff warning before auto-shutdown, and provide a short no-bill bootstrap restart from 0 credits.
11. Power state controls should make `off` useful for configuration and zero billing while clearly blocking work and CRON.
12. Power should first show stress and throttle without rewinding tasks; hard failure risk belongs to later, higher-scale reliability systems.
13. CRON v1 should repeat only visible repeatable system tasks, skip blocked or duplicate work, and never catch up missed runs.
14. Cooling should unlock only after heat is experienced or overclocking is unlocked, and should improve efficiency as well as reliability while adding an active-power tradeoff.
15. Higher SLA jobs should pay more because they require safer infrastructure.
16. Uptime should emerge from headroom, redundancy, routing, and load management.
17. Availability zones should make high-SLA, low-latency, and coverage jobs easier than brute force.
18. Brute force should remain possible but inefficient.
19. Operating cost should include maintenance, staff, monitoring, and automation.
20. Every new scale should automate or abstract the previous scale.
21. Broad auto-repeat should remain deferred until later automation layers can support it without flattening task choice.

### 14.1 Equipment Tier Ladder

Equipment pricing uses a static ladder. The highest module in a newly visible band should feel aspirational at roughly 50x the expected credit high-water mark for that band, but the game does not track max credits for dynamic repricing.

| Tier | Era | CPU Target | Cache Target | RAM Target | Price Band |
|---|---|---:|---:|---:|---:|
| T0 | Bit/byte starter | 1-4 Hz, 1-2 cores | 1-8 b | none/256 b | 10-500 credits |
| T1 | Local scheduler | 4-30 Hz, 2-4 cores | 32-256 b | 1-2 Kb | 500-5k |
| T2 | System catalog | 30-400 Hz, 4-8 cores | 512 b-8 Kb | 4-16 Kb | 5k-50k |
| T3 | Custom workstation | 400 Hz-10 KHz, 8-16 cores | 16-512 Kb | 32-256 Kb | 50k-500k |
| T4 | Server node | 10 KHz-1 MHz, 16-64 cores | 1-64 Mb | 512 Kb-8 Mb | 500k-5M |
| T5 | Rack server | 1-100 MHz, 64-256 cores | 128 Mb-8 Gb | 16 Mb-1 Gb | 5M-50M |
| T6 | Cluster blade | 100 MHz-10 GHz | 16 Gb-1 Tb | 2-128 Gb | 50M-500M |
| T7 | Data center pod | 10 GHz-1 THz equivalent | 2-128 Tb | 256 Gb-16 Tb | 500M-5B |
| T8 | Availability zone | policy-scale compute | regional cache pools | memory pools | 5B-50B |
| T9 | Region/global | planetary scheduler scale | edge/global cache | replicated pools | 50B+ |

Catalog CPUs are level-1 packages from researched CPU tiers. CPU-local scheduler slots come from the CPU package's core count, while scheduler modules represent system-level queue/backplane capacity. RAM kits mirror CPU tiers with increasing capacity and frequency, and premade systems should combine matching-tier CPU, RAM, scheduler, and PSU modules.

---

## 15. Final Design Intent

The player should feel a continuous progression from tiny computation to planetary-scale infrastructure.

The same question repeats at larger scale:

**Can my compute system handle this task without overstraining its constraints?**

At first, the constraint is clock speed.

Then it is cache fill and CPU operation queue capacity.

Then cores.

Then RAM staging for active and intermediate work.

Then PSU stress, scheduling policy, and cooling efficiency.

Then workload routing.

Then network bandwidth.

Then rack density.

Then data center power and thermal headroom.

Then SLA uptime.

Then latency and geographic coverage.

The game succeeds if every new layer feels like a natural enlargement of the same core system rather than a disconnected new feature.
