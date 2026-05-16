import { getJobDefinition } from "./content/jobs";
import type { GameState, JobDefinition } from "./types";

export const getCacheMultiplier = (state: GameState, job: JobDefinition) => {
  if (job.cacheNeedBytes <= 0) return 1;

  const cache = state.hardware.cacheBytes;

  if (cache > job.cacheNeedBytes) return 1.18;
  if (cache === job.cacheNeedBytes) return 1.1;

  const shortage = (job.cacheNeedBytes - cache) / job.cacheNeedBytes;
  return 1 / (1 + shortage * 0.5);
};

export const getEffectiveClock = (state: GameState, job: JobDefinition) =>
  state.hardware.clockHz * getCacheMultiplier(state, job);

export const estimateJobSeconds = (state: GameState, job: JobDefinition) =>
  job.requiredCycles / getEffectiveClock(state, job);

export const estimateActiveRemainingSeconds = (
  state: GameState,
  jobId: JobDefinition["id"],
  remainingCycles: number,
) => remainingCycles / getEffectiveClock(state, getJobDefinition(jobId));

