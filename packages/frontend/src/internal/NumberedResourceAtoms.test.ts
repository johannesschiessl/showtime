import {
  type Color,
  MicrophoneId,
  MicrophoneNumber,
  nextMicrophoneNumber,
  ShowId,
} from "@showtime/contracts";
import { DateTime, Deferred, Effect, Exit } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { executeMutation } from "../rpc/Mutation.js";
import {
  makeNumberedResourceAtomFamily,
  type NumberedResourceListItem,
} from "./NumberedResourceAtoms.js";

type Item = NumberedResourceListItem<MicrophoneId, MicrophoneNumber>;
type CreateInput = { readonly payload: { readonly showId: ShowId; readonly color: Color } };
type EditInput = {
  readonly payload: {
    readonly showId: ShowId;
    readonly id: MicrophoneId;
    readonly number: MicrophoneNumber;
    readonly color: Color;
    readonly name: string;
  };
};

const showId = ShowId.make(`show_${"a".repeat(16)}`);

const makeBlockedMutation = <Input>() => {
  const started = [Deferred.makeUnsafe<void>(), Deferred.makeUnsafe<void>()];
  const completions = [Deferred.makeUnsafe<void, string>(), Deferred.makeUnsafe<void, string>()];
  const inputs: Array<Input> = [];
  const atom = Atom.fn(
    Effect.fn(function* (input: Input) {
      const index = inputs.length;
      inputs.push(input);
      yield* Deferred.succeed(started[index]!, undefined);
      yield* Deferred.await(completions[index]!);
      return input;
    }),
  );
  return { atom, started, completions, inputs };
};

const makeFixture = (initial: ReadonlyArray<Item> = []) => {
  const createRpc = makeBlockedMutation<CreateInput>();
  const editRpc = makeBlockedMutation<EditInput>();
  let temporaryId = 0;
  const query = Atom.make(AsyncResult.success(initial));
  const family = makeNumberedResourceAtomFamily({
    query: () => query,
    createMutation: createRpc.atom,
    editMutation: editRpc.atom,
    deleteMutation: Atom.fn(
      (_: { readonly payload: { readonly id: MicrophoneId } }) => Effect.void,
    ),
    makeTemporaryId: () => MicrophoneId.make(`mic_${String(++temporaryId).padStart(16, "0")}`),
    nextNumber: nextMicrophoneNumber,
  });
  const atoms = family(showId);
  const registry = AtomRegistry.make();
  registry.mount(atoms.items);
  const readItems = () => AsyncResult.getOrThrow(registry.get(atoms.items));
  return { registry, atoms, readItems, createRpc, editRpc };
};

describe("numbered resource optimistic mutations", () => {
  it("shows distinct pending rows and numbers for queued creates, then rolls back failures", async () => {
    const { registry, atoms, readItems, createRpc } = makeFixture();
    const first = executeMutation(registry, atoms.create, { payload: { showId, color: "blue" } });
    try {
      await Effect.runPromise(Deferred.await(createRpc.started[0]!));
      const firstId = readItems()[0]!.id;
      const second = executeMutation(registry, atoms.create, {
        payload: { showId, color: "red" },
      });
      await Effect.runPromise(Effect.yieldNow);

      const pending = readItems();
      expect(pending).toHaveLength(2);
      expect(pending.map(({ number, color, pending }) => ({ number, color, pending }))).toEqual([
        { number: "1", color: "blue", pending: true },
        { number: "2", color: "red", pending: true },
      ]);
      expect(pending[0]!.id).toBe(firstId);
      expect(pending[1]!.id).not.toBe(firstId);
      expect(createRpc.inputs).toHaveLength(1);

      await Effect.runPromise(Deferred.fail(createRpc.completions[0]!, "first failed"));
      expect(Exit.isFailure(await first)).toBe(true);
      await Effect.runPromise(Deferred.await(createRpc.started[1]!));
      expect(readItems().some((item) => item.id === pending[1]!.id && item.pending)).toBe(true);
      await Effect.runPromise(Deferred.fail(createRpc.completions[1]!, "second failed"));
      expect(Exit.isFailure(await second)).toBe(true);
      expect(readItems()).toEqual([]);
    } finally {
      registry.dispose();
      await first;
    }
  });

  it("shows a queued edit immediately and preserves it until its own failure", async () => {
    const now = DateTime.makeUnsafe("2026-10-18T12:00:00Z");
    const original: Item = {
      id: MicrophoneId.make(`mic_${"a".repeat(16)}`),
      number: MicrophoneNumber.make("1"),
      color: "blue",
      name: "Original",
      createdAt: now,
      updatedAt: now,
    };
    const { registry, atoms, readItems, editRpc } = makeFixture([original]);
    const first = executeMutation(registry, atoms.edit, {
      payload: { showId, ...original, color: "red", name: "First edit" },
    });
    try {
      await Effect.runPromise(Deferred.await(editRpc.started[0]!));
      const second = executeMutation(registry, atoms.edit, {
        payload: {
          showId,
          ...original,
          number: MicrophoneNumber.make("2"),
          color: "green",
          name: "Second edit",
        },
      });
      await Effect.runPromise(Effect.yieldNow);

      expect(readItems()).toEqual([
        expect.objectContaining({
          id: original.id,
          number: "2",
          color: "green",
          name: "Second edit",
        }),
      ]);
      expect(editRpc.inputs).toHaveLength(1);

      await Effect.runPromise(Deferred.fail(editRpc.completions[0]!, "first failed"));
      expect(Exit.isFailure(await first)).toBe(true);
      await Effect.runPromise(Deferred.await(editRpc.started[1]!));
      expect(readItems()[0]!.name).toBe("Second edit");
      await Effect.runPromise(Deferred.fail(editRpc.completions[1]!, "second failed"));
      expect(Exit.isFailure(await second)).toBe(true);
      expect(readItems()).toEqual([original]);
    } finally {
      registry.dispose();
      await first;
    }
  });
});
