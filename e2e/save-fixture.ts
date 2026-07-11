import type { Page } from "@playwright/test";
import {
  deserializeSave,
  recordDeparture,
  serializeSave,
  type GameState,
} from "../src/game";

export const SAVE_STORAGE_KEY = "idlebit:save-v7";

export const installGameSave = async (
  page: Page,
  state: GameState,
  savedAtMs: number,
) => {
  const serialized = serializeSave(state, savedAtMs);
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: SAVE_STORAGE_KEY, value: serialized },
  );
};

/** Flushes the renderer's current state through the same synchronous pagehide path used on exit. */
export const readPersistedGameState = async (page: Page): Promise<GameState> => {
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
  });
  const stored = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    SAVE_STORAGE_KEY,
  );
  if (stored === null) throw new Error("Expected a persisted IdleBit save");
  const serialized: unknown = JSON.parse(stored);
  if (typeof serialized !== "string") {
    throw new Error("Expected the persistence adapter to store a serialized save");
  }
  return deserializeSave(serialized);
};

/**
 * Reopens the state produced by public UI controls after a deterministic absence.
 * Only the departure timestamp changes; normal hydration performs the catch-up.
 */
export const resumePersistedGameAfterAbsence = async (
  page: Page,
  elapsedMs: number,
): Promise<Page> => {
  const persisted = await readPersistedGameState(page);
  const departedAtMs = Date.now() - Math.max(0, Math.trunc(elapsedMs));
  const departed = recordDeparture(persisted, departedAtMs);
  const resumedPage = await page.context().newPage();
  await installGameSave(resumedPage, departed, departedAtMs);
  await page.close();
  await resumedPage.goto("/");
  return resumedPage;
};
