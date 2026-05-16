import { getJobDefinition, jobDefinitions } from "./content/jobs";
import { getUpgradeDefinition, upgradeDefinitions } from "./content/upgrades";
import { canAfford, spend, addRewards } from "./economy";
import { getEffectiveClock } from "./math";
import { updateProgressionFlags } from "./progression";
import type { ActiveJob, GameAction, GameState, JobId, UpgradeId } from "./types";

const availableCoreIds = (state: GameState) => {
  const busy = new Set(state.activeJobs.map((job) => job.coreId));
  return Array.from({ length: state.hardware.cores }, (_, index) => index + 1).filter(
    (coreId) => !busy.has(coreId),
  );
};

const createActiveJob = (
  state: GameState,
  jobId: JobId,
  coreId: number,
): [GameState, ActiveJob] => {
  const job = getJobDefinition(jobId);
  const instanceId = `job-${state.nextInstanceId}`;

  return [
    { ...state, nextInstanceId: state.nextInstanceId + 1 },
    {
      instanceId,
      jobId,
      coreId,
      remainingCycles: job.requiredCycles,
      totalCycles: job.requiredCycles,
    },
  ];
};

const canRunJob = (state: GameState, jobId: JobId) => {
  const job = getJobDefinition(jobId);
  const benchmarkDone =
    job.kind === "benchmark" && state.completedBenchmarks.includes(job.id);

  return job.requirement(state) && !benchmarkDone;
};

const assignJobToIdleCore = (state: GameState, jobId: JobId): GameState => {
  if (!canRunJob(state, jobId)) return state;

  const [coreId] = availableCoreIds(state);

  if (!coreId) return state;

  const [nextState, activeJob] = createActiveJob(state, jobId, coreId);
  return {
    ...nextState,
    activeJobs: [...nextState.activeJobs, activeJob],
  };
};

const enqueueJob = (state: GameState, jobId: JobId) => {
  if (!canRunJob(state, jobId)) return state;
  if (!state.flags.basicQueue && !state.flags.scheduler) return state;

  return {
    ...state,
    queue: [...state.queue, jobId],
  };
};

const pullQueue = (state: GameState): GameState => {
  if (!state.flags.basicQueue && !state.flags.scheduler) return state;

  let nextState = state;
  const nextQueue = [...state.queue];

  while (nextQueue.length > 0 && availableCoreIds(nextState).length > 0) {
    const jobId = nextQueue.shift();

    if (jobId) {
      nextState = assignJobToIdleCore({ ...nextState, queue: nextQueue }, jobId);
    }
  }

  return { ...nextState, queue: nextQueue };
};

const completeJob = (state: GameState, activeJob: ActiveJob): GameState => {
  const job = getJobDefinition(activeJob.jobId);
  const completedAmount = state.completedJobs[job.id] ?? 0;
  const benchmarkIds = job.kind === "benchmark" ? [job.id] : [];
  const nextBenchmarks = Array.from(
    new Set([...state.completedBenchmarks, ...benchmarkIds]),
  );
  const rewarded = addRewards(state, job.rewardCredits, job.rewardData);
  const repeated =
    state.autoRepeatJobId === job.id && job.repeatable
      ? { ...rewarded, queue: [...rewarded.queue, job.id] }
      : rewarded;

  return updateProgressionFlags({
    ...repeated,
    completedJobs: {
      ...repeated.completedJobs,
      [job.id]: completedAmount + 1,
    },
    completedBenchmarks: nextBenchmarks,
  });
};

const tickActiveJobs = (state: GameState, deltaSeconds: number): GameState => {
  let nextState = state;
  const continuingJobs: ActiveJob[] = [];

  for (const activeJob of state.activeJobs) {
    const definition = getJobDefinition(activeJob.jobId);
    const cyclesDone = getEffectiveClock(state, definition) * deltaSeconds;
    const remainingCycles = Math.max(0, activeJob.remainingCycles - cyclesDone);

    if (remainingCycles <= 0) {
      nextState = completeJob(nextState, activeJob);
    } else {
      continuingJobs.push({ ...activeJob, remainingCycles });
    }
  }

  return {
    ...nextState,
    activeJobs: continuingJobs,
  };
};

export const tickGame = (state: GameState, deltaMs: number): GameState => {
  const deltaSeconds = Math.max(0, Math.min(deltaMs / 1000, 2));
  const ticked = tickActiveJobs(
    { ...state, tick: state.tick + deltaSeconds },
    deltaSeconds,
  );

  return pullQueue(updateProgressionFlags(ticked));
};

export const startJob = (state: GameState, jobId: JobId) => {
  const started = assignJobToIdleCore(state, jobId);

  if (started !== state) return started;

  return enqueueJob(state, jobId);
};

export const buyUpgrade = (state: GameState, upgradeId: UpgradeId) => {
  const upgrade = getUpgradeDefinition(upgradeId);
  const costs = upgrade.cost(state);

  if (!upgrade.requirement(state) || !canAfford(state, costs)) {
    return state;
  }

  const bought = upgrade.buy(spend(state, costs));
  return pullQueue(updateProgressionFlags(bought));
};

export const applyAction = (state: GameState, action: GameAction): GameState => {
  if (action.type === "startJob") return startJob(state, action.jobId);
  if (action.type === "queueJob") return enqueueJob(state, action.jobId);
  if (action.type === "buyUpgrade") return buyUpgrade(state, action.upgradeId);
  if (action.type === "setAutoRepeat") {
    return {
      ...state,
      autoRepeatJobId: action.jobId,
    };
  }

  return state;
};

export const getAvailableJobs = (state: GameState) =>
  jobDefinitions.filter((job) => canRunJob(state, job.id));

export const getAvailableUpgrades = (state: GameState) =>
  upgradeDefinitions.filter((upgrade) => upgrade.requirement(state));

