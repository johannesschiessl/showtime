import { NodeFileSystem } from "@effect/platform-node";
import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isTrustedRendererUrl } from "./renderer-security.js";
import path from "node:path";
import { Effect, Schema } from "effect";
import { ConnectionManager, LiveGuard, makeBackendRuntime } from "@showtime/backend";
import {
  desktopCheckForUpdatesChannel,
  desktopConnectionsStateChannel,
  desktopCreateInvitationChannel,
  desktopDownloadUpdateChannel,
  desktopInstallUpdateChannel,
  desktopPairingInfoChannel,
  desktopRemoveConnectionChannel,
  desktopRpcWebSocketUrlChannel,
  desktopSetConnectionsEnabledChannel,
  desktopSetHostNameChannel,
  desktopSetAppearanceChannel,
  desktopUpdateStateChangedChannel,
  desktopUpdateStateChannel,
  isShowtimeThemePreference,
  resolveShowtimeTheme,
  ShowtimeHostName,
  showtimeLocalPort,
  type ShowtimeThemePreference,
  type ShowtimeConnectionScope,
} from "@showtime/shared";
import {
  appearancePreferenceFileName,
  readAppearancePreference,
  writeAppearancePreference,
} from "./appearance-preference.js";
import { formatStartupError } from "./startup-error.js";
import { DesktopUpdateService } from "./DesktopUpdateService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const RENDERER_DIST = app.isPackaged
  ? path.join(process.resourcesPath, "web")
  : path.resolve(process.env.APP_ROOT, "../web/dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

const rendererUrl =
  VITE_DEV_SERVER_URL ?? pathToFileURL(path.join(RENDERER_DIST, "index.html")).href;
const isOwnerEvent = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
  Boolean(
    win &&
    !win.isDestroyed() &&
    event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame &&
    isTrustedRendererUrl(event.senderFrame.url, rendererUrl),
  );

const handleOwner = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) =>
  ipcMain.handle(channel, (event, ...args) => {
    if (!isOwnerEvent(event)) throw new Error("Untrusted desktop IPC sender.");
    return listener(event, ...args);
  });

let win: BrowserWindow | null;
let backendStarted = false;
let backendShutdownStarted = false;
let appearancePreference: ShowtimeThemePreference = "system";
let appearanceWrite = Promise.resolve();
const rpcHost = "0.0.0.0";
const rpcPort = showtimeLocalPort;
const backendRuntime = makeBackendRuntime({
  host: rpcHost,
  port: rpcPort,
  webRoot: RENDERER_DIST,
  localDiscovery: true,
});
const updateService = new DesktopUpdateService({
  currentVersion: app.getVersion(),
  packaged: app.isPackaged,
  hasActiveLiveSessions: () =>
    backendRuntime.runPromise(Effect.flatMap(LiveGuard, (_) => _.hasActiveSessions)),
  beginMaintenance: () =>
    backendRuntime.runPromise(Effect.flatMap(LiveGuard, (_) => _.beginMaintenance)),
  endMaintenance: () =>
    backendRuntime.runPromise(Effect.flatMap(LiveGuard, (_) => _.endMaintenance)),
  // The before-quit handler owns backend shutdown. Keeping preparation side-effect free
  // ensures a synchronous quitAndInstall failure cannot strand the running app without RPC.
  prepareForUpdate: async () => undefined,
  publish: (state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(desktopUpdateStateChangedChannel, state);
    }
  },
});

function getAppIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets", "icon.png");
  }

  return path.resolve(process.env.APP_ROOT, "..", "..", "assets", "icon.png");
}

function createWindow() {
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }

  const initialAppearance = windowAppearance(
    resolveShowtimeTheme(appearancePreference, nativeTheme.shouldUseDarkColors),
  );
  win = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: initialAppearance.backgroundColor,
    icon: getAppIconPath(),
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: initialAppearance.backgroundColor,
      symbolColor: initialAppearance.symbolColor,
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame || !isTrustedRendererUrl(event.url, rendererUrl)) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    void win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

const windowAppearance = (appearance: "light" | "dark") =>
  appearance === "dark"
    ? { backgroundColor: "#0a0a0a", symbolColor: "#fafafa" }
    : { backgroundColor: "#ffffff", symbolColor: "#0a0a0a" };

