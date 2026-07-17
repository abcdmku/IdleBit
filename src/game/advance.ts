import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountCompare,
  amountDivide,
  amountMax,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
} from "./amount";
import {
  getAutomationBufferDefinition,
  getAutomationBufferLevelIndex,
  isStandingOrderTaskEligible,
} from "./automation";
import { getTaskDefinition, taskDefinitions } from "./content/tasks";
import {
  getNormalizedCloudAdvanceBlockedReason,
  getNormalizedCloudOperatingCostPerSecond,
  hasActiveCloudWork,
} from "./cloudGame";
import {
  getClusterWorkloadOperatingCostPerSecond,
  hasActiveClusterWorkloads,
  hasRunnableClusterWorkloads,
} from "./distributedDefinitions";
import {
  advanceContracts,
  getActiveContractSystemIds,
  getContractRemainingMs,
  getContractRewardDelta,
  hasActiveContracts,
} from "./contracts";
import { syncExactResources } from "./economy";
import { getProductiveFacilitiesForNodeIds } from "./facilityInfrastructure";
import { getPsuStress } from "./math";
import { isPsuManagementUnlocked } from "./progression";
import {
  getLiveOperationsCompletionDelta,
  hasRunnableLiveOperations,
  isLiveOperationsTaskId,
} from "./liveOperations";
import { workshopStorageWorkloadDefinition } from "./workshopStorage";
import {
  advanceProjects,
  getActiveProjectSystemIds,
  getProjectRewardDelta,
  hasActiveProjects,
  getProjectDefinition,
  getProjectRemainingMs,
} from "./projects";
import {
  applyOfflineIdlePowerPolicies,
  getOfflineDeadlockRecoveryEventMs,
  getOfflineProductiveSystemIds,
  getNextNormalizedSimulationEventMs,
  getSystemPowerOperatingCostPerSecond,
  normalizeGameForSimulation,
  startStandingOrderTask,
  tickNormalizedGame,
} from "./simulation";
import { ensureSystems, materializeSystem } from "./systems";
import type {
  AdvanceMode,
  AdvanceReport,
  AdvanceResult,
  DestructiveEventCounts,
  GameState,
  TaskId,
} from "./types";

export const MAX_ADVANCE_STEP_MS = 15 * 60 * 1000;
const MIN_ADVANCE_STEP_MS = 1;
const ADVANCE_TIME_QUANTUM_PER_MS = 1_000_000_000;

/**
 * Event times are projected to numbers at the engine boundary. Put every
 * remainder back on the same nanosecond-per-millisecond decimal grid so the
 * exact work integrated over 100 + 100 ms is identical to 200 ms.
 */
const normalizeAdvanceTimeMs = (value: number) => {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const nearestMillisecond = Math.round(safe);
  return Math.abs(safe - nearestMillisecond) < 0.000001
    ? nearestMillisecond
    : Math.round(safe * ADVANCE_TIME_QUANTUM_PER_MS) /
        ADVANCE_TIME_QUANTUM_PER_MS;
};

const selectPositiveAdvanceStepMs = (
  remainingMs: number,
  eventMs: number,
) => {
  const normalized = normalizeAdvanceTimeMs(
    Math.min(
      remainingMs,
      eventMs > 0 ? eventMs : MIN_ADVANCE_STEP_MS,
    ),
  );
  return normalized > 0
    ? normalized
    : Math.min(remainingMs, MIN_ADVANCE_STEP_MS);
};

const nonNegativeElapsed = (elapsedMs: number) =>
  Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);

const hasSystemWork = (state: GameState, systemId: number) => {
  const system = ensureSystems(state).systems.find((item) => item.id === systemId);
  return Boolean(
    system &&
      (system.activeTasks.length > 0 ||
        system.queue.length > 0 ||
        (system.queueEntries?.length ?? 0) > 0),
  );
};

const hasWorkshopStorageWork = (state: GameState, systemId: number) =>
  ensureSystems(state).systems.some(
    (system) =>
      system.id === systemId && system.workshop.activeStorageWorkload !== null,
  );

const hasLocalSystemWork = (state: GameState, systemId: number) =>
  hasSystemWork(state, systemId) || hasWorkshopStorageWork(state, systemId);

const hasRunnableNormalizedCloudWork = (
  state: GameState,
  mode: AdvanceMode,
) =>
  hasActiveCloudWork(state) &&
  getNormalizedCloudAdvanceBlockedReason(state, mode) === null;

const getActiveProjectProgress = (state: GameState) =>
  Object.values(state.projects.progress).filter(
    (progress) =>
      progress?.active &&
      !progress.completed &&
      progress.systemId !== null,
  );

const hasAnyActiveProject = (state: GameState) =>
  Object.values(state.projects.progress).some(
    (progress) => progress?.active && !progress.completed,
  );

interface ManagedWorkReservations {
  contractIds: Set<string>;
  projectIds: Set<string>;
}

/**
 * Each system exposes one managed-work lane. Existing contracts retain that
 * lane before projects, and insertion order breaks same-kind save conflicts.
 */
const getManagedWorkReservations = (
  state: GameState,
): ManagedWorkReservations => {
  const occupiedSystemIds = new Set<number>();
  const contractIds = new Set<string>();
  const projectIds = new Set<string>();

  for (const contract of state.contracts.active) {
    if (occupiedSystemIds.has(contract.systemId)) continue;
    occupiedSystemIds.add(contract.systemId);
    contractIds.add(contract.id);
  }
  for (const progress of getActiveProjectProgress(state)) {
    const systemId = progress.systemId!;
    if (occupiedSystemIds.has(systemId)) continue;
    occupiedSystemIds.add(systemId);
    projectIds.add(progress.projectId);
  }

  return { contractIds, projectIds };
};

const hasManagedWorkReservation = (state: GameState, systemId: number) =>
  state.contracts.active.some((contract) => contract.systemId === systemId) ||
  getActiveProjectProgress(state).some(
    (progress) => progress.systemId === systemId,
  );

const getWorkSignature = (state: GameState, systemId: number) => {
  const system = ensureSystems(state).systems.find((item) => item.id === systemId);
  if (!system) return "missing";
  return `${system.activeTasks.length}:${system.queue.length}:${system.queueEntries?.length ?? 0}`;
};

const canRenewStandingOrder = (state: GameState, mode: AdvanceMode) => {
  const levelId =
    mode === "offline"
      ? state.automationBuffer.departureLevelId
      : state.automationBuffer.ownedLevelId;
  const definition = getAutomationBufferDefinition(levelId);
  return (
    definition.renewsStandingOrders &&
    state.flags.cron &&
    state.standingOrder.enabled &&
    state.standingOrder.taskId !== null
  );
};

const getStandingOrderSystemId = (state: GameState) =>
  state.standingOrder.systemId ?? state.selectedSystemId;

/**
 * The bulk path is deliberately narrow. A contract on another system is a
 * linear managed-work clock, but local jobs, storage, projects, distributed
 * work, and Cloud all have richer event state that must stay on the normal
 * simulator path.
 */
const canAttemptStableStandingCycle = (
  state: GameState,
  mode: AdvanceMode,
) => {
  if (!canRenewStandingOrder(state, mode)) return false;
  if (hasRunnableLiveOperations(state, mode)) return false;
  const systemId = getStandingOrderSystemId(state);
  if (
    hasLocalSystemWork(state, systemId) ||
    hasManagedWorkReservation(state, systemId) ||
    hasAnyActiveProject(state) ||
    hasActiveClusterWorkloads(state) ||
    hasActiveCloudWork(state)
  ) {
    return false;
  }
  return !ensureSystems(state).systems.some(
    (system) => system.id !== systemId && hasLocalSystemWork(state, system.id),
  );
};

