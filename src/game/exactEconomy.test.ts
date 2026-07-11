import { describe, expect, it } from "vitest";
import {
  amount,
  amountAdd,
  amountDivide,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  exactCost,
  exactResourceBag,
  sumAmounts,
  type Amount,
} from "./amount";
import { advanceGame } from "./advance";
import { acceptContract, advanceContracts } from "./contracts";
import {
  addExactRewards,
  spendExact,
  syncExactResources,
  withExactResources,
} from "./economy";
import { getMachineSelectionCost, getMachineTemplate } from "./content/machines";
import { getPowerCostPerSecond } from "./math";
import {
  createInitialGameState,
  createRamStickState,
  syncHardwarePackages,
} from "./progression";
import { advanceProjects, startProjectPhase } from "./projects";
import { syncSelectedSystemRuntime } from "./systems";
import { deserializeSave, serializeSave } from "./save";
import { deriveVisibleState } from "./selectors";
import { applyAction, tickGame } from "./simulation";
import type { ContractOfferState, GameState, ResourceId } from "./types";

const HUGE = amount("1e309");

const hugeState = (state = createInitialGameState()) =>
  withExactResources(state, exactResourceBag(HUGE, HUGE));

const sumNumericCosts = (
  costs: ReadonlyArray<{ resource: ResourceId; amount: Amount | number }>,
  resource: ResourceId,
) =>
  sumAmounts(
    costs
      .filter((cost) => cost.resource === resource)
      .map((cost) => cost.amount),
  );

const expectConservation = (
  before: GameState,
  after: GameState,
  earnedCredits: string,
  spentCredits: string,
  earnedData: string,
  spentData: string,
) => {
  expect(after.exactResources.credits).toBe(
    amountSubtract(
      amountAdd(before.exactResources.credits, earnedCredits),
      spentCredits,
    ),
  );
  expect(after.exactResources.data).toBe(
    amountSubtract(amountAdd(before.exactResources.data, earnedData), spentData),
  );
};

const testOffer = (): ContractOfferState => ({
  id: "exact-contract",
  templateId: "ledgerAudit",
  kind: "sustained",
  name: "Exact Ledger Audit",
  description: "Exercises automatic exact rewards.",
  systemId: 1,
  workRequiredMs: 1_000,
  expiresAtMs: 60_000,
  rewards: exactResourceBag("12.5", "2.25"),
  novel: true,
});

