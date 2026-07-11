import { describe, expect, it } from "vitest";

import { exactResourceBag } from "./amount";
import {
  advanceDistributedWork,
  createDistributedWorkRuntime,
  getDistributedWorkPaidUnits,
  getNextDistributedEventMs,
} from "./distributed";
import {
  clusterWorkloadDefinitions,
  getClusterWorkloadDefinition,
} from "./distributedDefinitions";
import {
  advanceCapacityWork,
  createCapacityWorkRuntime,
  getNextCapacityWorkEventMs,
} from "./capacityWork";
import { createRateVector, exactRateResourceIds } from "./weightedFair";
import { getWorkValueCredits, sumPaidWorkUnits } from "./workValue";

describe("cluster paid-work settlement", () => {
  it("derives every repeatable Credit payout from exact paid work", () => {
    for (const definition of clusterWorkloadDefinitions) {
      expect(definition.workValueMultiplier.id.length).toBeGreaterThan(0);
      expect(definition.rewards.credits).toBe(
        getWorkValueCredits(
          definition.paidWorkUnits,
          definition.workValueMultiplier,
        ),
      );
    }
  });

  it("counts every authored distributed and capacity lane exactly once", () => {
    const replicated = getClusterWorkloadDefinition("replicatedShardCommit");
    if (replicated.kind !== "distributed") {
      throw new Error("Replicated shard definition must remain distributed");
    }
    const plan = replicated.createPlan(
      replicated.placementRequests.map((request, index) => ({
        requestId: request.id,
        nodeId: `node-${index}`,
        faultDomainId: `domain-${index}`,
        demand: request.demand,
      })),
    );
    expect(getDistributedWorkPaidUnits(plan)).toBe("11750000");
    expect(replicated.paidWorkUnits).toBe(getDistributedWorkPaidUnits(plan));
    expect(plan.reward).toEqual(
      exactResourceBag(replicated.paidWorkUnits, "50"),
    );

    const integrity = getClusterWorkloadDefinition("fabricIntegritySweep");
    if (integrity.kind !== "capacity") {
      throw new Error("Integrity sweep definition must remain capacity work");
    }
    const paidWorkUnits = sumPaidWorkUnits(
      exactRateResourceIds.map((resource) => integrity.plan.work[resource]),
    );
    expect(paidWorkUnits).toBe("7000000");
    expect(integrity.paidWorkUnits).toBe(paidWorkUnits);
    expect(integrity.plan.reward).toEqual(
      exactResourceBag(integrity.paidWorkUnits, "15"),
    );
  });

  it("lets faster hardware finish sooner without changing either payout", () => {
    const replicated = getClusterWorkloadDefinition("replicatedShardCommit");
    if (replicated.kind !== "distributed") throw new Error("kind mismatch");
    const distributedPlan = replicated.createPlan(
      replicated.placementRequests.map((request, index) => ({
        requestId: request.id,
        nodeId: `node-${index}`,
        faultDomainId: `domain-${index}`,
        demand: request.demand,
      })),
    );
    const slowRates = createRateVector({
      compute: "1000000",
      storageRead: "1000000",
      storageWrite: "1000000",
      networkIngress: "1000000",
      networkEgress: "1000000",
    });
    const fastRates = createRateVector({
      compute: "100000000",
      storageRead: "100000000",
      storageWrite: "100000000",
      networkIngress: "100000000",
      networkEgress: "100000000",
    });
    const distributedRuntime = createDistributedWorkRuntime(distributedPlan);
    expect(getNextDistributedEventMs(distributedRuntime, fastRates)).not.toBe(
      getNextDistributedEventMs(distributedRuntime, slowRates),
    );
    expect(
      advanceDistributedWork(distributedRuntime, slowRates, 60_000).reward,
    ).toEqual(
      advanceDistributedWork(distributedRuntime, fastRates, 60_000).reward,
    );

    const integrity = getClusterWorkloadDefinition("fabricIntegritySweep");
    if (integrity.kind !== "capacity") throw new Error("kind mismatch");
    const capacityRuntime = createCapacityWorkRuntime(integrity.plan);
    const fit = {
      memoryBits: integrity.plan.memoryBits,
      storageBits: integrity.plan.storageBits,
    };
    expect(
      getNextCapacityWorkEventMs(capacityRuntime, fastRates, fit),
    ).not.toBe(getNextCapacityWorkEventMs(capacityRuntime, slowRates, fit));
    expect(
      advanceCapacityWork(capacityRuntime, slowRates, fit, 60_000).reward,
    ).toEqual(
      advanceCapacityWork(capacityRuntime, fastRates, fit, 60_000).reward,
    );
  });
});
