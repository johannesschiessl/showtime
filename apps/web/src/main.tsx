import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RegistryProvider as AtomProvider } from "@effect/atom-react";
import { router } from "./router";
import "./styles.css";
import { capturePairingFragment, probeStoredConnection, readStoredConnection } from "./connection";
import { connectionState, type ConnectionStatus, useConnectionSnapshot } from "./connection-state";
import { ConnectionOverlay } from "./components/connections/ConnectionOverlay";
import { isDesktopHost } from "./platform";
import { AsyncResult } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";
import { showsAtom } from "./client";
import { useBrowserConnectionIdentity } from "./browser-connection-state";
import { NotificationProvider } from "./notifications/NotificationProvider";
import { ChatNotificationCoordinator } from "./chats/ChatNotifications";
import { installMobileViewport } from "./mobile-viewport";
import { registerServiceWorker, restorePwaConnectionHandoff } from "./pwa";
import { ConnectToShowtime } from "./components/connections/ConnectToShowtime";
import { initializeTheme } from "./theme";

const uninstallTheme = initializeTheme();
const uninstallMobileViewport = installMobileViewport();
if (import.meta.hot) {
  import.meta.hot.dispose(uninstallTheme);
  import.meta.hot.dispose(uninstallMobileViewport);
}
restorePwaConnectionHandoff();
void registerServiceWorker();
const pairing = await capturePairingFragment();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {pairing.status === "failed" ? (
      <ConnectToShowtime error={pairing.message} />
    ) : (
      <SynchronizedApp />
    )}
  </React.StrictMode>,
);

function SynchronizedApp() {
  const connection = useConnectionSnapshot();
  const browserConnectionIdentity = useBrowserConnectionIdentity();
  const pairedBrowser = browserConnectionIdentity !== undefined;
  const expectsConnection =
    isDesktopHost() || pairedBrowser || Boolean(import.meta.env.VITE_SHOWTIME_RPC_WEBSOCKET_URL);
  const revoked = expectsConnection && connection.status === "revoked";
  return (
    <NotificationProvider>
      <AtomProvider>
        <TooltipProvider>
          {expectsConnection && !revoked && <ConnectionCoordinator attempt={connection.attempt} />}
          {expectsConnection && (
            <ConnectionRecovery
              status={connection.status}
              attempt={connection.attempt}
              pairedBrowser={pairedBrowser}
              browserConnectionIdentity={browserConnectionIdentity}
            />
          )}
          {!revoked && (
            <div
              className="app-height bg-background"
              aria-hidden={expectsConnection && connection.status !== "connected"}
              inert={expectsConnection && connection.status !== "connected" ? true : undefined}
            >
              <RouterProvider router={router} />
            </div>
          )}
          {expectsConnection && connection.status !== "connected" && (
            <ConnectionOverlay status={connection.status} />
          )}
          {!revoked && <ChatNotificationCoordinator />}
        </TooltipProvider>
      </AtomProvider>
    </NotificationProvider>
  );
}

function ConnectionCoordinator({ attempt }: { readonly attempt: number }) {
  const shows = useAtomValue(showsAtom);
  React.useEffect(() => {
    if (AsyncResult.isSuccess(shows)) connectionState.synchronized(attempt);
  }, [attempt, shows]);
  return null;
}

function ConnectionRecovery({
  status,
  attempt,
  pairedBrowser,
  browserConnectionIdentity,
}: {
  readonly status: ConnectionStatus;
  readonly attempt: number;
  readonly pairedBrowser: boolean;
  readonly browserConnectionIdentity: string | undefined;
}) {
  const previousBrowserConnectionIdentity = React.useRef(browserConnectionIdentity);

  React.useEffect(() => {
    const changed = previousBrowserConnectionIdentity.current !== browserConnectionIdentity;
    previousBrowserConnectionIdentity.current = browserConnectionIdentity;
    if (
      changed &&
      browserConnectionIdentity !== undefined &&
      connectionState.getSnapshot().status === "revoked"
    ) {
      connectionState.retryNow();
    }
  }, [browserConnectionIdentity]);

  React.useEffect(() => {
    let hiddenAt: number | undefined = document.hidden ? Date.now() : undefined;
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else {
        const hiddenFor = hiddenAt === undefined ? 0 : Date.now() - hiddenAt;
        hiddenAt = undefined;
        const current = connectionState.getSnapshot().status;
        if (current !== "revoked" && (hiddenFor >= 10_000 || current !== "connected")) {
          connectionState.retryNow();
        }
      }
    };
    const onOnline = () => {
      const current = connectionState.getSnapshot().status;
      if (current !== "connected" && current !== "revoked") connectionState.retryNow();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  React.useEffect(() => {
    if (!pairedBrowser || (status !== "disconnected" && status !== "disabled")) return;
    const stored = readStoredConnection();
    if (!stored) return;
    let active = true;
    let probing = false;
    const probe = async () => {
      if (probing) return;
      probing = true;
      const result = await probeStoredConnection(stored);
      probing = false;
      const current = connectionState.getSnapshot();
      if (!active || current.attempt !== attempt) return;
      if (
        result === "available" &&
        (current.status === "disconnected" || current.status === "disabled")
      ) {
        connectionState.retryNow();
      } else if (result === "disabled" || result === "revoked") {
        connectionState.classified(attempt, result);
      }
    };
    void probe();
    const interval = window.setInterval(probe, 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [attempt, pairedBrowser, status, browserConnectionIdentity]);

  return null;
}
