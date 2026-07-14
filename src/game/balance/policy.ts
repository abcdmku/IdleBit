import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountCompare,
  amountDivide,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  type Amount,
} from "../amount";
import type {
  AutomationBufferLevelId,
  GameAction,
  TaskId,
} from "../types";
import type { ServerSkuId } from "../infrastructureTypes";
import type {
  ActionPolicyAdapter,
  ActionPolicyContext,
  EngagementProfileId,
} from "./types";

type ReadonlyVisible = ActionPolicyContext["visible"];
type ReadonlyJob = ReadonlyVisible["jobs"][number];
type ReadonlyContract = ReadonlyVisible["contracts"][number];
type ReadonlyProject = ReadonlyVisible["projects"][number];
type ReadonlyFleetNode = ReadonlyVisible["infrastructure"]["fleet"]["nodes"][number];
type ReadonlyFacility = ReadonlyVisible["infrastructure"]["facilities"][number];
type ReadonlyCost = {
  readonly resource: string;
  readonly amount: unknown;
};

export type PolicyActionCategory =
  | "recovery"
  | "buffer"
  | "standing-order"
  | "contract"
  | "project"
  | "research"
  | "manual-dispatch"
  | "upgrade"
  | "live-operations"
  | "fleet"
  | "workshop"
  | "cloud";

export type PolicyAuditNoteCode =
  | "action-cap"
  | "active-work-covered"
  | "buffer-reserve"
  | "contract-refresh-not-due"
  | "fleet-gated"
  | "no-contract-fit"
  | "no-project-fit"
  | "no-safe-manual-work"
  | "no-safe-standing-order"
  | "resource-reserve"
  | "single-system-protected";

export interface PolicyActionReason {
  action: GameAction;
  category: PolicyActionCategory;
  reason: string;
  manualDispatch: boolean;
}

export interface PolicyAuditNote {
  code: PolicyAuditNoteCode;
  message: string;
}

export interface BalancePolicyAudit {
  profileId: EngagementProfileId;
  actionReasons: readonly PolicyActionReason[];
  notes: readonly PolicyAuditNote[];
  actionCount: number;
  manualDispatchActions: number;
  manualDispatchShare: number;
  developerGrantActions: number;
  noOpReason: string | null;
  stranded: boolean;
  strandingReasons: readonly string[];
}

export interface BalancePolicyDecision {
  actions: readonly GameAction[];
  audit: BalancePolicyAudit;
}

export interface PolicyActionOutcomeAudit extends PolicyActionReason {
  changedPublicState: boolean;
  noOp: boolean;
  noOpReason: string | null;
}

export interface AuditableActionPolicyAdapter extends ActionPolicyAdapter {
  decide(context: ActionPolicyContext): BalancePolicyDecision;
}

/** Audits one sequential dispatch using only the public observations around it. */
export const auditPolicyActionOutcome = (
  decision: BalancePolicyDecision,
  actionIndex: number,
  before: ReadonlyVisible,
  after: ReadonlyVisible,
): PolicyActionOutcomeAudit => {
  const actionReason = decision.audit.actionReasons[actionIndex];
  if (!actionReason) {
    throw new RangeError(`Policy action index ${actionIndex} is outside this decision.`);
  }
  const changedPublicState = JSON.stringify(before) !== JSON.stringify(after);
  return {
    ...actionReason,
    changedPublicState,
    noOp: !changedPublicState,
    noOpReason: changedPublicState
      ? null
      : `Dispatch produced no public change: ${actionReason.reason}`,
  };
};

interface PolicyConfig {
  maximumActions: number;
  reserveBps: number;
  bufferReserveBps: number;
  contractLimit: number;
  contractFitBps: number;
  allowBurstContracts: boolean;
  projectLimit: number;
  allowSideProjects: boolean;
  manualDispatchLimit: number;
  standingOrderHysteresisBps: number;
  fleetUtilizationBps: number;
  aggregateServerPreference: "workshop" | "dense";
  allowClusters: boolean;
  dataCreditWeight: number;
}

const POLICY_CONFIGS: Readonly<Record<EngagementProfileId, PolicyConfig>> = {
  "full-idle": {
    maximumActions: 4,
    reserveBps: 2_000,
    bufferReserveBps: 1_000,
    contractLimit: 0,
    contractFitBps: 20_000,
    allowBurstContracts: false,
    projectLimit: 1,
    // Low-attention players still choose finite project phases when they
    // return. In particular, Open Foundry is their non-contract source of the
    // first-completion Data needed for Workshop specialization.
    allowSideProjects: true,
    manualDispatchLimit: 1,
    standingOrderHysteresisBps: 1_000,
    fleetUtilizationBps: 9_500,
    aggregateServerPreference: "workshop",
    allowClusters: false,
    dataCreditWeight: 12,
  },
  regular: {
    maximumActions: 6,
    reserveBps: 1_500,
    bufferReserveBps: 0,
    contractLimit: 1,
    contractFitBps: 13_000,
    allowBurstContracts: true,
    projectLimit: 1,
    allowSideProjects: true,
    manualDispatchLimit: 1,
    standingOrderHysteresisBps: 500,
    fleetUtilizationBps: 9_000,
    aggregateServerPreference: "workshop",
    allowClusters: false,
    dataCreditWeight: 14,
  },
  engaged: {
    maximumActions: 6,
    reserveBps: 1_000,
    bufferReserveBps: 500,
    contractLimit: 1,
    contractFitBps: 10_000,
    allowBurstContracts: true,
    projectLimit: 1,
    allowSideProjects: true,
    manualDispatchLimit: 1,
    standingOrderHysteresisBps: 200,
    fleetUtilizationBps: 9_000,
    aggregateServerPreference: "workshop",
    allowClusters: true,
    dataCreditWeight: 16,
  },
  optimizer: {
    maximumActions: 8,
    reserveBps: 500,
    bufferReserveBps: 250,
    contractLimit: 3,
    contractFitBps: 9_000,
    allowBurstContracts: true,
    projectLimit: 3,
    allowSideProjects: true,
    manualDispatchLimit: 3,
    standingOrderHysteresisBps: 0,
    fleetUtilizationBps: 8_000,
    aggregateServerPreference: "dense",
    allowClusters: true,
    dataCreditWeight: 24,
  },
};

const BUFFER_ORDER: readonly AutomationBufferLevelId[] = [
  "startingNode",
  "localScheduler",
  "cronRuntime",
  "systemScheduler",
  "fleetOrchestrator",
  "clusterController",
  "rackController",
  "dataCenterNoc",
  "globalScheduler",
];

const BASIS_POINTS = 10_000;
const CLOUD_HUB_DEMAND = amount("2000000000000");
const CLOUD_SPOKE_DEMAND = amount("1");
const CLOUD_ROUTING_LINK_CAPACITY = amount("500000000000");
const WORKSHOP_PROOF_PSU_LEVEL = 34;
const FACILITY_ACTIVE_CAPACITY_BPS = 7_000;
const HALF_RACK_UNITS = 24;
const HALF_RACK_POWER_WATTS = amount("12000");
const HALF_RACK_COOLING_WATTS = amount("10000");
const WORKSHOP_FACILITY_COMMISSION_COSTS: readonly ReadonlyCost[] = [
  { resource: "credits", amount: amount("500000") },
];
const HALF_RACK_COMMISSION_COSTS: readonly ReadonlyCost[] = [
  { resource: "credits", amount: amount("100000") },
];
const OBJECTIVE_PROJECT_IDS: Readonly<Partial<Record<string, string>>> = {
  "fleet:catalog": "schedulerIntegration",
};

const aggregatePurchaseGuards: Readonly<
  Record<"workshop" | "dense", {
    skuId: ServerSkuId;
    credits: Amount;
    data: Amount;
  }>
> = {
  workshop: {
    skuId: "workshopServer",
    credits: amount("292000"),
    data: amount("1"),
  },
  dense: {
    skuId: "denseServer",
    credits: amount("1000000"),
    data: amount("800"),
  },
};

interface PolicyBudget {
  starting: Record<"credits" | "data", Amount>;
  remaining: Record<"credits" | "data", Amount>;
}

const getCostTotals = (costs: readonly ReadonlyCost[]) => {
  const totals = { credits: ZERO_AMOUNT, data: ZERO_AMOUNT };
  for (const cost of costs) {
    if (cost.resource !== "credits" && cost.resource !== "data") continue;
    totals[cost.resource] = amountAdd(
      totals[cost.resource],
      amount(typeof cost.amount === "number" ? cost.amount : String(cost.amount)),
    );
  }
  return totals;
};

const trySpendBudget = (
  budget: PolicyBudget,
  costs: readonly ReadonlyCost[],
  reserveBps: number,
) => {
  const totals = getCostTotals(costs);
  const after = {
    credits: amountSubtract(budget.remaining.credits, totals.credits),
    data: amountSubtract(budget.remaining.data, totals.data),
  };
  for (const resource of ["credits", "data"] as const) {
    if (amountCompare(after[resource], 0) < 0) return false;
    const reserve = amountDivide(
      amountMultiply(budget.starting[resource], reserveBps),
      BASIS_POINTS,
    );
    if (amountCompare(after[resource], reserve) < 0) return false;
  }
  budget.remaining = after;
  return true;
};

const toAmount = (input: unknown) =>
  amount(typeof input === "number" ? input : String(input));

type ReadonlyPowerSnapshot = {
  readonly capacity: {
    readonly powerWatts: unknown;
    readonly coolingWatts: unknown;
  };
  readonly demand: {
    readonly powerWatts: unknown;
    readonly coolingWatts: unknown;
  };
};

interface FacilityPlacementCandidate {
  facility: ReadonlyFacility;
  rack: ReadonlyFacility["racks"][number];
  node: ReadonlyFleetNode;
}

const getNodeRackUnits = (node: ReadonlyFleetNode) =>
  node.source.kind === "aggregate" ? node.source.count : 1;

const powerSnapshotCanAdmitNode = (
  snapshot: ReadonlyPowerSnapshot,
  node: ReadonlyFleetNode,
) => {
  const addedDemand = toAmount(node.capacity.peakWatts);
  return (["powerWatts", "coolingWatts"] as const).every((resource) =>
    amountCompare(
      amountAdd(toAmount(snapshot.demand[resource]), addedDemand),
      amountDivide(
        amountMultiply(
          toAmount(snapshot.capacity[resource]),
          FACILITY_ACTIVE_CAPACITY_BPS,
        ),
        BASIS_POINTS,
      ),
    ) <= 0,
  );
};

const nodeCanFitEmptyHalfRack = (node: ReadonlyFleetNode) => {
  if (getNodeRackUnits(node) > HALF_RACK_UNITS) return false;
  const peakWatts = toAmount(node.capacity.peakWatts);
  return (
    amountCompare(
      peakWatts,
      amountDivide(
        amountMultiply(HALF_RACK_POWER_WATTS, FACILITY_ACTIVE_CAPACITY_BPS),
        BASIS_POINTS,
      ),
    ) <= 0 &&
    amountCompare(
      peakWatts,
      amountDivide(
        amountMultiply(HALF_RACK_COOLING_WATTS, FACILITY_ACTIVE_CAPACITY_BPS),
        BASIS_POINTS,
      ),
    ) <= 0
  );
};

