import { describe, expect, it } from "vitest";
import {
  amount,
  amountAdd,
  exactResourceBag,
} from "./amount";
import {
  advanceDistributedWork,
  createDistributedWorkRuntime,
  createShardPipelinePlan,
  getDistributedPlacementRequests,
  getNextDistributedEventMs,
  normalizeDistributedWorkRuntime,
  withDistributedPlacements,
  type DistributedWorkRuntime,
} from "./distributed";
import {
  createPlacementVector,
  placeBestFit,
} from "./placement";
import {
  addRateVectors,
  allocateWeightedMaxMin,
  createRateVector,
} from "./weightedFair";

describe("deterministic multi-resource best-fit placement", () => {
  it("places hardest demands first and is invariant to input ordering", () => {
    const nodes = [
      {
        id: "memory-node",
        capacity: createPlacementVector({ compute: 10, memoryBits: 10 }),
      },
      {
        id: "compute-node",
        capacity: createPlacementVector({ compute: 20, memoryBits: 5 }),
      },
    ];
    const requests = [
      { id: "compute-shard", demand: createPlacementVector({ compute: 12 }) },
      {
        id: "memory-shard",
        demand: createPlacementVector({ compute: 5, memoryBits: 8 }),
      },
    ];

    const first = placeBestFit(nodes, requests);
    const reordered = placeBestFit([...nodes].reverse(), [...requests].reverse());

    expect(first).toEqual(reordered);
    expect(first.assignments).toEqual([
      { requestId: "compute-shard", nodeId: "compute-node" },
      { requestId: "memory-shard", nodeId: "memory-node" },
    ]);
  });

  it("chooses the lexicographically tightest residual and uses IDs for ties", () => {
    const request = {
      id: "shard",
      demand: createPlacementVector({ compute: 9, storageBits: 9 }),
    };
    const tight = placeBestFit(
      [
        {
          id: "roomy",
          capacity: createPlacementVector({ compute: 20, storageBits: 20 }),
        },
        {
          id: "tight",
          capacity: createPlacementVector({ compute: 10, storageBits: 10 }),
        },
      ],
      [request],
    );
    const tied = placeBestFit(
      [
        { id: "z-node", capacity: createPlacementVector({ compute: 10 }) },
        { id: "a-node", capacity: createPlacementVector({ compute: 10 }) },
      ],
      [{ id: "equal", demand: createPlacementVector({ compute: 1 }) }],
    );

    expect(tight.assignments[0]?.nodeId).toBe("tight");
    expect(tied.assignments[0]?.nodeId).toBe("a-node");
  });

  it("keeps exact capacities beyond Number range and reports unplaced work", () => {
    const result = placeBestFit(
      [
        {
          id: "huge",
          capacity: createPlacementVector({
            compute: "3e309",
            networkIngress: 4,
          }),
        },
      ],
      [
        {
          id: "fits",
          demand: createPlacementVector({
            compute: "2e309",
            networkIngress: 4,
          }),
        },
        {
          id: "blocked",
          demand: createPlacementVector({ networkIngress: 1 }),
        },
      ],
    );

    expect(result.assignments).toEqual([
      { requestId: "fits", nodeId: "huge" },
    ]);
    expect(result.unplacedRequestIds).toEqual(["blocked"]);
    expect(result.remainingByNode.huge.compute).toBe(amount("1e309"));
    expect(result.remainingByNode.huge.networkIngress).toBe("0");
  });
});

