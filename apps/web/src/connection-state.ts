import * as React from "react";
import { Atom } from "effect/reactivity";

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "disabled"
  | "revoked";

export interface ConnectionSnapshot {
  readonly status: ConnectionStatus;
  /** Identifies the currently active RPC runtime. Stale runtime callbacks are ignored. */
  readonly attempt: number;
  /** Changes after a transport reconnect so failed streaming RPCs are recreated. */
  readonly subscriptionGeneration: number;
}

export const makeConnectionState = (disconnectedDelayMs = 5_000) => {
  const listeners = new Set<() => void>();
  let snapshot: ConnectionSnapshot = {
    status: "connecting",
    attempt: 0,
    subscriptionGeneration: 0,
  };
  let hasSynchronized = false;
  let hasOpenedTransport = false;
  let transportOpen = false;
  let disconnectedTimer: ReturnType<typeof setTimeout> | undefined;

  const emit = (next: ConnectionSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const clearDisconnectedTimer = () => {
    if (disconnectedTimer !== undefined) clearTimeout(disconnectedTimer);
    disconnectedTimer = undefined;
  };

  const startDisconnectedTimer = (attempt: number) => {
    if (
      disconnectedTimer !== undefined ||
      snapshot.status === "disabled" ||
      snapshot.status === "revoked"
    )
      return;
    disconnectedTimer = setTimeout(() => {
      disconnectedTimer = undefined;
      if (attempt !== snapshot.attempt || transportOpen) return;
      emit({ ...snapshot, status: "disconnected" });
    }, disconnectedDelayMs);
  };

  return {
    transportConnected(attempt: number) {
      if (attempt !== snapshot.attempt) return;
      clearDisconnectedTimer();
      const reconnected = hasOpenedTransport && !transportOpen;
      transportOpen = true;
      hasOpenedTransport = true;
      emit({
        ...snapshot,
        status: hasSynchronized ? "reconnecting" : "connecting",
        subscriptionGeneration: reconnected
          ? snapshot.subscriptionGeneration + 1
          : snapshot.subscriptionGeneration,
      });
    },
    transportDisconnected(attempt: number) {
      if (attempt !== snapshot.attempt || snapshot.status === "revoked") return;
      if (!transportOpen && snapshot.status === "disconnected") return;
      transportOpen = false;
      if (snapshot.status !== "disabled") {
        const status = hasSynchronized ? "reconnecting" : "connecting";
        if (snapshot.status !== status) emit({ ...snapshot, status });
      }
      startDisconnectedTimer(attempt);
    },
    synchronized(attempt: number) {
      if (attempt !== snapshot.attempt || !transportOpen) return;
      clearDisconnectedTimer();
      hasSynchronized = true;
      if (snapshot.status !== "connected") emit({ ...snapshot, status: "connected" });
    },
    retryNow() {
      clearDisconnectedTimer();
      transportOpen = false;
      const next = {
        ...snapshot,
        status: hasSynchronized ? ("reconnecting" as const) : ("connecting" as const),
        attempt: snapshot.attempt + 1,
      };
      emit(next);
      startDisconnectedTimer(next.attempt);
    },
    classified(attempt: number, status: "disabled" | "revoked") {
      if (attempt !== snapshot.attempt || transportOpen) return;
      clearDisconnectedTimer();
      if (snapshot.status !== status) emit({ ...snapshot, status });
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
  };
};

export const connectionState = makeConnectionState();
const subscribeConnectionState = (listener: () => void) => connectionState.subscribe(listener);
const getConnectionSnapshot = () => connectionState.getSnapshot();

export const useConnectionSnapshot = () =>
  React.useSyncExternalStore(
    subscribeConnectionState,
    getConnectionSnapshot,
    getConnectionSnapshot,
  );

const externalSignal = <A>(select: (snapshot: ConnectionSnapshot) => A) =>
  Atom.readable((get) => {
    const update = () => get.setSelf(select(connectionState.getSnapshot()));
    const unsubscribe = connectionState.subscribe(update);
    get.addFinalizer(unsubscribe);
    return select(connectionState.getSnapshot());
  });

/** Rebuilds the RPC runtime when an explicit retry starts a new attempt. */
export const connectionAttemptSignal = externalSignal((snapshot) => snapshot.attempt);

/** Recreates streaming subscriptions after Effect reopens the transport. */
export const connectionSubscriptionSignal = externalSignal(
  (snapshot) => snapshot.subscriptionGeneration,
);