const getAvailableUnplacedNodes = (
  visible: ReadonlyVisible,
  predicate: (node: ReadonlyFleetNode) => boolean = () => true,
) => {
  const placedNodeIds = new Set(
    visible.infrastructure.facilities.flatMap((facility) =>
      facility.racks.flatMap((rack) => rack.nodeIds),
    ),
  );
  const activeWorkloadNodeIds = new Set(
    visible.infrastructure.workloads
      .filter((workload) => workload.status !== "completed")
      .flatMap((workload) =>
        workload.placements.map((placement) => placement.nodeId),
      ),
  );
  return [...visible.infrastructure.fleet.nodes]
    .filter(
      (node) =>
        node.managed &&
        !placedNodeIds.has(node.id) &&
        !activeWorkloadNodeIds.has(node.id) &&
        predicate(node),
    )
    .sort(
      (left, right) =>
        getNodeRackUnits(left) - getNodeRackUnits(right) ||
        left.id.localeCompare(right.id),
    );
};

const findFacilityPlacement = (
  facilities: readonly ReadonlyFacility[],
  nodes: readonly ReadonlyFleetNode[],
): FacilityPlacementCandidate | null => {
  for (const facility of [...facilities].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    for (const rack of [...facility.racks].sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      for (const node of nodes) {
        if (
          getNodeRackUnits(node) <= rack.rackUnits.available &&
          powerSnapshotCanAdmitNode(rack, node) &&
          powerSnapshotCanAdmitNode(facility, node)
        ) {
          return { facility, rack, node };
        }
      }
    }
  }
  return null;
};

const findFacilityForHalfRack = (
  facilities: readonly ReadonlyFacility[],
  nodes: readonly ReadonlyFleetNode[],
) =>
  [...facilities]
    .sort((left, right) => left.id.localeCompare(right.id))
    .find(
      (facility) =>
        facility.rackSlots.available > 0 &&
        nodes.some(
          (node) =>
            nodeCanFitEmptyHalfRack(node) &&
            powerSnapshotCanAdmitNode(facility, node),
        ),
    ) ?? null;

const value = (credits: unknown, data: unknown, dataWeight: number) =>
  amountAdd(toAmount(credits), amountMultiply(toAmount(data), dataWeight));

const compareRates = <Item>(
  left: Item,
  right: Item,
  getValue: (item: Item) => Amount,
  getDuration: (item: Item) => number,
  getId: (item: Item) => string,
) => {
  const comparison = amountCompare(
    amountMultiply(getValue(left), Math.max(1, getDuration(right))),
    amountMultiply(getValue(right), Math.max(1, getDuration(left))),
  );
  return comparison === 0 ? getId(left).localeCompare(getId(right)) : -comparison;
};

const bufferAtLeast = (
  ownedLevelId: AutomationBufferLevelId,
  requiredLevelId: AutomationBufferLevelId,
) => BUFFER_ORDER.indexOf(ownedLevelId) >= BUFFER_ORDER.indexOf(requiredLevelId);

const getManagedSystemIds = (visible: ReadonlyVisible) =>
  new Set(
    visible.infrastructure.fleet.nodes.flatMap((node) =>
      node.managed && node.source.kind === "system" ? [node.source.systemId] : [],
    ),
  );

const selectedSystemCanRunWork = (visible: ReadonlyVisible) =>
  visible.selectedSystem.powerState === "on" &&
  !getManagedSystemIds(visible).has(visible.selectedSystem.id);

const workFitsHardware = (job: ReadonlyJob, visible: ReadonlyVisible) =>
  job.visibility === "default" &&
  job.cacheFit !== "low" &&
  job.requiredCores <= visible.hardware.cores &&
  job.cacheNeedBits <= visible.hardware.cacheBits &&
  job.ramNeedBits <= visible.hardware.ramBits;

const canDispatchWithStartAction = (
  task: Pick<ReadonlyJob, "category" | "canStart" | "canQueue">,
) =>
  task.canStart &&
  (!["system", "distributed"].includes(task.category) || task.canQueue);

const taskIsInFlight = (visible: ReadonlyVisible, taskId: TaskId) =>
  visible.activeTasks.some((task) => task.taskId === taskId) ||
  visible.queue.some((entry) =>
    typeof entry === "string" ? entry === taskId : entry.taskId === taskId,
  );

const getSpecializedObjectiveTaskIds = (
  visible: ReadonlyVisible,
): readonly TaskId[] => {
  if (visible.currentObjective?.id !== "fleet:specialized-throughput") return [];
  if (!visible.workshop.thermalControlsUnlocked) {
    if (taskIsInFlight(visible, "thermalProbe")) return ["thermalProbe"];
    return !visible.workshop.thermalVisible &&
      visible.tasks.some((task) => task.id === "thermalProbe")
      ? ["thermalProbe"]
      : ["warm", "hot", "critical"].includes(
            visible.workshop.highestObservedThermalStatus,
          )
        ? []
        : ["compileCode"];
  }
  if (
    !visible.workshop.specializedComputeUnlocked ||
    visible.hardware.psuLevel < WORKSHOP_PROOF_PSU_LEVEL ||
    !["gpu", "npu"].every((kind) =>
      visible.workshop.accelerators.some((device) => device.kind === kind),
    )
  ) {
    return [];
  }
  return [
    ...(visible.workshop.evidence.gpuRenderCompletions === 0
      ? (["renderFrame"] as TaskId[])
      : []),
    ...(visible.workshop.evidence.npuInferenceCompletions === 0
      ? (["inferenceBatch"] as TaskId[])
      : []),
    ...(visible.workshop.specializationComplete
      ? (["workstationBenchmark"] as TaskId[])
      : []),
  ];
};

const repeatJobValue = (job: ReadonlyJob, dataWeight: number) =>
  // Standing orders must value repeat rewards, never the one-time rewardData field.
  value(job.rewardCredits, job.repeatRewardData, dataWeight);

const manualJobValue = (job: ReadonlyJob, dataWeight: number) =>
  value(job.rewardCredits, job.firstCompletionData, dataWeight);

const bestStandingOrderJob = (
  visible: ReadonlyVisible,
  config: PolicyConfig,
  profileId: EngagementProfileId,
) => {
  const candidates = [...visible.jobs].filter(
    (job) => job.kind === "job" && workFitsHardware(job, visible),
  );
  if (profileId === "full-idle" && visible.currentChapter.index <= 2) {
    const safeBaseline = candidates.find((job) => job.id === "memoryScrub");
    if (safeBaseline) return safeBaseline;
  }
  // Prefer a real unattended batch when one is available. Tiny opening jobs can
  // still be used as a fallback, but must not remain the campaign throughput
  // ceiling after system work is visible.
  const scaled = candidates.filter((job) => job.rewardCredits >= 1_000);
  const batched = scaled.length > 0
    ? scaled
    : candidates.filter((job) => job.seconds >= 60);
  return (batched.length > 0 ? batched : candidates)
    .sort((left, right) =>
      compareRates(
        left,
        right,
        (job) => repeatJobValue(job, config.dataCreditWeight),
        (job) => Math.round(job.seconds * 1_000),
        (job) => job.id,
      ),
    )[0] ?? null;
};

const standingOrderIsBetter = (
  candidate: ReadonlyJob,
  current: ReadonlyJob | undefined,
  visible: ReadonlyVisible,
  config: PolicyConfig,
) => {
  if (!current || current.kind !== "job" || !workFitsHardware(current, visible)) {
    return true;
  }
  if (candidate.seconds >= 60 && current.seconds < 60) return true;
  const candidateValue = repeatJobValue(candidate, config.dataCreditWeight);
  const currentValue = repeatJobValue(current, config.dataCreditWeight);
  return amountCompare(
    amountMultiply(
      amountMultiply(candidateValue, Math.max(1, Math.round(current.seconds * 1_000))),
      BASIS_POINTS,
    ),
    amountMultiply(
      amountMultiply(currentValue, Math.max(1, Math.round(candidate.seconds * 1_000))),
      BASIS_POINTS + config.standingOrderHysteresisBps,
    ),
  ) > 0;
};

const contractFits = (
  contract: ReadonlyContract,
  context: ActionPolicyContext,
  config: PolicyConfig,
) => {
  const valueMultiplierBps = contract.valueMultiplierVsStandingOrderBps;
  if (
    contract.accepted ||
    !contract.canAccept ||
    !contract.creditRunwayCovered ||
    !contract.bufferCovered ||
    contract.projectedPauseReason !== null ||
    valueMultiplierBps === null ||
    valueMultiplierBps === undefined ||
    valueMultiplierBps * 6_000 < BASIS_POINTS * BASIS_POINTS ||
    valueMultiplierBps * 4_500 > BASIS_POINTS * BASIS_POINTS ||
    (!config.allowBurstContracts && contract.kind === "burst")
  ) {
    return false;
  }
  const system = context.visible.systems.find(
    (candidate) => candidate.id === contract.systemId,
  );
  if (!system || system.powerState !== "on" || getManagedSystemIds(context.visible).has(system.id)) {
    return false;
  }
  const offlineCapable = bufferAtLeast(
    context.visible.automationBuffer.ownedLevelId,
    "localScheduler",
  );
  if (contract.expiresAtMs === null) {
    return contract.workRequiredMs <=
      context.remainingActiveMs + (offlineCapable ? context.visible.automationBuffer.maxOfflineMs : 0);
  }
  const availableMs = Math.max(
    0,
    contract.expiresAtMs - context.visible.infrastructure.elapsedMs,
  );
  const fitBps = config.contractFitBps * (offlineCapable ? 1 : 2);
  return availableMs * BASIS_POINTS >= contract.workRequiredMs * fitBps;
};

const contractValue = (contract: ReadonlyContract, config: PolicyConfig) =>
  value(
    contract.rewards.credits,
    contract.rewards.data,
    config.dataCreditWeight * (contract.novel ? 2 : 1),
  );

const projectFits = (
  project: ReadonlyProject,
  context: ActionPolicyContext,
  config: PolicyConfig,
) => {
  const requiredByObjective =
    OBJECTIVE_PROJECT_IDS[context.visible.currentObjective?.id ?? ""] === project.id;
  if (
    !project.canStartPhase ||
    project.active ||
    project.completed ||
    !project.currentPhase ||
    project.currentPhase.durationMs >= Number.MAX_SAFE_INTEGER ||
    (!config.allowSideProjects && project.sideArcId !== null && !requiredByObjective) ||
    !selectedSystemCanRunWork(context.visible)
  ) {
    return false;
  }
  return (
    bufferAtLeast(context.visible.automationBuffer.ownedLevelId, "systemScheduler") ||
    project.currentPhase.durationMs <= context.remainingActiveMs
  );
};

const projectValue = (project: ReadonlyProject, config: PolicyConfig) => {
  const phase = project.currentPhase!;
  const costs = getCostTotals(phase.costs);
  const rewards = value(
    phase.rewards.credits,
    phase.rewards.data,
    config.dataCreditWeight,
  );
  return amountSubtract(
    rewards,
    value(costs.credits, costs.data, config.dataCreditWeight),
  );
};

