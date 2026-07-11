import type {
  AdvanceReport,
  AdvanceResult,
  GameAction,
  GameState,
  VisibleState,
} from "../types";
import type { Amount } from "../amount";

export type EngagementProfileId =
  | "full-idle"
  | "regular"
  | "engaged"
  | "optimizer";

export type ScheduleMode = "deterministic" | "monte-carlo";

export type DeepReadonly<T> = T extends Amount
  ? T
  : T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface DurationRange {
  minimumMs: number;
  targetMs: number;
  maximumMs: number;
}

export interface SessionCadenceProfile {
  id: EngagementProfileId;
  label: string;
  activeDuration: DurationRange;
  baseReturnDelayMs: number;
  decisionIntervalMs: number;
  attendanceProbability: number;
  returnJitterRatio: number;
  offlineCapacityFillRatio: number | null;
  deterministicSkipEvery: number | null;
  deepSession: {
    intervalMs: number;
    duration: DurationRange;
  } | null;
}

export type SessionKind = "check-in" | "deep";

export interface SessionScheduleEntry {
  index: number;
  startsAtMs: number;
  activeDurationMs: number;
  kind: SessionKind;
}

export interface PublicGameRuntimeAdapter {
  createInitialState(seed: number): GameState;
  observe(state: GameState): VisibleState;
  dispatch(state: GameState, action: GameAction): GameState;
  advance(state: GameState, elapsedMs: number, mode: "foreground" | "offline"): AdvanceResult;
}

export interface ActionPolicyContext {
  profileId: EngagementProfileId;
  scheduleMode: ScheduleMode;
  sessionIndex: number;
  sessionKind: SessionKind;
  nowMs: number;
  elapsedCalendarMs: number;
  remainingActiveMs: number;
  visible: DeepReadonly<VisibleState>;
}

export interface ActionDispatchOutcomeContext {
  decision: ActionPolicyContext;
  action: GameAction;
  actionIndex: number;
  before: DeepReadonly<VisibleState>;
  after: DeepReadonly<VisibleState>;
}

/** Policies can inspect only public visible state and can return only public actions. */
export interface ActionPolicyAdapter {
  selectActions(context: ActionPolicyContext): readonly GameAction[];
  /** Optional public-state audit called after each sequential dispatch. */
  recordActionOutcome?(context: ActionDispatchOutcomeContext): void;
}

export interface CompletionAdapter {
  isComplete(visible: DeepReadonly<VisibleState>): boolean;
}

export interface ReachedMilestone {
  id: string;
  label: string;
}

export interface MilestoneAdapter {
  getReachedMilestones(visible: DeepReadonly<VisibleState>): readonly ReachedMilestone[];
}

export interface RoiIntervalSample {
  benefit: Amount;
  cost: Amount;
}

export interface CampaignMetricSample {
  outputUnits?: Amount;
  standingOrderOutputUnits?: Amount;
  contractOutputUnits?: Amount;
  resourceBalances?: Readonly<Record<string, Amount>>;
  scarceResourceIds?: readonly string[];
  powerRunwayHours?: number | null;
  blockingReasons?: readonly string[];
  usedCapacity?: Amount;
  totalCapacity?: Amount;
  roi?: RoiIntervalSample;
}

export interface MetricSampleContext {
  profileId: EngagementProfileId;
  sessionIndex: number;
  nowMs: number;
  intervalKind: "active" | "offline";
  elapsedMs: number;
  report: DeepReadonly<AdvanceReport>;
}

export interface MetricAdapter {
  sample(
    visible: DeepReadonly<VisibleState>,
    context: MetricSampleContext,
  ): CampaignMetricSample;
}

export interface CampaignRunnerConfig {
  runtime: PublicGameRuntimeAdapter;
  profile: SessionCadenceProfile;
  seed: number;
  scheduleMode: ScheduleMode;
  actionPolicy: ActionPolicyAdapter;
  completion: CompletionAdapter;
  milestones: MilestoneAdapter;
  metricAdapter?: MetricAdapter;
  startAtMs?: number;
  maximumCalendarMs: number;
  offlineStepMs?: number;
  maximumActionsPerDecision?: number;
  /** Test/profiling ceiling for pre-Local decision polling; defaults to profile cadence. */
  openingMaximumDecisionStepMs?: number;
  progress?: CampaignProgressAdapter;
}

export type CampaignProgressPhase =
  | "initial"
  | "action"
  | "before-active-advance"
  | "after-active-advance"
  | "before-offline-advance"
  | "after-offline-advance"
  | "terminal";

export interface CampaignProgressCheckpoint {
  phase: CampaignProgressPhase;
  profileId: EngagementProfileId;
  seed: number;
  scheduleMode: ScheduleMode;
  nowMs: number;
  elapsedCalendarMs: number;
  elapsedCalendarDays: number;
  horizonMs: number;
  completionRatio: number;
  sessionIndex: number;
  sessionCount: number;
  chapterId: string;
  objectiveId: string | null;
  bufferLevelId: string;
  requestedAdvanceMs: number | null;
  completed: boolean;
  counters: {
    observations: number;
    decisions: number;
    proposedActions: number;
    dispatches: number;
    advances: number;
    metricSamples: number;
  };
}

export interface CampaignProgressAdapter {
  /** Minimum simulated time between periodic reports; milestone changes bypass it. */
  minimumIntervalMs?: number;
  /** Emits immediately before every potentially long runtime advance call. */
  includeBeforeAdvance?: boolean;
  onCheckpoint(checkpoint: CampaignProgressCheckpoint): void;
}

export interface CampaignMilestoneMetric {
  id: string;
  label: string;
  reachedAtMs: number;
  elapsedDays: number;
}

export interface ResourceScarcityMetric {
  resourceId: string;
  minimumBalance: Amount;
  sampledHours: number;
  scarceHours: number;
  scarcityShare: number;
}

export interface CampaignRunMetrics {
  runId: string;
  profileId: EngagementProfileId;
  seed: number;
  scheduleMode: ScheduleMode;
  status: "completed" | "horizon-reached";
  startedAtMs: number;
  completedAtMs: number | null;
  elapsedCalendarMs: number;
  elapsedCalendarDays: number;
  sessionCount: number;
  activeMinutes: number;
  offlineHours: number;
  productiveOfflineHours: number;
  pausedOfflineHours: number;
  overflowHours: number;
  overflowShare: number;
  milestones: CampaignMilestoneMetric[];
  workMix: {
    outputUnits: Amount;
    standingOrderOutputUnits: Amount;
    contractOutputUnits: Amount;
    standingOrderShare: number;
    contractShare: number;
  };
  resourceScarcity: ResourceScarcityMetric[];
  roi: {
    benefit: Amount;
    cost: Amount;
    netValue: Amount;
    returnRatio: number | null;
  };
  powerRunway: {
    minimumHours: number | null;
    averageHours: number | null;
    belowTargetHours: number;
    targetHours: number;
  };
  blocking: {
    blockedHours: number;
    blockedShare: number;
    byReasonHours: Record<string, number>;
  };
  unusedCapacity: {
    availableCapacityHours: Amount;
    unusedCapacityHours: Amount;
    unusedShare: number;
  };
}

export interface CampaignRunResult {
  state: GameState;
  visible: VisibleState;
  sessions: SessionScheduleEntry[];
  metrics: CampaignRunMetrics;
}
