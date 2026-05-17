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
| Primitive CPU start | Tested | New save starts with one core, 1 Hz clock, 1 b cache, 1 Hz cache load rate, 0 b RAM, hidden 1 Hz RAM load rate, credits, data, runnable Fetch Bit, and 2 b-gated Decode Bit visible |
| Bit-scale startup | Tested | Opening tasks stay as a tiny bit-scale pair before byte/cache/research concepts are introduced, with Decode using a 2 b cache footprint and overwrite bit tasks reusing 1 b footprints |
| Manual tasks | Tested | Player can start an available task/job and receive credits/data on completion |
| Task cancellation | Tested | Active tasks and queued scheduler entries can be canceled, releasing reserved work without paying rewards or removing active scheduler reservations for other queued copies |
| Resource gain flyouts | Tested | Positive credits/data gains show transient +amount labels that fly into the matching HUD total |
| Resource amount tokens | Tested | Credits/data use one icon-number-color treatment in the HUD, flyouts, task payouts, upgrade/research costs, and inspect summaries |
| Clock upgrades | Tested | Upgrade increases CPU operation throughput and cost scales |
| Cache upgrades | Tested | Capacity and speed upgrades are available from the start, cost more data than credits, and improve cache queue/fill behavior |
| Task operation composition | Tested | Player-facing tasks decompose into read/write/overwrite memory operations and compute operations, including paid operation totals that count CPU cycles plus cache/RAM load work |
| Runtime progress meters | Tested | Task cards show one whole-task progress value across recipe/load/compute work, RAM shows reserved/loading/ready staging progress, and CPU core meters show current CPU execution, including memory-operation cache buffer cycles |
| Inferred task composition DAG | Tested | Task definitions infer cached recipe-step DAG nodes, per-step staging, and accept/execute/complete dependencies for ready/waiting reasons |
| CPU cache operation queue | Tested | Cache stores CPU operation queues instead of acting only as a percent modifier, and start/scheduler pull gates use free cache after active reservations while queue acceptance uses total fit |
| Cache-fill wait gate | Tested | Cache-required operations wait for cache fill at the graph step where that operation executes |
| Progressive task reveal | Tested | Tasks appear in small concept groups and the task panel groups visible work by CPU-bound, system, distributed, and other task categories instead of a single previous-task chain |
| Progressive research reveal | Tested | Research appears only after data/research has player-facing meaning |
| Research requirements clarity | Tested | Research cards list unmet research, task, hardware, and compute requirements before purchase |
| Auto-repeat | Deferred | Moved out of the early target until later automation layers |
| Research compute benchmarks | Tested | Micro, parallelism, and multi-core benchmarks run from their owning research cards and stay out of the normal task list |
| Micro Benchmark | Tested | Benchmark compute gates progression from early CPU tuning |
| Multi-core unlock | Tested | Parallelism benchmark completion enables Multi-Core Control research, which unlocks buying more cores |
| Additional cores | Tested | Cores increase parallel throughput, not single-job speed |
| Basic queue | Tested | Early queue behavior feeds ready operations/tasks to idle cores after queue slots are purchased, skipping pending cache/RAM-blocked entries when later CPU-ready work can run |
| CPU scheduler queue slots | Tested | CPU scheduler backlog capacity starts at zero; CPU Queue Slot upgrades are purchased per CPU and stay occupied by scheduler-dispatched CPU work until that work completes |
| Four-core milestone | Tested | Four cores satisfy one System Scheduler requirement before the RAM gate |
| RAM Control gate | Tested | RAM Control appears with System Scheduler after Local Scheduler, unlocks 256 b RAM at 1 Hz, and enables larger RAM/cache tasks |
| System Scheduler unlock | Tested | Local and System Scheduler unlocks are research purchases; System Scheduler requires RAM Control plus at least 1 Kb RAM and appears as a system-level scheduler surface after research |
| System Scheduler queue slots | Tested | System Queue Slot upgrades are bought on the System Scheduler surface, admit whole system tasks separately from CPU Queue Slots, and stay occupied until that system task completes or is canceled |
| Second CPU unlock | Tested | Multi-core benchmark compute enables System Bus research, which unlocks a matched CPU package purchase |
| Matched CPU package | Tested | New CPU purchase copies another owned CPU package's core count, core clocks, cache, cache speed, and scheduler slots, and its cost includes the base CPU plus copied upgrades |
| RAM reveal | Tested | RAM appears after RAM Control research, not after second CPU purchase |
| Power reveal | Tested | PSU and cooling stay tied to the matched-CPU/system stage |
| PSU existing-stage gate | Tested | PSU may exist internally but stays hidden/actionless until matched CPU system building |
| RAM staging model | Tested | RAM extends the memory staging hierarchy after cache, shows task loading into RAM before CPU execution, and start/scheduler pull gates use free RAM after active reservations while queue acceptance uses total fit without blocking unrelated ready CPU work |
| RAM upgrades | Tested | RAM capacity and RAM speed upgrade separately after RAM Control, cost more data than credits, capacity starts at 256 b, and speed starts at 1 Hz |
| PSU reliability stress | Tested | PSU affects reliability, efficiency, throttle, and restart risk rather than direct task requirements |
| Dense hardware draw curve | Tested | Dense cores/CPUs increase draw nonlinearly |
| Cooling Thermal Control gate | Tested | Cooling controls unlock through Thermal Control research after PSU/heat pressure is visible |
| Browser persistence | Built | Save/load works in browser storage |
| Electron shell | Built | Desktop app opens the same game build |
| Responsive game UI | Tested | Main interface remains usable on desktop and mobile widths |
| Hardware workbench UI | Tested | CPU board is the primary surface; top title chrome and side panels are removed |
| Board-integrated controls | Tested | Upgrades live on components and jobs sit below the system instead of in a switching inspector |
| Component-scoped controls | Tested | CPU, CPU-local cache, CPU-local scheduler, RAM, PSU, and socket expose relevant local actions and upgrades |
| Core-local upgrades | Tested | Core Clock appears inline beside each core speed and Add Core appears as a core-sized slot inside the CPU section |
| Per-core job targeting | Tested | Selecting a core makes Jobs assign work directly to that core |
| Per-core clock state | Tested | Core Clock purchases apply to the targeted core without changing other cores |
| CPU-local scheduler targeting | Tested | Scheduler appears inside the CPU and turns CPU-bound tasks into queue intake when selected; system tasks stay on the visible System Scheduler instead of CPU-local whole-task queues |
| Expandable provisioning | Tested | Component upgrades needed for the current stage are visible inline without selecting the section first |
| CPU-integrated cache UI | Tested | Cache appears inside the CPU package with capacity and speed upgrades available from the start |
| Unified CPU/cache modules | Tested | CPU header is centered without active-count clutter, and core/cache modules share compact stat rows, row-aligned upgrade buttons, concise CPU status labels, and explicit Buffer/Load/Ready cache meter states |
| Progressive CPU socket reveal | Tested | Single-CPU state labels the part as CPU without socket framing until multi-CPU is known |
| Hardware info controls | Tested | Hardware info icons are clickable controls that open short component explanations |
| Scheduler queue module | Tested | Queue contents appear inside the scheduler hardware module with current waiting/active reasons, and purchased slots show as a horizontal active/available strip instead of count badges |
| RAM and PSU readouts | Tested | RAM shows modules, bit-load speed, reserved/loading/ready staging, and capacity/speed upgrade access; PSU shows draw, capacity, cost, and upgrade access |

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
| Heat | Deferred |
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
| Micro Benchmark | Tested |
| Parallelism Benchmark | Tested |
| Multi-Core Benchmark | Tested |
| Compression | Deferred |
| Compile | Deferred |
| Database Query | Deferred |
| Render Frame | Deferred |
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
| Auto-repeat | Deferred |
| Benchmarks | Tested |
| Additional cores | Tested |
| Basic queue | Tested |
| CPU scheduler queue slots | Tested |
| System Scheduler queue slots | Tested |
| CPU Operation Scheduler | Tested |
| Thermal Control research | Tested |
| Scheduler policies | Deferred |
| System Scheduler | Tested |
| Cluster scheduler | Deferred |
| Regional scheduler | Deferred |
| Preconfigured CPUs | Deferred |
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
| Stage 4: full system building | Deferred |
| Stage 5: cooling and overclocking | Deferred |
| Stage 6: expansion slots and specialized compute | Deferred |
| Stage 7: multiple systems | Deferred |
| Stage 8: networking and local cluster | Deferred |
| Stage 9: sharding and distributed computing | Deferred |
| Stage 10: servers and racks | Deferred |
| Stage 11: data centers | Deferred |
| SLA contracts | Deferred |
| Availability zones | Deferred |
| Regions | Deferred |
| Planetary computing | Deferred |

