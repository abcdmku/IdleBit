import type { CampaignRunMetrics } from "./types";

export type CsvScalar = string | number | boolean | null | undefined;
export type CsvRow = Readonly<Record<string, CsvScalar>>;
export type RuntimeDefinitionRecord = Readonly<Record<string, unknown>>;

const stableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableJsonValue(nested)]),
    );
  }
  return value;
};

const csvValue = (value: CsvScalar) => {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" && !Number.isFinite(value) ? String(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** RFC-4180 compatible serialization with stable inferred column ordering. */
export const serializeCsv = (
  rows: readonly CsvRow[],
  suppliedColumns?: readonly string[],
) => {
  const columns = suppliedColumns
    ? [...suppliedColumns]
    : [...new Set(rows.flatMap((row) => Object.keys(row)))].sort((left, right) =>
        left.localeCompare(right),
      );
  if (columns.length === 0) return "";
  const lines = [columns.map(csvValue).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvValue(row[column])).join(","));
  return `${lines.join("\r\n")}\r\n`;
};

const flattenDefinition = (
  definition: RuntimeDefinitionRecord,
  prefix = "",
): Record<string, CsvScalar> => {
  const row: Record<string, CsvScalar> = {};
  for (const [key, value] of Object.entries(definition)) {
    const column = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      Object.assign(
        row,
        flattenDefinition(value as RuntimeDefinitionRecord, column),
      );
    } else if (Array.isArray(value)) {
      row[column] = JSON.stringify(stableJsonValue(value));
    } else if (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      row[column] = value;
    } else {
      row[column] = JSON.stringify(stableJsonValue(value));
    }
  }
  return row;
};

export const serializeRuntimeDefinitionsCsv = (
  definitions: readonly RuntimeDefinitionRecord[],
) => serializeCsv(definitions.map((definition) => flattenDefinition(definition)));

const runRow = (run: CampaignRunMetrics): CsvRow => ({
  activeMinutes: run.activeMinutes,
  completedAtMs: run.completedAtMs,
  contractShare: run.workMix.contractShare,
  elapsedCalendarDays: run.elapsedCalendarDays,
  outputUnits: run.workMix.outputUnits,
  standingOrderOutputUnits: run.workMix.standingOrderOutputUnits,
  contractOutputUnits: run.workMix.contractOutputUnits,
  offlineHours: run.offlineHours,
  minimumPowerRunwayHours: run.powerRunway.minimumHours,
  averagePowerRunwayHours: run.powerRunway.averageHours,
  belowTargetPowerRunwayHours: run.powerRunway.belowTargetHours,
  targetPowerRunwayHours: run.powerRunway.targetHours,
  overflowHours: run.overflowHours,
  overflowShare: run.overflowShare,
  pausedOfflineHours: run.pausedOfflineHours,
  productiveOfflineHours: run.productiveOfflineHours,
  profileId: run.profileId,
  roiReturnRatio: run.roi.returnRatio,
  roiBenefit: run.roi.benefit,
  roiCost: run.roi.cost,
  roiNetValue: run.roi.netValue,
  runId: run.runId,
  scheduleMode: run.scheduleMode,
  seed: run.seed,
  sessionCount: run.sessionCount,
  standingOrderShare: run.workMix.standingOrderShare,
  status: run.status,
  unusedCapacityShare: run.unusedCapacity.unusedShare,
  availableCapacityHours: run.unusedCapacity.availableCapacityHours,
  unusedCapacityHours: run.unusedCapacity.unusedCapacityHours,
});

export interface BalanceCsvBundleInput {
  runtimeDefinitions: readonly RuntimeDefinitionRecord[];
  results: readonly CampaignRunMetrics[];
}

/** Produces normalized CSV artifacts without importing private content tables. */
export const createBalanceCsvBundle = (
  input: BalanceCsvBundleInput,
): Record<string, string> => ({
  "runtime-definitions.csv": serializeRuntimeDefinitionsCsv(input.runtimeDefinitions),
  "campaign-runs.csv": serializeCsv(input.results.map(runRow)),
  "campaign-milestones.csv": serializeCsv(
    input.results.flatMap((run) =>
      run.milestones.map((milestone) => ({
        elapsedDays: milestone.elapsedDays,
        label: milestone.label,
        milestoneId: milestone.id,
        profileId: run.profileId,
        reachedAtMs: milestone.reachedAtMs,
        runId: run.runId,
        seed: run.seed,
      })),
    ),
  ),
  "resource-scarcity.csv": serializeCsv(
    input.results.flatMap((run) =>
      run.resourceScarcity.map((resource) => ({
        minimumBalance: resource.minimumBalance,
        profileId: run.profileId,
        resourceId: resource.resourceId,
        runId: run.runId,
        sampledHours: resource.sampledHours,
        scarceHours: resource.scarceHours,
        scarcityShare: resource.scarcityShare,
        seed: run.seed,
      })),
    ),
  ),
  "blocking.csv": serializeCsv(
    input.results.flatMap((run) =>
      Object.entries(run.blocking.byReasonHours).map(([reason, blockedHours]) => ({
        blockedHours,
        profileId: run.profileId,
        reason,
        runId: run.runId,
        seed: run.seed,
      })),
    ),
  ),
});
