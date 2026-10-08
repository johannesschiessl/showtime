import { Effect, Exit, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MicrophoneNumber,
  MixNumber,
  ChatPresetTemplate,
  type ChatMessageBody,
  type ChatMessagePart,
  type ChatPresetField,
} from "@showtime/contracts";
import { makeDatabaseTestLayer } from "../database/DatabaseTest.js";
import * as Ids from "../ids/Ids.js";
import * as ProfileService from "../profiles/ProfileService.js";
import * as ShowRepository from "../shows/ShowRepository.js";
import { ShowService } from "../shows/ShowService.js";
import * as ShowServiceLayer from "../shows/ShowService.js";
import { ChatService, layer } from "./ChatService.js";

const homes: Array<string> = [];

const makeLayer = (home: string) => {
  const profiles = ProfileService.layer.pipe(Layer.provideMerge(Ids.layer));
  const shows = ShowServiceLayer.layer.pipe(
    Layer.provideMerge(Ids.layer),
    Layer.provideMerge(ShowRepository.layer),
  );
  const chats = layer.pipe(Layer.provideMerge(Layer.mergeAll(Ids.layer, profiles)));
  return Layer.mergeAll(chats, profiles, shows, Ids.layer).pipe(
    Layer.provide(makeDatabaseTestLayer(home)),
  );
};

const makeShowId = Effect.flatMap(ShowService, (shows) =>
  shows.create({ name: "Chat test", color: "sky" }).pipe(Effect.map((show) => show.id)),
);

const withService = <A>(
  home: string,
  effect: Effect.Effect<
    A,
    unknown,
    ChatService | Ids.Ids | ProfileService.ProfileService | ShowService
  >,
) => Effect.runPromise(effect.pipe(Effect.provide(makeLayer(home))));