const attemptStandingOrderRenewal = (
  state: GameState,
  mode: AdvanceMode,
): { state: GameState; renewed: boolean } => {
  if (!canRenewStandingOrder(state, mode)) {
    return { state, renewed: false };
  }

  const systemId = state.standingOrder.systemId ?? state.selectedSystemId;
  if (hasManagedWorkReservation(state, systemId)) {
    return { state, renewed: false };
  }
  // A contract, project, or workload on another system must not suppress a
  // runnable baseline order here. Only existing work on the order's own
  // system prevents a duplicate renewal.
  if (hasLocalSystemWork(state, systemId)) return { state, renewed: false };
  const configuredTaskId = state.standingOrder.taskId;
  if (!configuredTaskId) return { state, renewed: false };
  const candidateIds = [
    configuredTaskId,
    "fetchBit" as const,
    ...taskDefinitions.map((task) => task.id),
  ].filter(
    (taskId, index, candidates): taskId is TaskId =>
      candidates.indexOf(taskId) === index &&
      isStandingOrderTaskEligible(state, taskId, systemId),
  );

  for (const taskId of candidateIds) {
    const before = getWorkSignature(state, systemId);
    const started = startStandingOrderTask(state, taskId, systemId);
    if (getWorkSignature(started, systemId) === before) continue;

    return {
      renewed: true,
      state: {
        ...started,
        standingOrder: {
          ...started.standingOrder,
          taskId,
          systemId,
          renewalCount: started.standingOrder.renewalCount + 1,
        },
      },
    };
  }

  return { state, renewed: false };
};

const getOfflineCapabilityWarnings = (state: GameState) => {
  const departureLevelIndex = getAutomationBufferLevelIndex(
    state.automationBuffer.departureLevelId,
  );
  const contractsCanRun =
    departureLevelIndex >= getAutomationBufferLevelIndex("localScheduler");
  const projectsCanRun =
    departureLevelIndex >= getAutomationBufferLevelIndex("systemScheduler");
  const workshopStorageCanRun =
    departureLevelIndex >= getAutomationBufferLevelIndex("systemScheduler");
  const unsupportedReasons: string[] = [];
  if (hasActiveContracts(state) && !contractsCanRun) {
    unsupportedReasons.push("Local Scheduler automation is required for contracts.");
  }
  if (hasActiveProjects(state) && !projectsCanRun) {
    unsupportedReasons.push("System Scheduler automation is required for projects.");
  }
  if (
    ensureSystems(state).systems.some(
      (system) => hasWorkshopStorageWork(state, system.id),
    ) &&
    !workshopStorageCanRun
  ) {
    unsupportedReasons.push(
      "System Scheduler automation is required for Workshop storage work.",
    );
  }
  const activeFacilityNodeIds = (state.infrastructure.workloads ?? [])
    .filter((workload) => !workload.runtime.rewardIssued)
    .flatMap((workload) =>
      workload.placements.map((placement) => placement.nodeId),
    );
  if (
    hasActiveClusterWorkloads(state) &&
    departureLevelIndex < getAutomationBufferLevelIndex("clusterController")
  ) {
    unsupportedReasons.push(
      "Cluster Controller automation is required for distributed workloads.",
    );
  } else if (
    activeFacilityNodeIds.length > 0 &&
    getProductiveFacilitiesForNodeIds(state, activeFacilityNodeIds).length > 0 &&
    departureLevelIndex < getAutomationBufferLevelIndex("rackController")
  ) {
    unsupportedReasons.push(
      "Rack Controller automation is required for facility-backed workloads.",
    );
  }
  return unsupportedReasons;
};

const getOfflineSafetyBlocker = (state: GameState, stepMs: number) => {
  const departureLevelIndex = getAutomationBufferLevelIndex(
    state.automationBuffer.departureLevelId,
  );
  const contractsCanRun =
    departureLevelIndex >= getAutomationBufferLevelIndex("localScheduler");
  const projectsCanRun =
    departureLevelIndex >= getAutomationBufferLevelIndex("systemScheduler");
  const workshopStorageCanRun =
    departureLevelIndex >= getAutomationBufferLevelIndex("systemScheduler");
  const unsupportedReasons = getOfflineCapabilityWarnings(state);
  const workingSystemIds = new Set([
    ...ensureSystems(state).systems
      .filter(
        (system) =>
          hasSystemWork(state, system.id) ||
          (workshopStorageCanRun && hasWorkshopStorageWork(state, system.id)),
      )
      .map((system) => system.id),
    ...(contractsCanRun ? getActiveContractSystemIds(state) : []),
    ...(projectsCanRun ? getActiveProjectSystemIds(state) : []),
  ]);
  const workingSystems = ensureSystems(state).systems.filter((system) =>
    workingSystemIds.has(system.id),
  );
  const blockedSystemReasons: string[] = [];
  for (const system of workingSystems) {
    const local = materializeSystem(state, system.id);
    if (local.power.state !== "on") {
      blockedSystemReasons.push(`${system.name} is powered off.`);
      continue;
    }
    if (getPsuStress(local) > 1) {
      blockedSystemReasons.push(`${system.name} would overload its PSU.`);
      continue;
    }
    if (
      local.activeTasks.some((task) =>
        task.coreOperations.some((operation) => operation.status === "deadlocked"),
      )
    ) {
      blockedSystemReasons.push(`${system.name} is blocked by a deadlock.`);
      continue;
    }
  }

  const runnableClusterWork = hasRunnableClusterWorkloads(state, "offline");
  const runnableCloudWork = hasRunnableNormalizedCloudWork(state, "offline");
  const productiveSystemIds = getOfflineProductiveSystemIds(state);
  if (
    productiveSystemIds.length === 0 &&
    !runnableClusterWork &&
    !runnableCloudWork
  ) {
    return (
      blockedSystemReasons[0] ??
      unsupportedReasons[0] ??
      (hasActiveClusterWorkloads(state) || hasActiveCloudWork(state)
        ? "Active infrastructure is safely paused."
        : "Queue exhausted.")
    );
  }

  // Before PSU Management there is no unpaid cutoff to pre-empt: offline
  // billing safely drains to 0 credits and work continues, so the runway
  // blocker only budgets system power once the cutoff consequence exists.
  const systemCostPerSecond = isPsuManagementUnlocked(state)
    ? getSystemPowerOperatingCostPerSecond(state, "offline")
    : ZERO_AMOUNT;
  const totalCostPerSecond = amountAdd(
    amountAdd(
      systemCostPerSecond,
      runnableClusterWork
        ? getClusterWorkloadOperatingCostPerSecond(state, "offline")
        : ZERO_AMOUNT,
    ),
    runnableCloudWork &&
    getNormalizedCloudAdvanceBlockedReason(state, "offline") === null
      ? getNormalizedCloudOperatingCostPerSecond(state, "offline")
      : ZERO_AMOUNT,
  );
  const stepCost = amountDivide(
    amountMultiply(totalCostPerSecond, amount(stepMs)),
    1000,
  );
  if (amountCompare(state.exactResources.credits, stepCost) < 0) {
    return "Insufficient power runway.";
  }
  return null;
};

const isAssignedSystemValid = (
  state: GameState,
  systemId: number,
  mode: AdvanceMode = "foreground",
) => {
  if (!ensureSystems(state).systems.some((system) => system.id === systemId)) return false;
  if (mode === "offline") {
    return getOfflineProductiveSystemIds(state).includes(systemId);
  }
  const local = materializeSystem(state, systemId);
  return (
    local.power.state === "on" &&
    getPsuStress(local) <= 1 &&
    !local.activeTasks.some((task) =>
      task.coreOperations.some((operation) => operation.status === "deadlocked"),
    )
  );
};

