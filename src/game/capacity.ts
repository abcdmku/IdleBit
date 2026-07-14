import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMax,
  amountMultiply,
  amountSubtract,
  amountToSafeNumber,
  type Amount,
} from "./amount";
import {
  getNetworkSkuDefinition,
  getServerSkuDefinition,
  getStorageSkuDefinition,
} from "./infrastructureDefinitions";
import { getHardwareDrawWatts } from "./math";
import {
  getCoreClockHz,
  getEffectiveCpuEfficiency,
  getCpuForCore,
  getExactRamCapacityBits,
} from "./progression";
import { materializeSystem } from "./systems";
import type {
  CapacityProfile,
  FleetNodeState,
  RateResourceId,
} from "./infrastructureTypes";
import type { GameState } from "./types";

export const rateResourceIds: readonly RateResourceId[] = [
  "compute",
  "storageRead",
  "storageWrite",
  "networkIngress",
  "networkEgress",
] as const;

export const createEmptyCapacityProfile = (): CapacityProfile => ({
  rates: {
    compute: ZERO_AMOUNT,
    storageRead: ZERO_AMOUNT,
    storageWrite: ZERO_AMOUNT,
    networkIngress: ZERO_AMOUNT,
    networkEgress: ZERO_AMOUNT,
  },
  memoryBits: ZERO_AMOUNT,
  storageBits: ZERO_AMOUNT,
  idleWatts: ZERO_AMOUNT,
  peakWatts: ZERO_AMOUNT,
});

export const normalizeCapacityProfile = (
  profile: CapacityProfile,
): CapacityProfile => ({
  rates: Object.fromEntries(
    rateResourceIds.map((resource) => [
      resource,
      amountClampMin(profile.rates[resource]),
    ]),
  ) as CapacityProfile["rates"],
  memoryBits: amountClampMin(profile.memoryBits),
  storageBits: amountClampMin(profile.storageBits),
  idleWatts: amountClampMin(profile.idleWatts),
  peakWatts: amountMax(
    amountClampMin(profile.peakWatts),
    amountClampMin(profile.idleWatts),
  ),
});

export const addCapacityProfiles = (
  left: CapacityProfile,
  right: CapacityProfile,
): CapacityProfile =>
  normalizeCapacityProfile({
    rates: Object.fromEntries(
      rateResourceIds.map((resource) => [
        resource,
        amountAdd(left.rates[resource], right.rates[resource]),
      ]),
    ) as CapacityProfile["rates"],
    memoryBits: amountAdd(left.memoryBits, right.memoryBits),
    storageBits: amountAdd(left.storageBits, right.storageBits),
    idleWatts: amountAdd(left.idleWatts, right.idleWatts),
    peakWatts: amountAdd(left.peakWatts, right.peakWatts),
  });

export const sumCapacityProfiles = (
  profiles: readonly CapacityProfile[],
): CapacityProfile =>
  profiles.reduce(addCapacityProfiles, createEmptyCapacityProfile());

export const scaleCapacityProfile = (
  profile: CapacityProfile,
  multiplier: number | string | Amount,
): CapacityProfile => {
  const scale = amount(multiplier);
  if (amountCompare(scale, 0) < 0) {
    throw new Error("Capacity scale must be non-negative");
  }
  return normalizeCapacityProfile({
    rates: Object.fromEntries(
      rateResourceIds.map((resource) => [
        resource,
        amountMultiply(profile.rates[resource], scale),
      ]),
    ) as CapacityProfile["rates"],
    memoryBits: amountMultiply(profile.memoryBits, scale),
    storageBits: amountMultiply(profile.storageBits, scale),
    idleWatts: amountMultiply(profile.idleWatts, scale),
    peakWatts: amountMultiply(profile.peakWatts, scale),
  });
};

export const subtractCapacityProfiles = (
  total: CapacityProfile,
  reserved: CapacityProfile,
): CapacityProfile =>
  normalizeCapacityProfile({
    rates: Object.fromEntries(
      rateResourceIds.map((resource) => [
        resource,
        amountClampMin(
          amountSubtract(total.rates[resource], reserved.rates[resource]),
        ),
      ]),
    ) as CapacityProfile["rates"],
    memoryBits: amountClampMin(amountSubtract(total.memoryBits, reserved.memoryBits)),
    storageBits: amountClampMin(amountSubtract(total.storageBits, reserved.storageBits)),
    idleWatts: amountClampMin(amountSubtract(total.idleWatts, reserved.idleWatts)),
    peakWatts: amountClampMin(amountSubtract(total.peakWatts, reserved.peakWatts)),
  });

const capacityDimensions = (profile: CapacityProfile) => [
  ...rateResourceIds.map((resource) => profile.rates[resource]),
  profile.memoryBits,
  profile.storageBits,
  profile.peakWatts,
];

export const getCapacityUtilizationBps = (
  total: CapacityProfile,
  reserved: CapacityProfile,
) => {
  const ratios = capacityDimensions(total).map((capacity, index) => {
    const used = capacityDimensions(reserved)[index] ?? ZERO_AMOUNT;
    if (amountCompare(capacity, 0) <= 0) {
      return amountCompare(used, 0) > 0 ? 10_000 : 0;
    }
    return Math.round(
      amountToSafeNumber(amountMultiply(amountDivide(used, capacity), 10_000)),
    );
  });
  return Math.min(10_000, Math.max(0, ...ratios));
};

