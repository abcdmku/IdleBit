import { ZERO_AMOUNT, amountAdd, amountMultiply } from "./amount";
import { deriveSystemCapacityProfile } from "./capacity";
import {
  createHardwareWorkRates,
  type HardwareWorkRates,
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
