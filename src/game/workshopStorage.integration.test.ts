import { describe, expect, it } from "vitest";
import {
  advanceGame,
  amountAdd,
  amountCompare,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  applyAction,
  createInitialGameState,
  deriveVisibleState,
  deserializeSave,
  exactResourceBag,
  getWorkValueCredits,
  serializeSave,
  type GameState,
} from "./index";
import { getPowerCostPerSecondExact } from "./math";
import { createSystemState } from "./progression";
import { replaceSystems, syncSelectedSystemRuntime } from "./systems";
import {
  WORKSHOP_STORAGE_PAID_WORK_UNITS,
  WORKSHOP_STORAGE_SERVICE_VALUE_MULTIPLIER,
  workshopStorageWorkloadDefinition,
} from "./workshopStorage";

const richResources = exactResourceBag("1e30", "1e12");

const createStorageReadyState = (systems = 1): GameState => {
  const initial = createInitialGameState();
  let state: GameState = {
    ...initial,
    exactResources: richResources,
    resources: {
      credits: amountToSafeNumber(richResources.credits),
      data: amountToSafeNumber(richResources.data),
    },
    flags: {
      ...initial.flags,
      systemCatalog: true,
      psuManagement: true,
    },
    research: {
      ...initial.research,
      completed: ["systemCatalog", "psuManagement"],
    },
    hardware: {
      ...initial.hardware,
      psuWatts: 1_000,
    },
  };
  state = syncSelectedSystemRuntime(state);
  if (systems > 1) {
    const second = createSystemState(2, "Storage Node", "storage-test", {
      ...state.hardware,
      psuWatts: 1_000,
    });
    state = replaceSystems(state, [...state.systems, second], 1);
  }
  return state;
};

const installLocalStorage = (state = createStorageReadyState()) =>
  applyAction(state, {
    type: "installWorkshopStorage",
    skuId: "localSsd",
  });

const startStaging = (state = installLocalStorage()) =>
  applyAction(state, {
    type: "startWorkshopStorageWorkload",
    workloadId: "artifactStaging",
  });

