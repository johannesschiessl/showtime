import { NodeSocket } from "@effect/platform-node";
import { Deferred, Effect, Layer, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ShowtimeRpcs, ShowName } from "@showtime/contracts";
import { ConnectionManager, makeBackendRuntime } from "./index.js";
import { ProfileService } from "./profiles/ProfileService.js";
import { DatabaseSync } from "node:sqlite";

const tempHomes = new Set<string>();

afterEach(async () => {
  await Promise.all(Array.from(tempHomes, (home) => rm(home, { recursive: true, force: true })));
  tempHomes.clear();
});

const findAvailablePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a TCP port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const defaultProfileId = (runtime: ReturnType<typeof makeBackendRuntime>) =>
  runtime
    .runPromise(Effect.flatMap(ProfileService, (_) => _.list))
    .then((state) => state.defaultProfileId);

const tokenForInvitation = async (
  runtime: ReturnType<typeof makeBackendRuntime>,
  invitationId: string,
) => {
  const info = await runtime.runPromise(
    Effect.flatMap(ConnectionManager, (_) => _.pairingInfo(invitationId)),
  );
  const candidate = info.candidates[0];
  if (!candidate) throw new Error("Pairing candidate missing");
  const token = new URL(candidate.url).hash
    .slice(1)
    .split("&")[0]
    ?.replace(/^pair=/, "");
  if (!token) throw new Error("Pairing token missing");
  return token;
};

