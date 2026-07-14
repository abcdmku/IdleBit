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

/** Compact tiles carry their action as aria-label; chunky buttons as text. */
const getButton = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (button) =>
      button.getAttribute("aria-label") === label ||
      button.textContent?.trim() === label,
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

    expect(container.querySelector(".workshop-section")).toBeNull();
  });

  it("shows only the Storage card when storage is unlocked before thermal", () => {
    const base = makeWorkshopVisible();
    const visible: VisibleState = {
      ...base,
      workshop: {
        ...base.workshop,
        thermalVisible: false,
        specializedComputeUnlocked: false,
      },
    };

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={() => undefined} />);
    });

    // The Storage section is reachable on its own…
    expect(container.querySelector(".workshop-storage-section")).not.toBeNull();
    expect(container.textContent).toContain("Local SSD");

    // …while every thermal-only card stays hidden until thermal reveals.
    expect(container.querySelector(".workshop-thermal-section")).toBeNull();
    expect(container.querySelector(".workshop-overclock-section")).toBeNull();
    expect(container.querySelector(".workshop-accelerator-section")).toBeNull();
    expect(container.querySelector(".workshop-evidence")).toBeNull();
  });

  it("renders locked cards with the board's paid-outline pattern", () => {
    const base = makeWorkshopVisible();
    const visible: VisibleState = {
      ...base,
      workshop: {
        ...base.workshop,
        storageUnlocked: false,
        specializedComputeUnlocked: false,
      },
    };

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={() => undefined} />);
    });

    const storage = container.querySelector(".workshop-storage-section");
    expect(storage?.className).toContain("locked-system-section");
    expect(storage?.textContent).toContain("Research System Catalog");

    const accelerators = container.querySelector(
      ".workshop-accelerator-section",
    );
    expect(accelerators?.className).toContain("locked-system-section");
    expect(accelerators?.textContent).toContain("Research Specialized Compute");
    // Evidence gating is unchanged: it stays visible whenever thermal is.
    expect(accelerators?.querySelector(".workshop-evidence")).not.toBeNull();
  });

  it("shows exact thermal telemetry, costs, blockers, and tuning actions", () => {
    const visible = makeWorkshopVisible();
    const dispatch = vi.fn<Dispatch>();

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={dispatch} />);
    });

    const thermal = container.querySelector<HTMLElement>(
      ".workshop-thermal-section",
    );
    expect(thermal?.textContent).toContain("Critical");
    expect(thermal?.textContent).toContain("105% load");
    expect(thermal?.textContent).toContain("987.5 W");
    // Non-currency readouts clamp to tenths: 875.25 W renders as 875.2 W.
    expect(thermal?.textContent).toContain("875.2 W");
    expect(thermal?.textContent).toContain("50%");
    expect(container.querySelector('[title="500000 credits"]')).not.toBeNull();
    expect(container.querySelector('[title="40 data"]')).not.toBeNull();

    const fanButton = getButton(container, "Install Fan Cooling");
    expect(fanButton?.disabled).toBe(true);
    // The blocked tier's reason is reachable by screen readers and shown in
    // the merged thermal card's reserved note line.
    expect(fanButton?.getAttribute("aria-describedby")).toBe(
      "cooling-fanCooling-blocker",
    );
    expect(
      container.querySelector("#cooling-fanCooling-blocker")?.textContent,
    ).toBe("Install Passive Heatsink first.");
    expect(
      container.querySelector(".workshop-thermal-section .workshop-note")
        ?.textContent,
    ).toBe("Install Passive Heatsink first.");

    // Each dial segment carries the full trade-off in its tooltip.
    const boost = getButton(container, "Select Boost");
    expect(boost?.title).toContain("Clock 110%");
    expect(boost?.title).toContain("Power 125%");
    expect(boost?.title).toContain("Heat 130%");

    act(() => getButton(container, "Install Passive Heatsink")?.click());
    act(() => getButton(container, "Select Boost")?.click());

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "installCoolingTier",
      tierId: "passiveHeatsink",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "setOverclockPreset",
      presetId: "boost",
    });
  });

  it("offers lower cooling tiers as downgrades with the refund inline", () => {
    const base = makeWorkshopVisible();
    const visible: VisibleState = {
      ...base,
      workshop: {
        ...base.workshop,
        coolingTiers: base.workshop.coolingTiers.map((tier) => {
          if (tier.id === "passiveHeatsink") {
            return {
              ...tier,
              installed: true,
              canInstall: false,
              blockedReason: "Cooling tier is already installed.",
            };
          }
          if (tier.id === "none") {
            return {
              ...tier,
              installed: false,
              canInstall: true,
              blockedReason: null,
              refunds: [{ resource: "credits", amount: amount("250000") }],
            };
          }
          return tier;
        }),
      },
    };
    const dispatch = vi.fn<Dispatch>();

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={dispatch} />);
    });

    const downgrade = getButton(container, "Downgrade to No Cooling");
    expect(downgrade?.disabled).toBe(false);
    expect(downgrade?.title).toBe(
      "Downgrade to No Cooling: refund 250 K credits",
    );
    // The refund renders as a gain, never dimmed by the current balance.
    const refundToken = downgrade?.querySelector(".resource-token");
    expect(refundToken?.getAttribute("aria-label")).toBe("+250000 credits");
    expect(refundToken?.className).not.toContain("dimmed");

    act(() => downgrade?.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "installCoolingTier",
      tierId: "none",
    });
  });

  it("shows thermal telemetry with a research note before cooling controls unlock", () => {
    const base = makeWorkshopVisible();
    const visible: VisibleState = {
      ...base,
      workshop: { ...base.workshop, thermalControlsUnlocked: false },
    };

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={() => undefined} />);
    });

    const thermal = container.querySelector(".workshop-thermal-section");
    expect(thermal?.textContent).toContain("Critical");
    expect(thermal?.querySelector(".workshop-rail")).toBeNull();
    expect(thermal?.textContent).toContain(
      "Research Thermal Control to install cooling",
    );
  });

  it("exposes device specifications, routes, fallback reasons, and evidence", () => {
    const visible = makeWorkshopVisible();
    const dispatch = vi.fn<Dispatch>();

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={dispatch} />);
    });

    expect(
      container.querySelector(".workshop-accelerator-section .hw-section-meta")
        ?.textContent,
    ).toContain("2 / 4");
    // The installed device occupies its slot span; free slots stay visible.
    const device = container.querySelector(".workshop-slot-device");
    expect(device?.textContent).toContain("Raster GPU 8");
    expect(device?.getAttribute("title")).toContain("Slots 1-2");
    expect(container.querySelectorAll(".workshop-slot-empty")).toHaveLength(2);

    expect(container.textContent).toContain("68 B bits");
    expect(container.textContent).toContain("4 B ops/s");
    // Supported workloads live in the catalog tile tooltip, not on the tile.
    expect(
      Array.from(container.querySelectorAll(".workshop-bay-tile")).some(
        (tile) => tile.getAttribute("title")?.includes("inference · ML batch"),
      ),
    ).toBe(true);
    expect(container.textContent).toContain("CPU fallback");
    expect(container.textContent).toContain("compatible accelerator is busy");
    expect(container.textContent).toContain("No contiguous expansion slots.");
    expect(container.textContent).toContain("GPU render 3");
    expect(container.textContent).toContain("NPU inference 1");
    expect(container.textContent).toContain("Specialization complete");
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
    // Unlocked tiles swap the blocker tooltip for the spec tooltip.
    expect(tensorGpu?.title).not.toContain(blocker);
    expect(tensorGpu?.title).toContain("CPU rate");
    expect(batchNpu?.title).not.toContain(blocker);
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

  it("shows exact storage capacity, throughput, cost, and workload actions", () => {
    const visible = makeWorkshopVisible();
    const dispatch = vi.fn<Dispatch>();

    act(() => {
      root.render(<WorkshopPanel visible={visible} dispatch={dispatch} />);
    });

    const storage = container.querySelector(".workshop-storage-section");
    expect(storage).not.toBeNull();
    expect(storage?.textContent).toContain("Artifact Staging Pass");
    expect(container.querySelector('[title="8000000000000 bits"]')).not.toBeNull();
    expect(container.querySelector('[title="4000000000 bit/s"]')).not.toBeNull();
    expect(container.querySelector('[title="30000 credits"]')).not.toBeNull();
    expect(container.querySelector('[title="6000 ms"]')).not.toBeNull();

    // Power/heat move into the drive tile's tooltip with exact values.
    const ssd = getButton(container, "Install Local SSD");
    expect(ssd?.title).toMatch(/Pwr \S+→\S+ W · Heat \S+→\S+ W/);

    // Reward detail lives in the Net tile's tooltip.
    expect(
      container.querySelector('[title*="Reward 75 M Credits · 64 Data"]'),
    ).not.toBeNull();

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

    expect(container.querySelector(".workshop-network-section")).not.toBeNull();
    expect(container.textContent).toContain("Gigabit NIC");
    expect(container.querySelector('[title="1000000000 bit/s"]')).not.toBeNull();
    expect(container.querySelector('[title="12000 credits"]')).not.toBeNull();

    act(() => getButton(container, "Install Gigabit NIC")?.click());
    expect(dispatch).toHaveBeenCalledWith({
      type: "installLocalNetwork",
      skuId: "gigabitNic",
    });
  });

  it("keeps segment and workload card geometry fixed across install, blocked, and active states", () => {
    // Geometry fingerprint (jsdom cannot measure pixels): a tile's visible
    // child skeleton must be identical in every state — the sr-only blocker
    // span is the only conditional child and it never affects layout.
    const visibleChildren = (element: Element) =>
      Array.from(element.children)
        .filter((child) => !child.classList.contains("sr-only"))
        .map((child) => `${child.tagName}.${child.className.split(" ")[0]}`);

    const renderVisible = (visible: VisibleState) => {
      act(() => {
        root.render(<WorkshopPanel visible={visible} dispatch={() => undefined} />);
      });
    };

    // Installable, blocked, and installed cooling tiers share one skeleton.
    renderVisible(makeWorkshopVisible());
    const installable = getButton(container, "Install Passive Heatsink")!;
    const segmentShape = visibleChildren(installable);
    const blocked = getButton(container, "Install Fan Cooling")!;
    expect(visibleChildren(blocked)).toEqual(segmentShape);

    const base = makeWorkshopVisible();
    renderVisible({
      ...base,
      workshop: {
        ...base.workshop,
        coolingTiers: base.workshop.coolingTiers.map((tier) =>
          tier.id === "passiveHeatsink"
            ? { ...tier, installed: true, canInstall: false, blockedReason: null }
            : tier,
        ),
      },
    });
    const installed = getButton(container, "Passive Heatsink installed")!;
    expect(visibleChildren(installed)).toEqual(segmentShape);
    expect(installed.getAttribute("aria-pressed")).toBe("true");
    expect(installed.className).toContain("is-active");

    // Storage bay tiles share the same skeleton whether buyable or blocked.
    renderVisible(makeWorkshopVisible());
    const bayTiles = Array.from(
      container.querySelectorAll(".workshop-storage-section .workshop-bay-tile"),
    );
    expect(bayTiles.length).toBeGreaterThan(1);
    const bayShape = visibleChildren(bayTiles[0]!);
    for (const tile of bayTiles) {
      expect(visibleChildren(tile)).toEqual(bayShape);
    }

    // Staging workload: the progress meter stays mounted while idle and the
    // block keeps the same skeleton once staging starts.
    const workload = container.querySelector(".workshop-workload")!;
    const idleShape = visibleChildren(workload);
    expect(workload.querySelector(".workshop-storage-progress")).not.toBeNull();

    const active = makeWorkshopVisible();
    renderVisible({
      ...active,
      workshop: {
        ...active.workshop,
        storageWorkload: {
          ...active.workshop.storageWorkload,
          active: true,
          progressBps: 4200,
        },
      },
    });
    const stagingWorkload = container.querySelector(".workshop-workload")!;
    expect(visibleChildren(stagingWorkload)).toEqual(idleShape);
    expect(getButton(container, "Cancel staging")).not.toBeUndefined();
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
