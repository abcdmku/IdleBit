import {
  ZERO_AMOUNT,
  amount,
  amountAdd,
  amountClampMin,
  amountCompare,
  amountDivide,
  amountMax,
  amountMin,
  amountMultiply,
  amountSubtract,
  amountToNumber,
  sumAmounts,
  type Amount,
} from "./amount";

type AmountValue = Amount | string | number;

export interface ThermalComponent {
  id: string;
  idleHeatWatts: Amount;
  /** Total heat at full activity; normalization never permits less than idle. */
  activeHeatWatts: Amount;
  utilizationBps: number;
}

export interface ThermalAggregate {
  idleHeatWatts: Amount;
  activeHeatWatts: Amount;
  generatedHeatWatts: Amount;
}

export interface CoolingState {
  level: number;
  capacityWatts: Amount;
  /** Power billed while the cooled system/facility is on. */
  powerDrawWatts: Amount;
}

export interface CoolingUpgradeDefinition extends CoolingState {
  id: string;
}

export interface ThermalEnvironment {
  powered: boolean;
  components: ThermalComponent[];
  cooling: CoolingState;
  /** Time for a constant active load to heat from zero to its target. */
  responseSeconds: Amount;
}

export interface ThermalState {
  elapsedMs: Amount;
  /** Saved moving heat load used for sustained, rather than burst, throttling. */
  sustainedHeatWatts: Amount;
}

export type ThermalStatus =
  | "off"
  | "nominal"
  | "warm"
  | "hot"
  | "critical";

export interface ThermalSnapshot extends ThermalAggregate {
  powered: boolean;
  sustainedHeatWatts: Amount;
  coolingCapacityWatts: Amount;
  coolingPowerWatts: Amount;
  exactStressBps: Amount | null;
  stressBps: number;
  status: ThermalStatus;
  throughputModifierBps: number;
}

export type ThermalEvent =
  | {
      kind: "status";
      afterMs: Amount;
      nextStatus: Exclude<ThermalStatus, "off">;
    }
  | { kind: "equilibrium"; afterMs: Amount };

export interface ThermalAdvanceResult {
  state: ThermalState;
  snapshot: ThermalSnapshot;
}

export const THERMAL_NOMINAL_LIMIT_BPS = 7_000;
export const THERMAL_WARM_LIMIT_BPS = 8_500;
export const THERMAL_HOT_LIMIT_BPS = 10_000;
export const MIN_THERMAL_THROUGHPUT_BPS = 2_500;
export const MAX_PROJECTED_THERMAL_STRESS_BPS = 1_000_000;

const compareIds = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const normalizeBps = (value: number) =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(10_000, Math.round(value)))
    : 0;

const normalizeLevel = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

export const normalizeThermalComponent = (
  component: ThermalComponent,
): ThermalComponent => {
  const idleHeatWatts = amountClampMin(component.idleHeatWatts);
  return {
    id: component.id,
    idleHeatWatts,
    activeHeatWatts: amountMax(component.activeHeatWatts, idleHeatWatts),
    utilizationBps: normalizeBps(component.utilizationBps),
  };
};

export const normalizeCoolingState = (
  cooling: CoolingState,
): CoolingState => ({
  level: normalizeLevel(cooling.level),
  capacityWatts: amountClampMin(cooling.capacityWatts),
  powerDrawWatts: amountClampMin(cooling.powerDrawWatts),
});

export const normalizeThermalState = (
  state: ThermalState,
): ThermalState => ({
  elapsedMs: amountClampMin(state.elapsedMs),
  sustainedHeatWatts: amountClampMin(state.sustainedHeatWatts),
});

const assertUniqueComponentIds = (
  components: readonly ThermalComponent[],
) => {
  const seen = new Set<string>();
  for (const component of components) {
    if (seen.has(component.id)) {
      throw new Error(`Duplicate thermal component id: ${component.id}`);
    }
    seen.add(component.id);
  }
};