const managedWorkCapabilities = (state: GameState, mode: AdvanceMode) => {
  const departureLevelIndex = getAutomationBufferLevelIndex(
    state.automationBuffer.departureLevelId,
  );
  return {
    contracts:
      mode === "foreground" ||
      departureLevelIndex >= getAutomationBufferLevelIndex("localScheduler"),
    projects:
      mode === "foreground" ||
      departureLevelIndex >= getAutomationBufferLevelIndex("systemScheduler"),
  };
};

const canProgressReservedContract = (
  state: GameState,
  mode: AdvanceMode,
  reservations: ManagedWorkReservations,
  contract: GameState["contracts"]["active"][number],
) =>
  managedWorkCapabilities(state, mode).contracts &&
  reservations.contractIds.has(contract.id) &&
  !hasLocalSystemWork(state, contract.systemId) &&
  isAssignedSystemValid(state, contract.systemId, mode);

const canProgressReservedProject = (
  state: GameState,
  mode: AdvanceMode,
  reservations: ManagedWorkReservations,
  progress: NonNullable<
    GameState["projects"]["progress"][keyof GameState["projects"]["progress"]]
  >,
) =>
  managedWorkCapabilities(state, mode).projects &&
  reservations.projectIds.has(progress.projectId) &&
  progress.systemId !== null &&
  !hasLocalSystemWork(state, progress.systemId) &&
  isAssignedSystemValid(state, progress.systemId, mode);

const minimumPositiveEvent = (events: number[]) => {
  const positive = events.filter((eventMs) => eventMs > 0);
  return positive.length > 0
    ? Math.min(...positive)
    : Number.POSITIVE_INFINITY;
};

const getNextReservedContractEventMs = (
  state: GameState,
  mode: AdvanceMode,
  reservations: ManagedWorkReservations,
) =>
  minimumPositiveEvent([
    ...state.contracts.offers.map(
      (offer) => offer.expiresAtMs - state.contracts.elapsedMs,
    ),
    ...state.contracts.active.flatMap((contract) =>
      canProgressReservedContract(state, mode, reservations, contract)
        ? [getContractRemainingMs(state, contract)]
        : [],
    ),
  ]);

const getNextReservedProjectEventMs = (
  state: GameState,
  mode: AdvanceMode,
  reservations: ManagedWorkReservations,
) =>
  minimumPositiveEvent(
    getActiveProjectProgress(state).flatMap((progress) => {
      if (!canProgressReservedProject(state, mode, reservations, progress)) {
        return [];
      }
      const remainingMs = getProjectRemainingMs(state, progress);
      return Number.isFinite(remainingMs) ? [remainingMs] : [];
    }),
  );

const advanceManagedWork = (
  reservationState: GameState,
  state: GameState,
  elapsedMs: number,
  mode: AdvanceMode,
) => {
  const reservations = getManagedWorkReservations(reservationState);
  // reservationState is the pre-tick slice-start state: both the progress
  // predicates and the hardware work rates must reflect what held over
  // [t, t+dt], so managed-work progress is invariant to caller chunking.
  const contractsAdvanced = advanceContracts(
    state,
    elapsedMs,
    (contract) =>
      canProgressReservedContract(
        reservationState,
        mode,
        reservations,
        contract,
      ),
    reservationState,
  );
  const projectsAdvanced = advanceProjects(
    contractsAdvanced,
    elapsedMs,
    (progress) =>
      canProgressReservedProject(
        reservationState,
        mode,
        reservations,
        progress,
      ),
    reservationState,
  );
  return mode === "offline"
    ? applyOfflineIdlePowerPolicies(projectsAdvanced)
    : projectsAdvanced;
};

const hasProductiveWork = (state: GameState, mode: AdvanceMode) => {
  if (mode === "offline") {
    return (
      getOfflineProductiveSystemIds(state).length > 0 ||
      hasRunnableClusterWorkloads(state, mode) ||
      hasRunnableNormalizedCloudWork(state, mode)
    );
  }
  const departureLevelIndex = getAutomationBufferLevelIndex(
    state.automationBuffer.departureLevelId,
  );
  const systemWork = ensureSystems(state).systems.some(
    (system) => hasSystemWork(state, system.id) && isAssignedSystemValid(state, system.id),
  );
  const workshopStorageWork = ensureSystems(state).systems.some(
    (system) =>
      hasWorkshopStorageWork(state, system.id) &&
      (mode === "foreground" ||
        departureLevelIndex >= getAutomationBufferLevelIndex("systemScheduler")) &&
      isAssignedSystemValid(state, system.id),
  );
  const contractWork = state.contracts.active.some(
    (contract) =>
      (mode === "foreground" ||
        departureLevelIndex >= getAutomationBufferLevelIndex("localScheduler")) &&
      isAssignedSystemValid(state, contract.systemId),
  );
  const projectWork = Object.values(state.projects.progress).some(
    (progress) =>
      progress?.active &&
      progress.systemId !== null &&
      (mode === "foreground" ||
        departureLevelIndex >= getAutomationBufferLevelIndex("systemScheduler")) &&
      isAssignedSystemValid(state, progress.systemId),
  );
  return (
    systemWork ||
    workshopStorageWork ||
    contractWork ||
    projectWork ||
    hasRunnableLiveOperations(state, mode) ||
    hasRunnableClusterWorkloads(state, mode) ||
    hasRunnableNormalizedCloudWork(state, mode)
  );
};

const fastForwardClock = (state: GameState, elapsedMs: number): GameState => ({
  ...state,
  tick: state.tick + elapsedMs / 1000,
});

const emptyDestructiveEventCounts = (): DestructiveEventCounts => ({
  psuOverload: 0,
  unpaidBill: 0,
  deadlockWipe: 0,
});

const addDestructiveEventCounts = (
  left: DestructiveEventCounts,
  right: DestructiveEventCounts,
): DestructiveEventCounts => ({
  psuOverload: left.psuOverload + right.psuOverload,
  unpaidBill: left.unpaidBill + right.unpaidBill,
  deadlockWipe: left.deadlockWipe + right.deadlockWipe,
});

export const getDestructiveEventDelta = (
  before: GameState,
  after: GameState,
): DestructiveEventCounts => {
  const beforeSystems = ensureSystems(before).systems;
  return ensureSystems(after).systems.reduce((counts, system) => {
    const previous = beforeSystems.find((candidate) => candidate.id === system.id);
    if (!previous) return counts;
    const failureDelta = Math.max(
      0,
      system.power.failureCount - previous.power.failureCount,
    );
    const next = { ...counts };
    if (
      failureDelta > 0 &&
      (system.power.lastFailureReason === "psuOverload" ||
        system.power.lastFailureReason === "unpaidBill")
    ) {
      next[system.power.lastFailureReason] += failureDelta;
    }
    if (
      previous.deadlockProcessLockout === false &&
      system.deadlockProcessLockout === true
    ) {
      next.deadlockWipe += 1;
    }
    return next;
  }, emptyDestructiveEventCounts());
};

const hasDestructiveEvents = (counts: DestructiveEventCounts) =>
  counts.psuOverload + counts.unpaidBill + counts.deadlockWipe > 0;

interface StandingCycleResult {
  state: GameState;
  elapsedMs: number;
  destructiveEvents: DestructiveEventCounts;
}

