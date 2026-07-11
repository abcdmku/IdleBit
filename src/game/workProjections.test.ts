import { describe, expect, it } from "vitest";
import {
  amount,
  amountDivide,
  amountMultiply,
  amountSubtract,
  exactResourceBag,
} from "./amount";
import {
  advanceCapacityWork,
  createCapacityWorkRuntime,
  normalizeCapacityWorkPlan,
  normalizeCapacityWorkRuntime,
  type CapacityWorkPlan,
  type CapacityWorkRuntime,
} from "./capacityWork";
import { createRateVector } from "./weightedFair";
import {
  MIN_PROJECTED_MARGIN_BPS,
  createWorkProjectionConditions,
  projectCapacityWorkPlan,
  projectCapacityWorkRuntime,
} from "./workProjections";

const workPlan = (
  work: Parameters<typeof createRateVector>[0],
  options: {
    memoryBits?: string | number;
    storageBits?: string | number;
    credits?: string | number;
  } = {},
): CapacityWorkPlan =>
  normalizeCapacityWorkPlan({
    id: "projected-work",
    work: createRateVector(work),
    memoryBits: amount(options.memoryBits ?? 10),
    storageBits: amount(options.storageBits ?? 20),
    reward: exactResourceBag(options.credits ?? 100, 5),
  });

const conditions = (input: {
  rates?: Parameters<typeof createRateVector>[0];
  memoryBits?: string | number;
  storageBits?: string | number;
  costPerSecond?: string | number;
  bufferMs?: string | number;
} = {}) =>
  createWorkProjectionConditions({
    allocatedRates: input.rates,
    memoryBits: input.memoryBits ?? 1_000,
    storageBits: input.storageBits ?? 1_000,
    operatingCreditsPerSecond: input.costPerSecond ?? 0,
    automationBufferMs: input.bufferMs ?? 1_000_000,
  });

