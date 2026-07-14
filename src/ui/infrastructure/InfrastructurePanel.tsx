import {
  Boxes,
  Building2,
  Network,
  Play,
  Plus,
  Server,
  ServerCog,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  ZERO_AMOUNT,
  amountAdd,
  amountCompare,
  amountToSafeNumber,
  getAggregateServerBatchCosts,
  getNetworkSkuDefinition,
  getStorageSkuDefinition,
  serverSkuDefinitions,
  type Amount,
  type ExactCost,
  type ExactResourceBag,
} from "../../game";
import { MAX_AGGREGATE_SERVER_COUNT } from "../../game/fleet";
import type {
  ClusterWorkloadDefinitionId,
  ReplicaFaultDomain,
  ServerSkuId,
  VisibleInfrastructureState,
} from "../../game/infrastructureTypes";
import {
  facilityTemplateDefinitions,
  rackTemplateDefinitions,
  type FacilityTemplateId,
  type RackTemplateId,
} from "../../game/facilityDefinitions";
import {
  formatExactCurrencyAmount,
  formatExactResourceAmount,
  formatExactResourceRate,
  formatQuantity,
} from "../format";
import { ExactResourceCost } from "../ResourceTokens";
import { SmoothProgress } from "../SmoothProgress";
import { formatWorkDuration } from "../work/workFormat";
import "./infrastructure-panel.css";

const formatRate = (value: Amount) =>
  `${formatExactResourceAmount(value)} ops/s`;
const formatBits = (value: Amount) =>
  `${formatExactResourceAmount(value)} b`;
const formatPercent = (basisPoints: number) =>
  `${formatQuantity(basisPoints / 100)}%`;
// Keep in sync with the unmanaged-node fallback status emitted by
// getVisibleInfrastructureState (src/game/infrastructureSelectors.ts). Any
// other blocker string on an unmanaged node is a real manage gate.
const UNMANAGED_NODE_READY_STATUS = "Node is not managed by Fleet capacity.";
const toBatchCount = (value: string) => {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(MAX_AGGREGATE_SERVER_COUNT, parsed);
};
const canAffordCommission = (
  resources: ExactResourceBag,
  costs: readonly ExactCost[],
) =>
  (["credits", "data"] as const).every((resource) => {
    const total = costs
      .filter((cost) => cost.resource === resource)
      .reduce((sum, cost) => amountAdd(sum, cost.amount), ZERO_AMOUNT);
    return amountCompare(resources[resource], total) >= 0;
  });

