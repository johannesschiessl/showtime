import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlError, SqlSchema } from "effect/sql";
import {
  Color,
  decodeProfileName,
  ProfileId,
  ProfileName,
  RpcError,
  type Profile,
  type ProfilesState,
} from "@showtime/contracts";
import { DatabaseReady } from "../database/Database.js";
import { Ids } from "../ids/Ids.js";

export class ProfileService extends Context.Service<
  ProfileService,
  {
    readonly list: Effect.Effect<ProfilesState, RpcError>;
    readonly create: (params: {
      readonly name: string;
      readonly color: Color;
    }) => Effect.Effect<Profile, RpcError>;
    readonly edit: (params: {
      readonly id: ProfileId;
      readonly name: string;
      readonly color: Color;
    }) => Effect.Effect<Profile, RpcError>;
    readonly delete: (id: ProfileId) => Effect.Effect<void, RpcError>;
    readonly setDefault: (id: ProfileId) => Effect.Effect<void, RpcError>;
  }
>()("@showtime/backend/profiles/ProfileService") {}

const ProfileRow = Schema.Struct({
  id: ProfileId,
  name: ProfileName,
  color: Color,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

const rpcError = (message: string, cause?: unknown) =>
  new RpcError({ message, ...(cause === undefined ? {} : { cause }) });
const normalizeName = (name: string) => name.normalize("NFKC").toLowerCase();

const make = Effect.fn("ProfileService.make")(function* () {
  yield* DatabaseReady;
  const sql = yield* SqlClient.SqlClient;
  const ids = yield* Ids;
  const findProfiles = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProfileRow,
    execute: () => sql`SELECT id, name, color, created_at AS createdAt, updated_at AS updatedAt
      FROM profiles ORDER BY created_at, id`,
  });
  const findDefault = SqlSchema.findOne({
    Request: Schema.Void,
    Result: Schema.Struct({ defaultProfileId: ProfileId }),
    execute: () => sql`SELECT default_profile_id AS defaultProfileId
      FROM app_settings WHERE singleton_id = 1`,
  });

  const list = sql
    .withTransaction(
      Effect.all([findProfiles(undefined), findDefault(undefined)]).pipe(
        Effect.map(([profiles, settings]) => ({
          profiles,
          defaultProfileId: settings.defaultProfileId,
        })),
      ),
    )
    .pipe(Effect.mapError((cause) => rpcError("Could not load profiles.", cause)));

  const create = Effect.fn("ProfileService.create")(function* (params: {
    readonly name: string;
    readonly color: Color;
  }) {
    const name = yield* decodeProfileName(params.name.trim()).pipe(
      Effect.mapError((cause) =>
        rpcError("Profile name cannot be empty or longer than 80 characters.", cause),
      ),
    );
    const now = yield* DateTime.now;
    const profile: Profile = {
      id: yield* ids.makeProfileId,
      name,
      color: params.color,
      createdAt: now,
      updatedAt: now,
    };
    yield* sql`INSERT INTO profiles
      (id, name, normalized_name, color, created_at, updated_at)
      VALUES (${profile.id}, ${profile.name}, ${normalizeName(profile.name)}, ${profile.color},
        ${DateTime.formatIso(now)}, ${DateTime.formatIso(now)})`;
    return profile;
  });

  const edit = Effect.fn("ProfileService.edit")(function* (params: {
    readonly id: ProfileId;
    readonly name: string;
    readonly color: Color;
  }) {
    const name = yield* decodeProfileName(params.name.trim()).pipe(
      Effect.mapError((cause) =>
        rpcError("Profile name cannot be empty or longer than 80 characters.", cause),
      ),
    );
    const updatedAt = yield* DateTime.now;
    const rows = yield* sql`UPDATE profiles SET name = ${name},
      normalized_name = ${normalizeName(name)}, color = ${params.color},
      updated_at = ${DateTime.formatIso(updatedAt)} WHERE id = ${params.id}
      RETURNING id, name, color, created_at AS createdAt, updated_at AS updatedAt`;
    const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(ProfileRow))(rows);
    if (!decoded[0]) return yield* Effect.fail(rpcError("Profile not found."));
    return decoded[0];
  });

  const deleteProfile = (id: ProfileId) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const settings = yield* findDefault(undefined);
        if (settings.defaultProfileId === id)
          return yield* Effect.fail(
            rpcError("Choose another default profile before deleting this one."),
          );
        const references = yield* sql<{ count: number }>`SELECT
          (SELECT COUNT(*) FROM connection_clients WHERE profile_id = ${id}) +
          (SELECT COUNT(*) FROM connection_invitations WHERE profile_id = ${id}) AS count`;
        if (Number(references[0]?.count) > 0)
          return yield* Effect.fail(
            rpcError("Remove connections using this profile before deleting it."),
          );
        const rows = yield* sql`DELETE FROM profiles WHERE id = ${id} RETURNING id`;
        if (rows.length === 0) return yield* Effect.fail(rpcError("Profile not found."));
      }),
    );

  const setDefault = (id: ProfileId) =>
    sql`UPDATE app_settings SET default_profile_id = ${id} WHERE singleton_id = 1
      AND EXISTS (SELECT 1 FROM profiles WHERE id = ${id}) RETURNING singleton_id`.pipe(
      Effect.flatMap((rows) =>
        rows.length === 0 ? Effect.fail(rpcError("Profile not found.")) : Effect.void,
      ),
      sql.withTransaction,
    );

  const mapPersistenceError = <A>(
    effect: Effect.Effect<A, unknown>,
    message: string,
    uniqueViolationMessage?: string,
  ) =>
    effect.pipe(
      Effect.mapError((cause) => {
        if (cause instanceof RpcError) return cause;
        if (uniqueViolationMessage && SqlError.isSqlError(cause)) {
          if (cause.reason._tag === "UniqueViolation")
            return rpcError(uniqueViolationMessage, cause);
        }
        return rpcError(message, cause);
      }),
    );

  return ProfileService.of({
    list,
    create: (params) =>
      mapPersistenceError(
        create(params),
        "Could not create profile.",
        "Could not create profile. Profile names must be unique.",
      ),
    edit: (params) =>
      mapPersistenceError(
        edit(params),
        "Could not update profile.",
        "Could not update profile. Profile names must be unique.",
      ),
    delete: (id) => mapPersistenceError(deleteProfile(id), "Could not delete profile."),
    setDefault: (id) =>
      mapPersistenceError(setDefault(id), "Could not change the default profile."),
  });
});

export const layerNoDeps = Layer.effect(ProfileService, make());
export const layer = layerNoDeps;
