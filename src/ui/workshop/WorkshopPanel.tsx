import {
  CheckCircle2,
  CircuitBoard,
  Cpu,
  HardDrive,
  Fan,
  Gauge,
  Thermometer,
} from "lucide-react";
import { useState } from "react";
import type {
  Amount,
  VisibleState,
  VisibleWorkshopAccelerator,
  VisibleWorkshopAcceleratorSku,
  VisibleWorkshopRoute,
} from "../../game";
import { ExactResourceCost } from "../ResourceTokens";
import { SmoothProgress } from "../SmoothProgress";
import { formatExactResourceAmount } from "../format";
import type { Dispatch } from "../uiActions";

type WorkshopView = "thermal" | "storage" | "accelerators";

const workloadLabels = {
  render: "render",
  vector: "vector",
  mlBatch: "ML batch",
  inference: "inference",
} as const;

const fallbackLabels = {
  "no-compatible-accelerator": "no compatible accelerator",
  "model-memory": "model exceeds device memory",
  "batch-size": "batch is below the device minimum",
  throughput: "device throughput is too low",
  "accelerator-contention": "compatible accelerator is busy",
} as const;

const titleCase = (value: string) =>
  value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;

const formatBps = (basisPoints: number) => {
  const percentage = basisPoints / 100;
  return `${Number.isInteger(percentage) ? percentage : percentage.toFixed(1)}%`;
};

function ExactMetric({ value, unit }: { value: Amount; unit: string }) {
  return (
    <span title={`${value} ${unit}`}>
      {formatExactResourceAmount(value)} {unit}
    </span>
  );
}

