import {
  bitsToBytes,
  createCoreSchedulers,
  createSystemState,
  getRamSpeedMt,
  syncCoreSchedulers,
  syncHardwarePackages,
} from "./progression";
import { withGlobalBootloaderLevel } from "./bootloader";
import { withGlobalCStateLevel } from "./cState";
import {
  normalizeWorkshopSystemState,
  syncWorkshopHardwareProjection,
} from "./workshop";
import { amountCompare, exactCost, ZERO_AMOUNT } from "./amount";
import { V1_HARDWARE_LIMITS } from "./hardwareLimits";
import type {
  Cost,
  GameState,
  HardwareState,
  RamStickState,
  SystemState,
} from "./types";

const getRamStickBits = (ramSticks: RamStickState[]) =>
  ramSticks.reduce((total, stick) => total + stick.bits, 0);

const normalizePurchaseCosts = (value: unknown): Cost[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const resource = (entry as { resource?: unknown }).resource;
        const rawAmount = (entry as { amount?: unknown }).amount;
        if (resource !== "credits" && resource !== "data") return [];
        if (typeof rawAmount !== "string" && typeof rawAmount !== "number") {
          return [];
        }
        try {
          const cost = exactCost(resource, rawAmount);
          return amountCompare(cost.amount, ZERO_AMOUNT) >= 0 ? [cost] : [];
        } catch {
          return [];
        }
      })
    : [];

const limitInspectedSystems = (systems: readonly SystemState[]) =>
  systems.slice(0, V1_HARDWARE_LIMITS.inspectedSystems);

export const getFleetSystemLimitBlockedReason = (state: GameState) =>
  (state.systems?.length ?? 0) >= V1_HARDWARE_LIMITS.inspectedSystems
    ? `A v1 Fleet supports at most ${V1_HARDWARE_LIMITS.inspectedSystems} fully simulated systems; expand through cluster and facility capacity.`
    : null;

const preserveRuntimeRamOverride = (hardware: HardwareState): HardwareState => {
  const ramSticks = hardware.ramSticks ?? [];
  const ramBits = Math.max(0, hardware.ramBits ?? getRamStickBits(ramSticks));
  if (ramBits === getRamStickBits(ramSticks)) return hardware;

  const speedLevel = Math.max(1, hardware.ramSpeedLevel ?? ramSticks[0]?.speedLevel ?? 1);
  const ramBytes = bitsToBytes(ramBits);

  return {
    ...hardware,
    ramLevel: ramBits > 0 ? 1 : 0,
    ramBits,
    ramBytes,
    ramSpeedLevel: speedLevel,
    ramSpeedMt: getRamSpeedMt(speedLevel),
    ramSticks:
      ramBits > 0
        ? [
            {
              id: ramSticks[0]?.id ?? 1,
              level: Math.max(1, ramSticks[0]?.level ?? hardware.ramLevel ?? 1),
              bits: ramBits,
              bytes: ramBytes,
              speedLevel,
              speedMt: getRamSpeedMt(speedLevel),
            },
          ]
        : [],
  };
};

type PartialPowerRuntimeState = Partial<SystemState["power"]> & {
  creditShutdownWarningSeconds?: number;
};

const normalizeSystemPower = (system: SystemState): SystemState["power"] => {
  const fallback = createSystemState(system.id).power;
  const power = system.power as PartialPowerRuntimeState | undefined;
  const powerState =
    power?.state === "shuttingDown" ||
    power?.state === "off" ||
    power?.state === "booting"
      ? power.state
      : fallback.state;

  return {
    ...fallback,
    ...power,
    state: powerState,
    idlePolicy:
      power?.idlePolicy === "shutdown-when-idle"
        ? "shutdown-when-idle"
        : "low-power",
    transitionSeconds: Math.max(
      0,
      power?.transitionSeconds ?? fallback.transitionSeconds,
    ),
    transitionTotalSeconds: Math.max(
      0,
      power?.transitionTotalSeconds ??
        fallback.transitionTotalSeconds ??
        power?.transitionSeconds ??
        0,
    ),
    bootstrapGraceSeconds: Math.max(
      0,
      power?.bootstrapGraceSeconds ?? fallback.bootstrapGraceSeconds,
    ),
    unpaidShutdownWarningSeconds: Math.max(
      0,
      power?.unpaidShutdownWarningSeconds ??
        power?.creditShutdownWarningSeconds ??
        fallback.unpaidShutdownWarningSeconds,
    ),
    overloadFailureSeconds: Math.max(
      0,
      power?.overloadFailureSeconds ?? fallback.overloadFailureSeconds,
    ),
    lastFailureReason:
      power?.lastFailureReason === "psuOverload" ||
      power?.lastFailureReason === "unpaidBill"
        ? power.lastFailureReason
        : null,
    failureCount: Math.max(0, power?.failureCount ?? fallback.failureCount),
  };
};