export const normalizeThermalEnvironment = (
  environment: ThermalEnvironment,
): ThermalEnvironment => {
  assertUniqueComponentIds(environment.components);
  return {
    powered: environment.powered === true,
    components: environment.components
      .map(normalizeThermalComponent)
      .sort((left, right) => compareIds(left.id, right.id)),
    cooling: normalizeCoolingState(environment.cooling),
    responseSeconds: amountClampMin(environment.responseSeconds),
  };
};

export const normalizeCoolingUpgradePath = (
  upgrades: readonly CoolingUpgradeDefinition[],
): CoolingUpgradeDefinition[] => {
  const ordered = upgrades
    .map((upgrade) => ({
      id: upgrade.id,
      ...normalizeCoolingState(upgrade),
    }))
    .sort(
      (left, right) =>
        left.level - right.level || compareIds(left.id, right.id),
    );
  const seenLevels = new Set<number>();
  let previousCapacity = ZERO_AMOUNT;
  return ordered.map((upgrade) => {
    if (seenLevels.has(upgrade.level)) {
      throw new Error(`Duplicate cooling upgrade level: ${upgrade.level}`);
    }
    seenLevels.add(upgrade.level);
    previousCapacity = amountMax(previousCapacity, upgrade.capacityWatts);
    return { ...upgrade, capacityWatts: previousCapacity };
  });
};

/**
 * Selecting a different level adopts the requested tier's normalized state in
 * either direction; re-selecting the current level is a no-op. Path-level
 * monotonicity (a higher tier never has less capacity) is guaranteed by
 * normalizeCoolingUpgradePath, not here — downgrades genuinely lower capacity.
 */
export const applyCoolingUpgrade = (
  currentCooling: CoolingState,
  requestedUpgrade: CoolingUpgradeDefinition,
): CoolingState => {
  const current = normalizeCoolingState(currentCooling);
  const requested = normalizeCoolingState(requestedUpgrade);
  if (requested.level === current.level) return current;
  return {
    level: requested.level,
    capacityWatts: requested.capacityWatts,
    powerDrawWatts: requested.powerDrawWatts,
  };
};

export const createThermalState = (
  sustainedHeatWatts: AmountValue = ZERO_AMOUNT,
): ThermalState => ({
  elapsedMs: ZERO_AMOUNT,
  sustainedHeatWatts: amountClampMin(sustainedHeatWatts),
});

export const aggregateThermalComponents = (
  inputComponents: readonly ThermalComponent[],
): ThermalAggregate => {
  assertUniqueComponentIds(inputComponents);
  const components = inputComponents
    .map(normalizeThermalComponent)
    .sort((left, right) => compareIds(left.id, right.id));
  const idleHeatWatts = sumAmounts(
    components.map((component) => component.idleHeatWatts),
  );
  const activeHeatWatts = sumAmounts(
    components.map((component) => component.activeHeatWatts),
  );
  const generatedHeatWatts = sumAmounts(
    components.map((component) => {
      const activeDelta = amountSubtract(
        component.activeHeatWatts,
        component.idleHeatWatts,
      );
      return amountAdd(
        component.idleHeatWatts,
        amountDivide(
          amountMultiply(activeDelta, component.utilizationBps),
          10_000,
        ),
      );
    }),
  );
  return { idleHeatWatts, activeHeatWatts, generatedHeatWatts };
};

/** Exact comparison of heat/cooling against a basis-point threshold. */
export const compareThermalStressToBps = (
  heatWatts: AmountValue,
  coolingCapacityWatts: AmountValue,
  thresholdBps: number,
) =>
  amountCompare(
    amountMultiply(amountClampMin(heatWatts), 10_000),
    amountMultiply(
      amountClampMin(coolingCapacityWatts),
      Math.max(0, Math.trunc(thresholdBps)),
    ),
  );

