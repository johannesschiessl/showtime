import { DateTime, Option } from "effect";
import { Atom, AsyncResult } from "effect/reactivity";
import { insertSongAfter, type ShowId, type Song } from "@showtime/contracts";
import type { ShowtimeRpcClient } from "../rpc/RpcClient.js";
import { latestSnapshot } from "../rpc/LatestSnapshot.js";
import type { StreamingRpcOptions } from "../rpc/StreamingRpcOptions.js";

export type SongListItem = Song & { readonly pending?: boolean };
type MutationInput<T> = T extends Atom.AtomResultFn<infer Arg, infer _A, infer _E> ? Arg : never;
export const makeSongAtoms = (RpcClient: ShowtimeRpcClient, options?: StreamingRpcOptions) => {
  const createSongMutation = RpcClient.mutation("songs.create");
  const deleteSongMutation = RpcClient.mutation("songs.delete");
  const reorderSongsMutation = RpcClient.mutation("songs.reorder");
  const editSongMutation = RpcClient.mutation("songs.edit");

  const songAtoms = Atom.family((showId: ShowId) => {
    const query = latestSnapshot(RpcClient.query("songs.list", { showId }), options);
    const songs = query.pipe(Atom.optimistic);
    const create = songs.pipe(
      Atom.optimisticFn({
        reducer: (current, input: MutationInput<typeof createSongMutation>) => {
          if (!AsyncResult.isSuccess(current)) return current;
          const now = DateTime.nowUnsafe();
          const song: SongListItem = {
            id: input.payload.id,
            name: input.payload.name.trim() as Song["name"],
            artist: input.payload.artist.trim() as Song["artist"],
            mixAssignments: [],
            createdAt: now,
            updatedAt: now,
            pending: true,
          };
          const inserted = insertSongAfter(current.value, song, input.payload.insertAfterSongId);
          return Option.isSome(inserted) ? AsyncResult.success(inserted.value) : current;
        },
        fn: createSongMutation,
      }),
    );
    const deleteSong = songs.pipe(
      Atom.optimisticFn({
        reducer: (current, input: MutationInput<typeof deleteSongMutation>) =>
          AsyncResult.isSuccess(current)
            ? AsyncResult.success(current.value.filter((song) => song.id !== input.payload.id))
            : current,
        fn: deleteSongMutation,
      }),
    );
    const edit = songs.pipe(
      Atom.optimisticFn({
        reducer: (current, input: MutationInput<typeof editSongMutation>) => {
          if (!AsyncResult.isSuccess(current)) return current;
          const notes = input.payload.notes?.trim();
          const updatedAt = DateTime.nowUnsafe();
          return AsyncResult.success(
            current.value.map((song) =>
              song.id === input.payload.id
                ? {
                    ...song,
                    name: input.payload.name.trim() as Song["name"],
                    artist: input.payload.artist.trim() as Song["artist"],
                    mixAssignments: input.payload.mixAssignments,
                    microphoneNames: input.payload.microphoneNames,
                    mixNames: input.payload.mixNames,
                    updatedAt,
                    ...(notes ? { notes } : { notes: undefined }),
                  }
                : song,
            ),
          );
        },
        fn: editSongMutation,
      }),
    );
    const reorder = songs.pipe(
      Atom.optimisticFn({
        reducer: (current, input: MutationInput<typeof reorderSongsMutation>) => {
          if (!AsyncResult.isSuccess(current)) return current;
          const byId = new Map(current.value.map((song) => [song.id, song]));
          const orderedIds = new Set(input.payload.orderedSongIds);
          return AsyncResult.success([
            ...input.payload.orderedSongIds.flatMap((id) => {
              const song = byId.get(id);
              return song ? [song] : [];
            }),
            ...current.value.filter((song) => !orderedIds.has(song.id)),
          ]);
        },
        fn: reorderSongsMutation,
      }),
    );
    return { syncedSongs: query, songs, create, edit, delete: deleteSong, reorder } as const;
  });

  return { songAtoms } as const;
};
