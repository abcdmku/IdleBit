import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  try {
    const target = new URL(url);

    if (rendererDevUrl) {
      const rendererUrl = new URL(rendererDevUrl);
      return target.origin === rendererUrl.origin;
    }

    const rendererFileUrl = new URL(pathToFileURL(rendererHtmlPath()).href);
    return (
      target.protocol === "file:" &&
      target.pathname === rendererFileUrl.pathname
    );
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(url: string): boolean {
  try {
    const target = new URL(url);
    return target.protocol === "https:" || target.protocol === "mailto:";
  } catch {
    return false;
  }
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
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url)) {
      return;
    }

    event.preventDefault();
    if (isAllowedExternalUrl(url)) {
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
