import { Deferred, Effect, Exit } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { executeMutation, optimisticMutation } from "./Mutation.js";

describe("mutation execution", () => {
  it("settles pending optimistic callers when the registry is disposed", async () => {
    const started = Deferred.makeUnsafe<void>();
    const mutation = Atom.fn((_: number) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        return yield* Effect.never;
      }),
    );
    const optimistic = Atom.make(0).pipe(
      Atom.optimistic,
      optimisticMutation({ reducer: (current, input: number) => current + input, fn: mutation }),
    );
    const registry = AtomRegistry.make();
    const pending = executeMutation(registry, optimistic, 1);
    try {
      await Effect.runPromise(Deferred.await(started));
      registry.dispose();
      const result = await Effect.runPromise(
        Effect.promise(() => pending).pipe(Effect.timeout("1 second")),
      );
      expect(Exit.isFailure(result)).toBe(true);
    } finally {
      registry.dispose();
    }
  });

  it.each([1, 2])(
    "shows queued optimism and preserves results when call %i fails",
    async (failedId) => {
      const started: Array<number> = [];
      const firstStarted = Deferred.makeUnsafe<void>();
      const secondStarted = Deferred.makeUnsafe<void>();
      const releaseFirst = Deferred.makeUnsafe<void>();
      const releaseSecond = Deferred.makeUnsafe<void>();
      const confirmedItems = Atom.make<ReadonlyArray<number>>([]);
      const mutation = Atom.fn((id: number, get) =>
        Effect.gen(function* () {
          started.push(id);
          yield* Deferred.succeed(id === 1 ? firstStarted : secondStarted, undefined);
          yield* Deferred.await(id === 1 ? releaseFirst : releaseSecond);
          if (id === failedId) return yield* Effect.fail(`call ${id} failed`);
          get.registry.set(confirmedItems, [id]);
          return id;
        }),
      );
      const items = Atom.make<AsyncResult.AsyncResult<ReadonlyArray<number>>>((get) =>
        AsyncResult.success(get(confirmedItems)),
      ).pipe(Atom.optimistic);
      const optimistic = items.pipe(
        optimisticMutation({
          reducer: (current, id: number) => AsyncResult.map(current, (items) => [...items, id]),
          fn: mutation,
        }),
      );
      const registry = AtomRegistry.make();
      const unmount = registry.mount(items);
      const first = executeMutation(registry, optimistic, 1);
      let second: ReturnType<typeof executeMutation> | undefined;
      try {
        await Effect.runPromise(Deferred.await(firstStarted));
        second = executeMutation(registry, optimistic, 2);
        expect(AsyncResult.getOrThrow(registry.get(items))).toEqual([1, 2]);
        expect(registry.get(optimistic).waiting).toBe(true);
        expect(started).toEqual([1]);

        await Effect.runPromise(Deferred.succeed(releaseFirst, undefined));
        const firstResult = await first;
        expect(Exit.isFailure(firstResult)).toBe(failedId === 1);
        await Effect.runPromise(Deferred.await(secondStarted));
        expect(AsyncResult.getOrThrow(registry.get(items))).toEqual([1, 2]);
        expect(registry.get(optimistic).waiting).toBe(true);

        await Effect.runPromise(Deferred.succeed(releaseSecond, undefined));
        const secondResult = await second;
        expect(Exit.isFailure(secondResult)).toBe(failedId === 2);
        expect(failedId === 1 ? secondResult : firstResult).toEqual(
          Exit.succeed(failedId === 1 ? 2 : 1),
        );
        expect(started).toEqual([1, 2]);
        expect(AsyncResult.getOrThrow(registry.get(items))).toEqual([failedId === 1 ? 2 : 1]);
        expect(AsyncResult.isFailure(registry.get(optimistic))).toBe(failedId === 2);
        expect(registry.get(optimistic).waiting).toBe(false);
      } finally {
        await Effect.runPromise(Deferred.succeed(releaseFirst, undefined));
        await Effect.runPromise(Deferred.succeed(releaseSecond, undefined));
        await Promise.all([first, second]);
        unmount();
        registry.dispose();
      }
    },
  );

  it("rolls back overlapping optimistic writes when all calls fail", async () => {
    const started = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const mutation = Atom.fn((id: number) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release);
        return yield* Effect.fail(id);
      }),
    );
    const items = Atom.make<ReadonlyArray<number>>([]).pipe(Atom.optimistic);
    const optimistic = items.pipe(
      optimisticMutation({ reducer: (current, id: number) => [...current, id], fn: mutation }),
    );
    const registry = AtomRegistry.make();
    const unmount = registry.mount(items);
    const first = executeMutation(registry, optimistic, 1);
    let second: ReturnType<typeof executeMutation> | undefined;
    try {
      await Effect.runPromise(Deferred.await(started));
      second = executeMutation(registry, optimistic, 2);
      expect(registry.get(items)).toEqual([1, 2]);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      expect((await Promise.all([first, second])).every(Exit.isFailure)).toBe(true);
      expect(registry.get(items)).toEqual([]);
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Promise.all([first, second]);
      unmount();
      registry.dispose();
    }
  });

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
