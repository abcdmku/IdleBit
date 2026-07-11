import { _electron as electron, expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  createInitialGameState,
  recordDeparture,
  serializeSave,
} from "../src/game";
import "../src/platform/platformBridge";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const launchApplication = (userDataDirectory: string) =>
  electron.launch({
    ...(process.env.ELECTRON_EXECUTABLE_PATH
      ? { executablePath: process.env.ELECTRON_EXECUTABLE_PATH }
      : {}),
    args: [
      projectRoot,
      "--no-sandbox",
      "--disable-gpu",
      `--user-data-dir=${userDataDirectory}`,
    ],
    cwd: projectRoot,
    env: { ...process.env, IDLEBIT_FILE_RENDERER: "1" },
  });

test("relaunches the built renderer with durable state, offline progress, and the close handshake", async ({}, testInfo) => {
  const userDataDirectory = testInfo.outputPath("user-data");
  const application = await launchApplication(userDataDirectory);

  try {
    const rendererPage = await application.firstWindow();
    await expect(
      rendererPage.getByRole("main", { name: "IdleBit system workbench" }),
    ).toBeVisible();
    await expect(rendererPage.locator("body")).toContainText("Bootstrap Node");
    expect(await rendererPage.evaluate(() => window.location.protocol)).toBe("file:");

    const bridge = await rendererPage.evaluate(() => ({
      persistence: typeof window.idleBitPlatform?.persistence?.setItem === "function",
      lifecycle: typeof window.idleBitPlatform?.lifecycle?.onBeforeClose === "function",
    }));
    expect(bridge).toEqual({ persistence: true, lifecycle: true });

    await rendererPage.evaluate(async () => {
      await window.idleBitPlatform!.persistence!.setItem(
        "electron-e2e-probe",
        JSON.stringify({ ok: true }),
      );
    });
    await expect
      .poll(() =>
        rendererPage.evaluate(async () =>
          window.idleBitPlatform!.persistence!.getItem("electron-e2e-probe"),
        ),
      )
      .toBe(JSON.stringify({ ok: true }));

    const closed = application.waitForEvent("close");
    await rendererPage.close();
    await closed;
  } finally {
    await application.close().catch(() => undefined);
  }

  const persistencePath = path.join(
    userDataDirectory,
    "storage",
    "persistence.json",
  );
  const storedValues = JSON.parse(
    await fs.readFile(persistencePath, "utf8"),
  ) as Record<string, string>;
  const departedAtMs = Date.now() - 30_000;
  let offlineState = createInitialGameState();
  offlineState = {
    ...offlineState,
    automationBuffer: {
      ownedLevelId: "localScheduler",
      departureLevelId: "localScheduler",
      offlineProcessedMs: 0,
    },
    power: { ...offlineState.power, bootstrapGraceSeconds: 120 },
  };
  offlineState = applyAction(offlineState, {
    type: "startTask",
    taskId: "fetchBit",
  });
  offlineState = recordDeparture(offlineState, departedAtMs);
  storedValues["idlebit:save-v7"] = JSON.stringify(
    serializeSave(offlineState, departedAtMs),
  );
  await fs.writeFile(persistencePath, JSON.stringify(storedValues, null, 2));

  const relaunchedApplication = await launchApplication(userDataDirectory);
  try {
    const rendererPage = await relaunchedApplication.firstWindow();
    await expect(
      rendererPage.getByRole("main", { name: "IdleBit system workbench" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        rendererPage.evaluate(async () =>
          window.idleBitPlatform!.persistence!.getItem("electron-e2e-probe"),
        ),
      )
      .toBe(JSON.stringify({ ok: true }));

    const returnSummary = rendererPage.getByRole("dialog", {
      name: "Return summary",
    });
    await expect(returnSummary).toBeVisible();
    await expect(returnSummary).toContainText("Fetch Bit");
    await expect(returnSummary).toContainText("×1");

    const closed = relaunchedApplication.waitForEvent("close");
    await rendererPage.close();
    await closed;
  } finally {
    await relaunchedApplication.close().catch(() => undefined);
  }
});
