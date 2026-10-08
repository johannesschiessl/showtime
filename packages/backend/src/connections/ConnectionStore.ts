import { Clock, Context, Deferred, Effect, Layer, Ref, Schema, Semaphore } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { nanoid } from "nanoid";
import { randomBytes } from "node:crypto";
import { ShowtimeConnectionScopes, type ShowtimeConnectionScope } from "@showtime/shared";
import { ProfileId, type ProfileId as ProfileIdType } from "@showtime/contracts";
import { DatabaseReady } from "../database/Database.js";

const NanoId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{21}$/));
const Capability = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/));
const ClientName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80));
const ClientRow = Schema.Struct({
  clientId: NanoId,
  name: ClientName,
  capability: Capability,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  clientProfile: ProfileId,
});
const InvitationRow = Schema.Struct({
  invitationId: NanoId,
  name: ClientName,
  token: Capability,
  expiresAt: Schema.String,
  updatedAt: Schema.String,
  clientProfile: ProfileId,
});
const ClientScopeRow = Schema.Struct({ clientId: NanoId, scope: Schema.String });
const InvitationScopeRow = Schema.Struct({ invitationId: NanoId, scope: Schema.String });

export type StoredClient = typeof ClientRow.Type & {
  readonly scopes: ReadonlyArray<ShowtimeConnectionScope>;
};
export type StoredInvitation = typeof InvitationRow.Type & {
  readonly scopes: ReadonlyArray<ShowtimeConnectionScope>;
};
export interface PairingCredentials {
  readonly clientId: string;
  readonly capability: string;
  readonly scopes: ReadonlyArray<ShowtimeConnectionScope>;
  readonly clientProfile: ProfileIdType;
}

export class ConnectionInputError extends Schema.TaggedError<ConnectionInputError>()(
  "ConnectionInputError",
  { message: Schema.String },
) {}

export type ClientProfileUpdateResult = "updated" | "unchanged" | "invalid-profile" | "revoked";

const pairingLifetimeMs = 5 * 60 * 1_000;
const makeToken = () => randomBytes(32).toString("base64url");
const defaultClientNamePattern = /^Client (\d+)$/;
const nextDefaultClientName = (names: Iterable<string>) => {
  let highest = 0;
  for (const name of names) {
    const match = defaultClientNamePattern.exec(name);
    if (!match) continue;
    const suffix = Number(match[1]);
    if (Number.isSafeInteger(suffix) && suffix < Number.MAX_SAFE_INTEGER)
      highest = Math.max(highest, suffix);
  }
  return `Client ${highest + 1}`;
};

