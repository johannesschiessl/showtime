import { DateTime, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  MicrophoneId,
  MicrophoneNumber,
  ShowId,
  ShowName,
  nextMicrophoneNumber,
  type Microphone,
} from "@showtime/contracts";
import * as Ids from "../ids/Ids.js";
import { ShowRepository, type ShowDocument } from "../shows/ShowRepository.js";
import { makeNumberedResourceService } from "./NumberedResourceService.js";

const now = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const microphone: Microphone = {
  id: MicrophoneId.make("mic_0123456789abcdef"),
  number: MicrophoneNumber.make("1"),
  color: "sky",
  name: "Original",
  createdAt: now,
  updatedAt: now,
};
const original: ShowDocument = {
  config: {
    id: ShowId.make("show_0123456789abcdef"),
    name: ShowName.make("Soundcheck"),
    color: "sky",
    createdAt: now,
    updatedAt: now,
  },
  microphones: [microphone],
  mixes: [],
  songs: [],
};

const make = makeNumberedResourceService<Microphone, MicrophoneId, MicrophoneNumber>({
  resourceName: "microphone",
  getResources: (document) => document.microphones,
  withResources: (document, microphones) => ({ ...document, microphones }),
  makeId: (ids) => ids.makeMicrophoneId,
  nextNumber: nextMicrophoneNumber,
});

// Reads outside the update see an older snapshot than the transaction callback.
const editAgainst = async (current: ShowDocument, name?: string) => {
  let persisted = current;
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* make;
      return yield* Effect.result(
        service.edit({
          showId: original.config.id,
          id: microphone.id,
          number: MicrophoneNumber.make("2"),
          color: "rose",
          ...(name === undefined ? {} : { name }),
        }),
      );
    }).pipe(
      Effect.provideService(
        ShowRepository,
        ShowRepository.of({
          list: Effect.succeed([original]),
          findById: () => Effect.succeed(original),
          insert: () => Effect.void,
          delete: () => Effect.void,
          update: (_id, update) =>
            Effect.sync(() => {
              persisted = update(persisted);
              return persisted;
            }),
        }),
      ),
      Effect.provide(Ids.layer),
    ),
  );
  return { result, persisted };
};

describe("NumberedResourceService edits", () => {
  it("preserves a name changed since an older read when the edit omits it", async () => {
    const { result, persisted } = await editAgainst({
      ...original,
      microphones: [{ ...microphone, name: "Newer name" }],
    });
    expect(result._tag).toBe("Success");
    expect(persisted.microphones[0]).toMatchObject({
      number: "2",
      color: "rose",
      name: "Newer name",
    });
    if (result._tag === "Success") expect(result.success).toEqual(persisted.microphones[0]);
  });

  it.each(["deleted", "missing"])(
    "rejects editing a resource that is %s at write time",
    async (state) => {
      const current: ShowDocument = {
        ...original,
        microphones: state === "deleted" ? [{ ...microphone, deletedAt: now }] : [],
      };
      const { result, persisted } = await editAgainst(current);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure.message).toBe("Microphone not found.");
      expect(persisted).toBe(current);
    },
  );

  it.each([
    { name: "  New name  ", expected: "New name" },
    { name: "   ", expected: undefined },
  ])("applies explicit name edits including clearing a name", async ({ name, expected }) => {
    const { result, persisted } = await editAgainst(original, name);
    expect(result._tag).toBe("Success");
    expect(persisted.microphones[0]!.name).toBe(expected);
  });
});
