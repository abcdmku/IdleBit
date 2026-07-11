import { describe, expect, it } from "vitest";
import { amount, amountCompare, exactResourceBag } from "./amount";
import {
  acceptContract,
  advanceContracts,
  CONTRACT_OFFER_PREMIUM_ID,
  contractTemplateDefinitions,
  getContractRemainingMs,
  getContractSystemWorkRate,
  getVisibleContracts,
  normalizeContractMarketState,
  refreshContractMarket,
} from "./contracts";
import {
  createHardwareWorkRecipe,
  createHardwareWorkStage,
  getHardwareWorkTotal,
} from "./hardwareWork";
import {
  createCpuHardwareState,
  createInitialGameState,
  createRamStickState,
  createSystemState,
  syncHardwarePackages,
} from "./progression";
import { replaceSystems } from "./systems";
import { createRngState } from "./rng";
import type { ContractOfferState, GameState } from "./types";
import { getWorkValueCredits } from "./workValue";

const oneBitOffer = (): ContractOfferState => ({
  id: "one-bit",
  templateId: "ledgerAudit",
  kind: "sustained",
  name: "One bit",
  description: "Exact contract timing probe.",
  systemId: 1,
  workRequiredMs: 1_000,
  workRequiredBits: amount(1),
  workRecipe: createHardwareWorkRecipe([
    createHardwareWorkStage("cache", "cache", 1),
  ]),
  expiresAtMs: 60_000,
  rewards: exactResourceBag("1", "0"),
  novel: true,
});

const withOffer = (state: GameState): GameState => ({
  ...state,
  contracts: { ...state.contracts, offers: [oneBitOffer()] },
});

const withHardware = (
  state: GameState,
  hardware: GameState["hardware"],
) => {
  const synchronized = syncHardwarePackages({ ...state, hardware });
  return replaceSystems(
    state,
    [createSystemState(1, "Contract Test", "contract-test", synchronized.hardware)],
    1,
  );
};

