import * as React from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { ChatChannelId, ChatPreset, Profile, ShowId } from "@showtime/contracts";
import {
  EllipsisIcon,
  LibraryIcon,
  MessageCircleReplyIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { chatAtoms, profileAtoms } from "@/client";
import { ChatPresetDialog, type ChatPresetDialogMode } from "@/components/chats/ChatPresetDialog";
import { useSendChatMessage } from "@/components/chats/useSendChatMessage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useSelectedProfile } from "@/profiles";
import { ShowTitleBarPortal } from "@/components/shows/ShowTitleBarPortal";

type OpenDialog = {
  readonly key: string;
  readonly mode: ChatPresetDialogMode;
};

export function ChatPresetsWorkspace({ showId }: { readonly showId: ShowId }) {
  const profilesResult = useAtomValue(profileAtoms.state);
  const profileState = AsyncResult.isSuccess(profilesResult) ? profilesResult.value : undefined;
  const { selected } = useSelectedProfile(profileState);

  if (!selected) {
    return (
      <div className="grid h-full min-h-72 place-content-center">
        <Spinner />
      </div>
    );
  }

  return <ProfileChatPresetsWorkspace key={selected.id} showId={showId} profile={selected} />;
}

function ProfileChatPresetsWorkspace({
  showId,
  profile,
}: {
  readonly showId: ShowId;
  readonly profile: Profile;
}) {
  const result = useAtomValue(chatAtoms(showId, profile.id).state);
  const snapshot = AsyncResult.isSuccess(result) ? result.value : undefined;
  const [channelId, setChannelId] = React.useState<ChatChannelId>();
  const channel = snapshot?.channels.find((item) => item.id === channelId) ?? snapshot?.channels[0];

  React.useEffect(() => {
    if (channel && channel.id !== channelId) setChannelId(channel.id);
  }, [channel, channelId]);

  if (!snapshot || !channel) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {AsyncResult.isFailure(result) ? <LibraryIcon /> : <Spinner />}
          </EmptyMedia>
          <EmptyTitle>
            {AsyncResult.isFailure(result) ? "Presets could not be loaded" : "Loading presets"}
          </EmptyTitle>
          {AsyncResult.isFailure(result) && (
            <EmptyDescription>Check the connection and try again.</EmptyDescription>
          )}
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ReadyChatPresetsWorkspace
      key={channel.id}
      showId={showId}
      profile={profile}
      channelId={channel.id}
      channels={snapshot.channels}
      presets={snapshot.presets}
      onChannelChange={setChannelId}
    />
  );
}

function ReadyChatPresetsWorkspace({
  showId,
  profile,
  channelId,
  channels,
  presets,
  onChannelChange,
}: {
  readonly showId: ShowId;
  readonly profile: Profile;
  readonly channelId: ChatChannelId;
  readonly channels: ReadonlyArray<{ readonly id: ChatChannelId; readonly name: string }>;
  readonly presets: ReadonlyArray<ChatPreset>;
  readonly onChannelChange: (channelId: ChatChannelId) => void;
}) {
  const [dialog, setDialog] = React.useState<OpenDialog>();
  const { sendMessage } = useSendChatMessage(showId, profile.id, channelId);
  const selectedChannel = channels.find((channel) => channel.id === channelId);
  const open = (mode: ChatPresetDialogMode) =>
    setDialog({
      key: `${mode.type}:${"preset" in mode && mode.preset ? mode.preset.id : "new"}`,
      mode,
    });

  return (
    <section className="mx-auto flex h-full w-full max-w-6xl flex-col gap-3">
      <ShowTitleBarPortal position="leading">
        <PresetChannelSelect
          channelId={channelId}
          channels={channels}
          selectedChannelName={selectedChannel?.name}
          onChannelChange={onChannelChange}
        />
      </ShowTitleBarPortal>
      <ShowTitleBarPortal position="actions">
        <AddPresetButton onAdd={() => open({ type: "edit" })} />
      </ShowTitleBarPortal>
      <div className="md:hidden">
        <PresetToolbar
          channelId={channelId}
          channels={channels}
          selectedChannelName={selectedChannel?.name}
          onChannelChange={onChannelChange}
          onAdd={() => open({ type: "edit" })}
          fullWidth
        />
      </div>

      {presets.length === 0 ? (
        <Empty className="min-h-72">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LibraryIcon />
            </EmptyMedia>
            <EmptyTitle>No presets yet</EmptyTitle>
            <EmptyDescription>
              Create a reusable message for checks, routing changes, or anything your team sends
              often.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={() => open({ type: "edit" })}>
              <PlusIcon /> Add preset
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
          {presets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              onUse={() => open({ type: "use", preset })}
              onEdit={() => open({ type: "edit", preset })}
              onDelete={() => open({ type: "delete", preset })}
            />
          ))}
        </div>
      )}

      {dialog && (
        <ChatPresetDialog
          key={dialog.key}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setDialog(undefined);
          }}
          showId={showId}
          profileId={profile.id}
          presets={presets}
          initialMode={dialog.mode}
          onSend={(body, parts, answer) =>
            sendMessage(body, parts, answer ? { answer } : undefined)
          }
        />
      )}
    </section>
  );
}