/** Null represents positive heat with zero cooling (unbounded stress). */
export const getExactThermalStressBps = (
  heatWatts: AmountValue,
  coolingCapacityWatts: AmountValue,
): Amount | null => {
  const heat = amountClampMin(heatWatts);
  const capacity = amountClampMin(coolingCapacityWatts);
  if (amountCompare(capacity, 0) === 0) {
    return amountCompare(heat, 0) === 0 ? ZERO_AMOUNT : null;
  }
  return amountDivide(amountMultiply(heat, 10_000), capacity);
};

/** Bounded UI/metrics projection; status decisions never rely on this Number. */
export const projectThermalStressBps = (
  heatWatts: AmountValue,
  coolingCapacityWatts: AmountValue,
) => {
  const heat = amountClampMin(heatWatts);
  const capacity = amountClampMin(coolingCapacityWatts);
  if (amountCompare(heat, 0) === 0) return 0;
  if (
    amountCompare(capacity, 0) === 0 ||
    compareThermalStressToBps(
      heat,
      capacity,
      MAX_PROJECTED_THERMAL_STRESS_BPS,
    ) >= 0
  ) {
    return MAX_PROJECTED_THERMAL_STRESS_BPS;
  }
  return Math.max(
    0,
    Math.min(
      MAX_PROJECTED_THERMAL_STRESS_BPS,
      Math.round(
        amountToNumber(amountDivide(amountMultiply(heat, 10_000), capacity)),
      ),
    ),
  );
};

/**
 * Exact boundary contact belongs to the hotter band while heat is rising or
 * steady, and to the cooler band while heat is falling. Advances slice exactly
 * at boundary contact, so the direction-aware assignment keeps the following
 * slice's throughput band independent of caller chunking.
 */
export const getThermalStatus = (
  powered: boolean,
  heatWatts: AmountValue,
  coolingCapacityWatts: AmountValue,
  falling = false,
): ThermalStatus => {
  if (!powered) return "off";
  if (amountCompare(amountClampMin(heatWatts), 0) === 0) return "nominal";
  const belowLimit = (thresholdBps: number) => {
    const comparison = compareThermalStressToBps(
      heatWatts,
      coolingCapacityWatts,
      thresholdBps,
    );
    return falling ? comparison <= 0 : comparison < 0;
  };
  if (belowLimit(THERMAL_NOMINAL_LIMIT_BPS)) return "nominal";
  if (belowLimit(THERMAL_WARM_LIMIT_BPS)) return "warm";
  if (belowLimit(THERMAL_HOT_LIMIT_BPS)) return "hot";
  return "critical";
};

export const getExactThermalThroughputModifierBps = (
  powered: boolean,
  heatWatts: AmountValue,
  coolingCapacityWatts: AmountValue,
): Amount => {
  if (!powered) return ZERO_AMOUNT;
  const heat = amountClampMin(heatWatts);
  const capacity = amountClampMin(coolingCapacityWatts);
  if (
    compareThermalStressToBps(
      heat,
      capacity,
      THERMAL_WARM_LIMIT_BPS,
    ) <= 0
  ) {
    return amount(10_000);
  }
  if (amountCompare(capacity, 0) === 0) {
    return amount(MIN_THERMAL_THROUGHPUT_BPS);
  }
  return amountMax(
    MIN_THERMAL_THROUGHPUT_BPS,
    amountMin(
      10_000,
      amountDivide(
        amountMultiply(capacity, THERMAL_WARM_LIMIT_BPS),
        heat,
      ),
    ),
  );
};

export const projectThermalThroughputModifierBps = (
  powered: boolean,
  heatWatts: AmountValue,
  coolingCapacityWatts: AmountValue,
) =>
  Math.max(
    0,
    Math.min(
      10_000,
      Math.floor(
        amountToNumber(
          getExactThermalThroughputModifierBps(
            powered,
            heatWatts,
            coolingCapacityWatts,
          ),
        ),
      ),
    ),
  );