const withDatabase = <A>(home: string, effect: Effect.Effect<A, unknown, SqlClient.SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(makeDatabaseTestLayer(home))));

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("ChatService", () => {
  it("persists channels, ordered messages, per-profile read state, and notification settings", async () => {
    const home = await mkdtemp(join(tmpdir(), "showtime-chat-"));
    homes.push(home);

    const initial = await withService(
      home,
      Effect.gen(function* () {
        const profiles = yield* ProfileService.ProfileService;
        const chats = yield* ChatService;
        const showId = yield* makeShowId;
        const senderProfileId = (yield* profiles.list).defaultProfileId;
        const profileId = (yield* profiles.create({ name: "Receiver", color: "violet" })).id;
        const state = yield* chats.state(showId, profileId);
        const general = state.channels[0]!;
        yield* Effect.forEach(
          Array.from({ length: 30 }, (_, index) => index),
          (index) =>
            chats.send({
              showId,
              channelId: general.id,
              senderProfileId,
              body: `Message ${index}` as ChatMessageBody,
            }),
          { concurrency: 1 },
        );
        const unread = yield* chats.state(showId, profileId);
        const latest = unread.channels[0]!;
        yield* chats.markRead({
          showId,
          channelId: general.id,
          profileId,
          sequence: latest.newestSequence,
        });
        yield* chats.setNotifications({
          showId,
          channelId: general.id,
          profileId,
          enabled: false,
        });
        yield* chats.createChannel({ showId, name: "Production" });
        return { showId, profileId, unread };
      }),
    );

    expect(initial.unread.channels[0]).toMatchObject({
      messageCount: 30,
      incomingMessageCount: 30,
      unreadCount: 30,
    });
    expect(initial.unread.channels[0]!.messages.map((message) => message.body)).toEqual(
      Array.from({ length: 30 }, (_, index) => `Message ${index}`),
    );

    const reloaded = await withService(
      home,
      Effect.gen(function* () {
        const chats = yield* ChatService;
        return yield* chats.state(initial.showId, initial.profileId);
      }),
    );
    expect(reloaded.channels.map((channel) => channel.name)).toEqual(["General", "Production"]);
    expect(reloaded.channels[0]).toMatchObject({ unreadCount: 0, notificationsEnabled: false });
  });

  it("retains deleted sender ids and bounds replay while reporting the exact total count", async () => {
    const home = await mkdtemp(join(tmpdir(), "showtime-chat-"));
    homes.push(home);

    const result = await withService(
      home,
      Effect.gen(function* () {
        const profiles = yield* ProfileService.ProfileService;
        const chats = yield* ChatService;
        const showId = yield* makeShowId;
        const deletedProfileId = (yield* profiles.list).defaultProfileId;
        const replacement = yield* profiles.create({ name: "Replacement", color: "green" });
        const channel = (yield* chats.state(showId, deletedProfileId)).channels[0]!;
        yield* Effect.forEach(
          Array.from({ length: 120 }, (_, index) => index),
          (index) =>
            chats.send({
              showId,
              channelId: channel.id,
              senderProfileId: deletedProfileId,
              body: `Replay ${index}` as ChatMessageBody,
            }),
          { concurrency: 1 },
        );
        yield* profiles.setDefault(replacement.id);
        yield* profiles.delete(deletedProfileId);
        const secondChannel = yield* chats.createChannel({ showId, name: "Production" });
        yield* Effect.forEach(
          Array.from({ length: 105 }, (_, index) => index),
          (index) =>
            chats.send({
              showId,
              channelId: secondChannel.id,
              senderProfileId: replacement.id,
              body: `Production replay ${index}` as ChatMessageBody,
            }),
          { concurrency: 1 },
        );
        const snapshot = yield* chats.state(showId, replacement.id);
        yield* chats.deleteShow(showId);
        const cleared = yield* chats.state(showId, replacement.id);
        return { snapshot, deletedProfileId, cleared };
      }),
    );

    const channel = result.snapshot.channels[0]!;
    expect(channel.messageCount).toBe(120);
    expect(channel.messages).toHaveLength(100);
    expect(channel.messages[0]!.body).toBe("Replay 20");
    expect(
      channel.messages.every((message) => message.senderProfileId === result.deletedProfileId),
    ).toBe(true);
    expect(result.deletedProfileId).toMatch(/^profile_/);
    expect(result.snapshot.channels[1]!.messageCount).toBe(105);
    expect(result.snapshot.channels[1]!.messages).toHaveLength(100);
    expect(result.snapshot.channels[1]!.messages[0]!.body).toBe("Production replay 5");
    expect(result.cleared.channels).toMatchObject([
      { name: "General", messageCount: 0, messages: [] },
    ]);
  });

  it("renames channels, deletes their related data, and preserves the final channel", async () => {
    const home = await mkdtemp(join(tmpdir(), "showtime-chat-"));
    homes.push(home);

    const result = await withService(
      home,
      Effect.gen(function* () {
        const profiles = yield* ProfileService.ProfileService;
        const chats = yield* ChatService;
        const showId = yield* makeShowId;
        const profileId = (yield* profiles.list).defaultProfileId;
        const general = (yield* chats.state(showId, profileId)).channels[0]!;
        const production = yield* chats.createChannel({ showId, name: "Production" });
        yield* chats.send({
          showId,
          channelId: production.id,
          senderProfileId: profileId,
          body: "Delete this history",
        });
        yield* chats.setNotifications({
          showId,
          channelId: production.id,
          profileId,
          enabled: false,
        });
        yield* chats.renameChannel({ showId, channelId: production.id, name: "  Crew  " });
        const renamed = yield* chats.state(showId, profileId);
        yield* chats.deleteChannel({ showId, channelId: production.id });
        const afterDelete = yield* chats.state(showId, profileId);
        const finalChannelDelete = yield* Effect.exit(
          chats.deleteChannel({ showId, channelId: general.id }),
        );
        return { showId, profileId, renamed, afterDelete, finalChannelDelete };
      }),
    );

    expect(result.renamed.channels[1]).toMatchObject({
      name: "Crew",
      messageCount: 1,
      notificationsEnabled: false,
    });
    expect(result.afterDelete.channels.map((channel) => channel.name)).toEqual(["General"]);
    expect(Exit.isFailure(result.finalChannelDelete)).toBe(true);

    const reloaded = await withService(
      home,
      Effect.gen(function* () {
        const chats = yield* ChatService;
        return yield* chats.state(result.showId, result.profileId);
      }),
    );
    expect(reloaded.channels.map((channel) => channel.name)).toEqual(["General"]);
  });

  it("persists show-scoped presets and rich messages through create, update, and delete", async () => {
    const home = await mkdtemp(join(tmpdir(), "showtime-chat-"));
    homes.push(home);

    const initial = await withService(
      home,
      Effect.gen(function* () {
        const ids = yield* Ids.Ids;
        const profiles = yield* ProfileService.ProfileService;
        const chats = yield* ChatService;
        const showId = yield* makeShowId;
        const otherShowId = yield* makeShowId;
        const profileId = (yield* profiles.list).defaultProfileId;
        const preset = yield* chats.createPreset({
          showId,
          name: "Monitor request",
          template: "Put {{mic}} in {{mix}}",
          fields: [
            { name: "mic", type: "microphone" },
            { name: "mix", type: "mix" },
          ] satisfies ReadonlyArray<ChatPresetField>,
          answer: {
            template: ChatPresetTemplate.make("{{mic}} is {{status}}"),
            fields: [{ name: "status", type: "select", options: ["Done", "Working"] }],
          },
        });
        const channel = (yield* chats.state(showId, profileId)).channels[0]!;
        const microphoneId = yield* ids.makeMicrophoneId;
        const mixId = yield* ids.makeMixId;
        const parts = [
          { type: "text", text: "Put " },
          {
            type: "microphone",
            id: microphoneId,
            number: MicrophoneNumber.make("7"),
            color: "violet",
            name: "Lead",
            text: "Mic 7 (Lead)",
          },
          { type: "text", text: " in " },
          {
            type: "mix",
            id: mixId,
            number: MixNumber.make("3"),
            color: "blue",
            text: "Mix 3",
          },
        ] as const satisfies ReadonlyArray<ChatMessagePart>;
        const request = yield* chats.send({
          showId,
          channelId: channel.id,
          senderProfileId: profileId,
          body: "Put Mic 7 (Lead) in Mix 3",
          parts,
          answer: preset.answer
            ? { ...preset.answer, context: [{ name: "mic", part: parts[1]! }] }
            : undefined,
        });
        yield* chats.send({
          showId,
          channelId: channel.id,
          senderProfileId: profileId,
          body: "Done at 5",
          replyToMessageId: request.id,
        });
        const updated = yield* chats.updatePreset({
          showId,
          presetId: preset.id,
          name: "Monitor level",
          template: "Set {{mix}} to {{level}}",
          fields: [
            { name: "mix", type: "mix" },
            { name: "level", type: "number" },
          ],
          answer: {
            template: ChatPresetTemplate.make("{{status}}"),
            fields: [{ name: "status", type: "select", options: ["Done", "Not yet"] }],
          },
        });
        const otherShow = yield* chats.state(otherShowId, profileId);
        return { showId, otherShowId, profileId, preset, updated, otherShow };
      }),
    );

    expect(initial.updated).toMatchObject({
      name: "Monitor level",
      answer: { template: "{{status}}" },
    });
    expect(initial.otherShow.presets).toEqual([]);

    const reloaded = await withService(
      home,
      Effect.gen(function* () {
        const chats = yield* ChatService;
        const snapshot = yield* chats.state(initial.showId, initial.profileId);
        yield* chats.deletePreset({ showId: initial.showId, presetId: initial.preset.id });
        const afterDelete = yield* chats.state(initial.showId, initial.profileId);
        return { snapshot, afterDelete };
      }),
    );
    expect(reloaded.snapshot.presets).toHaveLength(1);
    expect(reloaded.snapshot.channels[0]!.messages[0]).toMatchObject({
      body: "Put Mic 7 (Lead) in Mix 3",
      parts: [
        { type: "text", text: "Put " },
        { type: "microphone", number: "7", color: "violet" },
        { type: "text", text: " in " },
        { type: "mix", number: "3", color: "blue" },
      ],
      answer: {
        template: "{{mic}} is {{status}}",
        fields: [{ name: "status", type: "select", options: ["Done", "Working"] }],
        context: [{ name: "mic", part: { type: "microphone", number: "7" } }],
      },
    });
    expect(reloaded.snapshot.channels[0]!.messages[1]).toMatchObject({
      body: "Done at 5",
      replyToMessageId: reloaded.snapshot.channels[0]!.messages[0]!.id,
    });
    expect(reloaded.snapshot.presets[0]).toMatchObject({
      answer: { template: "{{status}}" },
    });
    expect(reloaded.afterDelete.presets).toEqual([]);
  });

  it("skips a malformed stored preset without hiding usable chat state", async () => {
    const home = await mkdtemp(join(tmpdir(), "showtime-chat-"));
    homes.push(home);

    const initial = await withService(
      home,
      Effect.gen(function* () {
        const profiles = yield* ProfileService.ProfileService;
        const chats = yield* ChatService;
        const showId = yield* makeShowId;
        const profileId = (yield* profiles.list).defaultProfileId;
        const preset = yield* chats.createPreset({
          showId,
          name: "Usable preset",
          template: "Check {{mic}}",
          fields: [{ name: "mic", type: "microphone" }],
        });
        return { showId, profileId, preset };
      }),
    );

    await withDatabase(
      home,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO chat_presets
            (id, show_id, name, template, fields_json, answer_json, created_at, updated_at)
          VALUES (${"preset_malformed"}, ${initial.showId}, ${"Malformed preset"},
            ${"Malformed"}, ${"{"}, ${null},
            ${"2026-01-01T00:00:00.000Z"}, ${"2026-01-01T00:00:00.000Z"})`;
      }),
    );

    const snapshot = await withService(
      home,
      Effect.gen(function* () {
        const chats = yield* ChatService;
        return yield* chats.state(initial.showId, initial.profileId);
      }),
    );

    expect(snapshot.channels).toHaveLength(1);
    expect(snapshot.presets.map((preset) => preset.id)).toEqual([initial.preset.id]);
  });

  it("deletes chat history containing replies", async () => {
    const home = await mkdtemp(join(tmpdir(), "showtime-chat-"));
    homes.push(home);

    const result = await withService(
      home,
      Effect.gen(function* () {
        const profiles = yield* ProfileService.ProfileService;
        const chats = yield* ChatService;
        const showId = yield* makeShowId;
        const profileId = (yield* profiles.list).defaultProfileId;
        const channel = (yield* chats.state(showId, profileId)).channels[0]!;
        const request = yield* chats.send({
          showId,
          channelId: channel.id,
          senderProfileId: profileId,
          body: "Can you check this?",
          answer: {
            template: ChatPresetTemplate.make("{{status}}"),
            fields: [{ name: "status", type: "select", options: ["Done"] }],
          },
        });
        yield* chats.send({
          showId,
          channelId: channel.id,
          senderProfileId: profileId,
          body: "Done",
          replyToMessageId: request.id,
        });
        yield* chats.deleteShow(showId);
        return yield* chats.state(showId, profileId);
      }),
    );

    expect(result.channels).toMatchObject([{ name: "General", messageCount: 0, messages: [] }]);
  });

  it("treats an empty rich-parts array as a plain message", async () => {
    const home = await mkdtemp(join(tmpdir(), "showtime-chat-"));
    homes.push(home);

    const message = await withService(
      home,
      Effect.gen(function* () {
        const profiles = yield* ProfileService.ProfileService;
        const chats = yield* ChatService;
        const showId = yield* makeShowId;
        const profileId = (yield* profiles.list).defaultProfileId;
        const channel = (yield* chats.state(showId, profileId)).channels[0]!;
        return yield* chats.send({
          showId,
          channelId: channel.id,
          senderProfileId: profileId,
          body: "Plain message",
          parts: [],
        });
      }),
    );

    expect(message).toMatchObject({ body: "Plain message" });
    expect(message).not.toHaveProperty("parts");
  });

  it("deduplicates retries that use the same client-generated message id", async () => {
    const home = await mkdtemp(join(tmpdir(), "showtime-chat-"));
    homes.push(home);

    const result = await withService(
      home,
      Effect.gen(function* () {
        const ids = yield* Ids.Ids;
        const profiles = yield* ProfileService.ProfileService;
        const chats = yield* ChatService;
        const showId = yield* makeShowId;
        const profileId = (yield* profiles.list).defaultProfileId;
        const channel = (yield* chats.state(showId, profileId)).channels[0]!;
        const messageId = yield* ids.makeChatMessageId;
        const first = yield* chats.send({
          showId,
          channelId: channel.id,
          senderProfileId: profileId,
          body: "One logical message",
          messageId,
        });
        const retried = yield* chats.send({
          showId,
          channelId: channel.id,
          senderProfileId: profileId,
          body: "One logical message",
          messageId,
        });
        const conflictingRetry = yield* Effect.exit(
          chats.send({
            showId,
            channelId: channel.id,
            senderProfileId: profileId,
            body: "Different message",
            messageId,
          }),
        );
        const snapshot = yield* chats.state(showId, profileId);
        return { first, retried, conflictingRetry, snapshot };
      }),
    );

    expect(result.retried).toEqual(result.first);
    expect(result.snapshot.channels[0]).toMatchObject({ messageCount: 1 });
    expect(result.snapshot.channels[0]!.messages.map((message) => message.body)).toEqual([
      "One logical message",
    ]);
    expect(Exit.isFailure(result.conflictingRetry)).toBe(true);
  });
});
