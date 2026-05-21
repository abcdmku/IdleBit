import { Plus } from "lucide-react";
import type { VisibleState } from "../../game";
import { formatBits, formatCost, formatNumber, formatWatts } from "../format";
import { firstBits, firstBoolean, firstNumber } from "../panels/uiNumbers";
import { ResourceCost } from "../ResourceTokens";
import type { Dispatch } from "../uiActions";
import {
  formatModuleStats,
  getBuilderOptionMap,
  getModuleSpecRows,
  getPresetId,
  getPresetLabel,
  getRecordCosts,
} from "./builderHelpers";
import type { UiCustomMachineBuilder, UiSystemPreset } from "./types";

interface PremadeSystemListProps {
  presets: UiSystemPreset[];
  builder?: UiCustomMachineBuilder | null;
  resources: VisibleState["resources"];
  dispatch: Dispatch;
}

export function PremadeSystemList({
  presets,
  builder = null,
  resources,
  dispatch,
}: PremadeSystemListProps) {
  const { optionsById } = getBuilderOptionMap(builder);

  return (
    <section className="premade-system-list" aria-label="Premade systems">
      {presets.map((preset, index) => {
        const presetId = getPresetId(preset, index);
        const label = getPresetLabel(preset, index);
        const costs = getRecordCosts(preset);
        const canBuy =
          !preset.disabled &&
          (firstBoolean(preset.canBuy, preset.canAfford) ?? true);
        const blockedReason =
          preset.blockedReason ?? preset.lockedReason ?? "Locked";
        const cores = firstNumber(preset.cores, preset.coreCount);
        const ramBits = firstBits([preset.ramBits], [preset.ramBytes]);
        const cacheBits = firstBits([preset.cacheBits], [preset.cacheBytes]);
        const components = preset.components ?? {};
        const componentEntries: Array<[string, string | undefined]> = [
          ["cpu", components.cpu],
          ["ram", components.ram ?? components.memory],
          ["scheduler", components.scheduler],
          ["psu", components.psu ?? components.powerSupply],
        ];
        const componentSpecs = componentEntries
          .map(([groupId, componentId]) =>
            typeof componentId === "string"
              ? getModuleSpecRows(groupId, optionsById.get(componentId))
              : null,
          )
          .filter((row): row is ReturnType<typeof getModuleSpecRows> => row !== null);

        const specs: Array<{ label: string; value: string; tone?: string }> = [];
        if (cores !== undefined) {
          specs.push({ label: "CPU", value: `${formatNumber(cores)} cores` });
        }
        if (ramBits > 0) {
          specs.push({ label: "RAM", value: formatBits(ramBits) });
        }
        if (cacheBits > 0) {
          specs.push({ label: "Cache", value: formatBits(cacheBits) });
        }
        if (preset.powerDeltaWatts !== undefined && preset.powerDeltaWatts !== 0) {
          specs.push({
            label: "Power",
            value: `+${formatWatts(preset.powerDeltaWatts)}`,
            tone: "amber",
          });
        }

        return (
          <button
            key={presetId}
            type="button"
            className="system-preset-card"
            disabled={!canBuy}
            title={canBuy ? `Buy ${label}: ${formatCost(costs)}` : blockedReason}
            onClick={() =>
              dispatch({
                type: "buyPreconfiguredSystem",
                presetId,
              })
            }
          >
            <header className="premade-card-header">
              <span className="premade-card-copy">
                <strong>{label}</strong>
                <small>{preset.role ?? preset.tier ?? "Preset"}</small>
              </span>
              <span className={`premade-card-buy ${canBuy ? "" : "blocked"}`}>
                {canBuy ? (
                  <>
                    <Plus size={12} />
                    <span>Buy</span>
                  </>
                ) : (
                  blockedReason
                )}
              </span>
            </header>
            <dl className="premade-card-specs">
              {(componentSpecs.length > 0
                ? componentSpecs.map((spec) => ({
                    label: spec.label,
                    value:
                      spec.stats.length > 0
                        ? formatModuleStats(spec.groupId, spec.stats)
                        : "-",
                  }))
                : specs
              ).map((spec) => (
                <div key={spec.label} className="premade-card-spec">
                  <dt>{spec.label}</dt>
                  <dd>{"tone" in spec && spec.tone ? <span className={`tone-${spec.tone}`}>{spec.value}</span> : spec.value}</dd>
                </div>
              ))}
            </dl>
            <footer className="premade-card-footer">
              <ResourceCost costs={costs} compact resources={resources} />
            </footer>
          </button>
        );
      })}
    </section>
  );
}
