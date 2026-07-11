import { describe, expect, it } from "vitest";
import { amountCompare } from "../amount";
import { cloudSlaDefinitions } from "../cloudDefinitions";
import { taskDefinitions } from "../content/tasks";
import { clusterWorkloadDefinitions } from "../distributedDefinitions";
import {
  LIVE_OPERATIONS_AUTHORED_COMPUTE_WORK,
  LIVE_OPERATIONS_SERVICE_VALUE_MULTIPLIER,
  LIVE_OPERATIONS_TASK_IDS,
} from "../liveOperations";
import { projectDefinitions } from "../projects";
import {
  workshopStorageWorkloadDefinition,
  WORKSHOP_STORAGE_PAID_WORK_UNITS,
  WORKSHOP_STORAGE_SERVICE_VALUE_MULTIPLIER,
} from "../workshopStorage";
import { getWorkValueCredits } from "../workValue";
import {
  expectedPublicRuntimeWorkloadIds,
  liveOperationsWorkloadId,
  projectPhaseWorkloadId,
  taskWorkloadId,
  workshopStorageWorkloadId,
} from "./workloadCoverage";

describe("closed-world public payout coverage", () => {
  it("keeps every reviewed Credit-paying runtime source in a snapshot", () => {
    // Adding a new public paid source deliberately changes this snapshot so CI
    // cannot keep claiming closed-world coverage without reviewing attribution.
    expect(expectedPublicRuntimeWorkloadIds).toMatchInlineSnapshot(`
      [
        "cloud:planetaryCoverage",
        "cloud:regionalContinuity",
        "cluster:fabricIntegritySweep",
        "cluster:replicatedShardCommit",
        "contract:compileBatch",
        "contract:gridForecast",
        "contract:ledgerAudit",
        "contract:queueRecovery",
        "contract:renderBurst",
        "contract:replicaSurvey",
        "live-operations:liveCanaryValidation",
        "live-operations:liveQueueTriage",
        "project:archivist:ecc",
        "project:archivist:replication",
        "project:archivist:snapshots",
        "project:gridRelief:heat-map",
        "project:gridRelief:load-shed",
        "project:gridRelief:relief-run",
        "project:openFoundry:publish",
        "project:openFoundry:render",
        "project:openFoundry:toolchain",
        "project:schedulerIntegration:policy-run",
        "project:schedulerIntegration:queue-map",
        "task:bitFlip",
        "task:bitShift",
        "task:busMirror",
        "task:byteCopy",
        "task:compileCode",
        "task:decodeBit",
        "task:fetchBit",
        "task:inferenceBatch",
        "task:memoryScrub",
        "task:microBenchmark",
        "task:multiCoreBenchmark",
        "task:overwriteRamPage",
        "task:packetCheck",
        "task:parallelismBenchmark",
        "task:powerTelemetry",
        "task:queueCompaction",
        "task:readRamPage",
        "task:regressionTest",
        "task:renderFrame",
        "task:shardReconcile",
        "task:thermalProbe",
        "task:tinyChecksum",
        "task:workstationBenchmark",
        "task:writeRamPage",
        "workshop-storage:artifactStaging",
      ]
    `);
    expect(new Set(expectedPublicRuntimeWorkloadIds).size).toBe(
      expectedPublicRuntimeWorkloadIds.length,
    );
  });

  it("includes paid public benchmarks instead of treating them as Data-only", () => {
    const paidBenchmarkIds = taskDefinitions
      .filter(
        (task) =>
          task.visibility !== "internal" &&
          task.kind === "benchmark" &&
          amountCompare(task.rewardCreditsExact, 0) > 0,
      )
      .map((task) => taskWorkloadId(task.id));

    expect(paidBenchmarkIds).not.toHaveLength(0);
    expect(expectedPublicRuntimeWorkloadIds).toEqual(
      expect.arrayContaining(paidBenchmarkIds),
    );
  });

  it("enumerates every paid project phase, attended service, and storage proof", () => {
    const projectIds = projectDefinitions.flatMap((project) =>
      project.phases.map((phase) =>
        projectPhaseWorkloadId(project.id, phase.id),
      ),
    );
    const liveIds = LIVE_OPERATIONS_TASK_IDS.map(liveOperationsWorkloadId);
    const storageId = workshopStorageWorkloadId(
      workshopStorageWorkloadDefinition.id,
    );

    expect(expectedPublicRuntimeWorkloadIds).toEqual(
      expect.arrayContaining([...projectIds, ...liveIds, storageId]),
    );
  });

  it("keeps catalog payouts tied to the same exact paid work", () => {
    for (const task of taskDefinitions.filter(
      (task) =>
        task.visibility !== "internal" &&
        amountCompare(task.rewardCreditsExact, 0) > 0,
    )) {
      expect(task.rewardCreditsExact, task.id).toBe(task.paidWorkUnitsExact);
    }
    for (const project of projectDefinitions) {
      for (const phase of project.phases) {
        expect(phase.rewards.credits, `${project.id}:${phase.id}`).toBe(
          getWorkValueCredits(phase.paidWorkUnits, phase.workValueMultiplier),
        );
      }
    }
    for (const taskId of LIVE_OPERATIONS_TASK_IDS) {
      expect(
        getWorkValueCredits(
          LIVE_OPERATIONS_AUTHORED_COMPUTE_WORK[taskId],
          LIVE_OPERATIONS_SERVICE_VALUE_MULTIPLIER,
        ),
        taskId,
      ).toBe("2160");
    }
    expect(workshopStorageWorkloadDefinition.plan.reward.credits).toBe(
      getWorkValueCredits(
        WORKSHOP_STORAGE_PAID_WORK_UNITS,
        WORKSHOP_STORAGE_SERVICE_VALUE_MULTIPLIER,
      ),
    );
    for (const workload of clusterWorkloadDefinitions) {
      expect(workload.rewards.credits, workload.id).toBe(
        getWorkValueCredits(
          workload.paidWorkUnits,
          workload.workValueMultiplier,
        ),
      );
    }
    for (const sla of cloudSlaDefinitions) {
      expect(sla.rewards.credits, sla.id).toBe(
        getWorkValueCredits(sla.workRequired, sla.workValueMultiplier),
      );
    }
  });
});
