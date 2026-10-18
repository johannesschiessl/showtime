import { Effect, Semaphore } from "effect";
import { AtomRegistry, type Atom, type AsyncResult } from "effect/reactivity";

const executionLocks = new WeakMap<AtomRegistry.AtomRegistry, Semaphore.Semaphore>();

export const executeMutation = <A, E, W>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Writable<AsyncResult.AsyncResult<A, E>, W>,
  input: W,
) => {
  let lock = executionLocks.get(registry);
  if (!lock) {
    lock = Semaphore.makeUnsafe(1);
    executionLocks.set(registry, lock);
  }
  // Optimistic wrappers can share an underlying RPC atom across shows. Serialize the whole
  // write/result exchange in this registry so each caller observes its own completion.
  return Effect.runPromiseExit(
    Effect.acquireUseRelease(
      Effect.sync(() => registry.mount(atom)),
      () =>
        lock.withPermit(
          Effect.gen(function* () {
            registry.set(atom, input);
            return yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
          }),
        ),
      (unmount) => Effect.sync(unmount),
    ),
  );
};