function PresetToolbar({
  channelId,
  channels,
  selectedChannelName,
  onChannelChange,
  onAdd,
  fullWidth = false,
}: {
  readonly channelId: ChatChannelId;
  readonly channels: ReadonlyArray<{ readonly id: ChatChannelId; readonly name: string }>;
  readonly selectedChannelName: string | undefined;
  readonly onChannelChange: (channelId: ChatChannelId) => void;
  readonly onAdd: () => void;
  readonly fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "flex w-full gap-2" : "flex items-center gap-1"}>
      <PresetChannelSelect
        channelId={channelId}
        channels={channels}
        selectedChannelName={selectedChannelName}
        onChannelChange={onChannelChange}
        fullWidth={fullWidth}
      />
      <AddPresetButton onAdd={onAdd} />
    </div>
  );
}

function PresetChannelSelect({
  channelId,
  channels,
  selectedChannelName,
  onChannelChange,
  fullWidth = false,
}: {
  readonly channelId: ChatChannelId;
  readonly channels: ReadonlyArray<{ readonly id: ChatChannelId; readonly name: string }>;
  readonly selectedChannelName: string | undefined;
  readonly onChannelChange: (channelId: ChatChannelId) => void;
  readonly fullWidth?: boolean;
}) {
  return (
    <Select value={channelId} onValueChange={(value) => value && onChannelChange(value)}>
      <SelectTrigger
        className={fullWidth ? "min-w-0 flex-1" : "w-44"}
        aria-label="Preset destination channel"
      >
        <SelectValue>
          {selectedChannelName ? `Send to #${selectedChannelName}` : "Send to channel"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {channels.map((channel) => (
          <SelectItem key={channel.id} value={channel.id}>
            #{channel.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AddPresetButton({ onAdd }: { readonly onAdd: () => void }) {
  return (
    <Button type="button" size="sm" aria-label="Add preset" onClick={onAdd}>
      <PlusIcon />
      <span className="hidden min-[400px]:inline">Add preset</span>
    </Button>
  );
}

function PresetCard({
  preset,
  onUse,
  onEdit,
  onDelete,
}: {
  readonly preset: ChatPreset;
  readonly onUse: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Use preset ${preset.name}`}
      className="cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onUse}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onUse();
        }
      }}
    >
      <CardHeader>
        <CardTitle>{preset.name}</CardTitle>
        <CardDescription className="line-clamp-3 whitespace-pre-wrap">
          {preset.template}
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Actions for ${preset.name}`}
                  onClick={(event) => event.stopPropagation()}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2Icon /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-8 flex-wrap gap-1.5">
        {preset.fields.map((field) => (
          <Badge key={field.name} variant="outline">
            {field.name}
          </Badge>
        ))}
        {preset.answer && (
          <Badge variant="secondary">
            <MessageCircleReplyIcon /> Reply requested
          </Badge>
        )}
        {preset.fields.length === 0 && !preset.answer && (
          <span className="text-xs text-muted-foreground">Ready to send as-is</span>
        )}
      </CardContent>
    </Card>
  );
}
