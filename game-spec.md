# IdleBit

## 1. Product Summary

IdleBit is an incremental systems-building game where the player starts with a primitive single-core CPU and eventually scales into server racks, data centers, availability zones, regions, and planetary compute.

The core gameplay loop remains consistent at every scale:

**Accept jobs → process work → earn credits/data → buy upgrades → unlock larger jobs and larger infrastructure.**

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

The game begins with one core, clock speed, cache, and tiny jobs. RAM, power, heat, cores, sockets, scheduling, cooling, networking, and infrastructure are hidden until they matter.

The first player lesson is:

**More clock speed makes jobs finish faster. Cache makes certain jobs more efficient.**

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
| Basic queue | Auto-repeat jobs |
| Multiple cores | Auto-fill idle cores |
| Scheduler | Core assignment policies |
| Second CPU | Preconfigured CPU packages |
| Full system building | System templates |
| Multiple systems | Prebuilt machines |
| Networking | Shared queues |
| Racks | Rack templates |
| Data centers | Procurement policies |
| Availability zones | Failover/routing policies |
| Regions | Global scheduler policies |

The player should always manage the newest interesting layer, not every layer at once.

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
- Cache upgrades.
- Core purchases.
- RAM.
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
- Automation systems.
- Cluster features.
- Data center management tools.
- Availability zone and region unlocks.

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

At system scale, capacity is mostly RAM.

At data center scale, capacity includes:

- Available compute headroom.
- Available memory.
- Available power headroom.
- Available cooling headroom.
- Available network headroom.

### 3.5 Power

Power is a soft or hard constraint depending on scale.

At system scale:

- If hardware draw exceeds PSU capacity, effective clock is throttled.

At rack scale:

- If rack draw exceeds rack power distribution, servers throttle.

At data center scale:

- If facility draw approaches or exceeds power input, data center throughput and uptime degrade.

Power should be one of the main sources of reliability risk. Uptime is not a flat stat; uptime emerges from whether the player leaves enough headroom to handle active workloads.

### 3.6 Heat and Cooling

Heat is generated by active compute and excess power draw.

Cooling determines how much sustained workload the infrastructure can support before throttling.

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

### 4.1 Job Requirements

Each job can define:

| Field | Meaning |
|---|---|
| Required cycles | Amount of CPU/compute work needed |
| Required memory | RAM or memory capacity needed |
| Cache need | Cache threshold for efficient execution |
| Memory intensity | How much RAM frequency/bandwidth matters |
| Parallelizable | Whether the job can be split across cores/systems |
| Power draw | Additional active draw while running |
| Reward credits | Main payout |
| Reward data | Progression payout |
| SLA requirement | Optional uptime target |
| Latency requirement | Optional max latency target |
| Coverage requirement | Optional geographic/service coverage target |

Early jobs should only expose cycles, reward, and eventually cache need. Later jobs expose memory, parallelization, power, SLA, latency, and coverage.

### 4.2 Effective Clock

At CPU scale:

`effective_clock = base_clock × clock_multiplier × cache_modifier × heat_modifier × power_modifier`

Clock speed is the main early-game speed driver.

### 4.3 Job Time

Base job time:

`base_seconds = required_cycles / effective_clock`

Final job time:

`final_seconds = base_seconds × cache_modifier × memory_modifier × scheduler_modifier`

### 4.4 Cache Modifier

Cache should be simple early and deeper later.

Early version:

- If cache is below job need, job takes longer.
- If cache meets job need, job runs normally.
- If cache exceeds job need, job gets a small bonus.
- Repeated similar jobs can gain additional cache efficiency after scheduler upgrades.

Example:

`cache_modifier = 0.85 if cache >= cache_need`

`cache_modifier = 1 + ((cache_need - cache) / cache_need × 0.5) if cache < cache_need`

### 4.5 Power Modifier

At all scales, power should work similarly.

`power_modifier = min(1, available_power / active_power_draw)`

If draw exceeds available power:

- Jobs slow down.
- Heat increases.
- SLA risk increases for SLA jobs.
- Severe overstrain can pause jobs or cause contract failure later in the game.

### 4.6 Heat Modifier

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
- Current job.
- Job duration.
- Credits.
- Data.

### Hidden

- RAM.
- Power.
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
| Clock | 10 Hz |
| Cache | 1 B |
| RAM | Hidden |
| Power | Hidden |
| Cooling | Hidden |
| Scheduler | None |

### Jobs

Early jobs should be tiny and direct:

