import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  amount,
  createInitialGameState,
  deriveVisibleState,
  exactResourceBag,
  type VisibleState,
} from "../../game";
import { HardwareBoard } from "../HardwareBoard";
import type { Dispatch } from "../uiActions";
import { WorkshopPanel } from "./WorkshopPanel";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const getButton = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label,
  );

const makeWorkshopVisible = (): VisibleState => {
  const base = deriveVisibleState(createInitialGameState());
  const coolingTiers = base.workshop.coolingTiers.map((tier) => {
    if (tier.id === "passiveHeatsink") {
      return { ...tier, canInstall: true, blockedReason: null };
    }
    if (tier.id === "fanCooling") {
      return {
        ...tier,
        canInstall: false,
        blockedReason: "Install Passive Heatsink first.",
      };
    }
    return tier;
  });
  const overclockPresets = base.workshop.overclockPresets.map((preset) =>
    preset.id === "boost"
      ? { ...preset, canSelect: true, blockedReason: null }
      : preset,
  );
  const acceleratorSkus = base.workshop.acceleratorSkus.map((sku) => {
    if (sku.id === "npuEdge4") {
      return { ...sku, canInstall: true, blockedReason: null };
    }
    if (sku.id === "gpuTensor24") {
      return {
        ...sku,
        canInstall: false,
        blockedReason: "No contiguous expansion slots.",
      };
    }
    return { ...sku, canInstall: true, blockedReason: null };
  });
  const storageSkus = base.workshop.storageSkus.map((sku) =>
    sku.id === "localSsd"
      ? { ...sku, canInstall: true, blockedReason: null }
      : sku,
  );

  return {
    ...base,
    exactResources: exactResourceBag("999999999999999999999", "999999"),
    workshop: {
      ...base.workshop,
      thermalVisible: true,
      thermalControlsUnlocked: true,
      specializedComputeUnlocked: true,
      thermalStatus: "critical",
      highestObservedThermalStatus: "critical",
      thermalStressBps: 10_500,
      thermalThroughputModifierBps: 5_000,
      generatedHeatWatts: amount("987.5"),
      sustainedHeatWatts: amount("875.25"),
      coolingCapacityWatts: amount("650"),
      coolingPowerWatts: amount("12"),
      coolingTiers,
      overclockPresets,
      expansionSlots: 4,
      accelerators: [
        {
          id: "system-7-accelerator-1",
          slotId: 1,
          skuId: "gpuRaster8",
          kind: "gpu",
          name: "Raster GPU 8",
          expansionSlots: 2,
          active: true,
        },
      ],
      acceleratorSkus,
      storageUnlocked: true,
      storageSkus,
      storageWorkload: {
        ...base.workshop.storageWorkload,
        canStart: true,
        blockedReason: null,
        projection: {
          durationMs: amount("6000"),
          operatingCostCredits: amount("48000000"),
          netRewardCredits: amount("27000000"),
          bufferCovered: true,
          pauseReason: null,
        },
      },
      routes: [
        {
          workloadId: "render-work:0",
          taskInstanceId: "render-work",
          taskId: "renderFrame",
          coreId: 1,
          operationId: "shadeTiles",
          workloadClass: "render",
          target: "accelerator",
          deviceId: "system-7-accelerator-1",
          skuId: "gpuRaster8",
          acceleratorKind: "gpu",
          fallbackReason: null,
        },
        {
          workloadId: "inference-work:0",
          taskInstanceId: "inference-work",
          taskId: "inferenceBatch",
          coreId: 2,
          operationId: "runInferenceBatch",
          workloadClass: "inference",
          target: "cpu",
          deviceId: null,
          skuId: null,
          acceleratorKind: null,
          fallbackReason: "accelerator-contention",
        },
      ],
      evidence: {
        gpuRenderCompletions: 3,
        npuInferenceCompletions: 1,
      },
      specializationComplete: true,
    },
  };
};

