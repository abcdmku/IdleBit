import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { idleBitPersistence } from "../../platform";
import {
  CREDIT_FAILURE_MODAL_SEEN_KEY,
  DEADLOCK_COOLDOWN_HELP_KEY,
  DEADLOCK_HELP_KEY,
  PSU_FAILURE_HELP_KEY,
  PSU_FAILURE_MODAL_SEEN_KEY,
} from "../app/persistence";
import { useNoticePreferences } from "./useNoticePreferences";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

type NoticeHook = ReturnType<typeof useNoticePreferences>;
let latestHook: NoticeHook;

function Harness() {
  latestHook = useNoticePreferences({ seedRackReady: false });
  return <output data-ready={String(latestHook.ready)} />;
}

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useNoticePreferences", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    await idleBitPersistence.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    container.remove();
    await idleBitPersistence.clear();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it("resets notice preferences in memory and storage", async () => {
    const keys = [
      DEADLOCK_HELP_KEY,
      DEADLOCK_COOLDOWN_HELP_KEY,
      PSU_FAILURE_HELP_KEY,
      PSU_FAILURE_MODAL_SEEN_KEY,
      CREDIT_FAILURE_MODAL_SEEN_KEY,
    ] as const;
    await Promise.all(keys.map((key) => idleBitPersistence.set(key, true)));

    act(() => root.render(<Harness />));
    await flushEffects();

    expect(latestHook).toMatchObject({
      ready: true,
      deadlockHelpSeen: true,
      deadlockCooldownHelpSeen: true,
      psuFailureHelpSeen: true,
      psuFailureModalSeen: true,
      creditFailureModalSeen: true,
    });

    await act(async () => {
      await latestHook.resetNoticePreferences();
    });

    expect(latestHook).toMatchObject({
      deadlockHelpSeen: false,
      deadlockCooldownHelpSeen: false,
      psuFailureHelpSeen: false,
      psuFailureModalSeen: false,
      creditFailureModalSeen: false,
    });
    await Promise.all(
      keys.map(async (key) =>
        expect(idleBitPersistence.get<boolean>(key, true)).resolves.toBe(false),
      ),
    );
  });
});

