import * as React from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { ChatChannelId, Profile, ProfileId, ShowId } from "@showtime/contracts";
import { chatAtoms, profileAtoms } from "@/client";
import { consumeChatOpenRequest, subscribeChatOpenRequests } from "@/chats/ChatNavigation";
import { ChatAnswerPrompts } from "@/components/chats/ChatAnswerPrompts";
import { ChatWorkspace } from "@/components/chats/ChatWorkspace";
import { ProfileSwitcher } from "@/components/profiles/ProfileSwitcher";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useIsMobileDrawer } from "@/hooks/use-mobile-drawer";
import { useSelectedProfile } from "@/profiles";

interface ChatDrawerProps {
  readonly showId: ShowId;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly trigger?: (unreadCount: number) => React.ReactElement;
  readonly onSelectedChannelChange?: (channelId: ChatChannelId) => void;
}

export function ChatDrawer(props: ChatDrawerProps) {
  const profilesResult = useAtomValue(profileAtoms.state);
  const profileState = AsyncResult.isSuccess(profilesResult) ? profilesResult.value : undefined;
  const { selected } = useSelectedProfile(profileState);

  return selected ? (
    <ProfileChatDrawer key={`${props.showId}:${selected.id}`} {...props} profile={selected} />
  ) : (
    <ChatDrawerView {...props} unreadCount={0} />
  );
}

function ProfileChatDrawer({
  profile,
  ...props
}: ChatDrawerProps & {
  readonly profile: Profile;
}) {
  const result = useAtomValue(chatAtoms(props.showId, profile.id).state);
  const unreadCount = AsyncResult.isSuccess(result)
    ? result.value.channels.reduce((total, channel) => total + channel.unreadCount, 0)
    : 0;
  return <ChatDrawerView {...props} unreadCount={unreadCount} />;
}

function ChatDrawerView({
  showId,
  unreadCount,
  open: controlledOpen,
  onOpenChange,
  trigger,
  onSelectedChannelChange,
}: ChatDrawerProps & {
  readonly unreadCount: number;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [selectedChannelId, setSelectedChannelId] = React.useState<ChatChannelId>();
  const selectChannel = React.useCallback(
    (channelId: ChatChannelId) => {
      setSelectedChannelId(channelId);
      onSelectedChannelChange?.(channelId);
    },
    [onSelectedChannelChange],
  );
  const isMobile = useIsMobileDrawer();

  React.useEffect(() => {
    const openRequestedChat = () => {
      const request = consumeChatOpenRequest(showId);
      if (!request) return;
      selectChannel(request.channelId);
      setOpen(true);
    };
    openRequestedChat();
    return subscribeChatOpenRequests(openRequestedChat);
  }, [selectChannel, setOpen, showId]);

  return (
    <>
      <Drawer open={open} onOpenChange={setOpen} swipeDirection={isMobile ? "down" : "right"}>
        {trigger && <DrawerTrigger render={trigger(unreadCount)} />}
        <DrawerContent
          className={
            isMobile
              ? "[--drawer-height:calc(var(--app-height)-3rem)]"
              : "data-[swipe-axis=x]:[--drawer-content-width:min(44rem,100vw)]"
          }
        >
          <DrawerHeader className="flex-row items-center justify-between pb-3 text-left">
            <DrawerTitle>Chat</DrawerTitle>
            {isMobile && <ProfileSwitcher variant="avatar" />}
          </DrawerHeader>
          <div className="min-h-0 flex-1 px-2 pb-2">
            <ChatWorkspace
              showId={showId}
              active={open}
              compact
              requestedChannelId={selectedChannelId}
              onSelectedChannelChange={selectChannel}
            />
          </div>
        </DrawerContent>
      </Drawer>
      <ChatAnswerPrompts showId={showId} chatOpen={open} />
    </>
  );
}

export function ChatUnreadBadge({ showId }: { readonly showId: ShowId }) {
  const profilesResult = useAtomValue(profileAtoms.state);
  const profileState = AsyncResult.isSuccess(profilesResult) ? profilesResult.value : undefined;
  const { selected } = useSelectedProfile(profileState);
  return selected ? <ProfileChatUnreadBadge showId={showId} profileId={selected.id} /> : null;
}

function ProfileChatUnreadBadge({
  showId,
  profileId,
}: {
  readonly showId: ShowId;
  readonly profileId: ProfileId;
}) {
  const result = useAtomValue(chatAtoms(showId, profileId).state);
  const unreadCount = AsyncResult.isSuccess(result)
    ? result.value.channels.reduce((total, channel) => total + channel.unreadCount, 0)
    : 0;
  return unreadCount > 0 ? (
    <Badge className="min-w-5 justify-center px-1">{unreadCount > 99 ? "99+" : unreadCount}</Badge>
  ) : null;
}