## Current Build Notes

- The first build targets the vertical slice only.
- Docs target for this slice: bit-scale startup, grouped task/research reveal, internal recipe DAG, RAM Control before System Scheduler, CPU-local cache/scheduler packages, matched CPU purchases, PSU existing-stage gate, and Thermal Control as the cooling gate.
- Active pre-live target: tasks are composed from low-level and counted operations; paid operation totals include CPU cycles, cache load bits, and RAM staging bits, so a 256 b RAM load contributes 256 paid operations; counted memory-operation cache fill uses total touched bits once; task-level cache provisioning and active residency sum distinct reads/writes, multiply parallel per-core cache footprints, and let overwrites reuse the touched footprint; cache stores CPU operation queues; cache-required operations wait for cache fill at their DAG step; cache and RAM upgrade costs are weighted toward data over credits; CPU scheduler backlog and multicore provisioning width come from purchased per-CPU CPU Queue Slot upgrades instead of infinite default slots; system tasks are admitted by separate System Queue Slot upgrades on the visible System Scheduler as whole tasks, then reserve CPU scheduler slots only for their CPU-bound execution portions; scheduler-dispatched tasks stay in their scheduler queue and keep their slot occupied until completion; scheduler queue entries show the current waiting or active reason; cache and RAM gate starts and scheduler pulls against free active capacity while still allowing queue acceptance by total fit; RAM-blocked queue entries stay pending without head-of-line blocking later ready CPU-local work; RAM stages larger active/intermediate work as the next memory tier after cache, shows loading before CPU execution, starts at 256 b and 1 Hz when RAM Control is researched, separates capacity from speed upgrades, and gates System Scheduler at 1 Kb; cache, CPU scheduler slots, and cores are CPU-local; matched CPU purchase cost includes the base CPU plus copied upgrades.
- Power target: tasks do not require power directly; PSU capacity is a reliability/stress system with throttle and restart risk, dense compute draw scales nonlinearly, and cooling improves efficiency plus reliability.
- Cooling target: cooling is gated by Thermal Control research after PSU/heat pressure, not exposed as an arbitrary early component.
- Research target: new task groups and hardware categories unlock through research cards; benchmark-style compute is launched from research cards, and each card lists the research/task/hardware/compute requirements blocking it.
- Scheduler naming target: CPU Operation Scheduler first, then system, cluster, regional, and later global/planetary layers.
- Auto-repeat is deferred until much later automation work.
- Breaking save reset: browser persistence now uses `save-v2` for the bit-scale pre-live schema.
- The reference PNGs guide visual tone, not mechanics.
- UI copy should be short and useful.
- Verification completed May 17, 2026: `npm test`, `npm run typecheck`, and `npm run build` passed for this bit-scale/reveal/DAG slice, including CPU-buffered cache writes, equal-rate CPU/cache alignment, counted cache-fill timing, paid cache/RAM load operation totals, distinct read/write cache residency, overwrite cache reuse, per-operation cache staging, finite CPU scheduler queue slots, separate System Scheduler queue slots, system scheduler intake for whole system tasks, dispatch-time CPU scheduler reservation for system task CPU work, active scheduler queue reservations until completion, scheduler width gating for multicore tasks, CPU-local cache/scheduler gates, no cross-CPU core splitting for multicore tasks, RAM Control and 1 Kb System Scheduler gates, separate RAM capacity/speed upgrades, data-weighted cache/RAM upgrade costs, RAM loading progress before CPU execution, RAM-load coexistence with unrelated manual CPU work and queued CPU work, matched CPU specs/costing, cache/RAM free-capacity start and scheduler pull gates with queue acceptance, completed-task cache release, cached DAG-derived totals, research-card compute benchmarks, scheduler research unlock gates, dashed/solid cache/RAM state visuals, and shared resource tokens. Browser smoke evidence is recorded in `docs/qa-notes.md`.
