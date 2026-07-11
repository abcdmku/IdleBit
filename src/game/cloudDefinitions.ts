import { amount, exactResourceBag } from "./amount";
import {
  createWorkValueMultiplier,
  getWorkValueCredits,
} from "./workValue";
import type {
  CloudSlaDefinition,
  CloudSlaDefinitionId,
} from "./cloudTypes";

const regionalContinuityWork = amount("1000000000000");
const regionalContinuityValue = createWorkValueMultiplier(
  "cloud-regional-continuity-service",
  10_000,
);
const planetaryCoverageWork = amount("1000000000000000");
const planetaryCoverageValue = createWorkValueMultiplier(
  "cloud-planetary-coverage-service",
  10_000,
);

export const cloudSlaDefinitions: readonly CloudSlaDefinition[] = [
  {
    id: "regionalContinuity",
    name: "Regional Continuity Window",
    description:
      "Hold quorum and latency across two availability zones for four hours.",
    observationWindowMs: 4 * 60 * 60_000,
    workRequired: regionalContinuityWork,
    workValueMultiplier: regionalContinuityValue,
    minimumZoneCount: 2,
    minimumRegionCount: 1,
    policy: {
      availabilityTargetBps: 9_900,
      minimumReplicaQuorum: 2,
      maximumP95LatencyMs: 200,
      deadlineMs: 4 * 60 * 60_000,
    },
    rewards: exactResourceBag(
      getWorkValueCredits(
        regionalContinuityWork,
        regionalContinuityValue,
      ),
      "100000",
    ),
  },
  {
    id: "planetaryCoverage",
    name: "Planetary Coverage Window",
    description:
      "Serve a full-day window across three zones and two routed regions.",
    observationWindowMs: 24 * 60 * 60_000,
    workRequired: planetaryCoverageWork,
    workValueMultiplier: planetaryCoverageValue,
    minimumZoneCount: 3,
    minimumRegionCount: 2,
    policy: {
      availabilityTargetBps: 9_950,
      minimumReplicaQuorum: 2,
      maximumP95LatencyMs: 400,
      deadlineMs: 24 * 60 * 60_000,
    },
    rewards: exactResourceBag(
      getWorkValueCredits(
        planetaryCoverageWork,
        planetaryCoverageValue,
      ),
      "1200000",
    ),
  },
] as const;

const definitionById = new Map(
  cloudSlaDefinitions.map((definition) => [definition.id, definition]),
);

export const getCloudSlaDefinition = (id: CloudSlaDefinitionId) =>
  definitionById.get(id)!;