const getSystemRuntime = (_state: GameState, system: SystemState): SystemState => {
  const workshop = normalizeWorkshopSystemState(system.workshop, system.hardware);
  const hardware = syncWorkshopHardwareProjection(
    syncHardwarePackages({
    ..._state,
    hardware: withGlobalBootloaderLevel(
      _state,
      withGlobalCStateLevel(_state, system.hardware),
    ),
    }).hardware,
    workshop,
  );
  return {
    ...system,
    hardware,
    workshop,
    power: normalizeSystemPower(system),
    activeJobs: system.activeTasks,
    coreSchedulers:
      Object.keys(system.coreSchedulers).length > 0
        ? system.coreSchedulers
        : createCoreSchedulers(system.hardware.cores),
    purchaseCosts: normalizePurchaseCosts(system.purchaseCosts),
    queueEntries: Array.isArray(system.queueEntries) ? system.queueEntries : [],
  };
};

export const createSystemFromRuntime = (
  state: GameState,
  id = state.selectedSystemId,
  name = `System ${id}`,
  templateId: string | null = null,
  purchaseCosts: Cost[] = [],
): SystemState => {
  const workshop = normalizeWorkshopSystemState(state.workshop, state.hardware);
  const hardware = syncWorkshopHardwareProjection(
    syncHardwarePackages({
    ...state,
    hardware: withGlobalBootloaderLevel(
      state,
      withGlobalCStateLevel(
        state,
        preserveRuntimeRamOverride(state.hardware),
      ),
    ),
    }).hardware,
    workshop,
  );
  return {
    id,
    name,
    templateId,
    hardware,
    workshop,
    power: state.power,
    cron: state.cron,
    activeTasks: state.activeTasks,
    activeJobs: state.activeTasks,
    cacheResidency: state.cacheResidency,
    coreSchedulers: state.coreSchedulers,
    queue: state.queue,
    queueEntries: state.queueEntries ?? [],
    deadlockPressureSeconds: state.deadlockPressureSeconds,
    deadlockPressureResource: state.deadlockPressureResource,
    deadlockPressureCpuId: state.deadlockPressureCpuId,
    deadlockProcessLockout: state.deadlockProcessLockout,
    purchaseCosts: normalizePurchaseCosts(purchaseCosts),
  };
};

export const ensureSystems = (state: GameState): GameState => {
  const existingSystems =
    state.systems && state.systems.length > 0
      ? limitInspectedSystems(state.systems)
      : [createSystemFromRuntime(state, 1, "Barebones PC", "barebonesPc")];
  const systems = existingSystems.map((system) => getSystemRuntime(state, system));
  const selectedSystemId = systems.some((system) => system.id === state.selectedSystemId)
    ? state.selectedSystemId
    : systems[0]?.id ?? 1;
  const nextSystemId = Math.max(
    state.rack?.nextSystemId ?? 1,
    ...systems.map((system) => system.id + 1),
  );

  return {
    ...state,
    selectedSystemId,
    rack: {
      nextSystemId,
    },
    systems,
  };
};

