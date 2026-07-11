import {
  Activity,
  CloudCog,
  Globe2,
  Network,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  amount,
  amountCompare,
  amountDivide,
  amountMin,
  amountMultiply,
  amountToSafeNumber,
  type Amount,
} from "../../game/amount";
import type { CloudSlaDefinitionId } from "../../game/cloud";
import type { VisibleCloudState } from "../../game/cloudSelectors";
import type { RoutingEdge } from "../../game/routing";
import type { FinaleCharterId } from "../../game/types";
import { formatExactResourceAmount } from "../format";
import { SmoothProgress } from "../SmoothProgress";
import { formatWorkDuration } from "../work/workFormat";

const exactProgress = (completed: Amount, required: Amount) => {
  if (amountCompare(required, 0) <= 0) return 1;
  const bps = amountToSafeNumber(
    amountDivide(
      amountMultiply(amountMin(completed, required), 10_000),
      required,
    ),
  );
  return Math.max(0, Math.min(1, bps / 10_000));
};

const formatCapacity = (capacity: Amount) =>
  `${formatExactResourceAmount(capacity)} ops/s`;

const parseNonNegativeAmount = (value: string): Amount | null => {
  try {
    const parsed = amount(value.trim());
    return amountCompare(parsed, 0) >= 0 ? parsed : null;
  } catch {
    return null;
  }
};

const finiteInteger = (
  value: string,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : null;
};

export interface CloudFacilityOption {
  id: string;
  name: string;
  capacityPerSecond: Amount;
}

interface CloudPanelProps {
  visible: VisibleCloudState;
  availableFacilities: readonly CloudFacilityOption[];
  planetaryAvailable: boolean;
  onCommissionRegion: (name: string) => void;
  onCommissionZone: (options: {
    regionId: string;
    facilityId: string;
    name: string;
    baseLatencyMs: number;
    faultDomainId: string;
  }) => void;
  onPlaceReplica: (zoneId: string) => void;
  onSetRegionalDemand: (regionId: string, demand: Amount) => void;
  onSetRoutingLinks: (links: RoutingEdge[]) => void;
  onSetFailoverPolicy: (automaticFailover: boolean, delayMs: number) => void;
  onDrawIncident: (windowMs: number) => void;
  onRequestFailover: () => void;
  onStartSla: (definitionId: CloudSlaDefinitionId) => void;
  onStartFinale: () => void;
  onSelectCharter: (charterId: FinaleCharterId) => void;
}