describe("exact economy phase A", () => {
  it("keeps 1e309 rewards exact while projecting finite compatibility numbers", () => {
    const before = hugeState();
    const after = addExactRewards(before, exactResourceBag("1.25", "2.5"));

    expect(after.exactResources.credits).toBe(amountAdd(HUGE, "1.25"));
    expect(after.exactResources.data).toBe(amountAdd(HUGE, "2.5"));
    expect(after.resources.credits).toBe(Number.MAX_VALUE);
    expect(after.resources.data).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(after.resources.credits)).toBe(true);
    expect(Number.isFinite(after.resources.data)).toBe(true);
  });

  it("aggregates exact spends before affordability checks at 1e309", () => {
    const before = hugeState();
    const spent = spendExact(before, [
      exactCost("credits", "1e308"),
      exactCost("credits", "1e308"),
      exactCost("data", "2e308"),
    ]);

    expect(spent.exactResources.credits).toBe(amount("8e308"));
    expect(spent.exactResources.data).toBe(amount("8e308"));

    const cannotAffordAggregate = spendExact(
      withExactResources(before, exactResourceBag(10, 10)),
      [exactCost("credits", 6), exactCost("credits", 6)],
    );
    expect(cannotAffordAggregate.exactResources.credits).toBe("10");
  });

  it("bills 1e309 balances exactly and invariantly across elapsed-time chunks", () => {
    const before = hugeState({
      ...createInitialGameState(),
      power: {
        ...createInitialGameState().power,
        bootstrapGraceSeconds: 0,
      },
    });
    const rate = amount(getPowerCostPerSecond(before));
    const expectedCost = amountMultiply(rate, amountDivide(10_000, 1_000));
    const oneShot = tickGame(before, 10_000);
    let chunked = before;
    for (let index = 0; index < 10; index += 1) {
      chunked = tickGame(chunked, 1_000);
    }

    expect(amountSubtract(before.exactResources.credits, oneShot.exactResources.credits)).toBe(
      expectedCost,
    );
    expect(chunked.exactResources).toEqual(oneShot.exactResources);
    expect(chunked.resources).toEqual(oneShot.resources);
  });

  it("uses exact authority for upgrades, downgrade refunds, and research costs", () => {
    const before = hugeState();
    const upgraded = applyAction(before, {
      type: "buyUpgrade",
      upgradeId: "cache",
      cpuId: 1,
    });
    const downgraded = applyAction(upgraded, {
      type: "downgradeUpgrade",
      upgradeId: "cache",
      cpuId: 1,
    });

    expectConservation(before, upgraded, "0", "3", "0", "1");
    expectConservation(upgraded, downgraded, "1", "0", "0", "0");

    const researchReady = hugeState({
      ...createInitialGameState(),
      completedTasks: { fetchBit: 1 },
    });
    const researched = applyAction(researchReady, {
      type: "buyResearch",
      researchId: "decodeLogic",
    });
    expect(researched.research.completed).toContain("decodeLogic");
    expectConservation(researchReady, researched, "0", "3", "0", "0");
  });

  it("conserves exact balances through machine purchase and sale refunds", () => {
    const template = getMachineTemplate("compileBox");
    const costs = getMachineSelectionCost(template.components);
    const purchaseReady = hugeState({
      ...createInitialGameState(),
      flags: { ...createInitialGameState().flags, systemCatalog: true },
      research: {
        completed: ["systemCatalog", "cpuTierKhz", "cpuTierMhz"],
        clickRateLevel: 0,
      },
    });
    const purchased = applyAction(purchaseReady, {
      type: "buyMachineTemplate",
      templateId: template.id,
    });
    const sold = applyAction(purchased, { type: "sellSystem", systemId: 2 });
    const creditCost = sumNumericCosts(costs, "credits");
    const dataCost = sumNumericCosts(costs, "data");
    const creditRefund = amount(Math.floor(Number(creditCost) * 0.5));
    const dataRefund = amount(Math.floor(Number(dataCost) * 0.5));

    expect(purchased.systems).toHaveLength(2);
    expectConservation(purchaseReady, purchased, "0", creditCost, "0", dataCost);
    expect(sold.systems).toHaveLength(1);
    expectConservation(purchased, sold, creditRefund, "0", dataRefund, "0");
  });

  it("conserves exact task, contract, project, and dev-grant changes", () => {
    const taskBefore = applyAction(hugeState(), {
      type: "startTask",
      taskId: "fetchBit",
    });
    const fetchDurationMs = deriveVisibleState(taskBefore).tasks.find(
      (task) => task.id === "fetchBit",
    )!.projection.durationMs;
    const taskAdvance = advanceGame(
      taskBefore,
      fetchDurationMs,
      "foreground",
    );
    expect(taskAdvance.state.completedTasks.fetchBit).toBe(1);
    expectConservation(
      taskBefore,
      taskAdvance.state,
      taskAdvance.report.creditsEarned,
      taskAdvance.report.creditsSpent,
      taskAdvance.report.dataEarned,
      taskAdvance.report.dataSpent,
    );

    const contractBefore = hugeState();
    const accepted = acceptContract(
      {
        ...contractBefore,
        contracts: { ...contractBefore.contracts, offers: [testOffer()] },
      },
      "exact-contract",
    );
    const contractAfter = advanceContracts(accepted, 1_000);
    expectConservation(accepted, contractAfter, "12.5", "0", "2.25", "0");

    // Scheduler Integration needs the Coherent Machine chapter, System
    // Scheduler research, and a RAM lane; at 1/1/1 hardware rates its
    // 300-unit first phase (cache 60 + RAM 60 + compute 180) takes 300s.
    const projectInitial = createInitialGameState();
    const projectBefore = hugeState(
      syncSelectedSystemRuntime({
        ...syncHardwarePackages({
          ...projectInitial,
          hardware: {
            ...projectInitial.hardware,
            ramSticks: [createRamStickState(1, 1, 1)],
          },
        }),
        campaign: {
          ...projectInitial.campaign,
          currentChapterId: "coherentMachine",
        },
        research: {
          ...projectInitial.research,
          completed: [...projectInitial.research.completed, "systemScheduler"],
        },
      }),
    );
    const projectStarted = startProjectPhase(
      projectBefore,
      "schedulerIntegration",
      1,
    );
    expectConservation(projectBefore, projectStarted, "0", "200", "0", "0");
    const projectAfter = advanceProjects(projectStarted, 300_000);
    expectConservation(projectStarted, projectAfter, "300", "0", "18", "0");

    const grantAfter = addExactRewards(hugeState(), {
      credits: "100000000000",
      data: "0",
    });
    expectConservation(
      hugeState(),
      grantAfter,
      amount("100000000000"),
      "0",
      "0",
      "0",
    );
  });

  it("zeros both exact authority and projection on an unpaid billing overrun", () => {
    const initial = createInitialGameState();
    const rate = getPowerCostPerSecond(initial);
    const before = withExactResources(
      {
        ...initial,
        flags: { ...initial.flags, psuManagement: true },
        research: { ...initial.research, completed: ["psuManagement"] },
        power: { ...initial.power, bootstrapGraceSeconds: 0 },
      },
      exactResourceBag(amountDivide(rate, 2), 0),
    );
    const after = tickGame(before, 1_000);

    expect(after.exactResources.credits).toBe("0");
    expect(after.resources.credits).toBe(0);
    expect(after.power.unpaidShutdownWarningSeconds).toBeGreaterThan(0);
  });

  it("round-trips 1e309 authority and confines direct numeric overrides to saving", () => {
    const before = hugeState();
    const restored = deserializeSave(serializeSave(before, 123_456));
    expect(restored.exactResources).toEqual(before.exactResources);
    expect(restored.resources).toEqual({
      credits: Number.MAX_VALUE,
      data: Number.MAX_VALUE,
    });

    const legacyOverride = deserializeSave(
      serializeSave({
        ...createInitialGameState(),
        resources: { credits: 123, data: 456 },
      }),
    );
    expect(legacyOverride.exactResources).toEqual(exactResourceBag(123, 456));

    const unsafeOverride = deserializeSave(
      serializeSave({
        ...createInitialGameState(),
        resources: { credits: Number.POSITIVE_INFINITY, data: Number.NaN },
      }),
    );
    expect(unsafeOverride.exactResources).toEqual(exactResourceBag(10, 0));
    expect(Number.isFinite(unsafeOverride.resources.credits)).toBe(true);
    expect(Number.isFinite(unsafeOverride.resources.data)).toBe(true);
  });

  it("ignores direct numeric writes during runtime even when exact projections saturate", () => {
    const before = hugeState();
    const staleProjection: GameState = {
      ...before,
      resources: { credits: 0, data: Number.MAX_VALUE },
    };
    const after = applyAction(staleProjection, {
      type: "selectSystem",
      systemId: staleProjection.selectedSystemId,
    });

    expect(after.exactResources.credits).toBe(
      HUGE,
    );
    expect(after.exactResources.data).toBe(HUGE);
    expect(after.resources.credits).toBe(Number.MAX_VALUE);
    expect(after.resources.data).toBe(Number.MAX_VALUE);
    expect(syncExactResources(staleProjection).exactResources).toEqual(
      before.exactResources,
    );
  });

  it("rejects unsafe amount and economy inputs instead of creating Infinity", () => {
    const before = hugeState();
    expect(() => amount(Number.POSITIVE_INFINITY)).toThrow("Invalid amount");
    expect(() => amount(Number.NaN)).toThrow("Invalid amount");
    expect(() => addExactRewards(before, { credits: "Infinity", data: "0" })).toThrow(
      "Invalid amount",
    );
    expect(() => spendExact(before, [exactCost("credits", -1)])).toThrow(
      "non-negative",
    );
    expect(() => tickGame(before, Number.POSITIVE_INFINITY)).toThrow("finite");
    expect(amountToSafeNumber(HUGE)).toBe(Number.MAX_VALUE);
  });
});
