import { Atom } from "effect/unstable/reactivity";
import {
  makeTemporaryId,
  mixIdPrefix,
  nextMixNumber,
  type Mix,
  type MixId,
  type ShowId,
} from "@showtime/contracts";
import {
  makeNumberedResourceAtomFamily,
  type NumberedResourceListItem,
} from "../internal/NumberedResourceAtoms.js";
import { latestSnapshot } from "../rpc/LatestSnapshot.js";
import type { ShowtimeRpcClient } from "../rpc/RpcClient.js";
import type { StreamingRpcOptions } from "../rpc/StreamingRpcOptions.js";

export type MixListItem = Mix & NumberedResourceListItem<MixId, Mix["number"]>;

const makeTemporaryMixId = (): MixId => makeTemporaryId(mixIdPrefix) as MixId;

export const makeMixAtoms = (RpcClient: ShowtimeRpcClient, options?: StreamingRpcOptions) => {
  const family = makeNumberedResourceAtomFamily({
    query: (showId: ShowId) => latestSnapshot(RpcClient.query("mixes.list", { showId }), options),
    createMutation: RpcClient.mutation("mixes.create"),
    editMutation: RpcClient.mutation("mixes.edit"),
    deleteMutation: RpcClient.mutation("mixes.delete"),
    makeTemporaryId: makeTemporaryMixId,
    nextNumber: nextMixNumber,
  });

  const mixAtoms = Atom.family((showId: ShowId) => {
    const { items, ...mutations } = family(showId);
    return { mixes: items, ...mutations } as const;
  });

  return { mixAtoms } as const;
};
