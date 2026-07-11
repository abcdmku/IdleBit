import type { Amount, ExactResourceBag } from "./amount";
import type { PlanetaryFinaleRuntime } from "./planetary";
import type {
  RegionalDemand,
  RegionalRoutingResult,
  RoutingEdge,
} from "./routing";
import type {
  AvailabilityZoneState,
  FailoverState,
  OptInIncidentSchedule,
  ServiceReplicaState,
  SlaEvaluation,
  SlaPolicy,
  SlaWindowState,
  ZoneOperatingStatus,
} from "./sla";
import type { FinaleCharterId } from "./types";
import type { WorkValueMultiplier } from "./workValue";

export type CloudSlaDefinitionId =
  | "regionalContinuity"
  | "planetaryCoverage";

export interface CloudSlaDefinition {
  id: CloudSlaDefinitionId;
  name: string;
  description: string;
  /** Fixed service-observation window; productive work is never derived from it. */
  observationWindowMs: number;
  workRequired: Amount;
  workValueMultiplier: WorkValueMultiplier;
  minimumZoneCount: number;
  minimumRegionCount: number;
  policy: SlaPolicy;
  rewards: ExactResourceBag;
}

export interface CloudRegionState {
  id: string;
  name: string;
}

export interface CloudZoneState {
  id: string;
  name: string;
  regionId: string;
  facilityId: string;
  faultDomainId: string;
  configuredStatus: ZoneOperatingStatus;
  capacityPerSecond: Amount;
  baseLatencyMs: number;
}

export interface CloudReplicaState extends ServiceReplicaState {
  serviceId: "commons-service";
}

export interface ActiveCloudSlaState {
  id: string;
  definitionId: CloudSlaDefinitionId;
  observationElapsedMs: number;
  workCompleted: Amount;
  /** Frozen authored settlement terms captured when the SLA starts. */
  paidWorkUnits?: Amount;
  workValueMultiplier?: WorkValueMultiplier;
  charterRewardMultiplier?: WorkValueMultiplier;
  window: SlaWindowState;
}

export interface CompletedCloudSlaState {
  id: string;
  definitionId: CloudSlaDefinitionId;
  succeeded: boolean;
  evaluation: SlaEvaluation;
  /** Compatibility projection; charterRewardMultiplier is authoritative. */
  rewardBps: number;
  paidWorkUnits?: Amount;
  workValueMultiplier?: WorkValueMultiplier;
  charterRewardMultiplier?: WorkValueMultiplier;
  rewards: ExactResourceBag;
}

export interface CloudRewardEvent {
  source: "sla";
  instanceId: string;
  definitionId: CloudSlaDefinitionId;
  rewards: ExactResourceBag;
}

export interface CloudAdvanceResult {
  state: CloudState;
  rewards: ExactResourceBag;
  rewardEvents: CloudRewardEvent[];
  completedFinalePhaseIds: string[];
  productiveMs: number;
  pausedMs: number;
  blockers: string[];
}

export interface CloudAdvanceOptions {
  /** False advances only Cloud clocks/failover/incidents and safely freezes work. */
  productiveAllowed?: boolean;
}

export interface CloudRoutingSnapshot {
  result: RegionalRoutingResult;
  effectiveZones: AvailabilityZoneState[];
  connectedRegionIds: string[];
  contributionPerSecond: Amount;
}

export interface CloudState {
  elapsedMs: number;
  advanceRemainderMs: number;
  nextEntityId: number;
  regions: CloudRegionState[];
  zones: CloudZoneState[];
  replicas: CloudReplicaState[];
  failover: FailoverState;
  automaticFailover: boolean;
  failoverDelayMs: number;
  incidents: OptInIncidentSchedule[];
  regionalDemands: RegionalDemand[];
  routingLinks: RoutingEdge[];
  activeSla: ActiveCloudSlaState | null;
  completedSlas: CompletedCloudSlaState[];
  finale: PlanetaryFinaleRuntime | null;
  finaleCharterId: FinaleCharterId | null;
  postgameUnlocked: boolean;
}
