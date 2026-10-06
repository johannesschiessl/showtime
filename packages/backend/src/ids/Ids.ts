import { Context, Effect, Layer, Schema } from "effect";
import { customAlphabet } from "nanoid";
import {
  idAlphabet,
  idSuffixLength,
  MicrophoneId,
  microphoneIdPrefix,
  ShowId,
  showIdPrefix,
  MixId,
  mixIdPrefix,
  ProfileId,
  profileIdPrefix,
  ChatChannelId,
  chatChannelIdPrefix,
  ChatMessageId,
  chatMessageIdPrefix,
  ChatPresetId,
  chatPresetIdPrefix,
} from "@showtime/contracts";

export interface IdsShape {
  readonly makeShowId: Effect.Effect<ShowId>;
  readonly makeMicrophoneId: Effect.Effect<MicrophoneId>;
  readonly makeMixId: Effect.Effect<MixId>;
  readonly makeProfileId: Effect.Effect<ProfileId>;
  readonly makeChatChannelId: Effect.Effect<ChatChannelId>;
  readonly makeChatMessageId: Effect.Effect<ChatMessageId>;
  readonly makeChatPresetId: Effect.Effect<ChatPresetId>;
}

export class Ids extends Context.Service<Ids, IdsShape>()("@showtime/backend/ids/Ids") {}

const makeId = customAlphabet(idAlphabet, idSuffixLength);

export const layer = Layer.succeed(
  Ids,
  Ids.of({
    makeShowId: Effect.sync(() => `${showIdPrefix}${makeId()}`).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ShowId)),
      Effect.orDie,
    ),
    makeMicrophoneId: Effect.sync(() => `${microphoneIdPrefix}${makeId()}`).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(MicrophoneId)),
      Effect.orDie,
    ),
    makeMixId: Effect.sync(() => `${mixIdPrefix}${makeId()}`).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(MixId)),
      Effect.orDie,
    ),
    makeProfileId: Effect.sync(() => `${profileIdPrefix}${makeId()}`).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ProfileId)),
      Effect.orDie,
    ),
    makeChatChannelId: Effect.sync(() => `${chatChannelIdPrefix}${makeId()}`).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ChatChannelId)),
      Effect.orDie,
    ),
    makeChatMessageId: Effect.sync(() => `${chatMessageIdPrefix}${makeId()}`).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ChatMessageId)),
      Effect.orDie,
    ),
    makeChatPresetId: Effect.sync(() => `${chatPresetIdPrefix}${makeId()}`).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ChatPresetId)),
      Effect.orDie,
    ),
  }),
);
