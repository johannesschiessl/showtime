import { Effect, Semaphore } from "effect";
import { Atom, AtomRegistry, type AsyncResult } from "effect/reactivity";

const mutationOperations = new WeakMap<object, object>();
const executionLocks = new WeakMap<
  AtomRegistry.AtomRegistry,
  WeakMap<object, Semaphore.Semaphore>
>();

export const optimisticMutation =
  <A, W, XA, XE, Input = void>(options: {
    readonly reducer: (current: NoInfer<A>, input: Input) => NoInfer<W>;
    readonly fn: Atom.AtomResultFn<Input, XA, XE>;
  }) =>
  (self: Atom.Writable<A, Atom.Atom<AsyncResult.AsyncResult<W, unknown>>>) => {
    const atom = Atom.optimisticFn(self, options);
    mutationOperations.set(atom, mutationOperations.get(options.fn) ?? options.fn);
    return atom;
  };

export const executeMutation = <A, E, W>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Writable<AsyncResult.AsyncResult<A, E>, W>,
  input: W,
) => {
  let locks = executionLocks.get(registry);
  if (!locks) {
    locks = new WeakMap();
    executionLocks.set(registry, locks);
  }
  const operation = mutationOperations.get(atom) ?? atom;
  let lock = locks.get(operation);
  if (!lock) {
    lock = Semaphore.makeUnsafe(1);
    locks.set(operation, lock);
  }
  // Wrappers across shows share the underlying RPC atom. Serialize its write/result
  // exchange so callers observe their own completion while other operations can proceed.
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
