import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { amount, exactResourceBag } from "../../game/amount";
import { withExactResources } from "../../game/economy";
import { normalizeFacilityInfrastructureForGameState } from "../../game/facilityInfrastructure";
import { createInitialGameState } from "../../game/progression";
import { deriveVisibleState } from "../../game/selectors";
import { applyAction } from "../../game/simulation";
import type { GameState } from "../../game/types";
import { InfrastructurePanel } from "./InfrastructurePanel";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const facilityReady = () => {
  const initial = createInitialGameState();
  let state: GameState = normalizeFacilityInfrastructureForGameState(
    withExactResources(
      {
        ...initial,
        campaign: {
          ...initial.campaign,
          currentChapterId: "rackAndFacility",
          currentObjectiveId: "facility:rack-controller",
        },
        automationBuffer: {
          ...initial.automationBuffer,
          ownedLevelId: "rackController",
          departureLevelId: "rackController",
        },
        infrastructure: {
          ...initial.infrastructure,
          fleetNodes: initial.infrastructure.fleetNodes.map((node) => ({
            ...node,
            managed: true,
          })),
        },
      },
      exactResourceBag("1000000000000", "1000000000000"),
    ),
  );
  state = applyAction(state, {
    type: "commissionFacility",
    templateId: "workshopFacility",
    name: "Prairie Room",
  });
  state = applyAction(state, {
    type: "commissionFacilityRack",
    facilityId: state.infrastructure.facilities[0]!.id,
    templateId: "halfRack",
    name: "Compute A",
  });
  return state;
};

const workloadReady = () => {
  const initial = createInitialGameState();
  let state = withExactResources(
    {
      ...initial,
      campaign: {
        ...initial.campaign,
        currentChapterId: "localFabric",
        currentObjectiveId: "fabric:cluster-controller",
      },
      automationBuffer: {
        ...initial.automationBuffer,
        ownedLevelId: "clusterController",
        departureLevelId: "clusterController",
      },
      flags: { ...initial.flags, systemCatalog: true },
      research: {
        ...initial.research,
        completed: [...initial.research.completed, "systemCatalog" as const],
      },
    },
    exactResourceBag("1000000000000", "1000000000000"),
  );
  for (let index = 0; index < 2; index += 1) {
    state = applyAction(state, {
      type: "purchaseAggregateServerBatch",
      skuId: "workshopServer",
      count: 1,
      storageSkuId: "localSsd",
      networkSkuId: "gigabitNic",
    });
  }
  const nodeIds = state.infrastructure.fleetNodes
    .filter((node) => node.managed)
    .map((node) => node.id);
  state = applyAction(state, {
    type: "commissionCluster",
    name: "Projection Fabric",
    nodeIds,
    replicaFaultDomain: "node",
  });
  return applyAction(state, {
    type: "startClusterWorkload",
    clusterId: state.infrastructure.clusters[0]!.id,
    definitionId: "replicatedShardCommit",
  });
};