const simulateStandingCycle = (
  input: GameState,
  mode: AdvanceMode,
  maximumMs: number,
): StandingCycleResult | null => {
  const renewal = attemptStandingOrderRenewal(input, mode);
  if (!renewal.renewed) return null;
  let state = renewal.state;
  const systemId = getStandingOrderSystemId(state);
  let elapsedMs = 0;
  let destructiveEvents = emptyDestructiveEventCounts();
  while (hasLocalSystemWork(state, systemId) && elapsedMs < maximumMs) {
    state = tickNormalizedGame(state, 0, mode);
    if (mode === "offline") state = applyOfflineIdlePowerPolicies(state);
    const remainingMs = maximumMs - elapsedMs;
    const eventMs = getNextNormalizedSimulationEventMs(
      state,
      Math.min(remainingMs, MAX_ADVANCE_STEP_MS),
      mode,
    );
    const stepMs = selectPositiveAdvanceStepMs(remainingMs, eventMs);
    if (mode === "offline" && getOfflineSafetyBlocker(state, stepMs)) return null;
    const advanced = advanceManagedWork(
      state,
      tickNormalizedGame(state, stepMs, mode),
      stepMs,
      mode,
    );
    const transitionEvents = getDestructiveEventDelta(state, advanced);
    if (mode === "offline" && hasDestructiveEvents(transitionEvents)) return null;
    destructiveEvents = addDestructiveEventCounts(
      destructiveEvents,
      transitionEvents,
    );
    state = advanced;
    elapsedMs = normalizeAdvanceTimeMs(elapsedMs + stepMs);
  }
  return !hasLocalSystemWork(state, systemId) && elapsedMs > 0
    ? { state, elapsedMs, destructiveEvents }
    : null;
};

const contractProgressShape = (
  contract: GameState["contracts"]["active"][number],
) => {
  const {
    workCompletedMs: _workCompletedMs,
    workCompletedBits: _workCompletedBits,
    workCompletedUnits: _workCompletedUnits,
    workStageIndex: _workStageIndex,
    workStageCompleted: _workStageCompleted,
    ...shape
  } = contract;
  return shape;
};

const getLinearContractProgressDeltas = (
  before: GameState,
  after: GameState,
  cycleMs: number,
) => {
  if (before.contracts.active.length !== after.contracts.active.length) {
    return null;
  }
  const deltas = new Map<string, number>();
  for (const contract of after.contracts.active) {
    const previous = before.contracts.active.find(
      (candidate) => candidate.id === contract.id,
    );
    if (
      !previous ||
      JSON.stringify(contractProgressShape(previous)) !==
        JSON.stringify(contractProgressShape(contract))
    ) {
      return null;
    }
    const delta = normalizeAdvanceTimeMs(
      contract.workCompletedMs - previous.workCompletedMs,
    );
    if (delta !== 0 && delta !== cycleMs) return null;
    deltas.set(contract.id, delta);
  }
  return deltas;
};

const stableCyclePowerAndCron = (before: GameState, after: GameState) => {
  const beforeSystems = ensureSystems(before).systems;
  const { elapsedMs: _beforeInfrastructureElapsedMs, ...beforeInfrastructure } =
    before.infrastructure;
  const { elapsedMs: _afterInfrastructureElapsedMs, ...afterInfrastructure } =
    after.infrastructure;
  const {
    elapsedMs: _beforeCloudElapsedMs,
    advanceRemainderMs: _beforeCloudAdvanceRemainderMs,
    ...beforeCloud
  } = before.cloud;
  const {
    elapsedMs: _afterCloudElapsedMs,
    advanceRemainderMs: _afterCloudAdvanceRemainderMs,
    ...afterCloud
  } = after.cloud;
  const hasFuturePassiveCloudEvent = (state: GameState) =>
    (state.cloud.failover.completesAtMs ?? 0) > state.cloud.elapsedMs ||
    state.cloud.incidents.some(
      (incident) =>
        incident.startsAtMs > state.cloud.elapsedMs ||
        incident.endsAtMs > state.cloud.elapsedMs,
    );
  return (
    beforeSystems.every((system) => {
      const next = ensureSystems(after).systems.find((candidate) => candidate.id === system.id);
      return Boolean(
        next &&
          JSON.stringify(next.power) === JSON.stringify(system.power) &&
          amountCompare(
            next.workshop.thermal.sustainedHeatWatts,
            system.workshop.thermal.sustainedHeatWatts,
          ) === 0 &&
          next.workshop.highestObservedThermalStatus ===
            system.workshop.highestObservedThermalStatus &&
          next.cron.schedules.every((schedule) => !schedule.enabled) &&
          system.cron.schedules.every((schedule) => !schedule.enabled),
      );
    }) &&
    beforeSystems.length === ensureSystems(after).systems.length &&
    JSON.stringify(beforeInfrastructure) === JSON.stringify(afterInfrastructure) &&
    JSON.stringify(beforeCloud) === JSON.stringify(afterCloud) &&
    !hasFuturePassiveCloudEvent(after)
  );
};

const getStableRepeatsBeforeNextContractBoundary = (
  state: GameState,
  cycleMs: number,
  contractProgressDeltas: ReadonlyMap<string, number>,
) => {
  const untilBoundaryMs = minimumPositiveEvent([
    ...state.contracts.offers.map(
      (offer) => offer.expiresAtMs - state.contracts.elapsedMs,
    ),
    ...state.contracts.active.flatMap((contract) =>
      (contractProgressDeltas.get(contract.id) ?? 0) > 0
        ? [getContractRemainingMs(state, contract)]
        : [],
    ),
  ]);
  return Number.isFinite(untilBoundaryMs)
    ? Math.max(0, Math.ceil(untilBoundaryMs / cycleMs) - 1)
    : Number.POSITIVE_INFINITY;
};

