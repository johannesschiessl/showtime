import { Deferred, Effect, Semaphore } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";

interface MutationExecutor<A, E, Input> {
  readonly execute: (registry: AtomRegistry.AtomRegistry, input: Input) => Effect.Effect<A, E>;
}

const mutationExecutors = new WeakMap<object, object>();
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
    type Call = { readonly input: Input; readonly completion: Deferred.Deferred<XA, XE> };
    const resultState = Atom.make<{
      readonly generation: symbol;
      readonly result: AsyncResult.AsyncResult<XA, XE>;
    }>({
      generation: Symbol(),
      result: AsyncResult.initial<XA, XE>(),
    });
    // Each call owns its transition and completion. Only the underlying RPC waits for a lock.
    const calls = Atom.fn(
      ({ input, completion }: Call, get) => {
        const { generation } = get(resultState);
        let value = options.reducer(get(self), input);
        if (AsyncResult.isAsyncResult(value)) {
          value = AsyncResult.waiting(value, { touch: true });
        }
        const transition = Atom.make<AsyncResult.AsyncResult<W, unknown>>(
          AsyncResult.success(value, { waiting: true }),
        );
        get.set(self, transition);
        return runMutation(get.registry, options.fn, input).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (get.registry.getNodes().has(transition)) {
                get.registry.set(
                  transition,
                  AsyncResult.map(AsyncResult.fromExit(exit), () => value),
                );
                if (get.registry.get(resultState).generation === generation) {
                  get.registry.set(resultState, { generation, result: AsyncResult.fromExit(exit) });
                }
              }
            }).pipe(Effect.ensuring(Deferred.done(completion, exit))),
          ),
          Effect.exit,
        );
      },
      { concurrent: true },
    );
    const atom: Atom.AtomResultFn<Input, XA, XE> = Atom.writable(
      (get) => {
        const state = get(calls);
        const { result } = get(resultState);
        if (AsyncResult.isFailure(state)) return AsyncResult.failure<XA, XE>(state.cause);
        return state.waiting ? AsyncResult.waiting(result) : result;
      },
      (ctx, input) => {
        if (input === Atom.Reset) {
          ctx.set(resultState, { generation: Symbol(), result: AsyncResult.initial() });
          ctx.set(calls, Atom.Reset);
        } else if (input === Atom.Interrupt) ctx.set(calls, Atom.Interrupt);
        else ctx.set(calls, { input, completion: Deferred.makeUnsafe<XA, XE>() });
      },
    );
    const executor: MutationExecutor<XA, XE, Input | Atom.Reset | Atom.Interrupt> = {
      execute: Effect.fn(function* (registry, input) {
        if (input === Atom.Reset || input === Atom.Interrupt) {
          registry.set(atom, input);
          return yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
        }
        const completion = Deferred.makeUnsafe<XA, XE>();
        registry.set(calls, { input, completion });
        return yield* Deferred.await(completion);
      }),
    };
    mutationExecutors.set(atom, executor);
    return atom;
  };

const runMutation = <A, E, W>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Writable<AsyncResult.AsyncResult<A, E>, W>,
  input: W,
) => {
  // The atom and its executor share these types when registered above.
  const executor = mutationExecutors.get(atom) as MutationExecutor<A, E, W> | undefined;
  if (executor) {
    return Effect.acquireUseRelease(
      Effect.sync(() => registry.mount(atom)),
      () => executor.execute(registry, input),
      (unmount) => Effect.sync(unmount),
    );
  }
  let locks = executionLocks.get(registry);
  if (!locks) {
    locks = new WeakMap();
    executionLocks.set(registry, locks);
  }
  let lock = locks.get(atom);
  if (!lock) {
    lock = Semaphore.makeUnsafe(1);
    locks.set(atom, lock);
  }
  // Wrappers across shows share the underlying RPC atom. Serialize its write/result
  // exchange so callers observe their own completion while other operations can proceed.
  return Effect.acquireUseRelease(
    Effect.sync(() => registry.mount(atom)),
    () =>
      lock.withPermit(
        Effect.gen(function* () {
          registry.set(atom, input);
          return yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
        }),
      ),
    (unmount) => Effect.sync(unmount),
  );
};

export const executeMutation = <A, E, W>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Writable<AsyncResult.AsyncResult<A, E>, W>,
  input: W,
) => Effect.runPromiseExit(runMutation(registry, atom, input));
