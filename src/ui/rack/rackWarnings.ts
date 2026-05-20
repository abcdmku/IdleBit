import type { VisibleState } from "../../game";
import { getPowerStats, getSystemLoad } from "../hardware/SystemBoardSections";
import { clampMeter } from "../panels/uiNumbers";
import { normalizePowerState } from "./rackPower";
import type { RackComponentWarnings } from "./types";

export const getRackComponentWarnings = (
  visible: VisibleState,
  status: string,
): RackComponentWarnings => {
  const powerState = normalizePowerState(status || getPowerStats(visible).state);
  const off = powerState === "off";

  if (off) {
    return { off, any: false, cpu: false, ram: false, psu: false };
  }

  const load = getSystemLoad(visible);
  const power = getPowerStats(visible);
  const deadlocks = visible.metrics.deadlocks ?? [];
  const pressure = visible.metrics.deadlockPressure;
  const pressureActive = Boolean(pressure?.active || pressure?.lockout);
  const cpuDeadlocked = visible.metrics.cpuSockets.some(
    (socket) => socket.deadlocked || socket.cores.some((core) => core.deadlocked),
  );
  const cacheDeadlocked =
    deadlocks.some((deadlock) => deadlock.resource === "cache") ||
    (pressureActive && pressure?.resource === "cache");
  const ramDeadlocked =
    deadlocks.some((deadlock) => deadlock.resource === "ram") ||
    (pressureActive && pressure?.resource === "ram");
  const cpu =
    cpuDeadlocked ||
    cacheDeadlocked ||
    (load.coolingStress !== null && load.coolingStress >= 0.9);
  const ram = ramDeadlocked || clampMeter(load.memoryPressure) >= 0.9;
  const psu =
    power.stress >= 0.9 ||
    power.overloadFailure.active ||
    power.overloadFailure.progress > 0 ||
    power.overloadFailure.tripped;

  return { off, any: cpu || ram || psu, cpu, ram, psu };
};