export const getCoolingPowerWatts = (
  powered: boolean,
  cooling: CoolingState,
) => (powered ? normalizeCoolingState(cooling).powerDrawWatts : ZERO_AMOUNT);

export const deriveThermalSnapshot = (
  inputState: ThermalState,
  inputEnvironment: ThermalEnvironment,
): ThermalSnapshot => {
  const state = normalizeThermalState(inputState);
  const environment = normalizeThermalEnvironment(inputEnvironment);
  const aggregate = aggregateThermalComponents(environment.components);
  const heat = state.sustainedHeatWatts;
  const capacity = environment.cooling.capacityWatts;
  const targetHeatWatts = environment.powered
    ? aggregate.generatedHeatWatts
    : ZERO_AMOUNT;
  const falling = amountCompare(targetHeatWatts, heat) < 0;
  return {
    ...aggregate,
    powered: environment.powered,
    sustainedHeatWatts: heat,
    coolingCapacityWatts: capacity,
    coolingPowerWatts: getCoolingPowerWatts(
      environment.powered,
      environment.cooling,
    ),
    exactStressBps: getExactThermalStressBps(heat, capacity),
    stressBps: projectThermalStressBps(heat, capacity),
    status: getThermalStatus(environment.powered, heat, capacity, falling),
    throughputModifierBps: projectThermalThroughputModifierBps(
      environment.powered,
      heat,
      capacity,
    ),
  };
};

interface ThermalTrend {
  targetHeatWatts: Amount;
  direction: -1 | 0 | 1;
  changeWattsPerSecond: Amount;
  instantaneous: boolean;
}

const getThermalTrend = (
  state: ThermalState,
  environment: ThermalEnvironment,
): ThermalTrend => {
  const aggregate = aggregateThermalComponents(environment.components);
  const targetHeatWatts = environment.powered
    ? aggregate.generatedHeatWatts
    : ZERO_AMOUNT;
  const comparison = amountCompare(
    targetHeatWatts,
    state.sustainedHeatWatts,
  );
  const direction = comparison < 0 ? -1 : comparison > 0 ? 1 : 0;
  if (direction === 0) {
    return {
      targetHeatWatts,
      direction,
      changeWattsPerSecond: ZERO_AMOUNT,
      instantaneous: false,
    };
  }
  if (amountCompare(environment.responseSeconds, 0) === 0) {
    return {
      targetHeatWatts,
      direction,
      changeWattsPerSecond: ZERO_AMOUNT,
      instantaneous: true,
    };
  }
  const drivingWatts =
    direction > 0 ? targetHeatWatts : environment.cooling.capacityWatts;
  return {
    targetHeatWatts,
    direction,
    changeWattsPerSecond:
      amountCompare(drivingWatts, 0) > 0
        ? amountDivide(drivingWatts, environment.responseSeconds)
        : ZERO_AMOUNT,
    instantaneous: false,
  };
};

interface ThermalBoundary {
  heatWatts: Amount;
  risingStatus: Exclude<ThermalStatus, "off">;
  fallingStatus: Exclude<ThermalStatus, "off">;
}

const getThermalBoundaries = (capacityWatts: Amount): ThermalBoundary[] => [
  {
    heatWatts: amountDivide(
      amountMultiply(capacityWatts, THERMAL_NOMINAL_LIMIT_BPS),
      10_000,
    ),
    risingStatus: "warm",
    fallingStatus: "nominal",
  },
  {
    heatWatts: amountDivide(
      amountMultiply(capacityWatts, THERMAL_WARM_LIMIT_BPS),
      10_000,
    ),
    risingStatus: "hot",
    fallingStatus: "warm",
  },
  {
    heatWatts: capacityWatts,
    risingStatus: "critical",
    fallingStatus: "hot",
  },
];

