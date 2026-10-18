import { SqliteClient } from "@effect/sql-sqlite-node";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  currentMigrations,
  databaseFileName,
  DatabaseBackup,
  DatabaseReady,
  UnsupportedPrereleaseStateError,
} from "./Database.js";
import { makeDatabaseTestLayer } from "./DatabaseTest.js";

const homes = new Set<string>();
afterEach(async () => {
  await Promise.all(Array.from(homes, (home) => rm(home, { recursive: true, force: true })));
  homes.clear();
});

const makeHome = async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "showtime-database-"));
  homes.add(home);
  return home;
};

const runDatabase = <A>(
  home: string,
  effect: Effect.Effect<
    A,
    unknown,
    DatabaseReady | SqlClient.SqlClient | SqliteClient.SqliteClient | DatabaseBackup
  >,
) => Effect.runPromise(effect.pipe(Effect.provide(makeDatabaseTestLayer(home)), Effect.scoped));

const databaseTestDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendDirectory = path.resolve(databaseTestDirectory, "../..");
const vitePlusCli = path.resolve(
  databaseTestDirectory,
  "../../../../node_modules/vite-plus/bin/vp",
);

const workerStartupTimeout = 60_000;
const workerRunTimeout = 20_000;
const workerStopTimeout = 5_000;
const concurrencyTestTimeout = workerStartupTimeout + workerRunTimeout + workerStopTimeout + 5_000;

const raceWithTimeout = async <A>(promise: Promise<A>, timeout: number, onTimeout: () => A) => {
  const timer = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(timeout, undefined, { signal: timer.signal }).then(onTimeout),
    ]);
  } finally {
    timer.abort();
  }
};

const waitFor = <A>(promise: Promise<A>, timeout: number, message: string) =>
  raceWithTimeout(promise, timeout, () => {
    throw new Error(message);
  });

const settlesWithin = (promise: Promise<unknown>, timeout: number) =>
  raceWithTimeout(
    promise.then(() => true),
    timeout,
    () => false,
  );

