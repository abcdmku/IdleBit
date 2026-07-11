import type { MachinePowerProjection } from "../../game";
import { getComponentSku } from "../../game/content/machines";
import { getCpuClockHz } from "../../game/progression";
import { formatNumber, formatWatts } from "../format";
import { formatPowerRate } from "./rackFormatting";
import type { UiCustomMachineTier, UiRackSystem, UiSystemPreset } from "./types";

export interface FleetComputeBaseline {
  name: string;
  effectiveComputePerSecond: number;
}

const sumVisibleCoreClock = (system: UiRackSystem) => {
  const socketCompute = system.visible.metrics.cpuSockets.reduce(
    (total, socket) =>
      total +
      socket.cores.reduce(
        (socketTotal, core) => socketTotal + Math.max(0, core.clockHz ?? 0),
        0,
      ),
    0,
  );

  return socketCompute > 0
    ? socketCompute
    : Math.max(0, system.cores) * Math.max(0, system.clockHz);
};

/** Current effective Fleet compute, including the model's thermal modifier. */
export const getSystemEffectiveComputePerSecond = (system: UiRackSystem) => {
  const modifierBps =
    system.visible.workshop?.thermalThroughputModifierBps ??
    system.visible.metrics.thermalThroughputModifierBps ??
    10_000;
  return (sumVisibleCoreClock(system) * Math.max(0, modifierBps)) / 10_000;
};

export const getFleetComputeBaseline = (
  systems: readonly UiRackSystem[],
): FleetComputeBaseline | null => {
  const candidates = systems
    .map((system) => ({
      name: system.name,
      effectiveComputePerSecond: getSystemEffectiveComputePerSecond(system),
    }))
    .filter(({ effectiveComputePerSecond }) => effectiveComputePerSecond > 0);

  return (
    candidates.reduce<FleetComputeBaseline | null>(
      (best, candidate) =>
        best === null ||
        candidate.effectiveComputePerSecond > best.effectiveComputePerSecond
          ? candidate
          : best,
      null,
    ) ?? null
  );
};

export const getPresetComputePerSecond = (
  preset: UiSystemPreset,
  cpu: UiCustomMachineTier | null | undefined,
) => {
  const catalogCpu = (() => {
    if (cpu || typeof preset.components?.cpu !== "string") return null;
    try {
      const component = getComponentSku(preset.components.cpu);
      return component.type === "cpu" ? component : null;
    } catch {
      return null;
    }
  })();
  const cpuTierId = cpu?.cpuTierId ?? catalogCpu?.cpuTierId;
  const getClockHz = (level: number | undefined) => {
    if (level === undefined && cpu?.clockHz !== undefined) {
      return Math.max(0, cpu.clockHz);
    }
    if (
      cpuTierId === "hz" ||
      cpuTierId === "khz" ||
      cpuTierId === "mhz" ||
      cpuTierId === "ghz"
    ) {
      return getCpuClockHz(
        cpuTierId,
        level ?? cpu?.cpuLevel ?? cpu?.clockLevel ?? catalogCpu?.cpuLevel ?? 1,
      );
    }
    return Math.max(0, cpu?.clockHz ?? 0);
  };
  const configuredPackages = preset.components?.cpuPackageConfigs;
  if (configuredPackages && configuredPackages.length > 0) {
    const configuredCompute = configuredPackages.reduce(
      (total, config) =>
        total + Math.max(0, config.coreCount ?? 1) * getClockHz(config.cpuLevel),
      0,
    );
    return configuredCompute > 0 ? configuredCompute : null;
  }
  const packageCount = Math.max(
    1,
    Math.trunc(
      preset.components?.cpuPackageCount ??
        cpu?.cpuPackageCount ??
        catalogCpu?.cpuPackageCount ??
        1,
    ),
  );
  const cores = Math.max(
    0,
    preset.components?.cpuCoreCount ??
      preset.cores ??
      preset.coreCount ??
      (cpu?.cores ?? cpu?.coreCount ?? catalogCpu?.coreCount ?? 0) * packageCount,
  );
  const clockHz = getClockHz(preset.components?.cpuLevel);
  const computePerSecond = cores * clockHz;
  return computePerSecond > 0 ? computePerSecond : null;
};

export const formatComputeRate = (computePerSecond: number | null) => {
  if (computePerSecond === null || !Number.isFinite(computePerSecond)) {
    return "Model estimate unavailable";
  }
  const magnitude = Math.abs(computePerSecond);
  if (magnitude >= 1_000_000_000) {
    return `${formatNumber(computePerSecond / 1_000_000_000)} Gop/s`;
  }
  if (magnitude >= 1_000_000) {
    return `${formatNumber(computePerSecond / 1_000_000)} Mop/s`;
  }
  if (magnitude >= 1_000) {
    return `${formatNumber(computePerSecond / 1_000)} Kop/s`;
  }
  return `${formatNumber(computePerSecond)} op/s`;
};

const formatFleetComparison = (
  computePerSecond: number | null,
  baseline: FleetComputeBaseline | null,
) => {
  if (computePerSecond === null) return "Model estimate unavailable";
  if (!baseline || baseline.effectiveComputePerSecond <= 0) {
    return "First measurable Fleet baseline";
  }

  const ratio = computePerSecond / baseline.effectiveComputePerSecond;
  if (!Number.isFinite(ratio) || ratio <= 0) return "No comparable Fleet compute";
  if (ratio >= 2) {
    return `${formatNumber(ratio)}× ${
      baseline.name
    }'s configured thermal-adjusted rate`;
  }
  if (ratio <= 0.5) {
    return `${formatNumber(1 / ratio)}× below ${
      baseline.name
    }'s configured thermal-adjusted rate`;
  }

  const deltaPercent = Math.round((ratio - 1) * 100);
  if (Math.abs(deltaPercent) <= 1) {
    return `About even with ${baseline.name}'s configured thermal-adjusted rate`;
  }
  return `~${formatNumber(Math.abs(deltaPercent))}% ${
    deltaPercent > 0 ? "above" : "below"
  } ${baseline.name}'s configured thermal-adjusted rate`;
};

export function BuilderProjectionReadout({
  computePerSecond,
  power,
  baseline,
  label = "Build projections",
}: {
  computePerSecond: number | null;
  power: MachinePowerProjection | null;
  baseline: FleetComputeBaseline | null;
  label?: string;
}) {
  const runCost = power?.powerCostPerSecond ?? null;

  return (
    <dl className="builder-projection-grid" aria-label={label}>
      <div>
        <dt>Throughput</dt>
        <dd>{formatComputeRate(computePerSecond)}</dd>
      </div>
      <div>
        <dt>Power</dt>
        <dd>
          {power
            ? `${formatWatts(power.idleWatts)} idle · ${formatWatts(
                power.peakWatts,
              )} peak · ${power.safe ? "safe margin" : "low margin"}`
            : "Model estimate unavailable"}
        </dd>
      </div>
      <div>
        <dt>Run cost</dt>
        <dd>
          {runCost === null
            ? "Model estimate unavailable"
            : `${formatPowerRate(runCost)} cr/s at peak`}
        </dd>
      </div>
      <div>
        <dt>Profitability</dt>
        <dd>
          {runCost === null
            ? "Needs a valid power estimate"
            : `Needs reward above ${formatPowerRate(runCost)} cr/s`}
        </dd>
      </div>
      <div>
        <dt>Fleet comparison</dt>
        <dd>{formatFleetComparison(computePerSecond, baseline)}</dd>
      </div>
    </dl>
  );
}
