import * as React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { Exit, Option } from "effect";
import { AlertCircleIcon, EllipsisIcon, MusicIcon, Trash2Icon } from "lucide-react";
import {
  mainMixId,
  type Microphone,
  type MicrophoneId,
  type Mix,
  type ShowId,
  type Song,
  type SongArtist,
  type SongId,
  type SongMixName,
  type SongMicrophoneName,
  type SongMixAssignment,
  type SongName,
} from "@showtime/contracts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { microphoneColorClassNames } from "@/components/microphones/microphone-color";
import { cn } from "@/lib/utils";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { mixAtoms, type MixListItem } from "@/client";
import { microphoneAtoms } from "@/client";
import { songAtoms, songsRpcReactivityKey } from "@/client";
import { asyncResultValueOrElse, rpcErrorMessageFromCause } from "@/client";
import { createdSongHandoff } from "@/components/songs/CreatedSongHandoff";

export const Route = createFileRoute("/shows/$showId/setlist/$songId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { showId, songId } = Route.useParams();
  const typedShowId = showId as ShowId;
  const songsResult = useAtomValue(songAtoms(typedShowId).songs);
  const mixesResult = useAtomValue(mixAtoms(typedShowId).mixes);
  const microphonesResult = useAtomValue(microphoneAtoms(typedShowId).microphones);
  const songs = asyncResultValueOrElse(songsResult, () => []);
  const songIndex = songs.findIndex((song) => song.id === songId);
  const song = songs[songIndex] ?? createdSongHandoff.find(typedShowId, songId as SongId);
  const songNumber =
    songIndex >= 0
      ? songIndex + 1
      : createdSongHandoff.provisionalNumber(typedShowId, songId as SongId, songs);
  const mixes = asyncResultValueOrElse(mixesResult, () => []);
  const microphones = asyncResultValueOrElse(microphonesResult, () => []);
  const hasMixes = Option.isSome(AsyncResult.value(mixesResult));
  const hasMicrophones = Option.isSome(AsyncResult.value(microphonesResult));

  if (AsyncResult.isInitial(songsResult) && !song) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>Loading song</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  if (AsyncResult.isFailure(songsResult) && songs.length === 0 && !song) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertCircleIcon />
          </EmptyMedia>
          <EmptyTitle>Song could not be loaded</EmptyTitle>
          <EmptyDescription>Check your connection and try again.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (!song) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertCircleIcon />
          </EmptyMedia>
          <EmptyTitle>Song not found</EmptyTitle>
          <EmptyDescription>It may have been removed from the setlist.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (!hasMixes || !hasMicrophones) {
    const failed =
      (AsyncResult.isFailure(mixesResult) && !hasMixes) ||
      (AsyncResult.isFailure(microphonesResult) && !hasMicrophones);
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">{failed ? <AlertCircleIcon /> : <Spinner />}</EmptyMedia>
          <EmptyTitle>
            {failed ? "Song details could not be loaded" : "Loading song details"}
          </EmptyTitle>
          {failed && <EmptyDescription>Check your connection and try again.</EmptyDescription>}
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <SongDetail
      showId={typedShowId}
      song={song}
      number={songNumber}
      mixes={mixes}
      microphones={microphones}
    />
  );
}

