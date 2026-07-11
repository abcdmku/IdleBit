import path from "node:path";

import { replaceDirectoryAtomically } from "./atomic-directory";
import {
  assertSafeBalanceDiagnosticOutput,
  withBalanceDiagnosticOwnership,
} from "./balance-output-ownership";
import { resolveFilesystemPathIdentity } from "./filesystem-path-identity";

import { automationBufferDefinitions } from "../src/game/automation";
import {
  defaultBalanceAcceptanceTargets,
  evaluateBalanceAcceptance,
  type BalanceAcceptanceResult,
} from "../src/game/balance/acceptance";
import {
  bootstrapCompletionAdapter,
  bootstrapMilestoneAdapter,
  bootstrapSmokeRuntime,
} from "../src/game/balance/bootstrap";
import { sessionCadenceProfiles } from "../src/game/balance/cadence";
import {
  buildMeasuredBalanceAcceptanceEvidence,
  createMeasuredCampaignHarness,
  type MeasuredCompletedRun,
  type MeasuredContractChoice,
} from "../src/game/balance/measuredAcceptance";
import { runCampaign } from "../src/game/balance/runner";
import { assertSafeBalanceGenerationOutput } from "../src/game/balance/generatorGuard";
import {
  assertCompletionDistributionTargets,
  assertCompleteCompletionDistributions,
  assertPublicCampaignTelemetry,
  summarizeCompletionDistribution,
} from "../src/game/balance/monteCarlo";
import {
  createMeasuredNsgaCalibration,
  createOpeningFleetBeamCalibration,
} from "../src/game/balance/calibrationArtifacts";
import {
  createBalanceCsvBundle,
  serializeCsv,
  type RuntimeDefinitionRecord,
} from "../src/game/balance/csv";
import { campaignChapterDefinitions } from "../src/game/campaign";
import { cloudSlaDefinitions } from "../src/game/cloudDefinitions";
import { acceleratorSkuDefinitions } from "../src/game/content/accelerators";
import {
  overclockPresetDefinitions,
  workshopCoolingTierDefinitions,
} from "../src/game/content/cooling";
import { componentSkus, machineTemplates } from "../src/game/content/machines";
import { taskDefinitions } from "../src/game/content/tasks";
import { contractTemplateDefinitions } from "../src/game/contracts";
import { clusterWorkloadDefinitions } from "../src/game/distributedDefinitions";
import {
  facilityTemplateDefinitions,
  rackTemplateDefinitions,
} from "../src/game/facilityDefinitions";
import {
  networkSkuDefinitions,
  serverSkuDefinitions,
  storageSkuDefinitions,
} from "../src/game/infrastructureDefinitions";
import { projectDefinitions } from "../src/game/projects";
import type {
  CampaignProgressAdapter,
  EngagementProfileId,
} from "../src/game/balance/types";
import {
  createCpuTierRuntimeDefinitions,
  createCampaignSystemRuntimeDefinitions,
  createHardwareLimitRuntimeDefinitions,
  createLegacyUpgradeRuntimeDefinitions,
  createPsuRuntimeDefinitions,
  createRamTierRuntimeDefinitions,
  createResearchRuntimeDefinitions,
} from "../src/game/balance/runtimeDefinitions";

const DAY_MS = 24 * 60 * 60 * 1_000;
const CALIBRATION_SEED = 31_415;

