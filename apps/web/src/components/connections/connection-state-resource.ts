import { Effect, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import type { ShowtimeConnectionsState } from "@showtime/shared";
import type { ConnectionManagementClient } from "./connection-management";

export type ConnectionsStateLoadError = "connections-state-load-failed";

type ConnectionsStateResult = AsyncResult.AsyncResult<
  ShowtimeConnectionsState,
  ConnectionsStateLoadError
>;

export interface ConnectionsStateCache {
  readonly key: string | undefined;
  readonly revision: number;
  readonly result: ConnectionsStateResult;
}

export interface ConnectionsStateSource {
  readonly key: string;
  readonly manager: ConnectionManagementClient;
}

const initialCache: ConnectionsStateCache = {
  key: undefined,
  revision: 0,
  result: AsyncResult.initial(),
};

/** Keeps the last successful snapshot available while settings routes mount and unmount. */
export const connectionsStateCacheAtom = Atom.make<ConnectionsStateCache>(initialCache).pipe(
  Atom.keepAlive,
);

export const currentConnectionsStateResult = (
  cache: ConnectionsStateCache,
  key: string | undefined,
): ConnectionsStateResult =>
  key !== undefined && cache.key === key ? cache.result : AsyncResult.initial();

export const refreshConnectionsStateAtom = Atom.fn<ConnectionsStateSource>()((source, get) => {
  const cached = get(connectionsStateCacheAtom);
  const previous = currentConnectionsStateResult(cached, source.key);
  const revision = cached.revision + 1;
  get.set(connectionsStateCacheAtom, {
    key: source.key,
    revision,
    result: AsyncResult.waiting(previous),
  });

  return Effect.tryPromise({
    try: () => source.manager.connectionsState(),
    catch: (): ConnectionsStateLoadError => "connections-state-load-failed",
  }).pipe(
    Effect.tap((state) =>
      Effect.sync(() => {
        const latest = get(connectionsStateCacheAtom);
        if (latest.key !== source.key || latest.revision !== revision) return;
        get.set(connectionsStateCacheAtom, {
          key: source.key,
          revision,
          result: AsyncResult.success(state),
        });
      }),
    ),
    Effect.tapError((error) =>
      Effect.sync(() => {
        const latest = get(connectionsStateCacheAtom);
        if (latest.key !== source.key || latest.revision !== revision) return;
        get.set(connectionsStateCacheAtom, {
          key: source.key,
          revision,
          result: AsyncResult.failWithPrevious(error, {
            previous: Option.some(latest.result),
          }),
        });
      }),
    ),
  );
});