| Job | Purpose |
|---|---|
| Bit Flip | Teaches jobs consume cycles |
| Byte Copy | Teaches clock speed |
| Packet Check | Teaches cache need |
| Tiny Checksum | Teaches repeated work |
| Micro Benchmark | Unlock gate |

### Unlocks

| Unlock | Requirement |
|---|---|
| Cache upgrades | Complete 3–5 jobs |
| Auto-repeat job | Complete 10 jobs |
| Micro benchmark | Buy several clock/cache upgrades |
| Multi-core research | Complete micro benchmark |

---

## Stage 1 — Single CPU Optimization

### Theme

The player improves a single-core CPU through clock and cache.

### Main Decisions

- Buy clock speed for broad speed.
- Buy cache for efficiency.
- Choose jobs that match current hardware.

### New Mechanics

- Benchmarks.
- Cache efficiency.
- Auto-repeat simple jobs.

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

- Several clock upgrades.
- Several cache upgrades.
- Completion of a parallelism benchmark.

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
| Second core | Complete parallelism benchmark |
| Basic queue | Own 2 cores |
| More cores | Buy core slots / reach CPU tier |
| Scheduler | Reach 4 cores |

---

## Stage 3 — Scheduler and Four-Core Milestone

### Theme

The player has enough parallelism that manual assignment becomes annoying. The scheduler solves that problem.

### Unlock Condition

Scheduler unlocks when the player reaches 4 cores.

### Scheduler Levels

| Level | Name | Effect |
|---:|---|---|
| 0 | None | Player manually starts jobs |
| 1 | Basic Queue | Idle cores pull jobs automatically |
| 2 | Priority Queue | Player chooses priority: credits, data, shortest job, longest job |
| 3 | Cache-Aware Queue | Groups similar jobs for cache efficiency |
| 4 | Multithread Scheduler | Splits eligible jobs across cores |
| 5 | Heterogeneous Scheduler | Routes jobs to CPU/GPU/NPU |
| 6 | Cluster Scheduler | Routes jobs across systems |
| 7 | Global Scheduler | Routes jobs across regions |

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

- Reaching 4 cores.
- Completing a multi-core benchmark.

### Major Rule

When the player buys the second CPU, RAM and power supply become visible.

### New Mechanics

- CPU sockets.
- Second CPU.
- RAM.
- Power supply.
- System-level throttling.

### RAM Role

RAM determines:

- Which jobs can start.
- How many jobs can be queued.
- How many simultaneous jobs can be held in memory.
- How well memory-heavy jobs perform.

RAM should not be heavily exposed before this stage. Before this point, memory can exist internally as hidden capacity.

### Power Supply Role

The power supply determines whether the system can support active hardware draw.

If active draw exceeds PSU capacity:

- Effective clock is throttled.
- Heat increases.
- Job completion slows.

At this point, power should still be forgiving. It should throttle before it fails.

---

## Stage 5 — Cooling and Overclocking

### Theme

The player learns sustained performance.

### Unlock Condition

Cooling unlocks after:

- Power supply is visible.
- Player first experiences heat throttling or unlocks overclocking.

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

Cooling should be introduced as the solution to a visible problem, not as an arbitrary early upgrade.

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

### Unlock Condition

Multiple systems unlock after:

- Completing a workstation benchmark.
- Saving or buying at least one system template.

### New Mechanics

- Buy additional systems.
- Save system templates.
- Assign jobs to systems.
- Compare machine roles.

### System Templates

| Template | Purpose |
|---|---|
| Balanced PC | General jobs |
| Compute Node | CPU-heavy jobs |
| Memory Node | Database and sorting jobs |
| GPU Node | Render and ML jobs |
| Low-Power Node | Efficient background jobs |
| Benchmark Rig | Unlock-focused builds |

### Automation

The player should be able to buy preconfigured systems instead of manually picking every component.

---

## Stage 8 — Networking and Local Cluster

### Theme

Systems cooperate.

### Unlock Condition

