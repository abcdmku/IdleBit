import {
  CheckCircle2,
  CircuitBoard,
  Gauge,
  HardDrive,
  Network,
  Thermometer,
  X,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type {
  Amount,
  ExactCost,
  ExactResourceBag,
  VisibleState,
  VisibleWorkshopAccelerator,
  VisibleWorkshopAcceleratorSku,
  VisibleWorkshopRoute,
} from "../../game";
import { ExactResourceCost } from "../ResourceTokens";
import { SmoothProgress } from "../SmoothProgress";
import { StatTile, StatTileRow } from "../StatTile";
import {
  formatExactCurrencyAmount,
  formatExactResourceAmount,
} from "../format";
import type { Dispatch } from "../uiActions";

type WorkshopVisible = VisibleState["workshop"];

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

const formatExactCosts = (costs: ExactCost[]) =>
  costs
    .map((cost) => `${formatExactCurrencyAmount(cost.amount)} ${cost.resource}`)
    .join(" + ");

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

/** Currency amounts never show decimals; the tooltip keeps the exact value. */
function ExactCurrencyMetric({ value, unit }: { value: Amount; unit: string }) {
  return (
    <span title={`${value} ${unit}`}>
      {formatExactCurrencyAmount(value)} {unit}
    </span>
  );
}

/** nominal keeps the section accent; warm warns; hot/critical alarm. */
const thermalTone = (status: WorkshopVisible["thermalStatus"]) =>
  status === "nominal" ? "" : status === "warm" ? "warn" : "critical";

const thermalAccent = (status: WorkshopVisible["thermalStatus"]) =>
  status === "nominal" ? "cyan" : status === "warm" ? "amber" : "rose";

/**
 * Shared isolated-section header: icon + NAME + inline live readout, the same
 * anatomy as the CPU/RAM/PSU cards (`hw-section-header` + `hw-section-meta`).
 */
function WorkshopSectionHeader({
  Icon,
  title,
  meta,
  metaTitle,
  metaRole,
  metaAriaLabel,
}: {
  Icon: LucideIcon;
  title: string;
  meta: ReactNode;
  metaTitle?: string;
  metaRole?: string;
  metaAriaLabel?: string;
}) {
  return (
    <div className="hw-section-header">
      <Icon size={14} aria-hidden="true" />
      <span>{title}</span>
      <span
        className="hw-section-meta"
        title={metaTitle}
        role={metaRole}
        aria-label={metaAriaLabel}
      >
        {meta}
      </span>
    </div>
  );
}

/** Locked surfaces reuse the board's paid-outline pattern. */
function WorkshopLockedSection({
  className,
  Icon,
  title,
  note,
  children,
}: {
  className: string;
  Icon: LucideIcon;
  title: string;
  note: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={`hw-section workshop-section locked-system-section ${className}`}
    >
      <div className="hw-section-header">
        <Icon size={14} aria-hidden="true" />
        <span>{title}</span>
        <span className="hw-section-meta">
          <strong>Locked</strong>
        </span>
      </div>
      <small className="locked-system-note">{note}</small>
      {children}
    </section>
  );
}

/**
 * Reserved one-line caption under a section body. The slot stays mounted while
 * empty so a blocker appearing or clearing never reflows the card; long
 * reasons ellipsize with the full text in the tooltip.
 */
function SectionNote({ text }: { text: string | null }) {
  return (
    <small
      className={`workshop-note ${text ? "" : "placeholder"}`}
      aria-hidden={!text}
      title={text ?? undefined}
    >
      {text ?? "No blocker"}
    </small>
  );
}

/** First actionable blocker among a section's options, shown in its note. */
const firstBlocker = (
  options: readonly {
    canInstall?: boolean;
    canSelect?: boolean;
    installed?: boolean;
    selected?: boolean;
    blockedReason: string | null;
  }[],
) =>
  options.find(
    (option) =>
      !(option.installed ?? option.selected ?? false) &&
      !(option.canInstall ?? option.canSelect ?? false) &&
      option.blockedReason !== null,
  )?.blockedReason ?? null;

/** Screen-reader blocker target for a disabled control's aria-describedby. */
function SrBlocker({ id, reason }: { id: string; reason: string | null }) {
  if (!reason) return null;
  return (
    <span className="sr-only" id={id}>
      {reason}
    </span>
  );
}

/**
 * One rail segment: a fixed two-row button in a tier ladder or preset dial —
 * name over a value/cost line. The active state lights the border/accent only
 * (no size change) and everything verbose lives in the tooltip.
 */
function RailSegment({
  name,
  value,
  costs,
  costsArePlus = false,
  resources,
  active,
  disabled,
  title,
  ariaLabel,
  blockerId,
  blockedReason,
  onClick,
}: {
  name: string;
  value: ReactNode;
  costs?: ExactCost[];
  /** Render the cost tokens as gains (refunds) instead of prices. */
  costsArePlus?: boolean;
  resources?: ExactResourceBag;
  active: boolean;
  disabled: boolean;
  title: string;
  ariaLabel: string;
  blockerId: string;
  blockedReason: string | null;
  onClick: () => void;
}) {
  const blocked = !active && blockedReason !== null;
  return (
    <button
      type="button"
      className={`workshop-seg ${active ? "is-active" : ""}`}
      disabled={disabled}
      aria-pressed={active}
      aria-label={ariaLabel}
      aria-describedby={blocked ? blockerId : undefined}
      title={title}
      onClick={onClick}
    >
      <strong className="workshop-seg-name">{name}</strong>
      <span className="workshop-seg-meta">
        <span className="workshop-seg-value">{value}</span>
        {costs !== undefined && (
          <ExactResourceCost
            costs={costs}
            plus={costsArePlus}
            resources={resources}
            compact
            emptyLabel="—"
          />
        )}
      </span>
      <SrBlocker id={blockerId} reason={blocked ? blockedReason : null} />
    </button>
  );
}

/**
 * One bay tile: the whole tile is the install button, mirroring the RAM stick
 * grid. Head (kind + name), one or two compact spec lines, and a reserved
 * foot that holds the cost tokens. Everything verbose lives in the tooltip.
 */
function BayTile({
  kind,
  name,
  spec,
  costs,
  resources,
  installed,
  canInstall,
  blockedReason,
  title,
  blockerId,
  onInstall,
}: {
  kind: string;
  name: string;
  spec: ReactNode;
  costs: ExactCost[];
  resources: ExactResourceBag;
  installed: boolean;
  canInstall: boolean;
  blockedReason: string | null;
  title: string;
  blockerId: string;
  onInstall: () => void;
}) {
  const blocked = !installed && blockedReason !== null;
  return (
    <button
      type="button"
      className={`workshop-bay-tile ${installed ? "is-installed" : ""}`}
      disabled={installed || !canInstall}
      aria-pressed={installed}
      aria-label={installed ? `${name} installed` : `Install ${name}`}
      aria-describedby={blocked ? blockerId : undefined}
      title={title}
      onClick={onInstall}
    >
      <span className="workshop-bay-head">
        <span className="workshop-bay-kind">{kind}</span>
        <strong className="workshop-bay-name">{name}</strong>
      </span>
      <span className="workshop-bay-spec">{spec}</span>
      <span className="workshop-bay-foot">
        <ExactResourceCost
          costs={costs}
          resources={resources}
          compact
          emptyLabel="Included"
        />
      </span>
      <SrBlocker id={blockerId} reason={blocked ? blockedReason : null} />
    </button>
  );
}

/**
 * Thermal telemetry and the cooling tier rail share one section: the stat row
 * states the heat problem and the ladder right below it is the fix. Tiers
 * below the installed one stay clickable as downgrades that refund half of
 * the installed tier's cost; the tokens on those segments show the refund.
 */
function ThermalCard({
  workshop,
  resources,
  dispatch,
}: {
  workshop: WorkshopVisible;
  resources: ExactResourceBag;
  dispatch: Dispatch;
}) {
  const status = titleCase(workshop.thermalStatus);
  const tone = thermalTone(workshop.thermalStatus);
  const accent = thermalAccent(workshop.thermalStatus);
  const stressMeter = Math.min(
    1,
    Math.max(0, workshop.thermalStressBps / 10_000),
  );

  const coolingTitle = (tier: WorkshopVisible["coolingTiers"][number]) => {
    if (tier.installed) return `${tier.description} · draws ${tier.powerDrawWatts} W`;
    if (tier.refunds.length > 0) {
      return `Downgrade to ${tier.name}: refund ${formatExactCosts(tier.refunds)}`;
    }
    return tier.blockedReason ?? `${tier.description} · draws ${tier.powerDrawWatts} W`;
  };
  const coolingAriaLabel = (tier: WorkshopVisible["coolingTiers"][number]) => {
    if (tier.installed) return `${tier.name} installed`;
    if (tier.refunds.length > 0) return `Downgrade to ${tier.name}`;
    return `Install ${tier.name}`;
  };

  return (
    <section
      className={`hw-section workshop-section workshop-thermal-section ${tone}`}
    >
      <WorkshopSectionHeader
        Icon={Thermometer}
        title="Thermal"
        meta={
          <>
            <strong>{status}</strong> {formatBps(workshop.thermalStressBps)}{" "}
            load
          </>
        }
        metaTitle={`Peak observed ${titleCase(workshop.highestObservedThermalStatus)}`}
        metaRole="status"
        metaAriaLabel={`Thermal status ${status}`}
      />
      <StatTileRow dense>
        <StatTile
          label="Heat"
          value={<ExactMetric value={workshop.generatedHeatWatts} unit="W" />}
          accent={accent}
          meter={stressMeter}
          title={`Generated heat ${workshop.generatedHeatWatts} W`}
        />
        <StatTile
          label="Sustained"
          value={<ExactMetric value={workshop.sustainedHeatWatts} unit="W" />}
          accent={accent}
          title={`Sustained heat ${workshop.sustainedHeatWatts} W`}
        />
        <StatTile
          label="Cooling"
          value={<ExactMetric value={workshop.coolingCapacityWatts} unit="W" />}
          accent="cyan"
          title={`Cooling capacity ${workshop.coolingCapacityWatts} W · draw ${workshop.coolingPowerWatts} W`}
        />
        <StatTile
          label="Rate"
          value={formatBps(workshop.thermalThroughputModifierBps)}
          accent={accent}
          title="Thermal throughput modifier"
        />
      </StatTileRow>
      {workshop.thermalControlsUnlocked ? (
        <>
          <div
            className="workshop-rail"
            role="group"
            aria-label="Cooling tiers"
          >
            {workshop.coolingTiers.map((tier) => (
              <RailSegment
                key={tier.id}
                name={tier.name}
                value={<ExactMetric value={tier.capacityWatts} unit="W" />}
                costs={tier.refunds.length > 0 ? tier.refunds : tier.costs}
                costsArePlus={tier.refunds.length > 0}
                resources={tier.refunds.length > 0 ? undefined : resources}
                active={tier.installed}
                disabled={!tier.canInstall}
                title={coolingTitle(tier)}
                ariaLabel={coolingAriaLabel(tier)}
                blockerId={`cooling-${tier.id}-blocker`}
                blockedReason={tier.blockedReason}
                onClick={() =>
                  dispatch({ type: "installCoolingTier", tierId: tier.id })
                }
              />
            ))}
          </div>
          <SectionNote text={firstBlocker(workshop.coolingTiers)} />
        </>
      ) : (
        <small className="locked-system-note">
          Research Thermal Control to install cooling
        </small>
      )}
    </section>
  );
}

/** Overclock as a preset dial plus the active preset's trade-off readout. */
function OverclockCard({
  workshop,
  dispatch,
}: {
  workshop: WorkshopVisible;
  dispatch: Dispatch;
}) {
  const active =
    workshop.overclockPresets.find((preset) => preset.selected) ??
    workshop.overclockPresets[0];

  return (
    <section className="hw-section workshop-section workshop-overclock-section">
      <WorkshopSectionHeader
        Icon={Gauge}
        title="Overclock"
        meta={
          active ? (
            <>
              <strong>{active.name}</strong>{" "}
              {formatBps(active.clockMultiplierBps)}
            </>
          ) : (
            <strong>None</strong>
          )
        }
        metaTitle={
          active
            ? `Clock ${formatBps(active.clockMultiplierBps)} · Power ${formatBps(
                active.powerMultiplierBps,
              )} · Heat ${formatBps(active.heatMultiplierBps)}`
            : "Active overclock preset"
        }
      />
      <div
        className="workshop-rail"
        role="group"
        aria-label="Overclock presets"
      >
        {workshop.overclockPresets.map((preset) => (
          <RailSegment
            key={preset.id}
            name={preset.name}
            value={formatBps(preset.clockMultiplierBps)}
            active={preset.selected}
            disabled={!preset.canSelect}
            title={
              preset.blockedReason ??
              `Clock ${formatBps(preset.clockMultiplierBps)} · Power ${formatBps(
                preset.powerMultiplierBps,
              )} · Heat ${formatBps(preset.heatMultiplierBps)} — ${preset.description}`
            }
            ariaLabel={
              preset.selected
                ? `${preset.name} selected`
                : `Select ${preset.name}`
            }
            blockerId={`overclock-${preset.id}-blocker`}
            blockedReason={preset.blockedReason}
            onClick={() =>
              dispatch({ type: "setOverclockPreset", presetId: preset.id })
            }
          />
        ))}
      </div>
      <SectionNote text={firstBlocker(workshop.overclockPresets)} />
    </section>
  );
}

/** Staging workload: head, three projection tiles, reserved progress + note. */
function StorageWorkloadBlock({
  workshop,
  dispatch,
}: {
  workshop: WorkshopVisible;
  dispatch: Dispatch;
}) {
  const workload = workshop.storageWorkload;
  const stateLabel =
    workload.completedCount > 0
      ? "Complete"
      : workload.active
        ? "Staging"
        : "Ready";
  const pauseReason =
    !workload.active && workload.completedCount === 0
      ? workload.projection.pauseReason
      : null;
  const rewardTitle = `Reward ${formatExactCurrencyAmount(
    workload.rewards.credits,
  )} Credits · ${formatExactCurrencyAmount(workload.rewards.data)} Data — ${formatExactResourceAmount(
    workload.paidWorkUnits,
  )} paid work units × ${workload.workValueMultiplier.basisPoints} basis points (${workload.workValueMultiplier.id})${
    workload.projection.operatingCostCredits === null
      ? ""
      : ` · operating cost ${workload.projection.operatingCostCredits} Credits`
  } · offline buffer ${workload.projection.bufferCovered ? "covered" : "not covered"}`;

  return (
    <div
      className="workshop-workload"
      title={`${workload.description} — requires ${workload.storageRequiredBits} bits · reads ${workload.readBits} bits · writes ${workload.writeBits} bits`}
    >
      <header className="workshop-workload-head">
        <span className="workshop-bay-kind">Staging</span>
        <strong className="workshop-bay-name">{workload.name}</strong>
        <span className="workshop-state-chip">{stateLabel}</span>
      </header>
      {/* Reserved meter: the bar stays mounted at 0 while idle so a staging
          start never grows the card. */}
      <SmoothProgress
        className="workshop-storage-progress"
        max={10_000}
        value={workload.active ? workload.progressBps : 0}
        label={`${workload.name} progress`}
      />
      <div className="workshop-workload-actions">
        <button
          type="button"
          className="workshop-workload-button"
          disabled={!workload.active && !workload.canStart}
          aria-label={
            workload.active ? "Cancel staging" : `Start ${workload.name}`
          }
          title={
            workload.active
              ? "Cancel storage workload"
              : (workload.blockedReason ?? `Start ${workload.name}`)
          }
          onClick={() =>
            dispatch(
              workload.active
                ? { type: "cancelWorkshopStorageWorkload" }
                : {
                    type: "startWorkshopStorageWorkload",
                    workloadId: workload.id,
                  },
            )
          }
        >
          {workload.active ? "Cancel staging" : `Start ${workload.name}`}
        </button>
        <span className="workshop-workload-projection" title={rewardTitle}>
          {workload.projection.durationMs === null ? (
            "Paused"
          ) : (
            <ExactMetric value={workload.projection.durationMs} unit="ms" />
          )}
          {" · net "}
          {workload.projection.netRewardCredits === null ? (
            "—"
          ) : (
            <strong>
              <ExactCurrencyMetric
                value={workload.projection.netRewardCredits}
                unit="cr"
              />
            </strong>
          )}
        </span>
      </div>
      <SectionNote text={pauseReason} />
    </div>
  );
}

/** Storage as a drive bay: SKU tiles like RAM sticks, installed one lit. */
function StorageCard({
  workshop,
  resources,
  dispatch,
}: {
  workshop: WorkshopVisible;
  resources: ExactResourceBag;
  dispatch: Dispatch;
}) {
  const installed = workshop.storageSkus.find((sku) => sku.installed) ?? null;

  return (
    <section className="hw-section workshop-section workshop-storage-section">
      <WorkshopSectionHeader
        Icon={HardDrive}
        title="Storage"
        meta={
          <strong>
            {installed ? (
              <ExactMetric value={installed.capacityBits} unit="bits" />
            ) : (
              "Empty"
            )}
          </strong>
        }
        metaTitle={installed ? `Installed ${installed.name}` : "No drive installed"}
      />
      <div className="workshop-bay" role="group" aria-label="Storage devices">
        {workshop.storageSkus.map((sku) => (
          <BayTile
            key={sku.id}
            kind="Drive"
            name={sku.name}
            spec={
              <>
                <ExactMetric value={sku.capacityBits} unit="bits" /> · R{" "}
                <ExactMetric value={sku.readBitsPerSecond} unit="bit/s" /> · W{" "}
                <ExactMetric value={sku.writeBitsPerSecond} unit="bit/s" />
              </>
            }
            costs={sku.costs}
            resources={resources}
            installed={sku.installed}
            canInstall={sku.canInstall}
            blockedReason={sku.installed ? null : sku.blockedReason}
            title={
              (!sku.installed && sku.blockedReason) ||
              `${sku.description} · Pwr ${sku.idlePowerWatts}→${sku.peakPowerWatts} W · Heat ${sku.idleHeatWatts}→${sku.peakHeatWatts} W`
            }
            blockerId={`storage-${sku.id}-blocker`}
            onInstall={() =>
              dispatch({ type: "installWorkshopStorage", skuId: sku.id })
            }
          />
        ))}
      </div>
      <SectionNote
        text={firstBlocker(
          workshop.storageSkus.filter((sku) => !sku.installed),
        )}
      />
      <StorageWorkloadBlock workshop={workshop} dispatch={dispatch} />
    </section>
  );
}

/** Network as a NIC bay: same drive-bay language as storage. */
function NetworkCard({
  workshop,
  resources,
  dispatch,
}: {
  workshop: WorkshopVisible;
  resources: ExactResourceBag;
  dispatch: Dispatch;
}) {
  const installed = workshop.networkSkus.find((sku) => sku.installed) ?? null;

  return (
    <section className="hw-section workshop-section workshop-network-section">
      <WorkshopSectionHeader
        Icon={Network}
        title="Network"
        meta={<strong>{installed?.name ?? "Empty"}</strong>}
        metaTitle={installed ? `Installed ${installed.name}` : "No NIC installed"}
      />
      <div className="workshop-bay" role="group" aria-label="Network devices">
        {workshop.networkSkus.map((sku) => (
          <BayTile
            key={sku.id}
            kind="NIC"
            name={sku.name}
            spec={
              <>
                In <ExactMetric value={sku.ingressBitsPerSecond} unit="bit/s" />{" "}
                · Out{" "}
                <ExactMetric value={sku.egressBitsPerSecond} unit="bit/s" />
              </>
            }
            costs={sku.costs}
            resources={resources}
            installed={sku.installed}
            canInstall={sku.canInstall}
            blockedReason={sku.installed ? null : sku.blockedReason}
            title={
              (!sku.installed && sku.blockedReason) ||
              `${sku.description} · Pwr ${sku.idlePowerWatts}→${sku.peakPowerWatts} W`
            }
            blockerId={`network-${sku.id}-blocker`}
            onInstall={() =>
              dispatch({ type: "installLocalNetwork", skuId: sku.id })
            }
          />
        ))}
      </div>
      <SectionNote
        text={firstBlocker(
          workshop.networkSkus.filter((sku) => !sku.installed),
        )}
      />
    </section>
  );
}

const getSkuForDevice = (
  device: VisibleWorkshopAccelerator,
  skus: readonly VisibleWorkshopAcceleratorSku[],
) => skus.find((sku) => sku.id === device.skuId) ?? null;

const deviceSlotLabel = (device: VisibleWorkshopAccelerator) => {
  const finalSlot = device.slotId + device.expansionSlots - 1;
  return finalSlot === device.slotId
    ? `Slot ${device.slotId}`
    : `Slots ${device.slotId}-${finalSlot}`;
};

/**
 * The expansion bay as a physical slot strip: devices occupy their real slot
 * span, empty slots stay visible as dashed sockets, and full device specs
 * live in the tooltip.
 */
function ExpansionSlotStrip({
  workshop,
  dispatch,
}: {
  workshop: WorkshopVisible;
  dispatch: Dispatch;
}) {
  const occupied = new Set<number>();
  workshop.accelerators.forEach((device) => {
    for (let offset = 0; offset < device.expansionSlots; offset += 1) {
      occupied.add(device.slotId + offset);
    }
  });
  const emptySlots = Array.from(
    { length: workshop.expansionSlots },
    (_, index) => index + 1,
  ).filter((slotId) => !occupied.has(slotId));

  return (
    <div
      className="workshop-slot-strip"
      style={
        { "--workshop-slot-count": workshop.expansionSlots } as CSSProperties
      }
      role="group"
      aria-label="Expansion slots"
    >
      {workshop.accelerators.map((device) => {
        const sku = getSkuForDevice(device, workshop.acceleratorSkus);
        const slotLabel = deviceSlotLabel(device);
        const specTitle = sku
          ? ` · ${sku.supportedWorkloadClasses
              .map((role) => workloadLabels[role])
              .join(" · ")} · Mem ${sku.deviceMemoryBits} bits · ${sku.computeOperationsPerSecond} ops/s · Pwr ${sku.idlePowerWatts}→${sku.activePowerWatts} W · Heat ${sku.idleHeatWatts}→${sku.activeHeatWatts} W`
          : "";

        return (
          <div
            key={device.id}
            className={`workshop-slot-device is-${device.kind} ${
              device.active ? "is-active" : ""
            }`}
            style={{
              gridColumn: `${device.slotId} / span ${device.expansionSlots}`,
            }}
            title={`${device.name} · ${slotLabel}${specTitle}`}
          >
            <span className="workshop-slot-kind">
              {device.kind.toUpperCase()}
            </span>
            <strong className="workshop-slot-name">{device.name}</strong>
            <span
              className={`workshop-slot-state ${device.active ? "is-on" : ""}`}
            >
              {device.active ? "Active" : "Idle"}
            </span>
            <button
              type="button"
              className="workshop-slot-remove"
              aria-label={`Remove ${device.name} from ${slotLabel.toLowerCase()}`}
              title={`Remove ${device.name}`}
              onClick={() =>
                dispatch({ type: "removeAccelerator", deviceId: device.id })
              }
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {emptySlots.map((slotId) => (
        <div
          key={slotId}
          className="workshop-slot-empty"
          style={{ gridColumn: `${slotId} / span 1` }}
          title={`Expansion slot ${slotId} — empty`}
        >
          {slotId}
        </div>
      ))}
    </div>
  );
}

function RouteRow({
  route,
  visible,
}: {
  route: VisibleWorkshopRoute;
  visible: VisibleState;
}) {
  const taskName =
    visible.tasks.find((task) => task.id === route.taskId)?.name ?? route.taskId;
  const device = route.deviceId
    ? visible.workshop.accelerators.find(
        (candidate) => candidate.id === route.deviceId,
      )
    : null;
  const targetLabel =
    route.target === "accelerator"
      ? `${device?.name ?? route.skuId ?? "Accelerator"}`
      : route.target === "cpu"
        ? "CPU fallback"
        : "Blocked";
  const fallback = route.fallbackReason
    ? (fallbackLabels[route.fallbackReason as keyof typeof fallbackLabels] ??
      route.fallbackReason)
    : null;

  return (
    <li className={`workshop-route ${route.target}`}>
      <div>
        <strong>{taskName}</strong>
        <span>
          {workloadLabels[route.workloadClass]} · core {route.coreId} ·{" "}
          {route.operationId}
        </span>
      </div>
      <div className="workshop-route-target">
        <strong>{targetLabel}</strong>
        {fallback && <span>{fallback}</span>}
      </div>
    </li>
  );
}

function WorkshopEvidence({ workshop }: { workshop: WorkshopVisible }) {
  const gpuDone = workshop.evidence.gpuRenderCompletions > 0;
  const npuDone = workshop.evidence.npuInferenceCompletions > 0;

  return (
    <footer
      className={`workshop-evidence ${workshop.specializationComplete ? "complete" : ""}`}
      title="Specialization evidence for this system: complete one GPU render and one NPU inference to prove both device paths."
    >
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
      <strong role="status">
        {workshop.specializationComplete
          ? "Specialization complete"
          : "Prove both paths"}
      </strong>
    </footer>
  );
}

/** Accelerators: slot strip + device catalog tiles + live routing. */
function AcceleratorsCard({
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
    <section className="hw-section workshop-section workshop-accelerator-section">
      <WorkshopSectionHeader
        Icon={CircuitBoard}
        title="Accelerators"
        meta={
          <strong>
            {occupiedSlots} / {workshop.expansionSlots}
          </strong>
        }
        metaTitle="Expansion slots used"
      />

      <ExpansionSlotStrip workshop={workshop} dispatch={dispatch} />

      <div
        className="workshop-bay"
        role="group"
        aria-label="Accelerator modules"
      >
        {workshop.acceleratorSkus.map((sku) => (
          <BayTile
            key={sku.id}
            kind={`${sku.kind.toUpperCase()} · ${sku.expansionSlots} ${
              sku.expansionSlots === 1 ? "slot" : "slots"
            }`}
            name={sku.name}
            spec={
              <>
                <ExactMetric value={sku.deviceMemoryBits} unit="bits" /> ·{" "}
                <ExactMetric
                  value={sku.computeOperationsPerSecond}
                  unit="ops/s"
                />
              </>
            }
            costs={sku.costs}
            resources={visible.exactResources}
            installed={false}
            canInstall={sku.canInstall}
            blockedReason={sku.blockedReason}
            title={
              sku.blockedReason ??
              `${sku.description} · runs ${sku.supportedWorkloadClasses
                .map((role) => workloadLabels[role])
                .join(" · ")} · min batch ${sku.minimumBatchSize} · ${formatBps(
                sku.throughputMultiplierBps,
              )} CPU rate · Pwr ${sku.idlePowerWatts}→${sku.activePowerWatts} W · Heat ${sku.idleHeatWatts}→${sku.activeHeatWatts} W`
            }
            blockerId={`accelerator-${sku.id}-blocker`}
            onInstall={() =>
              dispatch({ type: "installAccelerator", skuId: sku.id })
            }
          />
        ))}
      </div>
      <SectionNote text={firstBlocker(workshop.acceleratorSkus)} />

      {/* Live routing only appears while accelerator-aware work is running;
          compatible tasks route automatically, so an idle bay stays quiet. */}
      {workshop.routes.length > 0 && (
        <ul className="workshop-route-list" aria-label="Accelerator routing">
          {workshop.routes.map((route) => (
            <RouteRow key={route.workloadId} route={route} visible={visible} />
          ))}
        </ul>
      )}

      <WorkshopEvidence workshop={workshop} />
    </section>
  );
}

/**
 * Per-system workbench, rendered as the same isolated section cards as the
 * rest of the board: THERMAL (telemetry + cooling rail), OVERCLOCK, STORAGE,
 * NETWORK, and ACCELERATORS each stand alone with a header readout. Reveal gating is
 * unchanged: storage unlocks from System Catalog independently of thermal
 * discovery, and locked-but-known surfaces show the board's paid-outline
 * pattern.
 */
export function WorkshopPanel({
  visible,
  dispatch,
}: {
  visible: VisibleState;
  dispatch: Dispatch;
}) {
  const workshop = visible.workshop;
  const thermalVisible = workshop.thermalVisible;

  if (!thermalVisible && !workshop.storageUnlocked) return null;

  return (
    <>
      {thermalVisible && (
        <>
          <ThermalCard
            workshop={workshop}
            resources={visible.exactResources}
            dispatch={dispatch}
          />
          <OverclockCard workshop={workshop} dispatch={dispatch} />
        </>
      )}

      {workshop.storageUnlocked ? (
        <StorageCard
          workshop={workshop}
          resources={visible.exactResources}
          dispatch={dispatch}
        />
      ) : (
        <WorkshopLockedSection
          className="workshop-storage-section"
          Icon={HardDrive}
          title="Storage"
          note="Research System Catalog"
        />
      )}
      {workshop.networkUnlocked && (
        <NetworkCard
          workshop={workshop}
          resources={visible.exactResources}
          dispatch={dispatch}
        />
      )}

      {thermalVisible &&
        (workshop.specializedComputeUnlocked ? (
          <AcceleratorsCard visible={visible} dispatch={dispatch} />
        ) : (
          <WorkshopLockedSection
            className="workshop-accelerator-section"
            Icon={CircuitBoard}
            title="Accelerators"
            note="Research Specialized Compute"
          >
            <WorkshopEvidence workshop={workshop} />
          </WorkshopLockedSection>
        ))}
    </>
  );
}
