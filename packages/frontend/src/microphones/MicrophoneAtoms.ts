import { Atom } from "effect/unstable/reactivity";
import {
  makeTemporaryId,
  microphoneIdPrefix,
  nextMicrophoneNumber,
  type Microphone,
  type MicrophoneId,
  type ShowId,
} from "@showtime/contracts";
import {
  makeNumberedResourceAtomFamily,
  type NumberedResourceListItem,
} from "../internal/NumberedResourceAtoms.js";
import { latestSnapshot } from "../rpc/LatestSnapshot.js";
import type { ShowtimeRpcClient } from "../rpc/RpcClient.js";
import type { StreamingRpcOptions } from "../rpc/StreamingRpcOptions.js";

export type MicrophoneListItem = Microphone &
  NumberedResourceListItem<MicrophoneId, Microphone["number"]>;

const makeTemporaryMicrophoneId = (): MicrophoneId =>
  makeTemporaryId(microphoneIdPrefix) as MicrophoneId;

export const makeMicrophoneAtoms = (
  RpcClient: ShowtimeRpcClient,
  options?: StreamingRpcOptions,
) => {
  const family = makeNumberedResourceAtomFamily({
    query: (showId: ShowId) =>
      latestSnapshot(RpcClient.query("microphones.list", { showId }), options),
    createMutation: RpcClient.mutation("microphones.create"),
    editMutation: RpcClient.mutation("microphones.edit"),
    deleteMutation: RpcClient.mutation("microphones.delete"),
    makeTemporaryId: makeTemporaryMicrophoneId,
    nextNumber: nextMicrophoneNumber,
  });

  const microphoneAtoms = Atom.family((showId: ShowId) => {
    const { items, ...mutations } = family(showId);
    return { microphones: items, ...mutations } as const;
  });

  return { microphoneAtoms } as const;
};