const runStartupProcess = (home: string, barrier: string, workerId: string) => {
  const child = spawn(
    process.execPath,
    [
      vitePlusCli,
      "test",
      "run",
      "src/database/Database.test.ts",
      "-t",
      "database concurrency worker",
      "--reporter=dot",
    ],
    {
      cwd: backendDirectory,
      env: {
        ...process.env,
        NO_COLOR: "1",
        SHOWTIME_DATABASE_CONCURRENCY_HOME: home,
        SHOWTIME_DATABASE_CONCURRENCY_BARRIER: barrier,
        SHOWTIME_DATABASE_CONCURRENCY_WORKER: workerId,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true,
    },
  );
  let output = "";
  let failure: unknown;
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));
  const completion = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Database startup worker failed (${code ?? signal}).\n${output}`));
    });
  });
  void completion.catch((cause) => {
    failure = cause;
  });

  return {
    completion,
    get failure() {
      return failure;
    },
    async stop() {
      const pid = child.pid;
      if (pid === undefined) return;
      if (process.platform === "win32" && (child.exitCode !== null || child.signalCode !== null)) {
        return;
      }

      const stopDeadline = Date.now() + workerStopTimeout;
      const remainingStopTime = () => Math.max(0, stopDeadline - Date.now());

      if (process.platform === "win32") {
        const taskkill = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        taskkill.unref();
        const taskkillCompletion = new Promise<void>((resolve) => {
          taskkill.once("error", () => resolve());
          taskkill.once("exit", () => resolve());
        });
        if (!(await settlesWithin(taskkillCompletion, remainingStopTime()))) {
          taskkill.kill("SIGKILL");
        }
      } else {
        try {
          process.kill(-pid, "SIGTERM");
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ESRCH") child.kill();
        }
        await settlesWithin(
          completion.catch(() => undefined),
          Math.min(1_000, remainingStopTime()),
        );
        try {
          process.kill(-pid, 0);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === "ESRCH") return;
        }
        try {
          process.kill(-pid, "SIGKILL");
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGKILL");
        }
      }

      if (
        !(await settlesWithin(
          completion.catch(() => undefined),
          remainingStopTime(),
        ))
      ) {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {}
        }
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
      }
    },
  };
};

const runConcurrentStartupProcesses = async (home: string, barrier: string) => {
  const workers = [
    runStartupProcess(home, barrier, "worker-1"),
    runStartupProcess(home, barrier, "worker-2"),
  ];
  try {
    const startupDeadline = Date.now() + workerStartupTimeout;
    while ((await readdir(barrier)).filter((entry) => entry.startsWith("ready-")).length < 2) {
      const failedWorker = workers.find((worker) => worker.failure !== undefined);
      if (failedWorker) throw failedWorker.failure;
      if (Date.now() >= startupDeadline) {
        throw new Error("Timed out starting database worker processes.");
      }
      await delay(5);
    }
    // Both processes receive the same future release time, avoiding a false pass caused by one
    // process completing synchronous SQLite work while the other is still leaving the barrier.
    await writeFile(path.join(barrier, "release"), String(Date.now() + 250));
    await waitFor(
      Promise.all(workers.map((worker) => worker.completion)),
      workerRunTimeout,
      "Timed out waiting for database worker processes.",
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.stop()));
  }
};

const concurrencyWorkerHome = process.env.SHOWTIME_DATABASE_CONCURRENCY_HOME;
const concurrencyWorkerBarrier = process.env.SHOWTIME_DATABASE_CONCURRENCY_BARRIER;
const concurrencyWorkerId = process.env.SHOWTIME_DATABASE_CONCURRENCY_WORKER;

if (concurrencyWorkerHome && concurrencyWorkerBarrier && concurrencyWorkerId) {
  it(
    "database concurrency worker",
    async () => {
      await writeFile(path.join(concurrencyWorkerBarrier, `ready-${concurrencyWorkerId}`), "ready");
      const deadline = Date.now() + workerStartupTimeout;
      let releaseAt: number | undefined;
      while (releaseAt === undefined) {
        if (Date.now() >= deadline) throw new Error("Timed out waiting for the startup barrier.");
        try {
          const parsed = Number(
            await readFile(path.join(concurrencyWorkerBarrier, "release"), "utf8"),
          );
          if (parsed > 0) releaseAt = parsed;
          else await delay(5);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
          await delay(5);
        }
      }
      await delay(Math.max(0, releaseAt - Date.now()));
      const state = await runDatabase(
        concurrencyWorkerHome,
        Effect.flatMap(
          SqlClient.SqlClient,
          (sql) => sql<{ settings: number; profiles: number }>`SELECT
          (SELECT COUNT(*) FROM app_settings) AS settings,
          (SELECT COUNT(*) FROM profiles) AS profiles`,
        ),
      );
      expect(state).toEqual([{ settings: 1, profiles: 1 }]);
    },
    concurrencyTestTimeout,
  );
}

describe("Showtime database", () => {
  it("deletes shows with reply chains beyond SQLite's cascade recursion limit", async () => {
    const home = await makeHome();
    await runDatabase(
      home,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO shows VALUES ('show', 'Show', 'sky', 'now', 'now')`;
        yield* sql`INSERT INTO chat_channels VALUES ('channel', 'show', 'General', 'now')`;
        yield* sql`WITH RECURSIVE chain(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM chain WHERE n < 1100)
        INSERT INTO chat_messages (id, show_id, channel_id, sender_profile_id, body, reply_to_message_id, sent_at)
        SELECT 'message' || n, 'show', 'channel', 'sender', 'Reply', CASE WHEN n = 1 THEN NULL ELSE 'message' || (n - 1) END, 'now' FROM chain`;
        yield* sql`DELETE FROM shows WHERE id = 'show'`;
        expect(yield* sql`SELECT * FROM chat_messages`).toEqual([]);
        expect(yield* sql`PRAGMA foreign_key_check`).toEqual([]);
      }),
    );
  });
  it("rejects the prerelease v1 layout without upgrading or resetting existing data", async () => {
    const home = await makeHome();
    await runDatabase(home, Effect.void);
    const filename = path.join(home, ".showtime", databaseFileName);
    const db = new DatabaseSync(filename);
    try {
      db.exec(`DROP TRIGGER show_detach_chat_replies; DROP TRIGGER channel_detach_chat_replies;
      DROP TRIGGER chat_message_insert_counts;
      DROP TRIGGER chat_message_delete_counts;
      ALTER TABLE chat_messages DROP COLUMN channel_position;
      DROP TABLE chat_sender_counts; DROP TABLE chat_channel_counts;`);
      db.exec(`INSERT INTO shows VALUES ('show', 'Show', 'blue', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO chat_channels VALUES ('channel', 'show', 'General', '2026-01-01T00:00:00.000Z');
      INSERT INTO chat_messages (id, show_id, channel_id, sender_profile_id, body, sent_at)
        VALUES ('message', 'show', 'channel', 'sender', 'Existing message', '2026-01-01T00:00:00.000Z');`);
    } finally {
      db.close();
    }
    const before = await readFile(filename);
    await expect(runDatabase(home, Effect.void)).rejects.toBeInstanceOf(
      UnsupportedPrereleaseStateError,
    );
    expect(await readFile(filename)).toEqual(before);
  });
  it("creates migration 1, bootstrap state, safety pragmas, and a consistent backup", async () => {
    const home = await makeHome();
    const backupPath = path.join(home, "backup.db");
    const result = await runDatabase(
      home,
      Effect.gen(function* () {
        yield* DatabaseReady;
        const sql = yield* SqlClient.SqlClient;
        const ledger = yield* sql<{ migration_id: number; name: string }>`SELECT migration_id, name
          FROM effect_sql_migrations ORDER BY migration_id`;
        const settings = yield* sql<{ settings: number; profiles: number }>`SELECT
          (SELECT COUNT(*) FROM app_settings) AS settings,
          (SELECT COUNT(*) FROM profiles) AS profiles`;
        const foreignKeys = yield* sql<{ foreign_keys: number }>`PRAGMA foreign_keys`;
        const busyTimeout = yield* sql<{ timeout: number }>`PRAGMA busy_timeout`;
        const synchronous = yield* sql<{ synchronous: number }>`PRAGMA synchronous`;
        const backup = yield* (yield* DatabaseBackup).backup(backupPath);
        return { ledger, settings, foreignKeys, busyTimeout, synchronous, backup };
      }),
    );
    expect(result.ledger).toEqual([{ migration_id: 1, name: "initial" }]);
    expect(result.settings).toEqual([{ settings: 1, profiles: 1 }]);
    expect(result.foreignKeys).toEqual([{ foreign_keys: 1 }]);
    expect(result.busyTimeout).toEqual([{ timeout: 5000 }]);
    expect(result.synchronous).toEqual([{ synchronous: 2 }]);
    expect(result.backup.remainingPages).toBe(0);
    await expect(stat(backupPath)).resolves.toBeDefined();
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    expect(backup.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    backup.close();
  });

  it("is a no-op on restart and rolls back failed transactions", async () => {
    const home = await makeHome();
    const firstLedger = await runDatabase(
      home,
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`SELECT migration_id, name, created_at FROM effect_sql_migrations`,
      ),
    );
    await runDatabase(
      home,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql
          .withTransaction(
            sql`INSERT INTO profiles
            (id, name, normalized_name, color, created_at, updated_at)
            VALUES ('profile_1111111111111111', 'Rolled back', 'rolled back', 'sky',
              '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`.pipe(
              Effect.andThen(Effect.fail("rollback")),
            ),
          )
          .pipe(Effect.ignore);
        const rows = yield* sql`SELECT id FROM profiles WHERE id = 'profile_1111111111111111'`;
        expect(rows).toEqual([]);
      }),
    );
    const secondLedger = await runDatabase(
      home,
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql`SELECT migration_id, name, created_at FROM effect_sql_migrations`,
      ),
    );
    expect(secondLedger).toEqual(firstLedger);
  });

  it("records the migration ledger and enforces foreign keys", async () => {
    const home = await makeHome();
    const readLedger = Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql<{ migration_id: number; name: string }>`SELECT migration_id, name
        FROM effect_sql_migrations ORDER BY migration_id`,
    );
    expect(await runDatabase(home, readLedger)).toEqual(
      currentMigrations.map(([migration_id, name]) => ({ migration_id, name })),
    );

    await expect(
      runDatabase(
        home,
        Effect.flatMap(
          SqlClient.SqlClient,
          (sql) => sql`INSERT INTO microphones
            (id, show_id, position, number, color, name, created_at, updated_at)
            VALUES ('mic_1111111111111111', 'show_1111111111111111', 0, 1, 'sky', 'Invalid',
              '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
        ),
      ),
    ).rejects.toBeDefined();
  });

  it(
    "initializes a completely absent database safely across concurrent startups",
    async () => {
      const home = await makeHome();
      const filename = path.join(home, ".showtime", databaseFileName);
      const barrier = path.join(home, "startup-barrier");
      await mkdir(barrier);

      await expect(stat(filename)).rejects.toMatchObject({ code: "ENOENT" });
      await runConcurrentStartupProcesses(home, barrier);

      const verified = new DatabaseSync(filename, { readOnly: true });
      try {
        expect(
          verified
            .prepare("SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id")
            .all(),
        ).toEqual(currentMigrations.map(([migration_id, name]) => ({ migration_id, name })));
        expect(
          verified
            .prepare(`SELECT
            (SELECT COUNT(*) FROM app_settings) AS settings,
            (SELECT COUNT(*) FROM profiles) AS profiles`)
            .get(),
        ).toEqual({ settings: 1, profiles: 1 });
      } finally {
        verified.close();
      }
    },
    concurrencyTestTimeout,
  );

  it(
    "repairs an unbootstrapped baseline safely across concurrent startups",
    async () => {
      const home = await makeHome();
      await runDatabase(home, Effect.void);
      const filename = path.join(home, ".showtime", databaseFileName);
      const db = new DatabaseSync(filename);
      db.exec("BEGIN; DELETE FROM app_settings; DELETE FROM profiles; COMMIT;");
      db.close();
      const barrier = path.join(home, "startup-barrier");
      await mkdir(barrier);

      await runConcurrentStartupProcesses(home, barrier);

      const verified = new DatabaseSync(filename, { readOnly: true });
      try {
        expect(
          verified
            .prepare(`SELECT
            (SELECT COUNT(*) FROM app_settings) AS settings,
            (SELECT COUNT(*) FROM profiles) AS profiles`)
            .get(),
        ).toEqual({ settings: 1, profiles: 1 });
      } finally {
        verified.close();
      }
    },
    concurrencyTestTimeout,
  );

  it("releases initialization ownership when a process terminates", async () => {
    const home = await makeHome();
    const directory = path.join(home, ".showtime");
    const lockPath = path.join(directory, `${databaseFileName}.initialize.db`);
    await mkdir(directory);
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec('BEGIN IMMEDIATE');
      process.stdout.write('locked');
      setInterval(() => {}, 1000);
    `,
        lockPath,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const stopped = new Promise<void>((resolve) => holder.once("exit", () => resolve()));
    try {
      await waitFor(
        new Promise<void>((resolve, reject) => {
          holder.stdout.once("data", () => resolve());
          holder.once("error", reject);
          holder.once("exit", () => reject(new Error("Lock holder exited before acquisition")));
        }),
        5_000,
        "Lock holder did not acquire the initialization lock",
      );
    } finally {
      holder.kill();
      await stopped;
    }

    await runDatabase(home, Effect.void);

    await expect(stat(lockPath)).resolves.toBeDefined();
    const verified = new DatabaseSync(path.join(directory, databaseFileName), { readOnly: true });
    try {
      expect(
        verified
          .prepare("SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id")
          .all(),
      ).toEqual(currentMigrations.map(([migration_id, name]) => ({ migration_id, name })));
    } finally {
      verified.close();
    }
  });

  it.each([
    ["settings.json", "{}"],
    ["profiles.json", "{}"],
    ["connections.json", "{}"],
    ["chats.db", "prerelease"],
  ])("rejects prerelease %s without creating or changing state", async (name, contents) => {
    const home = await makeHome();
    const directory = path.join(home, ".showtime");
    await mkdir(directory);
    const legacyPath = path.join(directory, name);
    await writeFile(legacyPath, contents);
    const before = await readFile(legacyPath);
    await expect(runDatabase(home, Effect.void)).rejects.toBeInstanceOf(
      UnsupportedPrereleaseStateError,
    );
    expect(await readFile(legacyPath)).toEqual(before);
    await expect(stat(path.join(directory, databaseFileName))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects discovered prerelease show documents", async () => {
    const home = await makeHome();
    const shows = path.join(home, ".showtime", "shows");
    await mkdir(shows, { recursive: true });
    const showPath = path.join(shows, "festival.showtime");
    await writeFile(showPath, '{"type":"showtime-show","version":1}');
    const before = await readFile(showPath);
    await expect(runDatabase(home, Effect.void)).rejects.toBeInstanceOf(
      UnsupportedPrereleaseStateError,
    );
    expect(await readFile(showPath)).toEqual(before);
  });

  it.each([
    [
      "table",
      "CREATE TABLE prerelease_state (value TEXT); INSERT INTO prerelease_state VALUES ('keep')",
    ],
    ["view", "CREATE VIEW prerelease_state AS SELECT 'keep' AS value"],
    [
      "view and trigger",
      `CREATE VIEW prerelease_state AS SELECT 'keep' AS value;
       CREATE TRIGGER prerelease_trigger INSTEAD OF INSERT ON prerelease_state
       BEGIN SELECT NEW.value; END`,
    ],
  ])(
    "rejects an experimental database containing a %s and leaves it byte-for-byte unchanged",
    async (_objectType, setup) => {
      const home = await makeHome();
      const directory = path.join(home, ".showtime");
      await mkdir(directory);
      const filename = path.join(directory, databaseFileName);
      const db = new DatabaseSync(filename);
      db.exec(setup);
      db.close();
      const before = await readFile(filename);
      await expect(runDatabase(home, Effect.void)).rejects.toBeInstanceOf(
        UnsupportedPrereleaseStateError,
      );
      expect(await readFile(filename)).toEqual(before);
    },
  );

  it.each([
    [
      "prerelease v2 ledger",
      "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (2, 'chat_counts')",
    ],
    [
      "prerelease v3 ledger",
      "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (2, 'chat_counts'), (3, 'chat_reply_deletion')",
    ],
    [
      "future ledger",
      "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (999, 'future')",
    ],
    [
      "renamed baseline",
      "UPDATE effect_sql_migrations SET name = 'prerelease' WHERE migration_id = 1",
    ],
    ["missing baseline", "DELETE FROM effect_sql_migrations"],
    ["missing channel counts", "DROP TABLE chat_channel_counts"],
    ["missing sender counts", "DROP TABLE chat_sender_counts"],
    ["missing channel position", "ALTER TABLE chat_messages DROP COLUMN channel_position"],
    ["missing insert counts trigger", "DROP TRIGGER chat_message_insert_counts"],
    ["missing delete counts trigger", "DROP TRIGGER chat_message_delete_counts"],
    ["missing show replies trigger", "DROP TRIGGER show_detach_chat_replies"],
    ["missing channel replies trigger", "DROP TRIGGER channel_detach_chat_replies"],
  ])("rejects %s without opening the database for writes", async (_name, setup) => {
    const home = await makeHome();
    await runDatabase(home, Effect.void);
    const filename = path.join(home, ".showtime", databaseFileName);
    const db = new DatabaseSync(filename);
    db.exec(setup);
    db.close();
    const before = await readFile(filename);
    await expect(runDatabase(home, Effect.void)).rejects.toBeInstanceOf(
      UnsupportedPrereleaseStateError,
    );
    expect(await readFile(filename)).toEqual(before);
  });
});