const getPhysicalComputeRate = (state: GameState) => {
  let compute = ZERO_AMOUNT;
  let activeCpuWatts = ZERO_AMOUNT;
  for (const cpu of state.hardware.cpus) {
    for (const coreId of cpu.coreIds) {
      const clock = amount(getCoreClockHz(state, coreId));
      const coreCpu = getCpuForCore(state, coreId);
      const efficiency = amount(
        getEffectiveCpuEfficiency(state, coreCpu.tierId, coreCpu.level),
      );
      compute = amountAdd(compute, clock);
      activeCpuWatts = amountAdd(
        activeCpuWatts,
        amountDivide(amountDivide(clock, efficiency), "1000000"),
      );
    }
  }
  return { compute, activeCpuWatts };
};

/**
 * The measured system profile is a pure function of (state, systemId, SKUs)
 * and is requested repeatedly per snapshot/tick — once per contract, project,
 * fleet node and work projection touching the system — while each computation
 * re-materializes the system and runs per-core exact math. Cache by state
 * identity (game state is updated immutably) so repeated requests within one
 * state generation are free.
 */
const systemCapacityProfileCache = new WeakMap<
  GameState,
  Map<string, CapacityProfile>
>();

export const deriveSystemCapacityProfile = (
  state: GameState,
  systemId: number,
  storageSkuId: FleetNodeState["storageSkuId"] = "storageNone",
  networkSkuId: FleetNodeState["networkSkuId"] = "networkNone",
): CapacityProfile => {
  let byKey = systemCapacityProfileCache.get(state);
  if (!byKey) {
    byKey = new Map();
    systemCapacityProfileCache.set(state, byKey);
  }
  const key = `${systemId}|${storageSkuId}|${networkSkuId}`;
  const cached = byKey.get(key);
  if (cached) return cached;
  const profile = computeSystemCapacityProfile(
    state,
    systemId,
    storageSkuId,
    networkSkuId,
  );
  byKey.set(key, profile);
  return profile;
};

const computeSystemCapacityProfile = (
  state: GameState,
  systemId: number,
  storageSkuId: FleetNodeState["storageSkuId"],
  networkSkuId: FleetNodeState["networkSkuId"],
): CapacityProfile => {
  const local = materializeSystem(state, systemId);
  if (!local.systems.some((system) => system.id === systemId)) {
    return createEmptyCapacityProfile();
  }
  const idleState: GameState = {
    ...local,
    workshop: {
      ...local.workshop,
      // The Fleet node profile adds its mirrored storage SKU below. Remove the
      // same device from the measured system baseline to avoid double-counting
      // its idle and peak power.
      storageSkuId: "storageNone",
      activeStorageWorkload: null,
    },
    activeTasks: [],
    activeJobs: [],
    queue: [],
    queueEntries: [],
    cron: { ...local.cron, queuePowerSpikeSeconds: 0 },
    power: {
      ...local.power,
      state: "on",
      transitionSeconds: 0,
      transitionTotalSeconds: 0,
    },
  };
  const { compute, activeCpuWatts } = getPhysicalComputeRate(idleState);
  const idleWatts = amount(getHardwareDrawWatts(idleState));
  const base = normalizeCapacityProfile({
    ...createEmptyCapacityProfile(),
    rates: { ...createEmptyCapacityProfile().rates, compute },
    // Exact stick aggregation: hardware.ramBits is a Number projection that
    // silently rounds away small sticks once any stick reaches ~2^53 bits.
    memoryBits: getExactRamCapacityBits(idleState.hardware.ramSticks),
    idleWatts,
    // Conservative until component-level peak profiles arrive: retain the full
    // measured idle/non-CPU baseline, then add every core's active draw.
    peakWatts: amountAdd(idleWatts, activeCpuWatts),
  });
  return sumCapacityProfiles([
    base,
    getStorageSkuDefinition(storageSkuId).profile,
    getNetworkSkuDefinition(networkSkuId).profile,
  ]);
};

export const deriveAggregateServerCapacityProfile = (
  skuId: Extract<FleetNodeState["source"], { kind: "aggregate" }>["skuId"],
  count: number,
  storageSkuId: FleetNodeState["storageSkuId"],
  networkSkuId: FleetNodeState["networkSkuId"],
): CapacityProfile =>
  scaleCapacityProfile(
    sumCapacityProfiles([
      getServerSkuDefinition(skuId).profile,
      getStorageSkuDefinition(storageSkuId).profile,
      getNetworkSkuDefinition(networkSkuId).profile,
    ]),
    count,
  );

export const getFleetNodeCapacityProfile = (
  state: GameState,
  node: FleetNodeState,
): CapacityProfile =>
  node.source.kind === "system"
    ? deriveSystemCapacityProfile(
        state,
        node.source.systemId,
        node.storageSkuId,
        node.networkSkuId,
      )
    : deriveAggregateServerCapacityProfile(
        node.source.skuId,
        node.source.count,
        node.storageSkuId,
        node.networkSkuId,
      );

export const getFleetNodeCapacityName = (
  state: GameState,
  node: FleetNodeState,
) => {
  if (node.source.kind === "aggregate") {
    return `${getServerSkuDefinition(node.source.skuId).name} ×${node.source.count}`;
  }
  const systemId = node.source.systemId;
  return (
    state.systems.find((system) => system.id === systemId)?.name ??
    `System ${systemId}`
  );
};
