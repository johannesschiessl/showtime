import { NodeFileSystem, NodeHttpServer, NodePath } from "@effect/platform-node";
import { Context, Effect, Layer, ManagedRuntime, Schema, Semaphore } from "effect";
import { SqlClient } from "effect/sql";
import { HttpRouter, HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { createServer } from "node:http";
import {
  showtimeLocalPort,
  showtimeHostnameLabel,
  showtimeLocalHostname,
  ShowtimeConnectionScopes,
  type ShowtimeConnectionInfo,
  type ShowtimeConnectionScope,
  type ShowtimeHostName,
} from "@showtime/shared";
import { randomBytes } from "node:crypto";
import * as ConnectionStore from "./connections/ConnectionStore.js";
import * as NetworkAddresses from "./connections/NetworkAddresses.js";
import * as LocalDiscovery from "./connections/LocalDiscovery.js";
import * as MdnsAdvertiserLive from "./connections/MdnsAdvertiserLive.js";
import type * as MdnsAdvertiser from "./connections/MdnsAdvertiser.js";
import * as Ids from "./ids/Ids.js";
import * as MicrophoneService from "./microphones/MicrophoneService.js";
import * as MixService from "./mixes/MixService.js";
import * as HomeDirectory from "./platform/HomeDirectory.js";
import * as Rpc from "./rpc/Rpc.js";
import * as ShowRepository from "./shows/ShowRepository.js";
import * as ShowService from "./shows/ShowService.js";
import * as SongService from "./songs/SongService.js";
import * as SyncEngine from "./sync/SyncEngine.js";
import * as Settings from "./settings/Settings.js";
import * as ProfileService from "./profiles/ProfileService.js";
import { ProfileId } from "@showtime/contracts";
import * as ChatService from "./chats/ChatService.js";
import * as LiveGuardModule from "./live/LiveGuard.js";
import * as Database from "./database/Database.js";

export { LiveGuard } from "./live/LiveGuard.js";

const ShowRepositoryLive = ShowRepository.layer;
const ProfileLive = ProfileService.layer.pipe(Layer.provideMerge(Ids.layer));
const ChatLive = ChatService.layer;

export interface BackendOptions {
  readonly host: string;
  readonly port: number;
  readonly webRoot?: string;
  readonly homeDirectory?: string;
  /** Defaults to enabled for the canonical production port and disabled for test overrides. */
  readonly localDiscovery?: boolean;
}

const rpcWebSocketHost = (host: string) => {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "[::1]";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
};

export class ConnectionManager extends Context.Service<
  ConnectionManager,
  {
    readonly rpcWebSocketUrl: Effect.Effect<string>;
    readonly connectionsState: Effect.Effect<import("@showtime/shared").ShowtimeConnectionsState>;
    readonly createInvitation: (
      name: string | undefined,
      clientProfile: string,
      scopes: ReadonlyArray<ShowtimeConnectionScope>,
    ) => Effect.Effect<
      import("@showtime/shared").ShowtimeConnectionsState,
      ConnectionStore.ConnectionInputError
    >;
    readonly pairingInfo: (invitationId: string) => Effect.Effect<ShowtimeConnectionInfo>;
    readonly removeConnection: (
      id: string,
    ) => Effect.Effect<import("@showtime/shared").ShowtimeConnectionsState>;
    readonly setConnectionsEnabled: (
      enabled: boolean,
    ) => Effect.Effect<import("@showtime/shared").ShowtimeConnectionsState>;
    readonly setHostName: (
      hostName: ShowtimeHostName,
    ) => Effect.Effect<import("@showtime/shared").ShowtimeConnectionsState>;
  }
>()("@showtime/backend/ConnectionManager") {}

const makeBackendServices = () => Layer.mergeAll(Ids.layer, ShowRepositoryLive, ProfileLive);

const makePlatformLayer = (options: BackendOptions) =>
  Layer.mergeAll(
    NodeFileSystem.layer,
    NodePath.layer,
    options.homeDirectory === undefined
      ? HomeDirectory.layerNode
      : HomeDirectory.makeLayer(options.homeDirectory),
  );

const CreateInvitationRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  clientProfile: ProfileId,
  scopes: ShowtimeConnectionScopes,
});