const repeatStableStandingCycle = (
  beforeCycle: GameState,
  afterCycle: GameState,
  cycleMs: number,
  remainingMs: number,
) => {
  const completed = completedWorkDelta(beforeCycle, afterCycle);
  const taskId = beforeCycle.standingOrder.taskId;
  const contractProgressDeltas = getLinearContractProgressDeltas(
    beforeCycle,
    afterCycle,
    cycleMs,
  );
  if (
    !taskId ||
    !contractProgressDeltas ||
    Object.keys(completed).length !== 1 ||
    completed[taskId] !== 1 ||
    !stableCyclePowerAndCron(beforeCycle, afterCycle)
  ) {
    return { state: afterCycle, repeated: 0, elapsedMs: 0 };
  }
  const creditDelta = amountSubtract(
    afterCycle.exactResources.credits,
    beforeCycle.exactResources.credits,
  );
  const dataDelta = amountSubtract(
    afterCycle.exactResources.data,
    beforeCycle.exactResources.data,
  );
  if (amountCompare(creditDelta, 0) < 0 || amountCompare(dataDelta, 0) < 0) {
    return { state: afterCycle, repeated: 0, elapsedMs: 0 };
  }

  const repeated = Math.max(
    0,
    Math.min(
      Math.floor(remainingMs / cycleMs),
      getStableRepeatsBeforeNextContractBoundary(
        afterCycle,
        cycleMs,
        contractProgressDeltas,
      ),
    ),
  );
  if (repeated === 0) return { state: afterCycle, repeated: 0, elapsedMs: 0 };
  const exactResources = {
    credits: amountAdd(
      afterCycle.exactResources.credits,
      amountMultiply(creditDelta, amount(repeated)),
    ),
    data: amountAdd(
      afterCycle.exactResources.data,
      amountMultiply(dataDelta, amount(repeated)),
    ),
  };
  const completionDelta = completed[taskId] ?? 0;
  const standingCompletionDelta =
    (afterCycle.standingTaskCompletions[taskId] ?? 0) -
    (beforeCycle.standingTaskCompletions[taskId] ?? 0);
  if (standingCompletionDelta !== completionDelta) {
    return { state: afterCycle, repeated: 0, elapsedMs: 0 };
  }
  const instanceDelta = afterCycle.nextInstanceId - beforeCycle.nextInstanceId;
  const renewalDelta =
    afterCycle.standingOrder.renewalCount - beforeCycle.standingOrder.renewalCount;
  const rewardCreditsDelta = amountSubtract(
    afterCycle.taskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
    beforeCycle.taskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
  );
  const workCyclesDelta = amountSubtract(
    afterCycle.taskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
    beforeCycle.taskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
  );
  const standingRewardCreditsDelta = amountSubtract(
    afterCycle.standingTaskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
    beforeCycle.standingTaskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
  );
  const standingDataDelta = amountSubtract(
    afterCycle.standingTaskDataEarned[taskId] ?? ZERO_AMOUNT,
    beforeCycle.standingTaskDataEarned[taskId] ?? ZERO_AMOUNT,
  );
  const standingWorkCyclesDelta = amountSubtract(
    afterCycle.standingTaskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
    beforeCycle.standingTaskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
  );
  const repeatedElapsedMs = repeated * cycleMs;
  const beforeSystems = ensureSystems(beforeCycle).systems;
  const systems = ensureSystems(afterCycle).systems.map((system) => {
    const previous = beforeSystems.find((candidate) => candidate.id === system.id);
    if (!previous) return system;
    const thermalElapsedDelta = amountSubtract(
      system.workshop.thermal.elapsedMs,
      previous.workshop.thermal.elapsedMs,
    );
    return {
      ...system,
      workshop: {
        ...system.workshop,
        thermal: {
          ...system.workshop.thermal,
          elapsedMs: amountAdd(
            system.workshop.thermal.elapsedMs,
            amountMultiply(thermalElapsedDelta, amount(repeated)),
          ),
        },
        evidence: {
          gpuRenderCompletions:
            system.workshop.evidence.gpuRenderCompletions +
            repeated *
              (system.workshop.evidence.gpuRenderCompletions -
                previous.workshop.evidence.gpuRenderCompletions),
          npuInferenceCompletions:
            system.workshop.evidence.npuInferenceCompletions +
            repeated *
              (system.workshop.evidence.npuInferenceCompletions -
                previous.workshop.evidence.npuInferenceCompletions),
        },
      },
    };
  });
  const workshop =
    systems.find((system) => system.id === afterCycle.selectedSystemId)?.workshop ??
    afterCycle.workshop;
  const combinedCloudElapsedMs =
    afterCycle.cloud.advanceRemainderMs + repeatedElapsedMs;
  const wholeCloudElapsedMs = Math.floor(combinedCloudElapsedMs);
  const contracts = advanceContracts(
    afterCycle,
    repeatedElapsedMs,
    (contract) => (contractProgressDeltas.get(contract.id) ?? 0) > 0,
  ).contracts;
  return {
    repeated,
    elapsedMs: repeatedElapsedMs,
    state: {
      ...afterCycle,
      tick: afterCycle.tick + repeatedElapsedMs / 1000,
      nextInstanceId: afterCycle.nextInstanceId + repeated * instanceDelta,
      exactResources,
      resources: {
        credits: amountToSafeNumber(exactResources.credits),
        data: amountToSafeNumber(exactResources.data),
      },
      completedTasks: {
        ...afterCycle.completedTasks,
        [taskId]:
          (afterCycle.completedTasks[taskId] ?? 0) + repeated * completionDelta,
      },
      completedJobs: {
        ...afterCycle.completedJobs,
        [taskId]:
          (afterCycle.completedJobs[taskId] ?? 0) + repeated * completionDelta,
      },
      taskRewardCreditsEarned: {
        ...afterCycle.taskRewardCreditsEarned,
        [taskId]: amountAdd(
          afterCycle.taskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
          amountMultiply(rewardCreditsDelta, amount(repeated)),
        ),
      },
      taskWorkCyclesCompleted: {
        ...afterCycle.taskWorkCyclesCompleted,
        [taskId]: amountAdd(
          afterCycle.taskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
          amountMultiply(workCyclesDelta, amount(repeated)),
        ),
      },
      standingTaskCompletions: {
        ...afterCycle.standingTaskCompletions,
        [taskId]:
          (afterCycle.standingTaskCompletions[taskId] ?? 0) +
          repeated * standingCompletionDelta,
      },
      standingTaskRewardCreditsEarned: {
        ...afterCycle.standingTaskRewardCreditsEarned,
        [taskId]: amountAdd(
          afterCycle.standingTaskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
          amountMultiply(standingRewardCreditsDelta, amount(repeated)),
        ),
      },
      standingTaskDataEarned: {
        ...afterCycle.standingTaskDataEarned,
        [taskId]: amountAdd(
          afterCycle.standingTaskDataEarned[taskId] ?? ZERO_AMOUNT,
          amountMultiply(standingDataDelta, amount(repeated)),
        ),
      },
      standingTaskWorkCyclesCompleted: {
        ...afterCycle.standingTaskWorkCyclesCompleted,
        [taskId]: amountAdd(
          afterCycle.standingTaskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
          amountMultiply(standingWorkCyclesDelta, amount(repeated)),
        ),
      },
      standingOrder: {
        ...afterCycle.standingOrder,
        renewalCount:
          afterCycle.standingOrder.renewalCount + repeated * renewalDelta,
      },
      systems,
      workshop,
      contracts,
      infrastructure: {
        ...afterCycle.infrastructure,
        elapsedMs: afterCycle.infrastructure.elapsedMs + repeatedElapsedMs,
      },
      cloud: {
        ...afterCycle.cloud,
        elapsedMs: afterCycle.cloud.elapsedMs + wholeCloudElapsedMs,
        advanceRemainderMs: combinedCloudElapsedMs - wholeCloudElapsedMs,
      },
    },
  };
};

const completedWorkDelta = (before: GameState, after: GameState) => {
  const ids = new Set<TaskId>([
    ...(Object.keys(before.completedTasks) as TaskId[]),
    ...(Object.keys(after.completedTasks) as TaskId[]),
    ...(Object.keys(before.liveOperations.completions) as TaskId[]),
    ...(Object.keys(after.liveOperations.completions) as TaskId[]),
  ]);
  return Object.fromEntries(
    [...ids]
      .map((taskId) => [
        taskId,
        Math.max(
          0,
          (after.completedTasks[taskId] ?? 0) -
            (before.completedTasks[taskId] ?? 0) +
            (isLiveOperationsTaskId(taskId)
              ? (after.liveOperations.completions[taskId] ?? 0) -
                (before.liveOperations.completions[taskId] ?? 0)
              : 0),
        ),
      ] as const)
      .filter(([, count]) => count > 0),
  ) as Partial<Record<TaskId, number>>;
};

const addCompletedWork = (
  left: AdvanceReport["completedWork"],
  right: AdvanceReport["completedWork"],
) => {
  const ids = new Set<TaskId>([
    ...(Object.keys(left) as TaskId[]),
    ...(Object.keys(right) as TaskId[]),
  ]);
  return Object.fromEntries(
    [...ids].map((taskId) => [
      taskId,
      (left[taskId] ?? 0) + (right[taskId] ?? 0),
    ]),
  ) as Partial<Record<TaskId, number>>;
};

const getClusterCompletionDelta = (before: GameState, after: GameState) => {
  const firstSequence = before.infrastructure.nextCompletionSequence ?? 1;
  return (after.infrastructure.completionEvents ?? []).filter(
    (event) => event.sequence >= firstSequence,
  );
};

const completedClusterWorkDelta = (before: GameState, after: GameState) => {
  const ids = new Set([
    ...Object.keys(before.infrastructure.completedWorkloadCounts ?? {}),
    ...Object.keys(after.infrastructure.completedWorkloadCounts ?? {}),
  ]);
  return Object.fromEntries(
    [...ids]
      .map((id) => [
        id,
        Math.max(
          0,
          (after.infrastructure.completedWorkloadCounts?.[
            id as keyof NonNullable<
              GameState["infrastructure"]["completedWorkloadCounts"]
            >
          ] ?? 0) -
            (before.infrastructure.completedWorkloadCounts?.[
              id as keyof NonNullable<
                GameState["infrastructure"]["completedWorkloadCounts"]
              >
            ] ?? 0),
        ),
      ] as const)
      .filter(([, count]) => count > 0),
  ) as NonNullable<AdvanceReport["completedClusterWork"]>;
};

