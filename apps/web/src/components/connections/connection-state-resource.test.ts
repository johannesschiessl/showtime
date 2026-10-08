import { Effect } from "effect";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import type { ShowtimeConnectionsState, ShowtimeHostName } from "@showtime/shared";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ConnectionManagementClient } from "./connection-management";
import {
  connectionsStateCacheAtom,
  currentConnectionsStateResult,
  refreshConnectionsStateAtom,
} from "./connection-state-resource";

const state = (enabled: boolean): ShowtimeConnectionsState => ({
  enabled,
  hostName: "device" as ShowtimeHostName,
  hostname: "showtime-device.local",
  clients: [],
});

const manager = (
  key: string,
  load: () => Promise<ShowtimeConnectionsState>,
): ConnectionManagementClient =>
  ({
    stateKey: key,
    connectionsState: load,
  }) as ConnectionManagementClient;

const waitForResult = async (
  registry: AtomRegistry.AtomRegistry,
  key: string,
  predicate: (result: ReturnType<typeof currentConnectionsStateResult>) => boolean,
) => {
  await vi.waitFor(() => {
    expect(
      predicate(currentConnectionsStateResult(registry.get(connectionsStateCacheAtom), key)),
    ).toBe(true);
  });
};

describe("connection state resource", () => {
  it("starts in a real loading state and publishes the loaded snapshot", async () => {
    let resolve!: (value: ShowtimeConnectionsState) => void;
    const load = vi.fn(() => new Promise<ShowtimeConnectionsState>((resume) => (resolve = resume)));
    const source = { key: "owner", manager: manager("owner", load) };
    const registry = AtomRegistry.make();
    const unmountState = registry.mount(connectionsStateCacheAtom);
    const unmountRefresh = registry.mount(refreshConnectionsStateAtom);

    expect(
      AsyncResult.isInitial(
        currentConnectionsStateResult(registry.get(connectionsStateCacheAtom), source.key),
      ),
    ).toBe(true);

    registry.set(refreshConnectionsStateAtom, source);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(
      currentConnectionsStateResult(registry.get(connectionsStateCacheAtom), source.key).waiting,
    ).toBe(true);

    resolve(state(true));
    await waitForResult(registry, source.key, AsyncResult.isSuccess);
    const result = currentConnectionsStateResult(
      registry.get(connectionsStateCacheAtom),
      source.key,
    );
    expect(AsyncResult.isSuccess(result) && result.value.enabled).toBe(true);

    unmountRefresh();
    unmountState();
    registry.dispose();
  });

  it("reports a first-load failure without inventing a disabled snapshot", async () => {
    const source = {
      key: "owner",
      manager: manager("owner", () => Promise.reject(new Error("offline"))),
    };
    const registry = AtomRegistry.make();
    registry.mount(connectionsStateCacheAtom);
    registry.mount(refreshConnectionsStateAtom);

    registry.set(refreshConnectionsStateAtom, source);
    await waitForResult(registry, source.key, AsyncResult.isFailure);
    const result = currentConnectionsStateResult(
      registry.get(connectionsStateCacheAtom),
      source.key,
    );
    expect(AsyncResult.isFailure(result)).toBe(true);
    expect(AsyncResult.value(result)._tag).toBe("None");

    registry.dispose();
  });

  it("keeps the last snapshot across route-style unmounts", async () => {
    const source = {
      key: "owner",
      manager: manager("owner", () => Promise.resolve(state(true))),
    };
    const registry = AtomRegistry.make();
    const unmountState = registry.mount(connectionsStateCacheAtom);
    const unmountRefresh = registry.mount(refreshConnectionsStateAtom);

    registry.set(refreshConnectionsStateAtom, source);
    await waitForResult(registry, source.key, AsyncResult.isSuccess);
    unmountRefresh();
    unmountState();
    await Effect.runPromise(Effect.yieldNow);

    const remount = registry.mount(connectionsStateCacheAtom);
    const result = currentConnectionsStateResult(
      registry.get(connectionsStateCacheAtom),
      source.key,
    );
    expect(AsyncResult.isSuccess(result) && result.value.enabled).toBe(true);

    remount();
    registry.dispose();
  });

  it("restarts immediately when an effect setup is replayed", async () => {
    const resolves: Array<(value: ShowtimeConnectionsState) => void> = [];
    const load = vi.fn(
      () =>
        new Promise<ShowtimeConnectionsState>((resolve) => {
          resolves.push(resolve);
        }),
    );
    const source = { key: "owner", manager: manager("owner", load) };
    const registry = AtomRegistry.make();
    registry.mount(connectionsStateCacheAtom);
    registry.mount(refreshConnectionsStateAtom);

    registry.set(refreshConnectionsStateAtom, source);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    registry.set(refreshConnectionsStateAtom, source);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    resolves[1]!(state(true));
    await waitForResult(registry, source.key, AsyncResult.isSuccess);
    resolves[0]!(state(false));
    await Effect.runPromise(Effect.yieldNow);
    const result = currentConnectionsStateResult(
      registry.get(connectionsStateCacheAtom),
      source.key,
    );
    expect(AsyncResult.isSuccess(result) && result.value.enabled).toBe(true);

    registry.dispose();
  });

  it("does not let an obsolete refresh overwrite a newer committed snapshot", async () => {
    let resolve!: (value: ShowtimeConnectionsState) => void;
    const source = {
      key: "owner",
      manager: manager(
        "owner",
        () => new Promise<ShowtimeConnectionsState>((resume) => (resolve = resume)),
      ),
    };
    const registry = AtomRegistry.make();
    registry.mount(connectionsStateCacheAtom);
    registry.mount(refreshConnectionsStateAtom);

    registry.set(refreshConnectionsStateAtom, source);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const loading = registry.get(connectionsStateCacheAtom);
    registry.set(connectionsStateCacheAtom, {
      key: source.key,
      revision: loading.revision + 1,
      result: AsyncResult.success(state(true)),
    });

    resolve(state(false));
    await Effect.runPromise(Effect.yieldNow);
    const result = currentConnectionsStateResult(
      registry.get(connectionsStateCacheAtom),
      source.key,
    );
    expect(AsyncResult.isSuccess(result) && result.value.enabled).toBe(true);

    registry.dispose();
  });
});
