import { Effect } from "effect";
import { Atom } from "effect/reactivity";
import { makeShowtimeFrontend } from "@showtime/frontend";
import { resolveRpcWebSocketUrl } from "./platform";
import {
  connectionAttemptSignal,
  connectionState,
  connectionSubscriptionSignal,
} from "./connection-state";

const frontend = makeShowtimeFrontend({
  webSocketUrl: Effect.promise(resolveRpcWebSocketUrl),
  connectionLifecycle: {
    attemptSignal: connectionAttemptSignal,
    onConnect: (attempt) => connectionState.transportConnected(attempt),
    onDisconnect: (attempt) => connectionState.transportDisconnected(attempt),
  },
  refreshSignals: [Atom.windowFocusSignal, connectionSubscriptionSignal],
});

export const {
  RpcClient,
  createShowAtom,
  deleteShowAtom,
  editShowAtom,
  microphoneAtoms,
  mixAtoms,
  showDialogAtom,
  showMutationAtoms,
  showMutationOptions,
  showsAtom,
  songAtoms,
  profileAtoms,
  chatAtoms,
  livePresenceAtoms,
} = frontend;

export * from "@showtime/frontend";