const addCompletedClusterWork = (
  left: AdvanceReport["completedClusterWork"],
  right: AdvanceReport["completedClusterWork"],
) => {
  const leftCounts = left ?? {};
  const rightCounts = right ?? {};
  const ids = new Set([...Object.keys(leftCounts), ...Object.keys(rightCounts)]);
  return Object.fromEntries(
    [...ids].map((id) => [
      id,
      (leftCounts[id as keyof typeof leftCounts] ?? 0) +
        (rightCounts[id as keyof typeof rightCounts] ?? 0),
    ]),
  ) as NonNullable<AdvanceReport["completedClusterWork"]>;
};

const getCloudCompletionDelta = (before: GameState, after: GameState) => {
  const existingIds = new Set(before.cloud.completedSlas.map((sla) => sla.id));
  return after.cloud.completedSlas.filter((sla) => !existingIds.has(sla.id));
};

const getContractCompletionDelta = (before: GameState, after: GameState) => {
  const existing = new Set(before.contracts.completedContractIds);
  return after.contracts.completedContractIds.flatMap((contractId) => {
    if (existing.has(contractId)) return [];
    const contract = before.contracts.active.find(
      (candidate) => candidate.id === contractId,
    );
    const rewards = after.contracts.completedRewards[contractId];
    return contract && rewards ? [{ contract, rewards }] : [];
  });
};

const getProjectPhaseCompletionDelta = (before: GameState, after: GameState) =>
  Object.values(after.projects.progress).flatMap((afterProgress) => {
    if (!afterProgress) return [];
    const beforeProgress = before.projects.progress[afterProgress.projectId];
    const firstPhaseIndex = beforeProgress?.phaseIndex ?? 0;
    if (afterProgress.phaseIndex <= firstPhaseIndex) return [];
    const definition = getProjectDefinition(afterProgress.projectId);
    return definition.phases
      .slice(firstPhaseIndex, afterProgress.phaseIndex)
      .map((phase) => ({ definition, phase }));
  });

const getWorkshopStorageCompletionDelta = (
  before: GameState,
  after: GameState,
) => Math.max(
  0,
  after.workshop.completedStorageWorkloads -
    before.workshop.completedStorageWorkloads,
);

const completedCloudSlaDelta = (
  completions: ReturnType<typeof getCloudCompletionDelta>,
) =>
  Object.fromEntries(
    [...new Set(completions.map((completion) => completion.definitionId))].map(
      (definitionId) => [
        definitionId,
        completions.filter(
          (completion) => completion.definitionId === definitionId,
        ).length,
      ],
    ),
  ) as NonNullable<AdvanceReport["completedCloudSlas"]>;

const addCompletedCloudSlas = (
  left: AdvanceReport["completedCloudSlas"],
  right: AdvanceReport["completedCloudSlas"],
) => {
  const leftCounts = left ?? {};
  const rightCounts = right ?? {};
  const ids = new Set([...Object.keys(leftCounts), ...Object.keys(rightCounts)]);
  return Object.fromEntries(
    [...ids].map((id) => [
      id,
      (leftCounts[id as keyof typeof leftCounts] ?? 0) +
        (rightCounts[id as keyof typeof rightCounts] ?? 0),
    ]),
  ) as NonNullable<AdvanceReport["completedCloudSlas"]>;
};

interface TaskCompletionEconomics {
  taskId: TaskId;
  taskName: string;
  completionCount: number;
  creditsEarned: ReturnType<typeof amount>;
  workCycles: ReturnType<typeof amount>;
  dataEarned: ReturnType<typeof amount>;
}

const getTaskCompletionEconomicsDeltas = (
  before: GameState,
  after: GameState,
  completedWork: AdvanceReport["completedWork"],
) => {
  const taskCompletions: TaskCompletionEconomics[] = [];
  const standingTaskCompletions: TaskCompletionEconomics[] = [];
  for (const [taskId, completionCount] of Object.entries(completedWork) as Array<
    [TaskId, number]
  >) {
      if (isLiveOperationsTaskId(taskId)) continue;
      const task = getTaskDefinition(taskId);
      const totalCredits = amountMax(
        0,
        amountSubtract(
          after.taskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
          before.taskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
        ),
      );
      const totalWorkCycles = amountMax(
        0,
        amountSubtract(
          after.taskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
          before.taskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
        ),
      );
      const totalData = amountMultiply(
        task.rewardDataExact,
        amount(Math.max(0, completionCount)),
      );
      const standingCount = Math.min(
        completionCount,
        Math.max(
          0,
          (after.standingTaskCompletions[taskId] ?? 0) -
            (before.standingTaskCompletions[taskId] ?? 0),
        ),
      );
      const standingCredits = amountMin(
        totalCredits,
        amountMax(
          0,
          amountSubtract(
            after.standingTaskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
            before.standingTaskRewardCreditsEarned[taskId] ?? ZERO_AMOUNT,
          ),
        ),
      );
      const standingWorkCycles = amountMin(
        totalWorkCycles,
        amountMax(
          0,
          amountSubtract(
            after.standingTaskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
            before.standingTaskWorkCyclesCompleted[taskId] ?? ZERO_AMOUNT,
          ),
        ),
      );
      const standingData = amountMin(
        totalData,
        amountMax(
          0,
          amountSubtract(
            after.standingTaskDataEarned[taskId] ?? ZERO_AMOUNT,
            before.standingTaskDataEarned[taskId] ?? ZERO_AMOUNT,
          ),
        ),
      );
      if (completionCount > standingCount) {
        taskCompletions.push({
          taskId,
          taskName: task.name,
          completionCount: completionCount - standingCount,
          creditsEarned: amountMax(0, amountSubtract(totalCredits, standingCredits)),
          workCycles: amountMax(
            0,
            amountSubtract(totalWorkCycles, standingWorkCycles),
          ),
          dataEarned: amountMax(0, amountSubtract(totalData, standingData)),
        });
      }
      if (standingCount > 0) {
        standingTaskCompletions.push({
          taskId,
          taskName: task.name,
          completionCount: standingCount,
          creditsEarned: standingCredits,
          workCycles: standingWorkCycles,
          dataEarned: standingData,
        });
      }
    }
  return { taskCompletions, standingTaskCompletions };
};

/*
 * Task economics stay separately attributed above, but total report economics
 * still includes both manual/CRON and standing-order completions.
 */
const getAllTaskCompletionEconomics = (
  taskCompletions: readonly TaskCompletionEconomics[],
  standingTaskCompletions: readonly TaskCompletionEconomics[],
) => [...taskCompletions, ...standingTaskCompletions];

