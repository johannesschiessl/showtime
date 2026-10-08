import { Schema } from "effect";
import { Rpc, RpcGroup as EffectRpcGroup } from "effect/rpc";
import { Microphone, MicrophoneId, MicrophoneNumber } from "./microphone.js";
import { Mix, MixId, MixNumber } from "./mix.js";
import {
  Song,
  SongArtist,
  SongId,
  SongMicrophoneName,
  SongMixName,
  SongMixAssignment,
  SongName,
} from "./song.js";
import { Color, ShowId, ShowName, ShowSummary } from "./show.js";
import { LiveSessionId } from "./live.js";
import { Profile, ProfileId, ProfileName, ProfilesState } from "./profile.js";
import {
  ChatChannel,
  ChatChannelId,
  ChatChannelName,
  ChatMessage,
  ChatMessageBody,
  ChatMessageId,
  ChatMessagePart,
  ChatPreset,
  ChatPresetAnswer,
  ChatPresetField,
  ChatPresetId,
  ChatPresetName,
  ChatPresetTemplate,
  ChatSequence,
  ChatSnapshot,
} from "./chat.js";

export class RpcError extends Schema.TaggedError<RpcError>()("RpcError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const ShowtimeRpcs = EffectRpcGroup.make(
  Rpc.make("live.heartbeat", {
    payload: { sessionId: LiveSessionId, showId: ShowId },
    success: Schema.Boolean,
    error: RpcError,
  }),
  Rpc.make("live.release", {
    payload: { sessionId: LiveSessionId },
    success: Schema.Void,
    error: RpcError,
  }),
  Rpc.make("shows.list", { success: Schema.Array(ShowSummary), error: RpcError, stream: true }),
  Rpc.make("shows.create", {
    payload: { name: ShowName, color: Color },
    success: ShowSummary,
    error: RpcError,
  }),
  Rpc.make("shows.edit", {
    payload: { id: ShowId, name: ShowName, color: Color },
    success: ShowSummary,
    error: RpcError,
  }),
  Rpc.make("shows.delete", {
    payload: { id: ShowId },
    success: Schema.Void,
    error: RpcError,
  }),
  Rpc.make("profiles.list", {
    success: ProfilesState,
    error: RpcError,
    stream: true,
  }),
  Rpc.make("profiles.create", {
    payload: { name: ProfileName, color: Color },
    success: Profile,
    error: RpcError,
  }),
  Rpc.make("profiles.edit", {
    payload: { id: ProfileId, name: ProfileName, color: Color },
    success: Profile,
    error: RpcError,
  }),
  Rpc.make("profiles.delete", {
    payload: { id: ProfileId },
    success: Schema.Void,
    error: RpcError,
  }),
  Rpc.make("profiles.setDefault", {
    payload: { id: ProfileId },
    success: Schema.Void,
    error: RpcError,
  }),
  Rpc.make("chats.state", {
    payload: { showId: ShowId, profileId: ProfileId },
    success: ChatSnapshot,
    error: RpcError,
    stream: true,
  }),
  Rpc.make("chats.createChannel", {
    payload: { showId: ShowId, name: ChatChannelName },
    success: ChatChannel,
    error: RpcError,
  }),
  Rpc.make("chats.renameChannel", {
    payload: { showId: ShowId, channelId: ChatChannelId, name: ChatChannelName },
    success: Schema.Void,
    error: RpcError,
  }),
  Rpc.make("chats.deleteChannel", {
    payload: { showId: ShowId, channelId: ChatChannelId },
    success: Schema.Void,
    error: RpcError,
  }),
  Rpc.make("chats.send", {
    payload: {
      showId: ShowId,
      channelId: ChatChannelId,
      senderProfileId: ProfileId,
      body: ChatMessageBody,
      messageId: Schema.optional(ChatMessageId),
      parts: Schema.optional(Schema.Array(ChatMessagePart)),
      answer: Schema.optional(ChatPresetAnswer),
      replyToMessageId: Schema.optional(ChatMessageId),
    },
    success: ChatMessage,
    error: RpcError,
  }),
  Rpc.make("chats.createPreset", {
    payload: {
      showId: ShowId,
      name: ChatPresetName,
      template: ChatPresetTemplate,
      fields: Schema.Array(ChatPresetField),
      answer: Schema.optional(ChatPresetAnswer),
    },
    success: ChatPreset,
    error: RpcError,
  }),
  Rpc.make("chats.updatePreset", {
    payload: {
      showId: ShowId,
      presetId: ChatPresetId,
      name: ChatPresetName,
      template: ChatPresetTemplate,
      fields: Schema.Array(ChatPresetField),
      answer: Schema.optional(ChatPresetAnswer),
    },
    success: ChatPreset,
    error: RpcError,
  }),
  Rpc.make("chats.deletePreset", {
    payload: { showId: ShowId, presetId: ChatPresetId },
    success: Schema.Void,
    error: RpcError,
  }),
  Rpc.make("chats.markRead", {
    payload: {
      showId: ShowId,
      channelId: ChatChannelId,
      profileId: ProfileId,
      sequence: ChatSequence,
    },
    success: Schema.Void,
    error: RpcError,
  }),
  Rpc.make("chats.setNotifications", {
    payload: {
      showId: ShowId,
      channelId: ChatChannelId,
      profileId: ProfileId,
      enabled: Schema.Boolean,
    },
    success: Schema.Void,
    error: RpcError,
  }),
  Rpc.make("microphones.list", {
    payload: { showId: ShowId },
    success: Schema.Array(Microphone),
    error: RpcError,
    stream: true,
  }),
  Rpc.make("microphones.create", {
    payload: { showId: ShowId, color: Color },
    success: Microphone,
    error: RpcError,
  }),
  Rpc.make("microphones.edit", {
    payload: {
      showId: ShowId,
      id: MicrophoneId,
      number: MicrophoneNumber,
      color: Color,
      name: Schema.optional(Schema.String),
    },
    success: Microphone,
    error: RpcError,
  }),
  Rpc.make("microphones.delete", {
    payload: { showId: ShowId, id: MicrophoneId },
    success: Schema.Void,
    error: RpcError,
  }),
  Rpc.make("mixes.list", {
    payload: { showId: ShowId },
    success: Schema.Array(Mix),
    error: RpcError,
    stream: true,
  }),
  Rpc.make("mixes.create", {
    payload: { showId: ShowId, color: Color },
    success: Mix,
    error: RpcError,
  }),
  Rpc.make("mixes.edit", {
    payload: {
      showId: ShowId,
      id: MixId,
      number: MixNumber,
      color: Color,
      name: Schema.optional(Schema.String),
    },
    success: Mix,
    error: RpcError,
  }),
  Rpc.make("mixes.delete", {
    payload: { showId: ShowId, id: MixId },
    success: Schema.Void,
    error: RpcError,
  }),
  Rpc.make("songs.list", {
    payload: { showId: ShowId },
    success: Schema.Array(Song),
    error: RpcError,
    stream: true,
  }),
  Rpc.make("songs.create", {
    payload: {
      showId: ShowId,
      id: SongId,
      name: SongName,
      artist: SongArtist,
      insertAfterSongId: Schema.optional(SongId),
    },
    success: Song,
    error: RpcError,
  }),
  Rpc.make("songs.edit", {
    payload: {
      showId: ShowId,
      id: SongId,
      name: SongName,
      artist: SongArtist,
      notes: Schema.optional(Schema.String),
      mixAssignments: Schema.Array(SongMixAssignment),
      microphoneNames: Schema.Array(SongMicrophoneName),
      mixNames: Schema.Array(SongMixName),
    },
    success: Song,
    error: RpcError,
  }),
  Rpc.make("songs.reorder", {
    payload: { showId: ShowId, orderedSongIds: Schema.Array(SongId) },
    success: Schema.Array(Song),
    error: RpcError,
  }),
  Rpc.make("songs.delete", {
    payload: { showId: ShowId, id: SongId },
    success: Schema.Void,
    error: RpcError,
  }),
);
