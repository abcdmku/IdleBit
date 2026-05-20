import type { VisibleState } from "../../game";
import { clampMeter, firstBoolean, firstNumber, firstPositiveNumber } from "../panels/uiNumbers";
import { getVisibleRamBits, getVisibleRamUsedBits } from "../tasks/taskData";
import { normalizePowerState, type PowerLifecycleState } from "../rack";
import { asUiVisible, normalizeRatio } from "./visibleState";

export const getSystemLoad = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const system = ui.systemStatus;
  const ramCapacity = Math.max(getVisibleRamBits(visible), 1);
  const psuCapacity = Math.max(visible.hardware.psuWatts, 1);
  const ramUsed = getVisibleRamUsedBits(visible);
  const fallbackRamLoad = ramUsed / ramCapacity;
  const fallbackPsuStress = visible.metrics.powerUsedWatts / psuCapacity;
  const ramLoad = normalizeRatio(
    firstNumber(system?.ramLoad, system?.ramPressure, ui.metrics.ramLoad),
  );
  const memoryPressure = normalizeRatio(
    firstNumber(
      system?.memoryPressure,
      system?.memoryPressureRatio,
      system?.memory?.pressure,
      ui.metrics.memoryPressure,
    ),
  );
  const psuStress = normalizeRatio(
    firstNumber(
      system?.psuStress,
      system?.powerStress,
      system?.psu?.stress,
      ui.metrics.psuStress,
      ui.metrics.powerStress,
    ),
  );
  const coolingStress = normalizeRatio(
    firstNumber(
      system?.coolingStress,
      system?.thermalStress,
      system?.cooling?.stress,
      ui.metrics.coolingStress,
    ),
  );
  const coolingStatus =
    system?.coolingStatus ??
    system?.thermalStatus ??
    system?.cooling?.status ??
    ui.metrics.coolingStatus ??
    (coolingStress !== null && coolingStress > 0.9 ? "Hot" : "Nominal");

  return {
    memoryPressure: memoryPressure ?? ramLoad ?? fallbackRamLoad,
    psuStress: psuStress ?? fallbackPsuStress,
    coolingStress,
    coolingStatus,
  };
};

export const hasUiFlag = (visible: VisibleState, ...names: string[]) => {
  const flags = asUiVisible(visible).flags as unknown as Record<string, unknown>;
  return names.some((name) => flags[name] === true);
};


export const getPowerState = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  return normalizePowerState(
    ui.systemStatus?.powerState ??
      ui.systemStatus?.power?.state ??
      ui.systemManagement?.power?.state ??
      ui.systemManagement?.power?.lifecycle ??
      ui.power?.state ??
      ui.power?.lifecycle ??
      ui.hardware.powerState ??
      ui.hardware.power?.state ??
      ui.metrics.powerState,
  );
};

