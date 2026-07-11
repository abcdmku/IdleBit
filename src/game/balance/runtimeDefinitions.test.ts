import { describe, expect, it } from "vitest";
import { V1_HARDWARE_LIMITS } from "../hardwareLimits";
import { RAM_MAX_LEVEL } from "../content/ramTiers";
import { serializeRuntimeDefinitionsCsv } from "./csv";
import {
  createLegacyUpgradeRuntimeDefinitions,
  createCampaignSystemRuntimeDefinitions,
  createHardwareLimitRuntimeDefinitions,
  createPsuRuntimeDefinitions,
  createResearchRuntimeDefinitions,
} from "./runtimeDefinitions";

const valuesFor = (
  rows: readonly Readonly<Record<string, unknown>>[],
  upgradeId: string,
  field: string,
  tierId?: string,
) =>
  rows
    .filter(
      (row) =>
        row.upgradeId === upgradeId &&
        (tierId === undefined || row.tierId === tierId),
    )
    .map((row) => Number(row[field]));

const expectRange = (
  rows: readonly Readonly<Record<string, unknown>>[],
  upgradeId: string,
  field: string,
  minimum: number,
  maximum: number,
  tierId?: string,
) => {
  const values = valuesFor(rows, upgradeId, field, tierId);
  expect(values.length, `${upgradeId}:${tierId ?? "all"}`).toBeGreaterThan(0);
  expect(Math.min(...values)).toBe(minimum);
  expect(Math.max(...values)).toBe(maximum);
};

describe("generated authoritative runtime definitions", () => {
  it("exports every physical ceiling and late-campaign runtime plan", () => {
    expect(
      Object.fromEntries(
        createHardwareLimitRuntimeDefinitions().map((row) => [
          row.id,
          row.maximum,
        ]),
      ),
    ).toEqual(V1_HARDWARE_LIMITS);

    const systemRows = createCampaignSystemRuntimeDefinitions();
    expect(systemRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ definitionType: "campaign-objective" }),
        expect.objectContaining({ definitionType: "campaign-side-arc" }),
        expect.objectContaining({ definitionType: "finale-charter" }),
        expect.objectContaining({
          definitionType: "workshop-storage-workload",
          id: "artifactStaging",
        }),
        expect.objectContaining({ definitionType: "planetary-finale-plan" }),
        expect.objectContaining({ definitionType: "finale-charter-modifier" }),
      ]),
    );
  });

  it("emits the complete public PSU ladder and late buffer research", () => {
    const psu = createPsuRuntimeDefinitions();
    expect(psu).toHaveLength(V1_HARDWARE_LIMITS.psuLevel);
    expect(psu[0]).toMatchObject({ level: 1, maximumLevel: 64 });
    expect(psu.at(-1)).toMatchObject({ level: 64, maximumLevel: 64 });

    const researchIds = new Set(
      createResearchRuntimeDefinitions().map((row) => row.id),
    );
    expect(researchIds.size).toBeGreaterThan(0);
    for (const id of [
      "clusterControllerResearch",
      "rackControllerResearch",
      "dataCenterNocResearch",
      "globalSchedulerResearch",
    ]) {
      expect(researchIds.has(id), id).toBe(true);
    }
  });

  it("contains representative minimum and maximum rows for every bounded ladder", () => {
    const rows = createLegacyUpgradeRuntimeDefinitions();
    expectRange(rows, "cache", "targetLevel", 2, 36);
    expectRange(rows, "cacheSpeed", "targetLevel", 2, 36, "ghz");
    expectRange(rows, "core", "targetCoreCount", 2, 64);
    expectRange(rows, "secondCpu", "targetCpuPackageCount", 2, 8);
    expectRange(rows, "schedulerSlot", "targetQueueSlots", 1, 64);
    expectRange(rows, "systemSchedulerSlot", "targetQueueSlots", 1, 24);
    expectRange(rows, "deadlockRecovery", "targetLevel", 1, 10);
    expectRange(rows, "ram", "targetStickCount", 1, 32, "ghz");
    expectRange(rows, "ramCapacity", "targetLevel", 2, RAM_MAX_LEVEL);
    expectRange(rows, "ramSpeed", "targetLevel", 2, RAM_MAX_LEVEL);
    expectRange(rows, "cronSchedule", "targetScheduleSlots", 1, 1);
    expectRange(rows, "cronInterval", "targetLevel", 1, 59);
    expectRange(rows, "bootloader", "targetLevel", 1, 36);
    expectRange(rows, "cState", "targetLevel", 1, 36);
    expectRange(rows, "memoryVoltage", "targetLevel", 1, 36);

    const csv = serializeRuntimeDefinitionsCsv(rows);
    expect(csv).toContain("legacy-upgrade-level");
    expect(csv).toContain("memoryVoltage");
    expect(csv).toContain(String(RAM_MAX_LEVEL));
  });
});
