import {
  amountAdd,
  amountCompare,
  amountDivide,
  amountMultiply,
  amountToSafeNumber,
  type Amount,
} from "./amount";
import {
  getAutomationBufferDefinition,
  getAutomationBufferLevelIndex,
} from "./automation";
import { getVisibleMissions } from "./campaign";
import {
  getCloudAdvanceBlockedReason,
  getCloudOperatingCostPerSecond,
} from "./cloudGame";
import type { VisibleCloudState } from "./cloudSelectors";
import { getVisibleContracts } from "./contracts";
import { getTaskDefinition } from "./content/tasks";
import { getClusterWorkloadOperatingCostPerSecond } from "./distributedDefinitions";
import type { VisibleInfrastructureState } from "./infrastructureTypes";
import { getHardwareDrawWatts, getPsuStress } from "./math";
import { getVisibleProjects } from "./projects";
import { getSystemPowerOperatingCostPerSecond } from "./simulation";
import { ensureSystems, materializeSystem } from "./systems";
import { getTaskBatchProjection } from "./taskBatches";
import {
  getWorkshopStorageWorkloadDurationMs,
  getWorkshopStorageWorkloadProgressBps,
  workshopStorageWorkloadDefinition,
} from "./workshopStorage";
import type {
  GameState,
  VisibleActiveJob,
  VisibleActiveWork,
  VisibleContract,
  VisibleContractMarket,
  VisibleDepartureForecast,
  VisibleJob,
  VisibleStandingOrderWork,
  VisibleWorkState,
} from "./types";

const ratio = (completed: string, total: string) =>
  amountCompare(total, 0) <= 0
    ? 1
    : Math.max(
        0,
        Math.min(1, amountToSafeNumber(amountDivide(completed, total))),
      );

const getVisibleStandingOrders = (state: GameState): VisibleStandingOrderWork[] => {
  const taskId = state.standingOrder.taskId;
  if (!taskId) return [];
  return [
    {
      taskId,
      name: getTaskDefinition(taskId).name,
      enabled: state.standingOrder.enabled,
      systemId: state.standingOrder.systemId,
      renewalCount: state.standingOrder.renewalCount,
    },
  ];
};

const getVisibleContractMarket = (state: GameState): VisibleContractMarket => {
  const task = getTaskDefinition(state.standingOrder.taskId ?? "fetchBit");
  const systemId = state.standingOrder.systemId ?? state.selectedSystemId;
  const local = materializeSystem(state, systemId);
  const batch = getTaskBatchProjection(local, task);
  const taskSeconds = Math.max(0.001, batch.durationMs / 1_000);
  return {
    elapsedMs: state.contracts.elapsedMs,
    canRefresh:
      state.flags.cron &&
      state.contracts.elapsedMs >= state.contracts.nextRefreshAtMs,
    refreshBlockedReason: state.flags.cron
      ? null
      : "Requires CRON Scheduler research.",
    refreshAvailableInMs: Math.max(
      0,
      state.contracts.nextRefreshAtMs - state.contracts.elapsedMs,
    ),
    standingOrderTaskName: task.name,
    standingOrderValuePerHourCredits: amountDivide(
      amountMultiply(batch.rewardCredits, 3_600),
      taskSeconds,
    ),
  };
};

const compareContractsToStandingOrder = (
  contracts: VisibleContract[],
  market: VisibleContractMarket,
): VisibleContract[] =>
  contracts.map((contract) => ({
    ...contract,
    valueMultiplierVsStandingOrderBps:
      amountCompare(market.standingOrderValuePerHourCredits, 0) <= 0
        ? null
        : Math.max(
            0,
            Math.min(
              1_000_000,
              Math.round(
                amountToSafeNumber(
                  amountDivide(
                    amountMultiply(contract.valuePerHourCredits, 10_000),
                    market.standingOrderValuePerHourCredits,
                  ),
                ),
              ),
            ),
          ),
  }));

