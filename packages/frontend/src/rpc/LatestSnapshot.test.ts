import { Effect } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { latestSnapshot } from "./LatestSnapshot.js";

describe("latestSnapshot", () => {
  it("keeps exactly one pull in flight while waiting for the next snapshot", async () => {
    type Pull = Atom.PullResult<ReadonlyArray<number>, never>;
    const result = Atom.make<Pull>(AsyncResult.initial(true));
    let pulls = 0;
    const source = Atom.writable(
      (get) => get(result),
      (ctx) => {
        pulls += 1;
        ctx.set(result, AsyncResult.waiting(ctx.get(result)));
      },
    );
    const latest = latestSnapshot(source);
    const registry = AtomRegistry.make();
    const unmount = registry.mount(latest);

    registry.set(result, AsyncResult.success({ done: false, items: [[1, 2, 3]] as const }));
    await Effect.runPromise(Effect.yieldNow);

    expect(pulls).toBe(1);
    const snapshot = registry.get(latest);
    expect(AsyncResult.isSuccess(snapshot) && snapshot.value).toEqual([1, 2, 3]);
    unmount();
    registry.dispose();
  });

  it("recreates the pull source when a recovery signal changes", async () => {
    type Pull = Atom.PullResult<ReadonlyArray<number>, never>;
    const initial: Pull = AsyncResult.success({
      done: false,
      items: [[1] as ReadonlyArray<number>],
    });
    const result = Atom.make(initial);
    const recovery = Atom.make(0);
    let reads = 0;
    const source = Atom.writable<Pull, void>(
      (get) => {
        reads += 1;
        return get(result);
      },
      () => undefined,
    );
    const latest = latestSnapshot(source, { refreshSignals: [recovery] });
    const registry = AtomRegistry.make();
    const unmount = registry.mount(latest);
    const initialReads = reads;

    registry.set(recovery, 1);
    await Effect.runPromise(Effect.yieldNow);

    expect(reads).toBeGreaterThan(initialReads);
    unmount();
    registry.dispose();
  });
});