/** Exact contact time for the next status boundary or thermal equilibrium. */
export const getNextThermalEvent = (
  inputState: ThermalState,
  inputEnvironment: ThermalEnvironment,
): ThermalEvent | null => {
  const state = normalizeThermalState(inputState);
  const environment = normalizeThermalEnvironment(inputEnvironment);
  const trend = getThermalTrend(state, environment);
  if (trend.direction === 0) return null;
  if (trend.instantaneous) return { kind: "equilibrium", afterMs: ZERO_AMOUNT };
  if (amountCompare(trend.changeWattsPerSecond, 0) === 0) return null;

  if (environment.powered && amountCompare(environment.cooling.capacityWatts, 0) > 0) {
    const candidates = getThermalBoundaries(environment.cooling.capacityWatts)
      .filter((boundary) =>
        trend.direction > 0
          ? amountCompare(boundary.heatWatts, state.sustainedHeatWatts) > 0 &&
            amountCompare(boundary.heatWatts, trend.targetHeatWatts) <= 0
          : amountCompare(boundary.heatWatts, state.sustainedHeatWatts) < 0 &&
            amountCompare(boundary.heatWatts, trend.targetHeatWatts) >= 0,
      )
      .sort((left, right) =>
        trend.direction > 0
          ? amountCompare(left.heatWatts, right.heatWatts)
          : amountCompare(right.heatWatts, left.heatWatts),
      );
    const boundary = candidates[0];
    if (boundary) {
      const distance =
        trend.direction > 0
          ? amountSubtract(boundary.heatWatts, state.sustainedHeatWatts)
          : amountSubtract(state.sustainedHeatWatts, boundary.heatWatts);
      return {
        kind: "status",
        afterMs: amountMultiply(
          amountDivide(distance, trend.changeWattsPerSecond),
          1000,
        ),
        nextStatus:
          trend.direction > 0
            ? boundary.risingStatus
            : boundary.fallingStatus,
      };
    }
  }

  const targetDistance =
    trend.direction > 0
      ? amountSubtract(trend.targetHeatWatts, state.sustainedHeatWatts)
      : amountSubtract(state.sustainedHeatWatts, trend.targetHeatWatts);
  return {
    kind: "equilibrium",
    afterMs: amountMultiply(
      amountDivide(targetDistance, trend.changeWattsPerSecond),
      1000,
    ),
  };
};

/** Linear event-safe advance. It can throttle work, but never destroys it. */
export const advanceThermal = (
  inputState: ThermalState,
  inputEnvironment: ThermalEnvironment,
  deltaMs: AmountValue,
): ThermalAdvanceResult => {
  const requestedMs = amount(deltaMs);
  if (amountCompare(requestedMs, 0) < 0) {
    throw new Error("Thermal advance delta must be non-negative");
  }
  const environment = normalizeThermalEnvironment(inputEnvironment);
  const state = normalizeThermalState(inputState);
  const trend = getThermalTrend(state, environment);
  let sustainedHeatWatts = state.sustainedHeatWatts;

  if (trend.instantaneous) {
    sustainedHeatWatts = trend.targetHeatWatts;
  } else if (
    trend.direction !== 0 &&
    amountCompare(trend.changeWattsPerSecond, 0) > 0
  ) {
    const possibleChange = amountMultiply(
      trend.changeWattsPerSecond,
      amountDivide(requestedMs, 1000),
    );
    const distance =
      trend.direction > 0
        ? amountSubtract(trend.targetHeatWatts, sustainedHeatWatts)
        : amountSubtract(sustainedHeatWatts, trend.targetHeatWatts);
    const appliedChange = amountMin(distance, possibleChange);
    sustainedHeatWatts =
      trend.direction > 0
        ? amountAdd(sustainedHeatWatts, appliedChange)
        : amountSubtract(sustainedHeatWatts, appliedChange);
  }

  const nextState = normalizeThermalState({
    elapsedMs: amountAdd(state.elapsedMs, requestedMs),
    sustainedHeatWatts,
  });
  return {
    state: nextState,
    snapshot: deriveThermalSnapshot(nextState, environment),
  };
};