const getInfrastructureActiveWork = (
  state: GameState,
  infrastructure: VisibleInfrastructureState,
): VisibleActiveWork[] => {
  const nodeById = new Map(
    infrastructure.fleet.nodes.map((node) => [node.id, node]),
  );
  const facilityNodeIds = new Set(
    state.infrastructure.facilities.flatMap((facility) =>
      facility.racks.flatMap((rack) =>
        rack.placements.map((placement) => placement.equipment.id),
      ),
    ),
  );

  return infrastructure.workloads
    .filter((workload) => workload.status !== "completed")
    .map((workload): VisibleActiveWork => {
      const placedNodeIds = workload.placements.map(
        (placement) => placement.nodeId,
      );
      const systemIds = [
        ...new Set(
          placedNodeIds.flatMap((nodeId) => {
            const source = nodeById.get(nodeId)?.source;
            return source?.kind === "system" ? [source.systemId] : [];
          }),
        ),
      ];
      const facilityBacked = placedNodeIds.some((nodeId) =>
        facilityNodeIds.has(nodeId),
      );
      return {
        id: `infrastructure:${workload.id}`,
        kind: facilityBacked ? "facilityWorkload" : "clusterWorkload",
        name: workload.name,
        progress: workload.progressBps / 10_000,
        remainingMs:
          workload.projection.durationMs === null
            ? null
            : amountToSafeNumber(workload.projection.durationMs),
        systemId: systemIds.length === 1 ? systemIds[0]! : null,
      };
    });
};

const getWorkshopStorageActiveWork = (state: GameState): VisibleActiveWork[] =>
  ensureSystems(state).systems.flatMap((system) => {
    if (!system.workshop.activeStorageWorkload) return [];
    const remainingMs = getWorkshopStorageWorkloadDurationMs(system.workshop);
    return [{
      id: `workshop-storage:${system.id}`,
      kind: "workshopStorage" as const,
      name: workshopStorageWorkloadDefinition.name,
      progress: getWorkshopStorageWorkloadProgressBps(system.workshop) / 10_000,
      remainingMs: remainingMs === null ? null : amountToSafeNumber(remainingMs),
      systemId: system.id,
    }];
  });

const getCloudActiveWork = (cloud: VisibleCloudState): VisibleActiveWork[] => {
  const work: VisibleActiveWork[] = [];
  if (amountCompare(cloud.routing.requestedPerSecond, 0) > 0) {
    work.push({
      id: "cloud:regional-service",
      kind: "cloud",
      name: "Regional cloud service",
      progress: ratio(
        cloud.routing.deliveredPerSecond,
        cloud.routing.requestedPerSecond,
      ),
      remainingMs: null,
      systemId: null,
    });
  }
  if (cloud.failover.pendingZoneId !== null) {
    const remainingMs =
      cloud.failover.completesAtMs === null
        ? null
        : Math.max(0, cloud.failover.completesAtMs - cloud.elapsedMs);
    work.push({
      id: `cloud:failover:${cloud.failover.pendingZoneId}`,
      kind: "cloud",
      name: "Cloud failover",
      progress:
        remainingMs === null || cloud.failoverDelayMs <= 0
          ? 0
          : Math.max(0, 1 - remainingMs / cloud.failoverDelayMs),
      remainingMs,
      systemId: null,
    });
  }
  if (cloud.activeSla) {
    work.push({
      id: `sla:${cloud.activeSla.id}`,
      kind: "sla",
      name: cloud.activeSla.name,
      progress: ratio(
        cloud.activeSla.workCompleted,
        cloud.activeSla.workRequired,
      ),
      remainingMs: cloud.activeSla.observationRemainingMs,
      systemId: null,
    });
  }
  if (cloud.finale.started && !cloud.finale.complete) {
    work.push({
      id: "finale:planetary-commons",
      kind: "finale",
      name: cloud.finale.phaseName ?? "Planetary Commons",
      progress: ratio(
        cloud.finale.phaseContribution,
        cloud.finale.phaseContributionRequired,
      ),
      remainingMs: cloud.finale.remainingMs,
      systemId: null,
    });
  }
  return work;
};

