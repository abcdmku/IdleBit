import { canAffordExact, spendExact } from "./economy";
import { getCampaignChapterIndex } from "./campaign";
import {
  getNetworkSkuDefinition,
  isNetworkSkuId,
  networkSkuDefinitions,
} from "./infrastructureDefinitions";
import { normalizeInfrastructureForGameState } from "./fleet";
import type { NetworkSkuId } from "./infrastructureTypes";
import type { GameState } from "./types";

const getSystemNetworkNode = (state: GameState, systemId: number) =>
  state.infrastructure.fleetNodes.find(
    (node) =>
      node.source.kind === "system" && node.source.systemId === systemId,
  ) ?? null;

/** Local NICs become player-facing when cross-system work first unlocks. */
export const isLocalNetworkUnlocked = (state: GameState) =>
  getCampaignChapterIndex(state.campaign.currentChapterId) >=
  getCampaignChapterIndex("localFabric");

export const getLocalNetworkSkuId = (
  state: GameState,
  systemId = state.selectedSystemId,
): NetworkSkuId =>
  getSystemNetworkNode(state, systemId)?.networkSkuId ?? "networkNone";

export const getLocalNetworkInstallBlockedReason = (
  state: GameState,
  skuId: NetworkSkuId,
  systemId = state.selectedSystemId,
) => {
  if (!isLocalNetworkUnlocked(state)) return "Reach Local Fabric.";
  if (!state.systems.some((system) => system.id === systemId)) {
    return "System is unavailable.";
  }
  const node = getSystemNetworkNode(state, systemId);
  if (!node) return "System network inventory is unavailable.";
  if (node.networkSkuId === skuId) return "Already installed.";
  return canAffordExact(state, getNetworkSkuDefinition(skuId).costs)
    ? null
    : "Insufficient Credits or Data.";
};

export const installLocalNetwork = (
  state: GameState,
  skuId: NetworkSkuId,
  systemId = state.selectedSystemId,
): GameState => {
  if (!isNetworkSkuId(skuId)) return state;
  const normalized = normalizeInfrastructureForGameState(state);
  if (getLocalNetworkInstallBlockedReason(normalized, skuId, systemId)) {
    return normalized;
  }
  const purchased = spendExact(
    normalized,
    getNetworkSkuDefinition(skuId).costs,
  );
  return {
    ...purchased,
    infrastructure: {
      ...purchased.infrastructure,
      fleetNodes: purchased.infrastructure.fleetNodes.map((node) =>
        node.source.kind === "system" && node.source.systemId === systemId
          ? { ...node, networkSkuId: skuId }
          : node,
      ),
    },
  };
};

export const getLocalNetworkSkuDefinitions = () => networkSkuDefinitions;
