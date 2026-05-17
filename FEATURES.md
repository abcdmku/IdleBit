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
| Primitive CPU start | Tested | New save starts with one core, 1 Hz clock, 1 b cache, 1 Hz cache load rate, 0 b RAM, 1 b/s RAM load rate, credits, data, runnable Fetch Bit, and 2 b-gated Decode Bit visible |
| Bit-scale startup | Tested | Opening tasks stay as a tiny bit-scale pair before byte/cache/research concepts are introduced, with Decode using a 2 b cache footprint and overwrite bit tasks reusing 1 b footprints |
| Manual tasks | Tested | Player can start an available task/job and receive credits/data on completion |
| Resource gain flyouts | Tested | Positive credits/data gains show transient +amount labels that fly into the matching HUD total |
| Resource amount tokens | Tested | Credits/data use one icon-number-color treatment in the HUD, flyouts, task payouts, upgrade/research costs, and inspect summaries |
| Clock upgrades | Tested | Upgrade increases CPU operation throughput and cost scales |
| Cache upgrades | Tested | Capacity and speed upgrades are available from the start and improve cache queue/fill behavior |
| Task operation composition | Tested | Player-facing tasks decompose into read/write/overwrite memory operations and compute operations, including counted operation nodes for large repeated work |
| Runtime progress meters | Tested | Task cards show one whole-task progress value across recipe/load/compute work, while CPU core meters show current CPU execution, including memory-operation cache buffer cycles |
| Inferred task composition DAG | Tested | Task definitions infer cached recipe-step DAG nodes, per-step staging, and accept/execute/complete dependencies for ready/waiting reasons |
| CPU cache operation queue | Tested | Cache stores CPU operation queues instead of acting only as a percent modifier, and start/scheduler pull gates use free cache after active reservations while queue acceptance uses total fit |
| Cache-fill wait gate | Tested | Cache-required operations wait for cache fill at the graph step where that operation executes |
| Progressive task reveal | Tested | Tasks appear in small concept groups instead of a single previous-task chain |
| Progressive research reveal | Tested | Research appears only after data/research has player-facing meaning |
| Research requirements clarity | Tested | Research cards list unmet research, task, hardware, and compute requirements before purchase |
| Auto-repeat | Deferred | Moved out of the early target until later automation layers |
| Research compute benchmarks | Tested | Micro, parallelism, and multi-core benchmarks run from their owning research cards and stay out of the normal task list |
| Micro Benchmark | Tested | Benchmark compute gates progression from early CPU tuning |
| Multi-core unlock | Tested | Parallelism benchmark completion enables Multi-Core Control research, which unlocks buying more cores |
| Additional cores | Tested | Cores increase parallel throughput, not single-job speed |
| Basic queue | Tested | Early queue behavior feeds ready operations/tasks to idle cores after queue slots are purchased |
| Scheduler queue slots | Tested | Scheduler backlog capacity starts at zero and Queue Slot upgrades add finite queued-task slots |
| Four-core milestone | Tested | Four cores satisfy the Kernel Scheduler research requirement |
| CPU Operation Scheduler unlock | Tested | Local and Kernel Scheduler unlocks are research purchases, not direct hardware upgrade shortcuts |
| Second CPU unlock | Tested | Multi-core benchmark compute enables System Bus research, which unlocks second CPU purchase |
| RAM reveal | Tested | RAM appears after second CPU purchase |
| Power reveal | Tested | Power appears after second CPU purchase |
| RAM/PSU existing-stage gate | Tested | RAM and PSU may exist internally but stay hidden/actionless until the second CPU stage |
| RAM staging model | Tested | RAM extends the memory staging hierarchy after cache, and start/scheduler pull gates use free RAM after active reservations while queue acceptance uses total fit |
| PSU reliability stress | Tested | PSU affects reliability, efficiency, throttle, and restart risk rather than direct task requirements |
| Dense hardware draw curve | Tested | Dense cores/CPUs increase draw nonlinearly |
| Cooling Thermal Control gate | Tested | Cooling controls unlock through Thermal Control research after PSU/heat pressure is visible |
| Browser persistence | Built | Save/load works in browser storage |
| Electron shell | Built | Desktop app opens the same game build |
| Responsive game UI | Tested | Main interface remains usable on desktop and mobile widths |
| Hardware workbench UI | Tested | CPU board is the primary surface; top title chrome and side panels are removed |
| Board-integrated controls | Tested | Upgrades live on components and jobs sit below the system instead of in a switching inspector |
| Component-scoped controls | Tested | CPU, cache, scheduler, RAM, PSU, and socket expose relevant local actions and upgrades |
| Core-local upgrades | Tested | Core Clock appears inline beside each core speed and Add Core appears as a core-sized slot inside the CPU section |
| Per-core job targeting | Tested | Selecting a core makes Jobs assign work directly to that core |
| Per-core clock state | Tested | Core Clock purchases apply to the targeted core without changing other cores |
| CPU-local scheduler targeting | Tested | Scheduler appears inside the CPU and turns Jobs into queue intake when selected |
| Expandable provisioning | Tested | Later component upgrade groups stay hidden until that component is selected; core clock and cache controls stay inline |
| CPU-integrated cache UI | Tested | Cache appears inside the CPU package with capacity and speed upgrades available from the start |
| Unified CPU/cache modules | Tested | CPU header is centered without active-count clutter, and core/cache modules share compact stat rows, row-aligned upgrade buttons, concise CPU status labels, and explicit Buffer/Load/Ready cache meter states |
| Progressive CPU socket reveal | Tested | Single-CPU state labels the part as CPU without socket framing until multi-CPU is known |
| Hardware info controls | Tested | Hardware info icons are clickable controls that open short component explanations |
| Scheduler queue module | Tested | Queue contents appear inside the scheduler hardware module, not in a side panel |
| RAM and PSU readouts | Tested | RAM shows modules, bit-load speed, and reserved memory; PSU shows draw, capacity, cost, and upgrade access |

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
| Scheduler queue slots | Tested |
| CPU Operation Scheduler | Tested |
| Thermal Control research | Tested |
| Scheduler policies | Deferred |
| System scheduler | Deferred |
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
- Docs target for this slice: bit-scale startup, grouped task/research reveal, internal recipe DAG, RAM/PSU existing-stage gate, and Thermal Control as the cooling gate.
- Active pre-live target: tasks are composed from low-level and counted operations; counted memory-operation cache fill uses total touched bits once; task-level cache provisioning and active residency sum distinct reads/writes, multiply parallel per-core cache footprints, and let overwrites reuse the touched footprint; cache stores CPU operation queues; cache-required operations wait for cache fill at their DAG step; scheduler backlog capacity comes from purchased Queue Slot upgrades instead of infinite default slots; cache and RAM gate starts and scheduler pulls against free active capacity while still allowing queue acceptance by total fit; RAM stages larger active/intermediate work as the next memory tier after cache; cache/RAM/storage load speeds are upgrade paths.
- Power target: tasks do not require power directly; PSU capacity is a reliability/stress system with throttle and restart risk, dense compute draw scales nonlinearly, and cooling improves efficiency plus reliability.
- Cooling target: cooling is gated by Thermal Control research after PSU/heat pressure, not exposed as an arbitrary early component.
- Research target: new task groups and hardware categories unlock through research cards; benchmark-style compute is launched from research cards, and each card lists the research/task/hardware/compute requirements blocking it.
- Scheduler naming target: CPU Operation Scheduler first, then system, cluster, regional, and later global/planetary layers.
- Auto-repeat is deferred until much later automation work.
- Breaking save reset: browser persistence now uses `save-v2` for the bit-scale pre-live schema.
- The reference PNGs guide visual tone, not mechanics.
- UI copy should be short and useful.
- Verification completed May 16, 2026: `npm test`, `npm run typecheck`, and `npm run build` passed for this bit-scale/reveal/DAG slice, including CPU-buffered cache writes, equal-rate CPU/cache alignment, counted cache-fill timing, distinct read/write cache residency, overwrite cache reuse, per-operation cache staging, finite scheduler queue slots, cache/RAM free-capacity start and scheduler pull gates with queue acceptance, completed-task cache release, cached DAG-derived totals, research-card compute benchmarks, scheduler research unlock gates, dashed/solid cache state visuals, and shared resource tokens. Browser smoke evidence is recorded in `docs/qa-notes.md`.