describe("weighted max-min scheduling", () => {
  it("shares a bottleneck by exact weight", () => {
    const result = allocateWeightedMaxMin(
      createRateVector({ compute: 40 }),
      [
        {
          id: "one",
          demand: createRateVector({ compute: 1 }),
          weight: amount(1),
        },
        {
          id: "three",
          demand: createRateVector({ compute: 1 }),
          weight: amount(3),
        },
      ],
    );

    expect(result.allocationByWorkload.one).toBe("10");
    expect(result.allocationByWorkload.three).toBe("30");
    expect(result.used.compute).toBe("40");
    expect(result.remaining.compute).toBe("0");
  });

  it("progressively fills unaffected work after caps and other bottlenecks", () => {
    const capped = allocateWeightedMaxMin(
      createRateVector({ compute: 10 }),
      [
        {
          id: "capped",
          demand: createRateVector({ compute: 1 }),
          weight: amount(1),
          maxAllocation: amount(2),
        },
        {
          id: "open",
          demand: createRateVector({ compute: 1 }),
          weight: amount(1),
        },
      ],
    );
    const multiResource = allocateWeightedMaxMin(
      createRateVector({ compute: 6, storageRead: 4 }),
      [
        {
          id: "compute-only",
          demand: createRateVector({ compute: 1 }),
          weight: amount(1),
        },
        {
          id: "mixed",
          demand: createRateVector({ compute: 1, storageRead: 1 }),
          weight: amount(1),
        },
        {
          id: "storage-only",
          demand: createRateVector({ storageRead: 1 }),
          weight: amount(1),
        },
      ],
    );

    expect(capped.allocationByWorkload).toEqual({ capped: "2", open: "8" });
    expect(multiResource.allocationByWorkload).toEqual({
      "compute-only": "4",
      mixed: "2",
      "storage-only": "2",
    });
  });

  it("never projects huge exact capacity through Number", () => {
    const result = allocateWeightedMaxMin(
      createRateVector({ compute: "4e309" }),
      [
        {
          id: "a",
          demand: createRateVector({ compute: 1 }),
          weight: amount(1),
        },
        {
          id: "b",
          demand: createRateVector({ compute: 1 }),
          weight: amount(1),
        },
      ],
    );

    expect(result.allocationByWorkload.a).toBe(amount("2e309"));
    expect(result.allocationByWorkload.b).toBe(amount("2e309"));
    expect(result.used.compute).toBe(amount("4e309"));
  });
});

const pipeline = () =>
  createShardPipelinePlan({
    id: "sort-batch",
    shards: [
      {
        id: "shard-b",
        nodeId: "node-b",
        inputBits: 10,
        computeOperations: 10,
        outputBits: 4,
      },
      {
        id: "shard-a",
        nodeId: "node-a",
        inputBits: 10,
        computeOperations: 10,
        outputBits: 4,
      },
    ],
    reduceComputeOperations: 10,
    reduceOutputBits: 2,
    reward: exactResourceBag(100, 7),
  });

const balancedCapacity = () =>
  createRateVector({
    compute: 10,
    storageRead: 10,
    storageWrite: 10,
    networkIngress: 10,
    networkEgress: 10,
  });

