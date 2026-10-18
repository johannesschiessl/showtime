# Database migrations

This document defines Showtime's persistence and migration architecture. The backend has one
authoritative SQLite database at `.showtime/showtime.db`, implemented with Effect SQL. JSON files
are not application state.

## Prerelease cutover

The move to `showtime.db` is a clean reset, not a migration from the current development builds.
Migration `0001_initial` creates the baseline schema. Forward migrations add maintained chat
counts and detach reply relationships before parent deletion. Complete databases with a known
ledger prefix upgrade in place; unknown histories and incomplete schemas are rejected.

Chat messages have a channel-local position, assigned by the insert-count trigger. Snapshots use
that position to compute unread totals through indexed lookups. Message history is append-only;
Showtime deletes messages only when their entire channel or show is deleted.

Showtime must never read, import, repair, rewrite, delete, or otherwise accept these prerelease
formats:

- `settings.json`;
- `profiles.json`;
- `connections.json`;
- `chats.db`;
- discovered show JSON files;
- raw or prefixed prerelease chat-message envelopes; or
- an experimental `showtime.db` whose Effect migration ledger and current schema do not match.

A preflight guard detects known prerelease backend state before opening or creating the database. It
fails startup with an actionable reset message and leaves every file untouched, even when a current
database also exists. This guard is not a migration and must never contain an importer.

An existing `showtime.db` is usable only when its `effect_sql_migrations` history is a valid prefix
of the migrations shipped by Showtime, with the complete schema required by that prefix.
Forward migrations accept only those known SQLite versions; prerelease JSON and experimental
database formats never become supported sources.

Browser local storage is an unavoidable device-local exception: a remote browser cannot open the
host's SQLite database. It contains connection credentials and device preferences, not
authoritative backend state. Its baseline payloads and versioned keys are strict version 1 and have
no prerelease compatibility readers.

## Runtime architecture

Persistence is constructed as an Effect layer graph:

```text
HomeDirectory + FileSystem + Path + Reactivity
                       |
                       v
      @effect/sql-sqlite-node SqliteClient.layer
                       |
                       v
        PRAGMAs -> SqliteMigrator -> Bootstrap
                       |
                       v
           Current-schema validation
                       |
                       v
                 DatabaseReady
                       |
                       v
       repositories -> services -> RPC / HTTP
```

The backend-wide database module resolves the path and returns the SQLite layer with
`Layer.unwrap`. The Node SQLite client provides a single serialized connection, scoped shutdown,
prepared-statement caching, WAL mode by default, tracing, transaction support, and a native backup
Effect. Do not wrap it in a second connection pool or global write semaphore.

Database configuration, migration execution, bootstrap, and validation are layers that require the
same `SqlClient`. Repositories require both `SqlClient` and the marker service `DatabaseReady`.
Layer composition, rather than call-site discipline, makes it impossible to construct repositories
or start RPC before the database is current.

Configure these connection-level policies before migrations:

- `PRAGMA foreign_keys = ON`;
- `PRAGMA busy_timeout = 5000`;
- WAL mode, supplied by the Effect SQLite client unless explicitly disabled; and
- `PRAGMA synchronous = FULL`, unless measured live-load tests justify a documented alternative.

Because Effect's Node driver uses one serialized connection, `foreign_keys` applies consistently to
all application statements. Configuration tests must query each PRAGMA back rather than assuming
it took effect.

## Baseline schema

Versioned migrations own all DDL. Domain services must not run `CREATE TABLE`, inspect
`PRAGMA table_info`, or issue conditional `ALTER TABLE` statements at startup.

The baseline contains these areas:

- `app_settings`: one constrained singleton row containing connection enablement, host name, and a
  foreign key to the default profile;
- `profiles`: typed ID, unique normalized name, color, and UTC created/updated timestamps;
- `connection_clients` and `connection_invitations`: credentials, names, profile ownership,
  expiry, and timestamps;
- normalized client/invitation scope tables with constrained scope values;
- `shows`, `microphones`, `mixes`, and `songs`, including ownership, ordering, timestamps, and the
  existing soft-deletion semantics;
- normalized song-to-mix assignments and ordered microphone- and mix-name overrides;
- chat channels, messages, profile-channel state, and presets; and
- indexes for all foreign keys and hot list, ordering, authorization, and sequence queries.