export function CloudPanel({
  visible,
  availableFacilities,
  onCommissionRegion,
  onCommissionZone,
  onPlaceReplica,
  onSetRegionalDemand,
  onSetRoutingLinks,
  onSetFailoverPolicy,
  onDrawIncident,
  onRequestFailover,
  onStartSla,
  onStartFinale,
  onSelectCharter,
}: CloudPanelProps) {
  const [regionName, setRegionName] = useState("Regional Edge");
  const [zoneName, setZoneName] = useState("Availability Zone");
  const [zoneRegionId, setZoneRegionId] = useState("");
  const [zoneFacilityId, setZoneFacilityId] = useState("");
  const [faultDomainId, setFaultDomainId] = useState("grid-a");
  const [baseLatencyMs, setBaseLatencyMs] = useState("25");
  const [demandDrafts, setDemandDrafts] = useState<Record<string, string>>({});
  const [linkFrom, setLinkFrom] = useState("");
  const [linkTo, setLinkTo] = useState("");
  const [linkCapacity, setLinkCapacity] = useState("1000000000");
  const [linkCost, setLinkCost] = useState("1");
  const [linkLatency, setLinkLatency] = useState("50");
  const [incidentWindowHours, setIncidentWindowHours] = useState("1");
  const effectiveRegionId = visible.regions.some(
    (region) => region.id === zoneRegionId,
  )
    ? zoneRegionId
    : visible.regions[0]?.id ?? "";
  const usedFacilityIds = useMemo(
    () => new Set(visible.zones.map((zone) => zone.facilityId)),
    [visible.zones],
  );
  const unusedFacilities = availableFacilities.filter(
    (facility) => !usedFacilityIds.has(facility.id),
  );
  const effectiveFacilityId = unusedFacilities.some(
    (facility) => facility.id === zoneFacilityId,
  )
    ? zoneFacilityId
    : unusedFacilities[0]?.id ?? "";
  const effectiveLinkFrom = visible.regions.some(
    (region) => region.id === linkFrom,
  )
    ? linkFrom
    : visible.regions[0]?.id ?? "";
  const effectiveLinkTo = visible.regions.some(
    (region) => region.id === linkTo && region.id !== effectiveLinkFrom,
  )
    ? linkTo
    : visible.regions.find((region) => region.id !== effectiveLinkFrom)?.id ?? "";
  const parsedLatency = finiteInteger(baseLatencyMs, 0, 60_000);
  const parsedLinkCapacity = parseNonNegativeAmount(linkCapacity);
  const parsedLinkCost = finiteInteger(linkCost, 0, 1_000_000);
  const parsedLinkLatency = finiteInteger(linkLatency, 0, 60_000);
  const parsedIncidentHours = Number(incidentWindowHours);
  const activeDefinition = visible.activeSla
    ? visible.slaDefinitions.find(
        (definition) => definition.id === visible.activeSla?.definitionId,
      ) ?? null
    : null;
  const finaleProgress = exactProgress(
    visible.finale.phaseContribution,
    visible.finale.phaseContributionRequired,
  );
  const addRoutingLink = () => {
    if (
      !effectiveLinkFrom ||
      !effectiveLinkTo ||
      effectiveLinkFrom === effectiveLinkTo ||
      parsedLinkCapacity === null ||
      parsedLinkCost === null ||
      parsedLinkLatency === null
    ) {
      return;
    }
    const id = `route:${effectiveLinkFrom}:${effectiveLinkTo}`;
    const next = [
      ...visible.routing.links.filter((link) => link.id !== id),
      {
        id,
        from: effectiveLinkFrom,
        to: effectiveLinkTo,
        capacity: parsedLinkCapacity,
        costPerUnit: parsedLinkCost,
        latencyMs: parsedLinkLatency,
      },
    ].sort((left, right) => left.id.localeCompare(right.id));
    onSetRoutingLinks(next);
  };

  return (
    <section className="late-command-panel cloud-command-panel" aria-label="Resilient Cloud">
      <header className="late-command-header">
        <CloudCog size={16} aria-hidden="true" />
        <div>
          <h2>Resilient Cloud</h2>
          <p>Availability zones, SLA windows, routing, and the planetary commons.</p>
        </div>
      </header>

      <div className="cloud-routing-summary" aria-label="Regional routing">
        <div>
          <Network size={13} aria-hidden="true" />
          <span>Delivered</span>
          <strong>{formatCapacity(visible.routing.deliveredPerSecond)}</strong>
        </div>
        <div>
          <Activity size={13} aria-hidden="true" />
          <span>Unmet</span>
          <strong>{formatCapacity(visible.routing.unmetPerSecond)}</strong>
        </div>
        <div>
          <Globe2 size={13} aria-hidden="true" />
          <span>Coverage</span>
          <strong>
            {visible.routing.connectedRegionIds.length}/{visible.regions.length} regions
          </strong>
        </div>
        <div>
          <ShieldCheck size={13} aria-hidden="true" />
          <span>p95 latency</span>
          <strong>
            {visible.routing.p95LatencyMs === null
              ? "No route"
              : `${visible.routing.p95LatencyMs} ms`}
          </strong>
        </div>
      </div>

      <section className="cloud-command-section" aria-labelledby="cloud-topology-title">
        <div className="cloud-section-heading">
          <h3 id="cloud-topology-title">Regional topology</h3>
          <span>{visible.regions.length} regions · {visible.routing.links.length} links</span>
        </div>
        <div className="cloud-control-grid cloud-region-builder">
          <label>
            <span>Region name</span>
            <input
              value={regionName}
              maxLength={80}
              onChange={(event) => setRegionName(event.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            disabled={regionName.trim() === ""}
            onClick={() => onCommissionRegion(regionName.trim())}
          >
            Commission region
          </button>
        </div>
        <div className="cloud-region-grid">
          {visible.regions.map((region) => {
            const draft = demandDrafts[region.id] ?? region.demandPerSecond;
            const parsedDemand = parseNonNegativeAmount(draft);
            return (
              <article key={region.id}>
                <header>
                  <strong>{region.name}</strong>
                  <span>{region.zoneCount} zones</span>
                </header>
                <label>
                  <span>Demand (ops/s)</span>
                  <input
                    inputMode="decimal"
                    value={draft}
                    aria-label={`${region.name} demand`}
                    onChange={(event) =>
                      setDemandDrafts((current) => ({
                        ...current,
                        [region.id]: event.currentTarget.value,
                      }))
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={parsedDemand === null}
                  onClick={() => parsedDemand && onSetRegionalDemand(region.id, parsedDemand)}
                >
                  Apply demand
                </button>
              </article>
            );
          })}
        </div>
        {visible.regions.length >= 2 && (
          <div className="cloud-routing-editor">
            <div className="cloud-control-grid">
              <label>
                <span>From</span>
                <select value={effectiveLinkFrom} onChange={(event) => setLinkFrom(event.currentTarget.value)}>
                  {visible.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
                </select>
              </label>
              <label>
                <span>To</span>
                <select value={effectiveLinkTo} onChange={(event) => setLinkTo(event.currentTarget.value)}>
                  {visible.regions.filter((region) => region.id !== effectiveLinkFrom).map((region) => (
                    <option key={region.id} value={region.id}>{region.name}</option>
                  ))}
                </select>
              </label>
              <label><span>Capacity</span><input inputMode="decimal" value={linkCapacity} onChange={(event) => setLinkCapacity(event.currentTarget.value)} /></label>
              <label><span>Cost score</span><input type="number" min={0} value={linkCost} onChange={(event) => setLinkCost(event.currentTarget.value)} /></label>
              <label><span>Latency (ms)</span><input type="number" min={0} value={linkLatency} onChange={(event) => setLinkLatency(event.currentTarget.value)} /></label>
              <button type="button" disabled={!effectiveLinkTo || parsedLinkCapacity === null || parsedLinkCost === null || parsedLinkLatency === null} onClick={addRoutingLink}>
                Add/update route
              </button>
            </div>
            {visible.routing.links.map((link) => (
              <div className="cloud-route-row" key={link.id}>
                <span>{link.from} → {link.to}</span>
                <span>{formatCapacity(link.capacity)} · {link.latencyMs} ms</span>
                <button type="button" onClick={() => onSetRoutingLinks(visible.routing.links.filter((candidate) => candidate.id !== link.id))}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="cloud-command-section" aria-labelledby="cloud-zones-title">
        <div className="cloud-section-heading">
          <h3 id="cloud-zones-title">Availability zones</h3>
          <button
            type="button"
            onClick={onRequestFailover}
            disabled={visible.zones.length < 2 || visible.failover.pendingZoneId !== null}
          >
            <RefreshCw size={12} aria-hidden="true" />
            {visible.failover.pendingZoneId ? "Failover pending" : "Request failover"}
          </button>
        </div>
        <div className="cloud-zone-builder cloud-control-grid">
          <label>
            <span>Region</span>
            <select value={effectiveRegionId} disabled={visible.regions.length === 0} onChange={(event) => setZoneRegionId(event.currentTarget.value)}>
              {visible.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </label>
          <label>
            <span>Facility</span>
            <select value={effectiveFacilityId} disabled={unusedFacilities.length === 0} onChange={(event) => setZoneFacilityId(event.currentTarget.value)}>
              {unusedFacilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name} · {formatCapacity(facility.capacityPerSecond)}</option>)}
            </select>
          </label>
          <label><span>Zone name</span><input value={zoneName} maxLength={80} onChange={(event) => setZoneName(event.currentTarget.value)} /></label>
          <label><span>Fault domain</span><input value={faultDomainId} maxLength={120} onChange={(event) => setFaultDomainId(event.currentTarget.value)} /></label>
          <label><span>Base latency (ms)</span><input type="number" min={0} max={60_000} value={baseLatencyMs} onChange={(event) => setBaseLatencyMs(event.currentTarget.value)} /></label>
          <button
            type="button"
            disabled={!effectiveRegionId || !effectiveFacilityId || zoneName.trim() === "" || faultDomainId.trim() === "" || parsedLatency === null}
            onClick={() => parsedLatency !== null && onCommissionZone({ regionId: effectiveRegionId, facilityId: effectiveFacilityId, name: zoneName.trim(), baseLatencyMs: parsedLatency, faultDomainId: faultDomainId.trim() })}
          >
            Commission zone
          </button>
        </div>
        <div className="cloud-zone-grid">
          {visible.zones.length === 0 ? (
            <p className="cloud-empty">Commission a facility-backed zone to begin.</p>
          ) : (
            visible.zones.map((zone) => (
              <article
                className={`cloud-zone-card ${zone.status} ${zone.active ? "active" : ""}`}
                key={zone.id}
              >
                <header>
                  <strong>{zone.name}</strong>
                  <span>{zone.active ? "Active" : zone.failoverPending ? "Pending" : zone.status}</span>
                </header>
                <p>{zone.regionName} · {zone.facilityId}</p>
                <dl>
                  <div>
                    <dt>Usable</dt>
                    <dd>{formatCapacity(zone.effectiveCapacityPerSecond)}</dd>
                  </div>
                  <div>
                    <dt>Replicas</dt>
                    <dd>{zone.healthyReplicaCount}/{zone.replicaCount} healthy</dd>
                  </div>
                  <div>
                    <dt>Fault domain</dt>
                    <dd>{zone.faultDomainId}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  disabled={zone.replicaCount > 0}
                  onClick={() => onPlaceReplica(zone.id)}
                >
                  {zone.replicaCount > 0 ? "Replica placed" : "Place replica"}
                </button>
              </article>
            ))
          )}
        </div>
        <div className="cloud-failover-controls">
          <label>
            <input
              type="checkbox"
              checked={visible.automaticFailover}
              onChange={(event) => onSetFailoverPolicy(event.currentTarget.checked, visible.failoverDelayMs)}
            />
            <span>Automatic failover</span>
          </label>
          <label>
            <span>Delay (ms)</span>
            <input
              type="number"
              min={0}
              max={86_400_000}
              value={visible.failoverDelayMs}
              onChange={(event) => {
                const delay = finiteInteger(event.currentTarget.value, 0, 86_400_000);
                if (delay !== null) onSetFailoverPolicy(visible.automaticFailover, delay);
              }}
            />
          </label>
          <label>
            <span>Incident horizon (hours)</span>
            <input type="number" min={0.25} max={168} step={0.25} value={incidentWindowHours} onChange={(event) => setIncidentWindowHours(event.currentTarget.value)} />
          </label>
          <button
            type="button"
            disabled={!Number.isFinite(parsedIncidentHours) || parsedIncidentHours <= 0 || parsedIncidentHours > 168 || visible.zones.length === 0}
            onClick={() => onDrawIncident(Math.trunc(parsedIncidentHours * 60 * 60_000))}
          >
            Draw opt-in incident
          </button>
        </div>
      </section>

      <section className="cloud-command-section" aria-labelledby="cloud-sla-title">
        <h3 id="cloud-sla-title">SLA contracts</h3>
        {visible.activeSla && activeDefinition && (
          <article className="cloud-active-sla">
            <header>
              <strong>{visible.activeSla.name}</strong>
              <span>
                {formatWorkDuration(visible.activeSla.observationRemainingMs)} window left
              </span>
            </header>
            <SmoothProgress
              max={1}
              value={exactProgress(
                visible.activeSla.workCompleted,
                visible.activeSla.workRequired,
              )}
              label={`${visible.activeSla.name} work progress`}
            />
            <div className="cloud-sla-metrics">
              <span>{visible.activeSla.evaluation.availabilityBps / 100}% availability</span>
              <span>
                {visible.activeSla.evaluation.p95LatencyMs === null
                  ? "Latency pending"
                  : `${visible.activeSla.evaluation.p95LatencyMs} ms p95`}
              </span>
              <span>{formatExactResourceAmount(activeDefinition.rewards.credits)} cr reward</span>
            </div>
          </article>
        )}
        <div className="cloud-sla-list">
          {visible.slaDefinitions.map((definition) => (
            <article key={definition.id}>
              <div>
                <strong>{definition.name}</strong>
                <p>{definition.description}</p>
                <small>
                  {formatWorkDuration(definition.observationWindowMs)} observation · {formatExactResourceAmount(definition.rewards.credits)} cr
                </small>
                {definition.blockedReason && (
                  <small className="cloud-blocker">{definition.blockedReason}</small>
                )}
              </div>
              <button
                type="button"
                disabled={!definition.canStart}
                title={definition.blockedReason ?? `Start ${definition.name}`}
                onClick={() => onStartSla(definition.id)}
              >
                <Play size={12} aria-hidden="true" /> Start
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="cloud-command-section planetary-command" aria-labelledby="planetary-title">
        <div className="cloud-section-heading">
          <h3 id="planetary-title">Planetary Commons</h3>
          {!visible.finale.started && (
            <button
              type="button"
              onClick={onStartFinale}
              disabled={!visible.finale.canStart}
              title={
                visible.finale.blockedReason ?? "Start the planetary finale"
              }
            >
              <Play size={12} aria-hidden="true" /> Start finale
            </button>
          )}
        </div>
        {!visible.finale.started && visible.finale.blockedReason && (
          <small className="cloud-blocker">
            {visible.finale.blockedReason}
          </small>
        )}
        {visible.finale.started && (
          <div className="planetary-progress">
            <header>
              <strong>
                {visible.finale.complete
                  ? "Commons online"
                  : visible.finale.phaseName ?? "Planetary phase"}
              </strong>
              <span>
                {visible.finale.complete
                  ? "Complete"
                  : `${visible.finale.connectedRegionIds.length} regions connected`}
              </span>
            </header>
            <SmoothProgress
              max={1}
              value={visible.finale.complete ? 1 : finaleProgress}
              label="Planetary finale progress"
            />
            {!visible.finale.complete && (
              <small>
                {formatExactResourceAmount(visible.finale.phaseContribution)} / {formatExactResourceAmount(visible.finale.phaseContributionRequired)} contribution
              </small>
            )}
          </div>
        )}
        <div className="cloud-charter-grid" aria-label="Finale charters">
          {visible.charters.map((charter) => (
            <button
              type="button"
              key={charter.id}
              aria-pressed={charter.selected}
              disabled={!charter.canSelect}
              onClick={() => onSelectCharter(charter.id)}
            >
              <strong>{charter.name}</strong>
              <span>{charter.description}</span>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