export const getPowerStats = (visible: VisibleState) => {
  const ui = asUiVisible(visible);
  const power =
    ui.systemStatus?.power ??
    ui.systemManagement?.power ??
    ui.power ??
    ui.hardware.power;
  const state = getPowerState(visible);
  const rawDrawWatts = Math.max(
    0,
    firstNumber(power?.drawWatts, visible.metrics.powerUsedWatts) ?? 0,
  );
  const headroomWatts = firstNumber(
    power?.headroomWatts,
    ui.systemStatus?.powerHeadroomWatts,
    visible.metrics.powerHeadroomWatts,
  );
  const capacityWatts =
    firstPositiveNumber(
      power?.capacityWatts,
      visible.hardware.psuWatts,
      typeof headroomWatts === "number" ? rawDrawWatts + headroomWatts : undefined,
      rawDrawWatts,
    ) ?? 65;
  const drawWatts = state === "off" ? 0 : rawDrawWatts;
  const stress =
    normalizeRatio(
      firstNumber(
        ui.systemStatus?.psuStress,
        ui.systemStatus?.powerStress,
        ui.systemStatus?.psu?.stress,
        ui.metrics.psuStress,
        ui.metrics.powerStress,
      ),
    ) ?? drawWatts / capacityWatts;
  const costPerSecond =
    firstNumber(
      power?.costPerSecond,
      ui.systemStatus?.power?.costPerSecond,
      visible.metrics.powerCostPerSecond,
    ) ?? Math.round(drawWatts * 0.06 * 1000) / 1000;
  const billingGraceSeconds = Math.max(
    0,
    firstNumber(
      power?.bootstrapGraceSeconds,
      power?.powerBootstrapGraceSeconds,
      power?.billingGraceSeconds,
      power?.powerBillingGraceSeconds,
      ui.systemStatus?.powerBootstrapGraceSeconds,
      ui.systemStatus?.billingGraceSeconds,
      ui.systemStatus?.powerBillingGraceSeconds,
      ui.metrics.powerBootstrapGraceSeconds,
      ui.metrics.billingGraceSeconds,
      ui.metrics.powerBillingGraceSeconds,
    ) ?? 0,
  );
  const transitionSeconds = Math.max(
    0,
    firstNumber(
      power?.transitionSeconds,
      power?.powerTransitionSeconds,
      ui.systemStatus?.powerTransitionSeconds,
      ui.metrics.powerTransitionSeconds,
    ) ?? 0,
  );
  const overload =
    power?.overloadFailure ??
    power?.powerOverloadFailure ??
    ui.systemStatus?.powerOverloadFailure ??
    ui.metrics.powerOverloadFailure;
  const overloadSeconds = Math.max(
    0,
    firstNumber(
      overload?.seconds,
      power?.overloadFailureSeconds,
      power?.powerOverloadFailureSeconds,
      ui.systemStatus?.powerOverloadFailureSeconds,
      ui.metrics.powerOverloadFailure?.seconds,
    ) ?? 0,
  );
  const overloadLimitSeconds =
    firstPositiveNumber(
      overload?.limitSeconds,
      ui.metrics.powerOverloadFailure?.limitSeconds,
    ) ?? 10;
  const overloadRemainingSeconds = Math.max(
    0,
    firstNumber(
      overload?.remainingSeconds,
      power?.overloadFailureRemainingSeconds,
      power?.powerOverloadFailureRemainingSeconds,
      ui.systemStatus?.powerOverloadFailureRemainingSeconds,
      ui.metrics.powerOverloadFailure?.remainingSeconds,
      overloadLimitSeconds - overloadSeconds,
    ) ?? 0,
  );
  const overloadProgress = clampMeter(
    firstNumber(
      overload?.progress,
      power?.overloadFailureProgress,
      power?.powerOverloadFailureProgress,
      ui.systemStatus?.powerOverloadFailureProgress,
      ui.metrics.powerOverloadFailure?.progress,
      overloadSeconds / Math.max(1, overloadLimitSeconds),
    ) ?? null,
  );
  const overloadTripped =
    firstBoolean(
      overload?.tripped,
      power?.overloadFailureTripped,
      power?.powerOverloadFailureTripped,
      ui.systemStatus?.powerOverloadFailureTripped,
      ui.metrics.powerOverloadFailure?.tripped,
    ) ?? overloadSeconds >= overloadLimitSeconds;
  const overloadActive =
    firstBoolean(
      overload?.active,
      power?.overloadFailureActive,
      power?.powerOverloadFailureActive,
      ui.systemStatus?.powerOverloadFailureActive,
      ui.metrics.powerOverloadFailure?.active,
    ) ?? (stress > 1 || overloadSeconds > 0);
  const overloadRate =
    firstNumber(overload?.rate, ui.metrics.powerOverloadFailure?.rate) ??
    (stress > 1 ? Math.max(1, stress) : 0);

  return {
    state,
    drawWatts,
    capacityWatts,
    stress,
    costPerSecond,
    billingGraceSeconds,
    transitionSeconds,
    overloadFailure: {
      seconds: overloadSeconds,
      limitSeconds: overloadLimitSeconds,
      remainingSeconds: overloadRemainingSeconds,
      progress: overloadProgress,
      rate: overloadRate,
      active: overloadActive,
      tripped: overloadTripped,
    },
  };
};

export const getPowerControls = (visible: VisibleState, state: PowerLifecycleState) => {
  const ui = asUiVisible(visible);
  const power =
    ui.systemStatus?.power ??
    ui.systemManagement?.power ??
    ui.power ??
    ui.hardware.power;
  const explicitCanPowerOn = firstBoolean(
    power?.canPowerOn,
    power?.canRequestPowerOn,
    power?.canTurnOn,
  );
  const explicitCanPowerOff = firstBoolean(
    power?.canPowerOff,
    power?.canRequestPowerOff,
    power?.canTurnOff,
  );
  const explicitCanPowerKill = firstBoolean(
    power?.canPowerKill,
    power?.canKillPower,
  );
  const controlsAvailable = firstBoolean(power?.controlsAvailable, power?.canControl);
  const controlsAllowed = controlsAvailable ?? true;
  const showControls = controlsAvailable ?? true;

  return {
    showControls,
    canPowerOn: explicitCanPowerOn ?? (controlsAllowed && state === "off"),
    canPowerOff: explicitCanPowerOff ?? (controlsAllowed && state === "on"),
    canPowerKill: explicitCanPowerKill ?? (controlsAllowed && state !== "off"),
  };
};


