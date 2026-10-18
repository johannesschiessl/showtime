import { Effect, Layer, Schema } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  ShowId,
  SongId,
  SongName,
  SongArtist,
  MicrophoneId,
  MicrophoneNumber,
} from "@showtime/contracts";
import { SqlClient } from "effect/sql";
import { makeDatabaseTestLayer } from "../database/DatabaseTest.js";
import * as Ids from "../ids/Ids.js";
import { ShowService } from "./ShowService.js";
import * as ShowServiceLayer from "./ShowService.js";
import { ShowRepository } from "./ShowRepository.js";
import * as ShowRepositoryLayer from "./ShowRepository.js";

const homes = new Set<string>();
afterEach(async () => {
  await Promise.all(Array.from(homes, (home) => rm(home, { recursive: true, force: true })));
  homes.clear();
});

const makeLayer = (home: string) =>
  ShowServiceLayer.layer.pipe(
    Layer.provideMerge(ShowRepositoryLayer.layer),
    Layer.provideMerge(Ids.layer),
    Layer.provideMerge(makeDatabaseTestLayer(home)),
  );

describe("ShowRepository", () => {
  it("renames a show without rewriting its children", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "showtime-focused-update-"));
    homes.add(home);
    await Effect.runPromise(
      Effect.gen(function* () {
        const shows = yield* ShowService;
        const sql = yield* SqlClient.SqlClient;
        const created = yield* shows.create({ name: "Original", color: "sky" });
        const repository = yield* ShowRepository;
        const microphoneId = MicrophoneId.make("mic_0000000000000001");
        yield* repository.update(created.id, (document) => ({
          ...document,
          microphones: [
            {
              id: microphoneId,
              number: MicrophoneNumber.make("1"),
              color: "sky",
              createdAt: document.config.createdAt,
              updatedAt: document.config.updatedAt,
            },
          ],
          songs: [1, 2].map((id) => ({
            id: SongId.make(`song_${id.toString().padStart(16, "0")}`),
            name: SongName.make("Song"),
            artist: SongArtist.make("Artist"),
            createdAt: document.config.createdAt,
            updatedAt: document.config.updatedAt,
            mixAssignments: [{ mixId: document.mixes[0]!.id, microphoneIds: [microphoneId] }],
          })),
        }));
        yield* sql`CREATE TABLE child_writes (operation TEXT)`;
        for (const table of [
          "songs",
          "microphones",
          "mixes",
          "song_mix_assignments",
          "song_mix_assignment_microphones",
          "song_microphone_names",
          "song_mix_names",
        ]) {
          for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
            yield* sql.unsafe(`CREATE TRIGGER audit_${table}_${operation} AFTER ${operation} ON ${table}
            BEGIN INSERT INTO child_writes VALUES ('${operation}'); END`);
          }
        }
        yield* shows.edit({ id: created.id, name: "Renamed", color: "blue" });
        expect(yield* sql`SELECT * FROM child_writes`).toEqual([]);
        yield* repository.update(created.id, (document) => ({
          ...document,
          songs: document.songs.map((song, index) =>
            index === 0 ? { ...song, notes: "New note" } : song,
          ),
        }));
        expect(yield* sql`SELECT * FROM child_writes`).toEqual([{ operation: "UPDATE" }]);
      }).pipe(Effect.provide(makeLayer(home))),
    );
  });
  it("keeps the repository ID immutable when an update callback changes config.id", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "showtime-show-repository-"));
    homes.add(home);
    const replacementId = Schema.decodeUnknownSync(ShowId)("show_fedcba9876543210");
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const shows = yield* ShowService;
        const repository = yield* ShowRepository;
        const created = yield* shows.create({ name: "Original", color: "sky" });
        const updated = yield* repository.update(created.id, (document) => ({
          ...document,
          config: { ...document.config, id: replacementId },
        }));
        return {
          updated,
          found: yield* repository.findById(created.id),
          replacement: yield* Effect.result(repository.findById(replacementId)),
        };
      }).pipe(Effect.provide(makeLayer(home))),
    );
    expect(result.updated.config.id).not.toBe(replacementId);
    expect(result.found.config.id).toBe(result.updated.config.id);
    expect(result.replacement._tag).toBe("Failure");
  });
});