Use foreign keys for ownership and consistency. Cascades are appropriate only when deleting the
parent unquestionably owns deletion of the child. Operations such as profile protection,
connection revocation, and show soft deletion remain explicit domain transactions.

Do not copy the former JSON documents' version fields into relational rows. The applied Effect SQL
migration history is the database-wide schema version, beginning with migration 1. Device-local
browser records retain explicit version-1 payload schemas because they are outside SQLite.

Store UTC timestamps in one canonical representation and decode them to Effect `DateTime` values at
the query boundary. Store structured JSON only where relational columns provide no useful
constraint or query benefit. Every JSON column has one current Effect Schema; there are no legacy
prefixes or best-effort fallbacks.

## Effect SQL query boundaries

Repositories are `Context.Service` classes. Their production implementations are focused
`layerNoDeps` layers requiring `SqlClient` and `DatabaseReady`; higher-level composition supplies
the live database layer.

Repository methods returning Effects use named `Effect.fn` definitions. Database failures and
consistency failures use `Schema.TaggedErrorClass` types. Translation to user-facing `RpcError`
happens at the service/RPC boundary, preserving typed causes internally.

Use Effect's `SqlSchema` helpers for stable query boundaries:

- `SqlSchema.findAll` for zero or more rows;
- `SqlSchema.findOne` when absence is an error;
- `SqlSchema.findOneOption` when absence is expected; and
- `SqlSchema.void` for statements without a result.

Each helper encodes a typed request schema before execution and decodes unknown database rows with a
result schema. Do not manually cast driver rows or build runtime predicates for SQL results.
Parameterize all values through the Effect SQL template/tag APIs; never concatenate identifiers,
names, capabilities, tokens, or chat content into SQL text.

SQLite is the authority. Do not mirror persistent tables into long-lived `Ref`s. A `Ref` remains
appropriate for ephemeral process state such as active WebSocket session handles, but durable
settings, profiles, connections, shows, songs, and chat are queried from the database.

## Transactions and reactivity

Every operation that changes more than one row or relies on a read-then-write invariant uses
`SqlClient.withTransaction`. Effect SQL uses the transaction connection throughout the Effect and
uses savepoints for nested transactions. Do not add nested application semaphores to imitate this
behavior.

Examples include:

- creating the default profile and settings row;
- changing the default profile;
- renaming the local host and revoking all credentials;
- consuming an invitation and creating its paired client/scopes;
- creating, reordering, or soft-deleting show entities;
- replacing song mix/microphone assignments; and
- inserting a chat message and advancing related sequence/read state.

`SyncEngine` coordinates Effect SQL with Effect Reactivity. A mutation performs its database
transaction first and publishes invalidation only after commit. Rollback or interruption emits no
new snapshot. Queries do not take a global mutation semaphore; the SQLite client already serializes
connection access, while transactions provide the required atomic boundary.

Client-generated IDs and database uniqueness constraints make retried create mutations idempotent.
The current RPC contract requires those IDs; the backend has no old-client fallback.

## Migration implementation

Use `SqliteMigrator` from `@effect/sql-sqlite-node`. It delegates to Effect's shared SQL migrator and
provides the required behavior:

- numbered and named migration loading;
- `effect_sql_migrations` history;
- duplicate-ID detection;
- pending-migration selection;
- transactional execution;
- concurrent-run locking; and
- structured spans and migration log annotations.

Migration files follow this convention:

```text
packages/backend/src/database/migrations/
  0001_initial.ts
  0002_example_future_change.ts
```

Each module default-exports an Effect requiring `SqlClient`. Showtime currently uses
`SqliteMigrator.fromRecord` with static imports so packaged Electron builds cannot omit a migration
module during bundling. A future switch to `SqliteMigrator.fromGlob(import.meta.glob(...))` requires
an explicit packaged-build test first. Do not create a custom loader, migration table, or migration
executor.

Run the migrator through `SqliteMigrator.layer` after database configuration and before bootstrap.
Migration 1 creates schema only. An idempotent bootstrap transaction supplies host-derived settings
and generated initial profile IDs after DDL is complete.

The validation layer then verifies:

1. the applied migration IDs and names match the shipped released prefix;
2. there are no gaps, unknown IDs, renamed entries, or future entries;
3. critical tables, indexes, constraints, and foreign-key enforcement exist;
4. bootstrap invariants hold, including exactly one settings row and a valid default profile; and
5. `PRAGMA quick_check` or the documented integrity check succeeds.

