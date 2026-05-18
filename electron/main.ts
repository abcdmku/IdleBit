import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { registerPersistenceIpc } from "./persistence.js";

let mainWindow: BrowserWindow | null = null;
const defaultRendererDevUrl = "http://127.0.0.1:6173";

const rendererDevUrl =
  process.env.VITE_DEV_SERVER_URL ??
  process.env.ELECTRON_RENDERER_URL ??
  (app.isPackaged ? undefined : defaultRendererDevUrl);
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

function rendererHtmlPath(): string {
  return path.join(currentDirectory, "..", "dist", "index.html");
}

function preloadPath(): string {
  return path.join(currentDirectory, "preload.cjs");
}

function isAllowedNavigation(url: string): boolean {
  if (rendererDevUrl) {
    return url.startsWith(rendererDevUrl);
  }

  return url.startsWith("file://");
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "IdleBit",
    backgroundColor: "#080b12",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath(),
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (rendererDevUrl) {
    await mainWindow.loadURL(rendererDevUrl);
    return;
  }

  await mainWindow.loadFile(rendererHtmlPath());
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    registerPersistenceIpc();
    await createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
