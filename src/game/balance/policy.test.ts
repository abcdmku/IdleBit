import { describe, expect, it } from "vitest";
import { amount, exactResourceBag } from "../amount";
import {
  commissionRack,
  createFacilityState,
  getFacilitySnapshot,
} from "../facilities";
import { createPlacementVector } from "../placement";
import type {
  AutomationBufferLevelId,
  GameAction,
  VisibleContract,
  VisibleJob,
  VisibleProject,
  VisibleState,
} from "../types";
import { bootstrapSmokeRuntime } from "./bootstrap";
import {
  auditPolicyActionOutcome,
  decideBalancePolicy,
  type BalancePolicyDecision,
} from "./policy";
import type {
  ActionPolicyContext,
  EngagementProfileId,
} from "./types";

const observeOpening = () =>
  bootstrapSmokeRuntime.observe(bootstrapSmokeRuntime.createInitialState(17));

const contextFor = (
  visible: VisibleState,
  profileId: EngagementProfileId = "regular",
  overrides: Partial<ActionPolicyContext> = {},
): ActionPolicyContext => ({
  profileId,
  scheduleMode: "deterministic",
  sessionIndex: 0,
  sessionKind: "check-in",
  nowMs: 0,
  elapsedCalendarMs: 0,
  remainingActiveMs: 20 * 60_000,
  visible,
  ...overrides,
});

const withResources = (
  visible: VisibleState,
  credits: string | number,
  data: string | number,
): VisibleState => ({
  ...visible,
  exactResources: exactResourceBag(credits, data),
  resources: { credits: Number(credits), data: Number(data) },
});

const withBuffer = (
  visible: VisibleState,
  ownedLevelId: AutomationBufferLevelId,
  maxOfflineMs: number,
): VisibleState => ({
  ...visible,
  automationBuffer: {
    ...visible.automationBuffer,
    ownedLevelId,
    departureLevelId: ownedLevelId,
    maxOfflineMs,
    departureMaxOfflineMs: maxOfflineMs,
    remainingOfflineMs: maxOfflineMs,
    nextUpgrade: null,
  },
});

const decisionActions = <Type extends GameAction["type"]>(
  decision: BalancePolicyDecision,
  type: Type,
) => decision.actions.filter((action) => action.type === type);

const job = (
  base: VisibleJob,
  update: Partial<VisibleJob>,
): VisibleJob => ({
  ...base,
  kind: "job",
  visibility: "default",
  cacheFit: "met",
  cacheNeedBits: 0,
  ramNeedBits: 0,
  requiredCores: 1,
  canStart: true,
  canQueue: true,
  blockedReason: null,
  queueBlockedReason: null,
  ...update,
});

type VisibleFacility = VisibleState["infrastructure"]["facilities"][number];
type VisibleFleetNode = VisibleState["infrastructure"]["fleet"]["nodes"][number];

const facilityWithHalfRacks = (
  id: string,
  rackCount = 1,
): VisibleFacility => {
  let state = createFacilityState("workshopFacility", id, id);
  for (let index = 0; index < rackCount; index += 1) {
    state = commissionRack(state, "halfRack").state;
  }
  const snapshot = getFacilitySnapshot(state);
  return {
    ...snapshot,
    racks: snapshot.racks.map((rack) => ({ ...rack, nodeIds: [] })),
    cloudCapacityPerSecond: amount(0),
    blockers: [],
  };
};

const withFullFirstRack = (facility: VisibleFacility): VisibleFacility => ({
  ...facility,
  racks: facility.racks.map((rack, index) =>
    index === 0
      ? {
          ...rack,
          rackUnits: {
            ...rack.rackUnits,
            demand: rack.rackUnits.capacity,
            available: 0,
            utilizationBps: 10_000,
            headroomBps: 0,
          },
        }
      : rack,
  ),
});

const withNodeInFirstRack = (
  facility: VisibleFacility,
  nodeId: string,
): VisibleFacility => ({
  ...facility,
  racks: facility.racks.map((rack, index) =>
    index === 0 ? { ...rack, nodeIds: [nodeId] } : rack,
  ),
});

const denseNode = (
  base: VisibleFleetNode,
  id: string,
  count = 1,
): VisibleFleetNode => ({
  ...base,
  id,
  name: id,
  source: { kind: "aggregate", skuId: "denseServer", count },
  managed: true,
  storageSkuId: "nvmeArray",
  networkSkuId: "fabricNic",
  capacity: {
    ...base.capacity,
    peakWatts: amount(String(1_015 * count)),
  },
  blocker: null,
});

const activeWorkloadOn = (
  nodeId: string,
): VisibleState["infrastructure"]["workloads"][number] => ({
  id: `active-${nodeId}`,
  definitionId: "replicatedShardCommit",
  clusterId: "cluster-test",
  kind: "distributed",
  name: "Active placement guard",
  weight: 1,
  source: "manual",
  status: "running",
  progressBps: 1_000,
  placements: [
    {
      requestId: "request-1",
      nodeId,
      faultDomainId: `node:${nodeId}`,
      demand: createPlacementVector(),
    },
  ],
  blockers: [],
  rewards: exactResourceBag(),
  operatingCreditsSpent: amount(0),
  projection: {
    durationMs: amount(1_000),
    operatingCost: amount(0),
    netCreditReward: amount(0),
    marginBps: 0,
    bufferCovered: true,
    pauseReason: null,
  },
});

const cloudPlacementVisible = (opening: VisibleState): VisibleState => ({
  ...withResources(
    withBuffer(opening, "rackController", 72 * 60 * 60_000),
    "1e12",
    "1e9",
  ),
  currentChapter: {
    ...opening.currentChapter,
    id: "resilientCloud",
    index: 6,
  },
  currentObjective: null,
  contracts: [],
  projects: [],
  research: [],
  upgrades: [],
  tasks: [],
  jobs: [],
  activeWork: [],
  work: {
    ...opening.work,
    contracts: [],
    projects: [],
    jobs: [],
    activeWork: [],
  },
  infrastructure: {
    ...opening.infrastructure,
    fleet: {
      ...opening.infrastructure.fleet,
      utilizationBps: 0,
      blockers: [],
    },
  },
});

