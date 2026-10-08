import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import {
  Color,
  MicrophoneId,
  MicrophoneNumber,
  MixId,
  MixNumber,
  RpcError,
  ShowConfig,
  ShowId,
  ShowName,
  SongArtist,
  SongId,
  SongName,
  type Microphone,
  type Mix,
  type Song,
  type SongMixName,
  type SongMicrophoneName,
  type SongMixAssignment,
} from "@showtime/contracts";
import { DatabaseReady } from "../database/Database.js";

export interface ShowDocument {
  readonly config: typeof ShowConfig.Type;
  readonly microphones: ReadonlyArray<Microphone>;
  readonly mixes: ReadonlyArray<Mix>;
  readonly songs: ReadonlyArray<Song>;
}

interface ShowRepositoryShape {
  readonly list: Effect.Effect<ReadonlyArray<ShowDocument>, RpcError>;
  readonly findById: (id: ShowId) => Effect.Effect<ShowDocument, RpcError>;
  readonly insert: (document: ShowDocument) => Effect.Effect<void, RpcError>;
  readonly update: (
    id: ShowId,
    update: (document: ShowDocument) => ShowDocument,
  ) => Effect.Effect<ShowDocument, RpcError>;
  readonly delete: (id: ShowId) => Effect.Effect<void, RpcError>;
}

export class ShowRepository extends Context.Service<ShowRepository, ShowRepositoryShape>()(
  "@showtime/backend/shows/ShowRepository",
) {}

