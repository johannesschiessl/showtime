import { Context, DateTime, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import {
  chatMessagePartsText,
  decodeChatPresetAnswer,
  decodeChatPresetName,
  decodeChatPresetFields,
  decodeChatPresetTemplate,
  decodeChatChannelName,
  decodeChatMessageBody,
  decodeChatMessageParts,
  RpcError,
  validateChatPresetAnswerDefinition,
  validateChatPresetDefinition,
  type ChatChannel,
  type ChatChannelId,
  type ChatMessage,
  type ChatMessageId,
  type ChatMessagePart,
  type ChatPreset,
  type ChatPresetAnswer,
  type ChatPresetField,
  type ChatPresetId,
  type ChatSequence,
  type ChatSnapshot,
  type ProfileId,
  type ShowId,
} from "@showtime/contracts";
import { Ids } from "../ids/Ids.js";
import { DatabaseReady } from "../database/Database.js";
import { ProfileService } from "../profiles/ProfileService.js";

const replayLimit = 100;

interface ChannelRow {
  readonly id: string;
  readonly show_id: string;
  readonly name: string;
  readonly created_at: string;
  readonly message_count: number;
  readonly incoming_message_count: number;
  readonly newest_sequence: number | null;
  readonly last_read_sequence: number | null;
  readonly notifications_enabled: number | null;
  readonly unread_count: number;
}

interface MessageRow {
  readonly id: string;
  readonly sequence: number;
  readonly show_id: string;
  readonly channel_id: string;
  readonly sender_profile_id: string;
  readonly body: string;
  readonly parts_json: string | null;
  readonly answer_json: string | null;
  readonly reply_to_message_id: string | null;
  readonly sent_at: string;
}

interface PresetRow {
  readonly id: string;
  readonly show_id: string;
  readonly name: string;
  readonly template: string;
  readonly fields_json: string;
  readonly answer_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export class ChatService extends Context.Service<
  ChatService,
  {
    readonly state: (showId: ShowId, profileId: ProfileId) => Effect.Effect<ChatSnapshot, RpcError>;
    readonly createChannel: (params: {
      readonly showId: ShowId;
      readonly name: string;
    }) => Effect.Effect<ChatChannel, RpcError>;
    readonly renameChannel: (params: {
      readonly showId: ShowId;
      readonly channelId: ChatChannelId;
      readonly name: string;
    }) => Effect.Effect<void, RpcError>;
    readonly deleteChannel: (params: {
      readonly showId: ShowId;
      readonly channelId: ChatChannelId;
    }) => Effect.Effect<void, RpcError>;
    readonly send: (params: {
      readonly showId: ShowId;
      readonly channelId: ChatChannelId;
      readonly senderProfileId: ProfileId;
      readonly body: string;
      readonly messageId?: ChatMessageId;
      readonly parts?: ReadonlyArray<ChatMessagePart>;
      readonly answer?: ChatPresetAnswer;
      readonly replyToMessageId?: ChatMessageId;
    }) => Effect.Effect<ChatMessage, RpcError>;
    readonly createPreset: (params: {
      readonly showId: ShowId;
      readonly name: string;
      readonly template: string;
      readonly fields: ReadonlyArray<ChatPresetField>;
      readonly answer?: ChatPresetAnswer;
    }) => Effect.Effect<ChatPreset, RpcError>;
    readonly updatePreset: (params: {
      readonly showId: ShowId;
      readonly presetId: ChatPresetId;
      readonly name: string;
      readonly template: string;
      readonly fields: ReadonlyArray<ChatPresetField>;
      readonly answer?: ChatPresetAnswer;
    }) => Effect.Effect<ChatPreset, RpcError>;
    readonly deletePreset: (params: {
      readonly showId: ShowId;
      readonly presetId: ChatPresetId;
    }) => Effect.Effect<void, RpcError>;
    readonly markRead: (params: {
      readonly showId: ShowId;
      readonly channelId: ChatChannelId;
      readonly profileId: ProfileId;
      readonly sequence: ChatSequence;
    }) => Effect.Effect<void, RpcError>;
    readonly setNotifications: (params: {
      readonly showId: ShowId;
      readonly channelId: ChatChannelId;
      readonly profileId: ProfileId;
      readonly enabled: boolean;
    }) => Effect.Effect<void, RpcError>;
    readonly deleteShow: (showId: ShowId) => Effect.Effect<void, RpcError>;
  }
>()("@showtime/backend/chats/ChatService") {}

const rpcError = (message: string, cause?: unknown) =>
  new RpcError({ message, ...(cause === undefined ? {} : { cause }) });

const toMessage = (row: MessageRow): ChatMessage => {
  const parts =
    row.parts_json === null ? undefined : decodeChatMessageParts(JSON.parse(row.parts_json));
  const answer =
    row.answer_json === null ? undefined : decodeChatPresetAnswer(JSON.parse(row.answer_json));
  if (parts && (parts.length === 0 || chatMessagePartsText(parts) !== row.body))
    throw new Error("Stored chat parts do not match the message body.");
  if (answer) {
    const validationError = validateChatPresetAnswerDefinition(
      answer,
      answer.context?.map((item) => item.name) ?? [],
    );
    if (validationError) throw new Error(validationError);
  }
  return {
    id: row.id as ChatMessage["id"],
    sequence: row.sequence as ChatSequence,
    showId: row.show_id as ShowId,
    channelId: row.channel_id as ChatChannelId,
    senderProfileId: row.sender_profile_id as ProfileId,
    body: row.body as ChatMessage["body"],
    ...(parts === undefined ? {} : { parts }),
    ...(answer === undefined ? {} : { answer }),
    ...(row.reply_to_message_id === null
      ? {}
      : { replyToMessageId: row.reply_to_message_id as ChatMessageId }),
    sentAt: DateTime.makeUnsafe(row.sent_at),
  };
};

const toPreset = (row: PresetRow): ChatPreset => {
  const fields = decodeChatPresetFields(JSON.parse(row.fields_json));
  const validationError = validateChatPresetDefinition({ template: row.template, fields });
  if (validationError) throw new Error(validationError);
  const answer =
    row.answer_json === null ? undefined : decodeChatPresetAnswer(JSON.parse(row.answer_json));
  if (answer) {
    if (answer.context?.length) throw new Error("Preset answers cannot contain message context.");
    const answerValidationError = validateChatPresetAnswerDefinition(
      answer,
      fields.map((field) => field.name),
    );
    if (answerValidationError) throw new Error(answerValidationError);
  }
  return {
    id: row.id as ChatPresetId,
    showId: row.show_id as ShowId,
    name: row.name as ChatPreset["name"],
    template: row.template as ChatPreset["template"],
    fields,
    ...(answer === undefined ? {} : { answer }),
    createdAt: DateTime.makeUnsafe(row.created_at),
    updatedAt: DateTime.makeUnsafe(row.updated_at),
  };
};

const make = Effect.gen(function* () {
  yield* DatabaseReady;
  const sql = yield* SqlClient.SqlClient;
  const ids = yield* Ids;
  const profiles = yield* ProfileService;

  const ensureProfile = (profileId: ProfileId) =>
    profiles.list.pipe(
      Effect.flatMap((state) =>
        state.profiles.some((profile) => profile.id === profileId)
          ? Effect.void
          : Effect.fail(rpcError("The selected profile no longer exists.")),
      ),
    );

  const ensureDefaultChannel = (showId: ShowId) =>
    Effect.gen(function* () {
      const rows = (yield* sql`SELECT id FROM chat_channels WHERE show_id = ${showId} LIMIT 1`) as
        | ReadonlyArray<{ readonly id: string }>
        | undefined;
      if (rows && rows.length > 0) return;
      const id = yield* ids.makeChatChannelId;
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`INSERT INTO chat_channels (id, show_id, name, created_at)
        VALUES (${id}, ${showId}, ${"General"}, ${createdAt})`;
    }).pipe(sql.withTransaction);

  const channelName = (input: string) =>
    decodeChatChannelName(input.trim()).pipe(
      Effect.mapError((cause) => rpcError("Channel names must be 1 to 60 characters.", cause)),
    );

  const loadMessages = (showId: ShowId) =>
    Effect.gen(function* () {
      const rows = (yield* sql`SELECT id, sequence, show_id, channel_id, sender_profile_id, body,
          parts_json, answer_json, reply_to_message_id, sent_at
        FROM (
          SELECT m.*,
            ROW_NUMBER() OVER (PARTITION BY m.channel_id ORDER BY m.sequence DESC) AS replay_rank
          FROM chat_channels c
          INNER JOIN chat_messages m ON m.channel_id = c.id
          WHERE c.show_id = ${showId}
        )
        WHERE replay_rank <= ${replayLimit}
        ORDER BY sequence`) as unknown as ReadonlyArray<MessageRow>;
      const byChannel = new Map<ChatChannelId, Array<ChatMessage>>();
      for (const row of rows) {
        const channelId = row.channel_id as ChatChannelId;
        const messages = byChannel.get(channelId);
        if (messages) messages.push(toMessage(row));
        else byChannel.set(channelId, [toMessage(row)]);
      }
      return byChannel;
    });

  const loadPresets = (showId: ShowId) =>
    Effect.gen(function* () {
      const rows =
        (yield* sql`SELECT id, show_id, name, template, fields_json, answer_json, created_at, updated_at
        FROM chat_presets
        WHERE show_id = ${showId}
        ORDER BY name COLLATE NOCASE, created_at`) as unknown as ReadonlyArray<PresetRow>;
      const presets: Array<ChatPreset> = [];
      for (const row of rows) {
        const preset = yield* Effect.try({
          try: () => toPreset(row),
          catch: (cause) => cause,
        }).pipe(
          Effect.catch(() =>
            Effect.logWarning("Skipping invalid stored chat preset").pipe(
              Effect.annotateLogs({ presetId: row.id, showId: row.show_id }),
              Effect.as(undefined),
            ),
          ),
        );
        if (preset !== undefined) presets.push(preset);
      }
      return presets;
    });

  const state = (showId: ShowId, profileId: ProfileId) =>
    Effect.gen(function* () {
      yield* ensureProfile(profileId);
      yield* ensureDefaultChannel(showId);
      const rows = (yield* sql`SELECT
          c.id,
          c.show_id,
          c.name,
          c.created_at,
          COUNT(m.sequence) AS message_count,
          SUM(CASE WHEN m.sender_profile_id != ${profileId} THEN 1 ELSE 0 END) AS incoming_message_count,
          MAX(m.sequence) AS newest_sequence,
          s.last_read_sequence,
          s.notifications_enabled,
          SUM(CASE WHEN m.sequence > COALESCE(s.last_read_sequence, 0) THEN 1 ELSE 0 END) AS unread_count
        FROM chat_channels c
        LEFT JOIN chat_profile_channel_state s
          ON s.show_id = c.show_id AND s.channel_id = c.id AND s.profile_id = ${profileId}
        LEFT JOIN chat_messages m ON m.channel_id = c.id
        WHERE c.show_id = ${showId}
        GROUP BY c.id
        ORDER BY c.created_at, c.id`) as unknown as ReadonlyArray<ChannelRow>;
      const messagesByChannel = yield* loadMessages(showId);
      const presets = yield* loadPresets(showId);
      const channels = rows.map((row): ChatChannel => {
        const messages = messagesByChannel.get(row.id as ChatChannelId) ?? [];
        const newestSequence = (row.newest_sequence ?? 0) as ChatSequence;
        return {
          id: row.id as ChatChannelId,
          showId,
          name: row.name as ChatChannel["name"],
          createdAt: DateTime.makeUnsafe(row.created_at),
          messages,
          messageCount: Number(row.message_count),
          incomingMessageCount: Number(row.incoming_message_count),
          unreadCount: Number(row.unread_count),
          lastReadSequence: Number(row.last_read_sequence ?? 0) as ChatSequence,
          earliestReplaySequence: (messages[0]?.sequence ?? newestSequence) as ChatSequence,
          newestSequence,
          notificationsEnabled: row.notifications_enabled !== 0,
        };
      });
      return { showId, profileId, channels, presets } satisfies ChatSnapshot;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof RpcError ? cause : rpcError("Could not load chat.", cause),
      ),
    );

  const createChannel = ({
    showId,
    name: inputName,
  }: {
    readonly showId: ShowId;
    readonly name: string;
  }) =>
    Effect.gen(function* () {
      const name = yield* channelName(inputName);
      const id = yield* ids.makeChatChannelId;
      const createdAt = yield* DateTime.now;
      yield* sql`INSERT INTO chat_channels (id, show_id, name, created_at)
        VALUES (${id}, ${showId}, ${name}, ${DateTime.formatIso(createdAt)})`;
      return {
        id,
        showId,
        name,
        createdAt,
        messages: [],
        messageCount: 0,
        incomingMessageCount: 0,
        unreadCount: 0,
        lastReadSequence: 0 as ChatSequence,
        earliestReplaySequence: 0 as ChatSequence,
        newestSequence: 0 as ChatSequence,
        notificationsEnabled: true,
      } satisfies ChatChannel;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof RpcError
          ? cause
          : rpcError("Could not create channel. Channel names must be unique.", cause),
      ),
    );

  const renameChannel = (params: {
    readonly showId: ShowId;
    readonly channelId: ChatChannelId;
    readonly name: string;
  }) =>
    Effect.gen(function* () {
      const name = yield* channelName(params.name);
      const renamed = (yield* sql`UPDATE chat_channels
        SET name = ${name}
        WHERE id = ${params.channelId} AND show_id = ${params.showId}
        RETURNING id`) as unknown as ReadonlyArray<{ readonly id: string }>;
      if (renamed.length === 0) return yield* Effect.fail(rpcError("Channel not found."));
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof RpcError
          ? cause
          : rpcError("Could not rename channel. Channel names must be unique.", cause),
      ),
    );

  const deleteChannel = (params: { readonly showId: ShowId; readonly channelId: ChatChannelId }) =>
    Effect.gen(function* () {
      const deleted = (yield* sql`DELETE FROM chat_channels
        WHERE id = ${params.channelId}
          AND show_id = ${params.showId}
          AND EXISTS (
            SELECT 1 FROM chat_channels remaining
            WHERE remaining.show_id = ${params.showId}
              AND remaining.id != ${params.channelId}
          )
        RETURNING id`) as unknown as ReadonlyArray<{ readonly id: string }>;
      if (deleted.length > 0) return;
      const channel = (yield* sql`SELECT id FROM chat_channels
        WHERE id = ${params.channelId} AND show_id = ${params.showId}`) as unknown as ReadonlyArray<{
        readonly id: string;
      }>;
      if (channel.length === 0) return yield* Effect.fail(rpcError("Channel not found."));
      return yield* Effect.fail(rpcError("A show must have at least one channel."));
    }).pipe(
      sql.withTransaction,
      Effect.mapError((cause) =>
        cause instanceof RpcError ? cause : rpcError("Could not delete channel.", cause),
      ),
    );

  const presetDefinition = (params: {
    readonly name: string;
    readonly template: string;
    readonly fields: ReadonlyArray<ChatPresetField>;
    readonly answer?: ChatPresetAnswer;
  }) =>
    Effect.gen(function* () {
      const name = yield* decodeChatPresetName(params.name.trim()).pipe(
        Effect.mapError((cause) => rpcError("Preset names must be 1 to 80 characters.", cause)),
      );
      const template = yield* decodeChatPresetTemplate(params.template.trim()).pipe(
        Effect.mapError((cause) =>
          rpcError("Preset messages must be 1 to 4000 characters.", cause),
        ),
      );
      const definitionError = validateChatPresetDefinition({ template, fields: params.fields });
      if (definitionError) return yield* Effect.fail(rpcError(definitionError));
      if (params.answer) {
        if (params.answer.context?.length)
          return yield* Effect.fail(rpcError("Preset answers cannot contain message context."));
        const answerError = validateChatPresetAnswerDefinition(
          params.answer,
          params.fields.map((field) => field.name),
        );
        if (answerError) return yield* Effect.fail(rpcError(`Answer: ${answerError}`));
      }
      return { name, template, fields: params.fields, answer: params.answer };
    });

  const createPreset = (params: {
    readonly showId: ShowId;
    readonly name: string;
    readonly template: string;
    readonly fields: ReadonlyArray<ChatPresetField>;
    readonly answer?: ChatPresetAnswer;
  }) =>
    Effect.gen(function* () {
      const definition = yield* presetDefinition(params);
      const id = yield* ids.makeChatPresetId;
      const now = yield* DateTime.now;
      const timestamp = DateTime.formatIso(now);
      yield* sql`INSERT INTO chat_presets
          (id, show_id, name, template, fields_json, answer_json, created_at, updated_at)
        VALUES (${id}, ${params.showId}, ${definition.name}, ${definition.template}, ${JSON.stringify(definition.fields)}, ${definition.answer ? JSON.stringify(definition.answer) : null}, ${timestamp}, ${timestamp})`;
      return {
        id,
        showId: params.showId,
        name: definition.name,
        template: definition.template,
        fields: definition.fields,
        ...(definition.answer === undefined ? {} : { answer: definition.answer }),
        createdAt: now,
        updatedAt: now,
      } satisfies ChatPreset;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof RpcError
          ? cause
          : rpcError("Could not create preset. Preset names must be unique.", cause),
      ),
    );

  const updatePreset = (params: {
    readonly showId: ShowId;
    readonly presetId: ChatPresetId;
    readonly name: string;
    readonly template: string;
    readonly fields: ReadonlyArray<ChatPresetField>;
    readonly answer?: ChatPresetAnswer;
  }) =>
    Effect.gen(function* () {
      const definition = yield* presetDefinition(params);
      const updatedAt = yield* DateTime.now;
      const rows = (yield* sql`UPDATE chat_presets
        SET name = ${definition.name}, template = ${definition.template},
          fields_json = ${JSON.stringify(definition.fields)},
          answer_json = ${definition.answer ? JSON.stringify(definition.answer) : null},
          updated_at = ${DateTime.formatIso(updatedAt)}
        WHERE id = ${params.presetId} AND show_id = ${params.showId}
        RETURNING id, show_id, name, template, fields_json, answer_json, created_at, updated_at`) as unknown as ReadonlyArray<PresetRow>;
      if (rows.length === 0) return yield* Effect.fail(rpcError("Preset not found."));
      return toPreset(rows[0]!)!;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof RpcError
          ? cause
          : rpcError("Could not update preset. Preset names must be unique.", cause),
      ),
    );

  const deletePreset = (params: { readonly showId: ShowId; readonly presetId: ChatPresetId }) =>
    Effect.gen(function* () {
      const rows = (yield* sql`DELETE FROM chat_presets
        WHERE id = ${params.presetId} AND show_id = ${params.showId}
        RETURNING id`) as unknown as ReadonlyArray<{ readonly id: string }>;
      if (rows.length === 0) return yield* Effect.fail(rpcError("Preset not found."));
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof RpcError ? cause : rpcError("Could not delete preset.", cause),
      ),
    );

  const send = (params: {
    readonly showId: ShowId;
    readonly channelId: ChatChannelId;
    readonly senderProfileId: ProfileId;
    readonly body: string;
    readonly messageId?: ChatMessageId;
    readonly parts?: ReadonlyArray<ChatMessagePart>;
    readonly answer?: ChatPresetAnswer;
    readonly replyToMessageId?: ChatMessageId;
  }) =>
    Effect.gen(function* () {
      yield* ensureProfile(params.senderProfileId);
      const body = yield* decodeChatMessageBody(params.body.trim()).pipe(
        Effect.mapError((cause) => rpcError("Messages must be 1 to 4000 characters.", cause)),
      );
      if (params.parts?.length && chatMessagePartsText(params.parts) !== body)
        return yield* Effect.fail(rpcError("The rich message content does not match its text."));
      if (params.answer) {
        const answerError = validateChatPresetAnswerDefinition(
          params.answer,
          params.answer.context?.map((item) => item.name) ?? [],
        );
        if (answerError) return yield* Effect.fail(rpcError(`Answer: ${answerError}`));
      }
      const channel = (yield* sql`SELECT id FROM chat_channels
        WHERE id = ${params.channelId} AND show_id = ${params.showId}`) as unknown as ReadonlyArray<{
        id: string;
      }>;
      if (channel.length === 0) return yield* Effect.fail(rpcError("Channel not found."));
      if (params.replyToMessageId) {
        const request = (yield* sql`SELECT id, answer_json FROM chat_messages
          WHERE id = ${params.replyToMessageId} AND channel_id = ${params.channelId}
            AND show_id = ${params.showId}`) as unknown as ReadonlyArray<{
          readonly id: string;
          readonly answer_json: string | null;
        }>;
        if (request.length === 0)
          return yield* Effect.fail(rpcError("The message being answered was not found."));
        if (request[0]!.answer_json === null)
          return yield* Effect.fail(rpcError("This message does not accept an answer."));
      }
      const id = params.messageId ?? (yield* ids.makeChatMessageId);
      const sentAt = yield* DateTime.now;
      const partsJson = params.parts?.length ? JSON.stringify(params.parts) : null;
      const answerJson = params.answer === undefined ? null : JSON.stringify(params.answer);
      const replyToMessageId = params.replyToMessageId ?? null;
      const inserted = (yield* sql`INSERT INTO chat_messages
          (id, show_id, channel_id, sender_profile_id, body, parts_json, answer_json,
            reply_to_message_id, sent_at)
        VALUES (${id}, ${params.showId}, ${params.channelId}, ${params.senderProfileId}, ${body},
          ${partsJson}, ${answerJson}, ${replyToMessageId}, ${DateTime.formatIso(sentAt)})
        ON CONFLICT(id) DO NOTHING
        RETURNING sequence`) as unknown as ReadonlyArray<{ sequence: number }>;
      let message: ChatMessage;
      if (inserted.length > 0) {
        message = {
          id,
          sequence: Number(inserted[0]!.sequence) as ChatSequence,
          showId: params.showId,
          channelId: params.channelId,
          senderProfileId: params.senderProfileId,
          body,
          ...(params.parts?.length ? { parts: params.parts } : {}),
          ...(params.answer === undefined ? {} : { answer: params.answer }),
          ...(params.replyToMessageId === undefined
            ? {}
            : { replyToMessageId: params.replyToMessageId }),
          sentAt,
        };
      } else {
        const existing = (yield* sql`SELECT
            id, sequence, show_id, channel_id, sender_profile_id, body, parts_json,
            answer_json, reply_to_message_id, sent_at
          FROM chat_messages
          WHERE id = ${id}`) as unknown as ReadonlyArray<MessageRow>;
        const row = existing[0];
        if (
          !row ||
          row.show_id !== params.showId ||
          row.channel_id !== params.channelId ||
          row.sender_profile_id !== params.senderProfileId ||
          row.body !== body ||
          row.parts_json !== partsJson ||
          row.answer_json !== answerJson ||
          row.reply_to_message_id !== replyToMessageId
        )
          return yield* Effect.fail(rpcError("Message id is already in use."));
        message = toMessage(row);
      }
      const sequence = message.sequence;
      yield* sql`INSERT INTO chat_profile_channel_state
          (show_id, channel_id, profile_id, last_read_sequence, notifications_enabled)
        VALUES (${params.showId}, ${params.channelId}, ${params.senderProfileId}, ${sequence}, 1)
        ON CONFLICT(show_id, channel_id, profile_id) DO UPDATE SET
          last_read_sequence = MAX(last_read_sequence, excluded.last_read_sequence)`;
      return message;
    }).pipe(
      sql.withTransaction,
      Effect.mapError((cause) =>
        cause instanceof RpcError ? cause : rpcError("Could not send message.", cause),
      ),
    );

  const markRead = (params: {
    readonly showId: ShowId;
    readonly channelId: ChatChannelId;
    readonly profileId: ProfileId;
    readonly sequence: ChatSequence;
  }) =>
    Effect.gen(function* () {
      yield* ensureProfile(params.profileId);
      yield* sql`INSERT INTO chat_profile_channel_state
          (show_id, channel_id, profile_id, last_read_sequence, notifications_enabled)
        SELECT ${params.showId}, c.id, ${params.profileId},
          MIN(${params.sequence}, COALESCE(MAX(m.sequence), 0)), 1
        FROM chat_channels c
        LEFT JOIN chat_messages m ON m.channel_id = c.id
        WHERE c.id = ${params.channelId} AND c.show_id = ${params.showId}
        GROUP BY c.id
        ON CONFLICT(show_id, channel_id, profile_id) DO UPDATE SET
          last_read_sequence = MAX(last_read_sequence, excluded.last_read_sequence)`;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof RpcError ? cause : rpcError("Could not update chat read state.", cause),
      ),
    );

  const setNotifications = (params: {
    readonly showId: ShowId;
    readonly channelId: ChatChannelId;
    readonly profileId: ProfileId;
    readonly enabled: boolean;
  }) =>
    Effect.gen(function* () {
      yield* ensureProfile(params.profileId);
      yield* sql`INSERT INTO chat_profile_channel_state
          (show_id, channel_id, profile_id, last_read_sequence, notifications_enabled)
        SELECT ${params.showId}, id, ${params.profileId}, 0, ${params.enabled ? 1 : 0}
        FROM chat_channels WHERE id = ${params.channelId} AND show_id = ${params.showId}
        ON CONFLICT(show_id, channel_id, profile_id) DO UPDATE SET
          notifications_enabled = excluded.notifications_enabled`;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof RpcError ? cause : rpcError("Could not update notifications.", cause),
      ),
    );

  const deleteShow = (showId: ShowId) =>
    Effect.all([
      sql`DELETE FROM chat_channels WHERE show_id = ${showId}`,
      sql`DELETE FROM chat_presets WHERE show_id = ${showId}`,
    ]).pipe(
      sql.withTransaction,
      Effect.asVoid,
      Effect.mapError((cause) => rpcError("Could not remove the show's chat.", cause)),
    );

  return ChatService.of({
    state,
    createChannel,
    renameChannel,
    deleteChannel,
    createPreset,
    updatePreset,
    deletePreset,
    send,
    markRead,
    setNotifications,
    deleteShow,
  });
});

export const layerNoDeps = Layer.effect(ChatService, make);
export const layer = layerNoDeps;
