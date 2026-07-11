import { describe, expect, it } from "vitest";
import {
  amount,
  amountAdd,
  amountSubtract,
  exactResourceBag,
} from "./amount";
import {
  advanceCapacityWork,
  capacityWorkFits,
  createCapacityWorkRuntime,
  getCapacityWorkFitBlockers,
  getNextCapacityWorkEventMs,
  normalizeCapacityWorkPlan,
  normalizeCapacityWorkRuntime,
  type CapacityWorkFitCapacity,
  type CapacityWorkPlan,
  type CapacityWorkRuntime,
} from "./capacityWork";
import {
  addRateVectors,
  createRateVector,
} from "./weightedFair";

const fitCapacity = (
  memoryBits: string | number = 1_000,
  storageBits: string | number = 1_000,
): CapacityWorkFitCapacity => ({
  memoryBits: amount(memoryBits),
  storageBits: amount(storageBits),
});

const plan = (
  work: Parameters<typeof createRateVector>[0],
  options: {
    memoryBits?: string | number;
    storageBits?: string | number;
    credits?: string | number;
    data?: string | number;
  } = {},
): CapacityWorkPlan =>
  normalizeCapacityWorkPlan({
    id: "capacity-work",
    work: createRateVector(work),
    memoryBits: amount(options.memoryBits ?? 10),
    storageBits: amount(options.storageBits ?? 20),
    reward: exactResourceBag(options.credits ?? 100, options.data ?? 5),
  });

describe("exact capacity-work plan and admission", () => {
  it("normalizes exact plan/runtime state into a JSON-safe canonical form", () => {
    const malformedPlan: CapacityWorkPlan = {
      id: "repair",
      work: {
        ...createRateVector(),
        compute: amount(-10),
        storageRead: amount(25),
      },
      memoryBits: amount(-1),
      storageBits: amount(5),
      reward: exactResourceBag(10, 2),
    };
    const normalizedPlan = normalizeCapacityWorkPlan(malformedPlan);
    const initial = createCapacityWorkRuntime(normalizedPlan);
    const loaded = normalizeCapacityWorkRuntime(
      JSON.parse(JSON.stringify(initial)) as CapacityWorkRuntime,
    );

    expect(normalizedPlan.work.compute).toBe("0");
    expect(normalizedPlan.work.storageRead).toBe("25");
    expect(normalizedPlan.memoryBits).toBe("0");
    expect(loaded).toEqual(initial);
  });

  it("checks memory and storage fit exactly at and beyond Number scale", () => {
    const huge = plan(
      { compute: 1 },
      { memoryBits: "1e309", storageBits: "2e309" },
    );
    const exactFit = fitCapacity("1e309", "2e309");
    const short = fitCapacity(amountSubtract("1e309", 1), "1e309");

    expect(capacityWorkFits(huge, exactFit)).toBe(true);
    expect(capacityWorkFits(huge, short)).toBe(false);
    expect(getCapacityWorkFitBlockers(huge, short)).toEqual([
      "memory-fit",
      "storage-fit",
    ]);
  });
});

