import type { Amount, ExactCost, ExactResourceBag } from "./amount";
import type { CapacityWorkRuntime } from "./capacityWork";
import type { DistributedWorkRuntime } from "./distributed";
import type { PlacementVector } from "./placement";
import type { WorkValueMultiplier } from "./workValue";
import type {
  FacilitySnapshot,
  FacilityState,
  RackSnapshot,
} from "./facilities";

export type RateResourceId =
  | "compute"
  | "storageRead"
  | "storageWrite"
  | "networkIngress"
  | "networkEgress";

export type RateVector = Record<RateResourceId, Amount>;

export interface CapacityProfile {
  rates: RateVector;
  memoryBits: Amount;
  storageBits: Amount;
  idleWatts: Amount;
  peakWatts: Amount;
}

export type ServerSkuId =
  | "starterServer"
  | "workshopServer"
  | "denseServer";

export type StorageSkuId =
  | "storageNone"
  | "localSsd"
  | "nvmeArray";

export type NetworkSkuId =
  | "networkNone"
  | "gigabitNic"
  | "fabricNic";

export interface InfrastructureSkuDefinition<Id extends string> {
  id: Id;
  name: string;
  description: string;
  profile: CapacityProfile;
  costs: ExactCost[];
}

export interface ServerSkuDefinition
  extends InfrastructureSkuDefinition<ServerSkuId> {
  defaultStorageSkuId: StorageSkuId;
  defaultNetworkSkuId: NetworkSkuId;
}

export type StorageSkuDefinition = InfrastructureSkuDefinition<StorageSkuId>;
export type NetworkSkuDefinition = InfrastructureSkuDefinition<NetworkSkuId>;

export type FleetNodeSource =
  | { kind: "system"; systemId: number }
  | { kind: "aggregate"; skuId: ServerSkuId; count: number };

export interface FleetNodeState {
  id: string;
  source: FleetNodeSource;
  managed: boolean;
  rackId: string | null;
  storageSkuId: StorageSkuId;
  networkSkuId: NetworkSkuId;
}

export type ReplicaFaultDomain = "node" | "rack" | "zone";

export interface ClusterPolicy {
  defaultWeight: number;
  reserveHeadroomBps: number;
  replicaFaultDomain: ReplicaFaultDomain;
}

export interface ClusterState {
  id: string;
  name: string;
  nodeIds: string[];
  policy: ClusterPolicy;
}

export type ClusterWorkloadDefinitionId =
  | "replicatedShardCommit"
  | "fabricIntegritySweep";

export type ClusterWorkloadSource = "manual" | "campaign";

export interface ClusterWorkloadPlacement {
  requestId: string;
  nodeId: string;
  faultDomainId: string;
  demand: PlacementVector;
}

interface ClusterWorkloadStateBase {
  id: string;
  definitionId: ClusterWorkloadDefinitionId;
  clusterId: string;
  weight: number;
  source: ClusterWorkloadSource;
  placements: ClusterWorkloadPlacement[];
  operatingCreditsSpent: Amount;
  /** Frozen settlement terms captured when this workload starts. */
  paidWorkUnits?: Amount;
  workValueMultiplier?: WorkValueMultiplier;
  blockers: string[];
}

export interface DistributedClusterWorkloadState
  extends ClusterWorkloadStateBase {
  kind: "distributed";
  runtime: DistributedWorkRuntime;
}

export interface CapacityClusterWorkloadState extends ClusterWorkloadStateBase {
  kind: "capacity";
  runtime: CapacityWorkRuntime;
}

export type ClusterWorkloadState =
  | DistributedClusterWorkloadState
  | CapacityClusterWorkloadState;

export interface ClusterWorkloadCompletionEvent {
  sequence: number;
  instanceId: string;
  definitionId: ClusterWorkloadDefinitionId;
  clusterId: string;
  source: ClusterWorkloadSource;
  rewards: ExactResourceBag;
  replicaFaultDomainCount: number;
}

export interface InfrastructureState {
  elapsedMs: number;
  nextEntityId: number;
  nextCompletionSequence?: number;
  fleetNodes: FleetNodeState[];
  clusters: ClusterState[];
  facilities: FacilityState[];
  workloads?: ClusterWorkloadState[];
  completedWorkloadCounts?: Partial<
    Record<ClusterWorkloadDefinitionId, number>
  >;
  successfulShardCommits?: number;
  replicaDomainCommits?: number;
  completionEvents?: ClusterWorkloadCompletionEvent[];
}

export interface VisibleFacilityRackState extends RackSnapshot {
  nodeIds: string[];
}

export interface VisibleFacilityState extends Omit<FacilitySnapshot, "racks"> {
  racks: VisibleFacilityRackState[];
  cloudCapacityPerSecond: Amount;
  blockers: string[];
}

export interface VisibleFleetNode {
  id: string;
  name: string;
  source: FleetNodeSource;
  managed: boolean;
  storageSkuId: StorageSkuId;
  networkSkuId: NetworkSkuId;
  capacity: CapacityProfile;
  blocker: string | null;
}

export interface VisibleCapacityPool {
  total: CapacityProfile;
  available: CapacityProfile;
  reserved: CapacityProfile;
  utilizationBps: number;
  headroomBps: number;
}

export interface VisibleFleetCapacity extends VisibleCapacityPool {
  nodes: VisibleFleetNode[];
  blockers: string[];
}

export interface VisibleClusterState extends VisibleCapacityPool {
  id: string;
  name: string;
  nodeIds: string[];
  policy: ClusterPolicy;
  blockers: string[];
}

export interface VisibleClusterWorkloadProjection {
  durationMs: Amount | null;
  operatingCost: Amount | null;
  netCreditReward: Amount | null;
  marginBps: number | null;
  bufferCovered: boolean;
  pauseReason: string | null;
}

export interface VisibleClusterWorkload {
  id: string;
  definitionId: ClusterWorkloadDefinitionId;
  clusterId: string;
  kind: ClusterWorkloadState["kind"];
  name: string;
  weight: number;
  source: ClusterWorkloadSource;
  status: "running" | "paused" | "completed";
  progressBps: number;
  placements: ClusterWorkloadPlacement[];
  blockers: string[];
  rewards: ExactResourceBag;
  paidWorkUnits?: Amount;
  workValueMultiplier?: WorkValueMultiplier;
  operatingCreditsSpent: Amount;
  projection: VisibleClusterWorkloadProjection;
}

export interface VisibleClusterWorkloadDefinition {
  id: ClusterWorkloadDefinitionId;
  name: string;
  description: string;
  kind: ClusterWorkloadState["kind"];
  startCosts: ExactCost[];
  rewards: ExactResourceBag;
  paidWorkUnits: Amount;
  workValueMultiplier: WorkValueMultiplier;
  operatingCreditsPerSecond: Amount;
  clusterOptions: Array<{
    clusterId: string;
    canStart: boolean;
    blockedReason: string | null;
  }>;
}

export interface VisibleInfrastructureState {
  elapsedMs: number;
  horizontalTools: {
    archivistReplicaPolicies: boolean;
    gridReliefOperatingDiscountBps: number;
  };
  fleet: VisibleFleetCapacity;
  clusters: VisibleClusterState[];
  facilities: VisibleFacilityState[];
  workloads: VisibleClusterWorkload[];
  workloadDefinitions: VisibleClusterWorkloadDefinition[];
}
