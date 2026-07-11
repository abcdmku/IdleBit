import { describe, expect, it } from "vitest";
import { amount, amountCompare } from "./amount";
import { deriveAggregateServerCapacityProfile } from "./capacity";
import { componentSkus, machineTemplates } from "./content/machines";
import { cpuTierDefinitions } from "./content/cpuTiers";
import { ramTierDefinitions } from "./content/ramTiers";
import { researchDefinitions } from "./content/research";
import { createHardwareFromMachineSelection } from "./machines";
import { getCpuClockHz } from "./progression";
import type { GameState, MachineComponentSelection } from "./types";

const PHYSICAL_CORE_CLOCK_CEILING_HZ = 6_000_000_000;

const expectStrictlyIncreasing = (values: readonly number[]) => {
  values.slice(1).forEach((value, index) => {
    expect(value).toBeGreaterThan(values[index]!);
  });
};

const getMaterializedCoreClocks = (hardware: GameState["hardware"]) =>
  hardware.cpus.flatMap((cpu) =>
    cpu.coreIds.map((coreId) =>
      getCpuClockHz(
        cpu.tierId,
        hardware.coreClockLevels[coreId] ?? cpu.level,
      ),
    ),
  );

describe("physical CPU and RAM frequency ceiling", () => {
  it("uses monotonic, non-overlapping Hz through GHz tiers", () => {
    expect(cpuTierDefinitions.map((tier) => tier.id)).toEqual([
      "hz",
      "khz",
      "mhz",
      "ghz",
    ]);
    expect(ramTierDefinitions.map((tier) => tier.id)).toEqual([
      "hz",
      "khz",
      "mhz",
      "ghz",
    ]);

    for (const definitions of [cpuTierDefinitions, ramTierDefinitions]) {
      definitions.forEach((tier, index) => {
        const clocks = tier.levels.map((level) => level.clockHz);
        expectStrictlyIncreasing(clocks);
        expect(clocks.at(-1)).toBeLessThanOrEqual(PHYSICAL_CORE_CLOCK_CEILING_HZ);

        const nextTier = definitions[index + 1];
        if (nextTier) {
          expect(clocks.at(-1)).toBeLessThan(nextTier.levels[0]!.clockHz);
        }
      });
    }
  });

  it("keeps every catalog component and template core at or below 6 GHz", () => {
    const cpuSelections: MachineComponentSelection[] = componentSkus
      .filter((component) => component.type === "cpu")
      .map((component) => ({
        cpu: component.id,
        ram: "ram-none",
        scheduler: "scheduler-none",
        psu: "psu-workstation",
      }));
    const selections = [
      ...cpuSelections,
      ...machineTemplates.map((template) => template.components),
    ];

    selections.forEach((selection) => {
      const clocks = getMaterializedCoreClocks(
        createHardwareFromMachineSelection(selection),
      );
      expect(clocks.length).toBeGreaterThan(0);
      clocks.forEach((clockHz) => {
        expect(clockHz).toBeLessThanOrEqual(PHYSICAL_CORE_CLOCK_CEILING_HZ);
      });
    });
  });

  it("offers a useful multicore GHz workstation without higher physical units", () => {
    const workstation = machineTemplates.find(
      (template) => template.id === "workstationTower",
    );
    expect(workstation).toBeDefined();

    const hardware = createHardwareFromMachineSelection(workstation!.components);
    const clocks = getMaterializedCoreClocks(hardware);
    expect(hardware.cores).toBeGreaterThanOrEqual(16);
    expect(clocks.every((clockHz) => clockHz >= 1_000_000_000)).toBe(true);
    expect(clocks.every((clockHz) => clockHz <= PHYSICAL_CORE_CLOCK_CEILING_HZ)).toBe(
      true,
    );

    const playerFacingPhysicalCopy = [
      ...cpuTierDefinitions.flatMap((tier) => [tier.id, tier.name, tier.unit]),
      ...ramTierDefinitions.flatMap((tier) => [tier.id, tier.name, tier.unit]),
      ...researchDefinitions.flatMap((research) => [
        research.id,
        research.name,
        research.description,
      ]),
      ...componentSkus.flatMap((component) => [
        component.id,
        component.name,
        component.description,
      ]),
      ...machineTemplates.flatMap((template) => [
        template.id,
        template.name,
        template.description,
      ]),
    ].join(" ");
    expect(playerFacingPhysicalCopy).not.toMatch(/\b(?:thz|phz)\b/i);
  });

  it("lets exact aggregate Fleet compute exceed the physical core ceiling", () => {
    const aggregate = deriveAggregateServerCapacityProfile(
      "denseServer",
      1,
      "nvmeArray",
      "fabricNic",
    );

    expect(aggregate.rates.compute).toBe(amount("1000000000000"));
    expect(
      amountCompare(
        aggregate.rates.compute,
        amount(PHYSICAL_CORE_CLOCK_CEILING_HZ),
      ),
    ).toBeGreaterThan(0);
  });
});
