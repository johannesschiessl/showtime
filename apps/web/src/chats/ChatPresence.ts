import type { ChatChannelId, ProfileId, ShowId } from "@showtime/contracts";

interface Presence {
  readonly showId: ShowId;
  readonly channelId: ChatChannelId;
  readonly profileId: ProfileId;
  readonly atBottom: boolean;
}

let current: Presence | undefined;

export const setChatPresence = (presence: Presence | undefined) => {
  current = presence;
};

export const isChatVisibleAtBottom = (
  showId: ShowId,
  channelId: ChatChannelId,
  profileId: ProfileId,
) =>
  document.visibilityState === "visible" &&
  current?.showId === showId &&
  current.channelId === channelId &&
  current.profileId === profileId &&
  current.atBottom;
