import { runCampaign } from "./runner";
import type {
  CampaignRunMetrics,
  CampaignRunnerConfig,
  EngagementProfileId,
} from "./types";

export interface MonteCarloCampaignConfig {
  seeds: readonly number[];
  createConfig(seed: number): CampaignRunnerConfig;
}

export interface CompletionDistribution {
  profileId: EngagementProfileId;
  sampleCount: number;
  completedCount: number;
  completionRate: number;
  minimumDays: number | null;
  p10Days: number | null;
  medianDays: number | null;
  p90Days: number | null;
  maximumDays: number | null;
}

export interface CompletionDistributionTarget {
  profileId: EngagementProfileId;
  minimumDays: number;
  maximumDays: number | null;
}

export interface PublicCampaignTelemetryAuditInput {
  metrics: CampaignRunMetrics;
  sessionCount: number;
  actionCount: number;
  noOpActionCount: number;
  intervalCount: number;
  developerGrantActions: number;
  strandedDecisions: number;
  destructiveAbsenceEvents: number;
  safelyAvoidedDestructiveEvents: number;
}

export interface PublicCampaignTelemetryAudit {
  runId: string;
  verified: boolean;
  failures: string[];
}

export const MAX_PUBLIC_TELEMETRY_NO_OP_SHARE = 0.1;

/**
 * Proves generated distribution rows came from the measured public adapter,
 * not from synthetic completion-day samples or a private-state shortcut.
 */
export const auditPublicCampaignTelemetry = (
  input: PublicCampaignTelemetryAuditInput,
): PublicCampaignTelemetryAudit => {
  const failures: string[] = [];
  if (input.metrics.scheduleMode !== "monte-carlo") {
    failures.push("schedule mode is not monte-carlo");
  }
  if (input.metrics.status !== "completed" || input.metrics.completedAtMs === null) {
    failures.push("campaign did not complete within the measured horizon");
  }
  if (input.sessionCount <= 0 || input.metrics.sessionCount <= 0) {
    failures.push("no public session schedule was recorded");
  }
  if (input.actionCount <= 0) failures.push("no public policy actions were recorded");
  const auditedActionCount = input.actionCount + input.noOpActionCount;
  const noOpShare =
    auditedActionCount > 0 ? input.noOpActionCount / auditedActionCount : 0;
  if (noOpShare > MAX_PUBLIC_TELEMETRY_NO_OP_SHARE) {
    failures.push(
      `no-op action share ${noOpShare} exceeds ${MAX_PUBLIC_TELEMETRY_NO_OP_SHARE}`,
    );
  }
  if (input.intervalCount <= 0) failures.push("no measured advance intervals were recorded");
  if (input.developerGrantActions !== 0) {
    failures.push("developer grants were used");
  }
  if (input.strandedDecisions !== 0) {
    failures.push("public policy became stranded");
  }
  if (input.destructiveAbsenceEvents !== 0) {
    failures.push("absence caused a destructive event");
  }
  if (input.metrics.overflowHours > 0) {
    failures.push("expected-cadence attendance overflowed the Automation Buffer");
  }
  return {
    runId: input.metrics.runId,
    verified: failures.length === 0,
    failures,
  };
};

export const assertPublicCampaignTelemetry = (
  inputs: readonly PublicCampaignTelemetryAuditInput[],
) => {
  if (inputs.length === 0) {
    throw new Error("Monte Carlo public telemetry requires at least one real run");
  }
  const audits = inputs.map(auditPublicCampaignTelemetry);
  const invalid = audits.filter((audit) => !audit.verified);
  if (invalid.length > 0) {
    throw new Error(
      `Invalid Monte Carlo public telemetry: ${invalid
        .map((audit) => `${audit.runId} (${audit.failures.join("; ")})`)
        .join(", ")}`,
    );
  }
  return audits;
};

const quantile = (sorted: readonly number[], probability: number) => {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower] ?? sorted[0]!;
  const upperValue = sorted[upper] ?? sorted[sorted.length - 1]!;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
};