describe("contract authored work", () => {
  it("defines no separate per-template Credit price", () => {
    for (const template of contractTemplateDefinitions) {
      expect(template).not.toHaveProperty("baseWorkValueCredits");
      expect(template).not.toHaveProperty("baseRewards");
      expect(amountCompare(getHardwareWorkTotal(template.baseWorkRecipe), 0))
        .toBeGreaterThan(0);
    }
  });

  it("processes one bit in one second on an exact 1 Hz path", () => {
    const initial = withOffer(createInitialGameState());
    expect(amountCompare(getContractSystemWorkRate(initial, 1), 1)).toBe(0);

    const accepted = acceptContract(initial, "one-bit");
    const beforeBoundary = advanceContracts(accepted, 999);
    expect(beforeBoundary.contracts.active).toHaveLength(1);
    expect(amountCompare(
      beforeBoundary.contracts.active[0]!.workCompletedBits ?? 0,
      "0.999",
    )).toBe(0);

    const completed = advanceContracts(beforeBoundary, 1);
    expect(completed.contracts.active).toHaveLength(0);
    expect(completed.contracts.completedContractIds).toContain("one-bit");
  });

  it("scales remaining duration inversely with real core throughput", () => {
    const slow = createInitialGameState();
    const fast = withHardware(slow, {
      ...slow.hardware,
      cpus: [createCpuHardwareState(1, [1, 2])],
    });
    const contract = {
      ...oneBitOffer(),
      workRecipe: createHardwareWorkRecipe([
        createHardwareWorkStage("compute", "compute", 1),
      ]),
      acceptedAtMs: 0,
      workCompletedMs: 0,
      workCompletedBits: amount(0),
    };

    expect(getContractRemainingMs(slow, contract)).toBe(1_000);
    expect(getContractSystemWorkRate(fast, 1)).toBe("2");
    expect(getContractRemainingMs(fast, contract)).toBe(500);
  });

  it("uses cache and RAM component speeds for their authored stages", () => {
    const initial = createInitialGameState();
    const slowRam = withHardware(initial, {
      ...initial.hardware,
      ramSticks: [createRamStickState(1, 1, 1)],
      cpus: [createCpuHardwareState(1, [1], { cacheSpeedLevel: 1 })],
    });
    const fastRamAndCache = withHardware(initial, {
      ...initial.hardware,
      ramSticks: [createRamStickState(1, 1, 2)],
      cpus: [createCpuHardwareState(1, [1], { cacheSpeedLevel: 2 })],
    });
    const staged = {
      ...oneBitOffer(),
      workRecipe: createHardwareWorkRecipe([
        createHardwareWorkStage("cache", "cache", 1),
        createHardwareWorkStage("ram", "ram", 1),
      ]),
      acceptedAtMs: 0,
      workCompletedMs: 0,
      workCompletedUnits: amount(0),
    };

    expect(getContractRemainingMs(fastRamAndCache, staged)).toBeLessThan(
      getContractRemainingMs(slowRam, staged),
    );
  });

  it("keeps a mid-stage cursor when later hardware becomes faster", () => {
    const initial = createInitialGameState();
    const offer = {
      ...oneBitOffer(),
      workRecipe: createHardwareWorkRecipe([
        createHardwareWorkStage("cache", "cache", 1),
        createHardwareWorkStage("compute", "compute", 1),
      ]),
    };
    const accepted = acceptContract({
      ...initial,
      contracts: { ...initial.contracts, offers: [offer] },
    }, offer.id);
    const halfCache = advanceContracts(accepted, 500);
    expect(halfCache.contracts.active[0]!.workStageIndex).toBe(0);
    expect(halfCache.contracts.active[0]!.workStageCompleted).toBe("0.5");

    const fasterCpu = withHardware(halfCache, {
      ...halfCache.hardware,
      cpus: [createCpuHardwareState(1, [1, 2])],
    });
    expect(getContractRemainingMs(fasterCpu, fasterCpu.contracts.active[0]!))
      .toBe(1_000);
  });

  it("converts legacy millisecond progress into the same exact work fraction", () => {
    const normalized = normalizeContractMarketState({
      ...createInitialGameState().contracts,
      active: [{
        ...oneBitOffer(),
        workRequiredBits: undefined,
        acceptedAtMs: 0,
        workCompletedMs: 250,
        workCompletedBits: undefined,
      }],
    });

    expect(amountCompare(normalized.active[0]!.workCompletedBits ?? 0, "0.25")).toBe(0);
    expect(normalized.active[0]!.workStageIndex).toBe(0);
    expect(normalized.active[0]!.workStageCompleted).toBe("0.25");
  });

  it("freezes the same gross payout for the same authored work on faster hardware", () => {
    const slow = createInitialGameState();
    const fast = withHardware(slow, {
      ...slow.hardware,
      cpus: [createCpuHardwareState(1, [1, 2])],
    });
    const slowMarket = refreshContractMarket({
      ...slow,
      flags: { ...slow.flags, cron: true },
      rng: createRngState(77),
    });
    const fastMarket = refreshContractMarket({
      ...fast,
      flags: { ...fast.flags, cron: true },
      rng: createRngState(77),
    });

    expect(fastMarket.contracts.offers.map((offer) => offer.rewards.credits))
      .toEqual(slowMarket.contracts.offers.map((offer) => offer.rewards.credits));
    expect(fastMarket.contracts.offers[0]!.workRequiredMs).toBeLessThan(
      slowMarket.contracts.offers[0]!.workRequiredMs,
    );
    for (const offer of slowMarket.contracts.offers) {
      expect(offer.paidWorkUnits).toBe(getHardwareWorkTotal(offer.workRecipe!));
      expect(offer.workValueMultiplier?.id).toBe(CONTRACT_OFFER_PREMIUM_ID);
      expect(offer.rewards.credits).toBe(
        getWorkValueCredits(
          offer.paidWorkUnits!,
          offer.workValueMultiplier!,
        ),
      );
    }
    const visibleOffer = getVisibleContracts(slowMarket).find(
      (contract) => contract.id === slowMarket.contracts.offers[0]!.id,
    )!;
    expect(visibleOffer.paidWorkUnits).toBe(
      slowMarket.contracts.offers[0]!.paidWorkUnits,
    );
    expect(visibleOffer.offerPremiumBps).toBe(
      slowMarket.contracts.offers[0]!.workValueMultiplier!.basisPoints,
    );
  });

  it("recomputes a legacy saved payout from frozen work and premium BPS", () => {
    const normalized = normalizeContractMarketState({
      offers: [{
        ...oneBitOffer(),
        workRecipe: createHardwareWorkRecipe([
          createHardwareWorkStage("cache", "cache", 2),
        ]),
        workValueMultiplierBps: 17_500,
        rewards: exactResourceBag("999", "7"),
      }],
    });
    const migrated = normalized.offers[0]!;

    expect(migrated.paidWorkUnits).toBe("2");
    expect(migrated.workValueMultiplier).toEqual({
      id: CONTRACT_OFFER_PREMIUM_ID,
      basisPoints: "17500",
    });
    expect(migrated.rewards).toEqual(exactResourceBag("3.5", "7"));
    expect(migrated).not.toHaveProperty("workValueMultiplierBps");

    const initial = createInitialGameState();
    const accepted = acceptContract({
      ...initial,
      contracts: { ...initial.contracts, offers: [{
        ...oneBitOffer(),
        workRecipe: migrated.workRecipe,
        workValueMultiplierBps: 17_500,
        rewards: exactResourceBag("999", "7"),
      }] },
    }, "one-bit");
    const completed = advanceContracts(accepted, 2_000);
    expect(completed.contracts.completedRewards["one-bit"]).toEqual(
      exactResourceBag("3.5", "7"),
    );
  });

  it("derives and freezes an exact premium for saves with only old rewards", () => {
    const normalized = normalizeContractMarketState({
      offers: [{
        ...oneBitOffer(),
        workRecipe: createHardwareWorkRecipe([
          createHardwareWorkStage("cache", "cache", 2),
        ]),
        rewards: exactResourceBag("7", "3"),
      }],
    });
    const migrated = normalized.offers[0]!;

    expect(migrated.workValueMultiplier).toEqual({
      id: CONTRACT_OFFER_PREMIUM_ID,
      basisPoints: "35000",
    });
    expect(migrated.rewards).toEqual(exactResourceBag("7", "3"));
  });
});