const NullableString = Schema.NullOr(Schema.String);
const NullableDateTime = Schema.NullOr(Schema.DateTimeUtcFromString);
const ShowRow = Schema.Struct({
  id: ShowId,
  name: ShowName,
  color: Color,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
const MicrophoneRow = Schema.Struct({
  id: MicrophoneId,
  number: MicrophoneNumber,
  color: Color,
  name: NullableString,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  deletedAt: NullableDateTime,
});
const MixRow = Schema.Struct({
  id: MixId,
  number: MixNumber,
  color: Color,
  name: NullableString,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  deletedAt: NullableDateTime,
});
const SongRow = Schema.Struct({
  id: SongId,
  name: SongName,
  artist: SongArtist,
  notes: NullableString,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  deletedAt: NullableDateTime,
});
const AssignmentRow = Schema.Struct({
  songId: SongId,
  mixId: MixId,
  microphoneId: Schema.NullOr(MicrophoneId),
  microphonePosition: Schema.NullOr(Schema.Int),
  assignmentPosition: Schema.Int,
});
const MicrophoneNameRow = Schema.Struct({
  songId: SongId,
  microphoneId: MicrophoneId,
  name: Schema.String,
  position: Schema.Int,
});
const MixNameRow = Schema.Struct({
  songId: SongId,
  mixId: MixId,
  name: Schema.String,
  position: Schema.Int,
});

const rpcError = (message: string, cause?: unknown) =>
  new RpcError({ message, ...(cause === undefined ? {} : { cause }) });

const make = Effect.fn("ShowRepository.make")(function* () {
  yield* DatabaseReady;
  const sql = yield* SqlClient.SqlClient;

  const findShows = SqlSchema.findAll({
    Request: Schema.Struct({ id: Schema.optional(ShowId) }),
    Result: ShowRow,
    execute: ({ id }) =>
      id === undefined
        ? sql`SELECT id, name, color, created_at AS createdAt, updated_at AS updatedAt
            FROM shows ORDER BY name COLLATE NOCASE, id`
        : sql`SELECT id, name, color, created_at AS createdAt, updated_at AS updatedAt
            FROM shows WHERE id = ${id}`,
  });
  const findMicrophones = SqlSchema.findAll({
    Request: ShowId,
    Result: MicrophoneRow,
    execute: (showId) => sql`SELECT id, number, color, name,
        created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM microphones WHERE show_id = ${showId} ORDER BY position`,
  });
  const findMixes = SqlSchema.findAll({
    Request: ShowId,
    Result: MixRow,
    execute: (showId) => sql`SELECT id, number, color, name,
        created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM mixes WHERE show_id = ${showId} ORDER BY position`,
  });
  const findSongs = SqlSchema.findAll({
    Request: ShowId,
    Result: SongRow,
    execute: (showId) => sql`SELECT id, name, artist, notes,
        created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
      FROM songs WHERE show_id = ${showId} ORDER BY position`,
  });
  const findAssignments = SqlSchema.findAll({
    Request: ShowId,
    Result: AssignmentRow,
    execute: (showId) => sql`SELECT a.song_id AS songId, a.mix_id AS mixId,
        am.microphone_id AS microphoneId, am.position AS microphonePosition,
        a.position AS assignmentPosition
      FROM song_mix_assignments a
      INNER JOIN songs s ON s.id = a.song_id
      LEFT JOIN song_mix_assignment_microphones am
        ON am.song_id = a.song_id AND am.mix_id = a.mix_id
      WHERE s.show_id = ${showId}
      ORDER BY a.song_id, a.position, am.position`,
  });
  const findMicrophoneNames = SqlSchema.findAll({
    Request: ShowId,
    Result: MicrophoneNameRow,
    execute: (showId) => sql`SELECT n.song_id AS songId, n.microphone_id AS microphoneId,
        n.name, n.position
      FROM song_microphone_names n INNER JOIN songs s ON s.id = n.song_id
      WHERE s.show_id = ${showId} ORDER BY n.song_id, n.position`,
  });
  const findMixNames = SqlSchema.findAll({
    Request: ShowId,
    Result: MixNameRow,
    execute: (showId) => sql`SELECT n.song_id AS songId, n.mix_id AS mixId,
        n.name, n.position
      FROM song_mix_names n
      INNER JOIN songs s ON s.id = n.song_id
      INNER JOIN mixes m ON m.show_id = n.show_id AND m.id = n.mix_id
      WHERE s.show_id = ${showId} AND m.deleted_at IS NULL
      ORDER BY n.song_id, n.position`,
  });

  const loadDocument = Effect.fn("ShowRepository.loadDocument")(function* (
    row: typeof ShowRow.Type,
  ) {
    const [microphoneRows, mixRows, songRows, assignmentRows, microphoneNameRows, mixNameRows] =
      yield* Effect.all(
        [
          findMicrophones(row.id),
          findMixes(row.id),
          findSongs(row.id),
          findAssignments(row.id),
          findMicrophoneNames(row.id),
          findMixNames(row.id),
        ],
        { concurrency: "unbounded" },
      );
    const microphones: ReadonlyArray<Microphone> = microphoneRows.map((item) => ({
      id: item.id,
      number: item.number,
      color: item.color,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ...(item.name === null ? {} : { name: item.name }),
      ...(item.deletedAt === null ? {} : { deletedAt: item.deletedAt }),
    }));
    const mixes: ReadonlyArray<Mix> = mixRows.map((item) => ({
      id: item.id,
      number: item.number,
      color: item.color,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ...(item.name === null ? {} : { name: item.name }),
      ...(item.deletedAt === null ? {} : { deletedAt: item.deletedAt }),
    }));
    const assignmentsBySong = new Map<SongId, Array<SongMixAssignment>>();
    for (const row of assignmentRows) {
      let assignments = assignmentsBySong.get(row.songId);
      if (!assignments) {
        assignments = [];
        assignmentsBySong.set(row.songId, assignments);
      }
      let assignment = assignments.find((item) => item.mixId === row.mixId);
      if (!assignment) {
        assignment = { mixId: row.mixId, microphoneIds: [] };
        assignments.push(assignment);
      }
      if (row.microphoneId !== null)
        (assignment.microphoneIds as Array<MicrophoneId>).push(row.microphoneId);
    }
    const namesBySong = new Map<SongId, Array<SongMicrophoneName>>();
    for (const row of microphoneNameRows) {
      const names = namesBySong.get(row.songId) ?? [];
      names.push({ microphoneId: row.microphoneId, name: row.name });
      namesBySong.set(row.songId, names);
    }
    const mixNamesBySong = new Map<SongId, Array<SongMixName>>();
    for (const row of mixNameRows) {
      const names = mixNamesBySong.get(row.songId) ?? [];
      names.push({ mixId: row.mixId, name: row.name });
      mixNamesBySong.set(row.songId, names);
    }
    const songs: ReadonlyArray<Song> = songRows.map((item) => {
      const microphoneNames = namesBySong.get(item.id) ?? [];
      const mixNames = mixNamesBySong.get(item.id) ?? [];
      return {
        id: item.id,
        name: item.name,
        artist: item.artist,
        mixAssignments: assignmentsBySong.get(item.id) ?? [],
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ...(item.notes === null ? {} : { notes: item.notes }),
        ...(microphoneNames.length === 0 ? {} : { microphoneNames }),
        ...(mixNames.length === 0 ? {} : { mixNames }),
        ...(item.deletedAt === null ? {} : { deletedAt: item.deletedAt }),
      };
    });
    return {
      config: {
        id: row.id,
        name: row.name,
        color: row.color,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      microphones,
      mixes,
      songs,
    } satisfies ShowDocument;
  });

  const loadById = Effect.fn("ShowRepository.findByIdSql")(function* (id: ShowId) {
    const rows = yield* findShows({ id });
    const row = rows[0];
    if (!row) return yield* Effect.fail(rpcError("Show not found."));
    return yield* loadDocument(row);
  });

  const insertChildren = Effect.fn("ShowRepository.insertChildren")(function* (
    document: ShowDocument,
  ) {
    const showId = document.config.id;
    for (const [position, microphone] of document.microphones.entries())
      yield* sql`INSERT INTO microphones
        (id, show_id, position, number, color, name, created_at, updated_at, deleted_at)
        VALUES (${microphone.id}, ${showId}, ${position}, ${microphone.number}, ${microphone.color},
          ${microphone.name ?? null}, ${DateTime.formatIso(microphone.createdAt)},
          ${DateTime.formatIso(microphone.updatedAt)},
          ${microphone.deletedAt ? DateTime.formatIso(microphone.deletedAt) : null})`;
    for (const [position, mix] of document.mixes.entries())
      yield* sql`INSERT INTO mixes
        (id, show_id, position, number, color, name, created_at, updated_at, deleted_at)
        VALUES (${mix.id}, ${showId}, ${position}, ${mix.number}, ${mix.color}, ${mix.name ?? null},
          ${DateTime.formatIso(mix.createdAt)}, ${DateTime.formatIso(mix.updatedAt)},
          ${mix.deletedAt ? DateTime.formatIso(mix.deletedAt) : null})`;
    for (const [position, song] of document.songs.entries()) {
      yield* sql`INSERT INTO songs
        (id, show_id, position, name, artist, notes, created_at, updated_at, deleted_at)
        VALUES (${song.id}, ${showId}, ${position}, ${song.name}, ${song.artist}, ${song.notes ?? null},
          ${DateTime.formatIso(song.createdAt)}, ${DateTime.formatIso(song.updatedAt)},
          ${song.deletedAt ? DateTime.formatIso(song.deletedAt) : null})`;
      for (const [assignmentPosition, assignment] of song.mixAssignments.entries()) {
        yield* sql`INSERT INTO song_mix_assignments (song_id, show_id, mix_id, position)
          VALUES (${song.id}, ${showId}, ${assignment.mixId}, ${assignmentPosition})`;
        for (const [microphonePosition, microphoneId] of assignment.microphoneIds.entries())
          yield* sql`INSERT INTO song_mix_assignment_microphones
            (song_id, mix_id, microphone_id, position)
            VALUES (${song.id}, ${assignment.mixId}, ${microphoneId}, ${microphonePosition})`;
      }
      for (const [namePosition, name] of (song.microphoneNames ?? []).entries())
        yield* sql`INSERT INTO song_microphone_names (song_id, microphone_id, name, position)
          VALUES (${song.id}, ${name.microphoneId}, ${name.name}, ${namePosition})`;
      for (const [namePosition, name] of (song.mixNames ?? []).entries())
        yield* sql`INSERT INTO song_mix_names (song_id, show_id, mix_id, name, position)
          VALUES (${song.id}, ${showId}, ${name.mixId}, ${name.name}, ${namePosition})`;
    }
  });

  const insert = Effect.fn("ShowRepository.insert")(function* (document: ShowDocument) {
    const config = document.config;
    yield* sql`INSERT INTO shows (id, name, color, created_at, updated_at)
      VALUES (${config.id}, ${config.name}, ${config.color}, ${DateTime.formatIso(config.createdAt)},
        ${DateTime.formatIso(config.updatedAt)})`;
    yield* insertChildren(document);
  });

  const list = sql.withTransaction(
    Effect.gen(function* () {
      const rows = yield* findShows({});
      return yield* Effect.forEach(rows, loadDocument);
    }),
  );

  const findById: ShowRepositoryShape["findById"] = (id) =>
    sql
      .withTransaction(loadById(id))
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof RpcError ? cause : rpcError("Could not load show.", cause),
        ),
      );

  const update: ShowRepositoryShape["update"] = (id, updateDocument) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* loadById(id);
          const next = yield* Effect.try({
            try: () => updateDocument(current),
            catch: (cause) => rpcError("Could not update show data.", cause),
          });
          if (next === current) return current;
          const refreshed: ShowDocument = {
            ...next,
            config: { ...next.config, id, updatedAt: yield* DateTime.now },
          };
          yield* sql`DELETE FROM songs WHERE show_id = ${id}`;
          yield* sql`DELETE FROM microphones WHERE show_id = ${id}`;
          yield* sql`DELETE FROM mixes WHERE show_id = ${id}`;
          yield* sql`UPDATE shows SET name = ${refreshed.config.name}, color = ${refreshed.config.color},
          updated_at = ${DateTime.formatIso(refreshed.config.updatedAt)} WHERE id = ${id}`;
          yield* insertChildren(refreshed);
          return refreshed;
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof RpcError ? cause : rpcError("Could not persist show data.", cause),
        ),
      );

  const deleteShow: ShowRepositoryShape["delete"] = (id) =>
    sql`DELETE FROM shows WHERE id = ${id} RETURNING id`.pipe(
      Effect.flatMap((rows) =>
        rows.length === 0 ? Effect.fail(rpcError("Show not found.")) : Effect.void,
      ),
      sql.withTransaction,
      Effect.mapError((cause) =>
        cause instanceof RpcError ? cause : rpcError("Could not delete show.", cause),
      ),
    );

  return ShowRepository.of({
    list: list.pipe(Effect.mapError((cause) => rpcError("Could not list shows.", cause))),
    findById,
    insert: (document) =>
      sql
        .withTransaction(insert(document))
        .pipe(Effect.mapError((cause) => rpcError("Could not create show.", cause))),
    update,
    delete: deleteShow,
  });
});

export const layerNoDeps = Layer.effect(ShowRepository, make());
export const layer = layerNoDeps;