describe("WorkshopPanel public controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("stays absent until thermal observation reveals the Workshop", () => {
    const visible = deriveVisibleState(createInitialGameState());

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={() => undefined} />);
    });

    expect(container.querySelector(".workshop-panel")).toBeNull();
  });

  it("shows exact thermal telemetry, costs, blockers, and tuning actions", () => {
    const visible = makeWorkshopVisible();
    const dispatch = vi.fn<Dispatch>();

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={dispatch} />);
    });

    const panel = container.querySelector<HTMLElement>(".workshop-panel");
    expect(panel?.textContent).toContain("Critical");
    expect(panel?.textContent).toContain("105% load");
    expect(panel?.textContent).toContain("987.5 W");
    expect(panel?.textContent).toContain("875.25 W");
    expect(panel?.textContent).toContain("50%");
    expect(panel?.querySelector('[title="500000 credits"]')).not.toBeNull();
    expect(panel?.querySelector('[title="40 data"]')).not.toBeNull();

    const fanButton = getButton(panel!, "Install Fan Cooling");
    expect(fanButton?.disabled).toBe(true);
    expect(panel?.textContent).toContain("Install Passive Heatsink first.");
    expect(panel?.textContent).toContain("Clock");
    expect(panel?.textContent).toContain("Power");
    expect(panel?.textContent).toContain("Heat");

    act(() => getButton(panel!, "Install Passive Heatsink")?.click());
    act(() => getButton(panel!, "Select Boost")?.click());

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "installCoolingTier",
      tierId: "passiveHeatsink",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "setOverclockPreset",
      presetId: "boost",
    });
  });

  it("lazily exposes device specifications, routes, fallback reasons, and evidence", () => {
    const visible = makeWorkshopVisible();
    const dispatch = vi.fn<Dispatch>();

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={dispatch} />);
    });

    expect(container.textContent).not.toContain("Raster GPU 8");
    act(() => getButton(container, "Accelerators")?.click());

    expect(container.textContent).toContain("2 / 4 slots used");
    expect(container.textContent).toContain("Raster GPU 8");
    expect(container.textContent).toContain("68 B bits");
    expect(container.textContent).toContain("4 B ops/s");
    expect(container.textContent).toContain("Roles inference · ML batch");
    expect(container.textContent).toContain("CPU fallback");
    expect(container.textContent).toContain("compatible accelerator is busy");
    expect(container.textContent).toContain("No contiguous expansion slots.");
    expect(container.textContent).toContain("GPU render 3");
    expect(container.textContent).toContain("NPU inference 1");
    expect(container.textContent).toContain("Fleet specialization complete");
    expect(container.querySelector('[title="650000 credits"]')).not.toBeNull();

    act(() => getButton(container, "Install Edge NPU 4")?.click());
    const remove = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label")?.startsWith("Remove Raster GPU 8"),
    );
    act(() => remove?.click());

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "installAccelerator",
      skuId: "npuEdge4",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "removeAccelerator",
      deviceId: "system-7-accelerator-1",
    });
  });

  it("keeps entry modules usable while Open Foundry clearly gates advanced accelerators", () => {
    const blocker =
      "Complete Open Foundry to unlock advanced accelerator modules.";
    const makeOpenFoundryVisible = (completed: boolean): VisibleState => {
      const visible = makeWorkshopVisible();
      return {
        ...visible,
        workshop: {
          ...visible.workshop,
          expansionSlots: 4,
          accelerators: [],
          acceleratorSkus: visible.workshop.acceleratorSkus.map((sku) =>
            sku.id === "gpuTensor24" || sku.id === "npuBatch16"
              ? {
                  ...sku,
                  canInstall: completed,
                  blockedReason: completed ? null : blocker,
                }
              : sku.id === "npuEdge4"
                ? { ...sku, canInstall: true, blockedReason: null }
                : sku,
          ),
        },
      };
    };
    const dispatch = vi.fn<Dispatch>();

    act(() => {
      root.render(
        <WorkshopPanel
          visible={makeOpenFoundryVisible(false)}
          dispatch={dispatch}
        />,
      );
    });
    act(() => getButton(container, "Accelerators")?.click());

    let tensorGpu = getButton(container, "Install Tensor GPU 24");
    let batchNpu = getButton(container, "Install Batch NPU 16");
    const entryNpu = getButton(container, "Install Edge NPU 4");
    expect(entryNpu?.disabled).toBe(false);
    expect(tensorGpu?.disabled).toBe(true);
    expect(batchNpu?.disabled).toBe(true);
    expect(tensorGpu?.title).toBe(blocker);
    expect(batchNpu?.title).toBe(blocker);
    for (const button of [tensorGpu, batchNpu]) {
      const blockerId = button?.getAttribute("aria-describedby");
      expect(blockerId).not.toBeNull();
      expect(container.querySelector(`#${blockerId}`)?.textContent).toBe(blocker);
    }

    act(() => entryNpu?.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "installAccelerator",
      skuId: "npuEdge4",
    });

    dispatch.mockClear();
    act(() => {
      root.render(
        <WorkshopPanel
          visible={makeOpenFoundryVisible(true)}
          dispatch={dispatch}
        />,
      );
    });

    tensorGpu = getButton(container, "Install Tensor GPU 24");
    batchNpu = getButton(container, "Install Batch NPU 16");
    expect(tensorGpu?.disabled).toBe(false);
    expect(batchNpu?.disabled).toBe(false);
    expect(tensorGpu?.title).toBe("Install Tensor GPU 24");
    expect(batchNpu?.title).toBe("Install Batch NPU 16");
    expect(tensorGpu?.hasAttribute("aria-describedby")).toBe(false);
    expect(batchNpu?.hasAttribute("aria-describedby")).toBe(false);

    act(() => tensorGpu?.click());
    act(() => batchNpu?.click());
    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "installAccelerator",
      skuId: "gpuTensor24",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "installAccelerator",
      skuId: "npuBatch16",
    });
  });

  it("shows exact storage capacity, throughput, power, heat, cost, and workload actions", () => {
    const visible = makeWorkshopVisible();
    const dispatch = vi.fn<Dispatch>();

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={dispatch} />);
    });
    act(() => getButton(container, "Storage")?.click());

    expect(container.textContent).toContain("Managed storage");
    expect(container.textContent).toContain("Artifact Staging Pass");
    expect(container.querySelector('[title="8000000000000 bits"]')).not.toBeNull();
    expect(container.querySelector('[title="4000000000 bit/s"]')).not.toBeNull();
    expect(container.querySelector('[title="8 W"]')).not.toBeNull();
    expect(container.querySelector('[title="6.8 W"]')).not.toBeNull();
    expect(container.querySelector('[title="30000 credits"]')).not.toBeNull();
    expect(container.querySelector('[title="6000 ms"]')).not.toBeNull();
    expect(container.textContent).toContain("Reward 75 M Credits · 64 Data");

    act(() => getButton(container, "Install Local SSD")?.click());
    act(() => getButton(container, "Start Artifact Staging Pass")?.click());

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "installWorkshopStorage",
      skuId: "localSsd",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "startWorkshopStorageWorkload",
      workloadId: "artifactStaging",
    });
  });

  it("reveals a per-system NIC bay at Local Fabric and dispatches the exact SKU", () => {
    const base = makeWorkshopVisible();
    const visible: VisibleState = {
      ...base,
      workshop: {
        ...base.workshop,
        networkUnlocked: true,
        networkSkus: base.workshop.networkSkus.map((sku) =>
          sku.id === "gigabitNic"
            ? { ...sku, canInstall: true, blockedReason: null }
            : sku,
        ),
      },
    };
    const dispatch = vi.fn<Dispatch>();

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={dispatch} />);
    });
    act(() => getButton(container, "Data paths")?.click());

    expect(container.textContent).toContain("Managed network");
    expect(container.querySelector('[title="1000000000 bit/s"]')).not.toBeNull();
    expect(container.querySelector('[title="12000 credits"]')).not.toBeNull();

    act(() => getButton(container, "Install Gigabit NIC")?.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "installLocalNetwork",
      skuId: "gigabitNic",
    });
  });

  it("uses HardwareBoard's inspected-system dispatch scope", () => {
    const systemVisible = makeWorkshopVisible();
    const baseSummary = systemVisible.rack.systems[0]!;
    const visible = {
      ...systemVisible,
      flags: { ...systemVisible.flags, systemCatalog: true },
      rack: {
        ...systemVisible.rack,
        unlocked: true,
        selectedSystemId: 7,
        systems: [
          {
            ...baseSummary,
            id: 7,
            name: "Render Node",
            selected: true,
            visible: systemVisible,
          },
        ],
      },
    } as unknown as VisibleState;
    const dispatch = vi.fn<Dispatch>();

    act(() => {
      root.render(
        <HardwareBoard
          visible={visible}
          dispatch={dispatch}
          selectedComponent="system:7::core:1"
          onSelectComponent={() => undefined}
        />,
      );
    });
    act(() => getButton(container, "Install Passive Heatsink")?.click());
    act(() => getButton(container, "Storage")?.click());
    act(() => getButton(container, "Install Local SSD")?.click());

    expect(dispatch).toHaveBeenCalledWith({
      type: "installCoolingTier",
      tierId: "passiveHeatsink",
      systemId: 7,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "installWorkshopStorage",
      skuId: "localSsd",
      systemId: 7,
    });
  });
});
