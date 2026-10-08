import * as React from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { ChatChannelId, ProfileId, ShowId } from "@showtime/contracts";
import { chatAtoms, profileAtoms } from "@/client";
import { ChatPresetDialog } from "@/components/chats/ChatPresetDialog";
import { useSendChatMessage } from "@/components/chats/useSendChatMessage";
import { useSelectedProfile } from "@/profiles";

type TriggerProps = {
  readonly disabled: boolean;
  readonly onClick: () => void;
};

type ChatPresetLauncherProps = {
  readonly showId: ShowId;
  readonly channelId?: ChatChannelId;
  readonly trigger: (props: TriggerProps) => React.ReactNode;
};

export function ChatPresetLauncher(props: ChatPresetLauncherProps) {
  const profilesResult = useAtomValue(profileAtoms.state);
  const profileState = AsyncResult.isSuccess(profilesResult) ? profilesResult.value : undefined;
  const { selected } = useSelectedProfile(profileState);

  return selected ? (
    <ProfileChatPresetLauncher {...props} profileId={selected.id} />
  ) : (
    props.trigger({ disabled: true, onClick: () => undefined })
  );
}

function ProfileChatPresetLauncher({
  showId,
  profileId,
  channelId,
  trigger,
}: ChatPresetLauncherProps & { readonly profileId: ProfileId }) {
  const result = useAtomValue(chatAtoms(showId, profileId).state);
  const snapshot = AsyncResult.isSuccess(result) ? result.value : undefined;
  const channel = snapshot?.channels.find((item) => item.id === channelId) ?? snapshot?.channels[0];

  return snapshot && channel ? (
    <ReadyChatPresetLauncher
      showId={showId}
      profileId={profileId}
      channelId={channel.id}
      presets={snapshot.presets}
      trigger={trigger}
    />
  ) : (
    trigger({ disabled: true, onClick: () => undefined })
  );
}

function ReadyChatPresetLauncher({
  showId,
  profileId,
  channelId,
  presets,
  trigger,
}: {
  readonly showId: ShowId;
  readonly profileId: ProfileId;
  readonly channelId: ChatChannelId;
  readonly presets: React.ComponentProps<typeof ChatPresetDialog>["presets"];
  readonly trigger: ChatPresetLauncherProps["trigger"];
}) {
  const [open, setOpen] = React.useState(false);
  const { sendMessage } = useSendChatMessage(showId, profileId, channelId);

  return (
    <>
      {trigger({ disabled: false, onClick: () => setOpen(true) })}
      <ChatPresetDialog
        open={open}
        onOpenChange={setOpen}
        showId={showId}
        profileId={profileId}
        presets={presets}
        onSend={(body, parts, answer) => sendMessage(body, parts, answer ? { answer } : undefined)}
      />
    </>
  );
}
