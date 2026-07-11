import { describe, expect, it } from "vitest";
import { exactResourceBag } from "./amount";
import { V1_HARDWARE_LIMITS } from "./hardwareLimits";
import {
  createHardwareFromMachineSelection,
  getMachineSelectionBlockedReason,
} from "./machines";
import {
  createCpuHardwareState,
  createInitialGameState,
  createRamStickState,
  createSystemState,
  getPsuWatts,
  syncHardwarePackages,
} from "./progression";
import { deserializeSave } from "./save";
import { deriveVisibleState } from "./selectors";
import { applyAction } from "./simulation";
import { materializeSystem } from "./systems";
import type { GameAction, GameState, HardwareState } from "./types";

const fund = (state: GameState): GameState => ({
  ...state,
  exactResources: exactResourceBag("1e100", "1e100"),
  resources: { credits: 1e100, data: 1e100 },
});

const stateWithHardware = (
  update: (hardware: HardwareState) => HardwareState,
): GameState => {
  const base = createInitialGameState();
  const requested = update(base.hardware);
  const primaryCpu = requested.cpus[0] ?? base.hardware.cpus[0]!;
  const hardware = syncHardwarePackages({
    ...base,
    hardware: {
      ...requested,
      cacheLevel: primaryCpu.cacheLevel,
      cacheSpeedLevel: primaryCpu.cacheSpeedLevel,
      cacheBits: primaryCpu.cacheBits,
      cacheBytes: primaryCpu.cacheBytes,
      schedulerSlots: requested.cpus.reduce(
        (total, cpu) => total + cpu.schedulerSlots,
        0,
      ),
    },
  }).hardware;
  const system = createSystemState(1, "Bounds Test", null, hardware);
  return fund(
    materializeSystem({
      ...base,
      flags: {
        ...base.flags,
        multiCore: true,
        basicQueue: true,
        scheduler: true,
        schedulerWatchdog: true,
        secondCpu: true,
        systemStats: true,
        systemCatalog: true,
        customMachineAssembly: true,
      },
      research: {
        ...base.research,
        completed: [
          "multiCore",
          "localScheduler",
          "schedulerWatchdog",
          "systemScheduler",
          "ramControl",
          "systemBus",
          "systemCatalog",
          "customMachineAssembly",
          "cpuTierKhz",
          "cpuTierMhz",
          "cpuTierGhz",
        ],
      },
      systems: [system],
      selectedSystemId: system.id,
    }),
  );
};

const purchaseToCapThenReject = (
  state: GameState,
  action: GameAction,
  readValue: (state: GameState) => number,
  cap: number,
) => {
  const capped = applyAction(state, action);
  expect(readValue(capped)).toBe(cap);
  const creditsAtCap = capped.exactResources.credits;
  const dataAtCap = capped.exactResources.data;
  const rejected = applyAction(capped, action);
  expect(readValue(rejected)).toBe(cap);
  expect(rejected.exactResources.credits).toBe(creditsAtCap);
  expect(rejected.exactResources.data).toBe(dataAtCap);
};

