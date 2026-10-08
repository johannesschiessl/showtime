import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Context, DateTime, Effect, Layer, Path, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { SqlClient } from "effect/sql";
import { customAlphabet } from "nanoid";
import { DatabaseSync } from "node:sqlite";
import { hostname } from "node:os";
import { idAlphabet, idSuffixLength, profileIdPrefix } from "@showtime/contracts";
import { normalizeShowtimeHostName } from "@showtime/shared";
import * as HomeDirectory from "../platform/HomeDirectory.js";
import initial from "./migrations/0001_initial.js";

export const databaseFileName = "showtime.db";
export const migrationTableName = "effect_sql_migrations";
export const currentMigrations = [[1, "initial"]] as const;

const initializationLockFileName = `${databaseFileName}.initialize.lock`;
const initializationLockWaitMilliseconds = 20_000;
const malformedLockGraceMilliseconds = 2_000;

const criticalTables = [
  "app_settings",
  "profiles",
  "connection_clients",
  "connection_client_scopes",
  "connection_invitations",
  "connection_invitation_scopes",
  "shows",
  "microphones",
  "mixes",
  "songs",
  "song_mix_assignments",
  "song_mix_assignment_microphones",
  "song_microphone_names",
  "song_mix_names",
  "chat_channels",
  "chat_messages",
  "chat_profile_channel_state",
  "chat_presets",
] as const;

const criticalIndexes = [
  "app_settings_default_profile",
  "connection_clients_profile",
  "shows_name_id",
  "microphones_show_active_order",
  "mixes_show_active_order",
  "songs_show_active_order",
  "chat_messages_channel_sequence",
  "chat_presets_show_updated",
] as const;