const getVisibleActiveWork = (
  state: GameState,
  activeJobs: VisibleActiveJob[],
  infrastructure: VisibleInfrastructureState,
  cloud: VisibleCloudState,
): VisibleActiveWork[] => {
  const projects = getVisibleProjects(state)
    .filter((project) => project.active)
    .map((project): VisibleActiveWork => ({
      id: `project:${project.id}`,
      kind: "project",
      name: project.name,
      progress:
        project.currentPhase &&
        !project.projectionBlockedReason &&
        project.currentPhase.durationMs > 0
          ? project.phaseProgressMs / project.currentPhase.durationMs
          : 0,
      remainingMs: project.projectionBlockedReason ? null : project.remainingMs,
      systemId: state.projects.progress[project.id]?.systemId ?? null,
    }));
  const contracts = getVisibleContracts(state)
    .filter((contract) => contract.accepted)
    .map((contract): VisibleActiveWork => ({
      id: `contract:${contract.id}`,
      kind: "contract",
      name: contract.name,
      progress:
        contract.workRequiredMs > 0
          ? contract.workCompletedMs / contract.workRequiredMs
          : 1,
      remainingMs: contract.remainingMs,
      systemId: contract.systemId,
    }));
  const jobs = activeJobs.map((job): VisibleActiveWork => ({
    id: `job:${job.instanceId}`,
    kind: "job",
    name: job.name,
    progress: job.progress,
    remainingMs: job.remainingSeconds * 1_000,
    systemId: job.systemId ?? state.selectedSystemId,
  }));
  const standingOrders =
    state.standingOrder.enabled && state.standingOrder.taskId
      ? [
          {
            id: `standing:${state.standingOrder.taskId}`,
            kind: "standingOrder" as const,
            name: getTaskDefinition(state.standingOrder.taskId).name,
            progress: 0,
            remainingMs: null,
            systemId: state.standingOrder.systemId,
          },
        ]
      : [];
  return [
    ...projects,
    ...contracts,
    ...standingOrders,
    ...jobs,
    ...getWorkshopStorageActiveWork(state),
    ...getInfrastructureActiveWork(state, infrastructure),
    ...getCloudActiveWork(cloud),
  ];
};

export const getCreditRunwayWithinCoverageMs = (
  credits: Amount,
  operatingCostPerSecond: Amount,
  coverageMs: number,
) => {
  if (amountCompare(operatingCostPerSecond, 0) <= 0) return null;
  const boundedCoverageMs = Math.max(0, coverageMs);
  const coverageCost = amountMultiply(
    operatingCostPerSecond,
    amountDivide(String(boundedCoverageMs), 1_000),
  );
  if (amountCompare(credits, coverageCost) >= 0) return boundedCoverageMs;
  return Math.min(
    boundedCoverageMs,
    amountToSafeNumber(
      amountMultiply(amountDivide(credits, operatingCostPerSecond), 1_000),
    ),
  );
};