export const syncSelectedSystemRuntime = (state: GameState): GameState => {
  const existingSystems =
    state.systems && state.systems.length > 0
      ? limitInspectedSystems(state.systems)
      : [createSystemFromRuntime(state, 1, "Barebones PC", "barebonesPc")];
  const selectedSystem =
    existingSystems.find((system) => system.id === state.selectedSystemId) ??
    existingSystems[0];

  if (!selectedSystem) return ensureSystems(state);

  const selectedSystemId = selectedSystem.id;

  const syncedSystem = getSystemRuntime(
    state,
    createSystemFromRuntime(
      state,
      selectedSystemId,
      selectedSystem.name,
      selectedSystem.templateId,
      selectedSystem.purchaseCosts ?? [],
    ),
  );
  const systems = existingSystems.map((system) =>
    system.id === selectedSystemId ? syncedSystem : getSystemRuntime(state, system),
  );
  const nextSystemId = Math.max(
    state.rack?.nextSystemId ?? 1,
    ...systems.map((system) => system.id + 1),
  );

  return {
    ...state,
    selectedSystemId,
    rack: {
      nextSystemId,
    },
    systems,
  };
};

export const getSelectedSystem = (
  state: GameState,
  systemId = state.selectedSystemId,
): SystemState => {
  const ensured = ensureSystems(state);
  return (
    ensured.systems.find((system) => system.id === systemId) ??
    ensured.systems[0] ??
    createSystemState(1, "Barebones PC", "barebonesPc")
  );
};

export const materializeSystem = (
  state: GameState,
  systemId = state.selectedSystemId,
): GameState => {
  const ensured = ensureSystems(state);
  const selectedSystem = getSelectedSystem(ensured, systemId);
  const materialized = syncCoreSchedulers({
    ...ensured,
    selectedSystemId: selectedSystem.id,
    hardware: selectedSystem.hardware,
    workshop: selectedSystem.workshop,
    power: selectedSystem.power,
    cron: selectedSystem.cron,
    activeTasks: selectedSystem.activeTasks,
    activeJobs: selectedSystem.activeTasks,
    cacheResidency: selectedSystem.cacheResidency,
    coreSchedulers: selectedSystem.coreSchedulers,
    queue: selectedSystem.queue,
    queueEntries: selectedSystem.queueEntries ?? [],
    deadlockPressureSeconds: selectedSystem.deadlockPressureSeconds,
    deadlockPressureResource: selectedSystem.deadlockPressureResource,
    deadlockPressureCpuId: selectedSystem.deadlockPressureCpuId,
    deadlockProcessLockout: selectedSystem.deadlockProcessLockout,
  });

  return {
    ...materialized,
    systems: ensured.systems.map((system) =>
      system.id === selectedSystem.id
        ? createSystemFromRuntime(
            materialized,
            system.id,
            system.name,
            system.templateId,
            system.purchaseCosts ?? [],
          )
        : system,
    ),
  };
};

export const updateMaterializedSystem = (
  originalState: GameState,
  materializedState: GameState,
  systemId = materializedState.selectedSystemId,
): GameState => {
  const ensured = ensureSystems(originalState);
  const previousSystem = getSelectedSystem(ensured, systemId);
  const updatedSystem = createSystemFromRuntime(
    materializedState,
    systemId,
    previousSystem.name,
    previousSystem.templateId,
    previousSystem.purchaseCosts ?? [],
  );
  const systems = ensured.systems.map((system) =>
    system.id === systemId ? updatedSystem : system,
  );
  const selectedSystemId = materializedState.selectedSystemId;

  return materializeSystem(
    {
      ...materializedState,
      selectedSystemId,
      rack: {
        nextSystemId: Math.max(
          ensured.rack.nextSystemId,
          materializedState.rack?.nextSystemId ?? ensured.rack.nextSystemId,
          ...systems.map((system) => system.id + 1),
        ),
      },
      systems,
    },
    selectedSystemId,
  );
};

export const replaceSystems = (
  state: GameState,
  systems: SystemState[],
  selectedSystemId = state.selectedSystemId,
): GameState => {
  const limitedSystems = limitInspectedSystems(systems);
  const limitedSelectedSystemId = limitedSystems.some(
    (system) => system.id === selectedSystemId,
  )
    ? selectedSystemId
    : limitedSystems[0]?.id ?? 1;
  return materializeSystem(
    {
      ...state,
      selectedSystemId: limitedSelectedSystemId,
      rack: {
        nextSystemId: Math.max(
          state.rack.nextSystemId,
          ...limitedSystems.map((system) => system.id + 1),
        ),
      },
      systems: limitedSystems,
    },
    limitedSelectedSystemId,
  );
};