const expectedColumns: Readonly<Record<(typeof criticalTables)[number], ReadonlyArray<string>>> = {
  app_settings: ["singleton_id", "connections_enabled", "host_name", "default_profile_id"],
  profiles: ["id", "name", "normalized_name", "color", "created_at", "updated_at"],
  connection_clients: ["client_id", "name", "capability", "profile_id", "created_at", "updated_at"],
  connection_client_scopes: ["client_id", "scope", "position"],
  connection_invitations: [
    "invitation_id",
    "name",
    "token",
    "profile_id",
    "expires_at",
    "updated_at",
  ],
  connection_invitation_scopes: ["invitation_id", "scope", "position"],
  shows: ["id", "name", "color", "created_at", "updated_at"],
  microphones: [
    "id",
    "show_id",
    "position",
    "number",
    "color",
    "name",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  mixes: [
    "id",
    "show_id",
    "position",
    "number",
    "color",
    "name",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  songs: [
    "id",
    "show_id",
    "position",
    "name",
    "artist",
    "notes",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  song_mix_assignments: ["song_id", "show_id", "mix_id", "position"],
  song_mix_assignment_microphones: ["song_id", "mix_id", "microphone_id", "position"],
  song_microphone_names: ["song_id", "microphone_id", "name", "position"],
  song_mix_names: ["song_id", "show_id", "mix_id", "name", "position"],
  chat_channels: ["id", "show_id", "name", "created_at"],
  chat_messages: [
    "sequence",
    "id",
    "show_id",
    "channel_id",
    "sender_profile_id",
    "body",
    "parts_json",
    "answer_json",
    "reply_to_message_id",
    "sent_at",
  ],
  chat_profile_channel_state: [
    "show_id",
    "channel_id",
    "profile_id",
    "last_read_sequence",
    "notifications_enabled",
  ],
  chat_presets: [
    "id",
    "show_id",
    "name",
    "template",
    "fields_json",
    "answer_json",
    "created_at",
    "updated_at",
  ],
};

const sameStrings = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const resetMessage = (paths: ReadonlyArray<string>) =>
  `Unsupported prerelease Showtime state was found. This development cutover does not import old state. ` +
  `Move or remove the listed state and start Showtime again: ${paths.join(", ")}`;

export class UnsupportedPrereleaseStateError extends Schema.TaggedError<UnsupportedPrereleaseStateError>()(
  "UnsupportedPrereleaseStateError",
  {
    message: Schema.String,
    paths: Schema.Array(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class DatabaseInitializationError extends Schema.TaggedError<DatabaseInitializationError>()(
  "DatabaseInitializationError",
  { message: Schema.String, stage: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

export class DatabaseReady extends Context.Service<DatabaseReady, {}>()(
  "@showtime/backend/database/DatabaseReady",
) {}

export class DatabaseBackup extends Context.Service<
  DatabaseBackup,
  {
    readonly backup: (
      destination: string,
    ) => Effect.Effect<SqliteClient.BackupMetadata, DatabaseInitializationError>;
  }
>()("@showtime/backend/database/DatabaseBackup") {}

const isCurrentLedger = (rows: ReadonlyArray<{ migration_id: number; name: string }>) =>
  rows.length === currentMigrations.length &&
  rows.every(
    (row, index) =>
      row.migration_id === currentMigrations[index]![0] &&
      row.name === currentMigrations[index]![1],
  );

const inspectExistingDatabase = (filename: string) =>
  Effect.try({
    try: () => {
      const db = new DatabaseSync(filename, { readOnly: true });
      try {
        // The initialization lock serializes startup, but an already-running Showtime process can
        // still be writing this WAL database while another process performs the cutoff check.
        db.exec("PRAGMA busy_timeout = 5000");
        const objects = db
          .prepare("SELECT type, name FROM sqlite_master")
          .all() as unknown as ReadonlyArray<{ type: string; name: string }>;
        const applicationObjects = objects.filter((row) => !row.name.startsWith("sqlite_"));
        const ledgerExists = db
          .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(migrationTableName);
        // Opening a database creates an empty file before initialization takes the cross-process
        // lock. An empty file (or the empty ledger left if a process exited just after the Effect
        // migrator created it) contains no prerelease state and is safe to finish initializing.
        if (!ledgerExists) {
          if (applicationObjects.length === 0) return;
          throw new Error("The Effect migration ledger is missing.");
        }
        const ledger = db
          .prepare("SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id")
          .all() as unknown as ReadonlyArray<{ migration_id: number; name: string }>;
        if (
          ledger.length === 0 &&
          applicationObjects.every((row) => row.type === "table" && row.name === migrationTableName)
        )
          return;
        if (!isCurrentLedger(ledger))
          throw new Error("The migration ledger is not the released baseline.");
        const tables = new Set(
          objects.filter((row) => row.type === "table").map((row) => row.name),
        );
        const indexes = new Set(
          objects.filter((row) => row.type === "index").map((row) => row.name),
        );
        if (criticalTables.some((table) => !tables.has(table)))
          throw new Error("The database schema is incomplete.");
        if (criticalIndexes.some((index) => !indexes.has(index)))
          throw new Error("The database indexes are incomplete.");
        for (const table of criticalTables) {
          const columns = db
            .prepare(`PRAGMA table_info(${table})`)
            .all() as unknown as ReadonlyArray<{
            name: string;
          }>;
          if (
            !sameStrings(
              columns.map((column) => column.name),
              expectedColumns[table],
            )
          )
            throw new Error(`The ${table} table does not match the released schema.`);
        }
        const bootstrapState = db
          .prepare(`SELECT
            (SELECT COUNT(*) FROM app_settings) AS settings_count,
            (SELECT COUNT(*) FROM profiles) AS profile_count,
            (SELECT COUNT(*) FROM app_settings s
              INNER JOIN profiles p ON p.id = s.default_profile_id) AS valid_default`)
          .get() as
          | { settings_count: number; profile_count: number; valid_default: number }
          | undefined;
        const isBootstrapped =
          Number(bootstrapState?.settings_count) === 1 &&
          Number(bootstrapState?.valid_default) === 1;
        const isUnbootstrappedBaseline =
          Number(bootstrapState?.settings_count) === 0 &&
          Number(bootstrapState?.profile_count) === 0;
        if (!isBootstrapped && !isUnbootstrappedBaseline)
          throw new Error("The bootstrap settings/default-profile invariant is invalid.");
        if (db.prepare("PRAGMA foreign_key_check").all().length > 0)
          throw new Error("The database contains invalid foreign-key references.");
        const quickCheck = db.prepare("PRAGMA quick_check").get() as
          | Record<string, unknown>
          | undefined;
        if (!quickCheck || !Object.values(quickCheck).includes("ok"))
          throw new Error("SQLite quick_check failed.");
      } finally {
        db.close();
      }
    },
    catch: (cause) =>
      new UnsupportedPrereleaseStateError({
        message: resetMessage([filename]),
        paths: [filename],
        cause,
      }),
  });

const prepareDatabasePath = Effect.fn("ShowtimeDatabasePreflight")(function* () {
  const fs = yield* FileSystem;
  const path = yield* Path.Path;
  const home = yield* HomeDirectory.HomeDirectory;
  const directory = path.join(yield* home.homeDirectory, ".showtime");
  const filename = path.join(directory, databaseFileName);
  const legacyPaths = ["settings.json", "profiles.json", "connections.json", "chats.db"].map(
    (name) => path.join(directory, name),
  );
  const found: Array<string> = [];
  for (const legacyPath of legacyPaths) if (yield* fs.exists(legacyPath)) found.push(legacyPath);
  const showsDirectory = path.join(directory, "shows");
  if (yield* fs.exists(showsDirectory)) {
    const entries = yield* fs.readDirectory(showsDirectory, { recursive: true });
    for (const entry of entries) {
      if (entry.endsWith(".showtime") || entry.endsWith(".json"))
        found.push(path.join(showsDirectory, entry));
    }
  }
  if (found.length > 0)
    return yield* new UnsupportedPrereleaseStateError({
      message: resetMessage(found),
      paths: found,
    });
  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
  return { directory, filename } as const;
});

interface InitializationLockOwner {
  readonly pid: number;
  readonly token: string;
}

const parseInitializationLockOwner = (contents: string): InitializationLockOwner | undefined => {
  try {
    const parsed = JSON.parse(contents) as Partial<InitializationLockOwner>;
    return typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0
      ? { pid: parsed.pid, token: parsed.token }
      : undefined;
  } catch {
    return undefined;
  }
};

const processIsRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
};

const lockError = (message: string, cause?: unknown) =>
  new DatabaseInitializationError({
    message,
    stage: "initialization-lock",
    cause,
  });

const acquireInitializationLock = Effect.fn("ShowtimeDatabaseAcquireInitializationLock")(function* (
  lockPath: string,
) {
  const fs = yield* FileSystem;
  const token = customAlphabet(idAlphabet, idSuffixLength)();
  const owner = { pid: process.pid, token } satisfies InitializationLockOwner;
  const startedAt = Date.now();

  while (true) {
    const acquired = yield* fs
      .writeFileString(lockPath, JSON.stringify(owner), { flag: "wx", mode: 0o600 })
      .pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          cause.reason._tag === "AlreadyExists"
            ? Effect.succeed(false)
            : Effect.fail(lockError("Could not create the database initialization lock.", cause)),
        ),
      );
    if (acquired) return owner;

    const existingOwner = yield* fs.readFileString(lockPath).pipe(
      Effect.map(parseInitializationLockOwner),
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(undefined)
          : Effect.fail(lockError("Could not read the database initialization lock.", cause)),
      ),
    );
    const elapsed = Date.now() - startedAt;
    const reclaim = existingOwner
      ? !processIsRunning(existingOwner.pid)
      : elapsed >= malformedLockGraceMilliseconds;

    if (reclaim) {
      const stalePath = `${lockPath}.stale-${token}`;
      const renamed = yield* fs.rename(lockPath, stalePath).pipe(
        Effect.as(true),
        Effect.catch((cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(false)
            : Effect.fail(
                lockError("Could not reclaim a stale database initialization lock.", cause),
              ),
        ),
      );
      if (renamed)
        yield* fs
          .remove(stalePath, { force: true })
          .pipe(
            Effect.mapError((cause) =>
              lockError("Could not remove a stale database initialization lock.", cause),
            ),
          );
      continue;
    }

    if (elapsed >= initializationLockWaitMilliseconds)
      return yield* lockError(
        "Timed out waiting for another Showtime process to initialize the database.",
      );
    yield* Effect.sleep("25 millis");
  }
});

const releaseInitializationLock = (lockPath: string, owner: InitializationLockOwner) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const existingOwner = yield* fs.readFileString(lockPath).pipe(
      Effect.map(parseInitializationLockOwner),
      Effect.catch(() => Effect.succeed(undefined)),
    );
    if (existingOwner?.token === owner.token)
      yield* fs.remove(lockPath, { force: true }).pipe(Effect.ignore);
  });

const clientLayer = Layer.unwrap(
  prepareDatabasePath().pipe(
    Effect.map(({ filename }) =>
      SqliteClient.layer({
        filename,
        // SqliteClient otherwise enables WAL before a busy timeout can be installed. Two processes
        // opening the same database can then throw SQLITE_BUSY during layer construction.
        disableWAL: true,
        spanAttributes: { "showtime.database": "state" },
      }),
    ),
  ),
);

const bootstrap = Effect.fn("ShowtimeDatabaseBootstrap")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const makeId = customAlphabet(idAlphabet, idSuffixLength);
  const profileId = `${profileIdPrefix}${makeId()}`;
  const timestamp = DateTime.formatIso(yield* DateTime.now);
  const hostName = normalizeShowtimeHostName(hostname());
  // The first statement is a conditional write, so concurrent initializers serialize before
  // deciding whether bootstrap is needed instead of racing after a shared read snapshot.
  const inserted = yield* sql<{ id: string }>`INSERT INTO profiles
    (id, name, normalized_name, color, created_at, updated_at)
    SELECT ${profileId}, ${"Default"}, ${"default"}, ${"sky"}, ${timestamp}, ${timestamp}
    WHERE NOT EXISTS (SELECT 1 FROM app_settings)
      AND NOT EXISTS (SELECT 1 FROM profiles)
    RETURNING id`;
  if (inserted.length > 0) {
    yield* sql`INSERT INTO app_settings
      (singleton_id, connections_enabled, host_name, default_profile_id)
      VALUES (1, 1, ${hostName}, ${profileId})`;
    return;
  }
  const state = yield* sql<{ settings: number; profiles: number }>`SELECT
    (SELECT COUNT(*) FROM app_settings) AS settings,
    (SELECT COUNT(*) FROM profiles) AS profiles`;
  if (Number(state[0]?.settings) !== 1 || Number(state[0]?.profiles) < 1)
    return yield* new DatabaseInitializationError({
      message: "The database contains incomplete bootstrap state.",
      stage: "bootstrap",
    });
});

const validateCurrentSchema = Effect.fn("ShowtimeDatabaseValidate")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const ledger = yield* sql<{ migration_id: number; name: string }>`SELECT migration_id, name
    FROM effect_sql_migrations ORDER BY migration_id`;
  if (!isCurrentLedger(ledger))
    return yield* new DatabaseInitializationError({
      message: "The database migration history does not match this Showtime build.",
      stage: "migration-ledger",
    });
  const objects = yield* sql<{ type: string; name: string }>`SELECT type, name FROM sqlite_master
    WHERE type IN ('table', 'index')`;
  const tables = new Set(objects.filter((row) => row.type === "table").map((row) => row.name));
  const indexes = new Set(objects.filter((row) => row.type === "index").map((row) => row.name));
  if (criticalTables.some((table) => !tables.has(table)))
    return yield* new DatabaseInitializationError({
      message: "The current database is missing a required table.",
      stage: "schema-tables",
    });
  if (criticalIndexes.some((index) => !indexes.has(index)))
    return yield* new DatabaseInitializationError({
      message: "The current database is missing a required index.",
      stage: "schema-indexes",
    });
  for (const table of criticalTables) {
    const columns = yield* sql.unsafe<{ name: string }>(`PRAGMA table_info(${table})`);
    if (
      !sameStrings(
        columns.map((column) => column.name),
        expectedColumns[table],
      )
    )
      return yield* new DatabaseInitializationError({
        message: `The ${table} table does not match the current schema.`,
        stage: "schema-columns",
      });
  }
  const foreignKeys = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys`;
  const busyTimeout = yield* sql<{ timeout: number }>`PRAGMA busy_timeout`;
  const synchronous = yield* sql<{ synchronous: number }>`PRAGMA synchronous`;
  const journalMode = yield* sql<{ journal_mode: string }>`PRAGMA journal_mode`;
  if (Number(foreignKeys[0]?.foreign_keys) !== 1 || Number(busyTimeout[0]?.timeout) !== 5000)
    return yield* new DatabaseInitializationError({
      message: "SQLite connection safety settings were not applied.",
      stage: "pragmas",
    });
  if (Number(synchronous[0]?.synchronous) !== 2)
    return yield* new DatabaseInitializationError({
      message: "SQLite full durability mode was not applied.",
      stage: "pragmas",
    });
  if (journalMode[0]?.journal_mode.toLowerCase() !== "wal")
    return yield* new DatabaseInitializationError({
      message: "SQLite write-ahead logging is not active.",
      stage: "pragmas",
    });
  const settings = yield* sql<{ count: number; valid_default: number }>`SELECT
      COUNT(*) AS count,
      SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) AS valid_default
    FROM app_settings s LEFT JOIN profiles p ON p.id = s.default_profile_id`;
  if (Number(settings[0]?.count) !== 1 || Number(settings[0]?.valid_default) !== 1)
    return yield* new DatabaseInitializationError({
      message: "The database does not contain one valid settings/default-profile pair.",
      stage: "bootstrap-invariants",
    });
  const check = yield* sql<Record<string, unknown>>`PRAGMA quick_check`;
  if (!check[0] || !Object.values(check[0]).includes("ok"))
    return yield* new DatabaseInitializationError({
      message: "SQLite reported a database integrity problem.",
      stage: "quick-check",
    });
  const invalidForeignKeys = yield* sql`PRAGMA foreign_key_check`;
  if (invalidForeignKeys.length > 0)
    return yield* new DatabaseInitializationError({
      message: "The database contains invalid foreign-key references.",
      stage: "foreign-key-check",
    });
});

const initialize = Effect.fn("ShowtimeDatabaseInitialize")(function* () {
  const fs = yield* FileSystem;
  const path = yield* Path.Path;
  const home = yield* HomeDirectory.HomeDirectory;
  const filename = path.join(yield* home.homeDirectory, ".showtime", databaseFileName);
  const lockPath = path.join(path.dirname(filename), initializationLockFileName);

  return yield* Effect.acquireUseRelease(
    acquireInitializationLock(lockPath),
    () =>
      Effect.gen(function* () {
        // The read-only cutoff check and every idempotent initialization write are covered by the
        // same process lock. A second process therefore observes either an empty database or the
        // fully migrated and bootstrapped baseline, never an intermediate schema.
        yield* inspectExistingDatabase(filename);
        const sql = yield* SqlClient.SqlClient;
        yield* sql`PRAGMA busy_timeout = 5000`;
        yield* sql`PRAGMA foreign_keys = ON`;
        yield* sql`PRAGMA journal_mode = WAL`;
        yield* sql`PRAGMA synchronous = FULL`;
        yield* SqliteMigrator.run({
          loader: SqliteMigrator.fromRecord({ "0001_initial": initial }),
          table: migrationTableName,
        });
        yield* sql.withTransaction(
          bootstrap().pipe(Effect.withSpan("Showtime database bootstrap")),
        );
        yield* validateCurrentSchema();
        for (const candidate of [filename, `${filename}-wal`, `${filename}-shm`])
          if (yield* fs.exists(candidate)) yield* fs.chmod(candidate, 0o600).pipe(Effect.ignore);
        return DatabaseReady.of({});
      }),
    (owner) => releaseInitializationLock(lockPath, owner),
  );
});

const readyLayer = Layer.effect(DatabaseReady, initialize()).pipe(Layer.provideMerge(clientLayer));

export const layer = Layer.mergeAll(
  readyLayer,
  Layer.effect(
    DatabaseBackup,
    Effect.gen(function* () {
      yield* DatabaseReady;
      const sqlite = yield* SqliteClient.SqliteClient;
      const fs = yield* FileSystem;
      return DatabaseBackup.of({
        backup: (destination) =>
          sqlite.backup(destination).pipe(
            Effect.tap(() => fs.chmod(destination, 0o600).pipe(Effect.ignore)),
            Effect.mapError(
              (cause) =>
                new DatabaseInitializationError({
                  message: "Could not create the database backup.",
                  stage: "backup",
                  cause,
                }),
            ),
          ),
      });
    }),
  ).pipe(Layer.provide(readyLayer)),
);