const getDepartureForecast = (
  state: GameState,
  activeWork: VisibleActiveWork[],
  infrastructure: VisibleInfrastructureState,
): VisibleDepartureForecast => {
  const buffer = getAutomationBufferDefinition(
    state.automationBuffer.ownedLevelId,
  );
  const coverageMs = buffer.maxOfflineMs;
  const planningState: GameState = {
    ...state,
    automationBuffer: {
      ...state.automationBuffer,
      departureLevelId: state.automationBuffer.ownedLevelId,
    },
  };
  const timedWork = activeWork.filter((work) => work.remainingMs !== null);
  const systems = ensureSystems(state).systems.map((system) => {
    const local = materializeSystem(state, system.id);
    return {
      systemId: system.id,
      name: system.name,
      powerState: local.power.state,
      drawWatts: getHardwareDrawWatts(local),
      psuStress: getPsuStress(local),
      deadlocked: local.activeTasks.some((task) =>
        task.coreOperations.some((operation) => operation.status === "deadlocked"),
      ),
    };
  });
  const exactTotalOperatingCostPerSecond = amountAdd(
    amountAdd(
      getSystemPowerOperatingCostPerSecond(planningState, "offline"),
      getClusterWorkloadOperatingCostPerSecond(planningState, "offline"),
    ),
    getCloudOperatingCostPerSecond(planningState, "offline"),
  );
  const activeSystemIds = new Set(
    activeWork.flatMap((work) =>
      work.systemId === null ? [] : [work.systemId],
    ),
  );
  const activeSystems = systems.filter((system) =>
    activeSystemIds.has(system.systemId),
  );
  const facilityWorkActive = activeWork.some(
    (work) => work.kind === "facilityWorkload",
  );
  const levelIndex = getAutomationBufferLevelIndex(
    state.automationBuffer.ownedLevelId,
  );
  const firstWorkloadBlocker = infrastructure.workloads
    .filter((workload) => workload.status !== "completed")
    .flatMap((workload) => workload.blockers)[0];
  const cloudBlocker = getCloudAdvanceBlockedReason(
    planningState,
    "offline",
  );
  const creditRunwayMs = getCreditRunwayWithinCoverageMs(
    state.exactResources.credits,
    exactTotalOperatingCostPerSecond,
    coverageMs,
  );
  const projectedPauseReason =
    coverageMs <= 0
      ? "The installed Automation Buffer has no offline coverage."
      : activeWork.length === 0
        ? "No active work is queued; offline processing will pause safely."
        : activeSystems.find((system) => system.powerState !== "on")
          ? `${activeSystems.find((system) => system.powerState !== "on")!.name} is not powered on.`
          : activeSystems.find((system) => system.psuStress > 1)
            ? `${activeSystems.find((system) => system.psuStress > 1)!.name} exceeds its safe PSU rating.`
            : activeSystems.find((system) => system.deadlocked)
              ? `${activeSystems.find((system) => system.deadlocked)!.name} has a deadlocked task.`
              : state.contracts.active.length > 0 &&
                    levelIndex < getAutomationBufferLevelIndex("localScheduler")
                ? "Local Scheduler automation is required for contracts."
                : Object.values(state.projects.progress).some(
                      (progress) => progress?.active,
                    ) &&
                      levelIndex < getAutomationBufferLevelIndex("systemScheduler")
                  ? "System Scheduler automation is required for projects."
                  : facilityWorkActive &&
                        levelIndex < getAutomationBufferLevelIndex("rackController")
                    ? "Rack Controller automation is required for facility-backed workloads."
                    : firstWorkloadBlocker ??
                      cloudBlocker ??
                      (creditRunwayMs !== null && creditRunwayMs < coverageMs
                        ? "Credit runway ends before the Automation Buffer."
                        : timedWork.some(
                              (work) => (work.remainingMs ?? 0) > coverageMs,
                            )
                          ? "The Automation Buffer ends before all timed work completes."
                          : null);

  return {
    coverageMs,
    timedActiveCount: timedWork.length,
    fittingActiveCount: timedWork.filter(
      (work) => (work.remainingMs ?? Number.POSITIVE_INFINITY) <= coverageMs,
    ).length,
    unknownDurationCount: activeWork.length - timedWork.length,
    renewalSupported: buffer.renewsStandingOrders,
    renewalEnabled: state.standingOrder.enabled,
    renewalTaskName: state.standingOrder.taskId
      ? getTaskDefinition(state.standingOrder.taskId).name
      : null,
    aggregateOperatingCostPerSecond: exactTotalOperatingCostPerSecond,
    creditRunwayMs,
    projectedPauseReason,
    safePowerPolicy: "pause-before-unsafe",
    powerPolicies: systems.map(({ deadlocked: _deadlocked, ...system }) => system),
  };
};

export const getVisibleWorkState = (
  state: GameState,
  jobs: VisibleJob[],
  activeJobs: VisibleActiveJob[],
  infrastructure: VisibleInfrastructureState,
  cloud: VisibleCloudState,
): VisibleWorkState => {
  const contractMarket = getVisibleContractMarket(state);
  const contracts = compareContractsToStandingOrder(
    getVisibleContracts(state),
    contractMarket,
  );
  const activeWork = getVisibleActiveWork(
    state,
    activeJobs,
    infrastructure,
    cloud,
  );
  return {
    missions: getVisibleMissions(state),
    projects: getVisibleProjects(state),
    contracts,
    contractMarket,
    standingOrders: getVisibleStandingOrders(state),
    jobs,
    activeWork,
    departureForecast: getDepartureForecast(state, activeWork, infrastructure),
  };
};
