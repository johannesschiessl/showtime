import * as React from "react";
import { Exit } from "effect";
import { useNavigate } from "@tanstack/react-router";
import {
  makeClientId,
  songIdPrefix,
  type ShowId,
  type SongArtist,
  type SongId,
  type SongName,
} from "@showtime/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useRpcMutation } from "@/hooks/useRpcMutation";
import { rpcErrorMessageFromCause, songAtoms, songsRpcReactivityKey } from "@/client";
import { createdSongHandoff } from "./CreatedSongHandoff";

export function useCreateSong(showId: ShowId, insertAfterSongId?: SongId) {
  const navigate = useNavigate();
  const songsSnapshot = useAtomValue(songAtoms(showId).syncedSongs);
  const create = useRpcMutation(songAtoms(showId).create);
  const [isCreating, setIsCreating] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const createSong = async () => {
    if (isCreating) return;
    const baselineSnapshot = songsSnapshot;
    setIsCreating(true);
    setError(undefined);
    const id = makeClientId(songIdPrefix) as SongId;
    const result = await create({
      payload: {
        showId,
        id,
        name: "" as SongName,
        artist: "" as SongArtist,
        insertAfterSongId,
      },
      reactivityKeys: songsRpcReactivityKey(showId),
    });
    if (Exit.isFailure(result)) {
      setError(rpcErrorMessageFromCause(result.cause));
      setIsCreating(false);
      return;
    }
    createdSongHandoff.remember(showId, result.value, insertAfterSongId, baselineSnapshot);
    try {
      await navigate({
        to: "/shows/$showId/setlist/$songId",
        params: { showId, songId: result.value.id },
      });
    } catch {
      setError("The song was added, but its page could not be opened. Open it from the setlist.");
    }
    setIsCreating(false);
  };

  return { createSong, isCreating, error } as const;
}