const UpdateClientProfileRequest = Schema.Struct({ clientProfile: ProfileId });

const pairingUrlWithProfile = (url: string, clientProfile: string) =>
  `${url}&profile=${encodeURIComponent(clientProfile)}`;

const makeRpcProtocol = (desktopCapability: string) =>
  Layer.effect(
    RpcServer.Protocol,
    Effect.gen(function* () {
      const { httpEffect, protocol } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
      const router = yield* HttpRouter.HttpRouter;
      const connections = yield* ConnectionStore.ConnectionStore;
      const connectionManager = yield* ConnectionManager;
      const settings = yield* Settings.Settings;
      const notFound = Effect.succeed(HttpServerResponse.empty({ status: 404 }));
      const authorizeManagement = (
        clientId: string | undefined,
        capability: string | undefined,
        scope: ShowtimeConnectionScope,
      ) =>
        Effect.gen(function* () {
          if (!clientId || !capability) return "revoked" as const;
          if (!(yield* settings.get).connectionsEnabled) return "disabled" as const;
          return yield* connections.scopeAuthorization(clientId, capability, scope);
        });
      const authorizationResponse = (
        authorization: "authorized" | "disabled" | "forbidden" | "revoked",
      ) =>
        authorization === "revoked"
          ? HttpServerResponse.jsonUnsafe(
              { error: "Invalid connection credentials." },
              { status: 401 },
            )
          : authorization === "forbidden"
            ? HttpServerResponse.jsonUnsafe(
                { error: "This connection does not have permission." },
                { status: 403 },
              )
            : authorization === "disabled"
              ? HttpServerResponse.jsonUnsafe(
                  { error: "Connections are disabled." },
                  { status: 503 },
                )
              : undefined;
      yield* router.add(
        "GET",
        "/rpc/:clientId/:capability",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          if (params.clientId === "desktop" && params.capability === desktopCapability)
            return yield* httpEffect;
          if (!params.clientId || !params.capability) return yield* notFound;
          return (
            (yield* connections.withAuthorizedSession(
              params.clientId,
              params.capability,
              settings.get.pipe(Effect.map((value) => value.connectionsEnabled)),
              httpEffect,
            )) ?? (yield* notFound)
          );
        }),
      );
      yield* router.add(
        "POST",
        "/pair/:token",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          if (!(yield* settings.get).connectionsEnabled || !params.token) return yield* notFound;
          const credentials = yield* connections.consumeInvitation(params.token);
          return credentials
            ? HttpServerResponse.jsonUnsafe({ version: 1 as const, ...credentials })
            : HttpServerResponse.jsonUnsafe(
                { error: "This connection link is invalid, expired, or has already been used." },
                { status: 410 },
              );
        }),
      );
      yield* router.add(
        "GET",
        "/connection-status/:clientId/:capability",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          if (!params.clientId || !params.capability) return yield* notFound;
          const credentialStatus = yield* connections.credentialsStatus(
            params.clientId,
            params.capability,
          );
          if (credentialStatus === "revoked") {
            return HttpServerResponse.jsonUnsafe({ status: "revoked" }, { status: 401 });
          }
          if (!(yield* settings.get).connectionsEnabled) {
            return HttpServerResponse.jsonUnsafe({ status: "disabled" }, { status: 503 });
          }
          return HttpServerResponse.jsonUnsafe({ status: "available" });
        }),
      );
      yield* router.add(
        "GET",
        "/connection-management/:clientId/:capability",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          const denied = authorizationResponse(
            yield* authorizeManagement(params.clientId, params.capability, "connections:read"),
          );
          if (denied) return denied;
          return HttpServerResponse.jsonUnsafe(yield* connectionManager.connectionsState);
        }),
      );
      yield* router.add(
        "POST",
        "/connection-management/:clientId/:capability",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          const denied = authorizationResponse(
            yield* authorizeManagement(params.clientId, params.capability, "connections:create"),
          );
          if (denied) return denied;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const decoded = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(CreateInvitationRequest)),
            Effect.option,
          );
          if (decoded._tag === "None") {
            return HttpServerResponse.jsonUnsafe(
              { error: "Invalid invitation details." },
              { status: 400 },
            );
          }
          const name = decoded.value.name?.trim() || undefined;
          if (name !== undefined && name.length > 80) {
            return HttpServerResponse.jsonUnsafe(
              { error: "The client name must be at most 80 characters." },
              { status: 400 },
            );
          }
          for (const scope of decoded.value.scopes) {
            const grant = authorizationResponse(
              yield* authorizeManagement(params.clientId, params.capability, scope),
            );
            if (grant) return grant;
          }
          const created = yield* connectionManager
            .createInvitation(name, decoded.value.clientProfile, decoded.value.scopes)
            .pipe(Effect.option);
          return created._tag === "Some"
            ? HttpServerResponse.jsonUnsafe(created.value)
            : HttpServerResponse.jsonUnsafe({ error: "Profile not found." }, { status: 400 });
        }),
      );
      yield* router.add(
        "PATCH",
        "/connection-profile/:clientId/:capability",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          if (!params.clientId || !params.capability) return yield* notFound;
          if (!(yield* settings.get).connectionsEnabled) {
            return HttpServerResponse.jsonUnsafe(
              { error: "Connections are disabled." },
              { status: 503 },
            );
          }
          const request = yield* HttpServerRequest.HttpServerRequest;
          const decoded = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(UpdateClientProfileRequest)),
            Effect.option,
          );
          if (decoded._tag === "None") {
            return HttpServerResponse.jsonUnsafe({ error: "Invalid profile." }, { status: 400 });
          }
          const updated = yield* connections.updateClientProfile(
            params.clientId,
            params.capability,
            decoded.value.clientProfile,
          );
          if (updated === "invalid-profile")
            return HttpServerResponse.jsonUnsafe({ error: "Profile not found." }, { status: 400 });
          return updated === "revoked"
            ? HttpServerResponse.jsonUnsafe(
                { error: "Invalid connection credentials." },
                { status: 401 },
              )
            : HttpServerResponse.jsonUnsafe({ updated: updated === "updated" });
        }),
      );
      yield* router.add(
        "GET",
        "/connection-management/:clientId/:capability/pairing/:invitationId",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          const denied = authorizationResponse(
            yield* authorizeManagement(params.clientId, params.capability, "connections:read"),
          );
          if (denied) return denied;
          if (!params.invitationId) return yield* notFound;
          return HttpServerResponse.jsonUnsafe(
            yield* connectionManager.pairingInfo(params.invitationId),
          );
        }),
      );
      yield* router.add(
        "DELETE",
        "/connection-management/:clientId/:capability/:connectionId",
        Effect.gen(function* () {
          const params = yield* HttpRouter.params;
          const denied = authorizationResponse(
            yield* authorizeManagement(params.clientId, params.capability, "connections:delete"),
          );
          if (denied) return denied;
          if (!params.connectionId) return yield* notFound;
          return HttpServerResponse.jsonUnsafe(
            yield* connectionManager.removeConnection(params.connectionId),
          );
        }),
      );
      return protocol;
    }),
  ).pipe(Layer.provide(HttpRouter.layer));