const getGrossEconomics = (
  before: GameState,
  after: GameState,
  taskCompletions: readonly TaskCompletionEconomics[],
  liveOperationsCompletions: ReturnType<
    typeof getLiveOperationsCompletionDelta
  >,
  clusterCompletions: ReturnType<typeof getClusterCompletionDelta>,
  cloudCompletions: ReturnType<typeof getCloudCompletionDelta>,
) => {
  let creditsEarned = taskCompletions.reduce(
    (total, completion) => amountAdd(total, completion.creditsEarned),
    ZERO_AMOUNT,
  );
  let dataEarned = taskCompletions.reduce(
    (total, completion) => amountAdd(total, completion.dataEarned),
    ZERO_AMOUNT,
  );
  creditsEarned = liveOperationsCompletions.reduce(
    (total, completion) => amountAdd(total, completion.creditsEarned),
    creditsEarned,
  );
  dataEarned = liveOperationsCompletions.reduce(
    (total, completion) => amountAdd(total, completion.dataEarned),
    dataEarned,
  );
  const contractRewards = getContractRewardDelta(before, after);
  const projectRewards = getProjectRewardDelta(before, after);
  const workshopStorageCompletions = getWorkshopStorageCompletionDelta(
    before,
    after,
  );
  const workshopStorageRewards = {
    credits: amountMultiply(
      workshopStorageWorkloadDefinition.plan.reward.credits,
      workshopStorageCompletions,
    ),
    data: amountMultiply(
      workshopStorageWorkloadDefinition.plan.reward.data,
      workshopStorageCompletions,
    ),
  };
  const clusterRewards = clusterCompletions.reduce(
    (total, completion) => ({
      credits: amountAdd(total.credits, completion.rewards.credits),
      data: amountAdd(total.data, completion.rewards.data),
    }),
    { credits: ZERO_AMOUNT, data: ZERO_AMOUNT },
  );
  const cloudRewards = cloudCompletions.reduce(
    (total, completion) => ({
      credits: amountAdd(total.credits, completion.rewards.credits),
      data: amountAdd(total.data, completion.rewards.data),
    }),
    { credits: ZERO_AMOUNT, data: ZERO_AMOUNT },
  );
  creditsEarned = amountAdd(
    creditsEarned,
    amountAdd(
      amountAdd(
        amountAdd(contractRewards.credits, projectRewards.credits),
        workshopStorageRewards.credits,
      ),
      amountAdd(clusterRewards.credits, cloudRewards.credits),
    ),
  );
  dataEarned = amountAdd(
    dataEarned,
    amountAdd(
      amountAdd(
        amountAdd(contractRewards.data, projectRewards.data),
        workshopStorageRewards.data,
      ),
      amountAdd(clusterRewards.data, cloudRewards.data),
    ),
  );
  return {
    creditsEarned,
    dataEarned,
    creditsSpent: amountMax(
      0,
      amountSubtract(
        amountAdd(before.exactResources.credits, creditsEarned),
        after.exactResources.credits,
      ),
    ),
    dataSpent: amountMax(
      0,
      amountSubtract(
        amountAdd(before.exactResources.data, dataEarned),
        after.exactResources.data,
      ),
    ),
  };
};

const mergeOfflineReport = (
  previous: AdvanceReport | null,
  current: AdvanceReport,
): AdvanceReport => {
  if (!previous || previous.mode !== "offline") return current;
  return {
    ...current,
    elapsedMs: previous.elapsedMs + current.elapsedMs,
    simulatedMs: previous.simulatedMs + current.simulatedMs,
    overflowMs: previous.overflowMs + current.overflowMs,
    productiveMs: previous.productiveMs + current.productiveMs,
    pausedMs: previous.pausedMs + current.pausedMs,
    standingOrderRenewals:
      previous.standingOrderRenewals + current.standingOrderRenewals,
    creditsEarned: amountAdd(previous.creditsEarned, current.creditsEarned),
    creditsSpent: amountAdd(previous.creditsSpent, current.creditsSpent),
    dataEarned: amountAdd(previous.dataEarned, current.dataEarned),
    dataSpent: amountAdd(previous.dataSpent, current.dataSpent),
    destructiveEvents: addDestructiveEventCounts(
      previous.destructiveEvents,
      current.destructiveEvents,
    ),
    safelyAvoidedDestructiveEvents: addDestructiveEventCounts(
      previous.safelyAvoidedDestructiveEvents,
      current.safelyAvoidedDestructiveEvents,
    ),
    completedWork: addCompletedWork(previous.completedWork, current.completedWork),
    completedClusterWork: addCompletedClusterWork(
      previous.completedClusterWork,
      current.completedClusterWork,
    ),
    completedCloudSlas: addCompletedCloudSlas(
      previous.completedCloudSlas,
      current.completedCloudSlas,
    ),
    completionEvents: [
      ...(previous.completionEvents ?? []),
      ...(current.completionEvents ?? []),
    ].slice(-256),
    blockers: [...new Set([...previous.blockers, ...current.blockers])],
  };
};

