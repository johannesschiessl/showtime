import * as React from "react";
import { useRpcMutation } from "@/hooks/useRpcMutation";
import { Exit } from "effect";
import {
  chatsSyncKey,
  chatMessageIdPrefix,
  makeTemporaryId,
  type ChatChannelId,
  type ChatMessageBody,
  type ChatMessageId,
  type ChatMessagePart,
  type ChatPresetAnswer,
  type ProfileId,
  type ShowId,
} from "@showtime/contracts";
import { chatAtoms, rpcErrorMessageFromCause } from "@/client";

export function useSendChatMessage(showId: ShowId, profileId: ProfileId, channelId: ChatChannelId) {
  const send = useRpcMutation(chatAtoms(showId, profileId).send);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const sendingRef = React.useRef(false);
  const pendingRef = React.useRef<
    | {
        readonly key: string;
        readonly messageId: ChatMessageId;
      }
    | undefined
  >(undefined);

  const sendMessage = React.useCallback(
    async (
      messageBody: string,
      parts?: ReadonlyArray<ChatMessagePart>,
      options?: {
        readonly answer?: ChatPresetAnswer;
        readonly replyToMessageId?: ChatMessageId;
      },
    ): Promise<string | undefined> => {
      const trimmed = messageBody.trim();
      if (!trimmed) return "Write a message before sending.";
      if (sendingRef.current) return "A message is already being sent.";
      sendingRef.current = true;
      setSending(true);
      setError(undefined);
      const key = JSON.stringify([
        trimmed,
        parts ?? null,
        options?.answer ?? null,
        options?.replyToMessageId ?? null,
      ]);
      const pending =
        pendingRef.current?.key === key
          ? pendingRef.current
          : {
              key,
              messageId: makeTemporaryId(chatMessageIdPrefix) as ChatMessageId,
            };
      pendingRef.current = pending;
      try {
        const exit = await send({
          payload: {
            showId,
            channelId,
            senderProfileId: profileId,
            body: trimmed as ChatMessageBody,
            messageId: pending.messageId,
            ...(parts === undefined ? {} : { parts }),
            ...(options?.answer === undefined ? {} : { answer: options.answer }),
            ...(options?.replyToMessageId === undefined
              ? {}
              : { replyToMessageId: options.replyToMessageId }),
          },
          reactivityKeys: chatsSyncKey(showId),
        });
        const nextError = Exit.isFailure(exit) ? rpcErrorMessageFromCause(exit.cause) : undefined;
        if (nextError) setError(nextError);
        else if (pendingRef.current?.messageId === pending.messageId)
          pendingRef.current = undefined;
        return nextError;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [channelId, profileId, send, showId],
  );

  return { sendMessage, sending, error } as const;
}
