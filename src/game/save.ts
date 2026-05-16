import { createInitialGameState } from "./progression";
import type { GameState } from "./types";

export interface SaveEnvelope {
  version: 1;
  savedAt: string;
  state: GameState;
}

export const createSaveEnvelope = (state: GameState): SaveEnvelope => ({
  version: 1,
  savedAt: new Date().toISOString(),
  state,
});

export const serializeSave = (state: GameState) =>
  JSON.stringify(createSaveEnvelope(state));

export const deserializeSave = (raw: string | null): GameState => {
  if (!raw) return createInitialGameState();

  try {
    const parsed = JSON.parse(raw) as Partial<SaveEnvelope>;

    if (parsed.version === 1 && parsed.state?.version === 1) {
      return parsed.state;
    }
  } catch {
    return createInitialGameState();
  }

  return createInitialGameState();
};

