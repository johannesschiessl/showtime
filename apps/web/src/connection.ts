import {
  showtimeConnectionManagementScopes,
  showtimeConnectionStorageKey,
  ShowtimeStoredConnection,
} from "@showtime/shared";
import type { ProfileId as ProfileIdType } from "@showtime/contracts";
import {
  profileSelectionChangedEvent,
  profileSelectionStorageKey,
  writeProfileSelection,
} from "./profile-selection";
import { Schema } from "effect";

const pairingTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const fragmentPrefix = "#pair=";
export const hasPairingFragment = (hash: string) => hash.startsWith(fragmentPrefix);
const pairingTokenFromFragment = (hash: string) => {
  if (!hasPairingFragment(hash)) return undefined;
  const token = new URLSearchParams(hash.slice(1)).get("pair") ?? "";
  return pairingTokenPattern.test(token) ? token : undefined;
};
const connectionRequestTimeoutMs = 5_000;

const withRequestTimeout = async <A>(
  exchange: (signal: AbortSignal) => Promise<A>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<A> => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exchange(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new DOMException(timeoutMessage, "TimeoutError"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

const requestWithTimeout = (
  request: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
) => withRequestTimeout((signal) => request(input, { ...init, signal }), timeoutMs, timeoutMessage);

const decodeStoredConnection = Schema.decodeUnknownSync(ShowtimeStoredConnection, {
  onExcessProperty: "error",
});

export type PairingResult =
  | { readonly status: "none" }
  | { readonly status: "paired" }
  | { readonly status: "failed"; readonly message: string };

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem" | "removeItem">;

export type ForgetConnectionResult =
  | { readonly status: "forgotten" }
  | { readonly status: "failed"; readonly message: string };

export type ConnectionProbeResult = "available" | "disabled" | "revoked" | "unreachable";

export const connectionStorageChangedEvent = "showtime:connection-storage-changed";

export const parseShowtimePairingUrl = (value: string, baseUrl = window.location.href) => {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    if (!pairingTokenFromFragment(url.hash)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
};

export const showtimePairingNavigationUrl = (
  value: string,
  currentUrl = window.location.href,
  stayOnCurrentOrigin = false,
) => {
  const pairingUrl = parseShowtimePairingUrl(value, currentUrl);
  if (!pairingUrl || !stayOnCurrentOrigin) return pairingUrl;

  // A standalone PWA cannot reliably navigate to an equivalent IP/hostname
  // outside its installed scope. Redeem the server-specific token through the
  // origin from which this PWA was installed instead.
  const target = new URL(pairingUrl);
  const current = new URL(currentUrl);
  current.hash = target.hash;
  return current.href;
};

const browserLocalStorage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export const readStoredConnection = (
  storage: ReadableStorage | undefined = browserLocalStorage(),
): ShowtimeStoredConnection | undefined => {
  try {
    if (!storage) return undefined;
    const raw = storage.getItem(showtimeConnectionStorageKey);
    if (raw === null) return undefined;
    return decodeStoredConnection(JSON.parse(raw));
  } catch {
    // Storage can be unavailable in privacy modes. Treat it as unpaired.
  }
  return undefined;
};

export const capturePairingFragment = async (
  location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
  storage: WritableStorage | undefined = browserLocalStorage(),
  history: Pick<History, "replaceState"> = window.history,
  request: typeof fetch = fetch,
  timeoutMs = connectionRequestTimeoutMs,
): Promise<PairingResult> => {
  if (!hasPairingFragment(location.hash)) return { status: "none" };
  const token = pairingTokenFromFragment(location.hash);
  const removePairingFragment = () =>
    history.replaceState(null, "", `${location.pathname}${location.search}#/`);
  if (!token) {
    removePairingFragment();
    return { status: "failed", message: "This connection link is invalid." };
  }

  if (!storage) {
    return {
      status: "failed",
      message:
        "This browser cannot save the connection. Enable site storage and try the link again.",
    };
  }

  // Invitations are single-use. Reserve enough storage for the fixed-size
  // credentials before asking the server to consume one.
  const probeKey = `${showtimeConnectionStorageKey}.probe`;
  const profileProbeKey = `${profileSelectionStorageKey}.probe`;
  try {
    storage.setItem(
      probeKey,
      JSON.stringify({
        version: 1,
        clientId: "c".repeat(21),
        capability: "c".repeat(43),
        clientProfile: "profile_0000000000000000",
        scopes: showtimeConnectionManagementScopes,
      }),
    );
    storage.setItem(
      profileProbeKey,
      JSON.stringify({ version: 1, profileId: "profile_0000000000000000" }),
    );
  } catch {
    try {
      storage.removeItem(probeKey);
      storage.removeItem(profileProbeKey);
    } catch {
      // The actionable storage error is reported below.
    }
    return {
      status: "failed",
      message:
        "This browser cannot save the connection. Free up site storage and try the link again.",
    };
  }

  const releaseReservation = () => {
    try {
      storage.removeItem(probeKey);
      storage.removeItem(profileProbeKey);
    } catch {
      // A later operation reports the actionable failure.
    }
  };

  let response: Response;
  let parsed: unknown;
  try {
    response = await withRequestTimeout(
      async (signal) => {
        const response = await request(`/pair/${token}`, { method: "POST", signal });
        if (response.ok) {
          try {
            parsed = await response.json();
          } catch {
            // A successful exchange consumed the invitation, even if its body is invalid.
            // Let credential validation report the invalid details and remove the fragment.
          }
        }
        return response;
      },
      timeoutMs,
      "Pairing timed out",
    );
  } catch {
    releaseReservation();
    return {
      status: "failed",
      message: "This device could not reach Showtime. Check the network and try again.",
    };
  }
  if (!response.ok) {
    releaseReservation();
    if (response.status === 410) removePairingFragment();
    return {
      status: "failed",
      message:
        response.status === 410
          ? "This connection link has expired or has already been used. Ask the engineer for a new link."
          : "Showtime could not complete the connection. Ask the engineer to check connections.",
    };
  }

  let credentials: ShowtimeStoredConnection;
  try {
    credentials = decodeStoredConnection(parsed);
  } catch {
    releaseReservation();
    removePairingFragment();
    return { status: "failed", message: "Showtime returned invalid connection details." };
  }

  releaseReservation();
  try {
    storage.setItem(showtimeConnectionStorageKey, JSON.stringify(credentials));
    writeProfileSelection(credentials.clientProfile as ProfileIdType, storage);
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(profileSelectionChangedEvent));
  } catch {
    removePairingFragment();
    return {
      status: "failed",
      message:
        "This browser could not save the connection after the link was used. Ask the engineer for a new link.",
    };
  }
  removePairingFragment();
  return { status: "paired" };
};

let connectionProfileUpdateQueue: Promise<void> = Promise.resolve();

export const updateConnectionProfile = (
  clientProfile: ProfileIdType,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = browserLocalStorage(),
  request: typeof fetch = fetch,
  timeoutMs = connectionRequestTimeoutMs,
): Promise<void> => {
  const update = connectionProfileUpdateQueue.then(async () => {
    const connection = readStoredConnection(storage);
    if (!connection || connection.clientProfile === clientProfile) return;
    const response = await requestWithTimeout(
      request,
      `/connection-profile/${encodeURIComponent(connection.clientId)}/${encodeURIComponent(connection.capability)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientProfile }),
      },
      timeoutMs,
      "Connection profile update timed out",
    );
    if (!response.ok) throw new Error(`Profile update failed (${response.status})`);

    // The connection may have been replaced while the request was in flight.
    // Never overwrite newer credentials with the snapshot used for this request.
    const currentConnection = readStoredConnection(storage);
    if (
      !currentConnection ||
      currentConnection.clientId !== connection.clientId ||
      currentConnection.capability !== connection.capability
    )
      return;
    storage?.setItem(
      showtimeConnectionStorageKey,
      JSON.stringify({ ...currentConnection, clientProfile }),
    );
  });
  connectionProfileUpdateQueue = update.catch(() => undefined);
  return update;
};

export const storedRpcWebSocketUrl = (
  location: Pick<Location, "protocol" | "host">,
  connection: ShowtimeStoredConnection,
) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/rpc/${connection.clientId}/${connection.capability}`;
};

export const hasBrowserConnection = () => readStoredConnection() !== undefined;

export const forgetBrowserConnection = (
  storage: Pick<Storage, "getItem" | "removeItem"> | undefined = browserLocalStorage(),
): ForgetConnectionResult => {
  if (!storage) {
    return {
      status: "failed",
      message: "This browser cannot access the saved connection.",
    };
  }
  try {
    storage.removeItem(showtimeConnectionStorageKey);
    if (storage.getItem(showtimeConnectionStorageKey) !== null) {
      return {
        status: "failed",
        message: "This browser did not remove the saved connection. Check site storage settings.",
      };
    }
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(connectionStorageChangedEvent));
    return { status: "forgotten" };
  } catch {
    return {
      status: "failed",
      message: "This browser could not remove the saved connection. Check site storage settings.",
    };
  }
};

export const probeStoredConnection = async (
  connection: ShowtimeStoredConnection,
  request: typeof fetch = fetch,
  timeoutMs = connectionRequestTimeoutMs,
): Promise<ConnectionProbeResult> => {
  try {
    const response = await requestWithTimeout(
      request,
      `/connection-status/${connection.clientId}/${connection.capability}`,
      {
        cache: "no-store",
      },
      timeoutMs,
      "Connection probe timed out",
    );
    if (response.status === 200) return "available";
    if (response.status === 503) return "disabled";
    if (response.status === 401) return "revoked";
    return "unreachable";
  } catch {
    return "unreachable";
  }
};