const makeServerLive = (options: BackendOptions, desktopCapability: string) =>
  (() => {
    const RpcProtocol = makeRpcProtocol(desktopCapability);
    const staticFiles =
      options.webRoot === undefined
        ? Layer.empty
        : HttpStaticServer.layer({
            root: options.webRoot,
            index: "index.html",
            spa: true,
            cacheControl: "no-cache",
          });

    const remoteHostingGate = HttpRouter.middleware()(
      Effect.gen(function* () {
        const settings = yield* Settings.Settings;
        return (httpEffect) =>
          settings.get.pipe(
            Effect.flatMap((value) =>
              value.connectionsEnabled
                ? httpEffect
                : Effect.succeed(HttpServerResponse.empty({ status: 404 })),
            ),
          );
      }),
    ).layer;

    const rpcServer = Rpc.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          ShowService.layer,
          MicrophoneService.layer,
          MixService.layer,
          SongService.layer,
          ChatLive,
          SyncEngine.layer,
        ),
      ),
      Layer.provideMerge(RpcProtocol),
    );

    // Build the RPC server and its routes together in serve's private memo map.
    return HttpRouter.serve(
      Layer.mergeAll(rpcServer, staticFiles.pipe(Layer.provide(remoteHostingGate))),
      { disableListenLog: true },
    ).pipe(Layer.provide(RpcSerialization.layerJson));
  })();