describe("saved distributed shard DAG runtime", () => {
  it("exposes placement demands and an exact next-event boundary", () => {
    const plan = pipeline();
    const runtime = createDistributedWorkRuntime(plan);
    const unplacedPlan = {
      ...plan,
      shards: plan.shards.map((shard) => ({ ...shard, nodeId: "" })),
    };
    const placedPlan = withDistributedPlacements(
      unplacedPlan,
      plan.shards.map((shard) => ({
        requestId: shard.id,
        nodeId: shard.nodeId,
      })),
    );

    expect(plan.shards.map((shard) => shard.id)).toEqual([
      "shard-a",
      "shard-b",
    ]);
    expect(getDistributedPlacementRequests(plan).map((request) => request.id)).toEqual([
      "shard-a",
      "shard-b",
    ]);
    expect(placedPlan).toEqual(plan);
    expect(getNextDistributedEventMs(runtime, balancedCapacity())).toBe("2000");
  });

  it("advances exact distributed work beyond Number range", () => {
    const plan = createShardPipelinePlan({
      id: "huge-batch",
      shards: [
        {
          id: "huge-shard",
          nodeId: "huge-node",
          inputBits: "1e309",
          computeOperations: 0,
          outputBits: 0,
        },
      ],
      reduceComputeOperations: 0,
      reduceOutputBits: 0,
      reward: exactResourceBag("1e309", 0),
    });
    const capacity = createRateVector({
      storageRead: "1e309",
      storageWrite: "1e309",
      networkIngress: "1e309",
    });
    const initial = createDistributedWorkRuntime(plan);
    const completed = advanceDistributedWork(initial, capacity, 2000);

    expect(getNextDistributedEventMs(initial, capacity)).toBe("1000");
    expect(completed.runtime.status).toBe("committed");
    expect(completed.reward.credits).toBe(amount("1e309"));
    expect(completed.workConsumed.networkIngress).toBe(amount("1e309"));
    expect(completed.workConsumed.storageRead).toBe(amount("1e309"));
  });

  it("stages transfer data before compute and respects storage/network blockers", () => {
    const initial = createDistributedWorkRuntime(pipeline());
    const halfway = advanceDistributedWork(initial, balancedCapacity(), 1000);
    const blocked = advanceDistributedWork(
      initial,
      createRateVector({ compute: 100, networkIngress: 100 }),
      10_000,
    );

    expect(halfway.runtime.shards.map((shard) => shard.stagedInputBits)).toEqual([
      "5",
      "5",
    ]);
    expect(halfway.runtime.shards.map((shard) => shard.computeRemaining)).toEqual([
      "1",
      "1",
    ]);
    expect(halfway.runtime.barrierReached).toBe(false);
    expect(blocked.runtime.shards.map((shard) => shard.stagedInputBits)).toEqual([
      "0",
      "0",
    ]);
    expect(blocked.runtime.elapsedMs).toBe("10000");
  });

  it("barriers all shards, commits output atomically, and emits reward once", () => {
    const initial = createDistributedWorkRuntime(pipeline());
    const almost = advanceDistributedWork(initial, balancedCapacity(), 5199);
    const completed = advanceDistributedWork(
      almost.runtime,
      balancedCapacity(),
      1,
    );
    const replay = advanceDistributedWork(
      completed.runtime,
      balancedCapacity(),
      10_000,
    );

    expect(almost.runtime.barrierReached).toBe(true);
    expect(almost.runtime.committedOutputBits).toBe("0");
    expect(almost.reward).toEqual(exactResourceBag());
    expect(completed.committed).toBe(true);
    expect(completed.runtime.status).toBe("committed");
    expect(completed.runtime.committedOutputBits).toBe("2");
    expect(completed.reward).toEqual(exactResourceBag(100, 7));
    expect(replay.committed).toBe(false);
    expect(replay.reward).toEqual(exactResourceBag());
  });

  it("is deterministic across delta partitioning and a JSON save round-trip", () => {
    const initial = createDistributedWorkRuntime(pipeline());
    const single = advanceDistributedWork(initial, balancedCapacity(), 5200);
    let chunkedRuntime = initial;
    let chunkedReward = exactResourceBag();
    let chunkedWork = createRateVector();
    for (const delta of [333, 667, 1200, 3000]) {
      const result = advanceDistributedWork(
        chunkedRuntime,
        balancedCapacity(),
        delta,
      );
      chunkedRuntime = result.runtime;
      chunkedReward = exactResourceBag(
        amountAdd(chunkedReward.credits, result.reward.credits),
        amountAdd(chunkedReward.data, result.reward.data),
      );
      chunkedWork = addRateVectors(chunkedWork, result.workConsumed);
    }
    const loaded = normalizeDistributedWorkRuntime(
      JSON.parse(JSON.stringify(chunkedRuntime)) as DistributedWorkRuntime,
    );

    expect(chunkedRuntime).toEqual(single.runtime);
    expect(chunkedReward).toEqual(single.reward);
    expect(chunkedWork).toEqual(single.workConsumed);
    expect(loaded).toEqual(single.runtime);
  });

  it("normalizes completion state so a saved reward cannot replay", () => {
    const completed = advanceDistributedWork(
      createDistributedWorkRuntime(pipeline()),
      balancedCapacity(),
      5200,
    ).runtime;
    const corrupted: DistributedWorkRuntime = {
      ...completed,
      status: "running",
      committedOutputBits: amount("1e309"),
      commitRemaining: amount(1),
      shards: completed.shards.map((shard) => ({
        ...shard,
        transferRemaining: amount(1),
      })),
    };
    const normalized = normalizeDistributedWorkRuntime(corrupted);
    const replay = advanceDistributedWork(normalized, balancedCapacity(), 1000);

    expect(normalized.status).toBe("committed");
    expect(normalized.committedOutputBits).toBe("2");
    expect(normalized.commitRemaining).toBe("0");
    expect(normalized.shards.every((shard) => shard.transferRemaining === "0")).toBe(
      true,
    );
    expect(replay.reward).toEqual(exactResourceBag());
  });
});