function ThermalTuning({
  visible,
  dispatch,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
}) {
  const workshop = visible.workshop;

  return (
    <div
      className="workshop-view workshop-thermal-view"
      id="workshop-thermal-view"
      role="tabpanel"
      aria-labelledby="workshop-thermal-tab"
    >
      <section className="workshop-control-group" aria-labelledby="cooling-title">
        <div className="workshop-subhead">
          <div>
            <span className="eyebrow">Cooling path</span>
            <h3 id="cooling-title">Sustained heat capacity</h3>
          </div>
          {!workshop.thermalControlsUnlocked && (
            <span className="workshop-lock-chip">Research Thermal Control</span>
          )}
        </div>

        <div className="workshop-option-grid cooling-tier-grid">
          {workshop.coolingTiers.map((tier) => {
            const blockerId = `cooling-${tier.id}-blocker`;
            return (
              <article
                className={`workshop-option ${tier.installed ? "selected" : ""}`}
                key={tier.id}
              >
                <header>
                  <div>
                    <span className="workshop-kind-label">Tier {tier.level}</span>
                    <h4>{tier.name}</h4>
                  </div>
                  <span
                    className={`workshop-state-chip ${tier.installed ? "" : "placeholder"}`}
                    aria-hidden={!tier.installed}
                  >
                    Installed
                  </span>
                </header>
                <p>{tier.description}</p>
                <dl className="workshop-inline-metrics">
                  <div>
                    <dt>Capacity</dt>
                    <dd><ExactMetric value={tier.capacityWatts} unit="W" /></dd>
                  </div>
                  <div>
                    <dt>Draw</dt>
                    <dd><ExactMetric value={tier.powerDrawWatts} unit="W" /></dd>
                  </div>
                </dl>
                <div className="workshop-cost-line">
                  <ExactResourceCost
                    costs={tier.costs}
                    resources={visible.exactResources}
                    compact
                    emptyLabel="Included"
                  />
                </div>
                <button
                  type="button"
                  className="workshop-action-button"
                  disabled={!tier.canInstall}
                  aria-describedby={tier.blockedReason ? blockerId : undefined}
                  title={tier.blockedReason ?? `Install ${tier.name}`}
                  onClick={() =>
                    dispatch({ type: "installCoolingTier", tierId: tier.id })
                  }
                >
                  {tier.installed ? "Installed" : `Install ${tier.name}`}
                </button>
                <small
                  className={`workshop-blocker ${tier.blockedReason ? "" : "placeholder"}`}
                  id={blockerId}
                  aria-hidden={!tier.blockedReason}
                >
                  {tier.blockedReason ?? "No blocker"}
                </small>
              </article>
            );
          })}
        </div>
      </section>

      <section className="workshop-control-group" aria-labelledby="overclock-title">
        <div className="workshop-subhead">
          <div>
            <span className="eyebrow">Overclock presets</span>
            <h3 id="overclock-title">Clock, power, and heat projection</h3>
          </div>
        </div>

        <div className="workshop-option-grid overclock-grid">
          {workshop.overclockPresets.map((preset) => {
            const blockerId = `overclock-${preset.id}-blocker`;
            return (
              <article
                className={`workshop-option compact ${preset.selected ? "selected" : ""}`}
                key={preset.id}
              >
                <header>
                  <h4>{preset.name}</h4>
                  <span
                    className={`workshop-state-chip ${preset.selected ? "" : "placeholder"}`}
                    aria-hidden={!preset.selected}
                  >
                    Active
                  </span>
                </header>
                <p>{preset.description}</p>
                <dl className="workshop-projection" aria-label={`${preset.name} projection`}>
                  <div><dt>Clock</dt><dd>{formatBps(preset.clockMultiplierBps)}</dd></div>
                  <div><dt>Power</dt><dd>{formatBps(preset.powerMultiplierBps)}</dd></div>
                  <div><dt>Heat</dt><dd>{formatBps(preset.heatMultiplierBps)}</dd></div>
                </dl>
                <button
                  type="button"
                  className="workshop-action-button"
                  disabled={!preset.canSelect}
                  aria-describedby={preset.blockedReason ? blockerId : undefined}
                  title={preset.blockedReason ?? `Select ${preset.name}`}
                  onClick={() =>
                    dispatch({ type: "setOverclockPreset", presetId: preset.id })
                  }
                >
                  {preset.selected ? "Selected" : `Select ${preset.name}`}
                </button>
                <small
                  className={`workshop-blocker ${preset.blockedReason ? "" : "placeholder"}`}
                  id={blockerId}
                  aria-hidden={!preset.blockedReason}
                >
                  {preset.blockedReason ?? "No blocker"}
                </small>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const getSkuForDevice = (
  device: VisibleWorkshopAccelerator,
  skus: readonly VisibleWorkshopAcceleratorSku[],
) => skus.find((sku) => sku.id === device.skuId) ?? null;

function InstalledAcceleratorCard({
  device,
  skus,
  dispatch,
}: {
  device: VisibleWorkshopAccelerator;
  skus: readonly VisibleWorkshopAcceleratorSku[];
  dispatch: Dispatch;
}) {
  const sku = getSkuForDevice(device, skus);
  const finalSlot = device.slotId + device.expansionSlots - 1;
  const slotLabel =
    finalSlot === device.slotId
      ? `Slot ${device.slotId}`
      : `Slots ${device.slotId}-${finalSlot}`;

  return (
    <article className={`workshop-installed-device ${device.active ? "active" : ""}`}>
      <header>
        <div>
          <span className="workshop-kind-label">{device.kind.toUpperCase()} · {slotLabel}</span>
          <h4>{device.name}</h4>
        </div>
        <span className="workshop-state-chip">{device.active ? "Active" : "Idle"}</span>
      </header>
      {sku && (
        <>
          <p>{sku.supportedWorkloadClasses.map((role) => workloadLabels[role]).join(" · ")}</p>
          <dl className="workshop-device-metrics">
            <div><dt>Memory</dt><dd><ExactMetric value={sku.deviceMemoryBits} unit="bits" /></dd></div>
            <div><dt>Throughput</dt><dd><ExactMetric value={sku.computeOperationsPerSecond} unit="ops/s" /></dd></div>
            <div><dt>Power idle → active</dt><dd><ExactMetric value={sku.idlePowerWatts} unit="W" /> → <ExactMetric value={sku.activePowerWatts} unit="W" /></dd></div>
            <div><dt>Heat idle → active</dt><dd><ExactMetric value={sku.idleHeatWatts} unit="W" /> → <ExactMetric value={sku.activeHeatWatts} unit="W" /></dd></div>
          </dl>
        </>
      )}
      <button
        type="button"
        className="workshop-remove-button"
        aria-label={`Remove ${device.name} from ${slotLabel.toLowerCase()}`}
        onClick={() => dispatch({ type: "removeAccelerator", deviceId: device.id })}
      >
        Remove
      </button>
    </article>
  );
}

function AcceleratorSkuCard({
  sku,
  visible,
  dispatch,
}: {
  sku: VisibleWorkshopAcceleratorSku;
  visible: VisibleState;
  dispatch: Dispatch;
}) {
  const blockerId = `accelerator-${sku.id}-blocker`;
  return (
    <article className="workshop-option accelerator-sku-card">
      <header>
        <div>
          <span className="workshop-kind-label">{sku.kind.toUpperCase()} · {sku.expansionSlots} {sku.expansionSlots === 1 ? "slot" : "slots"}</span>
          <h4>{sku.name}</h4>
        </div>
        <span className="workshop-throughput-chip">{formatBps(sku.throughputMultiplierBps)} CPU rate</span>
      </header>
      <p>{sku.description}</p>
      <p className="workshop-role-line">
        <strong>Roles</strong> {sku.supportedWorkloadClasses.map((role) => workloadLabels[role]).join(" · ")}
      </p>
      <dl className="workshop-device-metrics">
        <div><dt>Memory</dt><dd><ExactMetric value={sku.deviceMemoryBits} unit="bits" /></dd></div>
        <div><dt>Throughput</dt><dd><ExactMetric value={sku.computeOperationsPerSecond} unit="ops/s" /></dd></div>
        <div><dt>Min batch</dt><dd>{formatExactResourceAmount(sku.minimumBatchSize)}</dd></div>
        <div><dt>Power idle → active</dt><dd><ExactMetric value={sku.idlePowerWatts} unit="W" /> → <ExactMetric value={sku.activePowerWatts} unit="W" /></dd></div>
        <div><dt>Heat idle → active</dt><dd><ExactMetric value={sku.idleHeatWatts} unit="W" /> → <ExactMetric value={sku.activeHeatWatts} unit="W" /></dd></div>
      </dl>
      <div className="workshop-cost-line">
        <ExactResourceCost costs={sku.costs} resources={visible.exactResources} compact />
      </div>
      <button
        type="button"
        className="workshop-action-button"
        disabled={!sku.canInstall}
        aria-describedby={sku.blockedReason ? blockerId : undefined}
        title={sku.blockedReason ?? `Install ${sku.name}`}
        onClick={() => dispatch({ type: "installAccelerator", skuId: sku.id })}
      >
        Install {sku.name}
      </button>
      <small
        className={`workshop-blocker ${sku.blockedReason ? "" : "placeholder"}`}
        id={blockerId}
        aria-hidden={!sku.blockedReason}
      >
        {sku.blockedReason ?? "No blocker"}
      </small>
    </article>
  );
}

function RouteRow({
  route,
  visible,
}: {
  route: VisibleWorkshopRoute;
  visible: VisibleState;
}) {
  const taskName = visible.tasks.find((task) => task.id === route.taskId)?.name ?? route.taskId;
  const device = route.deviceId
    ? visible.workshop.accelerators.find((candidate) => candidate.id === route.deviceId)
    : null;
  const targetLabel = route.target === "accelerator"
    ? `${device?.name ?? route.skuId ?? "Accelerator"}`
    : route.target === "cpu"
      ? "CPU fallback"
      : "Blocked";
  const fallback = route.fallbackReason
    ? fallbackLabels[route.fallbackReason as keyof typeof fallbackLabels] ?? route.fallbackReason
    : null;

  return (
    <li className={`workshop-route ${route.target}`}>
      <div>
        <strong>{taskName}</strong>
        <span>{workloadLabels[route.workloadClass]} · core {route.coreId} · {route.operationId}</span>
      </div>
      <div className="workshop-route-target">
        <strong>{targetLabel}</strong>
        {fallback && <span>{fallback}</span>}
      </div>
    </li>
  );
}

function Accelerators({
  visible,
  dispatch,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
}) {
  const workshop = visible.workshop;
  const occupiedSlots = workshop.accelerators.reduce(
    (total, device) => total + device.expansionSlots,
    0,
  );

  return (
    <div
      className="workshop-view workshop-accelerator-view"
      id="workshop-accelerator-view"
      role="tabpanel"
      aria-labelledby="workshop-accelerator-tab"
    >
      <section className="workshop-control-group" aria-labelledby="installed-accelerators-title">
        <div className="workshop-subhead">
          <div>
            <span className="eyebrow">Expansion bay</span>
            <h3 id="installed-accelerators-title">Installed accelerators</h3>
          </div>
          <span className="workshop-slot-chip">{occupiedSlots} / {workshop.expansionSlots} slots used</span>
        </div>
        {workshop.accelerators.length > 0 ? (
          <div className="workshop-installed-grid">
            {workshop.accelerators.map((device) => (
              <InstalledAcceleratorCard
                key={device.id}
                device={device}
                skus={workshop.acceleratorSkus}
                dispatch={dispatch}
              />
            ))}
          </div>
        ) : (
          <p className="workshop-empty-state">No accelerators installed in this system.</p>
        )}
      </section>

      <section className="workshop-control-group" aria-labelledby="accelerator-catalog-title">
        <div className="workshop-subhead">
          <div>
            <span className="eyebrow">Device catalog</span>
            <h3 id="accelerator-catalog-title">GPU and NPU modules</h3>
          </div>
        </div>
        <div className="workshop-option-grid accelerator-catalog">
          {workshop.acceleratorSkus.map((sku) => (
            <AcceleratorSkuCard key={sku.id} sku={sku} visible={visible} dispatch={dispatch} />
          ))}
        </div>
      </section>

      <section className="workshop-control-group" aria-labelledby="accelerator-routing-title">
        <div className="workshop-subhead">
          <div>
            <span className="eyebrow">Live scheduler routes</span>
            <h3 id="accelerator-routing-title">Accelerator routing</h3>
          </div>
          <span className="workshop-slot-chip">{workshop.routes.length} active</span>
        </div>
        {workshop.routes.length > 0 ? (
          <ul className="workshop-route-list">
            {workshop.routes.map((route) => (
              <RouteRow key={route.workloadId} route={route} visible={visible} />
            ))}
          </ul>
        ) : (
          <p className="workshop-empty-state">
            No accelerator-aware work is active. Compatible tasks route here automatically; unmet requirements report a CPU fallback or blocker.
          </p>
        )}
      </section>
    </div>
  );
}

function StorageBay({
  visible,
  dispatch,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
}) {
  const workshop = visible.workshop;
  const workload = workshop.storageWorkload;

  return (
    <div
      className="workshop-view workshop-storage-view"
      id="workshop-storage-view"
      role="tabpanel"
      aria-labelledby="workshop-storage-tab"
    >
      <section className="workshop-control-group" aria-labelledby="storage-device-title">
        <div className="workshop-subhead">
          <div>
            <span className="eyebrow">Persistent path · this system</span>
            <h3 id="storage-device-title">Managed storage</h3>
          </div>
          {!workshop.storageUnlocked && (
            <span className="workshop-lock-chip">Research System Catalog</span>
          )}
        </div>

        <div className="workshop-option-grid storage-sku-grid">
          {workshop.storageSkus.map((sku) => {
            const blockerId = `storage-${sku.id}-blocker`;
            return (
              <article
                className={`workshop-option ${sku.installed ? "selected" : ""}`}
                key={sku.id}
              >
                <header>
                  <div>
                    <span className="workshop-kind-label">Storage device</span>
                    <h4>{sku.name}</h4>
                  </div>
                  <span
                    className={`workshop-state-chip ${sku.installed ? "" : "placeholder"}`}
                    aria-hidden={!sku.installed}
                  >
                    Installed
                  </span>
                </header>
                <p>{sku.description}</p>
                <dl className="workshop-device-metrics">
                  <div>
                    <dt>Capacity</dt>
                    <dd><ExactMetric value={sku.capacityBits} unit="bits" /></dd>
                  </div>
                  <div>
                    <dt>Read</dt>
                    <dd><ExactMetric value={sku.readBitsPerSecond} unit="bit/s" /></dd>
                  </div>
                  <div>
                    <dt>Write</dt>
                    <dd><ExactMetric value={sku.writeBitsPerSecond} unit="bit/s" /></dd>
                  </div>
                  <div>
                    <dt>Power idle / peak</dt>
                    <dd>
                      <ExactMetric value={sku.idlePowerWatts} unit="W" /> /{" "}
                      <ExactMetric value={sku.peakPowerWatts} unit="W" />
                    </dd>
                  </div>
                  <div>
                    <dt>Heat idle / peak</dt>
                    <dd>
                      <ExactMetric value={sku.idleHeatWatts} unit="W" /> /{" "}
                      <ExactMetric value={sku.peakHeatWatts} unit="W" />
                    </dd>
                  </div>
                </dl>
                <div className="workshop-cost-line">
                  <ExactResourceCost
                    costs={sku.costs}
                    resources={visible.exactResources}
                    compact
                    emptyLabel="No cost"
                  />
                </div>
                <button
                  type="button"
                  className="workshop-action-button"
                  disabled={!sku.canInstall}
                  aria-describedby={sku.blockedReason ? blockerId : undefined}
                  title={sku.blockedReason ?? `Install ${sku.name}`}
                  onClick={() => dispatch({ type: "installWorkshopStorage", skuId: sku.id })}
                >
                  {sku.installed ? "Installed" : `Install ${sku.name}`}
                </button>
                <small
                  className={`workshop-blocker ${sku.blockedReason && !sku.installed ? "" : "placeholder"}`}
                  id={blockerId}
                  aria-hidden={!sku.blockedReason || sku.installed}
                >
                  {sku.blockedReason && !sku.installed ? sku.blockedReason : "No blocker"}
                </small>
              </article>
            );
          })}
        </div>
      </section>

      {workshop.networkUnlocked && (
        <section className="workshop-control-group" aria-labelledby="network-device-title">
          <div className="workshop-subhead">
            <div>
              <span className="eyebrow">Network path · this system</span>
              <h3 id="network-device-title">Managed network</h3>
            </div>
          </div>

          <div className="workshop-option-grid storage-sku-grid">
            {workshop.networkSkus.map((sku) => {
              const blockerId = `network-${sku.id}-blocker`;
              return (
                <article
                  className={`workshop-option ${sku.installed ? "selected" : ""}`}
                  key={sku.id}
                >
                  <header>
                    <div>
                      <span className="workshop-kind-label">Network device</span>
                      <h4>{sku.name}</h4>
                    </div>
                    <span
                      className={`workshop-state-chip ${sku.installed ? "" : "placeholder"}`}
                      aria-hidden={!sku.installed}
                    >
                      Installed
                    </span>
                  </header>
                  <p>{sku.description}</p>
                  <dl className="workshop-device-metrics">
                    <div>
                      <dt>Ingress</dt>
                      <dd><ExactMetric value={sku.ingressBitsPerSecond} unit="bit/s" /></dd>
                    </div>
                    <div>
                      <dt>Egress</dt>
                      <dd><ExactMetric value={sku.egressBitsPerSecond} unit="bit/s" /></dd>
                    </div>
                    <div>
                      <dt>Power idle / peak</dt>
                      <dd>
                        <ExactMetric value={sku.idlePowerWatts} unit="W" /> /{" "}
                        <ExactMetric value={sku.peakPowerWatts} unit="W" />
                      </dd>
                    </div>
                  </dl>
                  <div className="workshop-cost-line">
                    <ExactResourceCost
                      costs={sku.costs}
                      resources={visible.exactResources}
                      compact
                      emptyLabel="No cost"
                    />
                  </div>
                  <button
                    type="button"
                    className="workshop-action-button"
                    disabled={!sku.canInstall}
                    aria-describedby={sku.blockedReason ? blockerId : undefined}
                    title={sku.blockedReason ?? `Install ${sku.name}`}
                    onClick={() => dispatch({ type: "installLocalNetwork", skuId: sku.id })}
                  >
                    {sku.installed ? "Installed" : `Install ${sku.name}`}
                  </button>
                  <small
                    className={`workshop-blocker ${sku.blockedReason && !sku.installed ? "" : "placeholder"}`}
                    id={blockerId}
                    aria-hidden={!sku.blockedReason || sku.installed}
                  >
                    {sku.blockedReason && !sku.installed ? sku.blockedReason : "No blocker"}
                  </small>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="workshop-control-group" aria-labelledby="storage-workload-title">
        <div className="workshop-subhead">
          <div>
            <span className="eyebrow">Capacity-backed proof</span>
            <h3 id="storage-workload-title">{workload.name}</h3>
          </div>
          <span className="workshop-state-chip">
            {workload.completedCount > 0
              ? "Complete"
              : workload.active
                ? "Staging"
                : "Ready"}
          </span>
        </div>
        <p className="workshop-role-line">{workload.description}</p>
        <dl className="workshop-projection" aria-label={`${workload.name} projection`}>
          <div>
            <dt>Fit</dt>
            <dd><ExactMetric value={workload.storageRequiredBits} unit="bits" /></dd>
          </div>
          <div>
            <dt>Read / write</dt>
            <dd>
              <ExactMetric value={workload.readBits} unit="bits" /> /{" "}
              <ExactMetric value={workload.writeBits} unit="bits" />
            </dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>
              {workload.projection.durationMs === null
                ? "Paused"
                : <ExactMetric value={workload.projection.durationMs} unit="ms" />}
            </dd>
          </div>
          <div>
            <dt>Operating</dt>
            <dd>
              {workload.projection.operatingCostCredits === null
                ? "—"
                : <ExactMetric value={workload.projection.operatingCostCredits} unit="Credits" />}
            </dd>
          </div>
          <div>
            <dt>Net reward</dt>
            <dd>
              {workload.projection.netRewardCredits === null
                ? "—"
                : <ExactMetric value={workload.projection.netRewardCredits} unit="Credits" />}
            </dd>
          </div>
          <div>
            <dt>Offline buffer</dt>
            <dd>{workload.projection.bufferCovered ? "Covered" : "Not covered"}</dd>
          </div>
        </dl>
        <p
          className="workshop-storage-reward"
          title={`${workload.paidWorkUnits} paid work units × ${workload.workValueMultiplier.basisPoints} basis points (${workload.workValueMultiplier.id})`}
        >
          Reward {formatExactResourceAmount(workload.rewards.credits)} Credits ·{" "}
          {formatExactResourceAmount(workload.rewards.data)} Data
        </p>
        {workload.active && (
          <SmoothProgress
            className="workshop-storage-progress"
            max={10_000}
            value={workload.progressBps}
            label={`${workload.name} progress`}
          />
        )}
        <button
          type="button"
          className="workshop-action-button"
          disabled={!workload.active && !workload.canStart}
          title={workload.active ? "Cancel storage workload" : (workload.blockedReason ?? `Start ${workload.name}`)}
          onClick={() =>
            dispatch(
              workload.active
                ? { type: "cancelWorkshopStorageWorkload" }
                : { type: "startWorkshopStorageWorkload", workloadId: workload.id },
            )
          }
        >
          {workload.active ? "Cancel staging" : `Start ${workload.name}`}
        </button>
        {!workload.active && workload.projection.pauseReason && workload.completedCount === 0 && (
          <small className="workshop-blocker">{workload.projection.pauseReason}</small>
        )}
      </section>
    </div>
  );
}

export function WorkshopPanel({
  visible,
  dispatch,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
}) {
  const [view, setView] = useState<WorkshopView>("thermal");
  const workshop = visible.workshop;
  const effectiveView =
    view === "accelerators" && !workshop.specializedComputeUnlocked
      ? "thermal"
      : view === "storage" && !workshop.storageUnlocked
        ? "thermal"
        : view;

  if (!workshop.thermalVisible) return null;

  const status = titleCase(workshop.thermalStatus);
  const gpuDone = workshop.evidence.gpuRenderCompletions > 0;
  const npuDone = workshop.evidence.npuInferenceCompletions > 0;

  return (
    <section
      className={`hw-section workshop-panel thermal-${workshop.thermalStatus}`}
      aria-labelledby="workshop-title"
    >
      <header className="workshop-header">
        <div className="workshop-heading">
          <CircuitBoard size={18} aria-hidden="true" />
          <div>
            <span className="eyebrow">Per-system workbench</span>
            <h2 id="workshop-title">Workshop</h2>
          </div>
        </div>
        <div className="workshop-status" role="status" aria-label={`Thermal status ${status}`}>
          <Thermometer size={15} aria-hidden="true" />
          <strong>{status}</strong>
          <span>
            {formatBps(workshop.thermalStressBps)} load · peak {titleCase(workshop.highestObservedThermalStatus)}
          </span>
        </div>
      </header>

      <dl className="workshop-thermal-strip" aria-label="Thermal telemetry">
        <div>
          <dt><Gauge size={13} aria-hidden="true" /> Generated</dt>
          <dd><ExactMetric value={workshop.generatedHeatWatts} unit="W" /></dd>
        </div>
        <div>
          <dt><Thermometer size={13} aria-hidden="true" /> Sustained</dt>
          <dd><ExactMetric value={workshop.sustainedHeatWatts} unit="W" /></dd>
        </div>
        <div>
          <dt><Fan size={13} aria-hidden="true" /> Cooling</dt>
          <dd>
            <ExactMetric value={workshop.coolingCapacityWatts} unit="W" />
            <small> · <ExactMetric value={workshop.coolingPowerWatts} unit="W draw" /></small>
          </dd>
        </div>
        <div>
          <dt><Cpu size={13} aria-hidden="true" /> Throughput</dt>
          <dd>{formatBps(workshop.thermalThroughputModifierBps)}</dd>
        </div>
      </dl>

      <div className="workshop-tabs" role="tablist" aria-label="Workshop controls">
        <button
          type="button"
          id="workshop-storage-tab"
          role="tab"
          aria-selected={effectiveView === "storage"}
          aria-controls={workshop.storageUnlocked ? "workshop-storage-view" : undefined}
          disabled={!workshop.storageUnlocked}
          title={workshop.storageUnlocked ? "Open storage bay" : "Research System Catalog"}
          onClick={() => setView("storage")}
        >
          <HardDrive size={15} aria-hidden="true" />
          {workshop.networkUnlocked ? "Data paths" : "Storage"}
          {!workshop.storageUnlocked && <span className="workshop-tab-lock">Locked</span>}
        </button>
        <button
          type="button"
          id="workshop-thermal-tab"
          role="tab"
          aria-selected={effectiveView === "thermal"}
          aria-controls="workshop-thermal-view"
          onClick={() => setView("thermal")}
        >
          <Fan size={15} aria-hidden="true" />
          Thermal tuning
        </button>
        <button
          type="button"
          id="workshop-accelerator-tab"
          role="tab"
          aria-selected={effectiveView === "accelerators"}
          aria-controls={workshop.specializedComputeUnlocked ? "workshop-accelerator-view" : undefined}
          disabled={!workshop.specializedComputeUnlocked}
          title={workshop.specializedComputeUnlocked ? "Open accelerator bay" : "Research Specialized Compute"}
          onClick={() => setView("accelerators")}
        >
          <CircuitBoard size={15} aria-hidden="true" />
          Accelerators
          {!workshop.specializedComputeUnlocked && <span className="workshop-tab-lock">Locked</span>}
        </button>
      </div>

      {effectiveView === "thermal" ? (
        <ThermalTuning visible={visible} dispatch={dispatch} />
      ) : effectiveView === "storage" ? (
        <StorageBay visible={visible} dispatch={dispatch} />
      ) : (
        <Accelerators visible={visible} dispatch={dispatch} />
      )}

      <footer className={`workshop-evidence ${workshop.specializationComplete ? "complete" : ""}`}>
        <div>
          <span className="eyebrow">Specialization evidence · this system</span>
          <div className="workshop-evidence-items">
            <span className={gpuDone ? "done" : ""}>
              {gpuDone && <CheckCircle2 size={14} aria-hidden="true" />}
              GPU render {workshop.evidence.gpuRenderCompletions}
            </span>
            <span className={npuDone ? "done" : ""}>
              {npuDone && <CheckCircle2 size={14} aria-hidden="true" />}
              NPU inference {workshop.evidence.npuInferenceCompletions}
            </span>
          </div>
        </div>
        <strong role="status">
          {workshop.specializationComplete ? "Fleet specialization complete" : "Prove both device paths"}
        </strong>
      </footer>
    </section>
  );
}