describe("capacity-work event runtime", () => {
  it("tracks every remaining dimension and exposes the exact next boundary", () => {
    const runtime = createCapacityWorkRuntime(
      plan({ compute: 100, storageRead: 50 }),
    );
    const rates = createRateVector({ compute: 20, storageRead: 5 });
    const firstEvent = getNextCapacityWorkEventMs(
      runtime,
      rates,
      fitCapacity(),
    );
    const first = advanceCapacityWork(runtime, rates, fitCapacity(), 5_000);

    expect(firstEvent).toBe("5000");
    expect(first.runtime.remainingWork.compute).toBe("0");
    expect(first.runtime.remainingWork.storageRead).toBe("25");
    expect(first.runtime.completed).toBe(false);
    expect(first.reward).toEqual(exactResourceBag());
    expect(
      getNextCapacityWorkEventMs(first.runtime, rates, fitCapacity()),
    ).toBe("5000");
  });

  it("commits completion and exact reward atomically once", () => {
    const runtime = createCapacityWorkRuntime(
      plan(
        { compute: 100, storageRead: 50 },
        { credits: 123, data: 45 },
      ),
    );
    const rates = createRateVector({ compute: 20, storageRead: 5 });
    const completed = advanceCapacityWork(
      runtime,
      rates,
      fitCapacity(),
      10_000,
    );
    const replay = advanceCapacityWork(
      completed.runtime,
      rates,
      fitCapacity(),
      10_000,
    );

    expect(completed.completed).toBe(true);
    expect(completed.runtime.status).toBe("completed");
    expect(completed.runtime.rewardIssued).toBe(true);
    expect(completed.reward).toEqual(exactResourceBag(123, 45));
    expect(replay.completed).toBe(false);
    expect(replay.advancedMs).toBe("0");
    expect(replay.reward).toEqual(exactResourceBag());
  });

  it("safely pauses zero-capacity work without losing progress", () => {
    const runtime = createCapacityWorkRuntime(plan({ compute: 100 }));
    const rates = createRateVector();
    const paused = advanceCapacityWork(
      runtime,
      rates,
      fitCapacity(),
      3_600_000,
    );

    expect(paused.runtime.remainingWork.compute).toBe("100");
    expect(paused.runtime.elapsedMs).toBe("3600000");
    expect(paused.runtime.status).toBe("paused");
    expect(paused.runtime.blockers).toEqual(["rate:compute"]);
    expect(paused.workConsumed).toEqual(createRateVector());
    expect(paused.reward).toEqual(exactResourceBag());
    expect(getNextCapacityWorkEventMs(runtime, rates, fitCapacity())).toBeNull();
  });

  it("allows independent dimensions to progress while another is blocked", () => {
    const runtime = createCapacityWorkRuntime(
      plan({ compute: 10, storageWrite: 10 }),
    );
    const partial = advanceCapacityWork(
      runtime,
      createRateVector({ compute: 10 }),
      fitCapacity(),
      1_000,
    );

    expect(partial.runtime.remainingWork.compute).toBe("0");
    expect(partial.runtime.remainingWork.storageWrite).toBe("10");
    expect(partial.runtime.blockers).toEqual(["rate:storageWrite"]);
    expect(partial.runtime.status).toBe("paused");
    expect(partial.workConsumed.compute).toBe("10");
    expect(partial.reward).toEqual(exactResourceBag());
  });

  it("uses memory/storage misfit as a global safe pause and resumes later", () => {
    const runtime = createCapacityWorkRuntime(
      plan({ compute: 10 }, { memoryBits: 100, storageBits: 100 }),
    );
    const rates = createRateVector({ compute: 10 });
    const blocked = advanceCapacityWork(
      runtime,
      rates,
      fitCapacity(99, 100),
      10_000,
    );
    const resumed = advanceCapacityWork(
      blocked.runtime,
      rates,
      fitCapacity(100, 100),
      1_000,
    );

    expect(blocked.runtime.remainingWork.compute).toBe("10");
    expect(blocked.runtime.blockers).toEqual(["memory-fit"]);
    expect(blocked.runtime.elapsedMs).toBe("10000");
    expect(resumed.runtime.completed).toBe(true);
    expect(resumed.runtime.elapsedMs).toBe("11000");
    expect(resumed.reward).toEqual(exactResourceBag(100, 5));
  });

  it("is invariant to delta partitioning and a mid-work save round-trip", () => {
    const initial = createCapacityWorkRuntime(
      plan({ compute: 30, storageRead: 60, networkEgress: 20 }),
    );
    const rates = createRateVector({
      compute: 3,
      storageRead: 6,
      networkEgress: 2,
    });
    const single = advanceCapacityWork(
      initial,
      rates,
      fitCapacity(),
      10_000,
    );
    let chunkedRuntime = initial;
    let chunkedReward = exactResourceBag();
    let chunkedConsumed = createRateVector();
    for (const delta of [1_234, 2_345, 6_421]) {
      const result = advanceCapacityWork(
        chunkedRuntime,
        rates,
        fitCapacity(),
        delta,
      );
      chunkedRuntime = normalizeCapacityWorkRuntime(
        JSON.parse(JSON.stringify(result.runtime)) as CapacityWorkRuntime,
      );
      chunkedReward = exactResourceBag(
        amountAdd(chunkedReward.credits, result.reward.credits),
        amountAdd(chunkedReward.data, result.reward.data),
      );
      chunkedConsumed = addRateVectors(
        chunkedConsumed,
        result.workConsumed,
      );
    }

    expect(chunkedRuntime).toEqual(single.runtime);
    expect(chunkedReward).toEqual(single.reward);
    expect(chunkedConsumed).toEqual(single.workConsumed);
  });

  it("settles repeating-decimal event times without residual work", () => {
    const runtime = createCapacityWorkRuntime(plan({ compute: 1 }));
    const rates = createRateVector({ compute: 3 });
    const eventMs = getNextCapacityWorkEventMs(
      runtime,
      rates,
      fitCapacity(),
    )!;
    const result = advanceCapacityWork(
      runtime,
      rates,
      fitCapacity(),
      eventMs,
    );

    expect(result.runtime.remainingWork.compute).toBe("0");
    expect(result.runtime.completed).toBe(true);
    expect(result.workConsumed.compute).toBe("1");
  });

  it("keeps work, event timing, and rewards exact beyond Number range", () => {
    const runtime = createCapacityWorkRuntime(
      plan(
        { compute: "2e309", networkIngress: "1e309" },
        {
          memoryBits: "1e309",
          storageBits: "1e309",
          credits: "1e309",
          data: "2e309",
        },
      ),
    );
    const rates = createRateVector({
      compute: "1e309",
      networkIngress: "5e308",
    });
    const capacity = fitCapacity("1e309", "1e309");
    const eventMs = getNextCapacityWorkEventMs(runtime, rates, capacity);
    const result = advanceCapacityWork(runtime, rates, capacity, 2_000);

    expect(eventMs).toBe("2000");
    expect(result.runtime.completed).toBe(true);
    expect(result.workConsumed.compute).toBe(amount("2e309"));
    expect(result.workConsumed.networkIngress).toBe(amount("1e309"));
    expect(result.reward).toEqual(exactResourceBag("1e309", "2e309"));
  });

  it("completes zero-work plans at a zero-time boundary and cannot replay", () => {
    const runtime = createCapacityWorkRuntime(plan({}));
    const rates = createRateVector();
    const repairedAtomicState = normalizeCapacityWorkRuntime({
      ...runtime,
      completed: true,
    });

    expect(getNextCapacityWorkEventMs(runtime, rates, fitCapacity())).toBe("0");
    expect(repairedAtomicState.completed).toBe(false);
    const completed = advanceCapacityWork(
      runtime,
      rates,
      fitCapacity(),
      0,
    );
    const replay = advanceCapacityWork(
      completed.runtime,
      rates,
      fitCapacity(),
      0,
    );

    expect(completed.completed).toBe(true);
    expect(completed.reward).toEqual(exactResourceBag(100, 5));
    expect(replay.reward).toEqual(exactResourceBag());
  });

  it("does not let zero-work plans bypass memory/storage admission", () => {
    const runtime = createCapacityWorkRuntime(
      plan({}, { memoryBits: 100, storageBits: 100 }),
    );
    const rates = createRateVector();
    const blockedCapacity = fitCapacity(99, 100);
    const blocked = advanceCapacityWork(runtime, rates, blockedCapacity, 1_000);
    const admitted = advanceCapacityWork(
      blocked.runtime,
      rates,
      fitCapacity(100, 100),
      0,
    );

    expect(getNextCapacityWorkEventMs(runtime, rates, blockedCapacity)).toBeNull();
    expect(blocked.runtime.completed).toBe(false);
    expect(blocked.runtime.blockers).toEqual(["memory-fit"]);
    expect(blocked.reward).toEqual(exactResourceBag());
    expect(admitted.runtime.completed).toBe(true);
    expect(admitted.reward).toEqual(exactResourceBag(100, 5));
  });

  it("normalizes reward-issued saves into non-replayable completion", () => {
    const sourcePlan = plan({ compute: 10 });
    const corrupted: CapacityWorkRuntime = {
      plan: sourcePlan,
      elapsedMs: amount(10),
      remainingWork: createRateVector(sourcePlan.work),
      blockers: ["rate:compute"],
      status: "running",
      completed: false,
      rewardIssued: true,
    };
    const normalized = normalizeCapacityWorkRuntime(corrupted);
    const replay = advanceCapacityWork(
      normalized,
      createRateVector({ compute: 10 }),
      fitCapacity(),
      1_000,
    );

    expect(normalized.remainingWork).toEqual(createRateVector());
    expect(normalized.status).toBe("completed");
    expect(normalized.blockers).toEqual([]);
    expect(replay.reward).toEqual(exactResourceBag());
  });
});
