import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircleIcon, ListMusicIcon } from "lucide-react";
import type { ShowId } from "@showtime/contracts";
import { AsyncResult } from "effect/reactivity";
import { LiveSong } from "@/components/live/LiveSong";
import { LiveSongNavigation } from "@/components/live/LiveSongNavigation";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { microphoneAtoms } from "@/client";
import { isFailureWithoutValue } from "@/client";
import { mixAtoms } from "@/client";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { songAtoms } from "@/client";
import { projectLiveSong } from "@/client";

export const Route = createFileRoute("/live/$showId")({
  validateSearch: (search: Record<string, unknown>): { readonly song?: string } =>
    typeof search.song === "string" ? { song: search.song } : {},
  component: RouteComponent,
});

function RouteComponent() {
  const { showId } = Route.useParams();
  const { song: selectedSongId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const typedShowId = showId as ShowId;
  const songsAtom = songAtoms(typedShowId).songs;
  const mixesAtom = mixAtoms(typedShowId).mixes;
  const microphonesAtom = microphoneAtoms(typedShowId).microphones;
  const songsResult = useAtomValue(songsAtom);
  const mixesResult = useAtomValue(mixesAtom);
  const microphonesResult = useAtomValue(microphonesAtom);
  const refreshSongs = useAtomRefresh(songsAtom);
  const refreshMixes = useAtomRefresh(mixesAtom);
  const refreshMicrophones = useAtomRefresh(microphonesAtom);
  const songs = React.useMemo(
    () => AsyncResult.getOrElse(songsResult, () => []).filter((song) => !song.deletedAt),
    [songsResult],
  );
  const mixes = React.useMemo(() => AsyncResult.getOrElse(mixesResult, () => []), [mixesResult]);
  const microphones = React.useMemo(
    () => AsyncResult.getOrElse(microphonesResult, () => []),
    [microphonesResult],
  );
  const lastIndex = React.useRef(0);
  const selectedIndex = songs.findIndex((song) => song.id === selectedSongId);
  const recoveredIndex = songs.length === 0 ? -1 : Math.min(lastIndex.current, songs.length - 1);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : recoveredIndex;
  const currentSong = songs[currentIndex];

  React.useEffect(() => {
    if (selectedIndex >= 0) lastIndex.current = selectedIndex;
  }, [selectedIndex]);

  React.useEffect(() => {
    if (!currentSong || currentSong.id === selectedSongId) return;
    void navigate({ search: { song: currentSong.id }, replace: true });
  }, [currentSong, navigate, selectedSongId]);

  const selectSong = React.useCallback(
    (index: number) => {
      const song = songs[index];
      if (song) void navigate({ search: { song: song.id }, replace: true });
    },
    [navigate, songs],
  );
  const selectPreviousSong = React.useCallback(
    () => selectSong(currentIndex - 1),
    [currentIndex, selectSong],
  );
  const selectNextSong = React.useCallback(
    () => selectSong(currentIndex + 1),
    [currentIndex, selectSong],
  );

  if (
    AsyncResult.isInitial(songsResult) ||
    AsyncResult.isInitial(mixesResult) ||
    AsyncResult.isInitial(microphonesResult)
  ) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>Loading live data</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  if (
    isFailureWithoutValue(songsResult) ||
    isFailureWithoutValue(mixesResult) ||
    isFailureWithoutValue(microphonesResult)
  ) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertCircleIcon />
          </EmptyMedia>
          <EmptyTitle>Live data could not be loaded</EmptyTitle>
          <EmptyDescription>Check the connection and try again.</EmptyDescription>
        </EmptyHeader>
        <Button
          onClick={() => {
            refreshSongs();
            refreshMixes();
            refreshMicrophones();
          }}
        >
          Retry
        </Button>
      </Empty>
    );
  }
  if (!currentSong) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListMusicIcon />
          </EmptyMedia>
          <EmptyTitle>No songs in this setlist</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  const view = projectLiveSong(currentSong, currentIndex + 1, songs.length, mixes, microphones);
  const previous = songs[currentIndex - 1];
  const next = songs[currentIndex + 1];
  return (
    <React.Fragment>
      <LiveSong song={view} />
      <LiveSongNavigation
        previous={previous?.name}
        next={next?.name}
        onPrevious={selectPreviousSong}
        onNext={selectNextSong}
      />
    </React.Fragment>
  );
}