describe("v1 physical hardware limits", () => {
  it("lets public upgrade actions reach each cap once and rejects another purchase", () => {
    purchaseToCapThenReject(
      stateWithHardware((hardware) => ({
        ...hardware,
        cpus: [
          createCpuHardwareState(
            1,
            Array.from(
              { length: V1_HARDWARE_LIMITS.coresPerCpu - 1 },
              (_, index) => index + 1,
            ),
          ),
        ],
      })),
      { type: "buyUpgrade", upgradeId: "core", cpuId: 1 },
      (state) => state.hardware.cpus[0]!.coreIds.length,
      V1_HARDWARE_LIMITS.coresPerCpu,
    );

    purchaseToCapThenReject(
      stateWithHardware((hardware) => ({
        ...hardware,
        cpus: Array.from(
          { length: V1_HARDWARE_LIMITS.cpuPackages - 1 },
          (_, index) => createCpuHardwareState(index + 1, [index + 1]),
        ),
      })),
      { type: "buyUpgrade", upgradeId: "secondCpu" },
      (state) => state.hardware.cpus.length,
      V1_HARDWARE_LIMITS.cpuPackages,
    );

    purchaseToCapThenReject(
      stateWithHardware((hardware) => ({
        ...hardware,
        cpus: [
          createCpuHardwareState(1, [1], {
            cacheLevel: V1_HARDWARE_LIMITS.cacheLevel - 1,
          }),
        ],
      })),
      { type: "buyUpgrade", upgradeId: "cache", cpuId: 1 },
      (state) => state.hardware.cpus[0]!.cacheLevel,
      V1_HARDWARE_LIMITS.cacheLevel,
    );

    purchaseToCapThenReject(
      stateWithHardware((hardware) => ({
        ...hardware,
        cpus: [
          createCpuHardwareState(1, [1], {
            schedulerSlots: V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu - 1,
          }),
        ],
      })),
      { type: "buyUpgrade", upgradeId: "schedulerSlot", cpuId: 1 },
      (state) => state.hardware.cpus[0]!.schedulerSlots,
      V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu,
    );

    purchaseToCapThenReject(
      stateWithHardware((hardware) => ({
        ...hardware,
        systemSchedulerSlots: V1_HARDWARE_LIMITS.systemQueueSlots - 1,
      })),
      { type: "buyUpgrade", upgradeId: "systemSchedulerSlot" },
      (state) => state.hardware.systemSchedulerSlots,
      V1_HARDWARE_LIMITS.systemQueueSlots,
    );

    purchaseToCapThenReject(
      stateWithHardware((hardware) => ({
        ...hardware,
        deadlockRecoveryLevel: V1_HARDWARE_LIMITS.deadlockRecoveryLevel - 1,
      })),
      { type: "buyUpgrade", upgradeId: "deadlockRecovery" },
      (state) => state.hardware.deadlockRecoveryLevel,
      V1_HARDWARE_LIMITS.deadlockRecoveryLevel,
    );

    purchaseToCapThenReject(
      stateWithHardware((hardware) => ({
        ...hardware,
        ramLevel: V1_HARDWARE_LIMITS.ramSticks - 1,
        ramSticks: Array.from(
          { length: V1_HARDWARE_LIMITS.ramSticks - 1 },
          (_, index) => createRamStickState(index + 1, 1),
        ),
      })),
      { type: "buyUpgrade", upgradeId: "ram" },
      (state) => state.hardware.ramSticks.length,
      V1_HARDWARE_LIMITS.ramSticks,
    );

    purchaseToCapThenReject(
      stateWithHardware((hardware) => ({
        ...hardware,
        psuLevel: V1_HARDWARE_LIMITS.psuLevel - 1,
        psuWatts: getPsuWatts(V1_HARDWARE_LIMITS.psuLevel - 1),
      })),
      { type: "buyUpgrade", upgradeId: "psu" },
      (state) => state.hardware.psuLevel,
      V1_HARDWARE_LIMITS.psuLevel,
    );
  });

  it("supports the campaign's 8-package by 64-core Advanced build and rejects larger builds", () => {
    const packageConfigs = Array.from(
      { length: V1_HARDWARE_LIMITS.cpuPackages },
      () => ({
        coreCount: V1_HARDWARE_LIMITS.coresPerCpu,
        schedulerSlots: V1_HARDWARE_LIMITS.cpuQueueSlotsPerCpu,
      }),
    );
    const components = {
      cpu: "cpu-workstation-16",
      cpuPackageCount: V1_HARDWARE_LIMITS.cpuPackages,
      cpuPackageConfigs: packageConfigs,
      ram: "ram-ghz-tier",
      ramStickCount: V1_HARDWARE_LIMITS.ramSticks,
      scheduler: "scheduler-24-slot",
      psu: "psu-workstation",
      psuLevel: V1_HARDWARE_LIMITS.psuLevel,
    } as const;
    const hardware = createHardwareFromMachineSelection(components);

    expect(hardware.cpus).toHaveLength(V1_HARDWARE_LIMITS.cpuPackages);
    expect(hardware.cores).toBe(
      V1_HARDWARE_LIMITS.cpuPackages * V1_HARDWARE_LIMITS.coresPerCpu,
    );
    expect(hardware.cpus.every((cpu) => cpu.schedulerSlots === 64)).toBe(true);
    expect(hardware.ramSticks).toHaveLength(V1_HARDWARE_LIMITS.ramSticks);
    expect(hardware.systemSchedulerSlots).toBe(V1_HARDWARE_LIMITS.systemQueueSlots);
    expect(hardware.psuLevel).toBe(V1_HARDWARE_LIMITS.psuLevel);

    const state = stateWithHardware((baseHardware) => baseHardware);
    const purchased = applyAction(state, {
      type: "buyCustomMachine",
      components,
    });
    expect(purchased.systems.at(-1)?.hardware.cores).toBe(512);

    const invalidComponents = {
      ...components,
      cpuPackageCount: V1_HARDWARE_LIMITS.cpuPackages + 1,
    };
    expect(getMachineSelectionBlockedReason(state, invalidComponents)).toContain(
      "CPU package count",
    );
    const rejected = applyAction(purchased, {
      type: "buyCustomMachine",
      components: invalidComponents,
    });
    expect(rejected.systems).toHaveLength(purchased.systems.length);
  });

  it("caps fully simulated Fleet systems and exposes a public purchase blocker", () => {
    const base = stateWithHardware((hardware) => hardware);
    const source = base.systems[0]!;
    const systems = Array.from(
      { length: V1_HARDWARE_LIMITS.inspectedSystems },
      (_, index) => ({
        ...source,
        id: index + 1,
        name: `Inspected ${index + 1}`,
      }),
    );
    const capped = {
      ...base,
      selectedSystemId: 1,
      rack: { nextSystemId: V1_HARDWARE_LIMITS.inspectedSystems + 1 },
      systems,
    };
    const creditsAtCap = capped.exactResources.credits;

    const rejected = applyAction(capped, {
      type: "buyMachineTemplate",
      templateId: "starterNode",
    });
    const visible = deriveVisibleState(rejected);

    expect(rejected.systems).toHaveLength(V1_HARDWARE_LIMITS.inspectedSystems);
    expect(rejected.exactResources.credits).toBe(creditsAtCap);
    expect(visible.machineBuilder.canBuy).toBe(false);
    expect(visible.machineBuilder.blockedReason).toContain(
      `${V1_HARDWARE_LIMITS.inspectedSystems} fully simulated systems`,
    );
    expect(
      visible.machineBuilder.templates.every(
        (template) => template.canBuy === false && template.blockedReason !== null,
      ),
    ).toBe(true);
  });

  it("normalizes oversized save-v7 hardware arrays and derived levels for every system", () => {
    const base = createInitialGameState();
    const oversizedCpus = Array.from({ length: 20 }, (_, cpuIndex) => ({
      ...createCpuHardwareState(
        cpuIndex + 1,
        Array.from({ length: 100 }, (_, coreIndex) => cpuIndex * 100 + coreIndex + 1),
      ),
      level: 999,
      cacheLevel: 999,
      cacheSpeedLevel: 999,
      cacheBits: 1e300,
      cacheBytes: 1e300,
      schedulerSlots: 999,
    }));
    const oversizedRam = Array.from({ length: 100 }, (_, index) => ({
      ...createRamStickState(index + 1, 1),
      level: 999,
      speedLevel: 999,
      bits: 1e300,
      bytes: 1e300,
    }));
    const oversizedHardware = {
      ...base.hardware,
      cpus: oversizedCpus,
      cores: 2_000,
      cacheLevel: 999,
      cacheSpeedLevel: 999,
      cacheBits: 1e300,
      cacheBytes: 1e300,
      schedulerSlots: 999,
      systemSchedulerSlots: 999,
      deadlockRecoveryLevel: 999,
      ramLevel: 999,
      ramSpeedLevel: 999,
      ramSticks: oversizedRam,
      memoryVoltageLevel: 999,
      cronScheduleSlots: 999,
      cronIntervalLevel: 999,
      cStateLevel: 999,
      psuLevel: 999,
      psuWatts: 1e300,
    };
    const raw = JSON.stringify({
      version: 7,
      savedAt: new Date(0).toISOString(),
      savedAtMs: 0,
      departedAtMs: null,
      state: {
        ...base,
        hardware: oversizedHardware,
        systems: Array.from(
          { length: V1_HARDWARE_LIMITS.inspectedSystems + 10 },
          (_, index) => ({
            ...base.systems[0]!,
            id: index + 1,
            name: `Oversized ${index + 1}`,
            hardware: oversizedHardware,
          }),
        ),
      },
    });
    const restored = deserializeSave(raw);

    expect(restored.systems).toHaveLength(V1_HARDWARE_LIMITS.inspectedSystems);

    for (const hardware of [
      restored.hardware,
      ...restored.systems.map((system) => system.hardware),
    ]) {
      expect(hardware.cpus).toHaveLength(V1_HARDWARE_LIMITS.cpuPackages);
      expect(hardware.cpus.every((cpu) => cpu.coreIds.length === 64)).toBe(true);
      expect(hardware.cores).toBe(512);
      expect(hardware.cpus.every((cpu) => cpu.level === 36)).toBe(true);
      expect(hardware.cpus.every((cpu) => cpu.cacheLevel === 36)).toBe(true);
      expect(hardware.cpus.every((cpu) => cpu.cacheSpeedLevel === 36)).toBe(true);
      expect(hardware.cpus.every((cpu) => cpu.schedulerSlots === 64)).toBe(true);
      expect(hardware.systemSchedulerSlots).toBe(24);
      expect(hardware.deadlockRecoveryLevel).toBe(10);
      expect(hardware.ramSticks).toHaveLength(32);
      expect(hardware.ramSticks.every((stick) => stick.level === 144)).toBe(true);
      expect(hardware.ramSticks.every((stick) => stick.speedLevel === 144)).toBe(true);
      expect(hardware.memoryVoltageLevel).toBe(36);
      expect(hardware.cronScheduleSlots).toBe(1);
      expect(hardware.cronIntervalLevel).toBe(59);
      expect(hardware.cStateLevel).toBe(36);
      expect(hardware.psuLevel).toBe(64);
      expect(hardware.psuWatts).toBe(getPsuWatts(64));
    }
  });
});