export const advanceGame = (
  inputState: GameState,
  elapsedMs: number,
  mode: AdvanceMode,
): AdvanceResult => {
  const before = normalizeGameForSimulation(inputState);
  const requestedMs = nonNegativeElapsed(elapsedMs);
  const bufferLevelId =
    mode === "offline"
      ? before.automationBuffer.departureLevelId
      : before.automationBuffer.ownedLevelId;
  const buffer = getAutomationBufferDefinition(bufferLevelId);
  const remainingCapacityMs =
    mode === "offline"
      ? Math.max(0, buffer.maxOfflineMs - before.automationBuffer.offlineProcessedMs)
      : requestedMs;
  const simulationBudgetMs = Math.min(requestedMs, remainingCapacityMs);
  const overflowMs = requestedMs - simulationBudgetMs;

  let state = before;
  let remainingMs = simulationBudgetMs;
  let productiveMs = 0;
  let pausedMs = 0;
  let standingOrderRenewals = 0;
  let destructiveEvents = emptyDestructiveEventCounts();
  let safelyAvoidedDestructiveEvents = emptyDestructiveEventCounts();
  const blockers = new Set<string>();

  while (remainingMs > 0) {
    state = tickNormalizedGame(state, 0, mode);
    if (mode === "offline") state = applyOfflineIdlePowerPolicies(state);
    if (canAttemptStableStandingCycle(state, mode)) {
      const cycleStart = state;
      const cycle = simulateStandingCycle(cycleStart, mode, remainingMs);
      if (cycle) {
        state = cycle.state;
        remainingMs = normalizeAdvanceTimeMs(remainingMs - cycle.elapsedMs);
        productiveMs += cycle.elapsedMs;
        standingOrderRenewals += 1;
        destructiveEvents = addDestructiveEventCounts(
          destructiveEvents,
          cycle.destructiveEvents,
        );
        const repeated = repeatStableStandingCycle(
          cycleStart,
          cycle.state,
          cycle.elapsedMs,
          remainingMs,
        );
        state = repeated.state;
        remainingMs = normalizeAdvanceTimeMs(remainingMs - repeated.elapsedMs);
        productiveMs += repeated.elapsedMs;
        standingOrderRenewals += repeated.repeated;
        continue;
      }
    }
    const renewal = attemptStandingOrderRenewal(state, mode);
    state = renewal.state;
    if (renewal.renewed) standingOrderRenewals += 1;

    const maximumStepMs = Math.min(remainingMs, MAX_ADVANCE_STEP_MS);
    const reservations = getManagedWorkReservations(state);
    const eventStepMs = Math.min(
      getNextNormalizedSimulationEventMs(state, maximumStepMs, mode),
      getNextReservedContractEventMs(state, mode, reservations),
      getNextReservedProjectEventMs(state, mode, reservations),
      maximumStepMs,
    );
    const stepMs = selectPositiveAdvanceStepMs(remainingMs, eventStepMs);
    const cloudBlocker = getNormalizedCloudAdvanceBlockedReason(state, mode);
    if (cloudBlocker) blockers.add(cloudBlocker);
    if (mode === "offline") {
      for (const warning of getOfflineCapabilityWarnings(state)) {
        blockers.add(warning);
      }
      const blocker = getOfflineSafetyBlocker(state, stepMs);
      if (blocker) {
        blockers.add(blocker);
        const noRunnableSource =
          getOfflineProductiveSystemIds(state).length === 0 &&
          !hasRunnableClusterWorkloads(state, "offline") &&
          !hasRunnableNormalizedCloudWork(state, "offline");
        // A deadlock lockout keeps cooling while paused, so the pause only
        // consumes time up to the recovery boundary; the blocker is then
        // re-evaluated and queued work can resume, matching foreground play.
        const recoveryEventMs = noRunnableSource
          ? getOfflineDeadlockRecoveryEventMs(state)
          : null;
        const pauseMs =
          recoveryEventMs !== null && recoveryEventMs < remainingMs
            ? Math.min(
                remainingMs,
                Math.max(
                  MIN_ADVANCE_STEP_MS,
                  normalizeAdvanceTimeMs(recoveryEventMs),
                ),
              )
            : remainingMs;
        const pausedBase = noRunnableSource
          ? tickNormalizedGame(state, pauseMs, "offline")
          : fastForwardClock(state, pauseMs);
        state = advanceContracts(
          pausedBase,
          pauseMs,
          false,
        );
        pausedMs += pauseMs;
        remainingMs = normalizeAdvanceTimeMs(remainingMs - pauseMs);
        if (remainingMs <= 0) break;
        continue;
      }
    }

    const wasProductive = hasProductiveWork(state, mode);
    const advanced = advanceManagedWork(
      state,
      tickNormalizedGame(state, stepMs, mode),
      stepMs,
      mode,
    );
    const transitionEvents = getDestructiveEventDelta(state, advanced);
    if (mode === "offline" && hasDestructiveEvents(transitionEvents)) {
      blockers.add("Unsafe failure avoided while absent.");
      safelyAvoidedDestructiveEvents = addDestructiveEventCounts(
        safelyAvoidedDestructiveEvents,
        transitionEvents,
      );
      state = advanceContracts(
        fastForwardClock(state, remainingMs),
        remainingMs,
        false,
      );
      pausedMs += remainingMs;
      remainingMs = 0;
      break;
    }

    state = advanced;
    destructiveEvents = addDestructiveEventCounts(
      destructiveEvents,
      transitionEvents,
    );
    if (wasProductive) productiveMs += stepMs;
    else pausedMs += stepMs;
    remainingMs = normalizeAdvanceTimeMs(remainingMs - stepMs);
  }

  state = syncExactResources(state);
  if (mode === "offline") {
    state = {
      ...state,
      automationBuffer: {
        ...state.automationBuffer,
        offlineProcessedMs:
          state.automationBuffer.offlineProcessedMs + simulationBudgetMs,
      },
    };
  }

  const completedWork = completedWorkDelta(before, state);
  const clusterCompletions = getClusterCompletionDelta(before, state);
  const completedClusterWork = completedClusterWorkDelta(before, state);
  const cloudCompletions = getCloudCompletionDelta(before, state);
  const contractCompletions = getContractCompletionDelta(before, state);
  const projectPhaseCompletions = getProjectPhaseCompletionDelta(before, state);
  const workshopStorageCompletions = getWorkshopStorageCompletionDelta(
    before,
    state,
  );
  const completedCloudSlas = completedCloudSlaDelta(cloudCompletions);
  const liveOperationsCompletions = getLiveOperationsCompletionDelta(
    before,
    state,
  );
  const { taskCompletions, standingTaskCompletions } =
    getTaskCompletionEconomicsDeltas(before, state, completedWork);
  const grossEconomics = getGrossEconomics(
    before,
    state,
    getAllTaskCompletionEconomics(taskCompletions, standingTaskCompletions),
    liveOperationsCompletions,
    clusterCompletions,
    cloudCompletions,
  );
  const currentReport: AdvanceReport = {
    mode,
    elapsedMs: requestedMs,
    simulatedMs: simulationBudgetMs,
    overflowMs,
    productiveMs,
    pausedMs,
    bufferLevelId,
    bufferCapacityMs: buffer.maxOfflineMs,
    standingOrderRenewals,
    creditsEarned: grossEconomics.creditsEarned,
    creditsSpent: grossEconomics.creditsSpent,
    dataEarned: grossEconomics.dataEarned,
    dataSpent: grossEconomics.dataSpent,
    destructiveEvents,
    safelyAvoidedDestructiveEvents,
    completedWork,
    completedClusterWork,
    completedCloudSlas,
    completionEvents: [
      ...taskCompletions.map((completion) => ({
        source: "task" as const,
        instanceId: `task:${completion.taskId}:${
          state.completedTasks[completion.taskId] ?? completion.completionCount
        }`,
        workId: completion.taskId,
        name: completion.taskName,
        completionCount: completion.completionCount,
        workCycles: completion.workCycles,
        creditsEarned: completion.creditsEarned,
        dataEarned: completion.dataEarned,
      })),
      ...standingTaskCompletions.map((completion) => ({
        source: "standing-order" as const,
        instanceId: [
          "standing-order",
          completion.taskId,
          state.standingTaskCompletions[completion.taskId] ??
            completion.completionCount,
        ].join(":"),
        workId: completion.taskId,
        name: completion.taskName,
        completionCount: completion.completionCount,
        workCycles: completion.workCycles,
        creditsEarned: completion.creditsEarned,
        dataEarned: completion.dataEarned,
      })),
      ...liveOperationsCompletions.map((completion) => ({
        source: "live-operations" as const,
        instanceId: [
          "live-operations",
          completion.taskId,
          state.liveOperations.completions[completion.taskId] ??
            completion.completionCount,
        ].join(":"),
        workId: completion.taskId,
        name: completion.name,
        completionCount: completion.completionCount,
        workCycles: completion.workCycles,
        creditsEarned: completion.creditsEarned,
        dataEarned: completion.dataEarned,
      })),
      ...contractCompletions.map(({ contract, rewards }) => ({
        source: "contract" as const,
        instanceId: contract.id,
        workId: contract.templateId,
        name: contract.name,
        creditsEarned: rewards.credits,
        dataEarned: rewards.data,
      })),
      ...projectPhaseCompletions.map(({ definition, phase }) => ({
        source: "project" as const,
        instanceId: `${definition.id}:${phase.id}`,
        workId: definition.id,
        phaseId: phase.id,
        name: `${definition.name} · ${phase.name}`,
        creditsEarned: phase.rewards.credits,
        dataEarned: phase.rewards.data,
      })),
      ...(workshopStorageCompletions > 0
        ? [{
            source: "workshop-storage" as const,
            instanceId: `workshop-storage:${state.selectedSystemId}:${state.workshop.completedStorageWorkloads}`,
            workId: workshopStorageWorkloadDefinition.id,
            name: workshopStorageWorkloadDefinition.name,
            completionCount: workshopStorageCompletions,
            creditsEarned: amountMultiply(
              workshopStorageWorkloadDefinition.plan.reward.credits,
              workshopStorageCompletions,
            ),
            dataEarned: amountMultiply(
              workshopStorageWorkloadDefinition.plan.reward.data,
              workshopStorageCompletions,
            ),
          }]
        : []),
      ...clusterCompletions.map((completion) => ({
        source: "cluster" as const,
        instanceId: completion.instanceId,
        workId: completion.definitionId,
        clusterId: completion.clusterId,
        creditsEarned: completion.rewards.credits,
        dataEarned: completion.rewards.data,
      })),
      ...cloudCompletions.map((completion) => ({
        source: "cloud" as const,
        instanceId: completion.id,
        workId: completion.definitionId,
        creditsEarned: completion.rewards.credits,
        dataEarned: completion.rewards.data,
      })),
    ].slice(-256),
    blockers: [...blockers],
  };
  const report =
    mode === "offline"
      ? mergeOfflineReport(before.lastAdvanceReport, currentReport)
      : currentReport;
  const finalState =
    mode === "offline" ? { ...state, lastAdvanceReport: report } : state;
  return { state: finalState, intervalReport: currentReport, report };
};