describe("Workshop Fleet storage vertical", () => {
  it("charges exact SKU costs and mirrors the selected system into Fleet capacity", () => {
    const before = createStorageReadyState();
    const after = installLocalStorage(before);

    expect(amountSubtract(before.exactResources.credits, after.exactResources.credits)).toBe(
      "30000",
    );
    expect(after.workshop.storageSkuId).toBe("localSsd");
    expect(after.systems[0]?.workshop.storageSkuId).toBe("localSsd");
    const fleetNode = after.infrastructure.fleetNodes.find(
      (node) => node.source.kind === "system" && node.source.systemId === 1,
    );
    expect(fleetNode?.storageSkuId).toBe("localSsd");
    const visibleNode = deriveVisibleState(after).infrastructure.fleet.nodes.find(
      (node) => node.source.kind === "system" && node.source.systemId === 1,
    );
    expect(visibleNode?.capacity.storageBits).toBe("8000000000000");
  });

  it("scopes storage changes to the addressed named system", () => {
    const before = createStorageReadyState(2);
    const after = applyAction(before, {
      type: "installWorkshopStorage",
      skuId: "nvmeArray",
      systemId: 2,
    });

    expect(after.systems.find((system) => system.id === 1)?.workshop.storageSkuId).toBe(
      "storageNone",
    );
    expect(after.systems.find((system) => system.id === 2)?.workshop.storageSkuId).toBe(
      "nvmeArray",
    );
    expect(
      after.infrastructure.fleetNodes.find(
        (node) => node.source.kind === "system" && node.source.systemId === 2,
      )?.storageSkuId,
    ).toBe("nvmeArray");
  });

  it("projects fit, exact duration, rewards, billing, and completion", () => {
    const noStorage = createStorageReadyState();
    const blocked = deriveVisibleState(noStorage).workshop.storageWorkload;
    expect(blocked.canStart).toBe(false);
    expect(blocked.blockedReason).toContain("capacity");
    expect(blocked.projection.durationMs).toBeNull();

    const installed = installLocalStorage(noStorage);
    const projection = deriveVisibleState(installed).workshop.storageWorkload;
    expect(projection.canStart).toBe(true);
    expect(projection.storageRequiredBits).toBe("64000000000");
    expect(projection.readBits).toBe("24000000000");
    expect(projection.writeBits).toBe("12000000000");
    expect(projection.projection.durationMs).toBe("6000");
    expect(projection.rewards).toEqual(exactResourceBag(
      getWorkValueCredits(
        WORKSHOP_STORAGE_PAID_WORK_UNITS,
        WORKSHOP_STORAGE_SERVICE_VALUE_MULTIPLIER,
      ),
      "64",
    ));
    expect(projection.projection.operatingCostCredits).not.toBeNull();

    const started = startStaging(installed);
    expect(
      deriveVisibleState(started).activeWork.some(
        (work) => work.kind === "workshopStorage" && work.systemId === 1,
      ),
    ).toBe(true);
    const powerRate = getPowerCostPerSecondExact(started);
    const creditsBefore = started.exactResources.credits;
    const dataBefore = started.exactResources.data;
    const halfway = advanceGame(started, 3_000, "foreground").state;
    expect(halfway.workshop.activeStorageWorkload).not.toBeNull();
    expect(deriveVisibleState(halfway).workshop.storageWorkload.progressBps).toBe(5_000);

    const completed = advanceGame(halfway, 3_000, "foreground").state;
    const expectedCredits = amountAdd(
      amountSubtract(creditsBefore, amountMultiply(powerRate, 6)),
      workshopStorageWorkloadDefinition.plan.reward.credits,
    );
    expect(completed.exactResources.credits).toBe(expectedCredits);
    expect(completed.exactResources.data).toBe(
      amountAdd(dataBefore, workshopStorageWorkloadDefinition.plan.reward.data),
    );
    expect(completed.workshop.activeStorageWorkload).toBeNull();
    expect(completed.workshop.completedStorageWorkloads).toBe(1);
    expect(deriveVisibleState(completed).workshop.storageWorkload.projection.pauseReason).toBe(
      "completed",
    );
  });

  it("is foreground-delta and offline invariant across storage rate boundaries", () => {
    const installed = installLocalStorage();
    const started = startStaging({
      ...installed,
      automationBuffer: {
        ...installed.automationBuffer,
        ownedLevelId: "systemScheduler",
        departureLevelId: "systemScheduler",
      },
    });
    const oneShotAdvance = advanceGame(started, 6_000, "foreground");
    const oneShot = oneShotAdvance.state;
    let chunked = started;
    for (let index = 0; index < 60; index += 1) {
      chunked = advanceGame(chunked, 100, "foreground").state;
    }
    const offline = advanceGame(started, 6_000, "offline").state;

    expect(chunked.workshop.completedStorageWorkloads).toBe(1);
    expect(chunked.workshop).toEqual(oneShot.workshop);
    expect(chunked.exactResources).toEqual(oneShot.exactResources);
    expect(offline.workshop).toEqual(oneShot.workshop);
    expect(amountCompare(offline.exactResources.credits, oneShot.exactResources.credits)).toBe(0);
    expect(offline.exactResources.data).toBe(oneShot.exactResources.data);
    expect(oneShotAdvance.intervalReport.creditsEarned).toBe(
      workshopStorageWorkloadDefinition.plan.reward.credits,
    );
    expect(oneShotAdvance.intervalReport.dataEarned).toBe(
      workshopStorageWorkloadDefinition.plan.reward.data,
    );
    expect(oneShotAdvance.intervalReport.completionEvents).toContainEqual(
      expect.objectContaining({
        source: "workshop-storage",
        workId: "artifactStaging",
        completionCount: 1,
        creditsEarned: workshopStorageWorkloadDefinition.plan.reward.credits,
      }),
    );
  });

  it("does not let blocked storage on one system suppress safe offline work elsewhere", () => {
    let state = createStorageReadyState(2);
    state = applyAction(state, {
      type: "installWorkshopStorage",
      skuId: "localSsd",
      systemId: 2,
    });
    state = applyAction(state, {
      type: "startWorkshopStorageWorkload",
      workloadId: "artifactStaging",
      systemId: 2,
    });
    state = applyAction(state, { type: "selectSystem", systemId: 1 });
    state = replaceSystems(
      state,
      state.systems.map((system) =>
        system.id === 2
          ? {
              ...system,
              power: {
                ...system.power,
                state: "off",
                transitionSeconds: 0,
                transitionTotalSeconds: 0,
              },
            }
          : system,
      ),
      1,
    );
    state = {
      ...state,
      automationBuffer: {
        ...state.automationBuffer,
        ownedLevelId: "systemScheduler",
        departureLevelId: "systemScheduler",
      },
    };
    state = applyAction(state, { type: "startTask", taskId: "fetchBit", systemId: 1 });

    const result = advanceGame(state, 2_000, "offline");
    expect(result.state.completedTasks.fetchBit).toBe(1);
    expect(
      result.state.systems.find((system) => system.id === 2)?.workshop
        .activeStorageWorkload,
    ).not.toBeNull();
    expect(result.intervalReport.productiveMs).toBe(2_000);
  });

  it("round-trips valid per-system storage and normalizes corrupt saved fields", () => {
    const valid = startStaging(installLocalStorage(createStorageReadyState(2)));
    const restored = deserializeSave(serializeSave(valid, 1_000));
    expect(restored.workshop.storageSkuId).toBe("localSsd");
    expect(restored.workshop.activeStorageWorkload?.runtime.remainingWork).toEqual(
      valid.workshop.activeStorageWorkload?.runtime.remainingWork,
    );
    expect(restored.systems.find((system) => system.id === 2)?.workshop.storageSkuId).toBe(
      "storageNone",
    );

    const envelope = JSON.parse(serializeSave(valid, 2_000)) as { state: GameState };
    const corrupt = {
      ...envelope.state.workshop,
      storageSkuId: "quantumTape",
      completedStorageWorkloads: -4,
      activeStorageWorkload: {
        definitionId: "unknown",
        runtime: { remainingWork: { storageRead: "broken" } },
      },
    };
    (envelope.state as unknown as { workshop: unknown }).workshop = corrupt;
    const selected = envelope.state.systems.find(
      (system) => system.id === envelope.state.selectedSystemId,
    );
    if (selected) (selected as unknown as { workshop: unknown }).workshop = corrupt;
    const normalized = deserializeSave(JSON.stringify(envelope));
    expect(normalized.workshop.storageSkuId).toBe("storageNone");
    expect(normalized.workshop.activeStorageWorkload).toBeNull();
    expect(normalized.workshop.completedStorageWorkloads).toBe(0);
    expect(
      normalized.infrastructure.fleetNodes.find(
        (node) => node.source.kind === "system" && node.source.systemId === 1,
      )?.storageSkuId,
    ).toBe("storageNone");
  });
});
