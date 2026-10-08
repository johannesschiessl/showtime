import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { Exit } from "effect";
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GripVerticalIcon,
  ListMusicIcon,
} from "lucide-react";
import type { ShowId, SongArtist, SongId, SongName } from "@showtime/contracts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { songAtoms, songsRpcReactivityKey, type SongListItem } from "@/client";
import { rpcErrorMessageFromCause } from "@/client";

export const Route = createFileRoute("/shows/$showId/setlist/")({
  component: RouteComponent,
});

type DragPosition = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

type ActivePointer = {
  readonly id: SongId;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly offsetY: number;
  readonly rect: DOMRect;
  started: boolean;
};

function RouteComponent() {
  const { showId } = Route.useParams();
  const typedShowId = showId as ShowId;
  const result = useAtomValue(songAtoms(typedShowId).songs);
  const reorder = useAtomSet(songAtoms(typedShowId).reorder, { mode: "promiseExit" });
  const edit = useAtomSet(songAtoms(typedShowId).edit, { mode: "promiseExit" });
  const songs = AsyncResult.isSuccess(result) ? result.value : [];
  const [previewSongs, setPreviewSongs] = React.useState<ReadonlyArray<SongListItem>>(songs);
  const [draggedId, setDraggedId] = React.useState<SongId>();
  const [dragPosition, setDragPosition] = React.useState<DragPosition>();
  const [isReordering, setIsReordering] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState("");
  const [error, setError] = React.useState<string>();
  const songsRef = React.useRef(songs);
  const previewSongsRef = React.useRef(previewSongs);
  const activePointerRef = React.useRef<ActivePointer | undefined>(undefined);
  const rowRefs = React.useRef(new Map<SongId, HTMLDivElement>());

  songsRef.current = songs;
  previewSongsRef.current = previewSongs;

  React.useEffect(() => {
    if (!draggedId) {
      previewSongsRef.current = songs;
      setPreviewSongs(songs);
    }
  }, [songs, draggedId]);

  React.useEffect(
    () => () => {
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("cursor");
    },
    [],
  );

  const commitOrder = async (ordered: ReadonlyArray<SongListItem>, movedName: string) => {
    setIsReordering(true);
    setError(undefined);
    const mutation = await reorder({
      payload: { showId: typedShowId, orderedSongIds: ordered.map((song) => song.id) },
      reactivityKeys: songsRpcReactivityKey(typedShowId),
    });
    if (Exit.isFailure(mutation)) {
      const message = rpcErrorMessageFromCause(mutation.cause);
      setError(message);
      setAnnouncement(`Could not move ${movedName}. ${message}`);
      previewSongsRef.current = songsRef.current;
      setPreviewSongs(songsRef.current);
    }
    setIsReordering(false);
  };

  const move = (id: SongId, destination: number) => {
    const currentSongs = previewSongsRef.current;
    const current = currentSongs.findIndex((song) => song.id === id);
    if (current < 0 || current === destination || isReordering) return;
    const ordered = [...currentSongs];
    const [moved] = ordered.splice(current, 1);
    if (!moved) return;
    ordered.splice(destination, 0, moved);
    previewSongsRef.current = ordered;
    setPreviewSongs(ordered);
    setAnnouncement(`${moved.name || "Song"} moved to position ${destination + 1}.`);
    void commitOrder(ordered, moved.name || "song");
  };

  const previewAtPointer = (id: SongId, pointerY: number) => {
    const currentSongs = previewSongsRef.current;
    const withoutDragged = currentSongs.filter((song) => song.id !== id);
    let destination = withoutDragged.length;

    for (let index = 0; index < withoutDragged.length; index += 1) {
      const row = rowRefs.current.get(withoutDragged[index]!.id);
      if (!row) continue;
      const rect = row.getBoundingClientRect();
      if (pointerY < rect.top + rect.height / 2) {
        destination = index;
        break;
      }
    }

    const dragged = currentSongs.find((song) => song.id === id);
    if (!dragged || currentSongs[destination]?.id === id) return;
    const ordered = [...withoutDragged];
    ordered.splice(destination, 0, dragged);
    previewSongsRef.current = ordered;
    setPreviewSongs(ordered);
  };

  const startPointer = (event: React.PointerEvent<HTMLDivElement>, song: SongListItem) => {
    if (event.button !== 0 || isReordering || song.pending) return;

    const card = event.currentTarget.closest<HTMLElement>("[data-song-card]");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    activePointerRef.current = {
      id: song.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetY: event.clientY - rect.top,
      rect,
      started: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updatePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = activePointerRef.current;
    if (!active || active.pointerId !== event.pointerId) return;

    if (!active.started) {
      if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 4) return;
      active.started = true;
      previewSongsRef.current = songsRef.current;
      setPreviewSongs(songsRef.current);
      setDraggedId(active.id);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    }

    event.preventDefault();
    setDragPosition({
      left: active.rect.left,
      top: event.clientY - active.offsetY,
      width: active.rect.width,
      height: active.rect.height,
    });
    previewAtPointer(active.id, event.clientY);

    const edgeSize = 72;
    if (event.clientY < edgeSize) window.scrollBy(0, -Math.ceil((edgeSize - event.clientY) / 6));
    if (event.clientY > window.innerHeight - edgeSize) {
      window.scrollBy(0, Math.ceil((event.clientY - window.innerHeight + edgeSize) / 6));
    }
  };

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const active = activePointerRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    activePointerRef.current = undefined;
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");

    if (active.started) {
      const ordered = previewSongsRef.current;
      const moved = ordered.find((song) => song.id === active.id);
      const changed = ordered.some((song, index) => song.id !== songsRef.current[index]?.id);
      setDraggedId(undefined);
      setDragPosition(undefined);
      if (cancelled) {
        previewSongsRef.current = songsRef.current;
        setPreviewSongs(songsRef.current);
      } else if (moved && changed) {
        const destination = ordered.findIndex((song) => song.id === active.id);
        setAnnouncement(`${moved.name || "Song"} moved to position ${destination + 1}.`);
        void commitOrder(ordered, moved.name || "song");
      }
    }
  };

  const saveSong = async (song: SongListItem, name: string, artist: string) => {
    setError(undefined);
    const mutation = await edit({
      payload: {
        showId: typedShowId,
        id: song.id,
        name: name.trim() as SongName,
        artist: artist.trim() as SongArtist,
        notes: song.notes,
        mixAssignments: song.mixAssignments,
        microphoneNames: song.microphoneNames ?? [],
        mixNames: song.mixNames ?? [],
      },
      reactivityKeys: songsRpcReactivityKey(typedShowId),
    });
    if (Exit.isFailure(mutation)) {
      const message = rpcErrorMessageFromCause(mutation.cause);
      setError(message);
      setAnnouncement(`Could not update ${song.name || "song"}. ${message}`);
      return false;
    }
    setAnnouncement(`${name.trim() || "Song"} updated.`);
    return true;
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {AsyncResult.isInitial(result) ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Spinner />
            </EmptyMedia>
            <EmptyTitle>Loading songs</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : AsyncResult.isFailure(result) && songs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertCircleIcon />
            </EmptyMedia>
            <EmptyTitle>Songs could not be loaded</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : songs.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListMusicIcon />
            </EmptyMedia>
            <EmptyTitle>No songs yet</EmptyTitle>
            <EmptyDescription>Add the first song to start building the setlist.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl ring-1 ring-foreground/10">
          {previewSongs.map((song, index) => {
            const isDragged = song.id === draggedId;
            return (
              <div
                key={song.id}
                ref={(node) => {
                  if (node) rowRefs.current.set(song.id, node);
                  else rowRefs.current.delete(song.id);
                }}
                className={`min-h-16 border-b last:border-b-0 ${isDragged ? "bg-muted/50" : ""}`}
              >
                <div
                  data-song-card
                  onPointerMove={updatePointer}
                  onPointerUp={finishPointer}
                  onPointerCancel={(event) => finishPointer(event, true)}
                  className={`group relative flex min-h-16 items-center gap-2 bg-background px-2 transition-shadow hover:bg-accent/50 ${
                    isDragged
                      ? "z-50 cursor-grabbing rounded-xl bg-background shadow-xl ring-1 ring-foreground/15"
                      : ""
                  }`}
                  style={
                    isDragged && dragPosition ? { position: "fixed", ...dragPosition } : undefined
                  }
                >
                  <Link
                    to="/shows/$showId/setlist/$songId"
                    params={{ showId, songId: song.id }}
                    aria-label={`Open ${song.name || "song"}`}
                    className="absolute inset-0 z-0 rounded-[inherit] outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                  />
                  <div
                    className="relative z-10 shrink-0 touch-none cursor-grab active:cursor-grabbing"
                    onPointerDown={(event) => startPointer(event, song)}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={isReordering || song.pending}
                      aria-label={`Drag ${song.name || "song"} to reorder`}
                    >
                      <GripVerticalIcon />
                    </Button>
                  </div>
                  <span className="pointer-events-none relative z-10 flex size-8 shrink-0 items-center justify-center rounded-md bg-neutral-700 text-sm font-bold text-neutral-300">
                    {index + 1}
                  </span>
                  <InlineSongFields song={song} onSave={saveSong} />
                  <div className="relative z-10 ml-auto flex shrink-0 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={index === 0 || isReordering || song.pending}
                      aria-label={`Move ${song.name || "song"} up`}
                      onClick={() => move(song.id, index - 1)}
                    >
                      <ChevronUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={index === songs.length - 1 || isReordering || song.pending}
                      aria-label={`Move ${song.name || "song"} down`}
                      onClick={() => move(song.id, index + 1)}
                    >
                      <ChevronDownIcon />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function InlineSongFields({
  song,
  onSave,
}: {
  readonly song: SongListItem;
  readonly onSave: (song: SongListItem, name: string, artist: string) => Promise<boolean>;
}) {
  const [name, setName] = React.useState(song.name as string);
  const [artist, setArtist] = React.useState(song.artist as string);
  const [isSaving, setIsSaving] = React.useState(false);
  const nameFocusedRef = React.useRef(false);
  const artistFocusedRef = React.useRef(false);
  const cancelNameBlurSaveRef = React.useRef(false);
  const cancelArtistBlurSaveRef = React.useRef(false);

  React.useEffect(() => {
    if (!nameFocusedRef.current) setName(song.name);
    if (!artistFocusedRef.current) setArtist(song.artist);
  }, [song.name, song.artist]);

  const save = async () => {
    const nextName = name.trim();
    const nextArtist = artist.trim();
    setName(nextName);
    setArtist(nextArtist);
    if (nextName === song.name && nextArtist === song.artist) return;
    setIsSaving(true);
    const saved = await onSave(song, nextName, nextArtist);
    setIsSaving(false);
    if (!saved) {
      setName(song.name);
      setArtist(song.artist);
    }
  };

  return (
    <div className="pointer-events-none relative z-10 flex min-w-0 shrink flex-col items-start gap-1 py-2 sm:flex-row sm:items-center sm:gap-2 sm:py-0">
      <Input
        value={name}
        disabled={song.pending || isSaving}
        aria-label={`Song name for ${song.name || "new song"}`}
        placeholder="Song name"
        className="pointer-events-auto w-auto max-w-full border-transparent bg-transparent shadow-none [field-sizing:content] focus-visible:bg-input/30 disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent dark:focus-visible:bg-input/30"
        onFocus={() => {
          nameFocusedRef.current = true;
          cancelNameBlurSaveRef.current = false;
        }}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          nameFocusedRef.current = false;
          if (cancelNameBlurSaveRef.current) {
            cancelNameBlurSaveRef.current = false;
            return;
          }
          void save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelNameBlurSaveRef.current = true;
            setName(song.name);
            event.currentTarget.blur();
          }
        }}
      />
      {song.artist !== "" && (
        <Badge variant="outline" className="pointer-events-auto">
          <Input
            value={artist}
            disabled={song.pending || isSaving}
            aria-label={`Artist for ${song.name || "new song"}`}
            placeholder="Artist"
            className="h-auto min-w-0 max-w-full w-auto border-0 bg-transparent p-0 leading-none shadow-none [field-sizing:content] focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 dark:bg-transparent dark:disabled:bg-transparent"
            onFocus={() => {
              artistFocusedRef.current = true;
              cancelArtistBlurSaveRef.current = false;
            }}
            onChange={(event) => setArtist(event.target.value)}
            onBlur={() => {
              artistFocusedRef.current = false;
              if (cancelArtistBlurSaveRef.current) {
                cancelArtistBlurSaveRef.current = false;
                return;
              }
              void save();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                cancelArtistBlurSaveRef.current = true;
                setArtist(song.artist);
                event.currentTarget.blur();
              }
            }}
          />
        </Badge>
      )}
    </div>
  );
}
