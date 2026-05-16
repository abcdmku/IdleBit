# IdleBit Feature Tracker

`game-spec.md` is the design source of truth. This tracker records what exists in the build.

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
| Primitive CPU start | Tested | New save starts with one core, 10 Hz clock, 1 B cache, credits, data, and visible jobs |
| Manual jobs | Tested | Player can start an available job and receive credits/data on completion |
| Clock upgrades | Tested | Upgrade increases effective job speed and cost scales |
| Cache upgrades | Tested | Upgrade improves cache-sensitive jobs and cost scales |
| Auto-repeat | Tested | Unlock allows completed jobs to restart without manual input |
| Micro Benchmark | Tested | Benchmark gates progression from early CPU tuning |
| Multi-core unlock | Tested | Parallelism benchmark unlocks buying more cores |
| Additional cores | Tested | Cores increase parallel throughput, not single-job speed |
| Basic queue | Tested | Idle cores pull queued jobs once queue automation is unlocked |
| Four-core milestone | Tested | Reaching four cores unlocks scheduler |
| Scheduler unlock | Tested | Scheduler status becomes visible and enables policy placeholder |
| Second CPU unlock | Tested | Multi-core benchmark unlocks second CPU purchase |
| RAM reveal | Tested | RAM appears after second CPU purchase |
| Power reveal | Tested | Power appears after second CPU purchase |
| Browser persistence | Built | Save/load works in browser storage |
| Electron shell | Built | Desktop app opens the same game build |
| Responsive game UI | Tested | Main interface remains usable on desktop and mobile widths |

## Core Resources

| Feature | Status |
|---|---|
| Credits | Tested |
| Data | Tested |
| Compute throughput | Tested |
| Capacity | Deferred |
| Power | Deferred |
| Heat | Deferred |
| Cooling | Deferred |
| Operating cost | Deferred |

## Jobs

| Feature | Status |
|---|---|
| Bit Flip | Tested |
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
| Auto-repeat | Tested |
| Benchmarks | Tested |
| Additional cores | Tested |
| Basic queue | Tested |
| Scheduler | Tested |
| Scheduler policies | Deferred |
| Preconfigured CPUs | Deferred |
| System templates | Deferred |
| Shared queue | Deferred |
| Cluster scheduler | Deferred |
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
- The reference PNGs guide visual tone, not mechanics.
- UI copy should be short and useful.
- Verification completed: `npm test`, `npm run typecheck`, `npm run build`, desktop browser smoke, and mobile browser smoke.
