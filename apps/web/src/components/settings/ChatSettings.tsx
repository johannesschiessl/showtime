import * as React from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Exit, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  chatsSyncKey,
  type ChatChannel,
  type ChatChannelName,
  type ChatSnapshot,
  type Profile,
  type ProfileId,
  type ShowId,
} from "@showtime/contracts";
import { BellIcon, BellOffIcon, Trash2Icon } from "lucide-react";
import { chatAtoms, profileAtoms, rpcErrorMessageFromCause } from "@/client";
import { ProfileAvatar } from "@/components/profiles/ProfileAvatar";
import { NewChatChannelInput } from "@/components/chats/NewChatChannelInput";
import { currentProfilesState } from "@/components/profiles/ProfileSwitcher";
import { SettingsHeader, SettingsItem, SettingsSection } from "@/components/settings/SettingsPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent } from "@/components/ui/item";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useShowFromParams } from "@/hooks/useShowFromParams";

const currentChatSnapshot = (
  result: AsyncResult.AsyncResult<ChatSnapshot, unknown>,
): ChatSnapshot | undefined =>
  AsyncResult.isSuccess(result)
    ? result.value
    : AsyncResult.isFailure(result)
      ? Option.getOrUndefined(result.previousSuccess)?.value
      : undefined;

export function ChatSettings() {
  const { showId } = useShowFromParams();
  const profilesResult = useAtomValue(profileAtoms.state);
  const profilesState = currentProfilesState(profilesResult);

  return (
    <div className="space-y-6">
      <SettingsHeader>Chat</SettingsHeader>
      {showId && profilesState && profilesState.profiles.length > 0 ? (
        <ChatSettingsLoaded showId={showId as ShowId} profiles={profilesState.profiles} />
      ) : (
        <SettingsSection title="Channels">
          <SettingsItem title="Loading chat settings…" />
        </SettingsSection>
      )}
    </div>
  );
}

