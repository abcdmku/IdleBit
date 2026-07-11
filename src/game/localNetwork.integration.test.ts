import { describe, expect, it } from "vitest";
import {
  amountSubtract,
  amountToSafeNumber,
  exactResourceBag,
} from "./amount";
import { applyAction } from "./simulation";
import { createInitialGameState, createSystemState } from "./progression";
import { deriveVisibleState } from "./selectors";
import { deserializeSave, serializeSave } from "./save";
import { getSystemHardwareWorkRates } from "./systemHardwareWork";
import { replaceSystems, syncSelectedSystemRuntime } from "./systems";
import type { GameState } from "./types";

const richResources = exactResourceBag("1e9", "1e6");

const createNetworkReadyState = (systems = 1): GameState => {
  const initial = createInitialGameState();
  let state: GameState = {
    ...initial,
    exactResources: richResources,
    resources: {
      credits: amountToSafeNumber(richResources.credits),
      data: amountToSafeNumber(richResources.data),
    },
    campaign: {
      ...initial.campaign,
      currentChapterId: "localFabric",
      completedChapterIds: [
        "bootstrapNode",
        "coherentMachine",
        "workshopFleet",
      ],
    },
  };
  state = syncSelectedSystemRuntime(state);
  if (systems > 1) {
    const second = createSystemState(2, "Network Node", "network-test", {
      ...state.hardware,
      psuWatts: 1_000,
    });
    state = replaceSystems(state, [...state.systems, second], 1);
  }
  return state;
};

describe("per-system local network hardware", () => {
  it("stays unavailable until Local Fabric is reached", () => {
    const before = createInitialGameState();
    const after = applyAction(before, {
      type: "installLocalNetwork",
      skuId: "gigabitNic",
    });

    expect(after.infrastructure.fleetNodes[0]?.networkSkuId).toBe(
      "networkNone",
    );
    expect(deriveVisibleState(after).workshop.networkUnlocked).toBe(false);
  });

  it("charges the exact SKU cost and supplies real ingress/egress rates", () => {
    const before = createNetworkReadyState();
    const after = applyAction(before, {
      type: "installLocalNetwork",
      skuId: "gigabitNic",
    });

    expect(
      amountSubtract(
        before.exactResources.credits,
        after.exactResources.credits,
      ),
    ).toBe("12000");
    expect(after.infrastructure.fleetNodes[0]?.networkSkuId).toBe(
      "gigabitNic",
    );
    expect(getSystemHardwareWorkRates(after, 1).networkIngress).toBe(
      "1000000000",
    );
    expect(getSystemHardwareWorkRates(after, 1).networkEgress).toBe(
      "1000000000",
    );
    const visible = deriveVisibleState(after).workshop;
    expect(visible.networkSkuId).toBe("gigabitNic");
    expect(
      visible.networkSkus.find((sku) => sku.id === "gigabitNic")?.installed,
    ).toBe(true);
  });

  it("changes only the addressed machine", () => {
    const before = createNetworkReadyState(2);
    const after = applyAction(before, {
      type: "installLocalNetwork",
      skuId: "fabricNic",
      systemId: 2,
    });

    const nodeFor = (systemId: number) =>
      after.infrastructure.fleetNodes.find(
        (node) =>
          node.source.kind === "system" && node.source.systemId === systemId,
      );
    expect(nodeFor(1)?.networkSkuId).toBe("networkNone");
    expect(nodeFor(2)?.networkSkuId).toBe("fabricNic");
    expect(getSystemHardwareWorkRates(after, 1, false).networkEgress).toBe("0");
    expect(getSystemHardwareWorkRates(after, 2, false).networkEgress).toBe(
      "100000000000",
    );
  });

  it("preserves the installed NIC as saved hardware provenance", () => {
    const installed = applyAction(createNetworkReadyState(), {
      type: "installLocalNetwork",
      skuId: "gigabitNic",
    });
    const restored = deserializeSave(serializeSave(installed));

    expect(restored.infrastructure.fleetNodes[0]?.networkSkuId).toBe(
      "gigabitNic",
    );
    expect(getSystemHardwareWorkRates(restored, 1, false).networkEgress).toBe(
      "1000000000",
    );
  });
});