const applyWindowAppearance = (window: BrowserWindow, appearance: "light" | "dark") => {
  const colors = windowAppearance(appearance);
  window.setBackgroundColor(colors.backgroundColor);
  if (process.platform !== "darwin") {
    window.setTitleBarOverlay({
      color: colors.backgroundColor,
      symbolColor: colors.symbolColor,
      height: 40,
    });
  }
};

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) {
      win.restore();
    }
    win.focus();
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (backendStarted && BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", (event) => {
  if (!backendStarted || backendShutdownStarted) return;

  event.preventDefault();
  backendShutdownStarted = true;
  void Promise.all([backendRuntime.dispose(), appearanceWrite]).finally(() => {
    backendStarted = false;
    app.quit();
  });
});

if (gotSingleInstanceLock) {
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const appearancePreferencePath = path.join(
      app.getPath("userData"),
      appearancePreferenceFileName,
    );

    Promise.all([
      backendRuntime.runPromise(Effect.void),
      Effect.runPromise(
        readAppearancePreference(appearancePreferencePath).pipe(
          Effect.provide(NodeFileSystem.layer),
        ),
      ),
    ])
      .then(([, storedAppearancePreference]) => {
        appearancePreference = storedAppearancePreference;
        handleOwner(desktopRpcWebSocketUrlChannel, () =>
          backendRuntime.runPromise(
            Effect.flatMap(ConnectionManager, (connections) => connections.rpcWebSocketUrl),
          ),
        );
        handleOwner(desktopConnectionsStateChannel, () =>
          backendRuntime.runPromise(Effect.flatMap(ConnectionManager, (_) => _.connectionsState)),
        );
        handleOwner(
          desktopCreateInvitationChannel,
          (
            _event,
            name: string | undefined,
            clientProfile: string,
            scopes: ReadonlyArray<ShowtimeConnectionScope>,
          ) =>
            backendRuntime.runPromise(
              Effect.flatMap(ConnectionManager, (_) =>
                _.createInvitation(name, clientProfile, scopes),
              ),
            ),
        );
        handleOwner(desktopPairingInfoChannel, (_event, invitationId: string) =>
          backendRuntime.runPromise(
            Effect.flatMap(ConnectionManager, (_) => _.pairingInfo(invitationId)),
          ),
        );
        handleOwner(desktopRemoveConnectionChannel, (_event, id: string) =>
          backendRuntime.runPromise(
            Effect.flatMap(ConnectionManager, (_) => _.removeConnection(id)),
          ),
        );
        handleOwner(desktopSetConnectionsEnabledChannel, (_event, enabled: boolean) =>
          backendRuntime.runPromise(
            Effect.flatMap(ConnectionManager, (_) => _.setConnectionsEnabled(enabled)),
          ),
        );
        handleOwner(desktopSetHostNameChannel, (_event, hostName: unknown) =>
          backendRuntime.runPromise(
            Effect.flatMap(ConnectionManager, (_) =>
              _.setHostName(Schema.decodeUnknownSync(ShowtimeHostName)(hostName)),
            ),
          ),
        );
        handleOwner(desktopUpdateStateChannel, () => updateService.state());
        ipcMain.on(desktopSetAppearanceChannel, (event, nextPreference: unknown) => {
          if (!isOwnerEvent(event)) return;
          if (!isShowtimeThemePreference(nextPreference)) return;
          const preferenceChanged = nextPreference !== appearancePreference;
          appearancePreference = nextPreference;
          const appearance = resolveShowtimeTheme(
            appearancePreference,
            nativeTheme.shouldUseDarkColors,
          );
          const window = BrowserWindow.fromWebContents(event.sender);
          if (window && !window.isDestroyed()) applyWindowAppearance(window, appearance);
          if (preferenceChanged) {
            appearanceWrite = appearanceWrite
              .then(() =>
                Effect.runPromise(
                  writeAppearancePreference(appearancePreferencePath, nextPreference).pipe(
                    Effect.provide(NodeFileSystem.layer),
                  ),
                ),
              )
              .catch((error: unknown) => {
                console.error("Could not persist the appearance preference", error);
              });
          }
        });
        handleOwner(desktopCheckForUpdatesChannel, () => updateService.check());
        handleOwner(desktopDownloadUpdateChannel, () => updateService.download());
        handleOwner(desktopInstallUpdateChannel, () => updateService.install());
        backendStarted = true;
        createWindow();
        void updateService.check();
      })
      .catch((error: unknown) => {
        console.error("Showtime backend startup failed", error);
        dialog.showErrorBox(
          "Showtime could not start",
          `The local Showtime backend could not start.\n\n${formatStartupError(error)}`,
        );
        app.quit();
      });
  });
}