const progressionUpgradeScore = (
  upgrade: ReadonlyVisible["upgrades"][number],
  visible: ReadonlyVisible,
) => {
  const unmetHardwareIds = visible.research.flatMap((research) =>
    research.requirements
      .filter((requirement) => !requirement.met && requirement.kind === "hardware")
      .map((requirement) => requirement.id),
  );
  const missingRequiredTask = visible.research.some((research) =>
    research.requirements.some(
      (requirement) =>
        !requirement.met &&
        requirement.id.startsWith("task:") &&
        !visible.jobs.some(
          (job) => job.id === requirement.id.slice("task:".length),
        ),
    ),
  );
  const objectiveTaskIds =
    visible.currentObjective?.id === "fleet:specialized-throughput"
      ? new Set<TaskId>([
          "compileCode",
          "thermalProbe",
          "renderFrame",
          "inferenceBatch",
          "workstationBenchmark",
        ])
      : null;
  const objectiveProofTasks = visible.tasks.filter((task) =>
    objectiveTaskIds?.has(task.id),
  );
  const computeBlockers = [
    ...visible.research.flatMap((research) =>
      research.computeTasks
        .filter((task) => !task.completed)
        .flatMap((task) => [task.blockedReason, task.queueBlockedReason]),
    ),
    ...objectiveProofTasks
      .filter((job) => objectiveTaskIds?.has(job.id))
      .flatMap((job) => [job.blockedReason, job.queueBlockedReason]),
  ].filter((reason): reason is string => reason !== null);
  if (
    upgrade.id === "schedulerSlot" &&
    computeBlockers.some((reason) => reason.includes("CPU scheduler"))
  ) {
    return 2_000;
  }
  if (
    upgrade.id === "systemSchedulerSlot" &&
    computeBlockers.some((reason) =>
      /(system queue|system scheduler slots)/i.test(reason),
    )
  ) {
    return 2_000;
  }
  if (
    upgrade.id === "cache" &&
    objectiveProofTasks.some(
      (task) => task.cacheNeedBits > visible.hardware.cacheBits,
    )
  ) {
    return 2_000;
  }
  if (
    ["ram", "ramCapacity"].includes(upgrade.id) &&
    objectiveProofTasks.some(
      (task) => task.ramNeedBits > visible.hardware.ramBits,
    )
  ) {
    return 2_000;
  }
  if (upgrade.id === "cache" && missingRequiredTask) return 2_000;
  if (
    upgrade.id === "schedulerSlot" &&
    visible.flags.basicQueue &&
    visible.hardware.cpus.reduce(
      (total, cpu) => total + (cpu.schedulerSlots ?? 0),
      0,
    ) < 2
  ) {
    // The finite queue is the intended post-Local-Scheduler income path;
    // without a couple of slots the run regresses to manual task spam.
    return 1_500;
  }
  if (
    upgrade.id === "clock" &&
    unmetHardwareIds.some((id) => id.includes("clock-level"))
  ) {
    return 2_000;
  }
  if (
    upgrade.id === "cache" &&
    unmetHardwareIds.some((id) => id.includes("cache-level"))
  ) {
    return 2_000;
  }
  if (
    upgrade.id === "core" &&
    unmetHardwareIds.some((id) => id.includes("cores"))
  ) {
    return 2_000;
  }
  if (unmetHardwareIds.some((id) => id.includes("one-kilobit-ram"))) {
    if (visible.hardware.ramBits === 0 && upgrade.id === "ram") return 2_000;
    if (visible.hardware.ramBits > 0 && upgrade.id === "ramCapacity") return 2_000;
  }
  if (
    upgrade.id === "secondCpu" &&
    unmetHardwareIds.some((id) => id.includes("second-cpu"))
  ) {
    return 2_000;
  }
  return 0;
};

const upgradeScore = (
  upgrade: ReadonlyVisible["upgrades"][number],
  visible: ReadonlyVisible,
) => {
  const bottleneck = visible.bottleneck.toLowerCase();
  let score = progressionUpgradeScore(upgrade, visible);
  if (upgrade.id === "psu" && visible.metrics.psuStress >= 0.7) score += 1_000;
  if (bottleneck.includes("power") && upgrade.id === "psu") score += 800;
  if (bottleneck.includes("cache") && ["cache", "cacheSpeed"].includes(upgrade.id)) {
    score += 700;
  }
  if (bottleneck.includes("ram") && upgrade.component === "ram") score += 700;
  if (bottleneck.includes("queue") && upgrade.component === "scheduler") score += 600;
  score += ["cache", "clock", "cacheSpeed", "core", "ram", "psu"].indexOf(
    upgrade.id,
  ) >= 0
    ? 100
    : 0;
  return score;
};

const fleetGateOpen = (visible: ReadonlyVisible) =>
  !visible.infrastructure.fleet.blockers.some((blocker) =>
    blocker.startsWith("Requires "),
  );

const researchProgressionScore = (
  researchId: ReadonlyVisible["research"][number]["id"],
  visible: ReadonlyVisible,
) => {
  const objectivePriorities: Partial<Record<string, readonly string[]>> = {
    "bootstrap:decode-logic": ["decodeLogic"],
    "bootstrap:byte-copy": ["byteOperations", "cacheMapping"],
    "bootstrap:first-benchmark": ["cacheMapping", "benchmarkHarness"],
    "coherent:multicore": ["multiCore"],
    "coherent:local-scheduler": ["localScheduler"],
    "coherent:ram-control": ["ramControl"],
    "coherent:system-scheduler": ["systemScheduler"],
    "coherent:cron-runtime": ["systemBus", "cronScheduler"],
    "fleet:catalog": ["systemCatalog"],
    "fleet:specialized-throughput": ["thermalControl", "specializedCompute"],
    "fabric:cluster-controller": ["clusterControllerResearch"],
    "facility:rack-controller": ["rackControllerResearch"],
    "cloud:data-center-noc": ["dataCenterNocResearch"],
    "planetary:global-scheduler": ["globalSchedulerResearch"],
  };
  const priorities = objectivePriorities[visible.currentObjective?.id ?? ""] ?? [];
  const objectiveIndex = priorities.indexOf(researchId);
  if (objectiveIndex >= 0) return 10_000 - objectiveIndex;

  const mainOrder = [
    "decodeLogic",
    "byteOperations",
    "cacheMapping",
    "benchmarkHarness",
    "multiCore",
    "localScheduler",
    "ramControl",
    "systemScheduler",
    "systemBus",
    "cronScheduler",
    "systemCatalog",
    "thermalControl",
    "specializedCompute",
    "cpuTierKhz",
    "cpuTierMhz",
    "cpuTierGhz",
    "clusterControllerResearch",
    "rackControllerResearch",
    "dataCenterNocResearch",
    "globalSchedulerResearch",
  ];
  const mainIndex = mainOrder.indexOf(researchId);
  return mainIndex >= 0 ? 1_000 - mainIndex : 0;
};