describe("InfrastructurePanel", () => {
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

  it("shows Fleet/facility capacity and uses explicit commission and placement controls", () => {
    const state = facilityReady();
    const visible = deriveVisibleState(state).infrastructure;
    const onCommissionCluster = vi.fn();
    const onCommissionFacility = vi.fn();
    const onPlaceNode = vi.fn();

    act(() => {
      root.render(
        <InfrastructurePanel
          visible={visible}
          resources={state.exactResources}
          onCommissionCluster={onCommissionCluster}
          onSetClusterFaultDomain={() => undefined}
          onStartWorkload={() => undefined}
          onCancelWorkload={() => undefined}
          onSetWorkloadWeight={() => undefined}
          onCommissionFacility={onCommissionFacility}
          onCommissionRack={() => undefined}
          onPlaceNode={onPlaceNode}
          onRemoveNode={() => undefined}
        />,
      );
    });

    expect(container.textContent).toContain("Prairie Room");
    expect(container.textContent).toContain("Compute A");
    expect(container.textContent).toContain("1 ops/s");
    const facilityButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Workshop Server Room"),
    );
    const nodeToggle = container.querySelector<HTMLInputElement>(
      '.cluster-builder input[type="checkbox"]',
    );
    const clusterButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Commission cluster"),
    );
    const placement = container.querySelector<HTMLSelectElement>(
      ".rack-placement-control select",
    );

    expect(facilityButton?.disabled).toBe(false);
    expect(
      facilityButton?.querySelector('[aria-label="500000 credits"]'),
    ).not.toBeNull();
    const halfRackButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Workshop Half Rack"));
    expect(halfRackButton?.disabled).toBe(false);
    expect(
      halfRackButton?.querySelector('[aria-label="100000 credits"]'),
    ).not.toBeNull();

    act(() => {
      facilityButton?.click();
      nodeToggle?.click();
    });
    act(() => clusterButton?.click());
    act(() => {
      if (placement) {
        placement.value = "fleet-node-1";
        placement.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(onCommissionFacility).toHaveBeenCalledWith("workshopFacility");
    expect(onCommissionCluster).toHaveBeenCalledWith("Local Fabric", [
      "fleet-node-1",
    ]);
    expect(onPlaceNode).toHaveBeenCalledWith(
      state.infrastructure.facilities[0]!.id,
      "rack-1",
      "fleet-node-1",
    );
  });

  it("compacts exact facility and rack operating rates", () => {
    const state = facilityReady();
    const base = deriveVisibleState(state).infrastructure;
    const repeatingRate = amount(`19079.${"9".repeat(1_019)}`);
    const visible = {
      ...base,
      facilities: base.facilities.map((facility, index) =>
        index === 0
          ? {
              ...facility,
              operatingCost: {
                ...facility.operatingCost,
                totalPerSecond: repeatingRate,
              },
              racks: facility.racks.map((rack) => ({
                ...rack,
                operatingCostPerSecond: repeatingRate,
              })),
            }
          : facility,
      ),
    };

    act(() => {
      root.render(
        <InfrastructurePanel
          visible={visible}
          resources={state.exactResources}
          onCommissionCluster={() => undefined}
          onSetClusterFaultDomain={() => undefined}
          onStartWorkload={() => undefined}
          onCancelWorkload={() => undefined}
          onSetWorkloadWeight={() => undefined}
          onCommissionFacility={() => undefined}
          onCommissionRack={() => undefined}
          onPlaceNode={() => undefined}
          onRemoveNode={() => undefined}
        />,
      );
    });

    expect(container.textContent?.match(/19,080 cr\/s/g)).toHaveLength(2);
    expect(container.textContent).not.toContain("19079.999999");
  });

  it("renders the game-owned active workload projection", () => {
    const state = workloadReady();
    act(() => {
      root.render(
        <InfrastructurePanel
          visible={deriveVisibleState(state).infrastructure}
          resources={state.exactResources}
          onCommissionCluster={() => undefined}
          onSetClusterFaultDomain={() => undefined}
          onStartWorkload={() => undefined}
          onCancelWorkload={() => undefined}
          onSetWorkloadWeight={() => undefined}
          onCommissionFacility={() => undefined}
          onCommissionRack={() => undefined}
          onPlaceNode={() => undefined}
          onRemoveNode={() => undefined}
        />,
      );
    });

    const projection = container.querySelector(".workload-projection");
    expect(projection?.getAttribute("aria-label")).toContain(
      "workload projection",
    );
    expect(projection?.textContent).toContain("Duration");
    expect(projection?.textContent).toContain("Operating");
    expect(projection?.textContent).toContain("Net");
    expect(projection?.textContent).toContain("Margin");
    expect(projection?.textContent).toContain("Buffer");
  });

  it("keeps node replica policy usable while The Archivist clearly gates rack and zone policies", () => {
    const state = workloadReady();
    const onSetClusterFaultDomain = vi.fn();
    const renderPanel = (current: GameState) => {
      root.render(
        <InfrastructurePanel
          visible={deriveVisibleState(current).infrastructure}
          resources={current.exactResources}
          onCommissionCluster={() => undefined}
          onSetClusterFaultDomain={onSetClusterFaultDomain}
          onStartWorkload={() => undefined}
          onCancelWorkload={() => undefined}
          onSetWorkloadWeight={() => undefined}
          onCommissionFacility={() => undefined}
          onCommissionRack={() => undefined}
          onPlaceNode={() => undefined}
          onRemoveNode={() => undefined}
        />,
      );
    };

    act(() => renderPanel(state));

    let replicaPolicy = container.querySelector<HTMLSelectElement>(
      ".cluster-card select",
    );
    let nodeOption = replicaPolicy?.querySelector<HTMLOptionElement>(
      'option[value="node"]',
    );
    let rackOption = replicaPolicy?.querySelector<HTMLOptionElement>(
      'option[value="rack"]',
    );
    let zoneOption = replicaPolicy?.querySelector<HTMLOptionElement>(
      'option[value="zone"]',
    );

    expect(nodeOption?.disabled).toBe(false);
    expect(rackOption?.disabled).toBe(true);
    expect(zoneOption?.disabled).toBe(true);
    expect(rackOption?.textContent).toContain("The Archivist");
    expect(zoneOption?.textContent).toContain("The Archivist");

    act(() => {
      if (!replicaPolicy) return;
      replicaPolicy.value = "node";
      replicaPolicy.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSetClusterFaultDomain).toHaveBeenCalledWith(
      state.infrastructure.clusters[0]!.id,
      "node",
    );

    const unlocked: GameState = {
      ...state,
      projects: {
        ...state.projects,
        completedProjectIds: ["archivist"],
      },
    };
    onSetClusterFaultDomain.mockClear();
    act(() => renderPanel(unlocked));

    replicaPolicy = container.querySelector<HTMLSelectElement>(
      ".cluster-card select",
    );
    nodeOption = replicaPolicy?.querySelector<HTMLOptionElement>(
      'option[value="node"]',
    );
    rackOption = replicaPolicy?.querySelector<HTMLOptionElement>(
      'option[value="rack"]',
    );
    zoneOption = replicaPolicy?.querySelector<HTMLOptionElement>(
      'option[value="zone"]',
    );

    expect(nodeOption?.disabled).toBe(false);
    expect(rackOption?.disabled).toBe(false);
    expect(zoneOption?.disabled).toBe(false);
    expect(rackOption?.textContent).toBe("Rack");
    expect(zoneOption?.textContent).toBe("Zone");

    act(() => {
      if (!replicaPolicy) return;
      replicaPolicy.value = "rack";
      replicaPolicy.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSetClusterFaultDomain).toHaveBeenCalledWith(
      state.infrastructure.clusters[0]!.id,
      "rack",
    );
  });

  it("shows Grid Relief's exact operating discount only after completion", () => {
    const state = facilityReady();
    const renderPanel = (current: GameState) => {
      root.render(
        <InfrastructurePanel
          visible={deriveVisibleState(current).infrastructure}
          resources={current.exactResources}
          onCommissionCluster={() => undefined}
          onSetClusterFaultDomain={() => undefined}
          onStartWorkload={() => undefined}
          onCancelWorkload={() => undefined}
          onSetWorkloadWeight={() => undefined}
          onCommissionFacility={() => undefined}
          onCommissionRack={() => undefined}
          onPlaceNode={() => undefined}
          onRemoveNode={() => undefined}
        />,
      );
    };

    act(() => renderPanel(state));
    expect(container.textContent).not.toContain("Grid Relief");
    expect(container.textContent).toContain("1 facilities");
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.includes("Workshop Server Room"),
      )?.disabled,
    ).toBe(false);

    const relieved: GameState = {
      ...state,
      projects: {
        ...state.projects,
        completedProjectIds: ["gridRelief"],
      },
    };
    act(() => renderPanel(relieved));

    expect(container.textContent).toContain("Grid Relief · -20% operating");
    expect(container.textContent).not.toContain("Grid Relief · -0% operating");
  });

  it("exposes an explicit removal action for a placed node", () => {
    let state = facilityReady();
    const facilityId = state.infrastructure.facilities[0]!.id;
    state = applyAction(state, {
      type: "placeFleetNodeInRack",
      facilityId,
      rackId: "rack-1",
      nodeId: "fleet-node-1",
    });
    const onRemoveNode = vi.fn();

    act(() => {
      root.render(
        <InfrastructurePanel
          visible={deriveVisibleState(state).infrastructure}
          resources={state.exactResources}
          onCommissionCluster={() => undefined}
          onSetClusterFaultDomain={() => undefined}
          onStartWorkload={() => undefined}
          onCancelWorkload={() => undefined}
          onSetWorkloadWeight={() => undefined}
          onCommissionFacility={() => undefined}
          onCommissionRack={() => undefined}
          onPlaceNode={() => undefined}
          onRemoveNode={onRemoveNode}
        />,
      );
    });

    const remove = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Remove",
    );
    act(() => remove?.click());
    expect(onRemoveNode).toHaveBeenCalledWith("fleet-node-1");
  });

  it("shows exact capital costs and enables affordable commissions", () => {
    const state = facilityReady();
    const onCommissionFacility = vi.fn();
    const onCommissionRack = vi.fn();

    act(() => {
      root.render(
        <InfrastructurePanel
          visible={deriveVisibleState(state).infrastructure}
          resources={exactResourceBag("599999", "1000000000000")}
          onCommissionCluster={() => undefined}
          onSetClusterFaultDomain={() => undefined}
          onStartWorkload={() => undefined}
          onCancelWorkload={() => undefined}
          onSetWorkloadWeight={() => undefined}
          onCommissionFacility={onCommissionFacility}
          onCommissionRack={onCommissionRack}
          onPlaceNode={() => undefined}
          onRemoveNode={() => undefined}
        />,
      );
    });

    const facilityButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Workshop Server Room"));
    const halfRackButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Workshop Half Rack"));

    expect(facilityButton?.disabled).toBe(false);
    expect(facilityButton?.title).toBe("Commission Workshop Server Room");
    expect(
      facilityButton?.querySelector('[aria-label="500000 credits"]'),
    ).not.toBeNull();
    expect(halfRackButton?.disabled).toBe(false);
    expect(halfRackButton?.title).toBe("Commission Workshop Half Rack");
    expect(
      halfRackButton?.querySelector('[aria-label="100000 credits"]'),
    ).not.toBeNull();

    act(() => {
      facilityButton?.click();
      halfRackButton?.click();
    });
    expect(onCommissionFacility).toHaveBeenCalledWith("workshopFacility");
    expect(onCommissionRack).toHaveBeenCalledWith("facility-2", "halfRack");
  });
});