const makeConnectionManagerLayer = (options: BackendOptions, desktopCapability: string) =>
  Layer.effect(
    ConnectionManager,
    Effect.gen(function* () {
      const connections = yield* ConnectionStore.ConnectionStore;
      const settings = yield* Settings.Settings;
      const addresses = yield* NetworkAddresses.NetworkAddresses;
      const discovery = yield* LocalDiscovery.LocalDiscovery;
      const sql = yield* SqlClient.SqlClient;
      const connectionTransition = yield* Semaphore.make(1);
      const state = Effect.all({
        settings: settings.get,
        clients: connections.clients,
        invitations: connections.invitations,
        connectedClientIds: connections.connectedClientIds,
      }).pipe(
        Effect.map(({ settings, clients, invitations, connectedClientIds }) => ({
          enabled: settings.connectionsEnabled,
          hostName: settings.hostName,
          hostname: showtimeLocalHostname(showtimeHostnameLabel(settings.hostName)),
          clients: [
            ...invitations.map(
              ({ invitationId, name, expiresAt, clientProfile, updatedAt, scopes }) => ({
                kind: "pending" as const,
                invitationId,
                name,
                expiresAt,
                clientProfile,
                updatedAt,
                scopes,
              }),
            ),
            ...clients.map(({ clientId, name, createdAt, clientProfile, updatedAt, scopes }) => ({
              kind: "paired" as const,
              clientId,
              name,
              createdAt,
              clientProfile,
              updatedAt,
              connected: connectedClientIds.has(clientId),
              scopes,
            })),
          ],
        })),
      );
      return ConnectionManager.of({
        rpcWebSocketUrl: Effect.succeed(
          `ws://${rpcWebSocketHost(options.host)}:${options.port}/rpc/desktop/${desktopCapability}`,
        ),
        connectionsState: state,
        createInvitation: (name, clientProfile, scopes) =>
          connections.createInvitation(name, clientProfile, scopes).pipe(Effect.andThen(state)),
        pairingInfo: (invitationId) =>
          connections.pairingInvitation(invitationId).pipe(
            Effect.flatMap((invitation): Effect.Effect<ShowtimeConnectionInfo> => {
              if (!invitation) {
                return Effect.succeed({
                  discovery: { kind: "disabled" },
                  candidates: [],
                  expiresAt: null,
                });
              }
              return Effect.all(
                {
                  discovery: discovery.state,
                  hostname: discovery.pairingCandidate(invitation.token),
                  ipAddresses: addresses.candidates(options.port, invitation.token),
                },
                { concurrency: "unbounded" },
              ).pipe(
                Effect.map(({ discovery: discoveryState, hostname, ipAddresses }) => ({
                  discovery:
                    hostname === undefined
                      ? discoveryState
                      : ({ kind: "announced", hostname: hostname.host } as const),
                  candidates: (hostname === undefined
                    ? ipAddresses
                    : [hostname, ...ipAddresses]
                  ).map((candidate) => ({
                    ...candidate,
                    url: pairingUrlWithProfile(candidate.url, invitation.clientProfile),
                  })),
                  expiresAt: invitation.expiresAt,
                })),
              );
            }),
          ),
        removeConnection: (id) => connections.remove(id).pipe(Effect.andThen(state)),
        setConnectionsEnabled: (enabled) =>
          connectionTransition.withPermits(1)(
            settings.setConnectionsEnabled(enabled).pipe(
              Effect.andThen(enabled ? Effect.void : connections.disconnectAll),
              Effect.andThen(discovery.setEnabled(enabled)),
              Effect.tap(() =>
                Effect.logInfo(
                  enabled ? "Enabled remote connections" : "Disabled remote connections",
                ),
              ),
              Effect.andThen(state),
            ),
          ),
        setHostName: (hostName) =>
          connectionTransition.withPermits(1)(
            Effect.gen(function* () {
              if ((yield* settings.get).hostName === hostName) return yield* state;
              // Persist URL and credential revocation atomically. Active sessions are disconnected
              // only after the database transaction commits.
              const revoked = yield* sql
                .withTransaction(
                  connections.removeAllPersisted.pipe(
                    Effect.flatMap((counts) =>
                      settings.setHostName(hostName).pipe(Effect.as(counts)),
                    ),
                  ),
                )
                .pipe(Effect.orDie);
              yield* connections.disconnectAll;
              yield* discovery.setHostName(hostName);
              yield* Effect.logInfo("Changed the local host name and revoked all clients").pipe(
                Effect.annotateLogs({
                  hostname: showtimeLocalHostname(showtimeHostnameLabel(hostName)),
                  ...revoked,
                }),
              );
              return yield* state;
            }),
          ),
      });
    }),
  );