describe("Showtime WebSocket RPC", () => {
  it("returns a desktop RPC URL reachable through the configured bind address", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "showtime-rpc-host-home-"));
    tempHomes.add(homeDirectory);
    const port = await findAvailablePort();
    const runtime = makeBackendRuntime({ host: "127.0.0.2", port, homeDirectory });

    await runtime.runPromise(Effect.void);
    try {
      const rpcWebSocketUrl = await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (connections) => connections.rpcWebSocketUrl),
      );
      expect(rpcWebSocketUrl).toMatch(
        new RegExp(`^ws://127\\.0\\.0\\.2:${port}/rpc/desktop/[A-Za-z0-9_-]{43}$`),
      );
      const clientProtocol = RpcClient.layerProtocolSocket().pipe(
        Layer.provide(NodeSocket.layerWebSocket(rpcWebSocketUrl)),
        Layer.provide(RpcSerialization.layerJson),
      );
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const client = yield* RpcClient.make(ShowtimeRpcs);
            return yield* client["shows.list"]().pipe(Stream.take(1), Stream.runCollect);
          }).pipe(Effect.scoped, Effect.provide(clientProtocol)),
        ),
      ).resolves.toBeDefined();
    } finally {
      await runtime.dispose();
    }
  });

  it("serves the bundled web app without exposing an unauthenticated RPC route", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "showtime-http-home-"));
    tempHomes.add(homeDirectory);
    const webRoot = path.join(homeDirectory, "web");
    await mkdir(webRoot);
    await writeFile(path.join(webRoot, "index.html"), "<html>Showtime local</html>");
    const port = await findAvailablePort();
    const runtime = makeBackendRuntime({
      host: "127.0.0.1",
      port,
      homeDirectory,
      webRoot,
    });

    await runtime.runPromise(Effect.void);
    try {
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Showtime local");
      const unauthenticated = await fetch(`http://127.0.0.1:${port}/rpc`);
      expect(unauthenticated.status).toBe(404);
    } finally {
      await runtime.dispose();
    }
  });

  it("serves typed RPC calls over Effect Socket and disposes cleanly", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "showtime-rpc-home-"));
    tempHomes.add(homeDirectory);
    const port = await findAvailablePort();
    const runtime = makeBackendRuntime({
      host: "127.0.0.1",
      port,
      homeDirectory,
    });

    await runtime.runPromise(Effect.void);
    try {
      const rpcWebSocketUrl = await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (connections) => connections.rpcWebSocketUrl),
      );
      const clientProtocol = RpcClient.layerProtocolSocket().pipe(
        Layer.provide(NodeSocket.layerWebSocket(rpcWebSocketUrl)),
        Layer.provide(RpcSerialization.layerJson),
      );
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcClient.make(ShowtimeRpcs);
          const firstSnapshot = yield* Deferred.make<void>();
          const snapshotsEffect = client["shows.list"]().pipe(
            Stream.tap(() => Deferred.succeed(firstSnapshot, void 0)),
            Stream.take(2),
            Stream.runCollect,
          );
          const createEffect = Deferred.await(firstSnapshot).pipe(
            Effect.andThen(
              client["shows.create"]({
                name: ShowName.make("WebSocket Soundcheck"),
                color: "blue",
              }),
            ),
          );
          const [snapshots, created] = yield* Effect.all([snapshotsEffect, createEffect], {
            concurrency: "unbounded",
          });
          return { snapshots: Array.from(snapshots), created };
        }).pipe(Effect.scoped, Effect.provide(clientProtocol)),
      );

      expect(result.snapshots[0]).toEqual([]);
      expect(result.created.name).toBe("WebSocket Soundcheck");
      expect(result.snapshots[1]?.map((show) => show.id)).toEqual([result.created.id]);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects chat state for a deleted show", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "showtime-chat-rpc-home-"));
    tempHomes.add(homeDirectory);
    const port = await findAvailablePort();
    const runtime = makeBackendRuntime({ host: "127.0.0.1", port, homeDirectory });

    await runtime.runPromise(Effect.void);
    try {
      const rpcWebSocketUrl = await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (connections) => connections.rpcWebSocketUrl),
      );
      const clientProtocol = RpcClient.layerProtocolSocket().pipe(
        Layer.provide(NodeSocket.layerWebSocket(rpcWebSocketUrl)),
        Layer.provide(RpcSerialization.layerJson),
      );
      const request = Effect.gen(function* () {
        const client = yield* RpcClient.make(ShowtimeRpcs);
        const profiles = yield* client["profiles.list"]().pipe(Stream.take(1), Stream.runCollect);
        const created = yield* client["shows.create"]({
          name: ShowName.make("Deleted chat show"),
          color: "blue",
        });
        yield* client["shows.delete"]({ id: created.id });
        return yield* client["chats.state"]({
          showId: created.id,
          profileId: profiles[0]!.defaultProfileId,
        }).pipe(Stream.take(1), Stream.runCollect);
      }).pipe(Effect.scoped, Effect.provide(clientProtocol));

      await expect(Effect.runPromise(request)).rejects.toThrow("Show not found");
    } finally {
      await runtime.dispose();
    }
  });

  it("broadcasts authoritative snapshots between independent WebSocket clients", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "showtime-sync-home-"));
    tempHomes.add(homeDirectory);
    const port = await findAvailablePort();
    const runtime = makeBackendRuntime({ host: "127.0.0.1", port, homeDirectory });

    await runtime.runPromise(Effect.void);
    try {
      const rpcWebSocketUrl = await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (connections) => connections.rpcWebSocketUrl),
      );
      const protocol = () =>
        RpcClient.layerProtocolSocket().pipe(
          Layer.provide(NodeSocket.layerWebSocket(rpcWebSocketUrl)),
          Layer.provide(RpcSerialization.layerJson),
        );
      const firstSnapshot = await Effect.runPromise(Deferred.make<void>());
      const snapshotsPromise = Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcClient.make(ShowtimeRpcs);
          return yield* client["shows.list"]().pipe(
            Stream.tap(() => Deferred.succeed(firstSnapshot, void 0)),
            Stream.take(2),
            Stream.runCollect,
          );
        }).pipe(Effect.scoped, Effect.timeout("5 seconds"), Effect.provide(protocol())),
      );

      await Effect.runPromise(Deferred.await(firstSnapshot).pipe(Effect.timeout("5 seconds")));
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* RpcClient.make(ShowtimeRpcs);
          return yield* client["shows.create"]({
            name: ShowName.make("Synced from another device"),
            color: "green",
          });
        }).pipe(Effect.scoped, Effect.timeout("5 seconds"), Effect.provide(protocol())),
      );
      const snapshots = Array.from(await snapshotsPromise);

      expect(snapshots[0]).toEqual([]);
      expect(snapshots[1]?.map((show) => show.id)).toEqual([created.id]);
    } finally {
      await runtime.dispose();
    }
  });

  it("pairs once, tracks presence, revokes access, and disables remote hosting", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "showtime-connections-home-"));
    tempHomes.add(homeDirectory);
    const webRoot = path.join(homeDirectory, "web");
    await mkdir(webRoot);
    await writeFile(path.join(webRoot, "index.html"), "<html>Showtime local</html>");
    const port = await findAvailablePort();
    const runtime = makeBackendRuntime({ host: "127.0.0.1", port, homeDirectory, webRoot });

    await runtime.runPromise(Effect.void);
    try {
      const profileId = await defaultProfileId(runtime);
      const pending = await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (connections) =>
          connections.createInvitation("Monitor iPad", profileId, []),
        ),
      );
      expect(pending.clients[0]).toMatchObject({ kind: "pending", name: "Monitor iPad" });
      const invitation = pending.clients[0];
      if (!invitation || invitation.kind !== "pending") throw new Error("Invitation missing");
      const token = await tokenForInvitation(runtime, invitation.invitationId);
      const pairing = await fetch(`http://127.0.0.1:${port}/pair/${token}`, { method: "POST" });
      expect(pairing.status).toBe(200);
      const connection = (await pairing.json()) as { clientId: string; capability: string };
      expect(connection.clientId).toMatch(/^[A-Za-z0-9_-]{21}$/);
      expect(
        (await fetch(`http://127.0.0.1:${port}/pair/${token}`, { method: "POST" })).status,
      ).toBe(410);

      const rpcUrl = `http://127.0.0.1:${port}/rpc/${connection.clientId}/${connection.capability}`;
      const statusUrl = `http://127.0.0.1:${port}/connection-status/${connection.clientId}/${connection.capability}`;
      expect((await fetch(rpcUrl)).status).not.toBe(404);
      expect(await (await fetch(statusUrl)).json()).toEqual({ status: "available" });

      const socket = new WebSocket(rpcUrl.replace("http:", "ws:"));
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("WebSocket failed")), {
          once: true,
        });
      });
      const connectedState = await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (connections) => connections.connectionsState),
      );
      expect(connectedState.clients[0]).toMatchObject({
        kind: "paired",
        name: "Monitor iPad",
        connected: true,
      });

      const disabledClose = new Promise<void>((resolve) =>
        socket.addEventListener("close", () => resolve(), { once: true }),
      );
      await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (connections) =>
          connections.setConnectionsEnabled(false),
        ),
      );
      await disabledClose;
      expect(await (await fetch(statusUrl)).json()).toEqual({ status: "disabled" });
      expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
      const disabledState = await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (_) => _.connectionsState),
      );
      expect(disabledState.enabled).toBe(false);
      expect(disabledState.hostName).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

      await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (connections) => connections.setConnectionsEnabled(true)),
      );
      const resumedSocket = new WebSocket(rpcUrl.replace("http:", "ws:"));
      await new Promise<void>((resolve, reject) => {
        resumedSocket.addEventListener("open", () => resolve(), { once: true });
        resumedSocket.addEventListener("error", () => reject(new Error("WebSocket failed")), {
          once: true,
        });
      });
      const revokedClose = new Promise<void>((resolve) =>
        resumedSocket.addEventListener("close", () => resolve(), { once: true }),
      );
      await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (connections) =>
          connections.removeConnection(connection.clientId),
        ),
      );
      await revokedClose;
      expect((await fetch(rpcUrl)).status).toBe(404);
      const revokedStatus = await fetch(statusUrl);
      expect(revokedStatus.status).toBe(401);
      expect(await revokedStatus.json()).toEqual({ status: "revoked" });
    } finally {
      await runtime.dispose();
    }
  });

  it("accepts persisted browser credentials after a complete backend restart", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "showtime-restart-home-"));
    tempHomes.add(homeDirectory);
    const port = await findAvailablePort();
    let runtime = makeBackendRuntime({ host: "127.0.0.1", port, homeDirectory });

    await runtime.runPromise(Effect.void);
    try {
      const profileId = await defaultProfileId(runtime);
      const pending = await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (connections) =>
          connections.createInvitation("Restarted iPad", profileId, []),
        ),
      );
      const invitation = pending.clients[0];
      if (!invitation || invitation.kind !== "pending") throw new Error("Invitation missing");
      const token = await tokenForInvitation(runtime, invitation.invitationId);
      const pairing = await fetch(`http://127.0.0.1:${port}/pair/${token}`, { method: "POST" });
      const credentials = (await pairing.json()) as { clientId: string; capability: string };
      const statusUrl = `http://127.0.0.1:${port}/connection-status/${credentials.clientId}/${credentials.capability}`;
      const rpcUrl = `ws://127.0.0.1:${port}/rpc/${credentials.clientId}/${credentials.capability}`;

      await runtime.dispose();
      runtime = makeBackendRuntime({ host: "127.0.0.1", port, homeDirectory });
      await runtime.runPromise(Effect.void);
      expect(await (await fetch(statusUrl)).json()).toEqual({ status: "available" });
      const socket = new WebSocket(rpcUrl);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket failed after restart")),
          {
            once: true,
          },
        );
      });
      socket.close();
    } finally {
      await runtime.dispose();
    }
  });

  it("enforces narrow connection-management scopes and prevents delegated escalation", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "showtime-scopes-home-"));
    tempHomes.add(homeDirectory);
    const port = await findAvailablePort();
    const runtime = makeBackendRuntime({ host: "127.0.0.1", port, homeDirectory });
    const origin = `http://127.0.0.1:${port}`;

    await runtime.runPromise(Effect.void);
    try {
      const profileId = await defaultProfileId(runtime);
      const pair = async (
        name: string,
        scopes: ReadonlyArray<"connections:read" | "connections:create" | "connections:delete">,
      ) => {
        await runtime.runPromise(
          Effect.flatMap(ConnectionManager, (connections) =>
            connections.createInvitation(name, profileId, scopes),
          ),
        );
        const state = await runtime.runPromise(
          Effect.flatMap(ConnectionManager, (_) => _.connectionsState),
        );
        const invitation = state.clients.find(
          (client) => client.kind === "pending" && client.name === name,
        );
        if (!invitation || invitation.kind !== "pending") throw new Error("Invitation missing");
        const token = await tokenForInvitation(runtime, invitation.invitationId);
        return (await (await fetch(`${origin}/pair/${token}`, { method: "POST" })).json()) as {
          clientId: string;
          capability: string;
          scopes: ReadonlyArray<string>;
        };
      };
      const managementUrl = (credentials: { clientId: string; capability: string }) =>
        `${origin}/connection-management/${credentials.clientId}/${credentials.capability}`;
      const create = (url: string, name: string, scopes: ReadonlyArray<string>) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, clientProfile: profileId, scopes }),
        });

      const unscoped = await pair("Unscoped iPad", []);
      expect(unscoped.scopes).toEqual([]);
      expect((await fetch(managementUrl(unscoped))).status).toBe(403);
      expect((await create(managementUrl(unscoped), "Denied client", [])).status).toBe(403);

      const manager = await pair("Manager iPad", [
        "connections:read",
        "connections:create",
        "connections:delete",
      ]);
      const managerUrl = managementUrl(manager);
      const stateResponse = await fetch(managerUrl);
      expect(stateResponse.status).toBe(200);
      const state = (await stateResponse.json()) as { clients: Array<{ name: string }> };
      expect(state.clients.map((client) => client.name)).toContain("Manager iPad");

      const missingProfile = "profile_1111111111111111";
      const invalidInvitation = await fetch(managerUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Invalid profile",
          clientProfile: missingProfile,
          scopes: [],
        }),
      });
      expect(invalidInvitation.status).toBe(400);
      expect(await invalidInvitation.json()).toEqual({ error: "Profile not found." });

      const invalidProfileUpdate = await fetch(
        `${origin}/connection-profile/${manager.clientId}/${manager.capability}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientProfile: missingProfile }),
        },
      );
      expect(invalidProfileUpdate.status).toBe(400);
      expect(await invalidProfileUpdate.json()).toEqual({ error: "Profile not found." });

      const changedProfile = await runtime.runPromise(
        Effect.flatMap(ProfileService, (_) =>
          _.create({ name: "Changed profile", color: "green" }).pipe(
            Effect.map((profile) => profile.id),
          ),
        ),
      );
      const profileUpdate = await fetch(
        `${origin}/connection-profile/${manager.clientId}/${manager.capability}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientProfile: changedProfile }),
        },
      );
      expect(profileUpdate.status).toBe(200);
      const updatedState = (await (await fetch(managerUrl)).json()) as {
        clients: Array<{
          name: string;
          clientProfile: string;
          updatedAt: string;
        }>;
      };
      expect(updatedState.clients.find((client) => client.name === "Manager iPad")).toMatchObject({
        clientProfile: changedProfile,
        updatedAt: expect.any(String),
      });

      const createdResponse = await create(managerUrl, "Managed client", ["connections:read"]);
      expect(createdResponse.status).toBe(200);
      const createdState = (await createdResponse.json()) as {
        clients: Array<{
          kind: string;
          name: string;
          invitationId?: string;
          scopes: ReadonlyArray<string>;
        }>;
      };
      const managed = createdState.clients.find((client) => client.name === "Managed client")!;
      expect(managed.scopes).toEqual(["connections:read"]);
      const pairingInfo = await fetch(`${managerUrl}/pairing/${managed.invitationId}`);
      expect(pairingInfo.status).toBe(200);
      expect(await pairingInfo.json()).toMatchObject({ expiresAt: expect.any(String) });
      expect(
        (await fetch(`${managerUrl}/${managed.invitationId}`, { method: "DELETE" })).status,
      ).toBe(200);

      const creator = await pair("Creator only", ["connections:create"]);
      expect(
        (await create(managementUrl(creator), "Escalated client", ["connections:read"])).status,
      ).toBe(403);
      expect(
        (await fetch(`${origin}/connection-management/${creator.clientId}/invalid`)).status,
      ).toBe(401);
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps expired invitations and renews them when Connect is opened", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "showtime-expired-home-"));
    tempHomes.add(homeDirectory);
    const showtimeDirectory = path.join(homeDirectory, ".showtime");
    const port = await findAvailablePort();
    let runtime = makeBackendRuntime({ host: "127.0.0.1", port, homeDirectory });
    await runtime.runPromise(Effect.void);
    try {
      const profileId = await defaultProfileId(runtime);
      const before = await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (_) => _.createInvitation("Expired iPad", profileId, [])),
      );
      const invitation = before.clients.find((client) => client.kind === "pending");
      if (!invitation || invitation.kind !== "pending") throw new Error("Invitation missing");
      const expiredToken = await tokenForInvitation(runtime, invitation.invitationId);
      await runtime.dispose();
      const db = new DatabaseSync(path.join(showtimeDirectory, "showtime.db"));
      db.prepare(
        "UPDATE connection_invitations SET expires_at = ?, updated_at = ? WHERE invitation_id = ?",
      ).run("2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z", invitation.invitationId);
      db.close();
      runtime = makeBackendRuntime({ host: "127.0.0.1", port, homeDirectory });
      await runtime.runPromise(Effect.void);
      const pairingInfo = await runtime.runPromise(
        Effect.flatMap(ConnectionManager, (connections) =>
          connections.pairingInfo(invitation.invitationId),
        ),
      );
      const renewedToken = new URL(pairingInfo.candidates[0]!.url).hash
        .slice(1)
        .split("&")[0]!
        .replace(/^pair=/, "");
      expect(renewedToken).not.toBe(expiredToken);
      expect(Date.parse(pairingInfo.expiresAt!)).toBeGreaterThan(Date.now());
      expect(
        (await fetch(`http://127.0.0.1:${port}/pair/${expiredToken}`, { method: "POST" })).status,
      ).toBe(410);
    } finally {
      await runtime.dispose();
    }
  });
});
