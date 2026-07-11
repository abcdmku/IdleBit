import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ACKNOWLEDGE_CLOSE_CHANNEL,
  BEFORE_CLOSE_CHANNEL,
  createCloseHandshake,
  parseCloseAcknowledgementRequestId,
  type CloseHandshakeController,
} from "./closeHandshake.js";
import { registerPersistenceIpc } from "./persistence.js";

let mainWindow: BrowserWindow | null = null;
let closeHandshake: CloseHandshakeController | null = null;
let isQuitting = false;
const defaultRendererDevUrl = "http://127.0.0.1:6173";
const forceFileRenderer = process.env.IDLEBIT_FILE_RENDERER === "1";

const rendererDevUrl =
  process.env.VITE_DEV_SERVER_URL ??
  process.env.ELECTRON_RENDERER_URL ??
  (app.isPackaged || forceFileRenderer ? undefined : defaultRendererDevUrl);
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
  const window = new BrowserWindow({
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
  mainWindow = window;
  const windowCloseHandshake = createCloseHandshake({
    isWindowDestroyed: () => window.isDestroyed(),
    requestClose: () => {
      if (isQuitting) {
        app.quit();
      } else {
        window.close();
      }
    },
    sendBeforeClose: (request) => {
      window.webContents.send(BEFORE_CLOSE_CHANNEL, request);
    },
  });
  closeHandshake = windowCloseHandshake;

  window.once("ready-to-show", () => {
    window.show();
  });

  window.on("close", (event) => {
    windowCloseHandshake.handleClose(event);
  });

  window.on("closed", () => {
    windowCloseHandshake.dispose();
    if (mainWindow === window) {
      mainWindow = null;
      closeHandshake = null;
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url)) {
      return;
    }

    event.preventDefault();
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  if (rendererDevUrl) {
    await window.loadURL(rendererDevUrl);
    return;
  }

  await window.loadFile(rendererHtmlPath());
}

function registerLifecycleIpc(): void {
  ipcMain.on(ACKNOWLEDGE_CLOSE_CHANNEL, (event, payload: unknown) => {
    const window = mainWindow;
    if (!window || event.sender !== window.webContents) {
      return;
    }

    const requestId = parseCloseAcknowledgementRequestId(payload);
    if (requestId !== null) {
      closeHandshake?.acknowledge(requestId);
    }
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("before-quit", () => {
    isQuitting = true;
  });

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
    registerLifecycleIpc();
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
