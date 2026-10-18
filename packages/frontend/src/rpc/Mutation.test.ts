import { Deferred, Effect, Exit } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { executeMutation, optimisticMutation } from "./Mutation.js";

describe("mutation execution", () => {
  it("lets unrelated operations finish while another operation is pending", async () => {
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const blocked = Atom.fn((id: number) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release);
        return id;
      }),
    );
    const unrelated = Atom.fn((id: number) => Effect.succeed(id));
    const registry = AtomRegistry.make();
    const pending = executeMutation(registry, blocked, 1);
    try {
      await Effect.runPromise(Deferred.await(started));
      const result = await Effect.runPromise(
        Effect.promise(() => executeMutation(registry, unrelated, 2)).pipe(
          Effect.timeout("1 second"),
        ),
      );
      expect(result).toEqual(Exit.succeed(2));
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await pending;
      registry.dispose();
    }
  });

  it("preserves overlapping callers' writes, failures, and result identities", async () => {
    const completed: Array<number> = [];
    const mutation = Atom.fn((id: number) =>
      Effect.gen(function* () {
        yield* Effect.sleep("5 millis");
        completed.push(id);
        if (id === 2) return yield* Effect.fail("second failed");
        return id;
      }),
    );
    const registry = AtomRegistry.make();
    try {
      const results = await Promise.all(
        [1, 2, 3].map((id) => executeMutation(registry, mutation, id)),
      );
      expect(completed).toEqual([1, 2, 3]);
      expect(results.map((result) => (Exit.isSuccess(result) ? result.value : "failed"))).toEqual([
        1,
        "failed",
        3,
      ]);
    } finally {
      registry.dispose();
    }
  });

  it("serializes optimistic wrappers sharing one mutation operation", async () => {
    const completed: Array<number> = [];
    const mutation = Atom.fn((id: number) =>
      Effect.gen(function* () {
        yield* Effect.sleep("5 millis");
        completed.push(id);
        if (id === 2) return yield* Effect.fail("second failed");
        return id;
      }),
    );
    const wrapper = () =>
      Atom.make(0).pipe(
        Atom.optimistic,
        optimisticMutation({
          reducer: (current, input: number) => current + input,
          fn: mutation,
        }),
      );
    const registry = AtomRegistry.make();
    try {
      const results = await Promise.all(
        [wrapper(), mutation, wrapper()].map((atom, index) =>
          executeMutation(registry, atom, index + 1),
        ),
      );
      expect(completed).toEqual([1, 2, 3]);
      expect(results.map((result) => (Exit.isSuccess(result) ? result.value : "failed"))).toEqual([
        1,
        "failed",
        3,
      ]);
    } finally {
      registry.dispose();
    }
  });
});
