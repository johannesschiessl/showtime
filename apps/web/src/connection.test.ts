import { describe, expect, it, vi } from "vite-plus/test";
import { showtimeConnectionStorageKey } from "@showtime/shared";
import { profileSelectionStorageKey } from "./profile-selection";
import {
  capturePairingFragment,
  forgetBrowserConnection,
  parseShowtimePairingUrl,
  probeStoredConnection,
  readStoredConnection,
  showtimePairingNavigationUrl,
  storedRpcWebSocketUrl,
  updateConnectionProfile,
} from "./connection";

const capability = "a".repeat(43);
const clientId = "Abcdefghijklmnopqrstu";
const pairingToken = "p".repeat(43);
const scopes = ["connections:read", "connections:create", "connections:delete"] as const;
const clientProfile = "profile_0000000000000000";

describe("browser connection persistence", () => {
  it("accepts only safe Showtime connection links", () => {
    const generated = `http://showtime-foh.local:8585/#pair=${pairingToken}&profile=${clientProfile}`;
    expect(parseShowtimePairingUrl(generated, "https://app.example/")).toBe(generated);
    expect(
      parseShowtimePairingUrl(
        `http://showtime-foh.local:8585/#pair=${pairingToken}`,
        "https://app.example/",
      ),
    ).toBe(`http://showtime-foh.local:8585/#pair=${pairingToken}`);
    expect(
      parseShowtimePairingUrl(`/#pair=${pairingToken}`, "https://showtime.example/connect"),
    ).toBe(`https://showtime.example/#pair=${pairingToken}`);
    expect(parseShowtimePairingUrl("javascript:alert(1)", "https://app.example/")).toBeUndefined();
    expect(
      parseShowtimePairingUrl(
        `https://user:password@showtime.example/#pair=${pairingToken}`,
        "https://app.example/",
      ),
    ).toBeUndefined();
    expect(
      parseShowtimePairingUrl("https://showtime.example/#pair=not-a-token", "https://app.example/"),
    ).toBeUndefined();
  });

  it("keeps pairing navigation inside an installed PWA origin", () => {
    const pairingUrl = `http://192.168.1.20:8585/#pair=${pairingToken}`;
    expect(
      showtimePairingNavigationUrl(pairingUrl, "http://showtime-foh.local:8585/#/", true),
    ).toBe(`http://showtime-foh.local:8585/#pair=${pairingToken}`);
    expect(
      showtimePairingNavigationUrl(pairingUrl, "http://showtime-foh.local:8585/#/", false),
    ).toBe(pairingUrl);
  });

  it("exchanges a valid single-use pairing fragment and removes it from history", async () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    const replaceState = vi.fn();
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: 1, clientId, capability, clientProfile, scopes }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      capturePairingFragment(
        {
          hash: `#pair=${pairingToken}&profile=${clientProfile}`,
          pathname: "/",
          search: "",
        },
        { setItem, removeItem },
        { replaceState },
        request,
      ),
    ).resolves.toEqual({ status: "paired" });
    expect(request).toHaveBeenCalledWith(`/pair/${pairingToken}`, { method: "POST" });
    expect(setItem).toHaveBeenCalledWith(
      showtimeConnectionStorageKey,
      JSON.stringify({ version: 1, clientId, capability, clientProfile, scopes }),
    );
    expect(replaceState).toHaveBeenCalledWith(null, "", "/#/");
  });

  it("rejects malformed pairing tokens", async () => {
    const setItem = vi.fn();
    await expect(
      capturePairingFragment(
        { hash: "#pair=short", pathname: "/", search: "" },
        { setItem, removeItem: vi.fn() },
        { replaceState: vi.fn() },
      ),
    ).resolves.toMatchObject({ status: "failed" });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("does not consume an invitation when credentials cannot be persisted", async () => {
    const request = vi.fn();
    const replaceState = vi.fn();
    await expect(
      capturePairingFragment(
        { hash: `#pair=${pairingToken}`, pathname: "/", search: "" },
        {
          setItem: () => {
            throw new DOMException("Storage full", "QuotaExceededError");
          },
          removeItem: vi.fn(),
        },
        { replaceState },
        request,
      ),
    ).resolves.toMatchObject({ status: "failed", message: expect.stringContaining("storage") });
    expect(request).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("retains a valid pairing fragment after a transient network failure", async () => {
    const removeItem = vi.fn();
    const replaceState = vi.fn();
    await expect(
      capturePairingFragment(
        { hash: `#pair=${pairingToken}`, pathname: "/", search: "" },
        { setItem: vi.fn(), removeItem },
        { replaceState },
        vi.fn().mockRejectedValue(new TypeError("Network error")),
      ),
    ).resolves.toMatchObject({ status: "failed" });
    expect(removeItem).toHaveBeenCalledWith(`${showtimeConnectionStorageKey}.probe`);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("removes a consumed pairing fragment when saving the exchanged credentials fails", async () => {
    const replaceState = vi.fn();
    const setItem = vi.fn((key: string) => {
      if (key === showtimeConnectionStorageKey) {
        throw new DOMException("Storage unavailable", "SecurityError");
      }
    });
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: 1, clientId, capability, clientProfile, scopes }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      capturePairingFragment(
        { hash: `#pair=${pairingToken}`, pathname: "/", search: "" },
        { setItem, removeItem: vi.fn() },
        { replaceState },
        request,
      ),
    ).resolves.toEqual({
      status: "failed",
      message:
        "This browser could not save the connection after the link was used. Ask the engineer for a new link.",
    });
    expect(request).toHaveBeenCalledOnce();
    expect(setItem).not.toHaveBeenCalledWith(profileSelectionStorageKey, expect.any(String));
    expect(replaceState).toHaveBeenCalledWith(null, "", "/#/");
  });

  it("restores a validated record and creates its authenticated socket URL", () => {
    const connection = readStoredConnection({
      getItem: () => JSON.stringify({ version: 1, clientId, capability, clientProfile, scopes }),
    });
    expect(connection).toEqual({ version: 1, clientId, capability, clientProfile, scopes });
    expect(
      storedRpcWebSocketUrl({ protocol: "http:", host: "showtime-foh.local:8585" }, connection!),
    ).toBe(`ws://showtime-foh.local:8585/rpc/${clientId}/${capability}`);
  });

  it.each([
    { clientId, capability, clientProfile, scopes },
    { version: 0, clientId, capability, clientProfile, scopes },
    { version: 2, clientId, capability, clientProfile, scopes },
    { version: 1, clientId, capability, clientProfile, scopes, legacy: true },
  ])("rejects non-version-1 or non-exact connection records", (record) => {
    expect(readStoredConnection({ getItem: () => JSON.stringify(record) })).toBeUndefined();
  });

  it("updates the authenticated client profile and then persists it locally", async () => {
    let stored = JSON.stringify({ version: 1, clientId, capability, clientProfile, scopes });
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    };
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ updated: true })));
    const nextProfile = "profile_1111111111111111" as Parameters<typeof updateConnectionProfile>[0];

    await updateConnectionProfile(nextProfile, storage, request);

    expect(request).toHaveBeenCalledWith(`/connection-profile/${clientId}/${capability}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientProfile: nextProfile }),
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(stored)).toMatchObject({ clientProfile: nextProfile, version: 1 });
  });

  it("serializes profile updates so the latest selection wins", async () => {
    let stored = JSON.stringify({ version: 1, clientId, capability, clientProfile, scopes });
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    };
    const responses: Array<(response: Response) => void> = [];
    const request = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          responses.push(resolve);
        }),
    );
    const firstProfile = "profile_1111111111111111" as Parameters<
      typeof updateConnectionProfile
    >[0];
    const latestProfile = "profile_2222222222222222" as Parameters<
      typeof updateConnectionProfile
    >[0];

    const firstUpdate = updateConnectionProfile(firstProfile, storage, request);
    const latestUpdate = updateConnectionProfile(latestProfile, storage, request);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());

    responses[0]!(new Response(null, { status: 200 }));
    await firstUpdate;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request).toHaveBeenLastCalledWith(`/connection-profile/${clientId}/${capability}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientProfile: latestProfile }),
      signal: expect.any(AbortSignal),
    });

    responses[1]!(new Response(null, { status: 200 }));
    await latestUpdate;
    expect(JSON.parse(stored)).toMatchObject({ clientProfile: latestProfile });
  });

  it("releases queued profile updates when an earlier request stalls", async () => {
    vi.useFakeTimers();
    try {
      let stored = JSON.stringify({ version: 1, clientId, capability, clientProfile, scopes });
      const storage = {
        getItem: () => stored,
        setItem: (_key: string, value: string) => {
          stored = value;
        },
      };
      const signals: AbortSignal[] = [];
      let requestCount = 0;
      const request = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestCount += 1;
        signals.push(init?.signal as AbortSignal);
        return requestCount === 1
          ? new Promise<Response>(() => undefined)
          : Promise.resolve(new Response(null, { status: 200 }));
      });
      const stalledProfile = "profile_1111111111111111" as Parameters<
        typeof updateConnectionProfile
      >[0];
      const latestProfile = "profile_2222222222222222" as Parameters<
        typeof updateConnectionProfile
      >[0];

      const stalledUpdate = updateConnectionProfile(stalledProfile, storage, request, 1_000);
      const latestUpdate = updateConnectionProfile(latestProfile, storage, request, 1_000);
      const stalledExpectation = expect(stalledUpdate).rejects.toThrow(
        "Connection profile update timed out",
      );
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());

      await vi.advanceTimersByTimeAsync(1_000);
      await stalledExpectation;
      await expect(latestUpdate).resolves.toBeUndefined();
      expect(signals[0]?.aborted).toBe(true);
      expect(request).toHaveBeenCalledTimes(2);
      expect(JSON.parse(stored)).toMatchObject({ clientProfile: latestProfile });
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues queued profile updates after an earlier request fails", async () => {
    let stored = JSON.stringify({ version: 1, clientId, capability, clientProfile, scopes });
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const firstProfile = "profile_1111111111111111" as Parameters<
      typeof updateConnectionProfile
    >[0];
    const latestProfile = "profile_2222222222222222" as Parameters<
      typeof updateConnectionProfile
    >[0];

    const firstUpdate = updateConnectionProfile(firstProfile, storage, request);
    const latestUpdate = updateConnectionProfile(latestProfile, storage, request);

    await expect(firstUpdate).rejects.toThrow("Profile update failed (503)");
    await expect(latestUpdate).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(stored)).toMatchObject({ clientProfile: latestProfile });
  });

  it("does not overwrite replacement credentials when an update finishes", async () => {
    let stored = JSON.stringify({ version: 1, clientId, capability, clientProfile, scopes });
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    };
    let resolveRequest: ((response: Response) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const nextProfile = "profile_1111111111111111" as Parameters<typeof updateConnectionProfile>[0];
    const replacement = {
      version: 1,
      clientId: "Zbcdefghijklmnopqrstu",
      capability: "z".repeat(43),
      clientProfile: "profile_2222222222222222",
      scopes,
    };

    const update = updateConnectionProfile(nextProfile, storage, request);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    stored = JSON.stringify(replacement);
    resolveRequest!(new Response(null, { status: 200 }));

    await update;
    expect(JSON.parse(stored)).toEqual(replacement);
  });

  it("verifies that forgetting removed the credentials", () => {
    let stored: string | null = "credentials";
    expect(
      forgetBrowserConnection({
        getItem: () => stored,
        removeItem: () => {
          stored = null;
        },
      }),
    ).toEqual({ status: "forgotten" });
  });

  it("reports storage failures instead of preventing the recovery action", () => {
    expect(
      forgetBrowserConnection({
        getItem: () => "credentials",
        removeItem: () => {
          throw new DOMException("Blocked", "SecurityError");
        },
      }),
    ).toMatchObject({ status: "failed", message: expect.stringContaining("could not remove") });
  });

  it.each([
    [200, "available"],
    [503, "disabled"],
    [401, "revoked"],
  ] as const)("maps connection probe status %s to %s", async (status, expected) => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status }));
    await expect(
      probeStoredConnection({ version: 1, clientId, capability, clientProfile, scopes }, request),
    ).resolves.toBe(expected);
    expect(request).toHaveBeenCalledWith(`/connection-status/${clientId}/${capability}`, {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });

  it("bounds stalled connection probes so recovery can continue", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Promise<Response>(() => undefined);
      });
      const result = probeStoredConnection(
        { version: 1, clientId, capability, clientProfile, scopes },
        request as typeof fetch,
        1_000,
      );

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(result).resolves.toBe("unreachable");
      expect(request).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
