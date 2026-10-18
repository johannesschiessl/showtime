import { Effect, Exit } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { executeMutation } from "./Mutation.js";

describe("mutation execution", () => {
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
});