describe("production balance action policies", () => {
  it("spends down for milestone buffers but preserves reserve for later buffers", () => {
    const opening = observeOpening();
    const rich = withResources(
      {
        ...opening,
        automationBuffer: {
          ...opening.automationBuffer,
          nextUpgrade: {
            id: "localScheduler",
            name: "Local Scheduler",
            maxOfflineMs: 7_200_000,
            costs: [
              { resource: "credits", amount: amount(120) },
              { resource: "data", amount: amount(8) },
            ],
            unlocked: true,
            canAfford: true,
            blockedReason: null,
          },
        },
      },
      1_000,
      100,
    );
    const affordable = decideBalancePolicy(contextFor(rich, "full-idle"));
    expect(decisionActions(affordable, "purchaseAutomationBuffer")).toEqual([
      { type: "purchaseAutomationBuffer", levelId: "localScheduler" },
    ]);

    const exactMilestoneBudget = withResources(rich, 120, 8);
    const spentDown = decideBalancePolicy(
      contextFor(exactMilestoneBudget, "full-idle"),
    );
    expect(decisionActions(spentDown, "purchaseAutomationBuffer")).toEqual([
      { type: "purchaseAutomationBuffer", levelId: "localScheduler" },
    ]);

    const reserveBound = withResources(
      {
        ...rich,
        automationBuffer: {
          ...rich.automationBuffer,
          nextUpgrade: {
            id: "systemScheduler",
            name: "System Scheduler",
            maxOfflineMs: 12 * 60 * 60_000,
            costs: [
              { resource: "credits", amount: amount(1_500) },
              { resource: "data", amount: amount(120) },
            ],
            unlocked: true,
            canAfford: true,
            blockedReason: null,
          },
        },
      },
      1_500,
      120,
    );
    const held = decideBalancePolicy(
      contextFor(reserveBound, "full-idle", {
        elapsedCalendarMs: 7 * 24 * 60 * 60_000,
      }),
    );
    expect(decisionActions(held, "purchaseAutomationBuffer")).toEqual([]);
    expect(held.audit.notes).toContainEqual(
      expect.objectContaining({ code: "buffer-reserve" }),
    );
  });

  it("reconsiders standing orders using stable per-completion Data", () => {
    const opening = withBuffer(observeOpening(), "cronRuntime", 8 * 60 * 60_000);
    const baseJob = opening.jobs[0]!;
    const lowDataJob = job(baseJob, {
      id: "fetchBit",
      name: "Low Data",
      rewardCredits: 10,
      rewardData: 1,
      seconds: 1,
    });
    const repeatWinner = job(baseJob, {
      id: "decodeBit",
      name: "Data winner",
      rewardCredits: 10,
      rewardData: 5,
      seconds: 1,
    });
    const visible: VisibleState = {
      ...opening,
      flags: { ...opening.flags, cron: true },
      jobs: [lowDataJob, repeatWinner],
      work: { ...opening.work, jobs: [lowDataJob, repeatWinner] },
      standingOrder: {
        taskId: "fetchBit",
        systemId: opening.selectedSystem.id,
        enabled: true,
        renewalCount: 4,
      },
    };

    const decision = decideBalancePolicy(contextFor(visible, "optimizer"));
    expect(decisionActions(decision, "setStandingOrder")).toContainEqual({
      type: "setStandingOrder",
      taskId: "decodeBit",
      systemId: opening.selectedSystem.id,
    });
    expect(decision.audit.actionReasons).toContainEqual(
      expect.objectContaining({ category: "standing-order" }),
    );
  });

  it("selects the best contract that fits expiry, automation, and system availability", () => {
    const opening = withBuffer(observeOpening(), "localScheduler", 2 * 60 * 60_000);
    const contract = (
      id: string,
      update: Partial<VisibleContract>,
    ): VisibleContract => ({
      id,
      templateId: "ledgerAudit",
      kind: "sustained",
      name: id,
      description: id,
      systemId: opening.selectedSystem.id,
      workRequiredMs: 10 * 60_000,
      workCompletedMs: 0,
      remainingMs: 10 * 60_000,
      expiresAtMs: 60 * 60_000,
      rewards: exactResourceBag(200, 4),
      novel: false,
      accepted: false,
      valuePerHourCredits: amount(1_200),
      expiresInMs: 60 * 60_000,
      operatingCostCredits: amount(0),
      netRewardCredits: amount(200),
      creditRunwayCovered: true,
      bufferCovered: true,
      canAccept: true,
      projectedPauseReason: null,
      valueMultiplierVsStandingOrderBps: 20_000,
      ...update,
    });
    const tooLarge = contract("too-large", {
      workRequiredMs: 4 * 60 * 60_000,
      remainingMs: 4 * 60 * 60_000,
      rewards: exactResourceBag(1_000_000, 50_000),
      valuePerHourCredits: amount(250_000),
    });
    const fitting = contract("fitting", {});
    const weakVsStanding = contract("weak-vs-standing", {
      rewards: exactResourceBag(2_000_000, 100_000),
      valueMultiplierVsStandingOrderBps: 15_000,
    });
    const excessiveVsStanding = contract("excessive-vs-standing", {
      rewards: exactResourceBag(3_000_000, 100_000),
      valueMultiplierVsStandingOrderBps: 25_000,
    });
    const offers = [tooLarge, weakVsStanding, excessiveVsStanding, fitting];
    const visible = withResources(
      {
        ...opening,
        contracts: offers,
        work: { ...opening.work, contracts: offers },
      },
      10_000,
      1_000,
    );

    const decision = decideBalancePolicy(contextFor(visible, "regular"));
    expect(decisionActions(decision, "acceptContract")).toEqual([
      {
        type: "acceptContract",
        contractId: "fitting",
        systemId: opening.selectedSystem.id,
      },
    ]);
    expect(
      decisionActions(
        decideBalancePolicy(contextFor(visible, "full-idle")),
        "acceptContract",
      ),
    ).toEqual([]);
  });

  it("leaves standing renewal enabled while the engine reserves same-system contracts", () => {
    const opening = withBuffer(observeOpening(), "localScheduler", 2 * 60 * 60_000);
    const offered: VisibleContract = {
      id: "managed",
      templateId: "ledgerAudit",
      kind: "sustained",
      name: "Managed Contract",
      description: "Managed Contract",
      systemId: opening.selectedSystem.id,
      workRequiredMs: 10 * 60_000,
      workCompletedMs: 0,
      remainingMs: 10 * 60_000,
      expiresAtMs: 60 * 60_000,
      rewards: exactResourceBag(200, 4),
      novel: false,
      accepted: false,
      valuePerHourCredits: amount(1_200),
      expiresInMs: 60 * 60_000,
      operatingCostCredits: amount(0),
      netRewardCredits: amount(200),
      creditRunwayCovered: true,
      bufferCovered: true,
      canAccept: true,
      projectedPauseReason: null,
      valueMultiplierVsStandingOrderBps: 20_000,
    };
    const standing = {
      taskId: "fetchBit" as const,
      systemId: opening.selectedSystem.id,
      enabled: true,
      renewalCount: 1,
    };
    const available = withResources(
      {
        ...opening,
        flags: { ...opening.flags, cron: true },
        standingOrder: standing,
        contracts: [offered],
        work: { ...opening.work, contracts: [offered] },
      },
      10_000,
      1_000,
    );
    const accepting = decideBalancePolicy(contextFor(available, "regular"));
    expect(decisionActions(accepting, "setStandingOrderEnabled")).toEqual([]);
    expect(decisionActions(accepting, "acceptContract")).toEqual([
      {
        type: "acceptContract",
        contractId: "managed",
        systemId: opening.selectedSystem.id,
      },
    ]);

    const active = { ...offered, accepted: true };
    const occupied = {
      ...available,
      contracts: [active],
      work: { ...available.work, contracts: [active] },
    };
    expect(
      decisionActions(
        decideBalancePolicy(contextFor(occupied, "regular")),
        "setStandingOrderEnabled",
      ),
    ).toEqual([]);
  });

  it("preserves a separate established standing batch during the Workshop proof", () => {
    const opening = observeOpening();
    const firstSystem = { ...opening.selectedSystem, selected: false };
    const secondSystem = {
      ...opening.selectedSystem,
      id: 2,
      name: "Barebones PC 2",
      selected: true,
    };
    const firstNode = opening.infrastructure.fleet.nodes[0]!;
    const secondNode = {
      ...firstNode,
      id: "fleet-node-2",
      name: secondSystem.name,
      source: { kind: "system" as const, systemId: 2 },
      managed: false,
      blocker: "Node is not managed by Fleet capacity.",
    };
    const bitFlip = job(opening.jobs[0]!, {
      id: "bitFlip",
      name: "Bit Flip",
      seconds: 2,
      rewardCredits: 4,
    });
    const visible: VisibleState = {
      ...opening,
      flags: { ...opening.flags, cron: true },
      currentObjective: {
        ...opening.currentObjective!,
        id: "fleet:specialized-throughput",
        name: "Prove specialized throughput",
      },
      selectedSystem: secondSystem,
      systems: [firstSystem, secondSystem],
      infrastructure: {
        ...opening.infrastructure,
        fleet: {
          ...opening.infrastructure.fleet,
          blockers: [],
          nodes: [
            {
              ...firstNode,
              managed: false,
              blocker: "Node is not managed by Fleet capacity.",
            },
            secondNode,
          ],
        },
      },
      standingOrder: {
        taskId: "busMirror",
        systemId: firstSystem.id,
        enabled: true,
        renewalCount: 8,
      },
      jobs: [bitFlip],
      tasks: [bitFlip],
      contracts: [],
      projects: [],
      research: [],
      upgrades: [],
      activeWork: [],
      work: {
        ...opening.work,
        jobs: [bitFlip],
        contracts: [],
        projects: [],
        activeWork: [],
      },
    };

    const decision = decideBalancePolicy(contextFor(visible, "optimizer"));
    expect(decisionActions(decision, "setStandingOrder")).toEqual([]);
    expect(decisionActions(decision, "selectSystem")).toEqual([
      { type: "selectSystem", systemId: firstSystem.id },
    ]);

    const managedStrongest: VisibleState = {
      ...visible,
      infrastructure: {
        ...visible.infrastructure,
        fleet: {
          ...visible.infrastructure.fleet,
          nodes: visible.infrastructure.fleet.nodes.map((node) =>
            node.source.kind === "system" &&
            node.source.systemId === firstSystem.id
              ? { ...node, managed: true, blocker: null }
              : node,
          ),
        },
      },
    };
    expect(
      decisionActions(
        decideBalancePolicy(contextFor(managedStrongest, "optimizer")),
        "setSystemManaged",
      ),
    ).toEqual([
      { type: "setSystemManaged", systemId: firstSystem.id, managed: false },
    ]);
  });

  it("defers contracts while a finite Workshop proof can be queued", () => {
    const opening = withBuffer(
      observeOpening(),
      "localScheduler",
      2 * 60 * 60_000,
    );
    const thermalProbe = job(opening.jobs[0]!, {
      id: "thermalProbe",
      name: "Thermal Probe",
      category: "system",
      canQueue: true,
      queueBlockedReason: null,
    });
    const offered: VisibleContract = {
      id: "managed-proof-conflict",
      templateId: "ledgerAudit",
      kind: "sustained",
      name: "Managed Proof Conflict",
      description: "Managed Proof Conflict",
      systemId: opening.selectedSystem.id,
      workRequiredMs: 10 * 60_000,
      workCompletedMs: 0,
      remainingMs: 10 * 60_000,
      expiresAtMs: 60 * 60_000,
      rewards: exactResourceBag(200, 4),
      novel: false,
      accepted: false,
      valuePerHourCredits: amount(1_200),
      expiresInMs: 60 * 60_000,
      operatingCostCredits: amount(0),
      netRewardCredits: amount(200),
      creditRunwayCovered: true,
      bufferCovered: true,
      canAccept: true,
      projectedPauseReason: null,
      valueMultiplierVsStandingOrderBps: 20_000,
    };
    const visible = withResources(
      {
        ...opening,
        currentObjective: {
          ...opening.currentObjective!,
          id: "fleet:specialized-throughput",
          name: "Prove specialized throughput",
        },
        workshop: {
          ...opening.workshop,
          thermalVisible: false,
          thermalControlsUnlocked: false,
          specializedComputeUnlocked: false,
        },
        tasks: [thermalProbe],
        jobs: [thermalProbe],
        contracts: [offered],
        projects: [],
        research: [],
        upgrades: [],
        activeWork: [],
        work: {
          ...opening.work,
          jobs: [thermalProbe],
          contracts: [offered],
          projects: [],
          activeWork: [],
        },
      },
      10_000,
      1_000,
    );

    const decision = decideBalancePolicy(contextFor(visible, "regular"));
    expect(decisionActions(decision, "acceptContract")).toEqual([]);
    expect(decisionActions(decision, "startTask")).toContainEqual({
      type: "startTask",
      taskId: "thermalProbe",
      systemId: opening.selectedSystem.id,
    });

    const secondSystem = {
      ...opening.selectedSystem,
      id: 2,
      name: "Contract System",
      selected: false,
    };
    const baseNode = opening.infrastructure.fleet.nodes[0]!;
    const offSystem = {
      ...offered,
      id: "off-system-managed",
      systemId: secondSystem.id,
    };
    const offSystemVisible: VisibleState = {
      ...visible,
      systems: [opening.selectedSystem, secondSystem],
      contracts: [offSystem],
      infrastructure: {
        ...visible.infrastructure,
        fleet: {
          ...visible.infrastructure.fleet,
          nodes: [
            baseNode,
            {
              ...baseNode,
              id: "fleet-node-contract-system",
              name: secondSystem.name,
              source: { kind: "system", systemId: secondSystem.id },
              managed: false,
              blocker: "Node is not managed by Fleet capacity.",
            },
          ],
        },
      },
      work: { ...visible.work, contracts: [offSystem] },
    };
    expect(
      decisionActions(
        decideBalancePolicy(contextFor(offSystemVisible, "regular")),
        "acceptContract",
      ),
    ).toEqual([
      {
        type: "acceptContract",
        contractId: offSystem.id,
        systemId: secondSystem.id,
      },
    ]);

    const activeOffSystem = { ...offSystem, accepted: true, canAccept: false };
    const occupied: VisibleState = {
      ...offSystemVisible,
      contracts: [activeOffSystem],
      work: { ...offSystemVisible.work, contracts: [activeOffSystem] },
    };
    const whileOffSystemRuns = decideBalancePolicy(
      contextFor(occupied, "regular"),
    );
    expect(decisionActions(whileOffSystemRuns, "acceptContract")).toEqual([]);
    expect(decisionActions(whileOffSystemRuns, "startTask")).toContainEqual({
      type: "startTask",
      taskId: "thermalProbe",
      systemId: opening.selectedSystem.id,
    });
  });

  it("pauses a conflicting standing order for the finite Workshop proof", () => {
    const opening = observeOpening();
    const thermalProbe = job(opening.jobs[0]!, {
      id: "thermalProbe",
      name: "Thermal Probe",
      category: "system",
      canQueue: true,
      queueBlockedReason: null,
    });
    const visible: VisibleState = {
      ...opening,
      flags: { ...opening.flags, cron: true },
      currentObjective: {
        ...opening.currentObjective!,
        id: "fleet:specialized-throughput",
        name: "Prove specialized throughput",
      },
      workshop: {
        ...opening.workshop,
        thermalVisible: false,
        thermalControlsUnlocked: false,
        specializedComputeUnlocked: false,
      },
      standingOrder: {
        taskId: "busMirror",
        systemId: opening.selectedSystem.id,
        enabled: true,
        renewalCount: 8,
      },
      jobs: [thermalProbe],
      tasks: [thermalProbe],
      contracts: [],
      projects: [],
      research: [],
      upgrades: [],
      activeWork: [
        {
          id: "standing:busMirror",
          kind: "standingOrder",
          name: "Bus Mirror",
          progress: 0,
          remainingMs: null,
          systemId: opening.selectedSystem.id,
        },
      ],
      work: {
        ...opening.work,
        jobs: [thermalProbe],
        contracts: [],
        projects: [],
        activeWork: [],
      },
    };

    expect(
      decisionActions(
        decideBalancePolicy(contextFor(visible, "regular")),
        "setStandingOrderEnabled",
      ),
    ).toEqual([{ type: "setStandingOrderEnabled", enabled: false }]);

    const yielded: VisibleState = {
      ...visible,
      standingOrder: { ...visible.standingOrder, enabled: false },
      upgrades: [],
      activeWork: [],
      work: { ...visible.work, activeWork: [] },
    };
    const resumedProof = decideBalancePolicy(contextFor(yielded, "regular"));
    expect(
      decisionActions(resumedProof, "setStandingOrderEnabled"),
    ).toEqual([]);
    expect(decisionActions(resumedProof, "startTask")).toContainEqual({
      type: "startTask",
      taskId: "thermalProbe",
      systemId: opening.selectedSystem.id,
    });

    const liveOccupied: VisibleState = {
      ...yielded,
      liveOperations: {
        ...yielded.liveOperations,
        unlocked: true,
        enabled: true,
        systemId: opening.selectedSystem.id,
        maxCoreCount: opening.selectedSystem.coreCount,
      },
    };
    expect(
      decisionActions(
        decideBalancePolicy(contextFor(liveOccupied, "regular")),
        "setLiveOperationsEnabled",
      ),
    ).toEqual([{ type: "setLiveOperationsEnabled", enabled: false }]);
  });

  it("buys cache and RAM required by visible accelerator proof tasks", () => {
    const opening = observeOpening();
    const renderFrame = job(opening.jobs[0]!, {
      id: "renderFrame",
      name: "Render Frame",
      category: "system",
      cacheNeedBits: 40,
      ramNeedBits: 1_024,
      canStart: false,
      canQueue: false,
      blockedReason: "Cache capacity too low.",
      queueBlockedReason: "Cache capacity too low.",
    });
    const inferenceBatch = job(opening.jobs[0]!, {
      id: "inferenceBatch",
      name: "Inference Batch",
      category: "system",
      cacheNeedBits: 32,
      ramNeedBits: 2_048,
      canStart: false,
      canQueue: false,
      blockedReason: "RAM capacity too low.",
      queueBlockedReason: "RAM capacity too low.",
    });
    const cacheUpgrade = {
      ...opening.upgrades.find((upgrade) => upgrade.id === "cache")!,
      canAfford: true,
    };
    const ramUpgrade: VisibleState["upgrades"][number] = {
      ...cacheUpgrade,
      id: "ramCapacity",
      name: "RAM Capacity",
      component: "ram",
    };
    const visible = withResources(
      {
        ...opening,
        currentObjective: {
          ...opening.currentObjective!,
          id: "fleet:specialized-throughput",
          name: "Prove specialized throughput",
        },
        hardware: {
          ...opening.hardware,
          psuLevel: 34,
          cacheBits: 32,
          ramBits: 1_024,
        },
        workshop: {
          ...opening.workshop,
          thermalVisible: true,
          thermalControlsUnlocked: true,
          specializedComputeUnlocked: true,
          accelerators: [
            {
              id: "gpu-proof",
              slotId: 1,
              skuId: "gpuRaster8",
              kind: "gpu",
              name: "GPU",
              expansionSlots: 2,
              active: false,
            },
            {
              id: "npu-proof",
              slotId: 3,
              skuId: "npuEdge4",
              kind: "npu",
              name: "NPU",
              expansionSlots: 1,
              active: false,
            },
          ],
        },
        tasks: [renderFrame, inferenceBatch],
        jobs: [],
        contracts: [],
        projects: [],
        research: [],
        upgrades: [cacheUpgrade, ramUpgrade],
        activeWork: [],
        work: {
          ...opening.work,
          jobs: [],
          contracts: [],
          projects: [],
          activeWork: [],
        },
      },
      1_000_000,
      10_000,
    );

    expect(
      decisionActions(
        decideBalancePolicy(contextFor(visible, "optimizer")),
        "buyUpgrade",
      ),
    ).toContainEqual(
      expect.objectContaining({ upgradeId: "cache" }),
    );

    const cacheReady: VisibleState = {
      ...visible,
      hardware: { ...visible.hardware, cacheBits: 64 },
      tasks: [
        { ...renderFrame, canStart: true, blockedReason: null },
        inferenceBatch,
      ],
      upgrades: [ramUpgrade],
    };
    expect(
      decisionActions(
        decideBalancePolicy(contextFor(cacheReady, "optimizer")),
        "buyUpgrade",
      ),
    ).toContainEqual(
      expect.objectContaining({ upgradeId: "ramCapacity" }),
    );
  });

  it("saves for a missing Workshop accelerator instead of buying optional tuning", () => {
    const opening = observeOpening();
    const optionalClock = {
      ...opening.upgrades.find((upgrade) => upgrade.id === "clock")!,
      canAfford: true,
    };
    const visible = withResources(
      {
        ...opening,
        currentObjective: {
          ...opening.currentObjective!,
          id: "fleet:specialized-throughput",
          name: "Prove specialized throughput",
        },
        hardware: { ...opening.hardware, psuLevel: 34 },
        workshop: {
          ...opening.workshop,
          thermalVisible: true,
          thermalControlsUnlocked: true,
          specializedComputeUnlocked: true,
          accelerators: [
            {
              id: "gpu-proof",
              slotId: 1,
              skuId: "gpuRaster8",
              kind: "gpu",
              name: "GPU",
              expansionSlots: 2,
              active: false,
            },
          ],
          acceleratorSkus: [],
        },
        tasks: [],
        jobs: [],
        contracts: [],
        projects: [],
        research: [],
        upgrades: [optionalClock],
        activeWork: [],
        work: {
          ...opening.work,
          jobs: [],
          contracts: [],
          projects: [],
          activeWork: [],
        },
      },
      1_000_000,
      10_000,
    );

    expect(
      decisionActions(
        decideBalancePolicy(contextFor(visible, "regular")),
        "buyUpgrade",
      ),
    ).toEqual([]);
  });

  it("saves for the Fleet buffer near its calendar band instead of optional tuning", () => {
    const opening = observeOpening();
    const optionalClock = {
      ...opening.upgrades.find((upgrade) => upgrade.id === "clock")!,
      canAfford: true,
    };
    const visible = withResources(
      {
        ...opening,
        automationBuffer: {
          ...opening.automationBuffer,
          ownedLevelId: "systemScheduler",
          departureLevelId: "systemScheduler",
          nextUpgrade: {
            id: "fleetOrchestrator",
            name: "Fleet Orchestrator",
            maxOfflineMs: 24 * 60 * 60_000,
            costs: [{ resource: "credits", amount: amount("500000") }],
            unlocked: true,
            canAfford: false,
            blockedReason: "Insufficient resources.",
          },
        },
        upgrades: [optionalClock],
        research: [],
        projects: [],
        contracts: [],
        jobs: [],
        tasks: [],
        activeWork: [],
        work: {
          ...opening.work,
          jobs: [],
          projects: [],
          contracts: [],
          activeWork: [],
        },
      },
      500_000,
      1_000,
    );

    expect(
      decisionActions(
        decideBalancePolicy(
          contextFor(visible, "regular", {
            elapsedCalendarMs: 12 * 24 * 60 * 60_000,
          }),
        ),
        "buyUpgrade",
      ),
    ).toEqual([]);
  });

  it("commissions the cheapest publicly buyable template for the second-system objective", () => {
    const opening = observeOpening();
    const barebones: VisibleState["machineBuilder"]["templates"][number] = {
      id: "barebonesPc",
      name: "Barebones PC",
      description: "A second named system.",
      components: {
        cpu: "cpu-barebones-1",
        ram: "ram-none",
        scheduler: "scheduler-none",
        psu: "psu-barebones",
      },
      cost: [{ resource: "credits", amount: 10 }],
      canAfford: true,
      canBuy: true,
      blockedReason: null,
      projection: {
        idleWatts: 1,
        peakWatts: 1,
        psuCapacityWatts: 1,
        idlePsuLoad: 1,
        peakPsuLoad: 1,
        powerCostPerSecond: 0,
        safe: true,
      },
    };
    const visible = withResources(
      {
        ...opening,
        currentChapter: {
          ...opening.currentChapter,
          id: "workshopFleet",
          index: 3,
        },
        currentObjective: {
          id: "fleet:second-system",
          chapterId: "workshopFleet",
          name: "Commission a second system",
          description: "Own at least two named systems.",
          transmission: "Capacity can be routed.",
          completed: false,
          current: true,
          blockedReason: "Commission a second system.",
        },
        infrastructure: {
          ...opening.infrastructure,
          fleet: { ...opening.infrastructure.fleet, blockers: [] },
        },
        machineBuilder: {
          ...opening.machineBuilder,
          templates: [
            {
              ...barebones,
              canBuy: true,
              blockedReason: null,
            },
          ],
        },
      },
      1_000,
      100,
    );

    expect(
      decisionActions(
        decideBalancePolicy(contextFor(visible, "optimizer")),
        "buyMachineTemplate",
      ),
    ).toEqual([{ type: "buyMachineTemplate", templateId: "barebonesPc" }]);
  });

  it("starts rack-objective facilities at the Rack Controller buffer", () => {
    const opening = withBuffer(
      observeOpening(),
      "rackController",
      72 * 60 * 60_000,
    );
    const visible = withResources(
      {
        ...opening,
        currentChapter: {
          ...opening.currentChapter,
          id: "rackAndFacility",
          index: 5,
        },
        currentObjective: {
          ...opening.currentObjective!,
          id: "facility:rack-controller",
          chapterId: "rackAndFacility",
          name: "Build a true rack",
        },
        infrastructure: {
          ...opening.infrastructure,
          fleet: { ...opening.infrastructure.fleet, blockers: [] },
          facilities: [],
        },
        contracts: [],
        projects: [],
        research: [],
        upgrades: [],
        work: {
          ...opening.work,
          contracts: [],
          projects: [],
        },
      },
      "1e12",
      "1e9",
    );

    expect(
      decisionActions(
        decideBalancePolicy(contextFor(visible, "optimizer")),
        "commissionFacility",
      ),
    ).toEqual([
      { type: "commissionFacility", templateId: "workshopFacility" },
    ]);
  });

  it("skips active, oversized, and full-rack Cloud placement candidates", () => {
    const opening = cloudPlacementVisible(observeOpening());
    const baseNode = opening.infrastructure.fleet.nodes[0]!;
    const placed = denseNode(baseNode, "dense-placed");
    const active = denseNode(baseNode, "dense-active");
    const oversized = denseNode(baseNode, "dense-oversized", 48);
    const valid = denseNode(baseNode, "dense-valid");
    const firstSite = withNodeInFirstRack(
      facilityWithHalfRacks("facility-1"),
      placed.id,
    );
    const fullCandidateSite = withFullFirstRack(
      facilityWithHalfRacks("facility-2"),
    );
    const admissibleSite = facilityWithHalfRacks("facility-3");
    const visible: VisibleState = {
      ...opening,
      infrastructure: {
        ...opening.infrastructure,
        fleet: {
          ...opening.infrastructure.fleet,
          nodes: [placed, active, oversized, valid],
        },
        facilities: [firstSite, fullCandidateSite, admissibleSite],
        workloads: [activeWorkloadOn(active.id)],
      },
    };

    const decision = decideBalancePolicy(contextFor(visible, "optimizer"));
    expect(decisionActions(decision, "placeFleetNodeInRack")).toEqual([
      {
        type: "placeFleetNodeInRack",
        facilityId: admissibleSite.id,
        rackId: admissibleSite.racks[0]!.id,
        nodeId: valid.id,
      },
    ]);
  });

  it("buys a rack-sized Cloud node when raw counts only contain an active candidate", () => {
    const opening = cloudPlacementVisible(observeOpening());
    const baseNode = opening.infrastructure.fleet.nodes[0]!;
    const placed = denseNode(baseNode, "dense-placed");
    const active = denseNode(baseNode, "dense-active");
    const firstSite = withNodeInFirstRack(
      facilityWithHalfRacks("facility-1"),
      placed.id,
    );
    const nextSite = facilityWithHalfRacks("facility-2");
    const visible: VisibleState = {
      ...opening,
      infrastructure: {
        ...opening.infrastructure,
        fleet: {
          ...opening.infrastructure.fleet,
          nodes: [placed, active],
        },
        facilities: [firstSite, nextSite],
        workloads: [activeWorkloadOn(active.id)],
      },
    };

    const decision = decideBalancePolicy(contextFor(visible, "optimizer"));
    expect(decisionActions(decision, "placeFleetNodeInRack")).toEqual([]);
    expect(decisionActions(decision, "purchaseAggregateServerBatch")).toEqual([
      { type: "purchaseAggregateServerBatch", skuId: "denseServer", count: 1 },
    ]);
  });

  it("builds bounded inbound Cloud routes before starting the visible finale", () => {
    const opening = withBuffer(
      observeOpening(),
      "globalScheduler",
      7 * 24 * 60 * 60_000,
    );
    const regionIds = ["region-1", "region-2", "region-3", "region-4"];
    const regions: VisibleState["cloud"]["regions"] = regionIds.map(
      (id, index) => ({
        id,
        name: `Region ${index + 1}`,
        zoneCount: 1,
        demandPerSecond: amount(0),
        routedSupplyPerSecond: amount("700000000000"),
        fulfilledPerSecond: amount("1"),
        covered: true,
      }),
    );
    const zones: VisibleState["cloud"]["zones"] = regionIds.map(
      (regionId, index) => ({
        id: `zone-${index + 1}`,
        name: `Zone ${index + 1}`,
        regionId,
        regionName: `Region ${index + 1}`,
        facilityId: `facility-${index + 1}`,
        faultDomainId: `grid-${index + 1}`,
        status: "online",
        capacityBps: 10_000,
        baseCapacityPerSecond: amount("700000000000"),
        effectiveCapacityPerSecond: amount("700000000000"),
        baseLatencyMs: 25,
        replicaCount: 1,
        healthyReplicaCount: 1,
        active: index === 0,
        failoverPending: false,
      }),
    );
    const links = regionIds.slice(1).map((regionId) => ({
      id: `policy-route:${regionId}:region-1`,
      from: regionId,
      to: "region-1",
      capacity: amount("500000000000"),
      costPerUnit: 0,
      latencyMs: 25,
    }));
    const visible = withResources(
      {
        ...opening,
        currentChapter: {
          ...opening.currentChapter,
          id: "planetaryCommons",
          index: 7,
        },
        currentObjective: {
          ...opening.currentObjective!,
          id: "planetary:global-scheduler",
          chapterId: "planetaryCommons",
          name: "Route the planetary commons",
        },
        infrastructure: {
          ...opening.infrastructure,
          fleet: {
            ...opening.infrastructure.fleet,
            blockers: [],
            utilizationBps: 0,
          },
        },
        contractMarket: {
          ...opening.contractMarket,
          canRefresh: false,
          refreshAvailableInMs: 60_000,
        },
        cloud: {
          ...opening.cloud,
          regions,
          zones,
          routing: {
            ...opening.cloud.routing,
            requestedPerSecond: amount("2000000000003"),
            deliveredPerSecond: amount("2000000000003"),
            unmetPerSecond: amount(0),
            connectedRegionIds: regionIds,
            links: [],
          },
          slaDefinitions: opening.cloud.slaDefinitions.map((definition) => ({
            ...definition,
            canStart: false,
            blockedReason: "Proof already complete.",
          })),
          finale: {
            ...opening.cloud.finale,
            canStart: false,
            blockedReason:
              "Requires positive flow on explicit routes connecting four served regions.",
          },
        },
        tasks: [],
        jobs: [],
        projects: [],
        contracts: [],
        research: [],
        upgrades: [],
        activeWork: [],
        work: {
          ...opening.work,
          jobs: [],
          projects: [],
          contracts: [],
          activeWork: [],
        },
      },
      "1e30",
      "1e30",
    );

    const routingDecision = decideBalancePolicy(
      contextFor(visible, "optimizer"),
    );
    expect(decisionActions(routingDecision, "setCloudRegionalDemand")).toEqual([
      {
        type: "setCloudRegionalDemand",
        regionId: "region-1",
        demand: amount("2000000000000"),
      },
    ]);
    expect(decisionActions(routingDecision, "setCloudRoutingLinks")).toEqual([
      { type: "setCloudRoutingLinks", links },
    ]);
    expect(decisionActions(routingDecision, "startPlanetaryFinale")).toEqual([]);

    const finaleReady: VisibleState = {
      ...visible,
      cloud: {
        ...visible.cloud,
        regions: visible.cloud.regions.map((region, index) => ({
          ...region,
          demandPerSecond:
            index === 0 ? amount("2000000000000") : amount("1"),
        })),
        routing: { ...visible.cloud.routing, links },
        finale: {
          ...visible.cloud.finale,
          canStart: true,
          blockedReason: null,
        },
      },
    };
    // Proof admission carries no hard-coded calendar minimum: the moment the
    // public canStart gate opens, every profile starts the finale, so the
    // acceptance suite can measure real pacing instead of policy-scripted
    // dates.
    for (const profileId of ["optimizer", "regular"] as const) {
      expect(
        decisionActions(
          decideBalancePolicy(
            contextFor(finaleReady, profileId, { elapsedCalendarMs: 0 }),
          ),
          "startPlanetaryFinale",
        ),
      ).toEqual([{ type: "startPlanetaryFinale" }]);
    }
  });

  it("never proposes a contract-market refresh before CRON automation", () => {
    const opening = withBuffer(
      observeOpening(),
      "localScheduler",
      2 * 60 * 60_000,
    );
    const visible: VisibleState = {
      ...opening,
      contracts: [],
      work: { ...opening.work, contracts: [] },
      contractMarket: {
        ...opening.contractMarket,
        // Even if the surface claims the refresh is available, a pre-CRON
        // refresh is a guaranteed no-op the policy must never dispatch.
        canRefresh: true,
        refreshAvailableInMs: 0,
      },
    };

    const preCron = decideBalancePolicy(contextFor(visible, "regular"));
    expect(decisionActions(preCron, "refreshContractMarket")).toEqual([]);
    expect(preCron.audit.notes.map((note) => note.code)).toContain(
      "contract-refresh-not-due",
    );

    const cronReady: VisibleState = {
      ...visible,
      flags: { ...visible.flags, cron: true },
    };
    const decision = decideBalancePolicy(contextFor(cronReady, "regular"));
    expect(decisionActions(decision, "refreshContractMarket")).toEqual([
      { type: "refreshContractMarket" },
    ]);
  });

  it("rerolls a nonempty market when no visible offer fits and refresh is allowed", () => {
    const opening = withBuffer(
      observeOpening(),
      "localScheduler",
      2 * 60 * 60_000,
    );
    const badOffer: VisibleContract = {
      id: "bad-offer",
      templateId: "ledgerAudit",
      kind: "sustained",
      name: "Bad offer",
      description: "Does not fit this policy window.",
      systemId: opening.selectedSystem.id,
      workRequiredMs: 10 * 60_000,
      workCompletedMs: 0,
      remainingMs: 10 * 60_000,
      expiresAtMs: 60 * 60_000,
      rewards: exactResourceBag(200, 4),
      novel: false,
      accepted: false,
      valuePerHourCredits: amount(1_200),
      expiresInMs: 60 * 60_000,
      operatingCostCredits: amount(0),
      netRewardCredits: amount(200),
      creditRunwayCovered: true,
      bufferCovered: true,
      canAccept: false,
      projectedPauseReason: null,
      valueMultiplierVsStandingOrderBps: 20_000,
    };
    const visible: VisibleState = {
      ...opening,
      flags: { ...opening.flags, cron: true },
      contracts: [badOffer],
      work: { ...opening.work, contracts: [badOffer] },
      contractMarket: {
        ...opening.contractMarket,
        canRefresh: true,
        refreshAvailableInMs: 0,
      },
    };

    const decision = decideBalancePolicy(contextFor(visible, "regular"));
    expect(decisionActions(decision, "refreshContractMarket")).toEqual([
      { type: "refreshContractMarket" },
    ]);
    expect(decision.audit.notes.map((note) => note.code)).toContain(
      "no-contract-fit",
    );

    const cooldownHeld = decideBalancePolicy(
      contextFor(
        {
          ...visible,
          contractMarket: {
            ...visible.contractMarket,
            canRefresh: false,
            refreshAvailableInMs: 45_000,
          },
        },
        "regular",
      ),
    );
    expect(decisionActions(cooldownHeld, "refreshContractMarket")).toEqual([]);
    expect(cooldownHeld.audit.notes.map((note) => note.code)).toContain(
      "contract-refresh-not-due",
    );
  });

  it("purchases an affordable unlocked buffer without a calendar admission date", () => {
    const opening = observeOpening();
    const visible = withResources(
      {
        ...opening,
        automationBuffer: {
          ...opening.automationBuffer,
          ownedLevelId: "localScheduler",
          departureLevelId: "localScheduler",
          nextUpgrade: {
            id: "cronRuntime",
            name: "CRON Runtime",
            maxOfflineMs: 8 * 60 * 60_000,
            costs: [
              { resource: "credits", amount: amount(400) },
              { resource: "data", amount: amount(20) },
            ],
            unlocked: true,
            canAfford: true,
            blockedReason: null,
          },
        },
      },
      1_000,
      100,
    );

    // Old policy delayed this purchase to the acceptance lower bound (2 days
    // for full-idle); timing must emerge from affordability alone.
    const decision = decideBalancePolicy(
      contextFor(visible, "full-idle", { elapsedCalendarMs: 0 }),
    );
    expect(decisionActions(decision, "purchaseAutomationBuffer")).toEqual([
      { type: "purchaseAutomationBuffer", levelId: "cronRuntime" },
    ]);
  });

  it("starts the profitable installed-storage workload after finite proofs", () => {
    const opening = observeOpening();
    const startable: VisibleState = {
      ...opening,
      workshop: {
        ...opening.workshop,
        storageWorkload: {
          ...opening.workshop.storageWorkload,
          active: false,
          canStart: true,
          blockedReason: null,
          projection: {
            ...opening.workshop.storageWorkload.projection,
            durationMs: amount(60_000),
            operatingCostCredits: amount(10),
            netRewardCredits: amount(150),
            pauseReason: null,
          },
        },
      },
    };

    expect(
      decisionActions(
        decideBalancePolicy(contextFor(startable, "regular")),
        "startWorkshopStorageWorkload",
      ),
    ).toEqual([
      {
        type: "startWorkshopStorageWorkload",
        workloadId: startable.workshop.storageWorkload.id,
        systemId: startable.selectedSystem.id,
      },
    ]);

    const alreadyRunning: VisibleState = {
      ...startable,
      workshop: {
        ...startable.workshop,
        storageWorkload: {
          ...startable.workshop.storageWorkload,
          active: true,
          canStart: false,
        },
      },
    };
    expect(
      decisionActions(
        decideBalancePolicy(contextFor(alreadyRunning, "regular")),
        "startWorkshopStorageWorkload",
      ),
    ).toEqual([]);
  });

  it("runs steady capacity workloads on cluster headroom after the fabric proof", () => {
    const opening = withBuffer(
      observeOpening(),
      "clusterController",
      48 * 60 * 60_000,
    );
    const sweepDefinition: VisibleState["infrastructure"]["workloadDefinitions"][number] = {
      id: "fabricIntegritySweep",
      name: "Fabric Integrity Sweep",
      description: "Run an exact capacity-backed integrity pass.",
      kind: "capacity",
      startCosts: [
        { resource: "credits", amount: amount(50) },
        { resource: "data", amount: amount(5) },
      ],
      rewards: exactResourceBag(500, 5),
      paidWorkUnits: amount(1_000),
      workValueMultiplier: { id: "test", basisPoints: amount(10_000) },
      operatingCreditsPerSecond: amount("0.2"),
      clusterOptions: [
        { clusterId: "cluster-1", canStart: true, blockedReason: null },
      ],
    };
    const visible = withResources(
      {
        ...opening,
        currentChapter: {
          ...opening.currentChapter,
          id: "localFabric",
          index: 5,
        },
        currentObjective: null,
        infrastructure: {
          ...opening.infrastructure,
          fleet: {
            ...opening.infrastructure.fleet,
            blockers: [],
            utilizationBps: 0,
          },
          workloads: [],
          workloadDefinitions: [sweepDefinition],
        },
      },
      100_000,
      10_000,
    );

    expect(
      decisionActions(
        decideBalancePolicy(contextFor(visible, "regular")),
        "startClusterWorkload",
      ),
    ).toEqual([
      {
        type: "startClusterWorkload",
        clusterId: "cluster-1",
        definitionId: "fabricIntegritySweep",
      },
    ]);

    // While the sweep is already in flight it is not restarted.
    const running = {
      ...visible,
      infrastructure: {
        ...visible.infrastructure,
        workloads: [
          {
            ...activeWorkloadOn("node-1"),
            definitionId: "fabricIntegritySweep" as const,
          },
        ],
      },
    };
    expect(
      decisionActions(
        decideBalancePolicy(contextFor(running, "regular")),
        "startClusterWorkload",
      ),
    ).toEqual([]);

    // The mandatory fabric proof window keeps cluster headroom reserved.
    const proofWindow = {
      ...visible,
      currentObjective: {
        id: "fabric:cluster-controller",
        chapterId: "localFabric" as const,
        name: "Prove the fabric",
        description: "Run the replicated shard proof.",
        transmission: "Prove it.",
        completed: false,
        current: true,
        blockedReason: null,
      },
    };
    expect(
      decisionActions(
        decideBalancePolicy(contextFor(proofWindow, "regular")),
        "startClusterWorkload",
      ),
    ).toEqual([]);
  });

  it("treats an active attended lane as productive coverage", () => {
    const opening = observeOpening();
    const visible: VisibleState = {
      ...opening,
      jobs: [],
      tasks: [],
      contracts: [],
      projects: [],
      activeWork: [],
      standingOrder: {
        taskId: null,
        systemId: null,
        enabled: false,
        renewalCount: 0,
      },
      liveOperations: {
        ...opening.liveOperations,
        enabled: true,
        activeTaskId: "liveQueueTriage",
        activeTaskName: "Queue Triage",
        allocatedCoreCount: 1,
      },
      work: {
        ...opening.work,
        jobs: [],
        contracts: [],
        projects: [],
        activeWork: [],
      },
    };

    expect(
      decideBalancePolicy(contextFor(visible, "regular")).audit.stranded,
    ).toBe(false);
  });

  it("lets return-based profiles start viable finite side-project phases", () => {
    const opening = withBuffer(observeOpening(), "systemScheduler", 12 * 60 * 60_000);
    const project: VisibleProject = {
      id: "openFoundry",
      name: "Open Foundry",
      description: "Synthetic side phase",
      sideArcId: "openFoundry",
      currentPhase: {
        id: "toolchain",
        name: "Assemble",
        durationMs: 60 * 60_000,
        costs: [
          { resource: "credits", amount: amount(100) },
          { resource: "data", amount: amount(1) },
        ],
        rewards: exactResourceBag(300, 20),
      },
      phaseIndex: 0,
      phaseProgressMs: 0,
      remainingMs: 60 * 60_000,
      active: false,
      completed: false,
      canStartPhase: true,
      blockedReason: null,
    };
    const visible = withResources(
      {
        ...opening,
        projects: [project],
        work: { ...opening.work, projects: [project] },
        contracts: [
          {
            id: "active-1",
            templateId: "ledgerAudit",
            kind: "sustained",
            name: "Active",
            description: "Active",
            systemId: opening.selectedSystem.id,
            workRequiredMs: 1,
            workCompletedMs: 0,
            remainingMs: 1,
            expiresAtMs: null,
            rewards: exactResourceBag(),
            novel: false,
            accepted: true,
            valuePerHourCredits: amount(0),
            expiresInMs: null,
            operatingCostCredits: amount(0),
            netRewardCredits: amount(0),
            creditRunwayCovered: true,
            bufferCovered: true,
            canAccept: false,
            projectedPauseReason: null,
          },
        ],
      },
      10_000,
      1,
    );

    const idle = decideBalancePolicy(contextFor(visible, "full-idle"));
    const engaged = decideBalancePolicy(contextFor(visible, "engaged"));
    const expectedProjectAction = {
      type: "startProjectPhase",
      projectId: "openFoundry",
      systemId: opening.selectedSystem.id,
    } as const;
    expect(decisionActions(idle, "startProjectPhase")).toContainEqual(
      expectedProjectAction,
    );
    expect(decisionActions(engaged, "startProjectPhase")).toContainEqual(
      expectedProjectAction,
    );
  });

  it("installs an available physical storage path for a locally blocked project phase", () => {
    const opening = withBuffer(observeOpening(), "systemScheduler", 12 * 60 * 60_000);
    const project: VisibleProject = {
      id: "openFoundry",
      name: "Open Foundry",
      description: "Storage-backed phase",
      sideArcId: "openFoundry",
      currentPhase: {
        id: "render",
        name: "Render corpus",
        durationMs: Number.MAX_SAFE_INTEGER,
        costs: [],
        rewards: exactResourceBag(300, 20),
      },
      phaseIndex: 1,
      phaseProgressMs: 0,
      remainingMs: Number.MAX_SAFE_INTEGER,
      active: true,
      completed: false,
      canStartPhase: false,
      blockedReason: "Project phase already active.",
    };
    const visible = withResources(
      {
        ...opening,
        projects: [project],
        work: { ...opening.work, projects: [project] },
        workshop: {
          ...opening.workshop,
          storageSkuId: "storageNone",
          storageSkus: opening.workshop.storageSkus.map((storage) =>
            storage.id === "localSsd"
              ? { ...storage, canInstall: true, blockedReason: null }
              : storage,
          ),
        },
      },
      100_000,
      1_000_000,
    );

    expect(
      decisionActions(
        decideBalancePolicy(contextFor(visible, "regular")),
        "installWorkshopStorage",
      ),
    ).toContainEqual({
      type: "installWorkshopStorage",
      skuId: "localSsd",
      systemId: opening.selectedSystem.id,
    });
  });

  it("installs a physical NIC on the system assigned to a network-blocked project", () => {
    const opening = withBuffer(observeOpening(), "systemScheduler", 12 * 60 * 60_000);
    const project: VisibleProject = {
      id: "openFoundry",
      name: "Open Foundry",
      description: "Network-backed phase",
      sideArcId: "openFoundry",
      currentPhase: {
        id: "publish",
        name: "Publish corpus",
        durationMs: Number.MAX_SAFE_INTEGER,
        costs: [],
        rewards: exactResourceBag(300, 20),
      },
      phaseIndex: 2,
      phaseProgressMs: 0,
      remainingMs: Number.MAX_SAFE_INTEGER,
      active: true,
      completed: false,
      canStartPhase: false,
      blockedReason: "Project phase already active.",
    };
    const assignedSystemId = opening.selectedSystem.id;
    const projectWork: VisibleState["activeWork"][number] = {
      id: `project:${project.id}`,
      kind: "project",
      name: project.name,
      progress: 0,
      remainingMs: Number.MAX_SAFE_INTEGER,
      systemId: assignedSystemId,
    };
    const visible = withResources(
      {
        ...opening,
        projects: [project],
        activeWork: [projectWork],
        workshop: {
          ...opening.workshop,
          storageSkuId: "localSsd",
          networkUnlocked: true,
          networkSkuId: "networkNone",
          networkSkus: opening.workshop.networkSkus.map((network) =>
            network.id === "gigabitNic"
              ? { ...network, canInstall: true, blockedReason: null }
              : network,
          ),
        },
        work: {
          ...opening.work,
          projects: [project],
          activeWork: [projectWork],
        },
      },
      100_000,
      100,
    );

    expect(
      decisionActions(
        decideBalancePolicy(contextFor(visible, "regular")),
        "installLocalNetwork",
      ),
    ).toContainEqual({
      type: "installLocalNetwork",
      skuId: "gigabitNic",
      systemId: assignedSystemId,
    });
  });

  it("uses public Fleet visibility for safe management, aggregate capacity, and clusters", () => {
    const opening = withBuffer(observeOpening(), "clusterController", 48 * 60 * 60_000);
    const secondSystem = {
      ...opening.selectedSystem,
      id: 2,
      name: "Second",
      selected: false,
      activeTaskCount: 0,
      queueCount: 0,
    };
    const baseNode = opening.infrastructure.fleet.nodes[0]!;
    const visible = withResources(
      {
        ...opening,
        systems: [opening.selectedSystem, secondSystem],
        infrastructure: {
          ...opening.infrastructure,
          fleet: {
            ...opening.infrastructure.fleet,
            utilizationBps: 9_500,
            blockers: [
              "Barebones PC: Node is not managed by Fleet capacity.",
              "Second: Node is not managed by Fleet capacity.",
            ],
            nodes: [
              {
                ...baseNode,
                managed: false,
                blocker: "Node is not managed by Fleet capacity.",
              },
              {
                ...baseNode,
                id: "fleet-node-2",
                name: "Second",
                source: { kind: "system", systemId: 2 },
                managed: false,
                blocker: "Node is not managed by Fleet capacity.",
              },
              {
                ...baseNode,
                id: "fleet-node-3",
                name: "Aggregate A",
                source: { kind: "aggregate", skuId: "workshopServer", count: 1 },
                managed: true,
                blocker: null,
              },
              {
                ...baseNode,
                id: "fleet-node-4",
                name: "Aggregate B",
                source: { kind: "aggregate", skuId: "workshopServer", count: 1 },
                managed: true,
                blocker: null,
              },
            ],
          },
        },
        contracts: Array.from({ length: 3 }, (_, index) => ({
          id: `active-${index}`,
          templateId: "ledgerAudit" as const,
          kind: "sustained" as const,
          name: "Active",
          description: "Active",
          systemId: opening.selectedSystem.id,
          workRequiredMs: 1,
          workCompletedMs: 0,
          remainingMs: 1,
          expiresAtMs: null,
          rewards: exactResourceBag(),
          novel: false,
          accepted: true,
          valuePerHourCredits: amount(0),
          expiresInMs: null,
          operatingCostCredits: amount(0),
          netRewardCredits: amount(0),
          creditRunwayCovered: true,
          bufferCovered: true,
          canAccept: false,
          projectedPauseReason: null,
        })),
        projects: [],
        research: [],
        upgrades: [],
        jobs: [],
      },
      "1e15",
      "1e12",
    );

    const decision = decideBalancePolicy(contextFor(visible, "optimizer"));
    expect(decisionActions(decision, "setSystemManaged")).toHaveLength(1);
    expect(decisionActions(decision, "purchaseAggregateServerBatch")).toContainEqual({
      type: "purchaseAggregateServerBatch",
      skuId: "denseServer",
      count: 1,
    });
    expect(decisionActions(decision, "commissionCluster")).toHaveLength(1);
  });

  it("returns explicit no-op/stranding audit and measurable manual-dispatch share", () => {
    const opening = observeOpening();
    const empty: VisibleState = {
      ...opening,
      jobs: [],
      tasks: [],
      projects: [],
      contracts: [],
      research: [],
      upgrades: [],
      activeWork: [],
      work: {
        ...opening.work,
        jobs: [],
        projects: [],
        contracts: [],
        activeWork: [],
      },
      infrastructure: {
        ...opening.infrastructure,
        elapsedMs: 60_000,
        fleet: {
          ...opening.infrastructure.fleet,
          blockers: ["Requires Workshop Fleet."],
        },
      },
    };
    const noOp = decideBalancePolicy(contextFor(empty, "regular"));
    expect(noOp.actions).toEqual([]);
    expect(noOp.audit.noOpReason).not.toBeNull();
    expect(noOp.audit.stranded).toBe(true);
    expect(noOp.audit.manualDispatchShare).toBe(0);

    const productive = decideBalancePolicy(contextFor(opening, "optimizer"));
    expect(productive.audit.manualDispatchActions).toBeGreaterThan(0);
    expect(productive.audit.manualDispatchShare).toBeGreaterThan(0);
    expect(productive.audit.developerGrantActions).toBe(0);

    const startIndex = productive.actions.findIndex(
      (action) => action.type === "startTask",
    );
    const startAction = productive.actions[startIndex]!;
    const changedState = bootstrapSmokeRuntime.dispatch(
      bootstrapSmokeRuntime.createInitialState(17),
      startAction,
    );
    const changedVisible = bootstrapSmokeRuntime.observe(changedState);
    expect(
      auditPolicyActionOutcome(productive, startIndex, opening, changedVisible),
    ).toEqual(expect.objectContaining({ noOp: false, changedPublicState: true }));
    expect(auditPolicyActionOutcome(productive, startIndex, opening, opening)).toEqual(
      expect.objectContaining({
        noOp: true,
        changedPublicState: false,
        noOpReason: expect.stringContaining("Dispatch produced no public change"),
      }),
    );
  });

  it("never proposes a direct start for a system task without a public queue slot", () => {
    const opening = observeOpening();
    const base = opening.jobs[0]!;
    const blockedSystemJob = job(base, {
      id: "tinyChecksum",
      name: "Blocked System Job",
      category: "system",
      rewardCredits: 1_000_000,
      canQueue: false,
      queueBlockedReason: "Buy system queue slots.",
    });
    const directCpuJob = job(base, {
      id: "fetchBit",
      name: "Direct CPU Job",
      category: "cpu",
      rewardCredits: 1,
      canQueue: false,
      queueBlockedReason: "Scheduler locked.",
    });
    const visible: VisibleState = {
      ...opening,
      jobs: [blockedSystemJob, directCpuJob],
      tasks: [blockedSystemJob, directCpuJob],
      projects: [],
      contracts: [],
      research: [],
      upgrades: [],
      activeWork: [],
      work: {
        ...opening.work,
        jobs: [blockedSystemJob, directCpuJob],
        projects: [],
        contracts: [],
        activeWork: [],
      },
    };

    const starts = decisionActions(
      decideBalancePolicy(contextFor(visible, "optimizer")),
      "startTask",
    );
    expect(starts).not.toContainEqual(
      expect.objectContaining({ taskId: "tinyChecksum" }),
    );
    expect(starts).toContainEqual(
      expect.objectContaining({ taskId: "fetchBit" }),
    );
  });

  it("advances the real opening through public runtime calls without developer grants", () => {
    let state = bootstrapSmokeRuntime.createInitialState(23);
    const dispatched: GameAction[] = [];
    let visible = bootstrapSmokeRuntime.observe(state);

    // The attended opening is modeled at the runner's ~2s decision step
    // (OPENING_DECISION_STEP_MS): with metered power billing live from the
    // first tick, a once-a-minute loop would idle-drain the 10-credit wallet
    // faster than one manual dispatch per minute can earn, which no clicking
    // player represents.
    for (let step = 0; step < 900 && visible.stage === "primitiveCpu"; step += 1) {
      const decision = decideBalancePolicy(
        contextFor(visible, "optimizer", {
          nowMs: step * 2_000,
          elapsedCalendarMs: step * 2_000,
          remainingActiveMs: 120 * 60_000 - step * 2_000,
        }),
      );
      for (const action of decision.actions) {
        dispatched.push(action);
        state = bootstrapSmokeRuntime.dispatch(state, action);
      }
      state = bootstrapSmokeRuntime.advance(state, 2_000, "foreground").state;
      visible = bootstrapSmokeRuntime.observe(state);
    }

    expect(dispatched.some((action) => action.type === "startTask")).toBe(true);
    expect(dispatched.some((action) => action.type === "buyResearch")).toBe(true);
    expect(dispatched.some((action) => action.type === "buyUpgrade")).toBe(true);
    expect(visible.stage).not.toBe("primitiveCpu");
  });
});