const makeConnectionLayers = () =>
  Layer.mergeAll(ConnectionStore.layer, Settings.layer, NetworkAddresses.layer);

export const makeBackendLayer = (
  options: BackendOptions,
  mdnsAdvertiserLayer: Layer.Layer<MdnsAdvertiser.MdnsAdvertiser> = MdnsAdvertiserLive.layer,
) => {
  const desktopCapability = randomBytes(32).toString("base64url");
  const HttpServerLive = Layer.unwrap(
    Effect.gen(function* () {
      yield* Database.DatabaseReady;
      return NodeHttpServer.layer(createServer, {
        host: options.host,
        port: options.port,
      });
    }),
  );
  const LocalDiscoveryLive = LocalDiscovery.layer({
    port: options.port,
    runtimeEnabled: options.localDiscovery ?? options.port === showtimeLocalPort,
  }).pipe(Layer.provide(mdnsAdvertiserLayer));
  const ConnectionManagerLive = makeConnectionManagerLayer(options, desktopCapability).pipe(
    Layer.provideMerge(LocalDiscoveryLive),
  );
  const LiveGuardLive = LiveGuardModule.layer;
  return Layer.mergeAll(
    makeServerLive(options, desktopCapability).pipe(
      Layer.provide(ConnectionManagerLive),
      Layer.provide(LiveGuardLive),
    ),
    ConnectionManagerLive,
    LiveGuardLive,
  ).pipe(
    Layer.provideMerge(HttpServerLive),
    Layer.provideMerge(makeConnectionLayers()),
    Layer.provideMerge(makeBackendServices()),
    Layer.provideMerge(Database.layer),
    Layer.provide(makePlatformLayer(options)),
  );
};

export const makeBackendRuntime = (
  options: BackendOptions,
  mdnsAdvertiserLayer?: Layer.Layer<MdnsAdvertiser.MdnsAdvertiser>,
) => ManagedRuntime.make(makeBackendLayer(options, mdnsAdvertiserLayer));
