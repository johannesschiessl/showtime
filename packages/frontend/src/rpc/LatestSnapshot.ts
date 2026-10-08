import { Atom, AsyncResult } from "effect/reactivity";
import type { StreamingRpcOptions } from "./StreamingRpcOptions.js";

/** Continuously drains an RPC stream while exposing only its newest full snapshot. */
export const latestSnapshot = <A, E>(
  source: Atom.Writable<Atom.PullResult<A, E>, void>,
  options?: StreamingRpcOptions,
) => {
  const refreshedSource = (options?.refreshSignals ?? []).reduce<
    Atom.Writable<Atom.PullResult<A, E>, void>
  >((current, signal) => Atom.makeRefreshOnSignal(signal)(current), source);
  return Atom.readable((get) => {
    const latest = (result: Atom.PullResult<A, E>) =>
      AsyncResult.map(result, ({ items }) => items[items.length - 1]!);

    const initial = latest(get.once(refreshedSource));
    get.subscribe(refreshedSource, (result) => {
      get.setSelf(latest(result));
      // Writing to the pull atom starts the next pull. A waiting success means a pull is
      // already in flight; starting another one here would concurrently pull the same
      // RPC stream and can strand the subscription.
      if (AsyncResult.isSuccess(result) && !result.waiting && !result.value.done) {
        get.set(refreshedSource, undefined);
      }
    });
    return initial;
  });
};
