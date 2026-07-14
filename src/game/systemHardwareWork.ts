import { ZERO_AMOUNT, amountAdd, amountCompare, amountMultiply } from "./amount";
import { deriveSystemCapacityProfile } from "./capacity";
import {
  createHardwareWorkRates,
  type HardwareWorkRates,
  type HardwareWorkRecipe,
  type HardwareWorkResourceId,
} from "./hardwareWork";
import {
  getCacheLoadRate,
  getEffectiveCoreClockHz,
  getInstalledRamSticks,
  getRamChannelCount,
  getRamLoadRate,
} from "./math";
import { getAllCoreIds } from "./progression";
import { materializeSystem } from "./systems";
import type { GameState } from "./types";

/** Stateful adapter kept separate from dependency-free hardware recipe math. */
export const getSystemHardwareWorkRates = (
  state: GameState,
  systemId: number,
  requirePowered = true,
): HardwareWorkRates => {
  if (!state.systems.some((system) => system.id === systemId)) {
    return createHardwareWorkRates();
  }
  const local = materializeSystem(state, systemId);
  if (requirePowered && local.power.state !== "on") {
    return createHardwareWorkRates();
  }
  const fleetNode = state.infrastructure.fleetNodes.find(
    (node) => node.source.kind === "system" && node.source.systemId === systemId,
  );
  const storageSkuId = fleetNode?.storageSkuId ?? local.workshop.storageSkuId;
  const networkSkuId = fleetNode?.networkSkuId ?? "networkNone";
  const profile = deriveSystemCapacityProfile(
    state,
    systemId,
    storageSkuId,
    networkSkuId,
  );
  const compute = getAllCoreIds(local).reduce(
    (total, coreId) => amountAdd(total, getEffectiveCoreClockHz(local, coreId)),
    ZERO_AMOUNT,
  );
  const cache = local.hardware.cpus.reduce((total, cpu) => {
    const firstCoreId = cpu.coreIds[0];
    return firstCoreId === undefined
      ? total
      : amountAdd(total, getCacheLoadRate(local, firstCoreId));
  }, ZERO_AMOUNT);
  const installedStickCount = getInstalledRamSticks(local).length;
  const usableRamChannels = Math.min(
    getRamChannelCount(local),
    installedStickCount,
  );
  const ram = usableRamChannels > 0
    ? amountMultiply(getRamLoadRate(local), usableRamChannels)
    : ZERO_AMOUNT;

  return createHardwareWorkRates({
    cache,
    ram,
    compute,
    storageRead: profile.rates.storageRead,
    storageWrite: profile.rates.storageWrite,
    networkIngress: profile.rates.networkIngress,
    networkEgress: profile.rates.networkEgress,
  });
};

const workResourceLabel: Record<HardwareWorkResourceId, string> = {
  cache: "cache",
  ram: "RAM",
  compute: "compute",
  storageRead: "storage-read",
  storageWrite: "storage-write",
  networkIngress: "network-ingress",
  networkEgress: "network-egress",
};

/**
 * Lane-blocker check shared by projects and contracts: a target system that
 * cannot move one of the recipe's authored stages yields an explicit reason
 * instead of a fake ETA. Rates are sampled without the power requirement so
 * the reason names the missing hardware path rather than the power state.
 */
export const getSystemWorkThroughputBlockedReason = (
  state: GameState,
  systemId: number,
  recipe: HardwareWorkRecipe,
): string | null => {
  const system = state.systems.find((candidate) => candidate.id === systemId);
  if (!system) return "Assigned system is unavailable.";
  const rates = getSystemHardwareWorkRates(state, systemId, false);
  const blockedStage = recipe.stages.find(
    (stage) =>
      amountCompare(stage.work, 0) > 0 &&
      amountCompare(rates[stage.resource], 0) <= 0,
  );
  return blockedStage
    ? `${system.name} has no ${workResourceLabel[blockedStage.resource]} throughput.`
    : null;
};