export function InfrastructurePanel({
  visible,
  resources,
  facilityAvailable = true,
  onSetNodeManaged,
  onPurchaseServerBatch,
  onCommissionCluster,
  onSetClusterFaultDomain,
  onStartWorkload,
  onCancelWorkload,
  onSetWorkloadWeight,
  onCommissionFacility,
  onCommissionRack,
  onPlaceNode,
  onRemoveNode,
}: {
  visible: VisibleInfrastructureState;
  resources: ExactResourceBag;
  facilityAvailable?: boolean;
  onSetNodeManaged: (systemId: number, managed: boolean) => void;
  onPurchaseServerBatch: (skuId: ServerSkuId, count: number) => void;
  onCommissionCluster: (name: string, nodeIds: string[]) => void;
  onSetClusterFaultDomain: (
    clusterId: string,
    faultDomain: ReplicaFaultDomain,
  ) => void;
  onStartWorkload: (
    clusterId: string,
    definitionId: ClusterWorkloadDefinitionId,
  ) => void;
  onCancelWorkload: (workloadId: string) => void;
  onSetWorkloadWeight: (workloadId: string, weight: number) => void;
  onCommissionFacility: (templateId: FacilityTemplateId) => void;
  onCommissionRack: (
    facilityId: string,
    templateId: RackTemplateId,
  ) => void;
  onPlaceNode: (facilityId: string, rackId: string, nodeId: string) => void;
  onRemoveNode: (nodeId: string) => void;
}) {
  const [clusterName, setClusterName] = useState("Local Fabric");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [batchCountInput, setBatchCountInput] = useState("1");
  const batchCount = toBatchCount(batchCountInput);
  const managedNodes = visible.fleet.nodes.filter((node) => node.managed);
  const placedNodeIds = useMemo(
    () =>
      new Set(
        visible.facilities.flatMap((facility) =>
          facility.racks.flatMap((rack) => rack.nodeIds),
        ),
      ),
    [visible.facilities],
  );
  const unplacedNodes = managedNodes.filter(
    (node) => !placedNodeIds.has(node.id),
  );

  const toggleNode = (nodeId: string) => {
    setSelectedNodeIds((current) =>
      current.includes(nodeId)
        ? current.filter((candidate) => candidate !== nodeId)
        : [...current, nodeId].sort(),
    );
  };

  return (
    <section className="late-command-panel infrastructure-command-panel" aria-label="Infrastructure">
      <header className="late-command-header">
        <ServerCog size={16} aria-hidden="true" />
        <div>
          <h2>Infrastructure</h2>
          <p>Fleet capacity, Local Fabric workloads, true racks, and facilities.</p>
        </div>
      </header>

      <section className="infrastructure-summary" aria-label="Fleet capacity">
        <div>
          <span>Managed nodes</span>
          <strong>{managedNodes.length}</strong>
        </div>
        <div>
          <span>Compute</span>
          <strong>{formatRate(visible.fleet.total.rates.compute)}</strong>
        </div>
        <div>
          <span>Memory</span>
          <strong>{formatBits(visible.fleet.total.memoryBits)}</strong>
        </div>
        <div>
          <span>Storage</span>
          <strong>{formatBits(visible.fleet.total.storageBits)}</strong>
        </div>
        <div>
          <span>Headroom</span>
          <strong>{formatPercent(visible.fleet.headroomBps)}</strong>
        </div>
      </section>

      <section
        className="infrastructure-command-section"
        aria-labelledby="fleet-nodes-title"
      >
        <div className="infrastructure-section-heading">
          <div>
            <Server size={14} aria-hidden="true" />
            <h3 id="fleet-nodes-title">Fleet nodes</h3>
          </div>
          <span>
            {managedNodes.length}/{visible.fleet.nodes.length} managed
          </span>
        </div>

        <div className="fleet-node-list" aria-label="Fleet node management">
          {visible.fleet.nodes.map((node) => {
            const source = node.source;
            const manageBlocker =
              node.blocker === UNMANAGED_NODE_READY_STATUS ? null : node.blocker;
            const blocked = node.managed
              ? node.blocker !== null
              : manageBlocker !== null;
            const status = node.managed
              ? node.blocker ?? "In Fleet capacity."
              : manageBlocker ?? "Ready for Fleet management.";
            return (
              <div className="fleet-node-row" key={node.id}>
                <div className="fleet-node-copy">
                  <strong>{node.name}</strong>
                  {/* Always rendered so manage/release state changes never
                      change row geometry. */}
                  <small
                    className={`fleet-node-status${blocked ? " is-blocked" : ""}`}
                  >
                    {status}
                  </small>
                </div>
                <span className="fleet-node-compute">
                  {formatRate(node.capacity.rates.compute)}
                </span>
                {source.kind === "system" ? (
                  <button
                    type="button"
                    className="fleet-node-action"
                    disabled={!node.managed && manageBlocker !== null}
                    title={
                      node.managed
                        ? `Release ${node.name} from Fleet capacity`
                        : manageBlocker ??
                          `Manage ${node.name} as Fleet capacity`
                    }
                    onClick={() =>
                      onSetNodeManaged(source.systemId, !node.managed)
                    }
                  >
                    {node.managed ? "Release" : "Manage"}
                  </button>
                ) : (
                  <span
                    className="fleet-node-action"
                    title="Aggregate servers stay managed as Fleet capacity."
                  >
                    Procured
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="server-procurement">
          <label className="server-procurement-count">
            <span>Batch size</span>
            <input
              type="number"
              min={1}
              max={MAX_AGGREGATE_SERVER_COUNT}
              value={batchCountInput}
              onChange={(event) =>
                setBatchCountInput(event.currentTarget.value)
              }
            />
          </label>
          <div className="server-catalog" aria-label="Procure aggregate servers">
            {serverSkuDefinitions.map((sku) => {
              const costs = getAggregateServerBatchCosts(
                sku.id,
                batchCount,
                sku.defaultStorageSkuId,
                sku.defaultNetworkSkuId,
              );
              const affordable = canAffordCommission(resources, costs);
              const profileLabel = `${
                getStorageSkuDefinition(sku.defaultStorageSkuId).name
              } + ${getNetworkSkuDefinition(sku.defaultNetworkSkuId).name}`;
              return (
                <button
                  type="button"
                  key={sku.id}
                  disabled={!affordable}
                  title={
                    affordable
                      ? `Purchase ${batchCount}× ${sku.name} (${profileLabel})`
                      : `Insufficient resources to purchase ${batchCount}× ${sku.name}`
                  }
                  onClick={() => onPurchaseServerBatch(sku.id, batchCount)}
                >
                  <span className="infrastructure-commission-label">
                    <Plus size={12} aria-hidden="true" /> {sku.name} ×{batchCount}
                  </span>
                  <ExactResourceCost
                    costs={costs}
                    resources={resources}
                    compact
                  />
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="infrastructure-command-section" aria-labelledby="cluster-title">
        <div className="infrastructure-section-heading">
          <div>
            <Network size={14} aria-hidden="true" />
            <h3 id="cluster-title">Local Fabric</h3>
          </div>
          <span>{visible.clusters.length} clusters</span>
        </div>

        <div className="cluster-builder">
          <label>
            <span>Cluster name</span>
            <input
              value={clusterName}
              maxLength={80}
              onChange={(event) => setClusterName(event.currentTarget.value)}
            />
          </label>
          <fieldset>
            <legend>Managed nodes</legend>
            {managedNodes.length === 0 ? (
              <small>No managed Fleet nodes are available.</small>
            ) : (
              managedNodes.map((node) => (
                <label key={node.id}>
                  <input
                    type="checkbox"
                    checked={selectedNodeIds.includes(node.id)}
                    onChange={() => toggleNode(node.id)}
                  />
                  <span>{node.name}</span>
                </label>
              ))
            )}
          </fieldset>
          <button
            type="button"
            disabled={selectedNodeIds.length === 0 || clusterName.trim() === ""}
            onClick={() => {
              onCommissionCluster(clusterName.trim(), selectedNodeIds);
              setSelectedNodeIds([]);
            }}
          >
            <Plus size={12} aria-hidden="true" /> Commission cluster
          </button>
        </div>

        <div className="cluster-card-grid">
          {visible.clusters.map((cluster) => {
            const workloads = visible.workloads.filter(
              (workload) => workload.clusterId === cluster.id,
            );
            return (
              <article className="cluster-card" key={cluster.id}>
                <header>
                  <div>
                    <strong>{cluster.name}</strong>
                    <span>{cluster.nodeIds.length} nodes</span>
                  </div>
                  <label>
                    <span>Replica domain</span>
                    <select
                      value={cluster.policy.replicaFaultDomain}
                      onChange={(event) =>
                        onSetClusterFaultDomain(
                          cluster.id,
                          event.currentTarget.value as ReplicaFaultDomain,
                        )
                      }
                    >
                      <option value="node">Node</option>
                      <option
                        value="rack"
                        disabled={!visible.horizontalTools.archivistReplicaPolicies}
                      >
                        Rack{visible.horizontalTools.archivistReplicaPolicies ? "" : " · The Archivist"}
                      </option>
                      <option
                        value="zone"
                        disabled={!visible.horizontalTools.archivistReplicaPolicies}
                      >
                        Zone{visible.horizontalTools.archivistReplicaPolicies ? "" : " · The Archivist"}
                      </option>
                    </select>
                  </label>
                </header>
                <dl className="infrastructure-ledger">
                  <div><dt>Compute</dt><dd>{formatRate(cluster.total.rates.compute)}</dd></div>
                  <div><dt>Reserved</dt><dd>{formatRate(cluster.reserved.rates.compute)}</dd></div>
                  <div><dt>Utilization</dt><dd>{formatPercent(cluster.utilizationBps)}</dd></div>
                  <div><dt>Headroom</dt><dd>{formatPercent(cluster.headroomBps)}</dd></div>
                </dl>
                {cluster.blockers.map((blocker) => (
                  <small className="infrastructure-blocker" key={blocker}>{blocker}</small>
                ))}

                <div className="cluster-workload-list">
                  {workloads.map((workload) => (
                    <div className="cluster-workload" key={workload.id}>
                      <header>
                        <strong>{workload.name}</strong>
                        <span>{workload.status}</span>
                      </header>
                      <SmoothProgress
                        max={10_000}
                        value={workload.progressBps}
                        label={`${workload.name} progress`}
                      />
                      <div className="cluster-workload-actions">
                        <label>
                          <span>Weight</span>
                          <input
                            type="number"
                            min={1}
                            max={1_000}
                            value={workload.weight}
                            onChange={(event) =>
                              onSetWorkloadWeight(
                                workload.id,
                                Number(event.currentTarget.value),
                              )
                            }
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => onCancelWorkload(workload.id)}
                          disabled={workload.status === "completed"}
                        >
                          <Trash2 size={12} aria-hidden="true" /> Cancel
                        </button>
                      </div>
                      <dl
                        className="workload-projection"
                        aria-label={`${workload.name} workload projection`}
                      >
                        <div>
                          <dt>Duration</dt>
                          <dd>
                            {workload.projection.durationMs === null
                              ? "Blocked"
                              : formatWorkDuration(
                                  amountToSafeNumber(workload.projection.durationMs),
                                )}
                          </dd>
                        </div>
                        <div>
                          <dt>Operating</dt>
                          <dd>
                            {workload.projection.operatingCost === null
                              ? "—"
                              : `${formatExactCurrencyAmount(
                                  workload.projection.operatingCost,
                                )} cr`}
                          </dd>
                        </div>
                        <div>
                          <dt>Net</dt>
                          <dd>
                            {workload.projection.netCreditReward === null
                              ? "—"
                              : `${formatExactCurrencyAmount(
                                  workload.projection.netCreditReward,
                                )} cr`}
                          </dd>
                        </div>
                        <div>
                          <dt>Margin</dt>
                          <dd>
                            {workload.projection.marginBps === null
                              ? "—"
                              : formatPercent(workload.projection.marginBps)}
                          </dd>
                        </div>
                        <div>
                          <dt>Buffer</dt>
                          <dd>{workload.projection.bufferCovered ? "Covered" : "Too short"}</dd>
                        </div>
                      </dl>
                      {workload.projection.pauseReason && (
                        <small className="infrastructure-blocker">
                          Projected pause: {workload.projection.pauseReason}
                        </small>
                      )}
                      {workload.blockers.map((blocker) => (
                        <small className="infrastructure-blocker" key={blocker}>{blocker}</small>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="workload-catalog">
                  {visible.workloadDefinitions.map((definition) => {
                    const option = definition.clusterOptions.find(
                      (candidate) => candidate.clusterId === cluster.id,
                    );
                    return (
                      <button
                        type="button"
                        key={definition.id}
                        disabled={!option?.canStart}
                        title={option?.blockedReason ?? `Start ${definition.name}`}
                        onClick={() => onStartWorkload(cluster.id, definition.id)}
                      >
                        <Play size={12} aria-hidden="true" />
                        <span>{definition.name}</span>
                        <small>
                          {formatExactCurrencyAmount(definition.rewards.credits)} cr
                        </small>
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {facilityAvailable && (
      <section className="infrastructure-command-section" aria-labelledby="facility-title">
        <div className="infrastructure-section-heading">
          <div>
            <Building2 size={14} aria-hidden="true" />
            <h3 id="facility-title">Rack and Facility</h3>
          </div>
          <span>
            {visible.horizontalTools.gridReliefOperatingDiscountBps > 0
              ? `Grid Relief · -${formatQuantity(
                  visible.horizontalTools.gridReliefOperatingDiscountBps / 100,
                )}% operating`
              : `${visible.facilities.length} facilities`}
          </span>
        </div>
        <div className="facility-catalog" aria-label="Commission facility">
          {facilityTemplateDefinitions.map((template) => {
            const affordable = canAffordCommission(
              resources,
              template.commissionCosts,
            );
            return (
              <button
                type="button"
                key={template.id}
                disabled={!affordable}
                title={
                  affordable
                    ? `Commission ${template.name}`
                    : `Insufficient resources to commission ${template.name}`
                }
                onClick={() => onCommissionFacility(template.id)}
              >
                <span className="infrastructure-commission-label">
                  <Plus size={12} aria-hidden="true" /> {template.name}
                </span>
                <ExactResourceCost
                  costs={template.commissionCosts}
                  resources={resources}
                  compact
                />
              </button>
            );
          })}
        </div>

        <div className="facility-card-grid">
          {visible.facilities.map((facility) => (
            <article className="facility-card" key={facility.id}>
              <header>
                <div>
                  <strong>{facility.name}</strong>
                  <span>{facility.id}</span>
                </div>
                <span>{formatPercent(facility.headroomBps)} headroom</span>
              </header>
              <dl className="infrastructure-ledger">
                <div><dt>Racks</dt><dd>{facility.rackSlots.demand}/{facility.rackSlots.capacity}</dd></div>
                <div><dt>Power</dt><dd>{formatExactResourceAmount(facility.demand.powerWatts)} W</dd></div>
                <div><dt>Cooling</dt><dd>{formatExactResourceAmount(facility.demand.coolingWatts)} W</dd></div>
                <div><dt>Operating</dt><dd>{formatExactResourceRate(facility.operatingCost.totalPerSecond)} cr/s</dd></div>
              </dl>
              {facility.blockers.map((blocker) => (
                <small className="infrastructure-blocker" key={blocker}>{blocker}</small>
              ))}
              <div className="rack-catalog" aria-label={`Commission rack in ${facility.name}`}>
                {rackTemplateDefinitions.map((template) => {
                  const affordable = canAffordCommission(
                    resources,
                    template.commissionCosts,
                  );
                  const hasRackSlot = facility.rackSlots.available > 0;
                  return (
                    <button
                      type="button"
                      key={template.id}
                      disabled={!affordable || !hasRackSlot}
                      title={
                        !hasRackSlot
                          ? `${facility.name} has no open rack slots`
                          : affordable
                            ? `Commission ${template.name}`
                            : `Insufficient resources to commission ${template.name}`
                      }
                      onClick={() => onCommissionRack(facility.id, template.id)}
                    >
                      <span className="infrastructure-commission-label">
                        <Plus size={11} aria-hidden="true" /> {template.name}
                      </span>
                      <ExactResourceCost
                        costs={template.commissionCosts}
                        resources={resources}
                        compact
                      />
                    </button>
                  );
                })}
              </div>
              <div className="true-rack-list">
                {facility.racks.map((rack) => (
                  <section className="true-rack-card" key={rack.id}>
                    <header>
                      <div>
                        <Boxes size={13} aria-hidden="true" />
                        <strong>{rack.name}</strong>
                      </div>
                      <span>{rack.rackUnits.available}U free</span>
                    </header>
                    <p>
                      {formatPercent(rack.headroomBps)} resource headroom · {formatExactResourceRate(rack.operatingCostPerSecond)} cr/s
                    </p>
                    <div className="rack-node-list">
                      {rack.nodeIds.map((nodeId) => {
                        const node = managedNodes.find((candidate) => candidate.id === nodeId);
                        return (
                          <div key={nodeId}>
                            <span>{node?.name ?? nodeId}</span>
                            <button type="button" onClick={() => onRemoveNode(nodeId)}>
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {unplacedNodes.length > 0 && (
                      <label className="rack-placement-control">
                        <span>Place managed node</span>
                        <select
                          defaultValue=""
                          onChange={(event) => {
                            const nodeId = event.currentTarget.value;
                            if (!nodeId) return;
                            onPlaceNode(facility.id, rack.id, nodeId);
                            event.currentTarget.value = "";
                          }}
                        >
                          <option value="">Select node</option>
                          {unplacedNodes.map((node) => (
                            <option value={node.id} key={node.id}>{node.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </section>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
      )}
    </section>
  );
}