describe("exact player-facing capacity-work projections", () => {
  it("projects duration, operating cost, net credits, and margin exactly", () => {
    const projection = projectCapacityWorkPlan(
      workPlan({ compute: 100, storageRead: 50 }),
      conditions({
        rates: { compute: 20, storageRead: 5 },
        costPerSecond: 2,
        bufferMs: 10_000,
      }),
    );

    expect(projection.durationMs).toBe("10000");
    expect(projection.operatingCost).toBe("20");
    expect(projection.netCreditReward).toBe("80");
    expect(projection.exactMarginBps).toBe("8000");
    expect(projection.marginBps).toBe(8_000);
    expect(projection.isProfitable).toBe(true);
    expect(projection.meetsRecommendedMargin).toBe(true);
    expect(projection.fits).toBe(true);
    expect(projection.bufferCovered).toBe(true);
    expect(projection.bufferShortfallMs).toBe("0");
    expect(projection.pauseReason).toBeNull();
  });

  it("returns stable rate blockers instead of inventing a duration at zero rate", () => {
    const projection = projectCapacityWorkPlan(
      workPlan({ compute: 100, storageRead: 50 }),
      conditions({ rates: {} }),
    );

    expect(projection.durationMs).toBeNull();
    expect(projection.operatingCost).toBeNull();
    expect(projection.netCreditReward).toBeNull();
    expect(projection.blockers).toEqual([
      "rate:compute",
      "rate:storageRead",
    ]);
    expect(projection.pauseReason).toBe("rate:compute");
    expect(projection.bufferCovered).toBe(false);
  });

  it("uses stable fit-before-rate blocker precedence", () => {
    const projection = projectCapacityWorkPlan(
      workPlan(
        { compute: 10 },
        { memoryBits: 100, storageBits: 200 },
      ),
      conditions({ rates: {}, memoryBits: 99, storageBits: 199 }),
    );

    expect(projection.fits).toBe(false);
    expect(projection.blockers).toEqual([
      "memory-fit",
      "storage-fit",
      "rate:compute",
    ]);
    expect(projection.pauseReason).toBe("memory-fit");
  });

  it("reports unprofitable work without treating economics as a pause", () => {
    const projection = projectCapacityWorkPlan(
      workPlan({ compute: 10 }, { credits: 10 }),
      conditions({
        rates: { compute: 1 },
        costPerSecond: 2,
        bufferMs: 10_000,
      }),
    );

    expect(projection.operatingCost).toBe("20");
    expect(projection.netCreditReward).toBe("-10");
    expect(projection.exactMarginBps).toBe("-10000");
    expect(projection.marginBps).toBe(-10_000);
    expect(projection.isProfitable).toBe(false);
    expect(projection.meetsRecommendedMargin).toBe(false);
    expect(projection.pauseReason).toBeNull();
  });

  it("uses an exact inclusive 30% recommended-margin boundary", () => {
    const source = workPlan({ compute: 10 }, { credits: 100 });
    const exact = projectCapacityWorkPlan(
      source,
      conditions({
        rates: { compute: 1 },
        costPerSecond: 7,
        bufferMs: 10_000,
      }),
    );
    const below = projectCapacityWorkPlan(
      source,
      conditions({
        rates: { compute: 1 },
        costPerSecond: "7.001",
        bufferMs: 10_000,
      }),
    );

    expect(exact.netCreditReward).toBe("30");
    expect(exact.exactMarginBps).toBe("3000");
    expect(exact.meetsRecommendedMargin).toBe(true);
    expect(below.netCreditReward).toBe("29.99");
    expect(below.exactMarginBps).toBe("2999");
    expect(below.meetsRecommendedMargin).toBe(false);
  });

  it("reports exact Automation Buffer coverage and shortfall", () => {
    const source = workPlan({ compute: 10 });
    const short = projectCapacityWorkPlan(
      source,
      conditions({ rates: { compute: 1 }, bufferMs: 9_999 }),
    );
    const exact = projectCapacityWorkPlan(
      source,
      conditions({ rates: { compute: 1 }, bufferMs: 10_000 }),
    );

    expect(short.bufferCovered).toBe(false);
    expect(short.bufferShortfallMs).toBe("1");
    expect(short.pauseReason).toBe("automation-buffer");
    expect(exact.bufferCovered).toBe(true);
    expect(exact.bufferShortfallMs).toBe("0");
    expect(exact.pauseReason).toBeNull();
  });

  it("keeps huge work, cost, reward, and net projection exact", () => {
    const projection = projectCapacityWorkPlan(
      workPlan(
        { compute: "2e309" },
        {
          memoryBits: "1e309",
          storageBits: "1e309",
          credits: "3e309",
        },
      ),
      conditions({
        rates: { compute: "1e309" },
        memoryBits: "1e309",
        storageBits: "1e309",
        costPerSecond: "5e308",
        bufferMs: 2_000,
      }),
    );

    expect(projection.durationMs).toBe("2000");
    expect(projection.operatingCost).toBe(amount("1e309"));
    expect(projection.netCreditReward).toBe(amount("2e309"));
    expect(projection.exactMarginBps).toBe(
      amountDivide(amountMultiply("2e309", 10_000), "3e309"),
    );
    expect(projection.marginBps).toBe(6_667);
    expect(projection.meetsRecommendedMargin).toBe(true);
  });

  it("bounds only the numeric margin projection for extreme losses", () => {
    const projection = projectCapacityWorkPlan(
      workPlan({ compute: 1 }, { credits: 1 }),
      conditions({
        rates: { compute: 1 },
        costPerSecond: "1e309",
        bufferMs: 1_000,
      }),
    );

    expect(projection.netCreditReward).toBe(amountSubtract(1, "1e309"));
    expect(projection.marginBps).toBe(MIN_PROJECTED_MARGIN_BPS);
    expect(projection.exactMarginBps).not.toBe(
      amount(MIN_PROJECTED_MARGIN_BPS),
    );
  });

  it("matches actual remaining runtime completion and cost", () => {
    const sourcePlan = workPlan({ compute: 100 });
    const rates = createRateVector({ compute: 10 });
    const fitCapacity = { memoryBits: amount(1_000), storageBits: amount(1_000) };
    const started = advanceCapacityWork(
      createCapacityWorkRuntime(sourcePlan),
      rates,
      fitCapacity,
      4_000,
    );
    const saved = normalizeCapacityWorkRuntime(
      JSON.parse(JSON.stringify(started.runtime)) as CapacityWorkRuntime,
    );
    const projection = projectCapacityWorkRuntime(
      saved,
      conditions({
        rates: { compute: 10 },
        costPerSecond: 3,
        bufferMs: 6_000,
      }),
    );
    const actual = advanceCapacityWork(
      saved,
      rates,
      fitCapacity,
      projection.durationMs!,
    );

    expect(projection.durationMs).toBe("6000");
    expect(projection.operatingCost).toBe("18");
    expect(projection.netCreditReward).toBe("82");
    expect(actual.advancedMs).toBe(projection.durationMs);
    expect(actual.runtime.completed).toBe(true);
    expect(actual.workConsumed.compute).toBe("60");
    expect(actual.reward).toEqual(sourcePlan.reward);
  });

  it("projects no future cost or reward for already completed runtime", () => {
    const sourcePlan = workPlan({ compute: 10 });
    const rates = createRateVector({ compute: 10 });
    const fitCapacity = { memoryBits: amount(1_000), storageBits: amount(1_000) };
    const completed = advanceCapacityWork(
      createCapacityWorkRuntime(sourcePlan),
      rates,
      fitCapacity,
      1_000,
    );
    const projection = projectCapacityWorkRuntime(
      completed.runtime,
      conditions({
        rates: { compute: 10 },
        costPerSecond: 100,
        bufferMs: 0,
      }),
    );

    expect(projection.durationMs).toBe("0");
    expect(projection.operatingCost).toBe("0");
    expect(projection.netCreditReward).toBe("0");
    expect(projection.pauseReason).toBe("completed");
    expect(projection.bufferCovered).toBe(true);
  });

  it("gives initial plan and initial runtime identical projections", () => {
    const sourcePlan = workPlan({ compute: 25 });
    const projectionConditions = conditions({
      rates: { compute: 5 },
      costPerSecond: 2,
      bufferMs: 5_000,
    });

    expect(projectCapacityWorkPlan(sourcePlan, projectionConditions)).toEqual(
      projectCapacityWorkRuntime(
        createCapacityWorkRuntime(sourcePlan),
        projectionConditions,
      ),
    );
  });
});