function SongDetail({
  showId,
  song,
  number,
  mixes,
  microphones,
}: {
  readonly showId: ShowId;
  readonly song: Song;
  readonly number: number;
  readonly mixes: ReadonlyArray<MixListItem>;
  readonly microphones: ReadonlyArray<Microphone>;
}) {
  const edit = useAtomSet(songAtoms(showId).edit, { mode: "promiseExit" });
  const [name, setName] = React.useState(song.name as string);
  const [artist, setArtist] = React.useState(song.artist as string);
  const [notes, setNotes] = React.useState(song.notes ?? "");
  const [assignments, setAssignments] = React.useState<ReadonlyArray<SongMixAssignment>>(
    song.mixAssignments,
  );
  const [microphoneNames, setMicrophoneNames] = React.useState<ReadonlyArray<SongMicrophoneName>>(
    song.microphoneNames ?? [],
  );
  const [mixNames, setMixNames] = React.useState<ReadonlyArray<SongMixName>>(song.mixNames ?? []);
  const [isSaving, setIsSaving] = React.useState(false);
  const isSavingRef = React.useRef(false);
  const queuedSaveCountRef = React.useRef(0);
  const preserveDraftRef = React.useRef(false);
  const saveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const draftRef = React.useRef({
    name: song.name as string,
    artist: song.artist as string,
    notes: song.notes ?? "",
    assignments: song.mixAssignments,
    microphoneNames: song.microphoneNames ?? [],
    mixNames: song.mixNames ?? [],
  });
  const [saveError, setSaveError] = React.useState<string>();
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const notesRef = React.useRef<HTMLTextAreaElement>(null);
  const orderedMixes = [...mixes].sort(
    (left, right) => Number(right.id === mainMixId) - Number(left.id === mainMixId),
  );
  const hasUnpairedMix = orderedMixes.filter((mix) => mix.id !== mainMixId).length % 2 === 1;

  React.useEffect(() => {
    if (queuedSaveCountRef.current > 0 || preserveDraftRef.current) return;
    draftRef.current = {
      name: song.name,
      artist: song.artist,
      notes: song.notes ?? "",
      assignments: song.mixAssignments,
      microphoneNames: song.microphoneNames ?? [],
      mixNames: song.mixNames ?? [],
    };
    setName(song.name);
    setArtist(song.artist);
    setNotes(song.notes ?? "");
    setAssignments(song.mixAssignments);
    setMicrophoneNames(song.microphoneNames ?? []);
    setMixNames(song.mixNames ?? []);
  }, [song]);

  React.useLayoutEffect(() => {
    const textarea = notesRef.current;
    if (!textarea) return;

    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight);
    const verticalChrome =
      Number.parseFloat(styles.paddingTop) +
      Number.parseFloat(styles.paddingBottom) +
      Number.parseFloat(styles.borderTopWidth) +
      Number.parseFloat(styles.borderBottomWidth);
    const maxHeight = lineHeight * 6 + verticalChrome;

    textarea.style.maxHeight = `${maxHeight}px`;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [notes]);

  const save = async (
    next?: {
      readonly name?: string;
      readonly artist?: string;
      readonly notes?: string;
      readonly assignments?: ReadonlyArray<SongMixAssignment>;
      readonly microphoneNames?: ReadonlyArray<SongMicrophoneName>;
      readonly mixNames?: ReadonlyArray<SongMixName>;
    },
    blockUi = true,
  ) => {
    if (blockUi && isSavingRef.current) return false;
    const draft = { ...draftRef.current, ...next };
    const activeMixIds = new Set(mixes.filter((mix) => !mix.pending).map((mix) => mix.id));
    const activeMicrophoneIds = new Set(microphones.map((microphone) => microphone.id));
    const normalizedAssignments = draft.assignments.flatMap((assignment) => {
      if (!activeMixIds.has(assignment.mixId)) return [];
      const microphoneIds = assignment.microphoneIds.filter((id) => activeMicrophoneIds.has(id));
      return microphoneIds.length > 0 ? [{ ...assignment, microphoneIds }] : [];
    });
    const normalizedMicrophoneNames = draft.microphoneNames.filter((item) =>
      activeMicrophoneIds.has(item.microphoneId),
    );
    const normalizedMixNames = draft.mixNames.filter((item) => activeMixIds.has(item.mixId));
    const normalizedDraft = {
      ...draft,
      name: draft.name.trim(),
      artist: draft.artist.trim(),
      assignments: normalizedAssignments,
      microphoneNames: normalizedMicrophoneNames,
      mixNames: normalizedMixNames,
    };
    draftRef.current = normalizedDraft;
    queuedSaveCountRef.current += 1;

    const run = async () => {
      if (blockUi) {
        isSavingRef.current = true;
        setIsSaving(true);
      }
      setSaveError(undefined);
      const result = await edit({
        payload: {
          showId,
          id: song.id,
          name: normalizedDraft.name as SongName,
          artist: normalizedDraft.artist as SongArtist,
          notes: normalizedDraft.notes,
          mixAssignments: normalizedDraft.assignments,
          microphoneNames: normalizedDraft.microphoneNames,
          mixNames: normalizedDraft.mixNames,
        },
        reactivityKeys: songsRpcReactivityKey(showId),
      });
      if (blockUi) {
        isSavingRef.current = false;
        setIsSaving(false);
      }
      if (Exit.isFailure(result)) {
        preserveDraftRef.current = true;
        setSaveError(rpcErrorMessageFromCause(result.cause));
        return false;
      }
      preserveDraftRef.current = false;
      return true;
    };

    const result = saveQueueRef.current.then(run, run);
    saveQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      queuedSaveCountRef.current -= 1;
    });
  };

  const toggleMicrophone = (mixId: Mix["id"], microphoneId: MicrophoneId) => {
    if (isSavingRef.current) return;
    const currentAssignments = draftRef.current.assignments;
    const existing = currentAssignments.find((assignment) => assignment.mixId === mixId);
    const selected = new Set(existing?.microphoneIds ?? []);
    if (selected.has(microphoneId)) {
      selected.delete(microphoneId);
    } else {
      selected.add(microphoneId);
    }
    const microphoneIds = microphones
      .filter((microphone) => selected.has(microphone.id))
      .map((microphone) => microphone.id);
    const next = [
      ...currentAssignments.filter((assignment) => assignment.mixId !== mixId),
      ...(microphoneIds.length ? [{ mixId, microphoneIds }] : []),
    ];
    setAssignments(next);
    void save({ assignments: next });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex items-start gap-2 pb-2 sm:gap-3 sm:pb-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-neutral-700 text-lg font-bold leading-none text-neutral-300">
          {number}
        </div>
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
            <Input
              aria-label="Song name"
              placeholder="New song"
              value={name}
              disabled={isSaving}
              onChange={(event) => {
                const value = event.currentTarget.value;
                draftRef.current = { ...draftRef.current, name: value };
                setName(value);
              }}
              onBlur={() => {
                if (name.trim() !== song.name) void save({ name });
              }}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              className="h-auto w-full min-w-0 max-w-full border-transparent bg-transparent px-2 py-1 text-xl font-semibold shadow-none focus-visible:bg-input/30 disabled:bg-transparent disabled:opacity-100 sm:w-auto sm:shrink sm:text-2xl sm:[field-sizing:content] dark:bg-transparent dark:disabled:bg-transparent dark:focus-visible:bg-input/30"
            />
            <Badge
              variant="outline"
              className="ml-2 min-w-0 max-w-[calc(100%-0.5rem)] shrink sm:ml-0 sm:max-w-64"
            >
              <Input
                aria-label="Artist"
                placeholder="Artist"
                value={artist}
                disabled={isSaving}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  draftRef.current = { ...draftRef.current, artist: value };
                  setArtist(value);
                }}
                onBlur={() => {
                  if (artist.trim() !== song.artist) void save({ artist });
                }}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                className="h-auto min-w-0 max-w-full w-auto border-0 bg-transparent p-0 text-base leading-none shadow-none [field-sizing:content] focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 dark:bg-transparent dark:disabled:bg-transparent"
              />
            </Badge>
          </div>
          <Textarea
            ref={notesRef}
            aria-label="Song notes"
            value={notes}
            disabled={isSaving}
            placeholder="Notes"
            rows={1}
            onChange={(event) => {
              const value = event.currentTarget.value;
              draftRef.current = { ...draftRef.current, notes: value };
              setNotes(value);
            }}
            onBlur={() => {
              if (notes.trim() !== (song.notes ?? "")) void save({ notes });
            }}
            className="min-h-0 resize-none overflow-y-auto border-transparent bg-transparent shadow-none focus-visible:bg-input/30 disabled:bg-transparent disabled:opacity-100 dark:bg-transparent dark:disabled:bg-transparent dark:focus-visible:bg-input/30"
          />
          {saveError && (
            <p role="alert" className="px-2 text-xs text-destructive">
              {saveError}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" aria-label="Song actions" />}
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2Icon /> Delete song
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Tabs defaultValue="mixes">
        <TabsList variant="line">
          <TabsTrigger value="mixes">Mixes</TabsTrigger>
        </TabsList>
        <TabsContent value="mixes">
          {mixes.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MusicIcon />
                </EmptyMedia>
                <EmptyTitle>No mixes available</EmptyTitle>
                <EmptyDescription>Add a mix before assigning microphones.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {orderedMixes.map((mix, index) => {
                const assignment = assignments.find((assignment) => assignment.mixId === mix.id);
                const selected = new Set(assignment?.microphoneIds ?? []);
                return (
                  <Card
                    key={mix.id}
                    className={cn(
                      (mix.id === mainMixId ||
                        (hasUnpairedMix && index === orderedMixes.length - 1)) &&
                        "md:col-span-2",
                    )}
                  >
                    <CardHeader className="items-center gap-x-3">
                      <CardAction>
                        <Badge variant="outline">
                          {selected.size} {selected.size === 1 ? "mic" : "mics"} on
                        </Badge>
                      </CardAction>
                      <CardTitle className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-md font-bold",
                            microphoneColorClassNames[mix.color].background,
                            microphoneColorClassNames[mix.color].text,
                          )}
                        >
                          {mix.number}
                        </span>
                        <ChannelNameEditor
                          displayedName={
                            mixNames.find((item) => item.mixId === mix.id)?.name ?? mix.name ?? ""
                          }
                          placeholder={mix.id === mainMixId ? "Main mix" : "Add name"}
                          ariaLabel={`Name override for mix ${mix.number}`}
                          disabled={isSaving || mix.pending === true}
                          inputClassName="min-w-0 pl-1 pr-2.5 text-left"
                          persistentInput
                          onSave={(value) => {
                            const trimmed = value.trim();
                            const override =
                              trimmed && trimmed !== (mix.name?.trim() ?? "") ? trimmed : undefined;
                            const nextMixNames = [
                              ...draftRef.current.mixNames.filter((item) => item.mixId !== mix.id),
                              ...(override ? [{ mixId: mix.id, name: override }] : []),
                            ];
                            setMixNames(nextMixNames);
                            void save({ mixNames: nextMixNames }, false);
                          }}
                        />
                        {mix.id === mainMixId && <Badge>Main mix</Badge>}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-[repeat(auto-fill,7rem)]">
                      {microphones.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No microphones available.</p>
                      ) : (
                        microphones.map((microphone) => {
                          const active = selected.has(microphone.id);
                          const colors = microphoneColorClassNames[microphone.color];
                          return (
                            <div
                              key={microphone.id}
                              role="button"
                              tabIndex={0}
                              aria-pressed={active}
                              onClick={() => toggleMicrophone(mix.id, microphone.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  toggleMicrophone(mix.id, microphone.id);
                                }
                              }}
                              className={cn(
                                "flex h-20 w-full min-w-0 flex-col items-center justify-center gap-1 rounded-lg border bg-muted/50 px-2 py-2 text-center text-foreground outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 min-[480px]:w-28 min-[480px]:px-3",
                                !active && "hover:bg-muted",
                                active && colors.background,
                                active && colors.text,
                                active && colors.border,
                                active && "border-2",
                              )}
                            >
                              <span className={cn("text-lg font-bold", !active && colors.text)}>
                                {microphone.number}
                              </span>
                              <MicrophoneName
                                microphone={microphone}
                                microphoneNames={microphoneNames}
                                disabled={isSaving}
                                onSave={(value) => {
                                  const trimmed = value.trim();
                                  const override =
                                    trimmed && trimmed !== (microphone.name?.trim() ?? "")
                                      ? trimmed
                                      : undefined;
                                  const nextMicrophoneNames = [
                                    ...draftRef.current.microphoneNames.filter(
                                      (item) => item.microphoneId !== microphone.id,
                                    ),
                                    ...(override
                                      ? [{ microphoneId: microphone.id, name: override }]
                                      : []),
                                  ];
                                  setMicrophoneNames(nextMicrophoneNames);
                                  void save({ microphoneNames: nextMicrophoneNames }, false);
                                }}
                              />
                            </div>
                          );
                        })
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
      <SongDeleteDialog
        showId={showId}
        songId={song.id}
        songName={song.name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  );
}

function MicrophoneName({
  microphone,
  microphoneNames,
  disabled,
  onSave,
}: {
  readonly microphone: Microphone;
  readonly microphoneNames: ReadonlyArray<SongMicrophoneName>;
  readonly disabled: boolean;
  readonly onSave: (value: string) => void;
}) {
  const inheritedName = microphone.name ?? "";
  const displayedName =
    microphoneNames.find((item) => item.microphoneId === microphone.id)?.name ?? inheritedName;
  return (
    <ChannelNameEditor
      displayedName={displayedName}
      placeholder="Add name"
      ariaLabel={`Name override for microphone ${microphone.number}`}
      disabled={disabled}
      className="w-full truncate text-center text-sm"
      inputClassName="w-full text-center"
      onSave={onSave}
      stopPropagation
    />
  );
}

function ChannelNameEditor({
  displayedName,
  placeholder,
  ariaLabel,
  disabled,
  className,
  inputClassName,
  onSave,
  stopPropagation = false,
  persistentInput = false,
}: {
  readonly displayedName: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly className?: string;
  readonly inputClassName?: string;
  readonly onSave: (value: string) => void;
  readonly stopPropagation?: boolean;
  readonly persistentInput?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(displayedName);
  const cancelSaveRef = React.useRef(false);

  React.useEffect(() => setValue(displayedName), [displayedName]);

  if (!editing && !persistentInput) {
    return (
      <button
        type="button"
        className={cn("block font-medium", className)}
        disabled={disabled}
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation();
          setValue(displayedName);
          setEditing(true);
        }}
        onKeyDown={(event) => stopPropagation && event.stopPropagation()}
      >
        {displayedName || placeholder}
      </button>
    );
  }

  return (
    <Input
      autoFocus={!persistentInput}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onFocus={() => {
        cancelSaveRef.current = false;
        setEditing(true);
      }}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={() => {
        setEditing(false);
        if (!cancelSaveRef.current && value.trim() !== displayedName) onSave(value);
        cancelSaveRef.current = false;
      }}
      onKeyDown={(event) => {
        if (stopPropagation) event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelSaveRef.current = true;
          setValue(displayedName);
          event.currentTarget.blur();
        }
      }}
      onClick={(event) => stopPropagation && event.stopPropagation()}
      className={cn(
        "h-auto min-w-0 text-base leading-none font-medium",
        persistentInput
          ? "border-transparent bg-transparent shadow-none focus-visible:bg-input/30 dark:bg-transparent dark:focus-visible:bg-input/30"
          : "border-transparent bg-transparent p-0 shadow-none focus-visible:bg-input/30 focus-visible:ring-0 dark:bg-transparent dark:focus-visible:bg-input/30",
        inputClassName,
      )}
    />
  );
}

function SongDeleteDialog({
  showId,
  songId,
  songName,
  open,
  onOpenChange,
}: {
  readonly showId: ShowId;
  readonly songId: SongId;
  readonly songName: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const deleteSong = useAtomSet(songAtoms(showId).delete, { mode: "promiseExit" });
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [error, setError] = React.useState<string>();
  React.useEffect(() => {
    if (open) {
      setIsDeleting(false);
      setError(undefined);
    }
  }, [open]);
  const confirm = async () => {
    setIsDeleting(true);
    const result = await deleteSong({
      payload: { showId, id: songId },
      reactivityKeys: songsRpcReactivityKey(showId),
    });
    if (Exit.isFailure(result)) {
      setError(rpcErrorMessageFromCause(result.cause));
      setIsDeleting(false);
      return;
    }
    createdSongHandoff.forget(showId, songId);
    onOpenChange(false);
    void navigate({ to: "/shows/$showId/setlist", params: { showId } });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete song?</DialogTitle>
          <DialogDescription>
            “{songName}” will be removed from the active setlist.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={isDeleting} />}>
            Cancel
          </DialogClose>
          <Button variant="destructive" disabled={isDeleting} onClick={confirm}>
            <Trash2Icon /> {isDeleting ? "Deleting..." : "Delete song"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
