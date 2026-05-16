import { getAvailableJobs, getAvailableUpgrades } from "./simulation";
import { getUpgradeCount } from "./content/upgrades";
import { canAfford } from "./economy";
import { estimateActiveRemainingSeconds, estimateJobSeconds } from "./math";
import { getMilestone, getStage, getStageLabel } from "./progression";
import type { GameState, JobDefinition, VisibleState } from "./types";
import { getJobDefinition } from "./content/jobs";

const getCacheFit = (
  state: GameState,
  job: JobDefinition,
): "bonus" | "met" | "low" => {
  if (job.cacheNeedBytes <= 0) return "met";
  if (state.hardware.cacheBytes > job.cacheNeedBytes) return "bonus";
  if (state.hardware.cacheBytes === job.cacheNeedBytes) return "met";
  return "low";
};

export const deriveVisibleState = (state: GameState): VisibleState => {
  const stage = getStage(state);
  const idleCoreCount = state.hardware.cores - state.activeJobs.length;

  return {
    stage,
    stageLabel: getStageLabel(stage),
    resources: state.resources,
    hardware: state.hardware,
    flags: state.flags,
    activeJobs: state.activeJobs.map((activeJob) => {
      const definition = getJobDefinition(activeJob.jobId);
      const progress =
        1 - activeJob.remainingCycles / Math.max(activeJob.totalCycles, 1);

      return {
        instanceId: activeJob.instanceId,
        jobId: activeJob.jobId,
        name: definition.name,
        coreId: activeJob.coreId,
        progress: Math.min(1, Math.max(0, progress)),
        remainingSeconds: estimateActiveRemainingSeconds(
          state,
          activeJob.jobId,
          activeJob.remainingCycles,
        ),
      };
    }),
    queue: state.queue,
    jobs: getAvailableJobs(state).map((job) => ({
      id: job.id,
      name: job.name,
      kind: job.kind,
      rewardCredits: job.rewardCredits,
      rewardData: job.rewardData,
      seconds: estimateJobSeconds(state, job),
      cacheFit: getCacheFit(state, job),
      canStart: idleCoreCount > 0 || state.flags.basicQueue || state.flags.scheduler,
    })),
    upgrades: getAvailableUpgrades(state).map((upgrade) => {
      const costs = upgrade.cost(state);
      return {
        id: upgrade.id,
        name: upgrade.name,
        accent: upgrade.accent,
        costs,
        canAfford: canAfford(state, costs),
        purchaseCount: getUpgradeCount(state, upgrade.id),
      };
    }),
    milestone: getMilestone(state),
  };
};