/** Pure public-state policy decision with action-level reasons and stranding audit. */
export const decideBalancePolicy = (
  context: ActionPolicyContext,
): BalancePolicyDecision => {
  const visible = context.visible;
  const config = POLICY_CONFIGS[context.profileId];
  const budget: PolicyBudget = {
    starting: {
      credits: toAmount(visible.exactResources.credits),
      data: toAmount(visible.exactResources.data),
    },
    remaining: {
      credits: toAmount(visible.exactResources.credits),
      data: toAmount(visible.exactResources.data),
    },
  };
  const actionReasons: PolicyActionReason[] = [];
  const notes: PolicyAuditNote[] = [];

  const note = (code: PolicyAuditNoteCode, message: string) => {
    if (!notes.some((candidate) => candidate.code === code)) notes.push({ code, message });
  };
  const addAction = (
    action: GameAction,
    category: PolicyActionCategory,
    reason: string,
    costs: readonly ReadonlyCost[] = [],
    reserveBps = config.reserveBps,
  ) => {
    if (actionReasons.length >= config.maximumActions) {
      note("action-cap", `Deferred ${category}; ${context.profileId} action cap reached.`);
      return false;
    }
    if (!trySpendBudget(budget, costs, reserveBps)) {
      note(
        category === "buffer" ? "buffer-reserve" : "resource-reserve",
        `Deferred ${category}; the virtual purchase plan would consume its reserve.`,
      );
      return false;
    }
    actionReasons.push({
      action,
      category,
      reason,
      manualDispatch: category === "manual-dispatch",
    });
    return true;
  };

  const managedSystemIds = getManagedSystemIds(visible);
  const specializedObjective =
    visible.currentObjective?.id === "fleet:specialized-throughput";
  const specializedObjectiveTaskIds = getSpecializedObjectiveTaskIds(visible);
  const protectedLocalSystem = [...visible.systems]
    .sort(
      (left, right) =>
        right.coreCount - left.coreCount ||
        right.ramBits - left.ramBits ||
        left.id - right.id,
    )[0] ?? null;
  const managedWorkshopSystem =
    specializedObjective &&
    protectedLocalSystem &&
    managedSystemIds.has(protectedLocalSystem.id)
      ? protectedLocalSystem
      : null;
  if (specializedObjective && managedWorkshopSystem) {
    addAction(
      {
        type: "setSystemManaged",
        systemId: managedWorkshopSystem.id,
        managed: false,
      },
      "fleet",
      `Return ${managedWorkshopSystem.name} to local control for the finite Workshop proof.`,
    );
  } else if (
    specializedObjective &&
    protectedLocalSystem &&
    protectedLocalSystem.id !== visible.selectedSystem.id
  ) {
    addAction(
      { type: "selectSystem", systemId: protectedLocalSystem.id },
      "fleet",
      `Select strongest local system ${protectedLocalSystem.name} for the finite Workshop proof.`,
    );
  }
  const preferredBatchSystem =
    protectedLocalSystem && !managedSystemIds.has(protectedLocalSystem.id)
      ? protectedLocalSystem
      : null;
  if (
    visible.currentChapter.index >= 3 &&
    preferredBatchSystem &&
    preferredBatchSystem.powerState === "off"
  ) {
    addAction(
      { type: "requestStartup", systemId: preferredBatchSystem.id },
      "recovery",
      `Start ${preferredBatchSystem.name} before assigning scaled batch work.`,
    );
  } else if (
    visible.currentChapter.index >= 3 &&
    preferredBatchSystem &&
    preferredBatchSystem.powerState === "on" &&
    preferredBatchSystem.id !== visible.selectedSystem.id
  ) {
    addAction(
      { type: "selectSystem", systemId: preferredBatchSystem.id },
      "fleet",
      `Select ${preferredBatchSystem.name} for scaled local batch work.`,
    );
  }

  if (visible.selectedSystem.powerState === "off") {
    addAction(
      { type: "requestStartup", systemId: visible.selectedSystem.id },
      "recovery",
      "Restart the selected system before scheduling productive work.",
    );
  }

  if (context.profileId !== "full-idle" && visible.liveOperations.unlocked) {
    const liveSystem =
      protectedLocalSystem && !managedSystemIds.has(protectedLocalSystem.id)
        ? protectedLocalSystem
        : visible.systems.find((system) => !managedSystemIds.has(system.id)) ??
          visible.selectedSystem;
    const maximumCoreCount = Math.max(1, Math.min(6, liveSystem.coreCount));
    const needsConfiguration =
      visible.liveOperations.systemId !== liveSystem.id ||
      visible.liveOperations.maxCoreCount !== maximumCoreCount;
    // Required research benchmarks are finite progression work, not idle
    // capacity. Keep Live Operations paused until they have a real public
    // dispatch path; otherwise the attended lane would occupy every spare
    // core and strand the campaign at System Bus/other compute gates.
    // A benchmark blocked only on idle cores counts as pending — that block
    // is usually Live Operations itself holding the cores.
    const researchComputePending = visible.research.some((research) =>
      research.computeTasks.some(
        (task) =>
          !task.completed &&
          !task.active &&
          (task.canStart || /idle core/i.test(task.blockedReason ?? "")),
      ),
    );
    if (needsConfiguration) {
      addAction(
        {
          type: "configureLiveOperations",
          systemId: liveSystem.id,
          maxCoreCount: maximumCoreCount,
        },
        "live-operations",
        `Configure attended idle capacity on ${liveSystem.name}.`,
      );
    }
    const finiteLocalProofPending = specializedObjectiveTaskIds.length > 0;
    const liveOperationsMustYield =
      researchComputePending || finiteLocalProofPending;
    if (liveOperationsMustYield && visible.liveOperations.enabled) {
      addAction(
        { type: "setLiveOperationsEnabled", enabled: false },
        "live-operations",
        "Pause attended capacity while finite progression work is pending.",
      );
    } else if (!liveOperationsMustYield && !visible.liveOperations.enabled) {
      addAction(
        { type: "setLiveOperationsEnabled", enabled: true },
        "live-operations",
        "Enable foreground-only Live Operations.",
      );
    }
  }

  const buffer = visible.automationBuffer.nextUpgrade;
  const protectPendingCronBuffer =
    buffer?.id === "cronRuntime";
  // Under metered billing an idle-heavy wallet hovers near its income/drain
  // equilibrium, so a draw-raising purchase right before the CRON Runtime
  // buffer becomes buyable can trap the run below the buffer cost forever.
  // Once half the buffer cost is banked while power bills, even progression
  // upgrades wait until unattended renewal coverage is secured.
  const cronBufferCostTotals =
    protectPendingCronBuffer && buffer ? getCostTotals(buffer.costs) : null;
  const protectCronBufferSavingsUnderBilling = Boolean(
    buffer?.unlocked &&
      cronBufferCostTotals &&
      visible.metrics.powerCostPerSecond > 0 &&
      (["credits", "data"] as const).every(
        (resource) =>
          amountCompare(
            amountMultiply(budget.starting[resource], 2),
            cronBufferCostTotals[resource],
          ) >= 0,
      ),
  );
  // Savings emerge from public affordability instead of authored calendar
  // dates: once at least half of every resource cost of the next unlocked
  // buffer is banked, optional tuning defers so unattended coverage timing
  // stays measurable rather than policy-scripted.
  const bufferCostTotals = buffer ? getCostTotals(buffer.costs) : null;
  const protectPendingMilestoneBuffer = Boolean(
    buffer?.unlocked &&
      !buffer.canAfford &&
      bufferCostTotals &&
      (["credits", "data"] as const).every(
        (resource) =>
          amountCompare(
            amountMultiply(budget.starting[resource], 2),
            bufferCostTotals[resource],
          ) >= 0,
      ),
  );
  if (buffer?.unlocked && buffer.canAfford) {
    addAction(
      { type: "purchaseAutomationBuffer", levelId: buffer.id },
      "buffer",
      `Extend unattended coverage to ${buffer.name}.`,
      buffer.costs,
      buffer.id === "localScheduler" || buffer.id === "cronRuntime"
        ? 0
        : config.bufferReserveBps,
    );
  }

  const standingAutomationReady =
    visible.flags.cron ||
    bufferAtLeast(visible.automationBuffer.ownedLevelId, "cronRuntime");
  // Contracts are cron-gated in the market itself; refreshing earlier is a
  // guaranteed no-op the runner must never propose.
  const contractAutomationReady = visible.flags.cron;
  const standingCandidate = bestStandingOrderJob(
    visible,
    config,
    context.profileId,
  );
  const activeContracts = visible.contracts.filter((contract) => contract.accepted);
  const contractOffers = visible.contracts.filter((contract) => !contract.accepted);
  const standingMustYieldForSpecializedProof =
    specializedObjective &&
    specializedObjectiveTaskIds.length > 0 &&
    visible.standingOrder.systemId === visible.selectedSystem.id;
  if (
    standingMustYieldForSpecializedProof &&
    visible.standingOrder.enabled
  ) {
    addAction(
      { type: "setStandingOrderEnabled", enabled: false },
      "standing-order",
      "Pause the selected system's standing order while it runs the finite Workshop proof.",
    );
  }
  if (
    !standingMustYieldForSpecializedProof &&
    standingAutomationReady &&
    standingCandidate &&
    selectedSystemCanRunWork(visible)
  ) {
    const current = visible.jobs.find(
      (job) => job.id === visible.standingOrder.taskId,
    );
    const existingStandingSystem = visible.systems.find(
      (system) => system.id === visible.standingOrder.systemId,
    );
    const preserveSeparateWorkshopStanding =
      specializedObjective &&
      visible.standingOrder.enabled &&
      visible.standingOrder.taskId !== null &&
      existingStandingSystem !== undefined &&
      existingStandingSystem.id !== visible.selectedSystem.id &&
      existingStandingSystem.powerState === "on" &&
      !managedSystemIds.has(existingStandingSystem.id);
    const shouldReplace =
      !preserveSeparateWorkshopStanding &&
      (visible.standingOrder.taskId === null ||
        (context.profileId === "full-idle" &&
          standingCandidate.id === "memoryScrub" &&
          current?.id !== standingCandidate.id) ||
        (standingCandidate.id !== visible.standingOrder.taskId &&
          (!current ||
            standingOrderIsBetter(standingCandidate, current, visible, config))));
    if (shouldReplace) {
      addAction(
        {
          type: "setStandingOrder",
          taskId: standingCandidate.id,
          systemId: visible.selectedSystem.id,
        },
        "standing-order",
        `Use repeat value and hardware fit to schedule ${standingCandidate.name}.`,
      );
    } else if (!visible.standingOrder.enabled) {
      addAction(
        { type: "setStandingOrderEnabled", enabled: true },
        "standing-order",
        `Re-enable the still-best standing order ${standingCandidate.name}.`,
      );
    }
  } else if (
    !standingMustYieldForSpecializedProof &&
    standingAutomationReady &&
    !standingCandidate
  ) {
    note("no-safe-standing-order", "No visible repeatable job safely fits this system.");
  }

  const hardwareBlockedProject = visible.projects.find(
    (project) =>
      !project.completed &&
      (project.active || project.canStartPhase) &&
      project.currentPhase !== null &&
      project.currentPhase.durationMs >= Number.MAX_SAFE_INTEGER,
  );
  const projectWork = hardwareBlockedProject
    ? visible.activeWork.find(
        (work) =>
          work.kind === "project" &&
          work.id === `project:${hardwareBlockedProject.id}`,
      )
    : null;
  const projectSystemId =
    projectWork?.systemId ?? visible.selectedSystem.id;
  const projectSystemIsSelected = projectSystemId === visible.selectedSystem.id;
  if (hardwareBlockedProject && !projectSystemIsSelected) {
    addAction(
      { type: "selectSystem", systemId: projectSystemId },
      "project",
      `Inspect ${hardwareBlockedProject.name}'s assigned system before installing its missing data path.`,
    );
  }
  const projectWorkshop = visible.workshop;
  if (
    hardwareBlockedProject &&
    projectSystemIsSelected &&
    projectWorkshop.storageSkuId === "storageNone"
  ) {
    const storage = [...projectWorkshop.storageSkus]
      .filter((candidate) => candidate.id !== "storageNone" && candidate.canInstall)
      .sort((left, right) => {
        const leftCosts = getCostTotals(left.costs);
        const rightCosts = getCostTotals(right.costs);
        return amountCompare(
          value(leftCosts.credits, leftCosts.data, config.dataCreditWeight),
          value(rightCosts.credits, rightCosts.data, config.dataCreditWeight),
        );
      })[0];
    if (storage) {
      addAction(
        {
          type: "installWorkshopStorage",
          skuId: storage.id,
          systemId: projectSystemId,
        },
        "workshop",
        `Install ${storage.name} so the current project can traverse its storage stages.`,
        storage.costs,
      );
    }
  }
  if (
    hardwareBlockedProject &&
    projectSystemIsSelected &&
    projectWorkshop.storageSkuId !== "storageNone" &&
    projectWorkshop.networkUnlocked &&
    projectWorkshop.networkSkuId === "networkNone"
  ) {
    const network = [...projectWorkshop.networkSkus]
      .filter((candidate) => candidate.id !== "networkNone" && candidate.canInstall)
      .sort((left, right) => {
        const leftCosts = getCostTotals(left.costs);
        const rightCosts = getCostTotals(right.costs);
        return amountCompare(
          value(leftCosts.credits, leftCosts.data, config.dataCreditWeight),
          value(rightCosts.credits, rightCosts.data, config.dataCreditWeight),
        );
      })[0];
    if (network) {
      addAction(
        {
          type: "installLocalNetwork",
          skuId: network.id,
          systemId: projectSystemId,
        },
        "workshop",
        `Install ${network.name} so the current project can traverse its network stages.`,
        network.costs,
      );
    }
  }

  const priorityProjectId =
    OBJECTIVE_PROJECT_IDS[visible.currentObjective?.id ?? ""] ?? null;
  const priorityProjectCanStart = visible.projects.some(
    (project) =>
      project.id === priorityProjectId && projectFits(project, context, config),
  );
  if (!priorityProjectCanStart && activeContracts.length < config.contractLimit) {
    const fittingContracts = contractOffers
      .filter(
        (contract) =>
          contractFits(contract, context, config) &&
          (specializedObjectiveTaskIds.length === 0 ||
            contract.systemId !== visible.selectedSystem.id),
      )
      .sort((left, right) =>
        compareRates(
          left,
          right,
          (contract) => contractValue(contract, config),
          (contract) => contract.workRequiredMs,
          (contract) => contract.id,
        ),
    );
    const contract = fittingContracts[0];
    if (contract) {
      addAction(
        // The policy already validated the offer against its suggested
        // system in contractFits; pass that same choice explicitly now that
        // acceptance takes a player-chosen target.
        {
          type: "acceptContract",
          contractId: contract.id,
          systemId: contract.systemId,
        },
        "contract",
        `Accept the highest-value offer that fits its system and expiry window: ${contract.name}.`,
      );
    } else {
      if (contractOffers.length > 0) {
        note("no-contract-fit", "Visible contract offers do not fit this policy window.");
      }
      // Real players reroll a bad market whenever the public cooldown allows:
      // an unusable nonempty market is refreshed just like an empty one.
      if (
        specializedObjectiveTaskIds.length === 0 &&
        contractAutomationReady &&
        visible.contractMarket.canRefresh
      ) {
        addAction(
          { type: "refreshContractMarket" },
          "contract",
          contractOffers.length > 0
            ? "Reroll the contract market because no visible offer fits this policy window."
            : "Refresh the empty contract market once finite Local Scheduler work is available.",
        );
      } else {
        note(
          "contract-refresh-not-due",
          `The public contract refresh cooldown has ${visible.contractMarket.refreshAvailableInMs} ms remaining.`,
        );
      }
    }
  }

  if (visible.projects.filter((project) => project.active).length < config.projectLimit) {
    const requiredProjectId =
      OBJECTIVE_PROJECT_IDS[visible.currentObjective?.id ?? ""] ?? null;
    const project = [...visible.projects]
      .filter((candidate) => projectFits(candidate, context, config))
      .sort((left, right) => {
        const objectivePriority =
          Number(right.id === requiredProjectId) - Number(left.id === requiredProjectId);
        return objectivePriority || compareRates(
          left,
          right,
          (candidate) => projectValue(candidate, config),
          (candidate) => candidate.currentPhase?.durationMs ?? 1,
          (candidate) => candidate.id,
        );
      })[0];
    if (project?.currentPhase) {
      const phaseCosts = getCostTotals(project.currentPhase.costs);
      const selfFundingDiscoveryPhase =
        amountCompare(project.currentPhase.rewards.data, phaseCosts.data) > 0;
      addAction(
        {
          type: "startProjectPhase",
          projectId: project.id,
          systemId: visible.selectedSystem.id,
        },
        "project",
        `Start the best-value phase that fits available foreground/offline coverage: ${project.currentPhase.name}.`,
        project.currentPhase.costs,
        selfFundingDiscoveryPhase ? 0 : config.reserveBps,
      );
    } else if (visible.projects.some((candidate) => candidate.canStartPhase)) {
      note("no-project-fit", "Startable project phases do not fit this policy window.");
    }
  }

  const hasObjectiveResearch = [
    "bootstrap:decode-logic",
    "bootstrap:byte-copy",
    "bootstrap:first-benchmark",
    "coherent:multicore",
    "coherent:local-scheduler",
    "coherent:ram-control",
    "coherent:system-scheduler",
    "coherent:cron-runtime",
    "fleet:catalog",
  ].includes(visible.currentObjective?.id ?? "");
  const research = [...visible.research]
    .filter(
      (candidate) =>
        candidate.canBuy &&
        candidate.canAfford &&
        !candidate.completed &&
        researchProgressionScore(candidate.id, visible) > 0 &&
        (!hasObjectiveResearch ||
          researchProgressionScore(candidate.id, visible) >= 9_000),
    )
    .sort((left, right) => {
      const leftScore =
        researchProgressionScore(left.id, visible) +
        left.grants.length * 100 +
        (left.actionLabel ? 0 : 50);
      const rightScore =
        researchProgressionScore(right.id, visible) +
        right.grants.length * 100 +
        (right.actionLabel ? 0 : 50);
      return rightScore - leftScore || left.id.localeCompare(right.id);
    })[0];
  if (research) {
    addAction(
      { type: "buyResearch", researchId: research.id },
      "research",
      `Buy available progression research ${research.name}.`,
      research.costs,
      // Objective-critical research must not be starved by the savings
      // reserve; finite first-completion Data has no refill to wait for.
      researchProgressionScore(research.id, visible) >= 9_000
        ? 0
        : config.reserveBps,
    );
  }

  if (
    specializedObjective &&
    visible.workshop.thermalControlsUnlocked &&
    visible.workshop.coolingTierId === "none"
  ) {
    const cooling = [...visible.workshop.coolingTiers]
      .filter((candidate) => candidate.id !== "none" && candidate.canInstall)
      .sort((left, right) => left.level - right.level)[0];
    if (cooling) {
      addAction(
        {
          type: "installCoolingTier",
          tierId: cooling.id,
          systemId: visible.selectedSystem.id,
        },
        "workshop",
        `Install ${cooling.name} before sustained accelerator proofs.`,
        cooling.costs,
      );
    }
  }

  // Generic safe workload selection: once no finite chapter proof is pending,
  // profitable installed-storage work is part of the public workload set that
  // measured acceptance must exercise.
  const storageWorkload = visible.workshop.storageWorkload;
  if (
    specializedObjectiveTaskIds.length === 0 &&
    !storageWorkload.active &&
    storageWorkload.canStart &&
    storageWorkload.projection.pauseReason === null &&
    storageWorkload.projection.netRewardCredits !== null &&
    amountCompare(toAmount(storageWorkload.projection.netRewardCredits), 0) > 0 &&
    selectedSystemCanRunWork(visible)
  ) {
    addAction(
      {
        type: "startWorkshopStorageWorkload",
        workloadId: storageWorkload.id,
        systemId: visible.selectedSystem.id,
      },
      "workshop",
      `Run the profitable storage workload ${storageWorkload.name} on installed Workshop storage.`,
    );
  }

  const selectedAvailable = selectedSystemCanRunWork(visible);
  const researchTaskIds = new Set<TaskId>(
    [
      ...visible.research.flatMap((candidate) => [
        ...candidate.computeTasks
          .filter((task) => !task.completed && task.canStart)
          .map((task) => task.id),
        ...candidate.requirements.flatMap((requirement) => {
          if (requirement.met || !requirement.id.startsWith("task:")) return [];
          const taskId = requirement.id.slice("task:".length);
          const visibleTask = visible.jobs.find((job) => job.id === taskId);
          return visibleTask ? [visibleTask.id] : [];
        }),
      ]),
      ...specializedObjectiveTaskIds,
      ...(visible.currentChapter.index >= 3 &&
      visible.tasks.some((task) => task.id === "compileCode") &&
      !visible.tasks.some((task) => task.id === "renderFrame")
        ? (["compileCode"] as TaskId[])
        : []),
    ],
  );
  const canManuallyDispatch =
    selectedAvailable &&
    visible.selectedSystem.powerState === "on" &&
    visible.metrics.psuStress < 0.85 &&
    visible.metrics.idleCoreCount > 0 &&
    !activeContracts.some(
      (contract) => contract.systemId === visible.selectedSystem.id,
    ) &&
    !visible.projects.some((project) => project.active) &&
    actionReasons.length === 0 &&
    !visible.upgrades.some(
      (candidate) =>
        candidate.canAfford && progressionUpgradeScore(candidate, visible) > 0,
    ) &&
    config.manualDispatchLimit > 0;
  const noveltyCandidates = [...visible.jobs]
    .filter(
      (job) =>
        canDispatchWithStartAction(job) &&
        workFitsHardware(job, visible) &&
        job.firstCompletionData > job.repeatRewardData,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const noveltyTargetId =
    visible.currentChapter.index <= 2 &&
    amountCompare(toAmount(visible.exactResources.data), 100) < 0 &&
    noveltyCandidates.length > 0
      ? noveltyCandidates[
          (context.sessionIndex + Math.floor(context.nowMs / 60_000)) %
            noveltyCandidates.length
        ]?.id ?? null
      : null;
  const manualJobs = canManuallyDispatch
    && (visible.currentChapter.index <= 2 || researchTaskIds.size > 0)
    ? [...visible.jobs]
        .filter(
          (job) =>
            canDispatchWithStartAction(job) &&
            workFitsHardware(job, visible) &&
            !taskIsInFlight(visible, job.id) &&
            (specializedObjectiveTaskIds.length === 0 ||
              specializedObjectiveTaskIds.includes(job.id)),
        )
        .sort((left, right) => {
          const noveltyPriority =
            Number(right.id === noveltyTargetId) - Number(left.id === noveltyTargetId);
          const researchPriority =
            Number(researchTaskIds.has(right.id)) - Number(researchTaskIds.has(left.id));
          // Honor the ten-identical-manual-completions promise: once a job
          // nears the cap, prefer any fitting alternative over repeating it.
          const overusePriority =
            Number((left.completionCount ?? 0) >= 8) -
            Number((right.completionCount ?? 0) >= 8);
          const openingActionValuePriority =
            visible.currentChapter.index <= 2
              ? amountCompare(
                  manualJobValue(right, config.dataCreditWeight),
                  manualJobValue(left, config.dataCreditWeight),
                )
              : 0;
          return (
            noveltyPriority ||
            researchPriority ||
            overusePriority ||
            openingActionValuePriority ||
            compareRates(
              left,
              right,
              (job) => manualJobValue(job, config.dataCreditWeight),
              (job) => Math.round(job.seconds * 1_000),
              (job) => job.id,
            )
          );
        })
    : [];
  let remainingIdleCores = visible.metrics.idleCoreCount;
  // Concurrent cache staging beyond capacity deadlocks the CPU package and
  // wipes all active work. Before scheduler lookahead exists, budget the
  // shared cache across planned dispatches like a careful manual player.
  const cacheNeedByTaskId = new Map(
    visible.tasks.map((task) => [task.id, task.cacheNeedBits ?? 0]),
  );
  let remainingCacheBits =
    visible.hardware.cacheBits -
    visible.activeTasks.reduce(
      (total, active) => total + (cacheNeedByTaskId.get(active.taskId) ?? 0),
      0,
    );
  let plannedManualDispatches = 0;
  // A research benchmark dispatched this same decision reserves scheduler
  // slots (system benchmarks fan children across the CPU queue), so the
  // queue budget below must treat those slots as spent.
  let plannedResearchDispatchCores = 0;
  const researchComputeTask = visible.research
    .flatMap((candidate) => candidate.computeTasks)
    .find(
      (task) =>
        !task.completed &&
        !task.active &&
        canDispatchWithStartAction(task) &&
        task.requiredCores <= remainingIdleCores &&
        task.cacheNeedBits <= remainingCacheBits,
    );
  if (
    canManuallyDispatch &&
    researchComputeTask &&
    addAction(
      {
        type: "startTask",
        taskId: researchComputeTask.id,
        systemId: visible.selectedSystem.id,
      },
      "manual-dispatch",
      `Dispatch required research benchmark ${researchComputeTask.name}.`,
    )
  ) {
    plannedManualDispatches += 1;
    remainingIdleCores -= researchComputeTask.requiredCores;
    remainingCacheBits -= researchComputeTask.cacheNeedBits;
    plannedResearchDispatchCores += researchComputeTask.requiredCores;
  }
  // After Local Scheduler exists, income work goes through the finite CPU
  // queue (FIFO lookahead keeps staging safe) instead of repeated manual
  // starts, honoring the ten-identical-manual-completions promise.
  const totalQueueSlots = visible.hardware.cpus.reduce(
    (total, cpu) => total + (cpu.schedulerSlots ?? 0),
    0,
  );
  let openQueueSlots = Math.max(0, totalQueueSlots - visible.queue.length);
  const plannedDispatchTaskIds = new Set<TaskId>();
  let plannedQueueInsertCores = 0;
  for (const manualJob of manualJobs) {
    if (plannedManualDispatches >= config.manualDispatchLimit) continue;
    const useQueue =
      visible.flags.basicQueue && manualJob.canQueue && openQueueSlots > 0;
    if (
      !useQueue &&
      (manualJob.requiredCores > remainingIdleCores ||
        manualJob.cacheNeedBits > remainingCacheBits)
    ) {
      continue;
    }
    if (
      addAction(
        useQueue
          ? {
              type: "queueTask",
              taskId: manualJob.id,
              systemId: visible.selectedSystem.id,
            }
          : {
              type: "startTask",
              taskId: manualJob.id,
              systemId: visible.selectedSystem.id,
            },
        "manual-dispatch",
        useQueue
          ? `Queue ${manualJob.name} into the CPU scheduler backlog.`
          : `Dispatch ${manualJob.name} for immediate progression/value while cores are idle.`,
      )
    ) {
      plannedManualDispatches += 1;
      plannedDispatchTaskIds.add(manualJob.id);
      if (useQueue) {
        openQueueSlots -= 1;
        plannedQueueInsertCores += Math.max(1, manualJob.requiredCores);
      } else {
        remainingIdleCores -= manualJob.requiredCores;
        remainingCacheBits -= manualJob.cacheNeedBits;
      }
    }
  }
  // Metered power billing drains while cores idle between check-ins, and the
  // window after CRON research but before the CRON Runtime buffer has NO
  // renewal automation: a configured standing order sits inert while power
  // bills, which previously wedged idle-heavy runs at 0 credits forever.
  // A rational player covers that drain by topping up the finite CPU queue
  // with the best income work each visit. Queue insertions go through the
  // scheduler, so the per-visit manual click limit (and the ten-identical-
  // manual-completions promise) still applies to direct starts.
  if (
    canManuallyDispatch &&
    visible.flags.basicQueue &&
    visible.metrics.powerCostPerSecond > 0 &&
    !bufferAtLeast(visible.automationBuffer.ownedLevelId, "cronRuntime")
  ) {
    // The top-up must not overfill the scheduler (a refused enqueue is a
    // no-op the audits flag), so it budgets slots precisely: multi-core tasks
    // reserve one slot per core, dispatched queue entries keep their
    // reservation while running, and a research benchmark dispatched this
    // same decision reserves its cores too.
    const requiredCoresByTaskId = new Map(
      visible.tasks.map((task) => [task.id, Math.max(1, task.requiredCores ?? 1)]),
    );
    const reservedQueueSlots =
      visible.queue.reduce(
        (total, entry) =>
          total +
          (requiredCoresByTaskId.get(
            typeof entry === "string" ? entry : entry.taskId,
          ) ?? 1),
        0,
      ) +
      visible.activeTasks.reduce(
        (total, active) =>
          active.schedulerQueued || active.queueEntryId
            ? total + (requiredCoresByTaskId.get(active.taskId) ?? 1)
            : total,
        0,
      ) +
      plannedResearchDispatchCores +
      plannedQueueInsertCores;
    let topUpOpenSlots = Math.max(0, totalQueueSlots - reservedQueueSlots);
    // Concurrent RAM staging beyond physical capacity starves every loader at
    // 0% progress while power keeps billing, so budget RAM across queued and
    // active work exactly like the cache budget above.
    const ramNeedByTaskId = new Map(
      visible.tasks.map((task) => [task.id, task.ramNeedBits ?? 0]),
    );
    let remainingRamBits =
      visible.hardware.ramBits -
      visible.activeTasks.reduce(
        (total, active) => total + (ramNeedByTaskId.get(active.taskId) ?? 0),
        0,
      ) -
      visible.queue.reduce(
        (total, entry) =>
          total +
          (ramNeedByTaskId.get(
            typeof entry === "string" ? entry : entry.taskId,
          ) ?? 0),
        0,
      );
    const topUpJobs = [...visible.jobs]
      .filter(
        (job) =>
          job.kind === "job" &&
          !["system", "distributed"].includes(job.category) &&
          job.canQueue &&
          canDispatchWithStartAction(job) &&
          workFitsHardware(job, visible) &&
          !taskIsInFlight(visible, job.id) &&
          !plannedDispatchTaskIds.has(job.id) &&
          amountCompare(repeatJobValue(job, config.dataCreditWeight), 0) > 0,
      )
      .sort((left, right) => {
        // Between check-ins the wallet pays the drain for the FULL interval,
        // so rank by the value a queued run can actually deliver before the
        // next visit: full value for jobs that finish inside the window,
        // rate-prorated value for longer ones.
        const windowSeconds = 60;
        const windowValue = (job: ReadonlyJob) =>
          amountToSafeNumber(repeatJobValue(job, config.dataCreditWeight)) *
          Math.min(1, windowSeconds / Math.max(job.seconds, 0.001));
        const byWindowValue = windowValue(right) - windowValue(left);
        if (byWindowValue !== 0) return byWindowValue;
        if (right.seconds !== left.seconds) {
          return right.seconds - left.seconds;
        }
        return left.id.localeCompare(right.id);
      });
    // The early RAM lane is one shared channel: concurrent RAM stagings
    // serialize against it, capping the whole batch at the RAM rate while
    // power bills every core. Queue at most one RAM-staged job per visit and
    // fill the rest with compute/cache earners.
    let ramStagedJobPlanned =
      visible.activeTasks.some(
        (active) => (ramNeedByTaskId.get(active.taskId) ?? 0) > 0,
      ) ||
      visible.queue.some(
        (entry) =>
          (ramNeedByTaskId.get(
            typeof entry === "string" ? entry : entry.taskId,
          ) ?? 0) > 0,
      );
    for (const job of topUpJobs) {
      const slotNeed = Math.max(1, job.requiredCores);
      if (slotNeed > topUpOpenSlots) continue;
      if (job.ramNeedBits > remainingRamBits) continue;
      if (job.ramNeedBits > 0 && ramStagedJobPlanned) continue;
      if (
        addAction(
          {
            type: "queueTask",
            taskId: job.id,
            systemId: visible.selectedSystem.id,
          },
          "manual-dispatch",
          `Top up the CPU queue with ${job.name} to cover metered power drain.`,
        )
      ) {
        plannedDispatchTaskIds.add(job.id);
        topUpOpenSlots -= slotNeed;
        remainingRamBits -= job.ramNeedBits;
        if (job.ramNeedBits > 0) ramStagedJobPlanned = true;
      }
    }
  }
  if (
    plannedManualDispatches === 0 &&
    visible.activeWork.length === 0 &&
    !visible.standingOrder.enabled
  ) {
    note("no-safe-manual-work", "No startable public job safely fits the selected system.");
  }

  if (
    visible.currentObjective?.id === "fleet:specialized-throughput" &&
    visible.workshop.specializedComputeUnlocked &&
    visible.hardware.psuLevel >= WORKSHOP_PROOF_PSU_LEVEL &&
    !protectPendingMilestoneBuffer
  ) {
    const installedKinds = new Set(
      visible.workshop.accelerators.map((device) => device.kind),
    );
    for (const kind of ["gpu", "npu"] as const) {
      if (installedKinds.has(kind)) continue;
      const sku = [...visible.workshop.acceleratorSkus]
        .filter((candidate) => candidate.kind === kind && candidate.canInstall)
        .sort((left, right) => {
          const leftCosts = getCostTotals(left.costs);
          const rightCosts = getCostTotals(right.costs);
          return amountCompare(
            value(leftCosts.credits, leftCosts.data, config.dataCreditWeight),
            value(rightCosts.credits, rightCosts.data, config.dataCreditWeight),
          );
        })[0];
      if (sku) {
        addAction(
          {
            type: "installAccelerator",
            skuId: sku.id,
            systemId: visible.selectedSystem.id,
          },
          "workshop",
          `Install the least-cost visible ${kind.toUpperCase()} needed for the finite specialization proof.`,
          sku.costs,
          0,
        );
      }
    }
  }

  const protectPendingWorkshopAccelerator =
    specializedObjective &&
    visible.workshop.specializedComputeUnlocked &&
    visible.hardware.psuLevel >= WORKSHOP_PROOF_PSU_LEVEL &&
    !["gpu", "npu"].every((kind) =>
      visible.workshop.accelerators.some((device) => device.kind === kind),
    );

  const upgrade = [...visible.upgrades]
    .filter((candidate) => {
      if (!candidate.canAfford || candidate.maxed === true) return false;
      const progressionRequired =
        progressionUpgradeScore(candidate, visible) > 0 &&
        !protectCronBufferSavingsUnderBilling;
      const workshopPsuRequired =
        specializedObjective &&
        visible.workshop.specializedComputeUnlocked &&
        visible.hardware.psuLevel < WORKSHOP_PROOF_PSU_LEVEL &&
        candidate.id === "psu";
      const compileCacheRequired =
        visible.currentChapter.index >= 3 &&
        candidate.id === "cache" &&
        visible.tasks.some(
          (task) => task.id === "compileCode" && task.cacheFit === "low",
        );
      const creditOnly = candidate.costs.every((cost) => cost.resource === "credits");
      const managedUpgradeTarget =
        context.profileId === "full-idle"
          ? 2
          : context.profileId === "regular"
            ? 3
            : visible.currentChapter.index * 2;
      const managedPerformanceUpgrade =
        visible.currentChapter.index > 2 &&
        creditOnly &&
        ["clock", "cacheSpeed", "ramSpeed"].includes(candidate.id) &&
        candidate.purchaseCount < managedUpgradeTarget;
      return (
        progressionRequired ||
        workshopPsuRequired ||
        compileCacheRequired ||
        (!protectPendingCronBuffer &&
          !protectPendingMilestoneBuffer &&
          !protectPendingWorkshopAccelerator &&
          (managedPerformanceUpgrade ||
            upgradeScore(candidate, visible) >= 600 ||
            (candidate.id === "psu" && visible.metrics.psuStress >= 0.7)))
      );
    })
    .sort(
      (left, right) =>
        Number(
          specializedObjective &&
            visible.workshop.specializedComputeUnlocked &&
            visible.hardware.psuLevel < WORKSHOP_PROOF_PSU_LEVEL &&
            right.id === "psu",
        ) -
          Number(
            specializedObjective &&
              visible.workshop.specializedComputeUnlocked &&
              visible.hardware.psuLevel < WORKSHOP_PROOF_PSU_LEVEL &&
              left.id === "psu",
          ) ||
        Number(
          visible.currentChapter.index >= 3 &&
            right.id === "cache" &&
            visible.tasks.some(
              (task) => task.id === "compileCode" && task.cacheFit === "low",
            ),
        ) -
          Number(
            visible.currentChapter.index >= 3 &&
              left.id === "cache" &&
              visible.tasks.some(
                (task) => task.id === "compileCode" && task.cacheFit === "low",
              ),
          ) ||
        upgradeScore(right, visible) - upgradeScore(left, visible) ||
        left.id.localeCompare(right.id),
    )[0];
  if (upgrade) {
    const mandatoryUpgrade =
      progressionUpgradeScore(upgrade, visible) > 0 ||
      (specializedObjective &&
        visible.workshop.specializedComputeUnlocked &&
        visible.hardware.psuLevel < WORKSHOP_PROOF_PSU_LEVEL &&
        upgrade.id === "psu") ||
      (visible.currentChapter.index >= 3 &&
        upgrade.id === "cache" &&
        visible.tasks.some(
          (task) => task.id === "compileCode" && task.cacheFit === "low",
        ));
    addAction(
      {
        type: "buyUpgrade",
        upgradeId: upgrade.id,
        systemId: visible.selectedSystem.id,
      },
      "upgrade",
      `Improve the current ${visible.bottleneck || "hardware"} bottleneck with ${upgrade.name}.`,
      upgrade.costs,
      mandatoryUpgrade ? 0 : config.reserveBps,
    );
  }

  if (!fleetGateOpen(visible)) {
    note("fleet-gated", "Fleet capacity actions remain behind visible campaign/research gates.");
  } else {
    const needsSecondSystem =
      visible.currentObjective?.id === "fleet:second-system" &&
      visible.systems.length < 2;
    if (needsSecondSystem) {
      const template = [...visible.machineBuilder.templates]
        .filter((candidate) => candidate.canBuy)
        .sort((left, right) => {
          const leftCosts = getCostTotals(left.cost);
          const rightCosts = getCostTotals(right.cost);
          return amountCompare(
            value(leftCosts.credits, leftCosts.data, config.dataCreditWeight),
            value(rightCosts.credits, rightCosts.data, config.dataCreditWeight),
          );
        })[0];
      if (template) {
        addAction(
          { type: "buyMachineTemplate", templateId: template.id },
          "fleet",
          `Commission ${template.name} to establish a second named system.`,
          template.cost,
        );
      }
    }

    const unmanagedSystems = visible.systems.filter(
      (system) => !managedSystemIds.has(system.id),
    );
    const manageableNode = visible.infrastructure.fleet.nodes.find((node) => {
      if (node.managed || node.source.kind !== "system") return false;
      if (node.blocker !== "Node is not managed by Fleet capacity.") return false;
      const systemId = node.source.systemId;
      if (systemId === preferredBatchSystem?.id) return false;
      const system = visible.systems.find((candidate) => candidate.id === systemId);
      return Boolean(
        system &&
          system.powerState === "on" &&
          system.activeTaskCount === 0 &&
          system.queueCount === 0 &&
          unmanagedSystems.length > 1,
      );
    });
    if (!specializedObjective && manageableNode?.source.kind === "system") {
      addAction(
        {
          type: "setSystemManaged",
          systemId: manageableNode.source.systemId,
          managed: true,
        },
        "fleet",
        `Move idle ${manageableNode.name} into Fleet capacity while preserving a local dispatch system.`,
      );
    } else if (
      unmanagedSystems.length === 1 &&
      visible.infrastructure.fleet.nodes.some(
        (node) => !node.managed && node.source.kind === "system",
      )
    ) {
      note("single-system-protected", "Kept one local system outside Fleet management.");
    }

    const needsFabricProof =
      visible.currentObjective?.id === "fabric:cluster-controller";
    const suitableFabricNodes = visible.infrastructure.fleet.nodes.filter(
      (node) =>
        node.managed &&
        node.blocker === null &&
        node.source.kind === "aggregate" &&
        ["workshopServer", "denseServer"].includes(node.source.skuId),
    );
    if (needsFabricProof && suitableFabricNodes.length < 2) {
      const workshop = aggregatePurchaseGuards.workshop;
      addAction(
        { type: "purchaseAggregateServerBatch", skuId: workshop.skuId, count: 1 },
        "fleet",
        "Add a storage-and-network capable node for the replicated shard proof.",
        [
          { resource: "credits", amount: workshop.credits },
          { resource: "data", amount: workshop.data },
        ],
      );
    } else if (visible.infrastructure.fleet.utilizationBps >= config.fleetUtilizationBps) {
      const preferred = aggregatePurchaseGuards[config.aggregateServerPreference];
      const fallback = aggregatePurchaseGuards.workshop;
      const chosen =
        amountCompare(budget.remaining.credits, preferred.credits) >= 0 &&
        amountCompare(budget.remaining.data, preferred.data) >= 0
          ? preferred
          : fallback;
      addAction(
        { type: "purchaseAggregateServerBatch", skuId: chosen.skuId, count: 1 },
        "fleet",
        `Add ${chosen.skuId} because visible Fleet utilization reached ${visible.infrastructure.fleet.utilizationBps} bps.`,
        [
          { resource: "credits", amount: chosen.credits },
          { resource: "data", amount: chosen.data },
        ],
      );
    }

    const assignedNodeIds = new Set(
      visible.infrastructure.clusters.flatMap((cluster) => cluster.nodeIds),
    );
    const clusterCandidates = visible.infrastructure.fleet.nodes
      .filter(
        (node) =>
          node.managed &&
          node.blocker === null &&
          !assignedNodeIds.has(node.id) &&
          (!needsFabricProof ||
            (node.source.kind === "aggregate" &&
              ["workshopServer", "denseServer"].includes(node.source.skuId))),
      )
      .map((node) => node.id);
    if (
      (config.allowClusters || needsFabricProof) &&
      bufferAtLeast(visible.automationBuffer.ownedLevelId, "clusterController") &&
      clusterCandidates.length >= 2 &&
      visible.infrastructure.clusters.length === 0
    ) {
      addAction(
        {
          type: "commissionCluster",
          name: `${context.profileId} cluster`,
          nodeIds: clusterCandidates,
          reserveHeadroomBps: context.profileId === "optimizer" ? 500 : 1_500,
          replicaFaultDomain: "node",
        },
        "fleet",
        "Commission available managed nodes into a capacity cluster.",
      );
    }

    const replicatedProof = visible.infrastructure.workloadDefinitions.find(
      (definition) => definition.id === "replicatedShardCommit",
    );
    const proofCluster = visible.infrastructure.clusters.find((cluster) =>
      replicatedProof?.clusterOptions.some(
        (option) => option.clusterId === cluster.id && option.canStart,
      ),
    );
    if (
      needsFabricProof &&
      proofCluster &&
      !visible.infrastructure.workloads.some(
        (workload) => workload.definitionId === "replicatedShardCommit",
      )
    ) {
      addAction(
        {
          type: "startClusterWorkload",
          clusterId: proofCluster.id,
          definitionId: "replicatedShardCommit",
        },
        "fleet",
        "Run the one finite replicated shard proof required by the campaign.",
        replicatedProof?.startCosts ?? [],
      );
    }

    // Generic safe workload selection after the mandatory fabric proof:
    // steady capacity workloads (e.g. Fabric Integrity Sweep) are how a real
    // player uses commissioned cluster headroom, and acceptance requires
    // their measured economics.
    const inFlightWorkloadDefinitionIds = new Set(
      visible.infrastructure.workloads
        .filter((workload) => workload.status !== "completed")
        .map((workload) => workload.definitionId),
    );
    if (!needsFabricProof) {
      const capacityWorkload = visible.infrastructure.workloadDefinitions
        .filter(
          (definition) =>
            definition.kind === "capacity" &&
            !inFlightWorkloadDefinitionIds.has(definition.id) &&
            definition.clusterOptions.some((option) => option.canStart),
        )
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      const capacityCluster = capacityWorkload?.clusterOptions.find(
        (option) => option.canStart,
      );
      if (capacityWorkload && capacityCluster) {
        addAction(
          {
            type: "startClusterWorkload",
            clusterId: capacityCluster.clusterId,
            definitionId: capacityWorkload.id,
          },
          "fleet",
          `Run the steady capacity workload ${capacityWorkload.name} on commissioned cluster headroom.`,
          capacityWorkload.startCosts,
        );
      }
    }

    if (
      visible.currentObjective?.id === "facility:rack-controller" &&
      bufferAtLeast(visible.automationBuffer.ownedLevelId, "rackController")
    ) {
      const facilities = visible.infrastructure.facilities;
      const placementNodes = getAvailableUnplacedNodes(visible);
      const placement = findFacilityPlacement(facilities, placementNodes);
      const facilityForRack = findFacilityForHalfRack(
        facilities,
        placementNodes,
      );
      const hasPlannedWorkshopNode = actionReasons.some(
        ({ action }) =>
          action.type === "purchaseAggregateServerBatch" &&
          action.skuId === aggregatePurchaseGuards.workshop.skuId,
      );
      if (facilities.length === 0) {
        addAction(
          { type: "commissionFacility", templateId: "workshopFacility" },
          "fleet",
          "Commission the first workshop facility for the rack objective.",
          WORKSHOP_FACILITY_COMMISSION_COSTS,
        );
      } else if (placement) {
        addAction(
          {
            type: "placeFleetNodeInRack",
            facilityId: placement.facility.id,
            rackId: placement.rack.id,
            nodeId: placement.node.id,
          },
          "fleet",
          `Place ${placement.node.name} in an admissible true rack.`,
        );
      } else if (facilityForRack) {
        addAction(
          {
            type: "commissionFacilityRack",
            facilityId: facilityForRack.id,
            templateId: "halfRack",
          },
          "fleet",
          "Install another half rack with visible headroom for an unplaced node.",
          HALF_RACK_COMMISSION_COSTS,
        );
      } else if (
        !placementNodes.some(nodeCanFitEmptyHalfRack) &&
        !hasPlannedWorkshopNode
      ) {
        const workshop = aggregatePurchaseGuards.workshop;
        addAction(
          { type: "purchaseAggregateServerBatch", skuId: workshop.skuId, count: 1 },
          "fleet",
          "Add one rack-sized managed node instead of retrying an unavailable or oversized placement.",
          [
            { resource: "credits", amount: workshop.credits },
            { resource: "data", amount: workshop.data },
          ],
        );
      } else {
        addAction(
          { type: "commissionFacility", templateId: "workshopFacility" },
          "fleet",
          "Commission another facility because existing sites cannot admit the available node.",
          WORKSHOP_FACILITY_COMMISSION_COSTS,
        );
      }
    }

    const cloudUnlocked = visible.currentChapter.index >= 6;
    if (cloudUnlocked) {
      const regionalSlaComplete = visible.cloud.completedSlas.some(
        (sla) => sla.definitionId === "regionalContinuity" && sla.succeeded,
      );
      const planetarySlaComplete = visible.cloud.completedSlas.some(
        (sla) => sla.definitionId === "planetaryCoverage" && sla.succeeded,
      );
      const desiredSiteCount =
        planetarySlaComplete &&
        bufferAtLeast(
          visible.automationBuffer.ownedLevelId,
          "globalScheduler",
        )
        ? 4
        : regionalSlaComplete
          ? 3
          : 2;
      const denseNodes = visible.infrastructure.fleet.nodes.filter(
        (node) =>
          node.managed &&
          node.source.kind === "aggregate" &&
          node.source.skuId === "denseServer",
      );
      const denseNodeIds = new Set(denseNodes.map((node) => node.id));
      const cloudFacilities = visible.infrastructure.facilities.filter((facility) =>
        facility.racks.some((rack) =>
          rack.nodeIds.some((nodeId) => denseNodeIds.has(nodeId)),
        ),
      );
      const cloudFacilityIds = new Set(cloudFacilities.map((facility) => facility.id));
      const facilitiesWithoutDense = visible.infrastructure.facilities.filter(
        (facility) => !cloudFacilityIds.has(facility.id),
      );
      const availableDenseNodes = getAvailableUnplacedNodes(
        visible,
        (node) =>
          node.source.kind === "aggregate" &&
          node.source.skuId === "denseServer" &&
          node.source.count === 1,
      );
      const cloudPlacement = findFacilityPlacement(
        facilitiesWithoutDense,
        availableDenseNodes,
      );
      if (cloudFacilities.length < desiredSiteCount) {
        if (cloudPlacement) {
          addAction(
            {
              type: "placeFleetNodeInRack",
              facilityId: cloudPlacement.facility.id,
              rackId: cloudPlacement.rack.id,
              nodeId: cloudPlacement.node.id,
            },
            "cloud",
            `Place ${cloudPlacement.node.name} in an admissible distinct Cloud facility.`,
          );
        } else if (availableDenseNodes.length === 0) {
          const dense = aggregatePurchaseGuards.dense;
          const hasPlannedDenseNode = actionReasons.some(
            ({ action }) =>
              action.type === "purchaseAggregateServerBatch" &&
              action.skuId === dense.skuId,
          );
          if (!hasPlannedDenseNode) {
            addAction(
              { type: "purchaseAggregateServerBatch", skuId: dense.skuId, count: 1 },
              "cloud",
              "Add one rack-sized dense Cloud node because no admissible unplaced node is available.",
              [
                { resource: "credits", amount: dense.credits },
                { resource: "data", amount: dense.data },
              ],
            );
          }
        } else {
          const facilityForRack = findFacilityForHalfRack(
            facilitiesWithoutDense,
            availableDenseNodes,
          );
          if (facilityForRack) {
            addAction(
              {
                type: "commissionFacilityRack",
                facilityId: facilityForRack.id,
                templateId: "halfRack",
              },
              "cloud",
              "Install a fresh rack with headroom for the next dense Cloud node.",
              HALF_RACK_COMMISSION_COSTS,
            );
          } else {
            addAction(
              { type: "commissionFacility", templateId: "workshopFacility" },
              "cloud",
              "Commission a distinct facility because existing sites cannot admit the next dense node.",
              WORKSHOP_FACILITY_COMMISSION_COSTS,
            );
          }
        }
      }

      if (visible.cloud.regions.length < desiredSiteCount) {
        addAction(
          {
            type: "commissionCloudRegion",
            name: `Region ${visible.cloud.regions.length + 1}`,
          },
          "cloud",
          "Commission the next distinct Cloud region.",
        );
      }

      const facilityWithoutZone = cloudFacilities.find(
        (facility) =>
          !visible.cloud.zones.some((zone) => zone.facilityId === facility.id),
      );
      const regionWithoutZone = visible.cloud.regions.find(
        (region) =>
          !visible.cloud.zones.some((zone) => zone.regionId === region.id),
      );
      if (facilityWithoutZone && regionWithoutZone) {
        addAction(
          {
            type: "commissionCloudZone",
            regionId: regionWithoutZone.id,
            facilityId: facilityWithoutZone.id,
            name: `${regionWithoutZone.name} Zone`,
            baseLatencyMs: 25,
            faultDomainId: `facility:${facilityWithoutZone.id}`,
          },
          "cloud",
          "Bind one dense facility to one distinct availability zone.",
        );
      }

      const zoneWithoutReplica = visible.cloud.zones.find(
        (zone) => zone.replicaCount === 0,
      );
      if (zoneWithoutReplica) {
        addAction(
          { type: "placeCloudReplica", zoneId: zoneWithoutReplica.id },
          "cloud",
          `Place a healthy service replica in ${zoneWithoutReplica.name}.`,
        );
      }

      const routableRegions = [...visible.cloud.regions]
        .filter((region) =>
          visible.cloud.zones.some(
            (zone) =>
              zone.regionId === region.id &&
              zone.healthyReplicaCount > 0 &&
              amountCompare(amount(String(zone.effectiveCapacityPerSecond)), 0) > 0,
          ),
        )
        .sort((left, right) => left.id.localeCompare(right.id));
      const regionWithWrongDemand = routableRegions.find((region, index) => {
        const target = index === 0 ? CLOUD_HUB_DEMAND : CLOUD_SPOKE_DEMAND;
        return amountCompare(amount(String(region.demandPerSecond)), target) !== 0;
      });
      if (regionWithWrongDemand) {
        const target =
          regionWithWrongDemand.id === routableRegions[0]?.id
            ? CLOUD_HUB_DEMAND
            : CLOUD_SPOKE_DEMAND;
        addAction(
          {
            type: "setCloudRegionalDemand",
            regionId: regionWithWrongDemand.id,
            demand: target,
          },
          "cloud",
          regionWithWrongDemand.id === routableRegions[0]?.id
            ? `Concentrate bounded planetary demand in ${regionWithWrongDemand.name}.`
            : `Keep ${regionWithWrongDemand.name} served while exporting spare capacity.`,
        );
      }

      const routingLinks = visible.cloud.routing.links.map((link) => ({
        ...link,
        capacity: amount(String(link.capacity)),
      }));
      const hub = routableRegions[0];
      const desiredRoutingLinks = hub
        ? routableRegions.slice(1).map((region) => ({
            id: `policy-route:${region.id}:${hub.id}`,
            from: region.id,
            to: hub.id,
            capacity: CLOUD_ROUTING_LINK_CAPACITY,
            costPerUnit: 0,
            latencyMs: 25,
          }))
        : [];
      const routingTopologyReady = desiredRoutingLinks.every((desired) =>
        routingLinks.some(
          (link) =>
            link.id === desired.id &&
            link.from === desired.from &&
            link.to === desired.to &&
            amountCompare(link.capacity, desired.capacity) === 0 &&
            link.costPerUnit === desired.costPerUnit &&
            link.latencyMs === desired.latencyMs,
        ),
      );
      if (desiredRoutingLinks.length > 0 && !routingTopologyReady) {
        const desiredIds = new Set(desiredRoutingLinks.map((link) => link.id));
        const links = [
          ...routingLinks.filter((link) => !desiredIds.has(link.id)),
          ...desiredRoutingLinks,
        ];
        addAction(
          { type: "setCloudRoutingLinks", links },
          "cloud",
          "Route spare regional capacity into the bounded planetary demand hub.",
        );
      }

      if (!visible.cloud.activeSla) {
        const nextSlaId = !regionalSlaComplete
          ? "regionalContinuity"
          : !planetarySlaComplete
            ? "planetaryCoverage"
            : null;
        const nextSla = visible.cloud.slaDefinitions.find(
          (definition) => definition.id === nextSlaId && definition.canStart,
        );
        // Proof admission has no authored calendar minimum: the public
        // canStart gate (capacity, routing, prior proofs) decides timing so
        // acceptance can detect overly cheap content or an early optimizer.
        if (nextSla) {
          addAction(
            { type: "startCloudSla", definitionId: nextSla.id },
            "cloud",
            `Start the finite ${nextSla.name} proof window.`,
          );
        }
      }

      if (visible.cloud.finale.canStart) {
        addAction(
          { type: "startPlanetaryFinale" },
          "cloud",
          "Start the routed planetary finale after four-region coverage is live.",
        );
      }
      if (visible.cloud.finale.complete && !visible.cloud.postgameUnlocked) {
        addAction(
          { type: "selectFinaleCharter", charterId: "efficiency" },
          "cloud",
          "Select the efficiency charter after the finite finale completes.",
        );
      }
    }
  }

  const workshopControlIndex = actionReasons.findIndex(
    (decision) =>
      specializedObjective &&
      decision.action.type === "setSystemManaged" &&
      decision.action.managed === false,
  );
  if (workshopControlIndex >= 0) {
    const transition = actionReasons[workshopControlIndex];
    actionReasons.splice(
      0,
      actionReasons.length,
      ...(transition ? [transition] : []),
    );
  }
  const selectionIndex = actionReasons.findIndex(
    (decision) => decision.action.type === "selectSystem",
  );
  if (selectionIndex >= 0) {
    // A system-targeted action materializes its explicit target and therefore
    // can undo a same-decision selection. Make selection its own public
    // transition; automated visits immediately receive another policy pass.
    const selection = actionReasons[selectionIndex];
    actionReasons.splice(
      0,
      actionReasons.length,
      ...(selection ? [selection] : []),
    );
  }
  // A cronRuntime buffer purchase can complete an acceptance run the moment
  // it lands; dispatch any standing-order configuration planned in the same
  // decision first so automation coverage arrives already configured.
  const cronPurchaseIndex = actionReasons.findIndex(
    (decision) =>
      decision.action.type === "purchaseAutomationBuffer" &&
      decision.action.levelId === "cronRuntime",
  );
  const standingConfigIndex = actionReasons.findIndex(
    (decision) => decision.category === "standing-order",
  );
  if (cronPurchaseIndex >= 0 && standingConfigIndex > cronPurchaseIndex) {
    const [standingDecision] = actionReasons.splice(standingConfigIndex, 1);
    if (standingDecision) {
      actionReasons.splice(cronPurchaseIndex, 0, standingDecision);
    }
  }
  const actions = actionReasons.map((decision) => decision.action);
  const manualDispatchActions = actionReasons.filter(
    (decision) => decision.manualDispatch,
  ).length;
  const standingCoverage =
    standingAutomationReady && visible.standingOrder.enabled && visible.standingOrder.taskId !== null;
  const attendedCoverage =
    visible.liveOperations.enabled &&
    visible.liveOperations.activeTaskId !== null &&
    visible.liveOperations.allocatedCoreCount > 0;
  const ongoingCoverage =
    visible.activeWork.length > 0 || standingCoverage || attendedCoverage;
  if (actions.length === 0 && ongoingCoverage) {
    note("active-work-covered", "No action is needed while existing public work is covered.");
  }
  const strandingReasons: string[] = [];
  if (actions.length === 0 && !ongoingCoverage && !visible.jobs.some((job) => job.canStart)) {
    strandingReasons.push("No public action, active work, standing order, or startable job remains.");
  }
  if (
    actions.length === 0 &&
    !ongoingCoverage &&
    standingAutomationReady &&
    visible.automationBuffer.maxOfflineMs > 0 &&
    !visible.standingOrder.enabled &&
    !actionReasons.some((decision) => decision.category === "standing-order")
  ) {
    strandingReasons.push("Offline automation has no safe standing order.");
  }
  const developerGrantActions = 0;
  const noOpReason =
    actions.length > 0
      ? null
      : notes[0]?.message ?? "No safe public action is currently available.";

  return {
    actions,
    audit: {
      profileId: context.profileId,
      actionReasons,
      notes,
      actionCount: actions.length,
      manualDispatchActions,
      manualDispatchShare:
        actions.length > 0 ? manualDispatchActions / actions.length : 0,
      developerGrantActions,
      noOpReason,
      stranded: strandingReasons.length > 0,
      strandingReasons,
    },
  };
};

export const createBalanceActionPolicy = (
  profileId?: EngagementProfileId,
): AuditableActionPolicyAdapter => {
  const decide = (context: ActionPolicyContext) =>
    decideBalancePolicy(
      profileId === undefined || profileId === context.profileId
        ? context
        : { ...context, profileId },
    );
  return {
    decide,
    selectActions: (context) => decide(context).actions,
  };
};

export const profileAwareActionPolicy = createBalanceActionPolicy();
export const fullIdleActionPolicy = createBalanceActionPolicy("full-idle");
export const regularActionPolicy = createBalanceActionPolicy("regular");
export const engagedActionPolicy = createBalanceActionPolicy("engaged");
export const optimizerActionPolicy = createBalanceActionPolicy("optimizer");

export const balanceActionPolicies = {
  "full-idle": fullIdleActionPolicy,
  regular: regularActionPolicy,
  engaged: engagedActionPolicy,
  optimizer: optimizerActionPolicy,
} as const;
