import * as React from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type { ChatSnapshot, Profile, ShowId } from "@showtime/contracts";
import { chatAtoms, profileAtoms } from "@/client";
import { registerChatAnswerDialog } from "@/chats/ChatAnswerDialogPresence";
import {
  planChatAnswerRequests,
  reconcileChatAnswerRequests,
  type AnswerRequest,
  type ChatAnswerRequestSequences,
} from "@/chats/ChatAnswerRequestPolicy";
import { ChatPresetAnswerDialog } from "@/components/chats/ChatPresetAnswer";
import { useSelectedProfile } from "@/profiles";

export function ChatAnswerPrompts({
  showId,
  chatOpen,
}: {
  readonly showId: ShowId;
  readonly chatOpen: boolean;
}) {
  const profilesResult = useAtomValue(profileAtoms.state);
  const profileState = AsyncResult.isSuccess(profilesResult) ? profilesResult.value : undefined;
  const { selected } = useSelectedProfile(profileState);

  return selected ? (
    <ProfileChatAnswerPrompts
      key={`${showId}:${selected.id}`}
      showId={showId}
      chatOpen={chatOpen}
      profile={selected}
      profiles={profileState?.profiles ?? []}
    />
  ) : null;
}

function ProfileChatAnswerPrompts({
  showId,
  chatOpen,
  profile,
  profiles,
}: {
  readonly showId: ShowId;
  readonly chatOpen: boolean;
  readonly profile: Profile;
  readonly profiles: ReadonlyArray<Profile>;
}) {
  const result = useAtomValue(chatAtoms(showId, profile.id).state);
  const snapshot = AsyncResult.isSuccess(result) ? result.value : undefined;

  return (
    <ReadyChatAnswerPrompts
      showId={showId}
      chatOpen={chatOpen}
      profile={profile}
      profiles={profiles}
      snapshot={snapshot}
    />
  );
}

function ReadyChatAnswerPrompts({
  showId,
  chatOpen,
  profile,
  profiles,
  snapshot,
}: {
  readonly showId: ShowId;
  readonly chatOpen: boolean;
  readonly profile: Profile;
  readonly profiles: ReadonlyArray<Profile>;
  readonly snapshot?: ChatSnapshot;
}) {
  const [pendingAnswers, setPendingAnswers] = React.useState<ReadonlyArray<AnswerRequest>>([]);
  const newestSequences = React.useRef<ChatAnswerRequestSequences | undefined>(undefined);

  React.useLayoutEffect(() => {
    if (chatOpen) return;
    return registerChatAnswerDialog(showId, profile.id);
  }, [chatOpen, profile.id, showId]);

  React.useEffect(() => {
    if (!snapshot) return;
    const { requests, sequences } = planChatAnswerRequests({
      channels: snapshot.channels,
      profileId: profile.id,
      previousSequences: newestSequences.current,
      shouldPrompt: !chatOpen,
    });
    newestSequences.current = sequences;
    setPendingAnswers((current) =>
      reconcileChatAnswerRequests({
        queued: current,
        incoming: requests,
        channels: snapshot.channels,
      }),
    );
  }, [chatOpen, profile.id, snapshot]);

  React.useEffect(() => {
    if (chatOpen) setPendingAnswers([]);
  }, [chatOpen]);

  const pendingAnswer = pendingAnswers[0];
  const pendingChannel = pendingAnswer
    ? snapshot?.channels.find((channel) => channel.id === pendingAnswer.channelId)
    : undefined;
  const answered = Boolean(
    pendingAnswer &&
    pendingChannel?.messages.some(
      (message) =>
        message.replyToMessageId === pendingAnswer.id && message.senderProfileId === profile.id,
    ),
  );
  const dismiss = () => setPendingAnswers((current) => current.slice(1));

  return (
    <ChatPresetAnswerDialog
      open={Boolean(pendingAnswer) && !chatOpen}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
      showId={showId}
      profileId={profile.id}
      request={pendingAnswer}
      senderName={
        profiles.find((candidate) => candidate.id === pendingAnswer?.senderProfileId)?.name ??
        "the sender"
      }
      answered={answered}
      onAnswered={dismiss}
    />
  );
}
