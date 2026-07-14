# IdleBit Full-Game Review — Findings Tracker

Generated 2026-07-11 by the multi-agent review session (Claude Fable 5 ultracode + GPT-5.6-Sol ultra via Codex CLI). Regenerated after the Fable workflow completed and triage finished. Fix wave completed 2026-07-11: 89 fixed / 4 partial / 1 skipped. Integration gate PASSED: 970/970 tests (116 files), typecheck clean (app/e2e/electron), production build clean. One stale UI test expectation (TaskBay DAG RAM held) was updated by the lead to match the corrected C-SIM-1 ledger semantics.

**Status legend:** `open` · `fix-queued → FIX-n` (accepted, assigned to that fix agent) · `fixed` (patched + focused tests green) · `refuted (by design)` · `designer-question` (needs a design ruling — intentionally NOT auto-fixed) · `deferred`.

## Fix-agent roster
- **FIX-1** — sim determinism & event boundaries (simulation.ts/advance.ts/thermal.ts)
- **FIX-2** — save-v7 hardening (save.ts)
- **FIX-3** — persistence lifecycle (useGamePersistence/platform/electron)
- **FIX-4** — content & economy corrections (src/game/content/*, contracts, ledger derivation)
- **FIX-5** — Live Operations cost scoping + formatting
- **FIX-7** — scheduler lifecycle + sim-side perf (simulation.ts, after FIX-1)
- **FIX-8** — reserved-geometry batch (UI)
- **FIX-9** — UI correctness, reveal gates, a11y, copy (after FIX-8)
- **FIX-10** — performance: selectors/progression/React memo (after FIX-9)
- **FIX-11** — balance-harness fidelity (src/game/balance/*)
- **FIX-12** — dev seeds for late chapters + seed-save safety (after FIX-3)
- **FIX-13** — Local Fabric managed-capacity UI (InfrastructurePanel)

## Review stats
- Fable 5 ultracode workflow: 72 agents, 3 playthrough scenarios (31 surfaces exercised), 7 review dimensions → 35 unique findings, all 35 survived adversarial verification (5 critical / 18 major / 12 minor).
- GPT-5.6-Sol ultra (Codex CLI 0.144): 59 findings (4 critical / 43 major / 12 minor) across simulation, UI, design.
- Overlap (found independently by both models): offline catch-up interval loss, seed-URL save clobber, RAM-residency ledger mismatch, impossible CPU child reservations, Server PSU domination, RAM channel research pricing.

---

## Lead + Fable playthrough fixed (FIX-9) fixed (FIX-9) partial (FIX-7) fixed (FIX-12) fixed (FIX-5) fixed (FIX-5) fixed (FIX-12) fixed (FIX-9) ||||||||| ID | Sev | Area | Finding | Status |
|---|---|---|---|---|
| PLAY-1 | 🟡 minor | Task cards | Cards advertise op-invocation counts ("4 operations") while paid work is ~12x larger (Packet Check: 48 units ≈ 20 s); duration invisible until run. Same as C-DES-21. | fix-queued → FIX-9 |
| PLAY-2 | 🟢 pass | Opening loop | Full opening chain + first-completion Data + benchmark research cards behaved correctly (lead, fresh save). | n/a |
| PLAY-3 | 🟢 pass | Coherent Machine | Multi-Core Control, Add Core (pixel-identical layout before/after), parallel C1/C2 execution, Local Scheduler + queue slot, queue-full blocking, cancel-pays-nothing, pin/inspect/settings/graph, exact persistence across reload — all clean, zero findings, zero console errors (Fable agent). | n/a |
| F-PLAY-1 | 🟡 minor | CRON schedule interval mode toggle | The seconds/minutes toggle button on a CRON schedule is inert at the default (un-upgraded) 60s minimum interval — clicking 's' produces no visible change and no feedback. | fix-queued → FIX-9 |
| F-PLAY-2 | 🟡 minor | Deadlock / cache-RAM pressure indicator | Could not reproduce the expected red deadlock pressure bar despite deliberately saturating RAM to 100% and queueing many cache/RAM-heavy tasks with policy=None and auto-kill off; the dispatched tasks instead sat indefinitely in a 0%-progress 'RAM load' sub-state with no error surfaced. | fix-queued → FIX-7 — Investigate: RAM-starved 0%-progress tasks need a player-facing blocked signal; confirm deadlock escalation thresholds. |
| F-PLAY-3 | 🟡 minor | Workshop / Thermal / GPU / NPU surface | The Workshop/Thermal panel (cooling tiers, overclock, heat/throttle status, GPU/NPU slots) is not reachable at all under the rack-ready seed's current campaign step, so step 8 of the scenario could not be exercised. | fix-queued → FIX-12 |
| F-PLAY-4 | 🟠 major | Automation > Live Operations | Live Operations charges the operating cost for the whole system's power draw, not just the idle cores reserved for the lane, guaranteeing catastrophic negative margins on any system beyond the tiny starter rig. | fixed (FIX-5) — lane economics scoped to incremental spare-core draw |
| F-PLAY-5 | 🟡 minor | Automation > Live Operations stat tiles | Live Operations Net/Power/margin figures are rendered as raw unrounded floating-point numbers instead of the app's normal formatted units. | fixed (FIX-5) — tiles use standard format helpers |
| F-PLAY-6 | 🟠 major | Late-game surfaces (Infrastructure/Cloud/Planetary) | Infrastructure, Cloud and Planetary panels were not reachable from the ?seed=trillion state, so items 6-8 of the test plan could not be exercised at all. | fix-queued → FIX-12 |
| F-PLAY-7 | 🟡 minor | Contract Market > blocker readout | Could not test an incompatible-system lane blocker because contract offers/active contracts have no UI control to (re)assign a target system — each offer is pre-bound to one system by the market generator. | fixed (ruling implemented) — acceptContract takes a player-chosen system; offer cards get a geometry-stable target select with shared lane-blocker validation |
| F-PLAY-8 | 🟡 minor | Campaign objective copy | The chapter objective text lists both sub-conditions ('Research CRON and configure a standing order') even when CRON research is already completed, without indicating partial progress. | fix-queued → FIX-9 |

Full playthrough evidence lives in the workflow transcript; scenario summaries: hardware surfaces (RAM/CPU/steppers/refunds/CRON/PSU kill-boot all pass; deadlock bar unreproduced), work surfaces (Campaign/Market/Automation/Live Ops/Builder pass incl. fixed-height active-work card; Infrastructure+ unreachable from seed).

---

## Fable 5 ultracode review — 35 verified findings

Every finding below survived adversarial verification (critical = 3 lenses, major = 2, minor = 1; unanimous unless marked MAJORITY).

### F-SIM-1 🟠 MAJOR — PSU-overload failure and bootstrap-grace countdowns have no event boundary and are sampled once per slice at the slice-end state, so how long an overloaded system runs/bills before its forced power-off depends on the caller's chunk size instead of hardware-derived timing.

- **File:** `src/game/simulation.ts:4641`
- **Category:** delta-invariance
- **Evidence:** getSingleSystemEventSeconds (simulation.ts:4641-4695) enumerates thermal, storage, power.transitionSeconds, unpaidShutdownWarningSeconds, cron spike/schedules, and per-operation events only — there is no candidate for (POWER_OVERLOAD_FAILURE_SECONDS - power.overloadFailureSeconds) / getPowerOverloadRate(stress) nor for power.bootstrapGraceSeconds. updatePowerOverloadFailure (simulation.ts:3965-4021, POWER_OVERLOAD_FAILURE_SECONDS = 10 in math.ts:49) is applied once per slice via applyDestructivePressure on the post-tick state (simulation.ts:4961), with the whole deltaSeconds, and forces power-off only when the accumulated value crosses 10 at the end of the slice. In advanceGame the slice can be as long as min(remainingMs, MAX_ADVANCE_STEP_MS = 15 min) when no other event exists (advance.ts:1516-1524). So advanceGame(600_000,'foreground') with a PSU stressed > 1: one 10-minute slice bills 10 minutes of overloaded power via applyPowerBilling (simulation.ts:4907-4920) and lets a long operation finish before forcePowerOffForPsuFailure fires, whereas the normal 500 ms foreground cadence (useGamePersistence.ts:52, FOREGROUND_ADVANCE_INTERVAL_MS = 500) kills the system after ~10 s and wipes the task. Worse, because the rate is read from the post-tick state, a slice that ends exactly at the operation-completion boundary evaluates stress on the now-idle system (rate 0, decay branch at simulation.ts:4012-4020) and never accrues overload at all. Same pattern for bootstrapGraceSeconds: applyPowerBilling (simulation.ts:4251-4266) subtracts the full slice from the grace and starts the shutdown warning at slice end, so grace expiry mid-slice is displaced by up to the slice length.
- **Suggested fix:** Add event candidates in getSingleSystemEventSeconds for (a) time-to-overload-failure ((POWER_OVERLOAD_FAILURE_SECONDS - overloadFailureSeconds) / getPowerOverloadRate(getPsuStress(projectedLoad))) when stress > 1, and (b) power.bootstrapGraceSeconds when credits <= 0 and grace > 0, so slices end exactly at the failure/grace boundaries regardless of caller chunking. Player-hit scenario: laptop sleeps with the tab visible (rAF stalls, no visibilitychange), on wake advanceGame receives minutes-to-hours in one foreground call; an overloaded rig either survives, completes work and burns credits for the whole first slice, or never fails at all — diverging from what the same wall time produces in normal 500 ms ticking, and from what a save replay through smaller chunks produces.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-1) — Added the two missing event-boundary candidates to getSingleSystemEventSeconds: (a) time-to-PSU-overload-failure ((POWER_OVERLOAD_FAILURE_SECONDS - overloadFailureSeconds) / getPowerOverloadRate(getPsuStress(projected pr

### F-SIM-2 🟠 MAJOR — Managed work (contracts and projects) is integrated with hardware rates sampled from the POST-tick state of each slice, so the paid work performed in a slice is retroactively re-rated by whatever the system looks like at the slice's end — making contract/project progress depend on caller chunk boundaries.

- **File:** `src/game/advance.ts:527`
- **Category:** delta-invariance
- **Evidence:** advanceManagedWork (advance.ts:520-552) is called as advanceManagedWork(state, tickNormalizedGame(state, stepMs, mode), stepMs, mode) (advance.ts:681-686 and 1553-1558); inside, advanceContracts(state=post-tick, ...) reads getSystemHardwareWorkRates(state, contract.systemId) (contracts.ts:894-899) and advanceProjects does the same (projects.ts:516). Those rates include the thermal-status throughput modifier via getEffectiveCoreClockHz (systemHardwareWork.ts:42-45, math.ts:976-995: hot=8500bps, critical=2500bps) and are zero when the system is not powered on (systemHardwareWork.ts:28-30). getThermalStatus assigns the HIGHER status at exact boundary contact (thermal.ts:299-316 uses '< 0'), and advance slices end exactly at thermal boundaries (getSingleSystemEventSeconds includes getNextWorkshopThermalEventMs). Concrete divergence: contract system heating toward the hot band, flip at t=100s. One-shot advanceGame(200s) slices [0,100][100,200]; slice [0,100] is credited at rates(t=100)=hot (85%) even though the system ran nominal the whole slice → 0.85*100 + 0.85*100 = 170 rate-units. Split advanceGame(50s)+advanceGame(150s) slices [0,50][50,100][100,200] → 1.0*50 + 0.85*50 + 0.85*100 = 177.5. Same for a system powering off at a slice end (unpaid warning): the entire final slice is re-rated at zero even though the system was on until the boundary, so a one-shot offline advance can lose minutes of contract work that 500 ms foreground chunking would have kept.
- **Suggested fix:** Pass the pre-tick slice-start state (already available as reservationState in advanceManagedWork) to advanceContracts/advanceProjects for rate sampling, keeping the predicate semantics unchanged. This makes each slice's managed-work integral use the rates that actually held over [t, t+dt] — piecewise-constant and invariant to where callers cut chunks. Players hit this as contracts finishing at different times (and different credit-flow timing) depending on frame timing / offline vs foreground, violating the exact paid-work-ledger timing rule.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-1) — Managed work is no longer retroactively re-rated by the slice-end state: advanceContracts and advanceProjects accept an optional rateState parameter (default = current behavior) used only for getSystemHardwareWorkRates s

### F-SIM-3 🟠 MAJOR — After a deadlock wipe, offline advancement stalls for the entire absence: the lockout blocks queue dispatch so the system is classified non-productive, the safety blocker consumes all remaining time in one 'Queue exhausted.' pause, and deadlock pressure never decays offline — while foreground play recovers in <=10 seconds.

- **File:** `src/game/simulation.ts:4564`
- **Category:** offline-divergence
- **Evidence:** cancelAllActiveTasksForDeadlockFailure sets deadlockPressureSeconds = 10 and deadlockProcessLockout = true (simulation.ts:3899-3903) but leaves top-level queue entries in place. getOfflineSystemActivity computes queueWouldStart via pullQueue (simulation.ts:4564-4567), and queue dispatch is blocked while lockout holds (canStartQueuedCpuEntry, simulation.ts:2317; isDeadlockStartBlocked, simulation.ts:638-639), so localWork=false and the system is excluded from productiveSystemIds. With no other productive source, getOfflineSafetyBlocker returns 'Queue exhausted.' (advance.ts:389-395) and the offline loop consumes ALL remaining absence in one pause (advance.ts:1531-1548, remainingMs = 0; break). In that pause path tickNormalizedGame runs with advanceAutomatedWork=false for the system, and updateDeadlockPressure is gated on policy.advanceAutomatedWork (simulation.ts:4962-4964), so the 10-second cooldown (decay rate >= 1/s, math.ts:51-52) never elapses no matter how long the absence is. Standing-order renewal is also blocked (canStartTask includes !isDeadlockStartBlocked, simulation.ts:647). Meanwhile offlineProcessedMs += simulationBudgetMs (advance.ts:1587-1596) still burns the automation buffer capacity for the paused time. Foreground, the identical state clears the lockout after ~10 s and pullQueue restarts the queued jobs.
- **Suggested fix:** In offline mode, decay deadlock pressure during paused/non-automated slices (or clear the recovery cooldown as part of applyOfflineIdlePowerPolicies), and re-evaluate the safety blocker after the cooldown boundary instead of consuming the whole absence in a single pause. Player-hit scenario: a deadlock auto-wipe fires, the player quits within the 10 s recovery window with jobs still queued; on return hours later the report says 'Queue exhausted.', zero credits were earned, and buffer capacity was consumed — where staying foreground would have resumed the same queue ~10 s after the wipe.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-1) — Offline absences no longer stall for the entire duration after a deadlock wipe: (1) tickSingleSystem now decays deadlock pressure (and clears the lockout) on slices where automated work is not advancing, whenever no live

### F-SIM-4 🟡 MINOR — Deadlock-recovery pressure decay (which gates queue restart via deadlockProcessLockout) has no event boundary, so in a large foreground advance the lockout only clears at the end of an up-to-15-minute slice instead of after the ~10-second cooldown, stalling queued work and billing idle power for the whole slice.

- **File:** `src/game/simulation.ts:3948`
- **Category:** delta-invariance
- **Evidence:** updateDeadlockPressure decays pressure by getDeadlockCooldownRate * deltaSeconds and clears deadlockProcessLockout only when the value reaches 0 (simulation.ts:3948-3962), evaluated once per slice. After a wipe there are no active operations, so getSingleSystemEventSeconds (simulation.ts:4641-4695) yields no candidate (the 0.1 s deadlocked-operation event at simulation.ts:4514 only applies while an operation is still deadlocked), and the advance loop takes steps up to MAX_ADVANCE_STEP_MS = 15 min (advance.ts:72, 1516-1524). During the slice, queue dispatch is blocked (canStartQueuedCpuEntry, simulation.ts:2317) and power is billed for the idle system; pullQueue only restarts work after the slice ends (simulation.ts:4967-4969). advanceGame(900_000) therefore produces ~15 min of stalled queue vs advanceGame(500)x1800 restarting after ~10 s — different credits earned and completions for identical elapsed time.
- **Suggested fix:** Add an event candidate for the pressure-decay-to-zero time (deadlockPressureSeconds / getDeadlockCooldownRate) while deadlockPressureSeconds > 0, mirroring the other countdown candidates in getSingleSystemEventSeconds. Player-hit scenario: after a deadlock wipe, a long rAF stall (system sleep with visible tab) delivers one large foreground advance; the queue that should have resumed 10 s after the wipe instead sits idle for up to 15 simulated minutes while power keeps billing.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-1) — Deadlock-recovery pressure decay now has an event boundary: getSingleSystemEventSeconds pushes deadlockPressureSeconds / getDeadlockCooldownRate when pressure is draining (no active scope), plus the exact rise-to-failure

### F-ECO-1 🔴 CRITICAL — RAM stick sell refund is computed from the install-cost curve at the stick's CURRENT upgraded capacity level scaled by 2^(stickCount-1), while capacity upgrades are priced per-level with no stick-count scaling, creating a repeatable buy->upgrade->sell loop that mints Credits from nothing.

- **File:** `src/game/content/upgrades.ts:1006`
- **Category:** refund-exploit
- **Evidence:** Cost side: new sticks always install at the tier's base level (getRamInstallLevelForContext, upgrades.ts:105-121 returns firstGlobalLevel when any stick exists), so the Nth stick costs upgradeCost(level 1) x 2^(N-1) (ramStickCosts, upgrades.ts:93-97). Capacity upgrades cost only ramCapacityCosts(level+1) = upgradeCost(level) x 2^(tierLevelIndex) with NO stick-count factor (upgrades.ts:1032-1038, ramTiers.ts:224-227). Refund side (upgrades.ts:1004-1012): halfRefund(ramStickCosts(getRamSticks(state).at(-1)?.level, getRamSticks(state).length)) prices the sale as if the stick had been INSTALLED at its upgraded level, multiplied by 2^(count-1). Empirically confirmed with a scratch vitest run on createRackReadyGameState: grow to 7 sticks, then one cycle = buy 8th stick (1,024 cr) + upgrade capacity 1->4 via 'buyUpgrade ramCapacity' (26+88+288 = 402 cr) + 'downgradeUpgrade ram' (refund 0.5 x 36 x 2^7 = 2,304 cr) => exactResources.credits net +878 per cycle, repeatable indefinitely. Profit scales with 2^(stickCount-1) up to the 32-stick limit (hardwareLimits.ts:18) - at 32 sticks a single level-3 upgrade cycle nets ~6.4e9 credits. Player-triggerable entirely through the normal upgrade/downgrade UI (actions in types.ts:1247-1266, refund granted in simulation.ts:5396-5407).
- **Suggested fix:** Refund half of what was actually paid for the stick: half of ramStickCosts(installLevel, stickCount) for the install (using the tier firstGlobalLevel it was installed at) plus half of the ramCapacityCosts/ramSpeedCosts actually spent on that stick, instead of pricing the sale off the install curve at the upgraded level.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-4) — RAM stick sell refund no longer prices the sale off the install curve at the stick's upgraded capacity level. New getRamStickPaidCosts derives what was actually paid: install at the stick's tier base level (with the doub

### F-ECO-2 🟠 MAJOR — The paid-work ledger assumes RAM pages stay resident across recipe steps (one ramLoad node per retained page), but each composition child runs as a fresh ActiveTask that physically re-stages the full page, so settled Credits undercount actual transferred bits on every composed-task completion and the authored work plan diverges from hardware-derived runtime.

- **File:** `src/game/content/tasks.ts:2050`
- **Category:** paid-work-ledger
- **Evidence:** Ledger: deriveDagNodes threads ramStates across recipe steps (tasks.ts:1999, 2050-2055) using summarizeRamRuntime, which retains a page only after a memory op (tasks.ts:228-259); paidWorkUnits derives from these node counts (getScaledPaidWorkUnits tasks.ts:2191-2205) and rewardCreditsExact = paidWorkUnitsExact (tasks.ts:2323). simulation.test.ts:1331-1341 asserts tinyChecksum has exactly ONE ramLoad node (256) and paidWorkUnits 324; simulation.test.ts:1354-1360 asserts compileCode's compileUnits subtask operationCount 168 = 160 cycles + 8 cache + 0 RAM (retained from stageSourceTree). Runtime: every composition child is a separate ActiveTask created with fresh idle coreOperations (simulation.ts:1434-1445); enterOperation's retention check (simulation.ts:1259-1281) only sees the SAME task's previous operation, and allocateRamBlocksForOperation (math.ts:510-553) allocates fresh blocks with loadedBits 0, so the follow-on child re-stages the whole page. Empirically confirmed with a scratch probe on createRackReadyGameState running tinyChecksum: the checksumStep child logged 'loadingRam | totalLoad=264 | reserved=256' - a full second 256-bit RAM staging that the ledger treats as retained. Failure scenario: every tinyChecksum completion executes ~580 units of lane work but settles 324 Credits (256 transferred bits unpaid, ~44% of the RAM lane); per compileCode x64 batch, 512 unpaid re-staged bits x 2 work units x 64 = 65,536 transferred bits go unpaid, violating the exact paid-work rule (Credits = transferred bits + executed cycles), and the task card's dag ('Stage RAM' once) misstates actual timing.
- **Suggested fix:** Make the two models agree: either drop the cross-step ramStates threading in deriveDagNodes so paid work counts one staging per child (matching runtime and estimateTaskSeconds, which already charges per-op with no retention, math.ts:1186-1203), or carry RAM residency across children of the same parent at runtime so the retained page is genuinely not re-staged.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-4) — Duplicate of C-SIM-1; same fix and tests.

### F-SCH-1 🟠 MAJOR — enqueueTask appends the top-level queue entry before reserveTaskOnCpuScheduler, but the reservation can silently no-op, leaving a permanently undispatchable orphan entry in state.queue/queueEntries.

- **File:** `src/game/simulation.ts:1645`
- **Category:** queue-lifecycle / slot-leak
- **Evidence:** enqueueTask (simulation.ts:1643-1660) builds `{...state, queue:[...state.queue, taskId], queueEntries:[..., queueEntry]}` and passes it to reserveTaskOnCpuScheduler, whose guard `if (getAvailableSchedulerSlots(state, cpuId) < reservedSlots) return state;` (line 1574) returns that state unchanged — entry present, no local reservation. The target cpuId comes from selectQueueCoreId (1537-1564): during ANY active deadlock or deadlockProcessLockout, schedulerCanDispatchOnCpu (1059-1062) is false for every CPU via isDeadlockStartBlocked, so `canUseCpu` fails everywhere and the function falls through to `return 1` (line 1559), i.e. CPU 1 — regardless of whether CPU 1 has slots. Dispatch scans only coreSchedulers[*].localQueueEntries (getCpuQueueEntries, 2290-2301), so a top-level entry without a local reservation can never dispatch. Runtime-confirmed on createRackReadyGameState (2 CPUs) with CPU1 schedulerSlots=0 and deadlockProcessLockout=true: `queueTask byteCopy` produced top entry `cpu-queue-1/byteCopy` with all local queues empty; after 60s of ticking (lockout fully cleared, machine idle) the entry was still queued, never ran (completedTasks unchanged from seed), local queues still empty. Failure scenario: player (or cron/standing-order automation) queues work while any deadlock/lockout is active and CPU 1's slots are occupied — the queued task silently never runs and dead entries accumulate until manually cancelled.
- **Suggested fix:** In enqueueTask, only commit the top-level queue entry if reserveTaskOnCpuScheduler actually reserved (compare result identity), and make selectQueueCoreId's fallback pick a CPU that satisfies the slot requirement (ignore dispatchability for reservation placement — reservations are legal while deadlocked, as reserveReadySystemChildWork already does via allowBlockedDispatch).
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-7) — enqueueTask no longer commits a top-level queue entry when the CPU reservation no-ops: the staged state is only kept if reserveTaskOnCpuScheduler actually reserved (identity check). selectQueueCoreId's silent 'return 1' 

### F-SCH-2 🟠 MAJOR — System-child reservations (and direct CPU enqueues) are placed onto CPUs checked only for free scheduler slots, never for core count or cache fit; an entry parked on a CPU that can never provision the task starves forever with no migration, permanently leaking scheduler slots and hanging the parent job.

- **File:** `src/game/simulation.ts:2144`
- **Category:** scheduler-starvation / slot-leak
- **Evidence:** getSystemChildCpuCandidates (2142-2165) filters candidates solely by `getAvailableSchedulerSlots(...) < slotCount` (line 2144); total core count vs task.minCores and cacheBits vs cacheNeedBits are never hard requirements (availableCoreCount is only a tie-break at 2197-2203). Dispatch then requires minCores idle cores on THAT cpu (selectCoreIdsForQueuedCpuEntry 2339-2345) and cache fit (canStartQueuedCpuEntry 2318), and no code ever migrates local queue entries between core schedulers. Runtime-confirmed: rack-ready state with CPU2 reduced to 1 core (2 scheduler slots kept, as a freshly installed CPU package has — installCpuPackage in content/upgrades.ts:343-377 creates 1-core CPUs while schedulerSlots are bought independently), queue busMirror twice; the second parent's child readBusWindow (minCores 2) was reserved onto CPU2's core 3 (`cpu-queue-3/4`), and after cancelling the first parent so the whole machine was idle for 120 simulated seconds, the parked entries were still on core 3, activeTasks empty, `system-queue-2/busMirror` still queued, completed count unchanged — permanent hang holding 2 CPU2 slots plus a system scheduler slot. The same missing provisioning check exists in selectQueueCoreId (1543-1553) for direct multi-core CPU enqueues.
- **Suggested fix:** Require candidates in getSystemChildCpuCandidates (and selectQueueCoreId's canUseCpu) to satisfy cpuCanProvisionTask with total core count and taskFitsCpuHardware for cache, mirroring what canQueueTask checks globally; alternatively add re-homing of local queue entries that are unprovisionable on their CPU.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-7) — Same change set as C-SIM-4 (the two findings are duplicates): provisioning-checked placement for system children AND for direct multi-core CPU enqueues via selectQueueCoreId's canUseCpu, plus release/migration of strande

### F-SCH-3 🟠 MAJOR — When the scheduler watchdog kills a child of a NON-chunked system parent (busMirror, thermalProbe, shardReconcile, checksumScan, etc.), it cancels the entire parent job with all completed child progress instead of requeueing the one child work unit as it does for chunked parents.

- **File:** `src/game/simulation.ts:3860`
- **Category:** watchdog-victim / work-loss
- **Evidence:** applySchedulerWatchdogs (3841-3867): `systemChildRequeued` runs only when `liveVictim?.parentTaskId && isChunkedTask(getTaskDefinition(liveVictim.parentTaskId))` (3857-3862); otherwise the fallthrough `cancelActiveTask(nextState, victim.taskId, victim.instanceId)` hits the `activeTask.parentQueueEntryId` branch (1898-1904) → cancelSystemParentReservation (1843-1862), which deletes every child task, every child reservation, and the parent's top-level queue entry — the whole job and its completedChildKeys progress are destroyed with no reward. Non-chunked system parents with RAM-holding children exist in content (content/tasks.ts: busMirror 1444-1470 children ramBits 512, thermalProbe 1471-1499, shardReconcile 1500-1541 — none set coreScaling "chunked"). Under the default killPolicy "deadlockedTask", the victim IS the deadlocked child, so ANY watchdog fire on such a child nukes the parent. Contrast: for chunked parents the same watchdog only requeues one work unit (requeueChunkedWorkUnit / cancelSystemChildWorkUnit, 3850-3861), and even the total 10s deadlock failure (cancelAllActiveTasksForDeadlockFailure 3873-3904) preserves parent system queue entries so the job restarts — making the gentler 3s watchdog strictly more destructive than a full crash. cancelSystemChildWorkUnit (1864-1881) already works for any child (removes the active child + its local reservation, leaving the childWorkKey unreserved for automatic re-reservation), so the chunked-parent guard is gratuitous. Failure scenario: RAM deadlock while a busMirror child is staged, watchdog autoKill enabled — the whole busMirror job silently disappears from the queue with its first composition step's progress lost.
- **Suggested fix:** In applySchedulerWatchdogs, route every victim that has parentTaskId/parentQueueEntryId through cancelSystemChildWorkUnit (drop the isChunkedTask(parent) condition) so only the child work unit is killed and the parent re-reserves it.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-7) — applySchedulerWatchdogs now routes every victim with parentQueueEntryId through cancelSystemChildWorkUnit (the isChunkedTask(parent) guard was dropped), so killing a child of a NON-chunked system parent (busMirror, therm

### F-SCH-4 🟡 MINOR — cancelAllActiveTasksForDeadlockFailure releases reservations by taskId occurrence counting instead of by the tasks' queueEntryId, so with duplicate same-task queue entries spread across core schedulers it can remove the wrong reservation — leaving a stale local reservation that ghost-redispatches one task and an orphaned top-level entry that never runs.

- **File:** `src/game/simulation.ts:3892`
- **Category:** deadlock-recovery / queue-lifecycle
- **Evidence:** cancelAllActiveTasksForDeadlockFailure (3873-3904) wipes activeTasks and calls `removeQueuedTaskReservation(nextState, activeTask.taskId, occurrenceIndex)` (3892-3896), where occurrenceIndex is derived from activeTasks ordering, while removeQueuedTaskFromLocalScheduler (1663-1712) removes the first `slotCount` matching-taskId local entries in Object.entries(coreSchedulers) iteration order. Dispatch is rank-based, not FIFO (selectCpuQueueDispatchCandidate 2397-2406), so the dispatched instance's entries need not be the first matching entries: with queue=[A@q1 dispatched, A@q2 waiting] where q2's local entries sit on a lower-numbered core, the failure path removes q1's top-level entry but q2's LOCAL entries. Result: q1's local entries survive with reservationId q1 not in activeReservations → getCpuQueueDispatchCandidates (2358-2395) re-dispatches A a second time from the stale reservation (its completion at 2674-2677 then no-ops on the missing top-level id), while q2's top-level entry has no local reservation left and can never dispatch (same orphan mechanism as finding 1). Every other cancel/complete path is id-based (removeLocalQueueReservationById 1750-1780, removeTopLevelQueueEntryById 1813-1826); only this failure path still uses the legacy occurrence method on id-reserved tasks.
- **Suggested fix:** For active tasks with queueEntryId, release via removeTopLevelQueueEntryById + removeLocalQueueReservationById(activeTask.queueEntryId) (as cancelActiveTask does at 1914-1919), keeping the occurrence-based path only for legacy tasks without ids.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-7) — cancelAllActiveTasksForDeadlockFailure now releases each wiped task's reservation by queueEntryId (removeTopLevelQueueEntryById + removeLocalQueueReservationById), matching every other cancel/complete path; the legacy oc

### F-PER-1 🔴 CRITICAL — A v7 save that JSON-parses but contains a non-object entry in systems[] or hardware.cpus[] makes normalizeState throw; deserializeSave swallows the exception and returns a fresh initial state, and hydration immediately persists that fresh state over the original save, permanently destroying it with no error or backup.

- **File:** `src/game/save.ts:1105`
- **Category:** save-wipe
- **Evidence:** deserializeSave wraps the whole load in try/catch returning createInitialGameState (src/game/save.ts:1105-1109). Reachable throw sites inside normalizeState: normalizeSavedSystemWorkOrigins reads system.activeTasks with no null/object guard on each systems[] entry (save.ts:575), and hardware.cpus.map((cpu) => createCpuHardwareState(cpu.id, ...)) reads cpu.id with no guard (save.ts:725-726). Empirically verified with a scratch vitest probe: an envelope with state.systems=[null] (or state.hardware.cpus=[null]) round-trips to a fresh state (credits 555 -> 10, time.lastSavedAtMs null). The hydrate flow then calls persistState(hydrated, ...) unconditionally (src/ui/hooks/useGamePersistence.ts:323), overwriting SAVE_KEY; writeBlockedRef quarantine (useGamePersistence.ts:330) never triggers because the exception never escapes deserializeSave. Failure scenario: any partially-corrupted but parseable save (interrupted write, manual edit, or a shape an older build wrote) is silently replaced by a brand-new game on next launch instead of surfacing a load error and preserving the file.
- **Suggested fix:** Distinguish 'no save' from 'load failed' in deserializeSave (return a discriminated result or rethrow after the version check), and have hydrate treat normalization failure like the read-failure path: set writeBlockedRef, keep the raw save on disk (optionally copy to a backup key), and show the load error instead of persisting a fresh state. Additionally guard per-entry shapes (systems[], hardware.cpus[]) with the same isRecord filtering used elsewhere in normalizeState.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-2) — normalizeState now filters non-object entries out of state.systems[] and hardware.cpus[] with isRecord before mapping (with an explicit fallback to a single default CPU package when every cpu entry is invalid), and getSa

### F-PER-2 🟠 MAJOR — If a departure save fires while offline catch-up is still running (tab re-hidden, window closed, or Electron before-close during 'Processing offline time…'), the catch-up result is discarded and departedAtMs is re-stamped to now on the un-advanced state, silently dropping the entire prior offline window.

- **File:** `src/ui/hooks/useGamePersistence.ts:379`
- **Category:** offline-progress-loss
- **Evidence:** persistCurrentState('departure') calls invalidateCatchup() (useGamePersistence.ts:379), bumping catchupTokenRef so resumeFromDeparture's resultIsStale() discards the finished advance (useGamePersistence.ts:438-450). It then stamps recordDeparture(stateRef.current, now) (useGamePersistence.ts:397) where stateRef.current is still the departed, un-advanced state; recordDeparture unconditionally overwrites time.departedAtMs with the new timestamp (src/game/automation.ts:251-263). The hook's own test asserts the re-stamp (useGamePersistence.test.tsx:386-403: departed at 2_000, resumed at 3_000, hidden again at 4_000 -> departedAtMs 4_000) while the 2_000-4_000 earnings are never applied and never can be. Failure scenario: player returns after 8 hours, the catch-up worker is still crunching (multi-second for large fleets), player switches tabs or closes the app; next launch computes elapsed from the new stamp and the 8 hours of offline progress vanish. Triggered from visibilitychange-hidden (line 530), pagehide (line 537), and Electron onBeforeClose (line 553).
- **Suggested fix:** When kind === 'departure' and stateRef.current.time.departedAtMs is already non-null (catch-up pending or never resumed), preserve the existing departedAtMs instead of re-stamping (only update lastSavedAtMs), so the next resume still simulates from the original departure point.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-3) — Duplicate of C-UI-1 (same trace: invalidateCatchup + recordDeparture on the un-advanced stateRef). Fixed by the same change — the departure save during pending catch-up preserves the original departedAtMs/buffer snapshot

### F-PER-3 🟠 MAJOR — Stale parentTaskId (and parentQueueEntryId/childTaskId) survive v7 sanitization on both queue entries and active tasks, and unguarded getTaskDefinition consumers in the simulation throw 'Unknown task: <id>' when the entry starts or the child completes, crashing advanceGame after an otherwise successful load.

- **File:** `src/game/save.ts:305`
- **Category:** stale-reference
- **Evidence:** normalizeQueueEntries spreads the raw entry ('...(value as unknown as TaskQueueEntry)', save.ts:305) and normalizeActiveTask spreads '...task' (save.ts:522) without validating parentTaskId; only its use inside normalizeTaskBatchSnapshot is guarded (save.ts:246-248). Empirically verified: a round-trip of a rack-ready save with running compileCode children whose parentTaskId was renamed to 'removedLegacyTask' loads with activeTasks parents = ["removedLegacyTask","removedLegacyTask"] and queueEntries[0].parentTaskId intact. Throwing consumers: startTaskFromQueueEntry calls getTaskDefinition(entry.parentTaskId) unconditionally when a persisted entry is started (simulation.ts:1375-1376); completeChildTask calls getTaskDefinition(parentTaskId) when a restored child completes (simulation.ts:2591-2595); also simulation.ts:3026 and 1989-1990. getTaskDefinition throws on unknown ids (content/tasks.ts:2379-2386). Every other persisted id field is sanitized (isTaskId filters, the kernelScheduler->systemScheduler rename map at save.ts:345), so pre-live task renames/removals will hit this: the save loads, then the first tick that starts/completes the affected work throws inside advanceGame - during hydration catch-up this becomes a permanent 'Load failed' quarantine on every launch; in-session it is an uncaught exception inside the rAF setState.
- **Suggested fix:** In normalizeQueueEntries and normalizeActiveTask, validate parentTaskId with isTaskId and null it (or drop the entry/convert the child back to a standalone task) when stale; do the same for childTaskId and clear parentQueueEntryId when the parent entry no longer exists.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-2) — Stale parent/child task references are now sanitized on load with guarded lookups: normalizeQueueEntries drops entries whose parentTaskId is not a known TaskId and validates parentQueueEntryId against the surviving-entry

### F-PER-4 🟡 MINOR — Opening the app with ?seed=rack-ready (dev builds) silently replaces the existing real save: the seeded state is committed and immediately persisted to the same SAVE_KEY with no confirmation or backup.

- **File:** `src/ui/hooks/useGamePersistence.ts:264`
- **Category:** seed-clobbers-save
- **Evidence:** hydrate() takes the seed branch (useGamePersistence.ts:264-266: restored = createRackReadyGameState(); clearRackReadySeed()) and then unconditionally persists (useGamePersistence.ts:323: persistState(hydrated, ...)), writing over 'save-v7' (src/ui/app/persistence.ts:4, 105-108). clearRackReadySeed also strips the query param so a reload keeps the seeded save. Gated to dev by import.meta.env.DEV (src/ui/App.tsx:17, src/ui/app/persistence.ts:37-43), but a developer or tester with a long-running progression save loses it permanently by following a rack-ready link once.
- **Suggested fix:** Before persisting a seeded state, snapshot the existing save to a backup key (e.g. save-v7.pre-seed) or keep seeded sessions in-memory only (skip persistState while seedRackReady is active).
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-3) — Duplicate of C-UI-2 — pre-seed one-slot backup (save-v7.pre-seed) written before the rack-ready seed replaces save-v7; backup failure aborts into load-error quarantine instead of clobbering.

### F-PER-5 🟡 MINOR — Electron flush-on-close is best-effort only: the close handshake force-closes after 1.5s even if the departure save has not been dispatched, the main process has no will-quit flush of the persistence write queue, and the Electron adapter's setImmediate is a no-op, so the pagehide fallback cannot write synchronously.

- **File:** `electron/closeHandshake.ts:32`
- **Category:** electron-flush-gap
- **Evidence:** DEFAULT_CLOSE_HANDSHAKE_TIMEOUT_MS = 1_500 and the timeout path calls complete() -> requestClose() regardless of save progress (electron/closeHandshake.ts:32, 129-131). The renderer's departure save is queued behind any in-flight autosave on saveQueueRef (useGamePersistence.ts:166-173), and each write is a full read+rewrite+rename of the whole JSON store over IPC (electron/persistenceStore.ts:112-131), so a slow disk or large (up to 5MB) store can exceed the window; the window is then destroyed and the un-dispatched departure write is lost. electron/main.ts registers no 'will-quit' handler awaiting the store's writeQueue (main.ts:155-188), so a write in flight when app.quit() proceeds can be cut off (tmp+rename keeps the previous file, so no corruption, but the final save is dropped). The Electron adapter's setImmediate only validates and returns false (src/platform/persistence.ts:191-195), so the pagehide 'immediate' strategy never persists on Electron. Player impact is bounded because hydrate falls back to lastSavedAtMs for offline credit (useGamePersistence.ts:274-275): worst case loses ~saveIntervalMs (4s) of foreground progress plus the departure stamp.
- **Suggested fix:** Await the persistence store's writeQueue in a 'will-quit' handler before allowing quit, and/or scale the handshake timeout to cover a worst-case store rewrite; optionally have the renderer send the serialized save synchronously via a dedicated flush IPC on before-close.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-3) — Electron flush-on-close hardened on all three cited gaps: (1) closeHandshake timeout raised from 1.5s to DEFAULT_CLOSE_HANDSHAKE_TIMEOUT_MS = 5s, sized for a departure save with retries over a full store rewrite, and the

### F-PER-6 🟡 MINOR — Several scalar fields escape v7 normalization: cron.nextScheduleId and power.failureCount become NaN from non-numeric input, deadlockPressureSeconds accepts negatives/garbage raw, and nextInstanceId passes through the raw ...state spread untyped, so corrupt values live in game state for the session.

- **File:** `src/game/save.ts:997`
- **Category:** normalization-gap
- **Evidence:** Empirically verified with a scratch probe: an envelope with cron.nextScheduleId='nan-maker', power.failureCount='many', deadlockPressureSeconds=-99, nextInstanceId='x' loads to nextScheduleId=NaN (Math.max(1, non-number) at save.ts:997-1000), failureCount=NaN (Math.max(0, string) at save.ts:993), deadlockPressureSeconds=-99 (save.ts:1006, no validation), and nextInstanceId='x' (only reaches state via the '...state' spread at save.ts:854, never re-normalized). Consequences: a cron schedule created that session gets id NaN (simulation.ts:271) and normalizeCronSchedules' Math.max(1, toInteger(schedule.id, ...)) only repairs it after the next save/load; new task instance ids become 'task-x' and string-concatenate on increment; negative deadlock pressure delays deadlock recovery. Self-heals partially because JSON.stringify(NaN) writes null which hits fallbacks on the following load, but the first post-load session runs with the corrupt values.
- **Suggested fix:** Route these through the existing helpers: nextScheduleId/failureCount/nextInstanceId via toInteger/clampFiniteInteger with fresh-state fallbacks, deadlockPressureSeconds via toNonNegativeNumber.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-2) — Scalar fields that previously escaped v7 normalization are now coerced through the existing helpers: cron.nextScheduleId and nextInstanceId via toInteger with fresh-state fallbacks inside Math.max(1, ...) (no more NaN fr

### F-UI-1 🟠 MAJOR — Pinned System/Distributed tasks are permanently disabled in the pinned bar because the route is resolved with the hard-coded default category "cpu" instead of each task's category.

- **File:** `src/ui/tasks/PinnedTaskBar.tsx:50`
- **Category:** wrong-behavior
- **Evidence:** PinnedTaskBar.tsx:50-53 calls `resolveTaskRoute(visible, selectedComponent)` with no category argument; taskData.ts:194 defaults `category` to "cpu", so for a normal core/scheduler selection the mode resolves to "core" or "scheduler". Line 105 then computes `getTaskCanUseAction(task, routeMode)`, which for mode "core"/"scheduler" requires `task.category === "cpu"` (taskData.ts:273-274), so any pinned system/distributed task is disabled with reason "Use system scheduler" (taskData.ts:282-284). This contradicts TaskBay, which resolves per-group category (TaskBay.tsx:96-100) — the test "routes system tasks through the system scheduler regardless of CPU selection" (HardwareBoard.schedulerLayout.test.tsx:1037-1089) proves the same task with the same selection is enabled and dispatches `queueTask` from the task bay. `dispatchRunTask` itself re-resolves by task category (taskData.ts:237-241) and would route correctly — only the disable gate is wrong. Players can pin non-CPU tasks: TaskBay passes `onTogglePin` for every group (TaskBay.tsx:153-158).
- **Suggested fix:** Resolve the route per pinned task using `getTaskCategory(task)` (mirroring TaskBay's per-group resolution) before computing `getTaskCanUseAction`/`getTaskActionDisabledReason`, and compute `routeCoreBusy` only for cpu-category tasks.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-9) — PinnedTaskBar resolves the route per pinned task via getTaskCategory(task) (mirroring TaskBay's per-group resolution) instead of one hard-coded default-"cpu" route: pinned system/distributed tasks are now enabled with a 

### F-UI-2 🟠 MAJOR — Research cards change grid geometry (2 columns -> 1 column, button drops to its own full-width row) whenever `blocked` flips with affordability, so cards visibly grow/shrink as credits tick past a cost or the player spends credits.

- **File:** `src/ui/tasks/ResearchPanel.tsx:214`
- **Category:** layout-shift
- **Evidence:** ResearchPanel.tsx:214 sets `research-action-main ${!canBuy && !purchased ? "blocked" : ""}` where `canBuy` includes `canAffordResearch` (lines 192-198), which flips every 500ms sim publish as credits change. research-panel.css:54-64 switches `.research-action-main` from `grid-template-columns: minmax(0,1fr) auto` to single-column when `.blocked`, and lines 113-116 make the button `width:100%` on its own row — the card height changes by a full control height (~32px), reflowing the whole research list. The same pattern exists on compute rows (`research-compute.blocked`, ResearchPanel.tsx:280 + research-panel.css:175-178, 228-231) and AutomationBufferAction (line 103). This directly violates the project hard rule (no reflow on state changes) that TaskCard explicitly honors — task-panel.css:118-122 documents "Blocked: identical geometry; reason renders inside the button" and keeps the same grid areas for `.task-card.is-blocked` (task-panel.css:142-148).
- **Suggested fix:** Keep the blocked and ready states on identical grid geometry like TaskCard does: render the reason inside the fixed-position button (or reserve the button column) instead of switching grid-template-columns on the `.blocked` class.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-8) — Research cards no longer regrid on blocked/affordability flips: .research-action-main is a fixed minmax(0,1fr)/110px grid in every state (the .blocked grid-template override and full-width button row were removed), the b

### F-UI-3 🟠 MAJOR — Starting a research compute task inserts a ModuleMeter element into the row (`(active || completed) && <ModuleMeter/>`), growing the row height at the exact moment the player presses Run — a conditional insert on the enumerated "starting work" state change.

- **File:** `src/ui/tasks/ResearchPanel.tsx:286`
- **Category:** layout-shift
- **Evidence:** ResearchPanel.tsx:286-288: `{(active || completed) && (<ModuleMeter value={completed ? 1 : task.progress ?? 0} />)}` inside `.research-compute-copy` (a flex column, research-panel.css:180-185) — the meter (3px bar + gap, base.css:338-345) is absent while idle and appears when `task.active` becomes true, so the compute row and everything below it shifts down when work starts, and shifts back up when it completes/fails. The button label simultaneously swaps Run -> "..." (lines 268-276). No space is reserved for the meter in idle state.
- **Suggested fix:** Always render the ModuleMeter (value 0 when idle) so the row height is constant, matching the TaskMetaLine recipe-bar approach ("The bar always renders at fixed height so live state changes never reflow the card", task-panel.css:245-250).
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-8) — The research compute-row ModuleMeter is now always mounted (value 0 idle, progress while active, 1 when complete), so pressing Run fills the reserved meter row instead of inserting it and reflowing the list — matching th

### F-UI-4 🟡 MINOR — The pinned-row action button is auto-width with a swapping label ("Assign" + Play icon <-> "Core busy"/"Use system scheduler", icon removed), so the button and the task-name column resize horizontally whenever work starts or completes on the routed core.

- **File:** `src/ui/tasks/PinnedTaskBar.tsx:118`
- **Category:** layout-shift
- **Evidence:** PinnedTaskBar.tsx:118-119 swaps `buttonLabel` to the disabled reason, and line 145 removes the Play icon when blocked. pinned-task-bar.css:138-141 lays the row out as `grid-template-columns: minmax(0,1fr) auto` and `.pinned-task-action` (lines 187-205) has no fixed width and `white-space: nowrap`, so the `auto` column resizes to the new label (e.g. "Assign" -> "Core busy" when the player assigns a task to the selected core), shifting the button under the pointer mid-interaction and re-truncating the task name. TaskCard avoids exactly this by making its run button full-width ("Full width is kept so long blocker strings swap in without any geometry change", task-panel.css:443-446); the pinned bar missed that treatment. Row height stays fixed (min-height 40px, nowrap) so the shift is horizontal only.
- **Suggested fix:** Give `.pinned-task-action` a fixed flex-basis/min-width sized for the longest expected label (or reserve the icon slot and ellipsize the label inside a fixed-width button) so the grid columns never resize on state changes.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-8) — The pinned-row action button now has a fixed 112px width with an ellipsized label span, so 'Assign' <-> 'Core busy'/'Use system scheduler' swaps relabel in place without resizing the row's grid columns or moving the butt

### F-UI-5 🟡 MINOR — Unsaved Automation-tab form state (standing-order job and target system dropdowns) is silently wiped whenever the player selects a different system anywhere in the UI, because an effect resets local state on `visible.selectedSystem.id` changes.

- **File:** `src/ui/work/WorkPanel.tsx:77`
- **Category:** effect-dep-state-reset
- **Evidence:** WorkPanel.tsx:77-86 runs `setStandingTaskId(visible.standingOrder.taskId); setTargetSystemId(...)` with `visible.selectedSystem.id` in the deps. Clicking any rack system card dispatches `selectSystem` (SystemRackPanel.tsx:48-62), which changes `selectedSystem.id` and re-runs the effect, discarding a job the player picked in StandingOrdersView (WorkViews.tsx:519-532) before pressing Configure, and also resetting the project target-system select (ProjectsView, WorkViews.tsx:264-281) that shares `targetSystemId`. LiveOperationsView.tsx:53-55 has the same pattern for its unconfigured system select. Failure scenario: player opens Automation, picks "Tiny Checksum" as standing order, glances at the fleet and clicks a system card to inspect it, returns — the dropdown is back to "Select a job".
- **Suggested fix:** Only sync local form state from `visible.standingOrder.*` when those values themselves change (drop `selectedSystem.id` from the reset path, or track a dirty flag so user edits are never overwritten by selection changes).
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-9) — WorkPanel's form-sync effect no longer lists visible.selectedSystem.id in its deps and preserves the current target when standingOrder.systemId is null; LiveOperationsView's system-select effect got the same treatment. S

### F-UI-6 🟡 MINOR — CoreDie is a div with role="button" that nests a real <button> (cancel) inside it, and CpuSummaryCard nests several buttons inside another role="button" div — invalid nested interactive controls that corrupt the accessible name and confuse screen-reader/keyboard interaction.

- **File:** `src/ui/hardware/CoreArraySection.tsx:179`
- **Category:** a11y
- **Evidence:** CoreArraySection.tsx:177-207: `<div role="button" tabIndex={0} aria-pressed ...>` contains `<button className="core-cancel-button" aria-label={`Cancel ${active.name} on ${coreLabel}`}>` (lines 197-207) whenever a task runs — WAI-ARIA forbids interactive descendants inside a button role; the die's accessible name (computed from contents) now includes the cancel button's content, and Enter/Space handling on the outer div (lines 171-175) competes with the inner button. CpuBank.tsx:86-98 repeats the pattern: `cpu-summary-card` div role="button" contains the open-full button (107-118) and one real `<button>` per core (208-233). Failure scenario: a screen-reader user focused on the die hears a merged label ("C1 3 Hz Cancel Byte Copy...") and NVDA/VoiceOver may not expose the inner cancel control at all in forms/browse mode.
- **Suggested fix:** Make the die itself a sibling button layered under the cancel button (absolute-positioned cancel already allows this), or replace the outer role="button" with a plain container plus a dedicated visually-stretched select button, as RackSystemCard.tsx:152-159 already does correctly.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-9) — Same restructure as C-UI-18: CoreDie's cancel button is no longer a descendant of a role="button" element (die is a plain container + stretched sibling select button), and CpuSummaryCard's open-full/core-cell buttons are

### F-UI-7 🟡 MINOR — The DeadlockCountdown chip is inserted into the flex-wrapping core-array header the moment deadlock pressure appears (work failing), pushing the "All" toggle and Core stepper and potentially wrapping the header to a second line.

- **File:** `src/ui/hardware/CoreArraySection.tsx:65`
- **Category:** layout-shift
- **Evidence:** CoreArraySection.tsx:65-68 conditionally renders `<DeadlockCountdown pressure ... compact/>` between the "Cores" label and the header controls; DeadlockHelp.tsx:14 returns null while `pressure.seconds <= 0`, so the element pops into existence exactly when a deadlock starts ticking (a "failing work" state change under the no-reflow rule). `.core-array-header` is `display:flex; flex-wrap:wrap` (core-array.css:33-44) with no space reserved, so on narrow boards the header gains a row and the core grid below shifts down; when the countdown drains to 0 it disappears and everything shifts back. Same insertion pattern in the cache header path via `shouldShowCacheDeadlockPressure`.
- **Suggested fix:** Reserve the countdown slot in the header (render it always with visibility/opacity toggling, or fix the header to a constant min-height that accommodates the wrapped chip) so deadlock onset changes color/content but not geometry.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-8) — CoreArraySection pre-reserves the DeadlockCountdown chip footprint: a fixed 174x28px .core-array-deadlock-slot renders in the header whenever deadlock pressure is possible for the socket (the deadlockPressure prop, gated

### F-PERF-1 🔴 CRITICAL — getCpuForCore/getCpuHardware rebuild a full normalized CPU object on every call and are invoked per core inside hot loops, making every power/thermal computation O(cores^2) with heavy allocation; at fleet scale the foreground advance can no longer keep up with its own 500ms clock.

- **File:** `src/game/progression.ts:394`
- **Category:** per-tick-quadratic-hot-path
- **Evidence:** getCpuHardware (progression.ts:380-392) runs normalizeCpuHardware -> createCpuHardwareState (progression.ts:313-378: Array.from(new Set(...)) over up to 64 coreIds plus full object construction) on EVERY call; getCpuForCore (progression.ts:394-398) additionally does cpus.find(cpu => cpu.coreIds.includes(coreId)). getBaseHardwareDrawWatts (math.ts:1329-1339) calls getCpuForCore once and getCoreClockHz once per core, and getCoreClockHz (progression.ts:90-94) itself calls getCpuForCore twice — 3 full CPU rebuilds x O(cores) scan per core, per call. That function is invoked several times per system per tick (tickSingleSystem thermal at simulation.ts:4889, billing via getPowerCostPerSecondExact -> getHardwareDrawWattsExact at math.ts:1408-1410, getPsuStress at math.ts:1390, plus every event query via getSingleSystemEventSeconds at simulation.ts:4655-4657). Measured (node, this dev machine): getBaseHardwareDrawWatts = 1.2ms for a 128-core system, 6.1ms for a 512-core system (the documented ceiling, hardwareLimits.ts:11-12). CPU profile of one advanceGame+deriveVisibleState at 16x128-core fleet: createCpuHardwareState 21.0% + normalizeCpuHardware 20.2% + syncHardwarePackages 5.0% + getAllCoreIds 4.9% + getCpuForCore 2.2% = ~53% of all samples. Net: advanceGame(state, 500, "foreground") measured 114ms on the stock 2-system rack-ready seed and 1,793ms at a 16x128-core fleet. The rAF loop in useGamePersistence.ts:496-505 accumulates all wall time and passes it uncapped to advanceGame (advance.ts:1471 sets remainingCapacityMs = requestedMs for foreground), so once one advance takes longer than the span it simulates, the next accumulated span is larger still — cost grows without bound and the app freezes.
- **Suggested fix:** Compute the normalized CPU list once per state generation (they are already normalized by ensureSystems/syncHardwarePackages — getCpuHardware can trust state.hardware.cpus after normalization instead of re-normalizing per call), and build a coreId->cpu lookup map once per pass instead of find+rebuild per core. Cache getBaseHardwareDrawWatts per (system, tick) since it is pure in state.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-10) — getCpuHardware/getCpuForCore no longer rebuild normalized CPU objects per call: a WeakMap cache keyed on the (immutably-updated) state.hardware object builds the normalized package lookup (byId, byCoreId, fallback) once 

### F-PERF-2 🔴 CRITICAL — deriveVisibleState rebuilds the entire VisibleState — including a full jobs/upgrades/tasks/cpuSockets payload for every rack system via getVisibleSystemSummary — on the render thread on every 500ms state update; measured 225ms on the stock seed and 1.4-2.5s at documented hardware scale.

- **File:** `src/game/selectors.ts:2266`
- **Category:** render-thread-blocking-selector
- **Evidence:** App.tsx:47 recomputes useMemo(() => deriveVisibleState(state), [state]) on every foreground advance (every 500ms). deriveVisibleState (selectors.ts:2253-2268) maps getVisibleSystemSummary over ALL rack systems; each summary (selectors.ts:2112-2238) runs materializeSystem plus the complete per-system payload — getVisibleJobs (all available tasks with batch projections), getAvailableUpgrades x getVisibleUpgrade, getCpuSockets, taskDefinitions filter+map — even for the 15 unselected systems whose rack cards only show summary numbers. Measured: 225ms with the stock 2-system rack-ready seed (132 cores), 1,392ms with one 512-core machine, 2,512ms with 16x128-core systems — every 500ms, synchronously on the UI thread, on top of the advance itself (114ms/1,793ms). Combined stock-seed cost is ~340ms of every 500ms interval.
- **Suggested fix:** Compute the full visible payload only for the selected system and a lightweight summary (name/power/psu/queue counts) for the rest; memoize per-system summaries keyed on the system slice identity so unchanged systems are not recomputed.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-10) — deriveVisibleState no longer re-normalizes the whole fleet per system: ensureSystems and materializeSystem results are cached by state identity in selectors.ts (pure functions, immutable state), so one snapshot shares a 

### F-PERF-3 🟠 MAJOR — The standing-order bulk path that makes the '7-day batch in bounded time' claim true is disabled whenever any cluster workload or Cloud work is active, or any other system has local work — so late-game saves event-step the entire 168h absence at task-cycle granularity, taking hours of wall time to hydrate.

- **File:** `src/game/advance.ts:224`
- **Category:** offline-batch-path-bailout
- **Evidence:** canAttemptStableStandingCycle (advance.ts:213-232) returns false when hasActiveClusterWorkloads(state) || hasActiveCloudWork(state) (lines 224-225) or when any other system has local work (lines 229-231); repeatStableStandingCycle (advance.ts:810-1032) then never multiplies, and the outer while loop (advance.ts:1484) steps at every operation event of the standing task (~seconds of sim time per step via getNextNormalizedSimulationEventMs). Measured offline throughput at 16x128-core fleet: 4,630ms wall to process a 10-minute absence of which only 1,441ms sim was productive (~3.2ms wall per productive sim-ms, i.e. 3.2x slower than real time); a 168h buffer (automation.ts:108) of dense standing-order cycles at this rate is tens of hours of wall time inside 'Processing offline time…' (useGamePersistence.ts hydrate/resumeFromDeparture). The acceptance test for the claim (campaignFoundation.test.ts:646-658, bound <1,000ms not ~1ms) only exercises a minimal single-system fetchBit save where the bulk path engages. Spec section 0 makes Cloud SLAs and cluster workloads the standing late-game state, so players will hit the degenerate path exactly when their fleet is largest.
- **Suggested fix:** Allow the stable-cycle collapse to coexist with independent linear clocks (cloud/cluster work already advances by elapsedMs deltas the way contracts do in repeatStableStandingCycle), or add a coarser fallback batching (e.g. detect steady-state across N identical cycles and multiply) plus a wall-clock budget/regression test for a fleet-scale offline advance.
- **Verdict:** CONFIRMED
- **Status:** skipped (FIX-1) — Not landed: making the standing-order bulk path coexist with active cluster/Cloud work cannot be proven equivalent cheaply. repeatStableStandingCycle only multiplies a cycle when stableCyclePowerAndCron finds infrastruct

### F-PERF-4 🟠 MAJOR — tickNormalizedGame is O(n^2) in fleet size: it calls materializeSystem (which runs ensureSystems, re-normalizing hardware for ALL n systems) once per system per tick, plus replaceSystems -> materializeSystem again at the end, and every event query and safety check repeats the same full-fleet rebuild.

- **File:** `src/game/simulation.ts:5056`
- **Category:** fleet-size-quadratic-tick
- **Evidence:** tickNormalizedGame's per-system map calls materializeSystem for each system (simulation.ts:5055-5064); materializeSystem -> ensureSystems (systems.ts:212-234 + 289-328) maps getSystemRuntime over every system, each doing normalizeWorkshopSystemState + syncWorkshopHardwareProjection + syncHardwarePackages (systems.ts:142-167). replaceSystems at simulation.ts:5128 runs materializeSystem again. getNextSimulationEventMsFromNormalizedState repeats it: getSystemPowerOperatingCostPerSecond does materializeSystem per system (simulation.ts:4704-4711) and the event map does getSingleSystemEventSeconds(materializeSystem(...)) per system (simulation.ts:4780-4799). advance.ts compounds it per step: hasSystemWork runs a full ensureSystems per query (advance.ts:108-116) and hasProductiveWork/getOfflineSafetyBlocker call it per system (advance.ts:346-358, 565-574), plus an extra full zero-delta fleet tick at the top of every loop iteration (advance.ts:1485). Measured: ensureSystems alone = 0.67ms at 16 dense systems (0.034ms at 2), invoked dozens of times per advance step; advanceGame(500ms) scales 114ms -> 1,793ms going from 2 to 16 systems (8x systems -> ~16x cost).
- **Suggested fix:** Normalize once per advance (normalizeGameForSimulation already exists) and make ensureSystems/materializeSystem identity-stable no-ops on already-normalized state (e.g. a WeakSet/brand marking normalized GameState), so per-step queries stop rebuilding all systems' hardware.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-7) — New hoistEnsuredSystem helper lifts one system's slices from an ensureSystems-normalized fleet onto the top level without re-running full fleet normalization. Applied at every per-system loop in simulation.ts that previo

### F-PERF-5 🟠 MAJOR — The entire board re-renders every 500ms: visible is a brand-new object tree each snapshot and there is no React.memo in the hot tree, so every CoreDie (up to 512 per machine view), task card, and rack card reconciles every tick even when nothing changed.

- **File:** `src/ui/hardware/CoreArraySection.tsx:107`
- **Category:** unmemoized-board-rerender
- **Evidence:** App.tsx:47 produces a new VisibleState identity every 500ms and passes it wholesale into SystemWorkbench (App.tsx:176-200). Grep across src/ui finds only 11 memo/useMemo occurrences total (mostly App.tsx, stories, and hooks) — none in HardwareBoard, CoreArraySection, TaskBay, or rack components. CoreArraySection.tsx:107-117 maps socket.cores to CoreDie with a fresh inline closure per core (onSelect={() => onSelectCore(core.id)}), which would defeat React.memo even if added; each CoreDie re-renders with new title strings, style objects, and a SmoothFill. With 8 sockets x 64 cores per the hardware ceiling this is 512 CoreDie reconciliations every 500ms on top of the selector cost in finding 2, guaranteeing dropped frames during the snapshot tick (violating the no-jank intent of the AGENTS.md interaction rules).
- **Suggested fix:** Memoize CoreDie (React.memo) with primitive props and a stable onSelectCore(coreId) callback passed down instead of per-core closures; memoize section components on their visible slices so an unchanged socket skips reconciliation.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-10) — Hot per-core cells are memoized: CoreDie and the new CpuSummaryCoreCell are React.memo components taking only primitive props (coreId, label, clockHz, deadlocked, activeName/taskId/instanceId, progress) plus identity-sta

### F-PERF-6 🟡 MINOR — Every Amount operation parses both operands from strings into precision-1024 Decimals and re-serializes via toFixed, and these ops sit in per-system per-step loops (thermal advance, power billing, event math) — ~13% of the CPU profile — where plain number math or retained Decimal instances would be exact-safe.

- **File:** `src/game/amount.ts:34`
- **Category:** decimal-string-roundtrip-tax
- **Evidence:** amount.ts:28-48: each amountAdd/amountMultiply/amountDivide constructs 2-3 new AmountDecimal instances from strings and serializes back (Amount is a string brand, amount.ts:4). CPU profile of one fleet advance+derive: parseDecimal 4.3% + Decimal2 2.1% + subtract 1.8% + finiteToString 1.2% + toFixed 0.9% + plus 0.7% + multiplyInteger 0.6% + regex/cmp ~1% = ~13% of all samples. Hot per-step call sites that never need 1024-digit precision: thermal elapsedMs bookkeeping amountAdd(state.elapsedMs, requestedMs) and heat clamps per system per step (thermal.ts:575-593), exactDeltaSeconds = amountDivide(amount(elapsedMs), "1000") per system per tick (simulation.ts:4876), and per-step billing amountMultiply/amountDivide in applyPowerBilling (simulation.ts:4277-4280). Micro-bench: ~3-5us per op at 1e309 scale; tens of thousands of ops per fleet tick.
- **Suggested fix:** Keep the exact string ledger for economy state, but let hot per-tick intermediates (thermal elapsed, delta-seconds, event-time math) use number or a retained Decimal instance, converting to Amount only at state boundaries; a fused sumAmounts that parses once would also cut the reduce chains in advance.ts:1327-1392.
- **Verdict:** CONFIRMED
- **Status:** deferred — Amount string-parse overhead is real but an exactness-sensitive optimization; revisit with benchmarks after this wave.

### F-PERF-7 🟡 MINOR — tickActiveTasks rebuilds two full staged activeTasks arrays via double spread for every active task on every tick, giving O(t^2) array allocation per system per tick.

- **File:** `src/game/simulation.ts:4076`
- **Category:** per-tick-quadratic-allocation
- **Evidence:** simulation.ts:4076-4091: state.activeTasks.forEach((activeTask, index) => { const stagedState = { ...state, activeTasks: [...activeTasks, ...state.activeTasks.slice(index)], activeJobs: [...activeTasks, ...state.activeTasks.slice(index)] }; ... }) — the identical spliced array is built twice per task (activeTasks and activeJobs are the same content), so t active tasks allocate 2t arrays of length t plus 2t state spreads per system per tick. With up to 64 scheduler slots per CPU x 8 CPUs feeding activeTasks and 16 systems ticking, this is thousands of transient arrays per 500ms advance step; it also runs inside every zero-delta settling tick (advance.ts:1485).
- **Suggested fix:** Build the staged array once per iteration and reuse it for both activeTasks and activeJobs, or restructure tickActiveTask to take (previousTasks, index) so no staged state array is needed at all.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-7) — tickActiveTasks builds the staged activeTasks array once per iteration and shares it between the activeTasks and activeJobs aliases, halving the per-task array allocation (previously two identical spreads per task per sy

### F-BAL-1 🔴 CRITICAL — The balance policy never buys PSU Management research, so every profiled campaign run (and any rational player) completes the entire game with power billing, unpaid-cutoff, and destructive PSU overload permanently disabled.

- **File:** `src/game/balance/policy.ts:911`
- **Category:** balance-harness-fidelity
- **Evidence:** researchProgressionScore's objectivePriorities (policy.ts:891-906) and mainOrder (policy.ts:911-932) contain no 'psuManagement' entry, and the single buyResearch site filters candidates with `researchProgressionScore(candidate.id, visible) > 0` (policy.ts:1402-1411), so `buyResearch psuManagement` can never be proposed; grep of src/game/balance/** for 'psuManagement' returns zero matches, so no test asserts it either. Without that research: math.ts:1408-1416 returns powerCostPerSecond = 0, simulation.ts:4197-4203 skips applyPowerBilling, simulation.ts:3970-3977 zeroes overload-failure pressure, and simulation.ts:4712 skips per-system offline productive billing. Content-side the research is strictly player-negative: research.ts:317-328 charges 300 Credits + 2 Data and its only effect is 'Ends the onboarding power subsidy and enables metered billing and PSU failure controls'; no other research, task, campaign objective (campaign.ts:111-306), or unlock requires it. game-spec.md section 0 promises the campaign 'bills only productive automated work' and that Balance CI fails when 'a workload is unprofitable' — both are validated against runs where power is free for 32-52 weeks.
- **Suggested fix:** Either make PSU Management a hard prerequisite for a mainline gate (e.g. System Bus / System Catalog research, matching the spec's era table where it sits between System Scheduler and Fleet) or auto-complete it after the Power Telemetry milestone; then add 'psuManagement' to the policy mainOrder and a balance test asserting billed power > 0 after the Coherent Machine chapter.
- **Verdict:** CONFIRMED
- **Status:** designer-question — Same design question as C-DES-6 (PSU Management optionality).

### F-BAL-2 🟠 MAJOR — The Server PSU component SKU (the most expensive PSU in the catalog at 540,000 credits) has psuLevel 32, strictly weaker than the 9,500-credit Headroom PSU (level 37) and the 46,000-credit Workstation PSU (level 51), inverting the ladder's cost monotonicity.

- **File:** `src/game/content/machines.ts:392`
- **Category:** authored-values
- **Evidence:** machines.ts:329-393 authors the PSU SKU ladder: psu-barebones 2cr/L1, psu-compact 900cr/L14, psu-balanced 2,800cr/L23, psu-headroom 9,500cr/L37, psu-workstation 46,000cr/L51, psu-server 540,000cr/L32. getPsuWatts (progression.ts:203-204) is the single monotonic mapping (1e-5 * 1.7^(level-1)), giving Server PSU ≈139 W capacity vs Headroom ≈1,978 W and Workstation ≈3.3 MW. A player who buys the priciest, 'server-preview ceiling' PSU (exposed through the customMachineAssembly builder via selectors.ts:1794/1837) gets a machine that cannot even power one gpuRaster8 accelerator (170 W active, accelerators.ts:56) and sits below the WORKSHOP_PROOF_PSU_LEVEL 34 threshold the balance policy itself requires for the specialization proof (policy.ts:227).
- **Suggested fix:** Raise psu-server's psuLevel above 51 (e.g. ~60) so the SKU ladder is monotonic in both credits and capacity, and add a content test asserting PSU SKU cost and psuLevel increase together.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-4) — Duplicate of C-DES-10; same fix and content test asserting PSU SKU cost and psuLevel increase together.

### F-BAL-3 🟠 MAJOR — The global RAM capacity ladder collapses at every tier boundary: upgrading a stick from level 36 (hz max) to level 37 (khz level 1) costs 32,000 credits and shrinks the stick from 8,796,093,022,208 bits to 262,144 bits — a 33,554,432× capacity loss sold as an upgrade.

- **File:** `src/game/content/ramTiers.ts:149`
- **Category:** authored-values
- **Evidence:** ramTiers.ts:149 authors `capacityBits = 256 * 2 ** index * 1024 ** tier.tierIndex` with RAM_TIER_MAX_LEVEL = 36 (hardwareLimits.ts:19), so within a tier capacity grows 2^35 ≈ 3.4e10× but the next tier restarts only 1024× higher: hz L36 = 8.796e12 bits, khz L37 = 262,144 bits (verified numerically). The ramCapacity upgrade (upgrades.ts:1040-1058) unconditionally sets `bits = getRamBits(stick.level + 1)` once the next tier is unlocked (getMaxUnlockedRamLevel, progression.ts:79-82), charging getRamTierCapacityUpgradeCost(37) = 32,000 credits (khz L1) while the previous step L35→L36 cost 212,113,671 × 2^35 ≈ 7.3e15 credits — both cost and capacity invert across the boundary, and the buy has no reserved-memory guard, so active RAM-staged work can exceed the shrunken stick. The same collapse repeats at khz→mhz (9.0e15 → 2.68e8 bits) and mhz→ghz. CPU tiers avoid this because clock values taper to the tier ceiling (cpuTiers.ts:111-142: 999 Hz → 1,000 Hz); RAM capacity was never aligned the same way.
- **Suggested fix:** Make capacityBits continuous across tiers (per-tier base = previous tier's max, or reduce per-tier level count so 1024× covers the intra-tier growth), or block cross-tier capacity 'upgrades' on existing sticks; add a monotonicity test over all 144 global levels.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-4) — RAM capacity ladder no longer collapses at tier boundaries. capacityBits is now 256 * 2^(globalLevel-1) — each tier's base is the previous tier's max doubled (the finding's 'per-tier base = previous tier's max' option), 

### F-BAL-4 🟡 MINOR — The machine builder prices identical hardware three different ways: preset RAM tier SKUs charge stickCount× the install cost (4× for 4 sticks) while both the Advanced-selection path and the in-place upgrade ladder charge 2^index doubling (15×), and the builder's cache/core Data ladders (6 data × 1.78^n, 5 data × 1.45^n) disagree with the upgrade screen's ladders (1 data × 1.5^n, 2 data × 1.3^n) for the same components.

- **File:** `src/game/content/machines.ts:62`
- **Category:** authored-values
- **Evidence:** machines.ts:62-69 (ramTierCost = upgradeCost × stickCount → 4 hz sticks for 32 credits) vs machines.ts:655-659 (custom selection: scaleCosts(install, 2^index) → same 4 sticks for 120 credits) vs upgrades.ts:93-97 (ramStickCosts doubles per stick, matching 120). machines.ts:76-79 cacheCapacityCosts uses data base "6" growth "1.78" while upgrades.ts:85-88 uses "1"/"1.5"; machines.ts:71-74 coreCosts uses data "5"/"1.45" while upgrades.ts:123-126 uses "2"/"1.3" (upgrades.ts's own matchingCpuCost at 311-317 mixes both ladders). A player comparing a preset against the identical Advanced configuration in the builder sees different exact costs for the same machine, conflicting with the spec's model-owned cost/comparison projections.
- **Suggested fix:** Pick one authoritative cost ladder per component (the upgrade-screen functions already exported from upgrades/scheduler/psu) and derive both preset SKU and Advanced-selection pricing from it; assert preset cost equals the equivalent explicit selection in a test.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-4) — Overlaps C-DES-9. Preset RAM tier SKUs now price four sticks on the same doubling install ladder as both the Advanced selection and the in-place install (2^stickCount - 1 = 15x one install, was 4x), so presets never unde

### F-BAL-5 🟠 MAJOR — RAM channel research Data costs are wildly out of scale with every campaign data gate: Dual Channel (20,000 Data) reveals in the System Scheduler era when total accessible first-completion Data is under ~100, and Oct Channel (100,000,000 Data) costs 1,000× the final Global Scheduling gate (100,000 Data).

- **File:** `src/game/content/research.ts:370`
- **Category:** authored-values
- **Evidence:** research.ts:361-393 authors dualChannelRam at 200,000c/20,000d (revealed by systemScheduler research, i.e. Coherent Machine chapter), quadChannelRam at 50,000,000c/5,000,000d, octChannelRam at 1,000,000,000c/100,000,000d. The campaign's own late gates are Cluster Control 100d (research.ts:459), Rack Operations 400d (:473), Data Center Operations 1,500d (:487), Global Scheduling 100,000d (:501). Through chapter 2 a player's cumulative Data income from first completions and benchmarks is roughly 100-150 (tasks.ts rewardData values), so the Dual Channel card sits visibly unaffordable by ~200× for most of the campaign, and quad/oct exceed the entire campaign's data economy including its final gate by 50-1,000×.
- **Suggested fix:** Rescale channel research Data costs to sit between adjacent era gates (e.g. dual ~50-200d in the Fleet era, quad ~2,000-5,000d, oct below or near the 100,000d final gate), or gate their reveal to the eras whose data economy can plausibly fund them.
- **Verdict:** CONFIRMED
- **Status:** fixed (FIX-4) — Duplicate of C-DES-11; same repricing and tests.

---

## Codex GPT-5.6-Sol — Simulation correctness (14 findings)

### C-SIM-1 🔴 CRITICAL — Composed system-task rewards assume RAM residency that runtime does not preserve between child tasks.

- **File:** `src/game/content/tasks.ts:1999`
- **Category:** paid-work ledger
- **Evidence:** deriveDagNodes carries ramStates across recipe steps at lines 2050-2055. Runtime creates each child with empty ramBlocks at simulation.ts:1064-1087 and removes completed children at 3474-3502 without a RAM handoff. Tiny Checksum is paid for 324 units but physically executes 580.
- **Suggested fix:** Reset RAM residency at composition-child boundaries during paid-work derivation, or implement an actual predecessor-to-successor RAM handoff.
- **Status:** fixed (FIX-4) — Paid-work derivation now resets RAM residency at composition-child boundaries (deriveDagNodes tracks each recipe step's source task and rebuilds ramStates whenever the source changes), matching runtime where every child 

### C-SIM-2 🟠 MAJOR — RAM capacity is aggregated as an unsafe Number before exact conversion.

- **File:** `src/game/progression.ts:490`
- **Category:** exact arithmetic
- **Evidence:** A legal maximum stick is 2^73 bits. At that magnitude, adding a 256-bit stick does not change the Number, and capacity.ts:216 converts the rounded Number rather than the exact integer.
- **Suggested fix:** Represent stick capacities and aggregate RAM with Amount or another exact integer representation before any projection to Number.
- **Status:** fixed (FIX-10) — RAM capacity is now aggregated exactly before any Number projection. New exported helper getExactRamCapacityBits(sticks) in progression.ts sums stick.bits via Amount (each stick's bits is an exactly-representable power-o

### C-SIM-3 🟠 MAJOR — Sequential task advancement recalculates cache sharing from already-advanced tasks.

- **File:** `src/game/simulation.ts:4076`
- **Category:** advance determinism / cache contention
- **Evidence:** tickActiveTasks exposes earlier updated tasks to later tasks, and tickLoad receives stagedState at line 3356. A short cache loader completed earlier in the iteration disappears from math.ts:1076 contention calculations for the later loader's entire slice, causing order- and delta-dependent progress.
- **Suggested fix:** Calculate cache contention rates for every operation from the common pre-slice state and commit all operation updates only after those rates are fixed.
- **Status:** fixed (FIX-1) — tickLoad now samples all load/contention rates (cache load rate incl. per-CPU sharing, RAM block rates/deltas, streaming RAM cycles, effective core clock for fused cpu+load ops) from the common pre-slice state passed dow

### C-SIM-4 🟠 MAJOR — A system child can be permanently reserved on a CPU with too few total cores.

- **File:** `src/game/simulation.ts:2142`
- **Category:** scheduler placement
- **Evidence:** Child candidates are filtered by queue slots, not permanent core capacity. The reservation is fixed at lines 2249-2268, while dispatch at 2334-2355 requires minCores on that same CPU and has no reassignment path.
- **Suggested fix:** Exclude CPUs that can never satisfy the child's core and scheduler-width requirements, and release or migrate existing impossible reservations.
- **Status:** fixed (FIX-7) — Added cpuCanEverProvisionTask (permanent core count vs minCores, scheduler width, cache fit via taskFitsCpuHardware). getSystemChildCpuCandidates, selectQueueCoreId and reserveTaskOnCpuScheduler all exclude CPUs that can

### C-SIM-5 🟠 MAJOR — Non-repeatable tasks can be duplicated and can strand scheduler reservations.

- **File:** `src/game/simulation.ts:607`
- **Category:** scheduler queue lifecycle
- **Evidence:** canAcceptTask checks only completed benchmark state, not repeatable, active instances, or queued instances. Concurrent microBenchmark copies both pay Credits; an active copy plus queued duplicate leaves the duplicate permanently ineligible after the first completion.
- **Suggested fix:** Reject active or queued duplicates of non-repeatable tasks and remove any already-invalid duplicate reservation when the unique completion settles.
- **Status:** fixed (FIX-7) — Three-layer fix: (1) hasPendingNonRepeatableInstance gates canStartTask and canQueueTask, so a non-repeatable task (all four in content: microBenchmark, parallelismBenchmark, multiCoreBenchmark, workstationBenchmark) rej

### C-SIM-6 🟠 MAJOR — Deadlock recovery lockout clears only at the end of an arbitrary simulation slice.

- **File:** `src/game/simulation.ts:3948`
- **Category:** advance determinism / deadlock recovery
- **Evidence:** Recovery pressure is drained using the whole delta, but getSingleSystemEventSeconds at lines 4649-4694 has no recovery-to-zero candidate. One long call blocks queued work until its endpoint; partitioned calls start it when recovery actually completes.
- **Suggested fix:** Add currentPressure divided by cooldownRate as an event boundary while recovery lockout is active.
- **Status:** fixed (FIX-1) — Same defect as F-SIM-4 (deadlock recovery lockout clearing only at arbitrary slice ends); fixed by the same event-boundary candidates in getSingleSystemEventSeconds. See F-SIM-4.

### C-SIM-7 🟠 MAJOR — Boot and shutdown slices are billed using the power state at the endpoint.

- **File:** `src/game/simulation.ts:4906`
- **Category:** power billing / determinism
- **Evidence:** advancePowerTransition runs before applyPowerBilling. With a ten-second boot, one call bills ten seconds at the on multiplier, while ten one-second calls bill nine seconds at 0.35 and one at 1.0.
- **Suggested fix:** Bill the elapsed interval using the pre-transition state, then commit the transition at the event endpoint.
- **Status:** fixed (FIX-1) — tickSingleSystem now computes the power billing rate from the pre-transition, pre-slice projected state (getPowerCostPerSecondExact(thermalLoadState)) instead of the post-advancePowerTransition state, so a slice that com

### C-SIM-8 🟠 MAJOR — Crossing bootstrap-grace expiry discards overshoot and creates a fresh full warning.

- **File:** `src/game/simulation.ts:4251`
- **Category:** power cutoff / determinism
- **Evidence:** Grace is not an event candidate, and the zero-credit grace path suppresses the shared credit boundary. Ten seconds of grace advanced by twenty seconds ends with a new ten-second warning, whereas two ten-second calls power off.
- **Suggested fix:** Slice at grace expiry or carry any elapsed overshoot into the unpaid-warning phase.
- **Status:** fixed (FIX-1) — Two-part fix: (1) bootstrapGraceSeconds is now an event candidate (slices end exactly at grace expiry, and the zero-credit grace path no longer escapes the event list), and (2) applyPowerBilling carries any grace-expiry 

### C-SIM-9 🟠 MAJOR — Unpaid cutoff is applied before work for the interval that reaches the deadline.

- **File:** `src/game/simulation.ts:4232`
- **Category:** power cutoff / event ordering
- **Evidence:** When warning time reaches zero, forcePowerOffForUnpaidBill runs immediately. tickSingleSystem then returns at line 4925 before task and storage advancement at 4945-4950, so one ten-second call and ten one-second calls perform different work.
- **Suggested fix:** Advance work through the pre-cutoff interval and apply the hard shutdown at the interval endpoint.
- **Status:** fixed (FIX-1) — The unpaid cutoff is now applied at the slice endpoint after work advancement: tickSingleSystem predicts the deadline crossing from pre-slice values (warning, grace+warning runway, pre-slice cost, credits <= 0), passes d

### C-SIM-10 🟠 MAJOR — PSU overload pressure uses post-work stress and has no failure-time boundary.

- **File:** `src/game/simulation.ts:3981`
- **Category:** PSU overload / determinism
- **Evidence:** Overload is updated after task settlement at line 4961, so a task completing at the endpoint contributes no stress for the preceding interval. The event list also omits time-to-overload-failure, allowing a stress-2 system to run ten seconds in one call but fail after five one-second calls.
- **Suggested fix:** Integrate overload pressure from the pre-slice load and add the exact pressure-to-failure or pressure-to-zero time as an event boundary.
- **Status:** fixed (FIX-1) — updatePowerOverloadFailure now samples PSU stress and canRunPoweredWork from an explicit stressState (the projected pre-slice load state shared with thermal/billing) instead of the post-settlement endpoint, so a task com

### C-SIM-11 🟠 MAJOR — Falling thermal boundaries retain the hotter status for the next complete slice.

- **File:** `src/game/thermal.ts:513`
- **Category:** thermal / determinism
- **Evidence:** At exact boundary equality getThermalStatus remains in the higher band, while falling-event selection requires the boundary to be strictly below current heat. Cooling from exactly 100% therefore skips to the 85% event and runs the whole interval at critical throughput.
- **Suggested fix:** Make falling boundary equality enter the lower band for the following slice, using the computed fallingStatus or equivalent direction-aware boundary state.
- **Status:** fixed (FIX-1) — getThermalStatus is now direction-aware: an optional falling flag makes exact boundary contact enter the cooler band (<= comparisons) while rising/steady contact keeps the hotter band (< comparisons, unchanged default). 

### C-SIM-12 🟠 MAJOR — One invalid exact resource causes every exact resource to fall back to lossy numeric projections.

- **File:** `src/game/save.ts:205`
- **Category:** save schema / exact resources
- **Evidence:** normalizeExactResources returns exact values only when both Credits and Data exist and parse. Otherwise lines 214-216 reconstruct both; valid exact Credits of 1e400 collapse to Number.MAX_VALUE if exact Data is missing or invalid.
- **Suggested fix:** Validate and fall back each exact resource independently.
- **Status:** fixed (FIX-2) — normalizeExactResources in save.ts now validates each exact resource independently via toExactAmountOrNull: a corrupt exact Data entry no longer collapses a valid huge exact Credits balance (e.g. 1e400) to the lossy Numb

### C-SIM-13 🟠 MAJOR — Unknown active-operation statuses normalize to complete and can mint rewards.

- **File:** `src/game/save.ts:393`
- **Category:** save schema / economy
- **Evidence:** normalizeActiveOperation retains positive remaining work after normalizeOperationStatus returns complete. settleActiveTasks then treats the operation as finished and completeTask pays the stored reward.
- **Suggested fix:** Reject or discard tasks containing unknown statuses; never mark an operation complete unless its required remaining counters are valid and exhausted.
- **Status:** fixed (FIX-2) — normalizeOperationStatus now returns 'running' (never 'complete') for unknown statuses, keeping the remaining counters authoritative; and normalizeActiveOperation only trusts a saved 'complete' status when both remaining

### C-SIM-14 🟠 MAJOR — Non-selected systems bypass active-task Amount and operation normalization.

- **File:** `src/game/save.ts:675`
- **Category:** save schema / system normalization
- **Evidence:** Saved systems receive only work-origin and queue normalization, while full normalizeActiveTask processing is root-only at lines 803-806. An invalid remainingCycles string survives loading and throws when materializeSystem invokes scheduler synchronization.
- **Suggested fix:** Apply active-task and active-operation normalization independently to every saved system before it can be materialized.
- **Status:** fixed (FIX-2) — normalizeSavedSystemWorkOrigins was replaced by normalizeSavedSystem, which applies the full pipeline to EVERY saved system (not just the root/selected runtime): isActiveTask filtering + normalizeActiveTask/normalizeActi

---

## Codex GPT-5.6-Sol — UI/React/persistence (23 findings)

### C-UI-1 🔴 CRITICAL — Hiding or closing during offline catch-up can permanently lose the original offline interval.

- **File:** `src/ui/hooks/useGamePersistence.ts:379`
- **Category:** persistence race
- **Evidence:** resumeFromDeparture advances the state asynchronously from its original departedAtMs. A new departure calls invalidateCatchup(), then recordDeparture(stateRef.current, now) at lines 379-398 while stateRef still contains the unadvanced state. The worker result becomes stale at line 450, and recordDeparture has replaced the original timestamp, so the skipped interval cannot be replayed next launch.
- **Suggested fix:** When catch-up is interrupted, persist the existing departed state while preserving its original departedAtMs and departure buffer, or finish and commit catch-up before stamping a new departure.
- **Status:** fixed (FIX-3) — Departure during in-flight offline catch-up no longer re-stamps departedAtMs over the unapplied interval. persistCurrentState only calls recordDeparture when time.departedAtMs is null; when a departure stamp is already p

### C-UI-2 🟠 MAJOR — Rack-ready seed URLs silently overwrite the normal saved game.

- **File:** `src/ui/hooks/useGamePersistence.ts:264`
- **Category:** persistence seed handling
- **Evidence:** In DEV, the seed branch skips getSavedGame(), creates a rack-ready state, clears the URL at line 266, commits it at line 318, and persists it to the normal save-v7 key at line 323. There is no existing-save check, confirmation, or backup.
- **Suggested fix:** Check for an existing save and require confirmation or create a backup; alternatively keep seeded sessions under a separate ephemeral key.
- **Status:** fixed (FIX-3) — Seed URLs no longer silently clobber a real save. backupSavedGameForSeed() in src/ui/app/persistence.ts copies the existing save-v7 payload to the one-slot key save-v7.pre-seed before the rack-ready state is created; hyd

### C-UI-3 🟠 MAJOR — Electron close is acknowledged even when the departure save fails.

- **File:** `src/ui/hooks/useGamePersistence.ts:553`
- **Category:** persistence departure
- **Evidence:** persistState converts write rejection into false at lines 187-197. persistCurrentState discards that result at lines 408-409, and the before-close handler acknowledges in finally at lines 552-555. A failed disk write therefore still authorizes the window to close.
- **Suggested fix:** Propagate the write result and acknowledge close only after success; on failure retry or require an explicit close-without-saving decision.
- **Status:** fixed (FIX-3) — Electron close is acknowledged only after a settled departure save. persistCurrentState now returns a boolean (true = written or intentionally skipped, false = attempted write failed), and the onBeforeClose handler retri

### C-UI-4 🟠 MAJOR — Unavailable browser storage silently falls back to volatile memory while the UI reports successful saves.

- **File:** `src/platform/persistence.ts:215`
- **Category:** persistence durability
- **Evidence:** browserStorage catches all localStorage access failures at lines 44-51. createPersistenceAdapter then returns the memory adapter at lines 209-215, whose set and setImmediate methods report success at lines 103-108. useGamePersistence consequently displays Saved even though reload loses all progress.
- **Suggested fix:** Reserve memory persistence for explicit test/server use, or surface non-durable mode as a persistence error or warning.
- **Status:** fixed (FIX-3) — The storage-unavailable memory fallback no longer reports Saved. isGameSaveDurable() (src/ui/app/persistence.ts) checks idleBitPersistence.driver !== "memory"; persistState surfaces phase "error" with a persistent non-du

### C-UI-5 🟠 MAJOR — Reset reports success even when the fresh save was not persisted.

- **File:** `src/ui/hooks/useGamePersistence.ts:573`
- **Category:** persistence reset
- **Evidence:** resetGame commits fresh state at line 572, ignores persistState's false result at line 573, and always returns the fresh state. App.tsx lines 166-171 then also resets preference storage. The old game save can return next launch while preferences have already been wiped.
- **Suggested fix:** Treat false as reset failure and do not return success or reset preferences until the fresh save is durable.
- **Status:** fixed (FIX-3) — resetGame treats a failed fresh-save write as a failed reset: it returns null when persistState reports the write failed, restores the previous write quarantine (writeBlockedRef) so the old save is not later clobbered, a

### C-UI-6 🟠 MAJOR — The thermal-only Workshop gate makes simulation-unlocked Storage controls unreachable.

- **File:** `src/ui/workshop/WorkshopPanel.tsx:726`
- **Category:** progressive reveal gating
- **Evidence:** The simulation derives storageUnlocked from System Catalog independently of thermal discovery in workshopStorage.ts lines 161-162. HardwareSystemBoard renders Workshop only for thermalVisible, and WorkshopPanel also returns null whenever thermalVisible is false. Storage is therefore hidden after System Catalog until Thermal Probe starts, queues, or completes.
- **Suggested fix:** Render Workshop when any workshop surface is available and select Storage as the default when thermal is still hidden.
- **Status:** fixed (FIX-9) — Workshop panel now mounts when EITHER thermal is discovered or storage is unlocked (System Catalog). When thermal is still hidden the panel defaults to the Storage bay and hides every thermal-only surface (status readout

### C-UI-7 🟠 MAJOR — Closing the mobile resource graph can leave no active content panel.

- **File:** `src/ui/components.tsx:165`
- **Category:** state handling and progressive reveal
- **Evidence:** Mobile resource selection sets activeSection to research and opens the graph. handleCloseGraph only clears graphOpen. If researchPanelVisible is false, the R&D tab and right column unmount while Work and Hardware remain non-active; mobile-layout.css lines 229-238 hides every panel without the active class.
- **Suggested fix:** Return activeSection to tasks whenever mobile is on research and both graphOpen and researchPanelVisible become false.
- **Status:** fixed (FIX-9) — Added a SystemWorkbench effect: on mobile, when activeSection is research and both graphOpen and researchPanelVisible are false, activeSection falls back to "tasks" — closing the graph (or research emptying) can no longe

### C-UI-8 🟠 MAJOR — Planetary Commons is rendered before its chapter unlock.

- **File:** `src/ui/cloud/CloudPanel.tsx:483`
- **Category:** progressive reveal gating
- **Evidence:** CloudPanelProps declares planetaryAvailable and SystemWorkbench supplies currentChapter.index >= 7, but CloudPanel omits the prop from destructuring and unconditionally renders the Planetary Commons section, finale control, blockers, and charter choices.
- **Suggested fix:** Conditionally render the complete Planetary Commons section using the supplied gate or a canonical simulation-owned reveal flag.
- **Status:** fixed (FIX-9) — CloudPanel now destructures the planetaryAvailable prop it already received and wraps the entire Planetary Commons section (finale start control, blockers, progress, charter grid) in it, so nothing planetary renders befo

### C-UI-9 🟠 MAJOR — Scheduler queue occupancy changes preview height and reflows neighboring hardware.

- **File:** `src/ui/hardware/QueuePreview.tsx:124`
- **Category:** reserved geometry
- **Evidence:** Grid rows and --scheduler-preview-height are derived from current items plus one open-summary cell at lines 124-138 rather than purchased capacity. queue-preview.css lines 3-23 applies the computed height and explicitly transitions height, so queueing and completion move lower controls.
- **Suggested fix:** Derive a fixed footprint from slotCapacity, update cells inside it, and remove the runtime height transition.
- **Status:** fixed (FIX-8) — QueuePreview now derives its grid metrics and --scheduler-preview-height from purchased slot capacity (max with transient item overflow) instead of current occupancy, and the empty state reserves the same footprint with 

### C-UI-10 🟠 MAJOR — CPU summary cards grow and shrink as scheduler entries are queued or completed.

- **File:** `src/ui/hardware/CpuBank.tsx:61`
- **Category:** reserved geometry
- **Evidence:** renderedSlotCount depends on filledQueueItems.length, and lines 137-184 render only that many cells. cpu-summary-scheduler.css uses an auto-height grid while the surrounding CPU summary card has no fixed height, so occupancy changes alter card and rack-row height.
- **Suggested fix:** Give each summary queue a capacity-derived fixed footprint and replace slot contents in place.
- **Status:** fixed (FIX-8) — CpuSummaryCard summary queue now renders a fixed cell count derived from purchased scheduler capacity (capped at 16), with each open slot as its own indexed empty cell that items replace in place; the slots-N class and c

### C-UI-11 🟠 MAJOR — Runtime blocker text can wrap and increase task-card height.

- **File:** `src/ui/styles/tasks/task-panel.css:513`
- **Category:** reserved geometry
- **Evidence:** The normal action label is nowrap, but blocked state changes it to overflow:visible and white-space:normal at lines 513-517. The button has only min-height. TaskBay swaps runtime reasons such as core busy, queue full, shutdown, and the long PSU-overload warning into this row.
- **Suggested fix:** Reserve a fixed action-row height and clip or line-clamp blocker text while retaining the full reason in title and aria-label.
- **Status:** fixed (FIX-8) — task-run-button now has a hard height (was min-height only) and the blocked-state span override that allowed wrapping (overflow:visible/white-space:normal) was replaced with the same single-line ellipsis treatment as the

### C-UI-12 🟠 MAJOR — Power lifecycle and failure state insert unreserved rows into hardware cards.

- **File:** `src/ui/hardware/PsuSection.tsx:185`
- **Category:** reserved geometry
- **Evidence:** The header warning is conditional at lines 148-156, failure help at 185-187, transition banner at 189-191, and billing grace at 210-217. PowerTransitionBanner returns null outside transitions, and deadlock-help.css lines 49-56 explicitly makes PSU failure help position:static, so these states enlarge the card and move lower hardware.
- **Suggested fix:** Keep fixed warning, transition, help, and grace slots present and update their content or visibility in place.
- **Status:** fixed (FIX-8) — PsuSection reserves all four state surfaces: (1) header warning chip stays mounted inside a fixed flex-basis .psu-header-warning-slot that toggles visibility; (2) PowerTransitionBanner renders inside a persistent min-hei

### C-UI-13 🟠 MAJOR — Project completion removes controls and collapses the project card.

- **File:** `src/ui/work/WorkViews.tsx:262`
- **Category:** reserved geometry
- **Evidence:** The phase body is conditional at lines 209-261, while the target selector at lines 262-283 and action at lines 292-312 disappear when project.completed becomes true. work-card has no reserved height, so completing work shifts following cards and controls.
- **Suggested fix:** Keep fixed phase, system, and action slots in completed cards and replace their contents with completed or disabled states.
- **Status:** fixed (FIX-8) — Completed project cards keep every slot: phase StatTiles read 'Complete'/'Done', the work-mix row keeps its fixed-height track (empty .task-recipe-bar when no phase remains), the progress bar stays at 1, the target-syste

### C-UI-14 🟠 MAJOR — Accepting a contract physically moves its card between separate lists.

- **File:** `src/ui/work/WorkViews.tsx:327`
- **Category:** reserved geometry
- **Evidence:** Contracts are partitioned by accepted at lines 327-328 and rendered under separate Active and Offers parents at lines 357-487. Accepting flips the state, unmounts the offer card, inserts it earlier under Active, and can insert or remove section headings.
- **Suggested fix:** Keep each contract in a stable list position and update its status and actions in place.
- **Status:** fixed (FIX-8) — ContractsView now renders one flat card list sorted by creation id (contract-N, numeric-aware) with no Active/Offers section re-parenting. A single ContractCard is used for both states with every slot present in both: he

### C-UI-15 🟠 MAJOR — Live Operations waiting and running states move the controls below them.

- **File:** `src/ui/work/LiveOperationsView.tsx:189`
- **Category:** reserved geometry
- **Evidence:** blockedReason conditionally inserts a padded and bordered work-blocked-reason at lines 189-193. Initial configuration also inserts the complete status block at lines 126-195. Neither region has reserved geometry, so runtime capacity changes move the action row.
- **Suggested fix:** Always render a fixed-height runtime-status area and update or hide its contents without removing the slot.
- **Status:** partial (FIX-8) — The blocked-reason readout is now a permanently-mounted single-line reserved slot (.live-operations-blocked, mirroring the DepartureForecast pause-slot pattern): identical border-box geometry with and without a reason, o

### C-UI-16 🟠 MAJOR — Per-core progress rendering is quadratic and reconciles every core on each snapshot.

- **File:** `src/ui/hardware/CoreArraySection.tsx:152`
- **Category:** performance
- **Evidence:** Every CoreDie performs active.coreProgress.find(...) at lines 150-152; CpuBank repeats the same search at lines 193-199. For N assigned cores sharing an N-entry progress array this is O(N²), approximately 262,000 comparisons at the 512-core hardware limit, before reconciling unmemoized cells every 500 ms.
- **Suggested fix:** Index progress by coreId once per task or socket and pass O(1) primitive values to memoized core cells with stable handlers.
- **Status:** fixed (FIX-10) — Per-core progress lookup is now O(1): new src/ui/hardware/coreProgress.ts indexes each coreProgress array once (WeakMap keyed by array identity, first-match insertion mirroring the previous find semantics) and both CoreD

### C-UI-17 🟠 MAJOR — Position-dependent queue keys remount or misassociate entries during normal completion.

- **File:** `src/ui/hardware/QueuePreview.tsx:175`
- **Category:** list identity and focus
- **Evidence:** Cells use `${item.id}-${index}`. queueData.ts lines 230-235 sets item.id to taskId rather than queue-entry identity, so duplicate copies depend on index. Removing an earlier entry changes later keys, dropping focus and resetting SmoothFill state; duplicate occurrences may reuse the previous occurrence's DOM.
- **Suggested fix:** Carry queue-entry, reservation, or instance identity into UiQueueDisplayItem and use it as the key.
- **Status:** fixed (FIX-9) — UiQueueDisplayItem/QueuePreviewItem gained an optional `key` carrying queue-entry identity: getQueueDisplayItemsFromEntries derives it from entry.id ?? entry.reservationId ?? activeTask.instanceId (per-identity #n suffix

### C-UI-18 🟠 MAJOR — The core grids use an invalid and impractical keyboard interaction model.

- **File:** `src/ui/hardware/CoreArraySection.tsx:178`
- **Category:** accessibility and keyboard
- **Evidence:** Each CoreDie is a role=button tab stop and contains another native Cancel button while active. The parent keydown handler does not ignore nested interactive targets, so Cancel key events bubble into core selection and may have their default activation prevented. At maximum hardware, CoreArray and CpuBank also expose up to 512 sequential core tab stops before later controls.
- **Suggested fix:** Use a noninteractive group with separate sibling Select and Cancel controls, and implement one roving tab stop per core grid with arrow-key navigation.
- **Status:** partial (FIX-9) — Nested-interactive markup fixed as triaged: CoreDie is now a plain container with a stretched invisible `.core-die-select` button (aria-pressed, per-core accessible name) beneath the content, with the absolutely-position

### C-UI-19 🟡 MINOR — Interactive Credit and Data readouts have numeric-only accessible names.

- **File:** `src/ui/ResourceHud.tsx:252`
- **Category:** accessibility name
- **Evidence:** The role=button containers at lines 252-283 have no aria-label. Their name-from-content is the formatted number because resource kind is represented only by an unlabeled icon. The generic title is lower priority than content and does not distinguish Credits from Data.
- **Suggested fix:** Add labels such as `Credits: <amount>; toggle resource graph` and expose graph state with aria-pressed or aria-expanded.
- **Status:** fixed (FIX-9) — Interactive Credit/Data HUD readouts now carry explicit accessible names ("Credits: <amount>; toggle resource graph" / "Data: …") plus aria-expanded bound to graphOpen; non-interactive renders get no aria-label.

### C-UI-20 🟡 MINOR — Completed research opacity reduces small text below normal-text contrast.

- **File:** `src/ui/styles/tasks/research-panel.css:52`
- **Category:** accessibility contrast
- **Evidence:** research-action.purchased applies opacity:0.45 to the entire card. Compositing --text over the dark panel at 45% produces approximately 4.1:1 contrast, while muted captions are lower still; the affected fonts are 0.70-0.82rem and therefore require 4.5:1. Users can expose these cards by clearing Hide built.
- **Suggested fix:** Keep text and controls fully opaque and dim only borders/backgrounds, or use explicit colors that retain at least 4.5:1 contrast.
- **Status:** fixed (FIX-9) — Removed the whole-card opacity:0.45 on purchased research; purchased state now dims only the border and background fill (per-accent variants included) so the 0.70-0.82rem copy keeps full >=4.5:1 contrast.

### C-UI-21 🟡 MINOR — Default monotonic meters animate backward for small decreases.

- **File:** `src/ui/SmoothProgress.tsx:29`
- **Category:** snapshot interpolation
- **Evidence:** The decrease snap condition requires ratio + 0.001 < previousRatio. A decrease of 0.001 or less therefore keeps the normal 480 ms transform transition and visibly runs backward despite snapOnDecrease being true.
- **Suggested fix:** Snap on every actual decrease for monotonic meters; make jitter tolerance an explicit option only for bidirectional gauges.
- **Status:** fixed (FIX-9) — SmoothFill's decrease-snap no longer requires a >0.001 delta: monotonic meters (snapOnDecrease=true, the default) snap on every actual decrease, so tiny batch resets never animate backward. Bidirectional gauges keep smoo

### C-UI-22 🟡 MINOR — Notice and pinned-unlock preference writes have no rejection path.

- **File:** `src/ui/hooks/useNoticePreferences.ts:82`
- **Category:** persistence error handling
- **Evidence:** Dismiss handlers optimistically update React state and void persistUiPreference at lines 82, 87, 92, 97, and 102. usePinnedUnlockPreferences repeats the pattern at lines 120, 163, and 172. A storage or IPC rejection is unhandled and the preference silently reappears next launch.
- **Suggested fix:** Catch preference write failures and expose retry/error state; optionally revert the optimistic update.
- **Status:** fixed (FIX-9) — Added persistUiPreferenceWithRetry (one delayed retry, then console.warn naming the key; returns durability) and routed every optimistic notice/pinned/seen-unlock preference write in useNoticePreferences and usePinnedUnl

### C-UI-23 🟡 MINOR — Running tasks are recolored despite the stable task-catalog requirement.

- **File:** `src/ui/styles/tasks/task-panel.css:162`
- **Category:** game-spec compliance
- **Evidence:** TaskCard applies the active class from live task state, and lines 162-167 change its border and background. game-spec.md explicitly requires the task list to remain a stable catalog and not recolor a card merely because that task is active.
- **Suggested fix:** Remove live active styling from catalog cards and keep runtime status on the core, scheduler, and queue surfaces.
- **Status:** fixed (FIX-9) — Deleted the .task-card.active border/background recolor rule; catalog cards stay visually stable while their task runs (runtime status remains on core/scheduler/queue surfaces), matching the game-spec stable-catalog requ

---

## Codex GPT-5.6-Sol — Game design/economy/balance (22 findings)

### C-DES-1 🔴 CRITICAL — Local Scheduler Buffer plus Scheduler Watchdog can permanently block System Scheduler.

- **File:** `src/game/content/research.ts:285`
- **Category:** progression softlock
- **Evidence:** Accessible pre-Scheduler Data totals 56. Mainline research/cache/cores consume 42 and the Local Scheduler Buffer consumes 8, leaving 6; Watchdog is immediately available for 12 Data. Tiny Checksum and projects cannot produce recovery Data before System Scheduler.
- **Suggested fix:** Gate Scheduler Watchdog and Scheduling Policy behind System Scheduler, and move Tiny Checksum's intended funding Data to pre-Scheduler CPU jobs.
- **Status:** fixed (FIX-4) — Scheduler Watchdog reveal and requirement are gated behind System Scheduler research (was Local Scheduler), so its 12 Data (and the Scheduling Policy ladder behind it, which reveals off schedulerWatchdog and is therefore

### C-DES-2 🔴 CRITICAL — The UI cannot create the managed Fleet capacity required by Local Fabric.

- **File:** `src/ui/infrastructure/InfrastructurePanel.tsx:93`
- **Category:** progression dead-end
- **Evidence:** Fleet nodes initialize unmanaged and the cluster builder lists only managed nodes. Production UI wiring exposes neither setSystemManaged nor purchaseAggregateServerBatch, while the harness uses both and the campaign requires a successful shard commit.
- **Suggested fix:** Add Manage/Release controls and an aggregate-server catalog before the Local Fabric objective.
- **Status:** fixed (FIX-13) — Local Fabric managed-capacity dead-end resolved: InfrastructurePanel now exposes (1) a Manage/Release control per system-backed Fleet node wired to setSystemManaged, with real game blocker reasons shown in an always-rend

### C-DES-3 🟠 MAJOR — Tiny Checksum's 8 Data is counted as System Scheduler funding but is scheduler-locked.

- **File:** `src/game/content/tasks.ts:1343`
- **Category:** era funding
- **Evidence:** FEATURES.md counts Tiny Checksum toward the handoff, but it is a system task and selectors block every system task until System Scheduler. Including the first CPU and System slots leaves the actual 56-Data loop with zero margin.
- **Suggested fix:** Move the 8 Data to pre-Scheduler jobs and set Tiny Checksum's first-completion Data to zero.
- **Status:** fixed (FIX-4) — Tiny Checksum's first-completion Data moved to pre-Scheduler CPU jobs with total conserved: tinyChecksum 8->0, readRamPage 3->6, writeRamPage 3->6, overwriteRamPage 3->5 (17 total, same as old 3+3+3+8). The funding jobs 

### C-DES-4 🟠 MAJOR — The initial contract pool does not guarantee System Catalog funding.

- **File:** `src/game/contracts.ts:753`
- **Category:** era funding
- **Evidence:** Ledger Audit, Queue Recovery, and Compile Batch total 19 base Data, randomized to 16.15-23.75, while System Catalog costs 18 Data.
- **Suggested fix:** Raise Compile Batch baseDataReward from 12 to 15 so the minimum initial total is 18.7 Data.
- **Status:** fixed (FIX-4) — Compile Batch baseDataReward raised 12 -> 15 in the contract offer pool, so the worst-case randomized initial pool (Ledger Audit 4 + Queue Recovery 3 + Compile Batch 15, all at the minimum 0.85 value roll = 18.7 Data) al

### C-DES-5 🟠 MAJOR — Local Scheduler cannot reduce manual dispatch below 10% because it only drains a finite queue.

- **File:** `src/game/automation.ts:35`
- **Category:** pacing
- **Evidence:** Each queued completion still needs a player dispatch; automatic renewal does not exist until CRON.
- **Suggested fix:** Add a fill-queue or x10 batch-dispatch action after Local Scheduler, or move the invariant to post-CRON.
- **Status:** closed (explained) — designer reviewed; invariant timing left as-is pending a concrete pacing concern. See designer-rulings section.

### C-DES-6 🟠 MAJOR — Never buying PSU Management permanently avoids operating costs and destructive power consequences.

- **File:** `src/game/content/research.ts:318`
- **Category:** dominant strategy
- **Evidence:** PSU Management is optional and no mainline gate requires it; power billing and overload failure return zero or remain disabled until it is purchased.
- **Suggested fix:** End the subsidy automatically after Power Telemetry or make PSU Management an unavoidable prerequisite before repeatable managed work.
- **Status:** fixed (ruling implemented) — metered billing live from tick zero of a fresh save; cutoff/overload destruction still gated behind PSU Management (which now arms countermeasures). Harness budgets the drain honestly.

### C-DES-7 🟠 MAJOR — Late CPU levels make ordinary repeatable work gross-negative after billing.

- **File:** `src/game/content/cpuTiers.ts:52`
- **Category:** economy profitability
- **Evidence:** A CPU cycle costs 1/effectiveEfficiency Credits. Hz level 30 has 0.9 efficiency; Packet Check's 44 cycles cost 48.89 Credits against 48 total paid units before other power costs. Clock ceilings also taper while costs continue exponentially.
- **Suggested fix:** Raise the active-efficiency floor, reduce the billing coefficient, and price levels from actual marginal throughput instead of level index.
- **Status:** refuted (by design) — Designer confirmed 2026-07-11: late-level inefficiency is the intentional overclocking wall; cooling/efficiency unlocks or next tier resolve it. Only legibility (marginal cr/cycle readout) remains, folded into FIX-9.

### C-DES-8 🟠 MAJOR — The global 25% per-socket efficiency penalty makes multisocket progression a performance-per-watt regression.

- **File:** `src/game/progression.ts:50`
- **Category:** dominant strategy
- **Evidence:** At the required second-CPU gate, adding one level-1 core to four level-3 cores raises throughput about 10.9% but CPU power about 45.7% because the penalty applies to every package.
- **Suggested fix:** Apply the penalty only to cross-socket work or board overhead, or soften the global multiplier to about 0.95.
- **Status:** fixed (ruling implemented) — graduated CPU_SOCKET_EFFICIENCY_SCHEDULE (1.0/0.95/0.88/0.80/0.72/0.68/0.60/0.55 for 1-8 sockets) replaces flat 25%/socket; second-CPU gate now +15.0% power for +10.9% throughput (was +45.7%). Builder projection now shares the game schedule.

### C-DES-9 🟠 MAJOR — Advanced-builder cores and cache are strictly more expensive than upgrading a minimal system afterward.

- **File:** `src/game/content/machines.ts:71`
- **Category:** dominant strategy
- **Evidence:** Builder Data curves are 5x1.45^n for cores and 6x1.78^n for cache; in-place curves are 2x1.3^n and 1x1.5^n for the same resulting hardware.
- **Suggested fix:** Export and reuse one shared core/cache cost implementation in both purchase paths.
- **Status:** fixed (FIX-4) — Builder and in-place upgrade screens now share one canonical core/cache cost implementation (src/game/content/componentCosts.ts, the cheaper in-place curves: cores 140cr x2.05^n + 2d x1.3^n, cache 3cr x1.45^n + 1d x1.5^n

### C-DES-10 🟠 MAJOR — Server PSU is strictly dominated by Workstation PSU.

- **File:** `src/game/content/machines.ts:373`
- **Category:** dead content
- **Evidence:** Workstation PSU costs 46000 Credits at level 51; Server PSU costs 540000 at level 32. Monotonic 1.7^level capacity makes the cheaper Workstation unit roughly 23900 times stronger.
- **Suggested fix:** Raise Server PSU to an appropriately higher level, such as 64, and retune its price.
- **Status:** fixed (FIX-4) — Server PSU psuLevel raised 32 -> 64 (the V1_HARDWARE_LIMITS.psuLevel ceiling), so the 540,000cr SKU now strictly beats the 46,000cr Workstation PSU (level 51) and the SKU ladder is monotonic in both credits and capacity 

### C-DES-11 🟠 MAJOR — RAM channel research is priced beyond superior speed alternatives at its reveal.

- **File:** `src/game/content/research.ts:362`
- **Category:** dead content
- **Evidence:** Dual costs 200000 Credits and 20000 Data, while two Hz sticks reach 2.3 single-channel throughput for 70 Credits, exceeding two default Dual lanes at 2.0.
- **Suggested fix:** Move Dual to the kHz era near 2000 Credits and 20 Data; align Quad and Oct with MHz/GHz progression.
- **Status:** fixed (FIX-4) — RAM channel research repriced to its hardware era: Dual Channel 200,000cr/20,000d -> 2,000cr/20d (kHz era), Quad 50,000,000cr/5,000,000d -> 2,000,000cr/2,000d (MHz era, between the 1,500d and 100,000d gates), Oct 1,000,0

### C-DES-12 🟠 MAJOR — Batch NPU 16 cannot run the only authored inference workload.

- **File:** `src/game/content/accelerators.ts:112`
- **Category:** dead content
- **Evidence:** The device requires batch size 32, while Inference Batch authors size 16 and compatibility rejects workloads below minimumBatchSize. No current task uses mlBatch.
- **Suggested fix:** Reduce minimumBatchSize to 16 or author a real batch-32 workload.
- **Status:** fixed (FIX-4) — Batch NPU 16 minimumBatchSize lowered 32 -> 16 so it accepts Inference Batch (the only authored inference workload, acceleratorBatchSize 16), un-deadening the SKU.

### C-DES-13 🟠 MAJOR — One target-system standing order cannot sustain a 45-60% Fleet-wide baseline.

- **File:** `src/game/advance.ts:190`
- **Category:** profile pacing
- **Evidence:** With equal systems its capacity share trends from near 100% at one system to 50% at two and 6.25% at sixteen.
- **Suggested fix:** Model standing work as a Fleet-wide lane reserving about 55% throughput, or support per-system orders with a global throttle.
- **Status:** closed (explained) — designer reviewed; per-system standing orders stand. See designer-rulings section.

### C-DES-14 🟠 MAJOR — The policy hard-codes the same milestone dates the acceptance suite is meant to measure.

- **File:** `src/game/balance/policy.ts:456`
- **Category:** harness fidelity
- **Evidence:** Buffer purchases are delayed to the acceptance lower bounds and Cloud/finale starts have fixed calendar minima, preventing detection of overly cheap content or a sub-ten-week optimizer.
- **Suggested fix:** Remove calendar admission dates from policy and let affordability, capacity, and public state determine timing.
- **Status:** fixed (FIX-11) — Removed all hard-coded calendar admission dates from the policy: deleted bufferPurchaseMinimumCalendarMs, bufferSavingsMinimumCalendarMs, and cloudProofAdmissionMinimumCalendarMs. Automation Buffer purchases now fire whe

### C-DES-15 🟠 MAJOR — Daily regular and engaged profiles are silently converted into buffer-chasing schedules.

- **File:** `src/game/balance/cadence.ts:146`
- **Category:** harness fidelity
- **Evidence:** A null offlineCapacityFillRatio still selects 94% of capacity, producing 1.88h, 7.52h, and 11.28h returns instead of one day. Overflow is simultaneously expected by cadence and rejected by acceptance.
- **Suggested fix:** Use baseReturnDelayMs when the ratio is null and permit profile-appropriate overflow for daily players.
- **Status:** fixed (FIX-11) — planReturnDelay now uses baseReturnDelayMs whenever offlineCapacityFillRatio is null (true daily cadence for regular/engaged); only profiles with an explicit ratio (full-idle 0.94) chase buffer capacity. Added cadenceExp

### C-DES-16 🟠 MAJOR — Post-CRON sessions contain no decisions after arrival.

- **File:** `src/game/balance/runner.ts:70`
- **Category:** harness fidelity
- **Evidence:** The runner advances the whole remaining active session at once, while the UI remains actionable on 500 ms updates. Newly earned resources, completions, refreshes, and unlocks cannot affect the same session.
- **Suggested fix:** Continue decision stepping after CRON, preferably at the next public event boundary.
- **Status:** fixed (FIX-11) — Post-CRON sessions no longer advance the whole remaining active session blind: getActiveDecisionStepMs in runner.ts now computes the next public event boundary (active-work remainingMs completions, contractMarket.refresh

### C-DES-17 🟠 MAJOR — The modeled regular player cannot reroll a nonempty bad contract market.

- **File:** `src/game/balance/policy.ts:1326`
- **Category:** harness fidelity
- **Evidence:** When no visible offer fits, policy only records no-contract-fit; real UI players can decline offers or refresh whenever cooldown permits.
- **Suggested fix:** Refresh when no offer fits and canRefresh is true, or explicitly decline bad offers first.
- **Status:** fixed (FIX-11) — When no visible contract offer fits the policy window and the public cooldown allows, the policy now dispatches refreshContractMarket (previously it only recorded the no-contract-fit note and refreshed exclusively on an 

### C-DES-18 🟠 MAJOR — The policy cannot exercise the closed-world workload set required by acceptance.

- **File:** `src/game/balance/policy.ts:1927`
- **Category:** harness coverage
- **Evidence:** It never starts Workshop storage and only starts Replicated Shard Commit, omitting Fabric Integrity Sweep despite both being required evidence sources.
- **Suggested fix:** Add generic safe workload selection after mandatory chapter proofs.
- **Status:** fixed (FIX-11) — Added generic safe workload selection after mandatory chapter proofs: (1) Workshop storage — when no finite chapter proof is pending and the installed-storage workload can start with a positive projected net reward and n

### C-DES-19 🟠 MAJOR — Checked-in generated evidence proves no campaign pacing target.

- **File:** `docs/balance/generated/campaign-runs.csv:2`
- **Category:** balance evidence
- **Evidence:** All four runs end at 14 days with blank completion, overflowShare 1, and standingOrderShare 0. Current generation horizons are much longer and expected acceptance/Monte Carlo files are absent.
- **Suggested fix:** Regenerate and check in the complete canonical bundle only after the fidelity and reachability defects are fixed.
- **Status:** partial (FIX-11) — Attempted the full canonical regeneration after landing the fidelity fixes; it cannot honestly complete yet, for three reasons. (1) REACHABILITY (the dominant one, anticipated by this finding's own caveat): with the harn

### C-DES-20 🟠 MAJOR — Fetch Bit is below the requested 5-30 second onboarding band.

- **File:** `src/game/content/tasks.ts:527`
- **Category:** onboarding pacing
- **Evidence:** One 1-cycle read plus one 1-cycle latch at starter 1 Hz takes exactly 2 seconds; the current spec and test explicitly confirm it.
- **Suggested fix:** Raise latch work to make Fetch 5 seconds, or formally revise the target and contradictory QA text to 2-30 seconds.
- **Status:** resolved (by design) — designer: all time is hardware-derived; the 2 s emergent Fetch Bit is canonical. QA-notes band language updated.

### C-DES-21 🟡 MINOR — Packet Check presents four operations while paying 48 Credits from mostly hidden cycle work.

- **File:** `src/game/content/tasks.ts:788`
- **Category:** onboarding clarity
- **Evidence:** The task has four invocations, 44 CPU cycles, and 48 paid-work units; the normal card shows 4 ops and explains paid work only through hover or Inspect.
- **Suggested fix:** Label the count as invocations and add a visible cycle or paid-work chip.
- **Status:** fixed (FIX-9) — TaskMetaLine now labels the ops chip as "operation invocations" (title + aria-label) and adds a compact amber Gauge chip showing task.paidWorkUnits ("N paid work units (executed cycles + transferred bits)") whenever it d

### C-DES-22 🟡 MINOR — Scheduler research copy implies installed functionality although every module starts with zero slots.

- **File:** `src/game/content/research.ts:270`
- **Category:** onboarding clarity
- **Evidence:** Local Scheduler, System Scheduler, and CRON say they add queueing or jobs, but separate paid slot purchases are required.
- **Suggested fix:** Change the three descriptions to 'Unlocks ... slot purchases.'
- **Status:** fixed (FIX-4) — Scheduler research copy reworded to reflect that modules start with zero slots: Local Scheduler 'Unlocks CPU queue slot purchases.', System Scheduler 'Unlocks system queue slot purchases.', CRON Scheduler 'Unlocks CRON j

---

## Designer rulings (2026-07-11, evening)

1. **PSU Management / billing (C-DES-6, F-BAL-1):** billing should cost credits very early on. Implementing: early metered billing; cutoff/destructive failures stay behind PSU Management.
2. **25%/socket penalty (C-DES-8):** intentional wall, but retune to hardware reality — dual-CPU common (mild), quad rare (noticeable), oct very rare (severe). Implementing a graduated schedule.
3. **Standing orders (C-DES-13):** question unclear to designer; current per-system behavior stands. (Context: the spec text implied offline standing orders should reserve ~55% of the whole Fleet; today one order runs on one chosen system.)
4. **Fetch Bit timing (C-DES-20):** all time derives from how fast systems process bits — the emergent 2 s is correct; QA-notes band language revised.
5. **Manual-dispatch invariant (C-DES-5):** question unclear to designer; left as-is. (Context: the spec wants manual clicking to fall below 10% of player actions once schedulers exist; today the Local Scheduler era still needs a click per queued task, so the target is only reachable post-CRON.)
6. **Contracts (F-PLAY-7):** player chooses the target system. Implementing offer-time selection.

## Open designer questions (as of the evening pass)

1. **Accelerator-era Data stall** — with the harness de-scripted, every profile stalls at the Workshop accelerator gate: gpuRaster8 (240 Data) + npuEdge4 (320 Data) vs ~111 Data banked; full-idle has effectively no Data income there. Canonical balance evidence cannot regenerate until accelerator Data prices (or Data income at that era) are retuned.
2. **Full-idle CRON equilibrium — RESOLVED by the socket-penalty retune:** with dual-socket at 0.95 (was 0.75), the seeded full-idle run banks the 480 cr CRON buffer at day ~1.26 (bounded in (1,2] days by the re-encoded test), churn-free. No further ruling needed.