Networking unlocks after the player owns multiple systems.

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
| Compile | CPU/RAM | Mixed workload |
| Database Query | RAM/cache | Rewards memory and cache |
| Render Frame | Parallel compute | Rewards cores/scheduler |
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
| 2 | Clock speed | Primary throughput mechanic |
| 3 | Cache | First efficiency mechanic |
| 4 | Auto-repeat jobs | Reduces early clicking |
| 5 | Benchmarks | Adds progression gates |
| 6 | Second core | Introduces parallelism |
| 7 | More cores | Builds pressure for scheduling |
| 8 | Basic queue | Reduces manual assignment |
| 9 | Four-core milestone | First major CPU achievement |
| 10 | Scheduler | Automates local job assignment |
| 11 | Second CPU | Transitions to full system building |
| 12 | RAM | Adds capacity and queue constraints |
| 13 | Power supply | Adds system strain/throttling |
| 14 | Cooling | Solves heat/overclock constraints |
| 15 | Preconfigured CPUs | Reduces CPU micromanagement |
| 16 | Expansion slots | Adds specialization |
| 17 | GPU/NPU | Adds specialized workloads |
| 18 | Workload routing | Scheduler becomes smarter |
| 19 | Multiple systems | Fleet management begins |
| 20 | System templates | Reduces machine micromanagement |
| 21 | Networking | Systems cooperate |
| 22 | Sharding | Splits data across systems |
| 23 | Distributed computing | Splits work across systems |
| 24 | Server chassis | Systems become server units |
| 25 | Racks | Servers become infrastructure |
| 26 | Rack templates | Reduces server micromanagement |
| 27 | Data centers | Facility-scale power/cooling/network constraints |
| 28 | SLA contracts | Rewards stable infrastructure |
| 29 | Data center procurement policies | Reduces rack/server micromanagement |
| 30 | Availability zones | Adds failover, latency, and coverage |
| 31 | Region expansion | Adds geography and demand |
| 32 | Global scheduler | Automates regional placement |
| 33 | Planetary computing | Endgame policy layer |

---

## 12. Automation Roadmap

| Stage | Automation Unlock | What It Replaces |
|---|---|---|
| Early CPU | Auto-repeat | Manual restart of tiny jobs |
| 2 cores | Basic queue | Manually assigning jobs to each core |
| 4 cores | Scheduler | Core-by-core management |
| Full system | Preconfigured CPUs | Per-core CPU tuning |
| Workstation | Workload routing | Manual CPU/GPU/NPU assignment |
| Multiple systems | System templates | Rebuilding machines by hand |
| Networking | Shared queue | Manual per-system job assignment |
| Cluster | Cluster scheduler | Manual distributed job placement |
| Racks | Rack templates | Manual server purchasing |
| Data center | Procurement policy | Manual rack expansion |
| SLA phase | SLA-safe scheduling | Manual risk management |
| AZ phase | Failover policy | Manual redundancy handling |
| Region phase | Global scheduler | Manual regional routing |
| Planetary phase | Infrastructure policy | Most low-level operations |

---

## 13. Build Notes for Implementation

### 13.1 Minimum Viable Prototype Scope

The first prototype should include only:

- One core.
- Clock speed.
- Cache.
- A few jobs.
- Credits.
- Data.
- Clock upgrades.
- Cache upgrades.
- Multi-core unlock.
- Basic queue.

Do not implement RAM, power, heat, cooling, networking, data centers, or SLA in the first playable prototype unless the early loop already feels good.

### 13.2 First Vertical Slice Scope

A strong first vertical slice should include progression through:

1. Single core.
2. Clock/cache upgrades.
3. Multi-core unlock.
4. Four-core milestone.
5. Scheduler unlock.
6. Second CPU unlock.
7. RAM/power reveal.

This validates the most important design promise: complexity appears only after the player understands the previous layer.

### 13.3 Full Midgame Scope

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

### 13.4 Late Game Scope

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

1. Clock should always help, but should not remain the only optimal path.
2. Cache should be introduced early and matter most for repeated/small/structured work.
3. Cores should improve parallel throughput, not single-job speed, until scheduler upgrades.
4. RAM should become visible only when the player has enough parallelism for it to matter.
5. Power should first throttle, not destroy or fail.
6. Cooling should unlock only after heat is experienced or overclocking is unlocked.
7. Higher SLA jobs should pay more because they require safer infrastructure.
8. Uptime should emerge from headroom, redundancy, routing, and load management.
9. Availability zones should make high-SLA, low-latency, and coverage jobs easier than brute force.
10. Brute force should remain possible but inefficient.
11. Operating cost should include maintenance, staff, monitoring, and automation.
12. Every new scale should automate or abstract the previous scale.

---

## 15. Final Design Intent

The player should feel a continuous progression from tiny computation to planetary-scale infrastructure.

The same question repeats at larger scale:

**Can my compute system handle this job without overstraining its constraints?**

At first, the constraint is clock speed.

Then it is cache.

Then cores.

Then RAM.

Then power and cooling.

Then workload routing.

Then network bandwidth.

Then rack density.

Then data center power and thermal headroom.

Then SLA uptime.

Then latency and geographic coverage.

The game succeeds if every new layer feels like a natural enlargement of the same core system rather than a disconnected new feature.