function ChatSettingsLoaded({
  showId,
  profiles,
}: {
  readonly showId: ShowId;
  readonly profiles: ReadonlyArray<Profile>;
}) {
  const ownerProfile = profiles[0]!;
  const atoms = chatAtoms(showId, ownerProfile.id);
  const result = useAtomValue(atoms.state);
  const snapshot = currentChatSnapshot(result);
  const createChannel = useAtomSet(atoms.createChannel, { mode: "promiseExit" });
  const deleteChannel = useAtomSet(atoms.deleteChannel, { mode: "promiseExit" });
  const [newName, setNewName] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<ChatChannel>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const mutationOptions = { reactivityKeys: chatsSyncKey(showId) } as const;
  const channels = snapshot?.channels ?? [];

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(undefined);
    const exit = await createChannel({
      payload: { showId, name: name as ChatChannelName },
      ...mutationOptions,
    });
    if (Exit.isFailure(exit)) setError(rpcErrorMessageFromCause(exit.cause));
    else setNewName("");
    setBusy(false);
  };

  const remove = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setError(undefined);
    const exit = await deleteChannel({
      payload: { showId, channelId: deleteTarget.id },
      ...mutationOptions,
    });
    if (Exit.isFailure(exit)) setError(rpcErrorMessageFromCause(exit.cause));
    else setDeleteTarget(undefined);
    setBusy(false);
  };

  return (
    <>
      <SettingsSection
        title="Channels"
        action={
          <NewChatChannelInput
            name={newName}
            busy={busy}
            onNameChange={setNewName}
            onSubmit={add}
          />
        }
      >
        {channels.map((channel) => (
          <Item key={channel.id} className="min-h-16 border-0 px-0 py-3 sm:flex-nowrap">
            <ItemContent className="min-w-0">
              <div className="flex items-center gap-2">
                <ChannelNameInput
                  showId={showId}
                  ownerProfileId={ownerProfile.id}
                  channel={channel}
                  onError={setError}
                />
                <Badge variant="outline">
                  {channel.messageCount} message{channel.messageCount === 1 ? "" : "s"}
                </Badge>
              </div>
            </ItemContent>
            <ItemActions className="ml-auto shrink-0">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                aria-label={`Delete ${channel.name}`}
                disabled={channels.length === 1}
                onClick={() => setDeleteTarget(channel)}
              >
                <Trash2Icon /> Delete
              </Button>
            </ItemActions>
          </Item>
        ))}
        {error && (
          <p role="alert" className="pt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </SettingsSection>

      <SettingsSection title="Notifications">
        <div className="py-3">
          <ChannelNotifications
            key={`${showId}:${ownerProfile.id}`}
            showId={showId}
            profiles={profiles}
            channels={channels}
            ownerProfileId={ownerProfile.id}
            ownerResult={result}
          />
        </div>
      </SettingsSection>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete channel?</AlertDialogTitle>
            <AlertDialogDescription>
              All messages in{" "}
              <strong className="font-semibold text-foreground">#{deleteTarget?.name}</strong> will
              be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={remove}>
              Delete channel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ChannelNameInput({
  showId,
  ownerProfileId,
  channel,
  onError,
}: {
  readonly showId: ShowId;
  readonly ownerProfileId: ProfileId;
  readonly channel: ChatChannel;
  readonly onError: (message: string | undefined) => void;
}) {
  const renameChannel = useAtomSet(chatAtoms(showId, ownerProfileId).renameChannel, {
    mode: "promiseExit",
  });
  const [name, setName] = React.useState(channel.name as string);
  const [saving, setSaving] = React.useState(false);
  const cancelSave = React.useRef(false);

  React.useEffect(() => setName(channel.name), [channel.name]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(channel.name);
      return;
    }
    if (trimmed === channel.name) return;
    setSaving(true);
    onError(undefined);
    const exit = await renameChannel({
      payload: { showId, channelId: channel.id, name: trimmed as ChatChannelName },
      reactivityKeys: chatsSyncKey(showId),
    });
    if (Exit.isFailure(exit)) {
      setName(channel.name);
      onError(rpcErrorMessageFromCause(exit.cause));
    }
    setSaving(false);
  };

  return (
    <InputGroup variant="ghost" className="w-fit max-w-full">
      <InputGroupAddon>
        <InputGroupText>#</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        aria-label={`Name for ${channel.name}`}
        className="w-auto min-w-0 flex-none pl-0! [field-sizing:content]"
        size={Math.max(1, name.length)}
        value={name}
        maxLength={60}
        disabled={saving}
        onFocus={() => {
          cancelSave.current = false;
        }}
        onChange={(event) => setName(event.currentTarget.value)}
        onBlur={() => {
          if (cancelSave.current) {
            cancelSave.current = false;
            return;
          }
          void save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelSave.current = true;
            setName(channel.name);
            event.currentTarget.blur();
          }
        }}
      />
    </InputGroup>
  );
}

type ChatSnapshotResult = AsyncResult.AsyncResult<ChatSnapshot, unknown>;

function NotificationStateLoader({
  showId,
  profile,
  onResult,
}: {
  readonly showId: ShowId;
  readonly profile: Profile;
  readonly onResult: (profileId: ProfileId, result: ChatSnapshotResult) => void;
}) {
  const result = useAtomValue(chatAtoms(showId, profile.id).state);

  React.useEffect(() => onResult(profile.id, result), [onResult, profile.id, result]);
  return null;
}

function ChannelNotifications({
  showId,
  profiles,
  channels,
  ownerProfileId,
  ownerResult,
}: {
  readonly showId: ShowId;
  readonly profiles: ReadonlyArray<Profile>;
  readonly channels: ReadonlyArray<ChatChannel>;
  readonly ownerProfileId: ProfileId;
  readonly ownerResult: ChatSnapshotResult;
}) {
  const [results, setResults] = React.useState<ReadonlyMap<ProfileId, ChatSnapshotResult>>(
    () => new Map(),
  );
  const [error, setError] = React.useState<string>();
  const recordResult = React.useCallback((profileId: ProfileId, result: ChatSnapshotResult) => {
    setResults((current) => {
      if (current.get(profileId) === result) return current;
      const next = new Map(current);
      next.set(profileId, result);
      return next;
    });
  }, []);
  const resultFor = (profile: Profile) =>
    profile.id === ownerProfileId ? ownerResult : results.get(profile.id);
  const snapshotFor = (profile: Profile) => {
    const profileResult = resultFor(profile);
    return profileResult ? currentChatSnapshot(profileResult) : undefined;
  };
  const snapshotIsCurrent = (snapshot: ChatSnapshot | undefined) =>
    snapshot !== undefined &&
    channels.every((channel) => snapshot.channels.some((item) => item.id === channel.id));
  const ready = profiles.every((profile) => snapshotIsCurrent(snapshotFor(profile)));
  const failed = profiles.some((profile) => {
    const profileResult = resultFor(profile);
    return (
      profileResult !== undefined &&
      AsyncResult.isFailure(profileResult) &&
      !snapshotIsCurrent(currentChatSnapshot(profileResult))
    );
  });

  return (
    <>
      {profiles.map((profile) =>
        profile.id === ownerProfileId ? null : (
          <NotificationStateLoader
            key={profile.id}
            showId={showId}
            profile={profile}
            onResult={recordResult}
          />
        ),
      )}
      <Card className="p-0">
        <CardContent className="p-0">
          {ready ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="w-1">
                    Channel
                  </TableHead>
                  {profiles.map((profile) => (
                    <TableHead key={profile.id} scope="col" className="text-center">
                      <span className="flex items-center justify-center gap-2">
                        <ProfileAvatar
                          name={profile.name}
                          color={profile.color}
                          className="size-6 text-[10px]"
                        />
                        {profile.name}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((channel) => (
                  <NotificationChannelRow
                    key={channel.id}
                    showId={showId}
                    channel={channel}
                    profiles={profiles}
                    snapshotFor={(profile) => snapshotFor(profile)!}
                    onError={setError}
                  />
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground" role={failed ? "alert" : undefined}>
              {failed
                ? "Notification settings could not be loaded."
                : "Loading notification settings\u2026"}
            </p>
          )}
          {error && (
            <p role="alert" className="pt-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function NotificationChannelRow({
  showId,
  channel,
  profiles,
  snapshotFor,
  onError,
}: {
  readonly showId: ShowId;
  readonly channel: ChatChannel;
  readonly profiles: ReadonlyArray<Profile>;
  readonly snapshotFor: (profile: Profile) => ChatSnapshot;
  readonly onError: (message: string | undefined) => void;
}) {
  return (
    <TableRow>
      <TableHead scope="row" className="w-1">
        #{channel.name}
      </TableHead>
      {profiles.map((profile) => (
        <NotificationToggleCell
          key={profile.id}
          showId={showId}
          channel={channel}
          profile={profile}
          snapshot={snapshotFor(profile)}
          onError={onError}
        />
      ))}
    </TableRow>
  );
}

function NotificationToggleCell({
  showId,
  channel,
  profile,
  snapshot,
  onError,
}: {
  readonly showId: ShowId;
  readonly channel: ChatChannel;
  readonly profile: Profile;
  readonly snapshot: ChatSnapshot;
  readonly onError: (message: string | undefined) => void;
}) {
  const setNotifications = useAtomSet(chatAtoms(showId, profile.id).setNotifications, {
    mode: "promiseExit",
  });
  const [saving, setSaving] = React.useState(false);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    onError(undefined);
    const exit = await setNotifications({
      payload: { showId, channelId: channel.id, profileId: profile.id, enabled },
      reactivityKeys: chatsSyncKey(showId),
    });
    if (Exit.isFailure(exit)) onError(rpcErrorMessageFromCause(exit.cause));
    setSaving(false);
  };

  const profileChannel = snapshot.channels.find((item) => item.id === channel.id)!;

  return (
    <TableCell className="text-center">
      <Button
        type="button"
        size="xs"
        variant={profileChannel.notificationsEnabled ? "secondary" : "destructive"}
        aria-label={`${channel.name} notifications for ${profile.name}`}
        aria-pressed={profileChannel.notificationsEnabled}
        disabled={saving}
        onClick={() => void toggle(!profileChannel.notificationsEnabled)}
      >
        {profileChannel.notificationsEnabled ? <BellIcon /> : <BellOffIcon />}
        {profileChannel.notificationsEnabled ? "On" : "Off"}
      </Button>
    </TableCell>
  );
}