export const summarizeCompletionDistribution = (
  metrics: readonly CampaignRunMetrics[],
): CompletionDistribution => {
  if (metrics.length === 0) {
    throw new Error("Completion distribution requires at least one run");
  }
  const profileId = metrics[0]!.profileId;
  if (metrics.some((run) => run.profileId !== profileId)) {
    throw new Error("Completion distribution cannot mix engagement profiles");
  }
  const completedDays = metrics
    .filter((run) => run.status === "completed" && run.completedAtMs !== null)
    .map((run) => run.elapsedCalendarDays)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return {
    profileId,
    sampleCount: metrics.length,
    completedCount: completedDays.length,
    completionRate: completedDays.length / metrics.length,
    minimumDays: completedDays[0] ?? null,
    p10Days: quantile(completedDays, 0.1),
    medianDays: quantile(completedDays, 0.5),
    p90Days: quantile(completedDays, 0.9),
    maximumDays: completedDays[completedDays.length - 1] ?? null,
  };
};

export const assertCompleteCompletionDistributions = (
  distributions: readonly CompletionDistribution[],
  expectedProfiles: readonly EngagementProfileId[],
  minimumSampleCount = 5,
) => {
  const failures: string[] = [];
  for (const profileId of expectedProfiles) {
    const distribution = distributions.find(
      (candidate) => candidate.profileId === profileId,
    );
    if (!distribution) {
      failures.push(`${profileId}: missing distribution`);
      continue;
    }
    if (distribution.sampleCount < minimumSampleCount) {
      failures.push(
        `${profileId}: ${distribution.sampleCount} samples; minimum ${minimumSampleCount}`,
      );
    }
    if (
      distribution.completedCount !== distribution.sampleCount ||
      distribution.completionRate !== 1
    ) {
      failures.push(
        `${profileId}: completion rate ${distribution.completionRate}`,
      );
    }
    for (const [label, value] of [
      ["p10", distribution.p10Days],
      ["p50", distribution.medianDays],
      ["p90", distribution.p90Days],
    ] as const) {
      if (value === null || !Number.isFinite(value)) {
        failures.push(`${profileId}: ${label} is missing`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Incomplete Monte Carlo distributions: ${failures.join("; ")}`);
  }
  return distributions;
};

/**
 * Keeps seeded attendance variation inside the same public pacing promise as
 * the deterministic anchor. P10/P90 are used instead of extrema so a single
 * tail seed remains visible without redefining the advertised campaign band.
 */
export const assertCompletionDistributionTargets = (
  distributions: readonly CompletionDistribution[],
  targets: readonly CompletionDistributionTarget[],
) => {
  const failures: string[] = [];
  for (const target of targets) {
    const distribution = distributions.find(
      (candidate) => candidate.profileId === target.profileId,
    );
    if (!distribution) {
      failures.push(`${target.profileId}: missing distribution`);
      continue;
    }
    const p10 = distribution.p10Days;
    const p90 = distribution.p90Days;
    if (p10 === null || !Number.isFinite(p10) || p10 < target.minimumDays) {
      failures.push(
        `${target.profileId}: p10 ${String(p10)}; minimum ${target.minimumDays}`,
      );
    }
    if (
      target.maximumDays !== null &&
      (p90 === null || !Number.isFinite(p90) || p90 > target.maximumDays)
    ) {
      failures.push(
        `${target.profileId}: p90 ${String(p90)}; maximum ${target.maximumDays}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`Out-of-band Monte Carlo distributions: ${failures.join("; ")}`);
  }
  return distributions;
};

/** Runs the public campaign runtime once per supplied seed. */
export const runCampaignMonteCarlo = (config: MonteCarloCampaignConfig) => {
  const metrics = config.seeds.map((seed) =>
    runCampaign({
      ...config.createConfig(seed),
      seed,
      scheduleMode: "monte-carlo",
    }).metrics,
  );
  return { metrics, distribution: summarizeCompletionDistribution(metrics) };
};
