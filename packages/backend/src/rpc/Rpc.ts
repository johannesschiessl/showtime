import { Effect, Layer } from "effect";
import { RpcServer } from "effect/rpc";
import {
  microphonesSyncKey,
  mixesSyncKey,
  showsSyncKey,
  ShowtimeRpcs,
  songsSyncKey,
  profilesSyncKey,
  chatsSyncKey,
} from "@showtime/contracts";
import { MicrophoneService } from "../microphones/MicrophoneService.js";
import { MixService } from "../mixes/MixService.js";
import { ShowService } from "../shows/ShowService.js";
import { ShowRepository } from "../shows/ShowRepository.js";
import { SongService } from "../songs/SongService.js";
import { SyncEngine } from "../sync/SyncEngine.js";
import { ProfileService } from "../profiles/ProfileService.js";
import { ChatService } from "../chats/ChatService.js";
import { LiveGuard } from "../live/LiveGuard.js";

const handlers = ShowtimeRpcs.toLayer(
  Effect.gen(function* () {
    const shows = yield* ShowService;
    const showRepository = yield* ShowRepository;
    const microphones = yield* MicrophoneService;
    const mixes = yield* MixService;
    const songs = yield* SongService;
    const sync = yield* SyncEngine;
    const profiles = yield* ProfileService;
    const chats = yield* ChatService;
    const live = yield* LiveGuard;
    return ShowtimeRpcs.of({
      "live.heartbeat": ({ sessionId, showId }) => live.heartbeat(sessionId, showId),
      "live.release": ({ sessionId }) => live.release(sessionId),
      "shows.list": () => sync.query(showsSyncKey, shows.list),
      "shows.create": ({ name, color }) =>
        sync.mutation(showsSyncKey, shows.create({ name, color })),
      "shows.edit": ({ id, name, color }) =>
        sync.mutation(showsSyncKey, shows.edit({ id, name, color })),
      "shows.delete": ({ id }) =>
        sync.mutation(
          [
            ...showsSyncKey,
            ...microphonesSyncKey(id),
            ...mixesSyncKey(id),
            ...songsSyncKey(id),
            ...chatsSyncKey(id),
          ],
          shows.delete(id).pipe(Effect.andThen(chats.deleteShow(id))),
        ),
      "profiles.list": () => sync.query(profilesSyncKey, profiles.list),
      "profiles.create": ({ name, color }) =>
        sync.mutation(profilesSyncKey, profiles.create({ name, color })),
      "profiles.edit": ({ id, name, color }) =>
        sync.mutation(profilesSyncKey, profiles.edit({ id, name, color })),
      "profiles.delete": ({ id }) => sync.mutation(profilesSyncKey, profiles.delete(id)),
      "profiles.setDefault": ({ id }) => sync.mutation(profilesSyncKey, profiles.setDefault(id)),
      "chats.state": ({ showId, profileId }) =>
        sync.query(
          chatsSyncKey(showId),
          showRepository.findById(showId).pipe(Effect.andThen(chats.state(showId, profileId))),
        ),
      "chats.createChannel": ({ showId, name }) =>
        sync.mutation(chatsSyncKey(showId), chats.createChannel({ showId, name })),
      "chats.renameChannel": ({ showId, channelId, name }) =>
        sync.mutation(chatsSyncKey(showId), chats.renameChannel({ showId, channelId, name })),
      "chats.deleteChannel": ({ showId, channelId }) =>
        sync.mutation(chatsSyncKey(showId), chats.deleteChannel({ showId, channelId })),
      "chats.send": ({
        showId,
        channelId,
        senderProfileId,
        body,
        messageId,
        parts,
        answer,
        replyToMessageId,
      }) =>
        sync.mutation(
          chatsSyncKey(showId),
          chats.send({
            showId,
            channelId,
            senderProfileId,
            body,
            ...(messageId === undefined ? {} : { messageId }),
            ...(parts === undefined ? {} : { parts }),
            ...(answer === undefined ? {} : { answer }),
            ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
          }),
        ),
      "chats.createPreset": ({ showId, name, template, fields, answer }) =>
        sync.mutation(
          chatsSyncKey(showId),
          chats.createPreset({
            showId,
            name,
            template,
            fields,
            ...(answer === undefined ? {} : { answer }),
          }),
        ),
      "chats.updatePreset": ({ showId, presetId, name, template, fields, answer }) =>
        sync.mutation(
          chatsSyncKey(showId),
          chats.updatePreset({
            showId,
            presetId,
            name,
            template,
            fields,
            ...(answer === undefined ? {} : { answer }),
          }),
        ),
      "chats.deletePreset": ({ showId, presetId }) =>
        sync.mutation(chatsSyncKey(showId), chats.deletePreset({ showId, presetId })),
      "chats.markRead": ({ showId, channelId, profileId, sequence }) =>
        sync.mutation(
          chatsSyncKey(showId),
          chats.markRead({ showId, channelId, profileId, sequence }),
        ),
      "chats.setNotifications": ({ showId, channelId, profileId, enabled }) =>
        sync.mutation(
          chatsSyncKey(showId),
          chats.setNotifications({ showId, channelId, profileId, enabled }),
        ),
      "microphones.list": ({ showId }) =>
        sync.query(microphonesSyncKey(showId), microphones.list(showId)),
      "microphones.create": ({ showId, color }) =>
        sync.mutation(microphonesSyncKey(showId), microphones.create({ showId, color })),
      "microphones.edit": ({ showId, id, number, color, name }) =>
        sync.mutation(
          microphonesSyncKey(showId),
          microphones.edit({
            showId,
            id,
            number,
            color,
            ...(name === undefined ? {} : { name }),
          }),
        ),
      "microphones.delete": ({ showId, id }) =>
        sync.mutation(microphonesSyncKey(showId), microphones.delete({ showId, id })),
      "mixes.list": ({ showId }) => sync.query(mixesSyncKey(showId), mixes.list(showId)),
      "mixes.create": ({ showId, color }) =>
        sync.mutation(mixesSyncKey(showId), mixes.create({ showId, color })),
      "mixes.edit": ({ showId, id, number, color, name }) =>
        sync.mutation(
          mixesSyncKey(showId),
          mixes.edit({ showId, id, number, color, ...(name === undefined ? {} : { name }) }),
        ),
      "mixes.delete": ({ showId, id }) =>
        sync.mutation(mixesSyncKey(showId), mixes.delete({ showId, id })),
      "songs.list": ({ showId }) => sync.query(songsSyncKey(showId), songs.list(showId)),
      "songs.create": ({ showId, id, name, artist, insertAfterSongId }) =>
        sync.mutation(
          songsSyncKey(showId),
          songs.create({ showId, id, name, artist, insertAfterSongId }),
        ),
      "songs.edit": ({
        showId,
        id,
        name,
        artist,
        notes,
        mixAssignments,
        microphoneNames,
        mixNames,
      }) =>
        sync.mutation(
          songsSyncKey(showId),
          songs.edit({
            showId,
            id,
            name,
            artist,
            mixAssignments,
            microphoneNames,
            mixNames,
            ...(notes === undefined ? {} : { notes }),
          }),
        ),
      "songs.reorder": ({ showId, orderedSongIds }) =>
        sync.mutation(songsSyncKey(showId), songs.reorder({ showId, orderedSongIds })),
      "songs.delete": ({ showId, id }) =>
        sync.mutation(songsSyncKey(showId), songs.delete({ showId, id })),
    });
  }),
);

export const layer = RpcServer.layer(ShowtimeRpcs, { disableFatalDefects: true }).pipe(
  Layer.provide(handlers),
);