export class ConnectionStore extends Context.Service<
  ConnectionStore,
  {
    readonly clients: Effect.Effect<ReadonlyArray<StoredClient>>;
    readonly invitations: Effect.Effect<ReadonlyArray<StoredInvitation>>;
    readonly connectedClientIds: Effect.Effect<ReadonlySet<string>>;
    readonly createInvitation: (
      name: string | undefined,
      clientProfile: string,
      scopes?: ReadonlyArray<ShowtimeConnectionScope>,
    ) => Effect.Effect<StoredInvitation, ConnectionInputError>;
    readonly pairingInvitation: (
      invitationId: string,
    ) => Effect.Effect<StoredInvitation | undefined>;
    readonly consumeInvitation: (token: string) => Effect.Effect<PairingCredentials | undefined>;
    readonly remove: (id: string) => Effect.Effect<void>;
    readonly removeAllPersisted: Effect.Effect<{
      readonly pairedClients: number;
      readonly pendingInvitations: number;
    }>;
    readonly removeAll: Effect.Effect<void>;
    readonly updateClientProfile: (
      clientId: string,
      capability: string,
      clientProfile: string,
    ) => Effect.Effect<ClientProfileUpdateResult>;
    readonly disconnectAll: Effect.Effect<void>;
    readonly credentialsStatus: (
      clientId: string,
      capability: string,
    ) => Effect.Effect<"authorized" | "revoked">;
    readonly scopeAuthorization: (
      clientId: string,
      capability: string,
      scope: ShowtimeConnectionScope,
    ) => Effect.Effect<"authorized" | "forbidden" | "revoked">;
    readonly withAuthorizedSession: <A, E, R, E2, R2>(
      clientId: string,
      capability: string,
      isEnabled: Effect.Effect<boolean, E2, R2>,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A | undefined, E | E2, R | R2>;
  }
>()("@showtime/backend/connections/ConnectionStore") {}

const make = Effect.fn("ConnectionStore.make")(function* () {
  yield* DatabaseReady;
  const sql = yield* SqlClient.SqlClient;
  const sessions = yield* Ref.make(new Map<string, ReadonlySet<Deferred.Deferred<void>>>());
  // This gate protects only ephemeral admission and disconnect signals. SQLite owns persistence
  // serialization and transactions.
  const sessionGate = yield* Semaphore.make(1);

  const clientRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ClientRow,
    execute: () => sql`SELECT client_id AS clientId, name, capability,
      created_at AS createdAt, updated_at AS updatedAt, profile_id AS clientProfile
      FROM connection_clients ORDER BY created_at, client_id`,
  });
  const invitationRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: InvitationRow,
    execute: () => sql`SELECT invitation_id AS invitationId, name, token,
      expires_at AS expiresAt, updated_at AS updatedAt, profile_id AS clientProfile
      FROM connection_invitations ORDER BY updated_at, invitation_id`,
  });
  const clientScopeRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ClientScopeRow,
    execute: () => sql`SELECT client_id AS clientId, scope
      FROM connection_client_scopes ORDER BY client_id, position`,
  });
  const invitationScopeRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: InvitationScopeRow,
    execute: () => sql`SELECT invitation_id AS invitationId, scope
      FROM connection_invitation_scopes ORDER BY invitation_id, position`,
  });

  const loadClients = Effect.gen(function* () {
    const [rows, scopes] = yield* Effect.all([clientRows(undefined), clientScopeRows(undefined)]);
    return rows.map(
      (row): StoredClient => ({
        ...row,
        scopes: scopes
          .filter((item) => item.clientId === row.clientId)
          .map((item) => item.scope as ShowtimeConnectionScope),
      }),
    );
  });
  const loadInvitations = Effect.gen(function* () {
    const [rows, scopes] = yield* Effect.all([
      invitationRows(undefined),
      invitationScopeRows(undefined),
    ]);
    return rows.map(
      (row): StoredInvitation => ({
        ...row,
        scopes: scopes
          .filter((item) => item.invitationId === row.invitationId)
          .map((item) => item.scope as ShowtimeConnectionScope),
      }),
    );
  });
  const loadInvitationById = Effect.fn("ConnectionStore.loadInvitationById")(function* (
    invitationId: string,
  ) {
    const invitations = yield* loadInvitations;
    return invitations.find((item) => item.invitationId === invitationId);
  });
  const insertScopes = Effect.fn("ConnectionStore.insertScopes")(function* (
    kind: "client" | "invitation",
    id: string,
    scopes: ReadonlyArray<ShowtimeConnectionScope>,
  ) {
    for (const [position, scope] of scopes.entries()) {
      if (kind === "client")
        yield* sql`INSERT INTO connection_client_scopes (client_id, scope, position)
          VALUES (${id}, ${scope}, ${position})`;
      else
        yield* sql`INSERT INTO connection_invitation_scopes (invitation_id, scope, position)
          VALUES (${id}, ${scope}, ${position})`;
    }
  });

  const createInvitation = (
    name: string | undefined,
    clientProfile: string,
    requestedScopes: ReadonlyArray<ShowtimeConnectionScope> = [],
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [clients, invitations] = yield* Effect.all([loadClients, loadInvitations]);
          const trimmedName = name?.trim();
          const resolvedName =
            trimmedName ||
            nextDefaultClientName([
              ...clients.map((client) => client.name),
              ...invitations.map((invitation) => invitation.name),
            ]);
          const validatedName = yield* Schema.decodeUnknownEffect(ClientName)(resolvedName).pipe(
            Effect.mapError(
              () => new ConnectionInputError({ message: "Invalid connection name." }),
            ),
          );
          const decodedScopes = yield* Schema.decodeUnknownEffect(ShowtimeConnectionScopes)(
            requestedScopes,
          ).pipe(
            Effect.mapError(
              () => new ConnectionInputError({ message: "Invalid connection permissions." }),
            ),
          );
          const scopes = Array.from(new Set(decodedScopes));
          const profile = yield* Schema.decodeUnknownEffect(ProfileId)(clientProfile).pipe(
            Effect.mapError(() => new ConnectionInputError({ message: "Invalid profile." })),
          );
          const now = yield* Clock.currentTimeMillis;
          const invitation: StoredInvitation = {
            invitationId: nanoid(),
            name: validatedName,
            token: makeToken(),
            expiresAt: new Date(now + pairingLifetimeMs).toISOString(),
            updatedAt: new Date(now).toISOString(),
            clientProfile: profile,
            scopes,
          };
          const inserted = yield* sql`INSERT INTO connection_invitations
          (invitation_id, name, token, profile_id, expires_at, updated_at)
          SELECT ${invitation.invitationId}, ${invitation.name}, ${invitation.token},
            ${invitation.clientProfile}, ${invitation.expiresAt}, ${invitation.updatedAt}
          WHERE EXISTS (SELECT 1 FROM profiles WHERE id = ${invitation.clientProfile})
          RETURNING invitation_id`;
          if (inserted.length === 0)
            return yield* new ConnectionInputError({ message: "Profile not found." });
          yield* insertScopes("invitation", invitation.invitationId, invitation.scopes);
          yield* Effect.logInfo("Created client pairing invitation").pipe(
            Effect.annotateLogs({ invitationId: invitation.invitationId }),
          );
          return invitation;
        }),
      )
      .pipe(
        Effect.catch((cause) =>
          cause instanceof ConnectionInputError ? Effect.fail(cause) : Effect.die(cause),
        ),
      );

  const pairingInvitation = (invitationId: string) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const invitation = yield* loadInvitationById(invitationId);
          if (!invitation) return undefined;
          const now = yield* Clock.currentTimeMillis;
          if (Date.parse(invitation.expiresAt) > now) return invitation;
          const renewed: StoredInvitation = {
            ...invitation,
            token: makeToken(),
            expiresAt: new Date(now + pairingLifetimeMs).toISOString(),
            updatedAt: new Date(now).toISOString(),
          };
          yield* sql`UPDATE connection_invitations SET token = ${renewed.token},
          expires_at = ${renewed.expiresAt}, updated_at = ${renewed.updatedAt}
          WHERE invitation_id = ${invitationId}`;
          yield* Effect.logInfo("Renewed expired client pairing invitation").pipe(
            Effect.annotateLogs({ invitationId }),
          );
          return renewed;
        }),
      )
      .pipe(Effect.orDie);

  const consumeInvitation = (token: string) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const invitations = yield* loadInvitations;
          const invitation = invitations.find((item) => item.token === token);
          const now = yield* Clock.currentTimeMillis;
          if (!invitation || Date.parse(invitation.expiresAt) <= now) {
            yield* Effect.logWarning("Rejected invalid or expired pairing token");
            return undefined;
          }
          const client: StoredClient = {
            clientId: nanoid(),
            name: invitation.name,
            capability: makeToken(),
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
            clientProfile: invitation.clientProfile,
            scopes: invitation.scopes,
          };
          yield* sql`INSERT INTO connection_clients
          (client_id, name, capability, profile_id, created_at, updated_at)
          VALUES (${client.clientId}, ${client.name}, ${client.capability}, ${client.clientProfile},
            ${client.createdAt}, ${client.updatedAt})`;
          yield* insertScopes("client", client.clientId, client.scopes);
          yield* sql`DELETE FROM connection_invitations
          WHERE invitation_id = ${invitation.invitationId}`;
          yield* Effect.logInfo("Paired client").pipe(
            Effect.annotateLogs({ clientId: client.clientId }),
          );
          return {
            clientId: client.clientId,
            capability: client.capability,
            scopes: client.scopes,
            clientProfile: client.clientProfile,
          };
        }),
      )
      .pipe(Effect.orDie);

  const disconnect = (signals: Iterable<Deferred.Deferred<void>>) =>
    Effect.forEach(signals, (signal) => Deferred.succeed(signal, undefined), { discard: true });

  const remove = (id: string) =>
    sessionGate.withPermits(1)(
      Effect.gen(function* () {
        const client = yield* sql<{ client_id: string }>`SELECT client_id FROM connection_clients
          WHERE client_id = ${id}`;
        yield* sql.withTransaction(
          Effect.all(
            [
              sql`DELETE FROM connection_clients WHERE client_id = ${id}`,
              sql`DELETE FROM connection_invitations WHERE invitation_id = ${id}`,
            ],
            { discard: true },
          ),
        );
        const active = (yield* Ref.get(sessions)).get(id) ?? [];
        yield* disconnect(active);
        yield* Effect.logInfo(
          client.length > 0 ? "Revoked client" : "Removed client invitation",
        ).pipe(Effect.annotateLogs({ connectionId: id }));
      }).pipe(Effect.orDie),
    );

  const removeAllPersisted = sql
    .withTransaction(
      Effect.gen(function* () {
        const counts = yield* sql<{ clients: number; invitations: number }>`SELECT
        (SELECT COUNT(*) FROM connection_clients) AS clients,
        (SELECT COUNT(*) FROM connection_invitations) AS invitations`;
        yield* Effect.all(
          [sql`DELETE FROM connection_clients`, sql`DELETE FROM connection_invitations`],
          { discard: true },
        );
        return {
          pairedClients: Number(counts[0]?.clients ?? 0),
          pendingInvitations: Number(counts[0]?.invitations ?? 0),
        };
      }),
    )
    .pipe(Effect.orDie);

  const removeAll = sessionGate.withPermits(1)(
    removeAllPersisted.pipe(
      Effect.tap((counts) =>
        Effect.logInfo("Revoked all clients").pipe(Effect.annotateLogs(counts)),
      ),
      Effect.andThen(
        Ref.get(sessions).pipe(
          Effect.flatMap((current) =>
            disconnect(Array.from(current.values()).flatMap((signals) => Array.from(signals))),
          ),
        ),
      ),
    ),
  );

  const updateClientProfile = (clientId: string, capability: string, clientProfile: string) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(ProfileId)(clientProfile).pipe(
        Effect.option,
      );
      if (decoded._tag === "None") return "invalid-profile" as const;
      const profile = decoded.value;
      const updatedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql`UPDATE connection_clients SET profile_id = ${profile},
            updated_at = ${updatedAt} WHERE client_id = ${clientId} AND capability = ${capability}
            AND profile_id <> ${profile}
            AND EXISTS (SELECT 1 FROM profiles WHERE id = ${profile})
            RETURNING client_id`;
          if (rows.length > 0) return "updated" as const;
          const status = yield* sql<{ authorized: number; profileExists: number }>`SELECT
            EXISTS (SELECT 1 FROM connection_clients
              WHERE client_id = ${clientId} AND capability = ${capability}) AS authorized,
            EXISTS (SELECT 1 FROM profiles WHERE id = ${profile}) AS profileExists`;
          if (Number(status[0]?.authorized) !== 1) return "revoked" as const;
          if (Number(status[0]?.profileExists) !== 1) return "invalid-profile" as const;
          return "unchanged" as const;
        }),
      );
    }).pipe(Effect.orDie);

  const disconnectAll = sessionGate.withPermits(1)(
    Ref.get(sessions).pipe(
      Effect.flatMap((current) =>
        disconnect(Array.from(current.values()).flatMap((signals) => Array.from(signals))),
      ),
      Effect.andThen(Effect.logInfo("Disconnected all remote clients")),
    ),
  );

  const credentialsStatus = (clientId: string, capability: string) =>
    sql`SELECT 1 AS found FROM connection_clients
      WHERE client_id = ${clientId} AND capability = ${capability} LIMIT 1`.pipe(
      Effect.map((rows) => (rows.length > 0 ? ("authorized" as const) : ("revoked" as const))),
      Effect.orDie,
    );

  const scopeAuthorization = (
    clientId: string,
    capability: string,
    scope: ShowtimeConnectionScope,
  ) =>
    sql<{ scope: string | null }>`SELECT s.scope FROM connection_clients c
      LEFT JOIN connection_client_scopes s ON s.client_id = c.client_id AND s.scope = ${scope}
      WHERE c.client_id = ${clientId} AND c.capability = ${capability} LIMIT 1`.pipe(
      Effect.map((rows) => {
        if (rows.length === 0) return "revoked" as const;
        return rows[0]?.scope === scope ? ("authorized" as const) : ("forbidden" as const);
      }),
      Effect.orDie,
    );

  const withAuthorizedSession = <A, E, R, E2, R2>(
    clientId: string,
    capability: string,
    isEnabled: Effect.Effect<boolean, E2, R2>,
    effect: Effect.Effect<A, E, R>,
  ) =>
    Effect.gen(function* () {
      const signal = yield* Deferred.make<void>();
      const admitted = yield* sessionGate.withPermits(1)(
        Effect.gen(function* () {
          if (!(yield* isEnabled)) return false;
          if ((yield* credentialsStatus(clientId, capability)) !== "authorized") return false;
          yield* Ref.update(sessions, (current) => {
            const next = new Map(current);
            next.set(clientId, new Set([...(current.get(clientId) ?? []), signal]));
            return next;
          });
          return true;
        }),
      );
      if (!admitted) return undefined;
      yield* Effect.logInfo("Client connected").pipe(Effect.annotateLogs({ clientId }));
      return yield* Effect.raceFirst(
        effect,
        Deferred.await(signal).pipe(Effect.andThen(Effect.interrupt)),
      ).pipe(
        Effect.ensuring(
          Ref.update(sessions, (current) => {
            const next = new Map(current);
            const remaining = new Set(current.get(clientId) ?? []);
            remaining.delete(signal);
            if (remaining.size === 0) next.delete(clientId);
            else next.set(clientId, remaining);
            return next;
          }).pipe(
            Effect.andThen(
              Effect.logInfo("Client disconnected").pipe(Effect.annotateLogs({ clientId })),
            ),
          ),
        ),
      );
    });

  return ConnectionStore.of({
    clients: loadClients.pipe(Effect.orDie),
    invitations: loadInvitations.pipe(Effect.orDie),
    connectedClientIds: Ref.get(sessions).pipe(Effect.map((current) => new Set(current.keys()))),
    createInvitation,
    pairingInvitation,
    consumeInvitation,
    remove,
    removeAllPersisted,
    removeAll,
    updateClientProfile,
    disconnectAll,
    credentialsStatus,
    scopeAuthorization,
    withAuthorizedSession,
  });
});

export const layerNoDeps = Layer.effect(ConnectionStore, make());
export const layer = layerNoDeps;
