import * as React from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { DateTime, Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { MessageScroller, useMessageScrollerScrollable } from "@shadcn/react/message-scroller";
import {
  chatsSyncKey,
  type ChatChannel,
  type ChatChannelId,
  type ChatChannelName,
  type ChatPreset,
  type Profile,
  type ProfileId,
  type ShowId,
} from "@showtime/contracts";
import {
  ArrowUpIcon,
  BellIcon,
  BellOffIcon,
  HashIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  LibraryIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { chatAtoms, profileAtoms, rpcErrorMessageFromCause } from "@/client";
import { setChatPresence } from "@/chats/ChatPresence";
import { areChatMessagesInSameGroup } from "@/chats/ChatMessageGrouping";
import { ProfileAvatar } from "@/components/profiles/ProfileAvatar";
import { ChatMessageBody as RichChatMessageBody } from "@/components/chats/ChatMessageBody";
import { ChatPresetAnswerForm } from "@/components/chats/ChatPresetAnswer";
import { ChatPresetDialog } from "@/components/chats/ChatPresetDialog";
import { NewChatChannelInput } from "@/components/chats/NewChatChannelInput";
import { useSendChatMessage } from "@/components/chats/useSendChatMessage";
import { ProfileSwitcher } from "@/components/profiles/ProfileSwitcher";
import { formatClientTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useSelectedProfile } from "@/profiles";
import { ShowTitleBarPortal } from "@/components/shows/ShowTitleBarPortal";

export function ChatWorkspace({
  showId,
  active = true,
  compact = false,
  requestedChannelId,
  onSelectedChannelChange,
}: {
  readonly showId: ShowId;
  readonly active?: boolean;
  readonly compact?: boolean;
  readonly requestedChannelId?: ChatChannelId;
  readonly onSelectedChannelChange?: (channelId: ChatChannelId) => void;
}) {
  const profilesResult = useAtomValue(profileAtoms.state);
  const profileState = AsyncResult.isSuccess(profilesResult) ? profilesResult.value : undefined;
  const { selected } = useSelectedProfile(profileState);

  if (!selected || !profileState) {
    return (
      <div className="grid h-full min-h-72 place-content-center">
        <Spinner />
      </div>
    );
  }

  return (
    <ProfileChatWorkspace
      key={selected.id}
      showId={showId}
      active={active}
      compact={compact}
      profile={selected}
      profiles={profileState.profiles}
      requestedChannelId={requestedChannelId}
      onSelectedChannelChange={onSelectedChannelChange}
    />
  );
}

function ProfileChatWorkspace({
  showId,
  active,
  compact,
  profile,
  profiles,
  requestedChannelId,
  onSelectedChannelChange,
}: {
  readonly showId: ShowId;
  readonly active: boolean;
  readonly compact: boolean;
  readonly profile: Profile;
  readonly profiles: ReadonlyArray<Profile>;
  readonly requestedChannelId?: ChatChannelId;
  readonly onSelectedChannelChange?: (channelId: ChatChannelId) => void;
}) {
  const atoms = chatAtoms(showId, profile.id);
  const result = useAtomValue(atoms.state);
  const [selectedChannelId, setSelectedChannelId] = React.useState<ChatChannelId | undefined>(
    requestedChannelId,
  );
  const snapshot = AsyncResult.isSuccess(result) ? result.value : undefined;
  const selectedChannel =
    snapshot?.channels.find((channel) => channel.id === selectedChannelId) ?? snapshot?.channels[0];
  const selectChannel = React.useCallback(
    (channelId: ChatChannelId) => {
      setSelectedChannelId(channelId);
      onSelectedChannelChange?.(channelId);
    },
    [onSelectedChannelChange],
  );

  React.useEffect(() => {
    if (selectedChannel && selectedChannel.id !== selectedChannelId)
      selectChannel(selectedChannel.id);
  }, [selectChannel, selectedChannel, selectedChannelId]);

  React.useEffect(() => {
    if (
      requestedChannelId &&
      snapshot?.channels.some((channel) => channel.id === requestedChannelId)
    )
      selectChannel(requestedChannelId);
  }, [requestedChannelId, selectChannel, snapshot?.channels]);

  if (!snapshot || !selectedChannel) {
    return (
      <div className="grid h-full min-h-72 place-content-center gap-2 text-center text-sm text-muted-foreground">
        {AsyncResult.isFailure(result) ? "Chat could not be loaded." : <Spinner />}
      </div>
    );
  }

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden">
      <ChannelTabs
        showId={showId}
        profileId={profile.id}
        channels={snapshot.channels}
        selectedChannel={selectedChannel}
        onSelect={selectChannel}
        trailing={compact ? null : <ProfileSwitcher variant="avatar" className="md:hidden" />}
        inTitleBar={!compact}
      />
      <Conversation
        key={selectedChannel.id}
        showId={showId}
        profile={profile}
        profiles={profiles}
        channel={selectedChannel}
        presets={snapshot.presets}
        active={active}
      />
    </section>
  );
}

function ChannelTabs({
  showId,
  profileId,
  channels,
  selectedChannel,
  onSelect,
  trailing,
  inTitleBar,
}: {
  readonly showId: ShowId;
  readonly profileId: ProfileId;
  readonly channels: ReadonlyArray<ChatChannel>;
  readonly selectedChannel: ChatChannel;
  readonly onSelect: (id: ChatChannelId) => void;
  readonly trailing: React.ReactNode;
  readonly inTitleBar: boolean;
}) {
  const atoms = chatAtoms(showId, profileId);
  const createChannel = useAtomSet(atoms.createChannel, { mode: "promiseExit" });
  const renameChannel = useAtomSet(atoms.renameChannel, { mode: "promiseExit" });
  const deleteChannel = useAtomSet(atoms.deleteChannel, { mode: "promiseExit" });
  const setNotifications = useAtomSet(atoms.setNotifications, { mode: "promiseExit" });
  const [renameTarget, setRenameTarget] = React.useState<
    Pick<ChatChannel, "id" | "name"> | undefined
  >();
  const [deleteTarget, setDeleteTarget] = React.useState<
    Pick<ChatChannel, "id" | "name"> | undefined
  >();
  const [name, setName] = React.useState("");
  const [renameName, setRenameName] = React.useState<string>(selectedChannel.name);
  const [adding, setAdding] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const mutationOptions = { reactivityKeys: chatsSyncKey(showId) } as const;

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    setError(undefined);
    const exit = await createChannel({
      payload: { showId, name: trimmed as ChatChannelName },
      ...mutationOptions,
    });
    if (Exit.isFailure(exit)) setError(rpcErrorMessageFromCause(exit.cause));
    else {
      setName("");
      onSelect(exit.value.id);
    }
    setAdding(false);
  };

  const toggleNotifications = () => {
    setError(undefined);
    void setNotifications({
      payload: {
        showId,
        channelId: selectedChannel.id,
        profileId,
        enabled: !selectedChannel.notificationsEnabled,
      },
      ...mutationOptions,
    }).then((exit) => {
      if (Exit.isFailure(exit)) setError(rpcErrorMessageFromCause(exit.cause));
    });
  };

  const openRenameDialog = () => {
    setRenameName(selectedChannel.name);
    setRenameTarget({ id: selectedChannel.id, name: selectedChannel.name });
    setError(undefined);
  };

  const rename = async (event: React.FormEvent) => {
    event.preventDefault();
    const target = renameTarget;
    const trimmed = renameName.trim();
    if (!target || !trimmed || renaming || trimmed === target.name) return;
    setRenaming(true);
    setError(undefined);
    const exit = await renameChannel({
      payload: { showId, channelId: target.id, name: trimmed as ChatChannelName },
      ...mutationOptions,
    });
    if (Exit.isFailure(exit)) setError(rpcErrorMessageFromCause(exit.cause));
    else setRenameTarget(undefined);
    setRenaming(false);
  };

  const remove = async () => {
    const target = deleteTarget;
    if (!target || deleting || channels.length === 1) return;
    setDeleting(true);
    setError(undefined);
    const exit = await deleteChannel({
      payload: { showId, channelId: target.id },
      ...mutationOptions,
    });
    if (Exit.isFailure(exit)) setError(rpcErrorMessageFromCause(exit.cause));
    else setDeleteTarget(undefined);
    setDeleting(false);
  };

  return (
    <>
      {inTitleBar && (
        <ShowTitleBarPortal position="leading">
          <ChannelButtons
            channels={channels}
            selectedChannel={selectedChannel}
            onSelect={onSelect}
            onRename={openRenameDialog}
            onToggleNotifications={toggleNotifications}
            onDelete={() => {
              setError(undefined);
              setDeleteTarget({ id: selectedChannel.id, name: selectedChannel.name });
            }}
          />
          <NewChatChannelInput
            name={name}
            busy={adding}
            onNameChange={setName}
            onSubmit={add}
            formClassName="mr-1"
          />
        </ShowTitleBarPortal>
      )}
      <header
        className={cn(
          "flex h-14 shrink-0 items-center gap-2 border-b px-2",
          inTitleBar && "md:hidden",
        )}
      >
        <ChannelButtons
          channels={channels}
          selectedChannel={selectedChannel}
          onSelect={onSelect}
          onRename={openRenameDialog}
          onToggleNotifications={toggleNotifications}
          onDelete={() => {
            setError(undefined);
            setDeleteTarget({ id: selectedChannel.id, name: selectedChannel.name });
          }}
        />
        <NewChatChannelInput
          name={name}
          busy={adding}
          onNameChange={setName}
          onSubmit={add}
          className="w-44 sm:w-56"
        />
        {trailing}
      </header>
      {error && !renameTarget && !deleteTarget && (
        <p role="alert" className="shrink-0 border-b px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={renameTarget !== undefined}
        onOpenChange={(open) => {
          if (!open && !renaming) setRenameTarget(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename channel</DialogTitle>
            <DialogDescription>Choose a new name for #{renameTarget?.name}.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={rename}>
            <Input
              autoFocus
              value={renameName}
              maxLength={60}
              aria-label="Channel name"
              onChange={(event) => setRenameName(event.currentTarget.value)}
            />
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" disabled={renaming} />}>
                Cancel
              </DialogClose>
              <Button
                type="submit"
                disabled={
                  renaming || !renameName.trim() || renameName.trim() === renameTarget?.name
                }
              >
                {renaming ? <Spinner /> : "Rename"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteTarget !== undefined}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete channel?</DialogTitle>
            <DialogDescription>
              This will permanently delete #{deleteTarget?.name} and all of its messages. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={deleting} />}>
              Cancel
            </DialogClose>
            <Button type="button" variant="destructive" disabled={deleting} onClick={remove}>
              <Trash2Icon />
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChannelButtons({
  channels,
  selectedChannel,
  onSelect,
  onRename,
  onToggleNotifications,
  onDelete,
}: {
  readonly channels: ReadonlyArray<ChatChannel>;
  readonly selectedChannel: ChatChannel;
  readonly onSelect: (id: ChatChannelId) => void;
  readonly onRename: () => void;
  readonly onToggleNotifications: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <div className="no-drag-region min-w-0 flex-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ButtonGroup aria-label="Chat channels" className="min-w-max">
        {channels.map((channel, index) => {
          const selected = channel.id === selectedChannel.id;
          return (
            <div key={channel.id} className="relative flex">
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "rounded-none border-l-0 pr-9",
                  selected && "pr-17",
                  index === 0 && "rounded-l-lg border-l",
                  index === channels.length - 1 && "rounded-r-lg",
                  selected &&
                    "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] dark:bg-secondary dark:text-secondary-foreground dark:hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
                )}
                onClick={() => onSelect(channel.id)}
              >
                <HashIcon />
                <span className="max-w-40 truncate">{channel.name}</span>
                {!channel.notificationsEnabled && <BellOffIcon className="text-muted-foreground" />}
              </Button>
              {channel.unreadCount > 0 && (
                <span
                  className={cn(
                    "pointer-events-none absolute inset-y-0 flex w-8 items-center justify-center",
                    selected ? "right-9" : "right-0",
                  )}
                >
                  <Badge>{channel.unreadCount}</Badge>
                </span>
              )}
              {selected && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className={cn(
                          "absolute top-0 right-0 rounded-none",
                          index === channels.length - 1 && "rounded-r-lg",
                        )}
                        aria-label={`Options for ${selectedChannel.name}`}
                      />
                    }
                  >
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={onRename}>
                      <PencilIcon /> Rename channel
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onToggleNotifications}>
                      {selectedChannel.notificationsEnabled ? <BellOffIcon /> : <BellIcon />}
                      {selectedChannel.notificationsEnabled ? "Mute channel" : "Unmute channel"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={channels.length === 1}
                      onClick={onDelete}
                    >
                      <Trash2Icon /> Delete channel
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </ButtonGroup>
    </div>
  );
}

function Conversation({
  showId,
  profile,
  profiles,
  channel,
  presets,
  active,
}: {
  readonly showId: ShowId;
  readonly profile: Profile;
  readonly profiles: ReadonlyArray<Profile>;
  readonly channel: ChatChannel;
  readonly presets: ReadonlyArray<ChatPreset>;
  readonly active: boolean;
}) {
  return (
    <MessageScroller.Provider autoScroll defaultScrollPosition="end" scrollEdgeThreshold={24}>
      <MessageScroller.Root className="relative flex min-h-0 flex-1 flex-col">
        <ScrollArea
          className="min-h-0 flex-1"
          viewportRender={
            <MessageScroller.Viewport className="min-h-0 flex-1 overflow-y-auto overscroll-contain" />
          }
        >
          <MessageScroller.Content className="flex min-h-full flex-col justify-end gap-4 p-3 sm:p-4">
            {channel.messages.length === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessageSquareIcon />
                  </EmptyMedia>
                  <EmptyTitle>No messages yet</EmptyTitle>
                  <EmptyDescription>Send a message to start the conversation.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {channel.messages.map((message, index) => {
              const previousMessage = channel.messages[index - 1];
              const nextMessage = channel.messages[index + 1];
              const startsGroup = !areChatMessagesInSameGroup(previousMessage, message);
              const endsGroup = !areChatMessagesInSameGroup(message, nextMessage);
              const sender = profiles.find((item) => item.id === message.senderProfileId);
              const mine = message.senderProfileId === profile.id;
              const senderName = sender?.name ?? "Deleted profile";
              const request = message.replyToMessageId
                ? channel.messages.find((item) => item.id === message.replyToMessageId)
                : undefined;
              const answered = channel.messages.some(
                (item) =>
                  item.replyToMessageId === message.id && item.senderProfileId === profile.id,
              );
              return (
                <MessageScroller.Item
                  key={message.id}
                  messageId={message.id}
                  className={cn(!startsGroup && "-mt-2")}
                >
                  <Message
                    align={mine ? "end" : "start"}
                    aria-label={`${senderName}, ${formatClientTime(DateTime.toDateUtc(message.sentAt))}`}
                  >
                    <MessageAvatar>
                      {endsGroup && <ProfileAvatar name={senderName} color={sender?.color} />}
                    </MessageAvatar>
                    <MessageContent>
                      {startsGroup && <MessageHeader>{senderName}</MessageHeader>}
                      {request && (
                        <p className="max-w-72 truncate text-xs text-muted-foreground">
                          Answer to: {request.body}
                        </p>
                      )}
                      <Bubble variant={mine ? "default" : "secondary"}>
                        <BubbleContent className="whitespace-pre-wrap">
                          <RichChatMessageBody body={message.body} parts={message.parts} />
                        </BubbleContent>
                      </Bubble>
                      {message.answer && !mine && (
                        <div className="mt-2 space-y-3 rounded-lg border p-3">
                          <p className="text-sm font-medium">Answer</p>
                          <ChatPresetAnswerForm
                            showId={showId}
                            profileId={profile.id}
                            request={{ ...message, answer: message.answer }}
                            answered={answered}
                          />
                        </div>
                      )}
                      {endsGroup && (
                        <MessageFooter>
                          <time dateTime={DateTime.formatIso(message.sentAt)}>
                            {formatClientTime(DateTime.toDateUtc(message.sentAt))}
                          </time>
                        </MessageFooter>
                      )}
                    </MessageContent>
                  </Message>
                </MessageScroller.Item>
              );
            })}
          </MessageScroller.Content>
        </ScrollArea>
        <ReadTracker showId={showId} profileId={profile.id} channel={channel} active={active} />
        <Composer showId={showId} profileId={profile.id} channelId={channel.id} presets={presets} />
      </MessageScroller.Root>
    </MessageScroller.Provider>
  );
}

function ReadTracker({
  showId,
  profileId,
  channel,
  active,
}: {
  readonly showId: ShowId;
  readonly profileId: ProfileId;
  readonly channel: ChatChannel;
  readonly active: boolean;
}) {
  const { end: canScrollToEnd } = useMessageScrollerScrollable();
  const markRead = useAtomSet(chatAtoms(showId, profileId).markRead, { mode: "promiseExit" });
  const atBottom = !canScrollToEnd;
  const lastMarked = React.useRef(channel.lastReadSequence);

  React.useEffect(() => {
    setChatPresence(active ? { showId, channelId: channel.id, profileId, atBottom } : undefined);
    return () => setChatPresence(undefined);
  }, [active, atBottom, channel.id, profileId, showId]);

  React.useEffect(() => {
    if (!active || !atBottom || channel.newestSequence <= lastMarked.current) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelRetryWait: (() => void) | undefined;

    const markNewestRead = async () => {
      let retryDelay = 250;
      while (!cancelled && channel.newestSequence > lastMarked.current) {
        const exit = await markRead({
          payload: {
            showId,
            channelId: channel.id,
            profileId,
            sequence: channel.newestSequence,
          },
          reactivityKeys: chatsSyncKey(showId),
        });
        if (Exit.isSuccess(exit)) {
          if (channel.newestSequence > lastMarked.current)
            lastMarked.current = channel.newestSequence;
          return;
        }
        await new Promise<void>((resolve) => {
          cancelRetryWait = resolve;
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            cancelRetryWait = undefined;
            resolve();
          }, retryDelay);
        });
        retryDelay = Math.min(retryDelay * 2, 5_000);
      }
    };

    void markNewestRead();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      cancelRetryWait?.();
    };
  }, [active, atBottom, channel.id, channel.newestSequence, markRead, profileId, showId]);
  return null;
}

function resizeComposer(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  const style = window.getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight) || 20;
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  textarea.style.height = `${Math.min(textarea.scrollHeight, lineHeight * 5 + padding)}px`;
}

function Composer({
  showId,
  profileId,
  channelId,
  presets,
}: {
  readonly showId: ShowId;
  readonly profileId: ProfileId;
  readonly channelId: ChatChannelId;
  readonly presets: ReadonlyArray<ChatPreset>;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = React.useState("");
  const [presetsOpen, setPresetsOpen] = React.useState(false);
  const { sendMessage, sending, error } = useSendChatMessage(showId, profileId, channelId);

  React.useLayoutEffect(() => {
    if (textareaRef.current) resizeComposer(textareaRef.current);
  }, [body]);

  const submit = async () => {
    const submittedDraft = body;
    const nextError = await sendMessage(submittedDraft);
    if (!nextError) setBody((current) => (current === submittedDraft ? "" : current));
  };

  return (
    <div className="shrink-0 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3 sm:pt-3 sm:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <InputGroupButton
            size="icon-sm"
            aria-label="Open message presets"
            title="Message presets"
            onClick={() => setPresetsOpen(true)}
          >
            <LibraryIcon />
          </InputGroupButton>
        </InputGroupAddon>
        <InputGroupTextarea
          ref={textareaRef}
          value={body}
          maxLength={4_000}
          rows={1}
          placeholder="Write a message"
          aria-label="Message"
          className="min-h-8 overflow-y-auto"
          onChange={(event) => {
            setBody(event.currentTarget.value);
            resizeComposer(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-sm"
            variant="default"
            className="rounded-full"
            aria-label="Send message"
            disabled={sending || !body.trim()}
            onClick={submit}
          >
            {sending ? <Spinner /> : <ArrowUpIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {error && (
        <p role="alert" className="pt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <ChatPresetDialog
        open={presetsOpen}
        onOpenChange={setPresetsOpen}
        showId={showId}
        profileId={profileId}
        presets={presets}
        onSend={(presetBody, parts, answer) =>
          sendMessage(presetBody, parts, answer ? { answer } : undefined)
        }
      />
    </div>
  );
}
