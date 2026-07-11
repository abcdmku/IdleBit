import { amountCompare } from "../amount";
import { cloudSlaDefinitions } from "../cloudDefinitions";
import { taskDefinitions } from "../content/tasks";
import { contractTemplateDefinitions } from "../contracts";
import { clusterWorkloadDefinitions } from "../distributedDefinitions";
import { getHardwareWorkTotal } from "../hardwareWork";
import {
  LIVE_OPERATIONS_AUTHORED_COMPUTE_WORK,
  LIVE_OPERATIONS_SERVICE_VALUE_MULTIPLIER,
  LIVE_OPERATIONS_TASK_IDS,
} from "../liveOperations";
import { projectDefinitions } from "../projects";
import {
  workshopStorageWorkloadDefinition,
  WORKSHOP_STORAGE_PAID_WORK_UNITS,
} from "../workshopStorage";
import { getWorkValueCredits } from "../workValue";

export const taskWorkloadId = (taskId: string) => `task:${taskId}`;
export const contractWorkloadId = (templateId: string) =>
  `contract:${templateId}`;
export const projectPhaseWorkloadId = (projectId: string, phaseId: string) =>
  `project:${projectId}:${phaseId}`;
export const liveOperationsWorkloadId = (taskId: string) =>
  `live-operations:${taskId}`;
export const workshopStorageWorkloadId = (workloadId: string) =>
  `workshop-storage:${workloadId}`;
export const clusterWorkloadId = (definitionId: string) =>
  `cluster:${definitionId}`;
export const cloudWorkloadId = (definitionId: string) =>
  `cloud:${definitionId}`;

/**
 * Closed-world set of public, Credit-paying runtime work. If content adds a
 * new workload, measured balance acceptance must exercise it before CI can
 * claim that every public workload has source-correct economics.
 */
export const expectedPublicRuntimeWorkloadIds = [
  ...taskDefinitions
    .filter(
      (task) =>
        task.visibility !== "internal" &&
        amountCompare(task.rewardCreditsExact, 0) > 0,
    )
    .map((task) => taskWorkloadId(task.id)),
  ...contractTemplateDefinitions
    .filter(
      (contract) => amountCompare(
        getHardwareWorkTotal(contract.baseWorkRecipe),
        0,
      ) > 0,
    )
    .map((contract) => contractWorkloadId(contract.id)),
  ...projectDefinitions.flatMap((project) =>
    project.phases
      .filter((phase) => amountCompare(phase.rewards.credits, 0) > 0)
      .map((phase) => projectPhaseWorkloadId(project.id, phase.id)),
  ),
  ...LIVE_OPERATIONS_TASK_IDS
    .filter((taskId) =>
      amountCompare(
        getWorkValueCredits(
          LIVE_OPERATIONS_AUTHORED_COMPUTE_WORK[taskId],
          LIVE_OPERATIONS_SERVICE_VALUE_MULTIPLIER,
        ),
        0,
      ) > 0,
    )
    .map(liveOperationsWorkloadId),
  ...(amountCompare(workshopStorageWorkloadDefinition.plan.reward.credits, 0) > 0 &&
  amountCompare(WORKSHOP_STORAGE_PAID_WORK_UNITS, 0) > 0
    ? [workshopStorageWorkloadId(workshopStorageWorkloadDefinition.id)]
    : []),
  ...clusterWorkloadDefinitions
    .filter((workload) => amountCompare(workload.rewards.credits, 0) > 0)
    .map((workload) => clusterWorkloadId(workload.id)),
  ...cloudSlaDefinitions
    .filter((sla) => amountCompare(sla.rewards.credits, 0) > 0)
    .map((sla) => cloudWorkloadId(sla.id)),
].sort();
