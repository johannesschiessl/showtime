import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { normalizeShowtimeHostName, ShowtimeHostName } from "@showtime/shared";
import { DatabaseReady } from "../database/Database.js";

const SettingsRow = Schema.Struct({
  connectionsEnabled: Schema.Number,
  hostName: ShowtimeHostName,
});

export interface ShowtimeSettings {
  readonly connectionsEnabled: boolean;
  readonly hostName: ShowtimeHostName;
}

export class Settings extends Context.Service<
  Settings,
  {
    readonly get: Effect.Effect<ShowtimeSettings>;
    readonly setConnectionsEnabled: (enabled: boolean) => Effect.Effect<ShowtimeSettings>;
    readonly setHostName: (hostName: ShowtimeHostName) => Effect.Effect<ShowtimeSettings>;
  }
>()("@showtime/backend/settings/Settings") {}

const make = Effect.fn("Settings.make")(function* () {
  yield* DatabaseReady;
  const sql = yield* SqlClient.SqlClient;
  const read = SqlSchema.findOne({
    Request: Schema.Void,
    Result: SettingsRow,
    execute: () => sql`SELECT connections_enabled AS connectionsEnabled, host_name AS hostName
      FROM app_settings WHERE singleton_id = 1`,
  });
  const get = read(undefined).pipe(
    Effect.map((row) => ({
      connectionsEnabled: row.connectionsEnabled === 1,
      hostName: row.hostName,
    })),
    Effect.orDie,
  );
  const setConnectionsEnabled = (enabled: boolean) =>
    sql`UPDATE app_settings SET connections_enabled = ${enabled ? 1 : 0}
      WHERE singleton_id = 1`.pipe(Effect.andThen(get), Effect.orDie);
  const setHostName = (hostName: ShowtimeHostName) => {
    const normalized = normalizeShowtimeHostName(hostName);
    return sql`UPDATE app_settings SET host_name = ${normalized} WHERE singleton_id = 1`.pipe(
      Effect.andThen(get),
      Effect.orDie,
    );
  };
  return Settings.of({ get, setConnectionsEnabled, setHostName });
});

export const layerNoDeps = Layer.effect(Settings, make());
export const layer = layerNoDeps;