const cliValue = (name: string) => {
  const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const outputOverride = (
  cliValue("output") ?? process.env.IDLEBIT_BALANCE_OUTPUT
)?.trim() || undefined;
const canonicalOutputDirectory = path.resolve("docs/balance/generated");
const outputDirectory = path.resolve(
  outputOverride ?? canonicalOutputDirectory,
);
const [outputPathIdentity, canonicalPathIdentity, workspacePathIdentity] =
  await Promise.all([
    resolveFilesystemPathIdentity(outputDirectory),
    resolveFilesystemPathIdentity(canonicalOutputDirectory),
    resolveFilesystemPathIdentity(process.cwd()),
  ]);

const profileRuns = [
  { profile: sessionCadenceProfiles.fullIdle, horizonDays: 365 },
  { profile: sessionCadenceProfiles.regular, horizonDays: 183 },
  { profile: sessionCadenceProfiles.engaged, horizonDays: 127 },
  { profile: sessionCadenceProfiles.optimizer, horizonDays: 183 },
] as const;

const requestedProfileIds = new Set(
  (cliValue("profiles") ?? process.env.IDLEBIT_BALANCE_PROFILES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const selectedProfileRuns =
  requestedProfileIds.size === 0
    ? [...profileRuns]
    : profileRuns.filter(({ profile }) => requestedProfileIds.has(profile.id));
if (selectedProfileRuns.length === 0) {
  throw new Error(
    `No known profiles selected: ${[...requestedProfileIds].join(", ")}`,
  );
}
const completeProfileBundle = selectedProfileRuns.length === profileRuns.length;
const skipCalibration = process.argv.includes("--skip-calibration");
const requestedBeamDepth = Number(cliValue("beam-depth"));
const beamDepth = Number.isSafeInteger(requestedBeamDepth) && requestedBeamDepth > 0
  ? requestedBeamDepth
  : 192;
const requestedProgressDays = Number(
  cliValue("progress-days") ?? process.env.IDLEBIT_BALANCE_PROGRESS_DAYS,
);
const progressDays =
  Number.isFinite(requestedProgressDays) && requestedProgressDays > 0
    ? requestedProgressDays
    : 7;
const progressEnabled = !process.argv.includes("--no-progress");
const verboseProgress = process.argv.includes("--verbose-progress");
const createProgressReporter = (label: string): CampaignProgressAdapter | undefined => {
  if (!progressEnabled) return undefined;
  const wallStartedAt = Date.now();
  return {
    minimumIntervalMs: progressDays * DAY_MS,
    includeBeforeAdvance: verboseProgress,
    onCheckpoint: (checkpoint) => {
      const percent = (checkpoint.completionRatio * 100).toFixed(1);
      const counters = checkpoint.counters;
      process.stdout.write(
        `[balance:${label}] ${checkpoint.phase} day=${checkpoint.elapsedCalendarDays.toFixed(3)} ` +
          `progress=${percent}% chapter=${checkpoint.chapterId} ` +
          `objective=${checkpoint.objectiveId ?? "none"} buffer=${checkpoint.bufferLevelId} ` +
          `sessions=${checkpoint.sessionCount} decisions=${counters.decisions} ` +
          `actions=${counters.dispatches}/${counters.proposedActions} ` +
          `advances=${counters.advances} observations=${counters.observations} ` +
          `wall=${((Date.now() - wallStartedAt) / 1_000).toFixed(1)}s\n`,
      );
    },
  };
};
const requestedMonteCarloSeeds = (
  cliValue("mc-seeds") ?? process.env.IDLEBIT_MC_SEEDS ?? ""
)
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isSafeInteger(value) && value >= 0);
const monteCarloSeeds =
  requestedMonteCarloSeeds.length > 0
    ? Array.from(new Set(requestedMonteCarloSeeds))
    : Array.from({ length: 5 }, (_, index) => CALIBRATION_SEED + 100_000 + index * 7_919);
const defaultGeneration = assertSafeBalanceGenerationOutput({
  requestedProfileCount: requestedProfileIds.size,
  requestedMonteCarloSeedCount: requestedMonteCarloSeeds.length,
  outputOverride,
  outputDirectoryIdentity: outputPathIdentity.identity,
  canonicalOutputDirectoryIdentity: canonicalPathIdentity.identity,
  workspaceDirectoryIdentity: workspacePathIdentity.identity,
  outputFilesystemRootIdentity: outputPathIdentity.filesystemRootIdentity,
});
const diagnosticOutput =
  outputPathIdentity.identity !== canonicalPathIdentity.identity;
if (diagnosticOutput) {
  await assertSafeBalanceDiagnosticOutput(outputDirectory);
}

const runtimeDefinitions: RuntimeDefinitionRecord[] = [
  ...createHardwareLimitRuntimeDefinitions(),
  ...createCampaignSystemRuntimeDefinitions(),
  ...automationBufferDefinitions.map((definition) => ({
    definitionType: "automation-buffer",
    ...definition,
  })),
  ...campaignChapterDefinitions.map((definition) => ({
    definitionType: "campaign-chapter",
    ...definition,
  })),
  ...contractTemplateDefinitions.map((definition) => ({
    definitionType: "contract-template",
    ...definition,
  })),
  ...projectDefinitions.map((definition) => ({
    definitionType: "project",
    ...definition,
  })),
  ...cloudSlaDefinitions.map((definition) => ({
    definitionType: "cloud-sla",
    ...definition,
  })),
  ...clusterWorkloadDefinitions.map((definition) => ({
    definitionType: "cluster-workload",
    ...definition,
  })),
  ...createResearchRuntimeDefinitions(),
  ...createCpuTierRuntimeDefinitions(),
  ...createRamTierRuntimeDefinitions(),
  ...createPsuRuntimeDefinitions(),
  ...createLegacyUpgradeRuntimeDefinitions(),
  ...workshopCoolingTierDefinitions.map((definition) => ({
    definitionType: "workshop-cooling-tier",
    ...definition,
  })),
  ...overclockPresetDefinitions.map((definition) => ({
    definitionType: "overclock-preset",
    ...definition,
  })),
  ...acceleratorSkuDefinitions.map((definition) => ({
    definitionType: "accelerator-sku",
    ...definition,
  })),
  ...componentSkus.map((definition) => ({
    definitionType: "machine-component-sku",
    ...definition,
  })),
  ...machineTemplates.map((definition) => ({
    definitionType: "machine-template",
    ...definition,
  })),
  ...serverSkuDefinitions.map((definition) => ({
    definitionType: "server-sku",
    ...definition,
  })),
  ...storageSkuDefinitions.map((definition) => ({
    definitionType: "storage-sku",
    ...definition,
  })),
  ...networkSkuDefinitions.map((definition) => ({
    definitionType: "network-sku",
    ...definition,
  })),
  ...rackTemplateDefinitions.map((definition) => ({
    definitionType: "rack-template",
    ...definition,
  })),
  ...facilityTemplateDefinitions.map((definition) => ({
    definitionType: "facility-template",
    ...definition,
  })),
  ...taskDefinitions.map((definition) => ({
    definitionType: "task",
    id: definition.id,
    name: definition.name,
    kind: definition.kind,
    category: definition.category,
    operationCount: definition.operationCount,
    operationCountExact: definition.operationCountExact,
    rewardCredits: definition.rewardCredits,
    rewardCreditsExact: definition.rewardCreditsExact,
    firstCompletionData: definition.firstCompletionData,
    firstCompletionDataExact: definition.firstCompletionDataExact,
    repeatRewardData: definition.repeatRewardData,
    repeatRewardDataExact: definition.repeatRewardDataExact,
    requiredCycles: definition.requiredCycles,
    requiredCyclesExact: definition.requiredCyclesExact,
    aggregateBatch: definition.aggregateBatch,
    requiredCores: definition.minCores,
    cacheNeedBits: definition.cacheNeedBits,
    ramNeedBits: definition.ramNeedBits,
    workUnitCount: definition.workUnitCount,
    repeatable: definition.repeatable,
  })),
];

const measuredRuns: MeasuredCompletedRun[] = [];
for (const { profile, horizonDays } of selectedProfileRuns) {
  const harness = createMeasuredCampaignHarness(profile.id);
  const result = runCampaign({
    runtime: bootstrapSmokeRuntime,
    profile,
    seed: CALIBRATION_SEED,
    scheduleMode: "deterministic",
    actionPolicy: harness.actionPolicy,
    metricAdapter: harness.metricAdapter,
    completion: bootstrapCompletionAdapter,
    milestones: bootstrapMilestoneAdapter,
    maximumCalendarMs: horizonDays * DAY_MS,
    // Sampling at most daily preserves every actual return/action boundary;
    // advanceGame still consumes the exact full interval and emits its events.
    offlineStepMs: DAY_MS,
    progress: createProgressReporter(`${profile.id}:deterministic:${CALIBRATION_SEED}`),
  });
  measuredRuns.push({ result, measurement: harness.snapshot() });
  process.stdout.write(
    `${profile.id}: ${result.metrics.status} at ${result.metrics.elapsedCalendarDays.toFixed(3)} days\n`,
  );
}

const evidence = buildMeasuredBalanceAcceptanceEvidence(measuredRuns);
const acceptance = evaluateBalanceAcceptance(evidence);
if (completeProfileBundle && !acceptance.passed) {
  for (const issue of acceptance.issues) {
    process.stderr.write(`[${issue.code}] ${issue.message}\n`);
  }
  throw new Error(
    `Measured balance acceptance failed with ${acceptance.issues.length} issue(s).`,
  );
}
const results = measuredRuns.map((entry) => entry.result.metrics);
const nsgaCalibration = skipCalibration
  ? null
  : createMeasuredNsgaCalibration(results, evidence);
const beamCalibration = skipCalibration
  ? null
  : createOpeningFleetBeamCalibration(CALIBRATION_SEED + 1, beamDepth);
const schedules = measuredRuns.flatMap((entry) =>
  entry.result.sessions.map((session) => ({
    profileId: entry.result.metrics.profileId,
    ...session,
  })),
);

const aggregateContractChoices = (choices: readonly MeasuredContractChoice[]) => {
  const groups = new Map<string, MeasuredContractChoice[]>();
  for (const choice of choices) {
    const key = `${choice.profileId}:${choice.templateId}:${choice.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), choice]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const multipliers = group.flatMap((choice) =>
      choice.multiplierVsStandingOrder === null
        ? []
        : [choice.multiplierVsStandingOrder],
    );
    return {
      profileId: first.profileId,
      templateId: first.templateId,
      kind: first.kind,
      acceptedCount: group.length,
      minimumMultiplier:
        multipliers.length > 0 ? Math.min(...multipliers) : null,
      averageMultiplier:
        multipliers.length > 0
          ? multipliers.reduce((total, value) => total + value, 0) /
            multipliers.length
          : null,
      maximumMultiplier:
        multipliers.length > 0 ? Math.max(...multipliers) : null,
      minimumNetMargin: Math.min(...group.map((choice) => choice.netMargin)),
      allBufferCovered: group.every((choice) => choice.bufferCovered),
      allRunwayCovered: group.every((choice) => choice.creditRunwayCovered),
    };
  });
};

const acceptanceRows = (result: BalanceAcceptanceResult) =>
  result.issues.map((issue) => ({
    passed: false,
    code: issue.code,
    subjectId: issue.subjectId,
    actual: issue.actual,
    minimum: issue.minimum,
    maximum: issue.maximum,
    message: issue.message,
  }));

const monteCarloRuns: MeasuredCompletedRun[] = [];
if (!completeProfileBundle || acceptance.passed) {
  for (const { profile, horizonDays } of selectedProfileRuns) {
    for (const seed of monteCarloSeeds) {
      const harness = createMeasuredCampaignHarness(profile.id);
      const result = runCampaign({
        runtime: bootstrapSmokeRuntime,
        profile,
        seed,
        scheduleMode: "monte-carlo",
        actionPolicy: harness.actionPolicy,
        metricAdapter: harness.metricAdapter,
        completion: bootstrapCompletionAdapter,
        milestones: bootstrapMilestoneAdapter,
        maximumCalendarMs: horizonDays * DAY_MS,
        offlineStepMs: DAY_MS,
        progress: createProgressReporter(`${profile.id}:monte-carlo:${seed}`),
      });
      monteCarloRuns.push({ result, measurement: harness.snapshot() });
    }
  }
}

const monteCarloAudits =
  monteCarloRuns.length > 0
    ? assertPublicCampaignTelemetry(
        monteCarloRuns.map((entry) => ({
          metrics: entry.result.metrics,
          sessionCount: entry.result.sessions.length,
          actionCount: entry.measurement.totalActions,
          noOpActionCount: entry.measurement.noOpActions,
          intervalCount: entry.measurement.intervals.length,
          developerGrantActions: entry.measurement.developerGrantActions,
          strandedDecisions: entry.measurement.strandedDecisions,
          destructiveAbsenceEvents:
            entry.measurement.destructiveAbsenceEvents,
          safelyAvoidedDestructiveEvents:
            entry.measurement.safelyAvoidedDestructiveEvents,
        })),
      )
    : [];
const auditByRunId = new Map(
  monteCarloAudits.map((audit) => [audit.runId, audit]),
);
const monteCarloDistributions = selectedProfileRuns.flatMap(({ profile }) => {
  const metrics = monteCarloRuns
    .filter((entry) => entry.result.metrics.profileId === profile.id)
    .map((entry) => entry.result.metrics);
  return metrics.length > 0 ? [summarizeCompletionDistribution(metrics)] : [];
});

if (defaultGeneration) {
  assertCompleteCompletionDistributions(
    monteCarloDistributions,
    profileRuns.map(({ profile }) => profile.id),
    5,
  );
  assertCompletionDistributionTargets(monteCarloDistributions, [
    ...Object.entries(defaultBalanceAcceptanceTargets.completionDays).map(
      ([profileId, [minimumDays, maximumDays]]) => ({
        profileId: profileId as Exclude<EngagementProfileId, "optimizer">,
        minimumDays,
        maximumDays,
      }),
    ),
    {
      profileId: "optimizer",
      minimumDays: defaultBalanceAcceptanceTargets.optimizerMinimumDays,
      maximumDays: null,
    },
  ]);
  if (skipCalibration || !beamCalibration?.reachedFleet) {
    throw new Error(
      "Default balance bundle requires a public-state beam route that reaches Fleet.",
    );
  }
}

const bundle = createBalanceCsvBundle({ runtimeDefinitions, results });
bundle["session-schedules.csv"] = serializeCsv(schedules);
bundle["acceptance-summary.csv"] = serializeCsv([
  {
    passed: acceptance.passed,
    issueCount: acceptance.issues.length,
    regularOfflineOutputUnits: evidence.regularOfflineOutputUnits,
    regularTotalOutputUnits: evidence.regularTotalOutputUnits,
    regularOfflineOutputShare:
      evidence.regularTotalOutputUnits > 0
        ? evidence.regularOfflineOutputUnits / evidence.regularTotalOutputUnits
        : 0,
    postLocalManualActionShare: evidence.postLocalManualActionShare,
    postLocalManualProductionShare: evidence.postLocalManualProductionShare,
    acceptedContractCount: evidence.contracts.length,
    standingOrderBaselineWindowCount: evidence.standingOrderBaselines.length,
    minimumStandingOrderBaselineShare:
      evidence.standingOrderBaselines.length > 0
        ? Math.min(
            ...evidence.standingOrderBaselines.map((row) =>
              row.managedOutputPerDay > 0
                ? row.standingOrderOutputPerDay / row.managedOutputPerDay
                : Number.POSITIVE_INFINITY,
            ),
          )
        : null,
    maximumStandingOrderBaselineShare:
      evidence.standingOrderBaselines.length > 0
        ? Math.max(
            ...evidence.standingOrderBaselines.map((row) =>
              row.managedOutputPerDay > 0
                ? row.standingOrderOutputPerDay / row.managedOutputPerDay
                : Number.POSITIVE_INFINITY,
            ),
          )
        : null,
    absenceDestructiveLosses: evidence.absenceDestructiveLosses,
    strandedFullIdleRuns: evidence.strandedFullIdleRuns,
    productionDeveloperGrantActions: evidence.productionDeveloperGrantActions,
  },
]);
bundle["acceptance-issues.csv"] = serializeCsv(acceptanceRows(acceptance), [
  "passed",
  "code",
  "subjectId",
  "actual",
  "minimum",
  "maximum",
  "message",
]);
bundle["velocity-windows.csv"] = serializeCsv(
  evidence.velocityWindows.map((row) => ({ ...row })),
);
bundle["buffer-evidence.csv"] = serializeCsv(
  evidence.buffers.map((row) => ({ ...row })),
);
bundle["workload-evidence.csv"] = serializeCsv(
  evidence.workloads.map((row) => ({ ...row })),
);
bundle["contract-evidence.csv"] = serializeCsv(
  aggregateContractChoices(
    measuredRuns.flatMap((entry) => entry.measurement.contractChoices),
  ),
);
bundle["standing-order-baseline.csv"] = serializeCsv(
  evidence.standingOrderBaselines.map((row) => ({
    ...row,
    baselineShare:
      row.managedOutputPerDay > 0
        ? row.standingOrderOutputPerDay / row.managedOutputPerDay
        : Number.POSITIVE_INFINITY,
  })),
);
bundle["monte-carlo-runs.csv"] = serializeCsv(
  monteCarloRuns.map((entry) => {
    const metrics = entry.result.metrics;
    return {
      runId: metrics.runId,
      profileId: metrics.profileId,
      seed: metrics.seed,
      status: metrics.status,
      elapsedCalendarDays: metrics.elapsedCalendarDays,
      completedAtMs: metrics.completedAtMs,
      sessionCount: entry.result.sessions.length,
      actionCount: entry.measurement.totalActions,
      proposedActionCount: entry.measurement.proposedActions,
      noOpActionCount: entry.measurement.noOpActions,
      intervalCount: entry.measurement.intervals.length,
      developerGrantActions: entry.measurement.developerGrantActions,
      publicTelemetryVerified: auditByRunId.get(metrics.runId)?.verified ?? false,
    };
  }),
);
bundle["monte-carlo-completion-distributions.csv"] = serializeCsv(
  monteCarloDistributions.map((distribution) => ({
    ...distribution,
    p50Days: distribution.medianDays,
  })),
);
if (nsgaCalibration) {
  bundle["calibration-nsga-population.csv"] = serializeCsv(
    nsgaCalibration.populationRows,
  );
  bundle["calibration-nsga-pareto.csv"] = serializeCsv(
    nsgaCalibration.paretoRows,
  );
  bundle["calibration-nsga-selected.csv"] = serializeCsv(
    nsgaCalibration.selectedRows,
  );
  bundle["calibration-nsga-recommended.csv"] = serializeCsv(
    nsgaCalibration.recommendedRows,
  );
  bundle["calibration-nsga-history.csv"] = serializeCsv(
    nsgaCalibration.historyRows,
  );
}
if (beamCalibration) {
  bundle["calibration-beam-stats.csv"] = serializeCsv(
    beamCalibration.statsRows,
  );
  bundle["calibration-beam-route.csv"] = serializeCsv(
    beamCalibration.routeRows,
  );
}

if (diagnosticOutput) {
  // Recheck after the long-running simulations to close accidental races with
  // files created in a previously absent or empty target.
  await assertSafeBalanceDiagnosticOutput(outputDirectory);
}
await replaceDirectoryAtomically(
  outputDirectory,
  withBalanceDiagnosticOwnership(bundle, diagnosticOutput),
);

process.stdout.write(
  `Generated ${Object.keys(bundle).length} measured balance CSVs in ${outputDirectory}\n`,
);
