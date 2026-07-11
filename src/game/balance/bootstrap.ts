import { advanceGame } from "../advance";
import { getCampaignObjectiveDefinition } from "../campaign";
import { createInitialGameState } from "../progression";
import { createRngState } from "../rng";
import { deriveVisibleState } from "../selectors";
import { applyAction } from "../simulation";
import type {
  CompletionAdapter,
  MilestoneAdapter,
  PublicGameRuntimeAdapter,
} from "./types";
import { profileAwareActionPolicy } from "./policy";

/** Current-game adapter used as an integration smoke test for the generic runner. */
export const bootstrapSmokeRuntime: PublicGameRuntimeAdapter = {
  createInitialState: (seed) => {
    const state = createInitialGameState();
    return { ...state, rng: createRngState(seed) };
  },
  observe: deriveVisibleState,
  dispatch: applyAction,
  advance: advanceGame,
};

export const bootstrapCompletionAdapter: CompletionAdapter = {
  isComplete: (visible) => visible.campaign.postgameUnlocked,
};

export const bootstrapMilestoneAdapter: MilestoneAdapter = {
  getReachedMilestones: (visible) => [
    {
      id: `buffer:${visible.automationBuffer.ownedLevelId}`,
      label: `Automation Buffer: ${visible.automationBuffer.ownedLevelId}`,
    },
    ...visible.campaign.completedChapterIds.map((chapterId) => ({
      id: `chapter:${chapterId}`,
      label: `Chapter: ${chapterId}`,
    })),
    ...visible.campaign.completedObjectiveIds.map((objectiveId) => ({
      id: `mission:${objectiveId}`,
      label: getCampaignObjectiveDefinition(objectiveId)?.name ?? objectiveId,
    })),
  ],
};

/** Public-state smoke adapter now uses the auditable profile-aware balance policy. */
export const bootstrapSmokeActionPolicy = profileAwareActionPolicy;