The current validator also compares the exact ordered column set of every critical table, checks
the required index names, runs `PRAGMA foreign_key_check`, and reads back WAL, foreign-key,
busy-timeout, and synchronous settings. Existing databases are inspected read-only before the
write-capable client is acquired so experimental or future ledgers are rejected without being
modified.

Historical chat sender IDs are deliberately retained after a non-default profile is deleted. They
are immutable attribution data, not profile ownership, so `chat_messages.sender_profile_id` is
indexed but does not cascade or restrict profile deletion. Current sender IDs are still validated
against `profiles` before a message is inserted.

Only then does the layer provide `DatabaseReady`.

## Authoring future migrations

After the first public release, every breaking persisted-schema change is a new forward migration.

1. Add the next immutable numeric ID and a descriptive snake-case name.
2. Default-export one named/traceable migration Effect requiring `SqlClient`.
3. Perform schema and data changes within the migrator's transaction.
4. Use Effect Schema to validate structured values while backfilling them.
5. Make current repositories read and write only the new representation.
6. Retain a fixture produced by the previous released Showtime version.
7. Test migration, rollback on failure, repeat startup, and packaged loading.
8. Update this document when operational behavior changes.

Never edit, delete, reorder, or rename a released migration. Fix mistakes with a new forward
migration. Automatic downgrade and rollback migrations are not supported.

Cross-version application compatibility should be handled in the schema rollout itself: add data,
backfill it, switch current code, and remove obsolete data in a later released migration when
necessary. Do not spread old-shape branches through repositories and domain services.

## Rejection and failure behavior

Migration or validation failure blocks backend startup. RPC, HTTP pairing, local discovery, and
normal application state remain unavailable. The existing desktop startup-error surface reports:

- that the database could not be initialized or upgraded;
- the non-sensitive migration ID/name or validation stage;
- that retrying is safe; and
- where diagnostic logs can be found.

Logs and spans may contain table/target names, migration metadata, counts, and timings. They must
never contain capabilities, invitation tokens, chat bodies, profile names, show notes, or complete
SQL parameter payloads.

Known prerelease files cause a distinct unsupported-state error before the database is opened or
created. Showtime does not offer an import button, automatic deletion, quarantine, best-effort
decode, or empty-state fallback for them. Tests must assert that rejected files remain byte-for-byte
unchanged, including when a valid current database is present.

## Durability, backup, and permissions

Create `.showtime` and `showtime.db` with owner-only permissions where the platform supports them.
Account for SQLite's `-wal` and `-shm` sidecars in permission and support checks.

Use `SqliteClient.backup` for online consistent backups. Do not copy a live database file directly.
Backup scheduling, retention, restore validation, and user-facing recovery are separate operational
features, not migration steps.

Keep WAL enabled. The default durability target is `synchronous = FULL`; measure it under rapid
show edits and chat traffic before release. Any relaxation must be an explicit documented decision
with crash-loss expectations.

## Testing

Use `@effect/vitest` with fresh temporary directories and scoped SQLite layers. Persistence tests
must not share a mutable database unless the test explicitly covers concurrent access.

Required coverage includes:

- migration 1 creating the exact schema on an empty path;
- bootstrap creating one valid default profile/settings pair;
- current-database restart performing no schema or bootstrap writes;
- duplicate, missing, renamed, unknown, and future ledger entries failing;
- foreign-key and uniqueness constraints;
- nested transactions/savepoints and rollback after failures;
- concurrent migrator startup;
- every repository's request/result schema decoding;
- reactivity publishing only after commit;
- abrupt interruption followed by successful restart;
- database backup and restore validation;
- packaged desktop migration loading; and
- sensitive-value redaction in errors, logs, and spans.

Maintain rejection fixtures for every known prerelease JSON file, show document, chat database, chat
envelope, and experimental database. For each fixture, assert that startup fails before creating or
populating `showtime.db` and that the fixture is not modified.

Stress tests should exercise rapid concurrent show/song/mix/chat mutations while streamed snapshots
are active. Assert deterministic committed ordering, no duplicates, bounded latency, and recovery
after interruption.

## JSON import and export

JSON may be introduced later as an explicit user-initiated show import/export format. It is never
watched or discovered as authoritative state. An import format gets its own current public schema,
security limits, preview/confirmation flow, and transaction that writes validated data into
SQLite. No prerelease show document is implicitly compatible with that future format.
