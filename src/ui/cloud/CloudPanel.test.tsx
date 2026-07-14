import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { amount } from "../../game/amount";
import {
  advanceCloud,
  commissionCloudRegion,
  commissionCloudZone,
  createCloudState,
  placeCloudReplica,
  setCloudRegionalDemand,
  startCloudSla,
  startPlanetaryFinale,
} from "../../game/cloud";
import { getVisibleCloudState } from "../../game/cloudSelectors";
import { CloudPanel } from "./CloudPanel";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const regionalCloud = () => {
  let state = createCloudState();
  state = commissionCloudRegion(state, "Prairie");
  state = commissionCloudZone(state, {
    regionId: "region-1",
    facilityId: "facility-a",
    name: "Prairie A",
    capacityPerSecond: amount("1e309"),
    faultDomainId: "grid-a",
  });
  state = commissionCloudZone(state, {
    regionId: "region-1",
    facilityId: "facility-b",
    name: "Prairie B",
    capacityPerSecond: amount("1e309"),
    faultDomainId: "grid-b",
  });
  state = placeCloudReplica(state, "zone-2");
  state = placeCloudReplica(state, "zone-3");
  state = setCloudRegionalDemand(state, "region-1", amount("1e309"));
  return state;
};

describe("CloudPanel", () => {
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

  it("shows exact zone capacity and exposes explicit failover and SLA actions", () => {
    const onRequestFailover = vi.fn();
    const onStartSla = vi.fn();
    const visible = getVisibleCloudState(regionalCloud());

    act(() => {
      root.render(
        <CloudPanel
          visible={visible}
          availableFacilities={[]}
          planetaryAvailable={false}
          onCommissionRegion={() => undefined}
          onCommissionZone={() => undefined}
          onPlaceReplica={() => undefined}
          onSetRegionalDemand={() => undefined}
          onSetRoutingLinks={() => undefined}
          onSetFailoverPolicy={() => undefined}
          onDrawIncident={() => undefined}
          onRequestFailover={onRequestFailover}
          onStartSla={onStartSla}
          onStartFinale={() => undefined}
          onSelectCharter={() => undefined}
        />,
      );
    });

    expect(container.textContent).toContain("1e309 ops/s");
    expect(container.textContent).toContain("1/1 healthy");
    const failover = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Request failover"),
    );
    const startSla = Array.from(container.querySelectorAll("button")).find(
      (button) => button.title.includes("Regional Continuity Window"),
    );
    expect(failover?.disabled).toBe(false);
    expect(startSla?.disabled).toBe(false);

    act(() => {
      failover?.click();
      startSla?.click();
    });
    expect(onRequestFailover).toHaveBeenCalledOnce();
    expect(onStartSla).toHaveBeenCalledWith("regionalContinuity");
  });

  it("uses the game-owned finale blocker and can-start decision verbatim", () => {
    const onStartFinale = vi.fn();
    const base = getVisibleCloudState(regionalCloud());
    const blockedReason =
      "Requires positive flow on explicit routes connecting four served regions.";
    const blocked = {
      ...base,
      finale: {
        ...base.finale,
        canStart: false,
        blockedReason,
      },
    };
    const render = (visible: typeof base, planetaryAvailable: boolean) => (
      <CloudPanel
        visible={visible}
        availableFacilities={[]}
        planetaryAvailable={planetaryAvailable}
        onCommissionRegion={() => undefined}
        onCommissionZone={() => undefined}
        onPlaceReplica={() => undefined}
        onSetRegionalDemand={() => undefined}
        onSetRoutingLinks={() => undefined}
        onSetFailoverPolicy={() => undefined}
        onDrawIncident={() => undefined}
        onRequestFailover={() => undefined}
        onStartSla={() => undefined}
        onStartFinale={onStartFinale}
        onSelectCharter={() => undefined}
      />
    );

    act(() => root.render(render(blocked, true)));
    let finale = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Start finale"));
    expect(finale?.disabled).toBe(true);
    expect(finale?.title).toBe(blockedReason);
    expect(container.textContent).toContain(blockedReason);
    act(() => finale?.click());
    expect(onStartFinale).not.toHaveBeenCalled();

    const ready = {
      ...base,
      finale: { ...base.finale, canStart: true, blockedReason: null },
    };
    act(() => root.render(render(ready, true)));
    finale = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Start finale"));
    expect(finale?.disabled).toBe(false);
    expect(finale?.title).toBe("Start the planetary finale");
    act(() => finale?.click());
    expect(onStartFinale).toHaveBeenCalledOnce();

    // Chapter gate: before the Planetary Commons chapter, the entire section
    // (finale control, blockers, charter choices) must be absent.
    act(() => root.render(render(ready, false)));
    expect(container.querySelector(".planetary-command")).toBeNull();
    expect(container.textContent).not.toContain("Planetary Commons");
    expect(container.textContent).not.toContain("Start finale");
    expect(container.querySelector(".cloud-charter-grid")).toBeNull();
  });

  it("renders live SLA telemetry and gates charters until the finale completes", () => {
    const active = advanceCloud(
      startCloudSla(regionalCloud(), "regionalContinuity"),
      60_000,
    ).state;
    const onStartFinale = vi.fn();

    act(() => {
      root.render(
        <CloudPanel
          visible={getVisibleCloudState(startPlanetaryFinale(active))}
          availableFacilities={[]}
          planetaryAvailable
          onCommissionRegion={() => undefined}
          onCommissionZone={() => undefined}
          onPlaceReplica={() => undefined}
          onSetRegionalDemand={() => undefined}
          onSetRoutingLinks={() => undefined}
          onSetFailoverPolicy={() => undefined}
          onDrawIncident={() => undefined}
          onRequestFailover={() => undefined}
          onStartSla={() => undefined}
          onStartFinale={onStartFinale}
          onSelectCharter={() => undefined}
        />,
      );
    });

    expect(container.textContent).toContain("Regional Continuity Window");
    expect(container.textContent).toContain("window left");
    expect(container.textContent).toContain("observation");
    expect(container.textContent).toContain("availability");
    expect(
      container.querySelector('[role="progressbar"][aria-label*="work progress"]'),
    ).not.toBeNull();
    const charters = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '.cloud-charter-grid button',
      ),
    );
    expect(charters).toHaveLength(3);
    expect(charters.every((button) => button.disabled)).toBe(true);
    expect(container.textContent).toContain("Regional bootstrap");
  });

  it("exposes topology, demand, replica, policy, routing, and opt-in incident controls", () => {
    let state = createCloudState();
    state = commissionCloudRegion(state, "Prairie");
    state = commissionCloudRegion(state, "Coast");
    const onCommissionRegion = vi.fn();
    const onCommissionZone = vi.fn();
    const onSetRegionalDemand = vi.fn();
    const onSetRoutingLinks = vi.fn();
    const onSetFailoverPolicy = vi.fn();
    const onDrawIncident = vi.fn();

    act(() => {
      root.render(
        <CloudPanel
          visible={getVisibleCloudState(state)}
          availableFacilities={[
            {
              id: "facility-a",
              name: "Prairie Edge",
              capacityPerSecond: amount("1e309"),
            },
          ]}
          planetaryAvailable={false}
          onCommissionRegion={onCommissionRegion}
          onCommissionZone={onCommissionZone}
          onPlaceReplica={() => undefined}
          onSetRegionalDemand={onSetRegionalDemand}
          onSetRoutingLinks={onSetRoutingLinks}
          onSetFailoverPolicy={onSetFailoverPolicy}
          onDrawIncident={onDrawIncident}
          onRequestFailover={() => undefined}
          onStartSla={() => undefined}
          onStartFinale={() => undefined}
          onSelectCharter={() => undefined}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const regionButton = buttons.find((button) => button.textContent?.includes("Commission region"));
    const zoneButton = buttons.find((button) => button.textContent?.includes("Commission zone"));
    const demandButton = buttons.find((button) => button.textContent?.includes("Apply demand"));
    const routeButton = buttons.find((button) => button.textContent?.includes("Add/update route"));
    const automatic = container.querySelector<HTMLInputElement>('input[type="checkbox"]');

    act(() => {
      regionButton?.click();
      zoneButton?.click();
      demandButton?.click();
      routeButton?.click();
      automatic?.click();
    });

    expect(onCommissionRegion).toHaveBeenCalledWith("Regional Edge");
    expect(onCommissionZone).toHaveBeenCalledWith(
      expect.objectContaining({
        regionId: "region-1",
        facilityId: "facility-a",
        faultDomainId: "grid-a",
        baseLatencyMs: 25,
      }),
    );
    expect(onSetRegionalDemand).toHaveBeenCalledWith("region-1", amount(0));
    expect(onSetRoutingLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        from: "region-1",
        to: "region-2",
        capacity: amount("1000000000"),
      }),
    ]);
    expect(onSetFailoverPolicy).toHaveBeenCalledWith(false, 30_000);
    expect(onDrawIncident).not.toHaveBeenCalled();
  });
});
