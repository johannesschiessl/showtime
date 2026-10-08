import { DateTime } from "effect";
import { Atom, AsyncResult } from "effect/reactivity";
import {
  makeTemporaryId,
  profileIdPrefix,
  type Profile,
  type ProfileId,
  type ProfilesState,
} from "@showtime/contracts";
import type { ShowtimeRpcClient } from "../rpc/RpcClient.js";
import { latestSnapshot } from "../rpc/LatestSnapshot.js";
import type { StreamingRpcOptions } from "../rpc/StreamingRpcOptions.js";

export type ProfileListItem = Profile & { readonly pending?: boolean };
type MutationInput<T> = T extends Atom.AtomResultFn<infer Arg, infer _A, infer _E> ? Arg : never;

const makeTemporaryProfileId = (): ProfileId => makeTemporaryId(profileIdPrefix) as ProfileId;

export const makeProfileAtoms = (RpcClient: ShowtimeRpcClient, options?: StreamingRpcOptions) => {
  const query = latestSnapshot(RpcClient.query("profiles.list", undefined), options);
  const state = query.pipe(Atom.optimistic);
  const createMutation = RpcClient.mutation("profiles.create");
  const editMutation = RpcClient.mutation("profiles.edit");
  const deleteMutation = RpcClient.mutation("profiles.delete");
  const setDefaultMutation = RpcClient.mutation("profiles.setDefault");

  const create = state.pipe(
    Atom.optimisticFn({
      reducer: (current, input: MutationInput<typeof createMutation>) => {
        if (!AsyncResult.isSuccess(current)) return current;
        const now = DateTime.nowUnsafe();
        const profile: ProfileListItem = {
          id: makeTemporaryProfileId(),
          name: input.payload.name.trim() as Profile["name"],
          color: input.payload.color,
          createdAt: now,
          updatedAt: now,
          pending: true,
        };
        return AsyncResult.success({
          ...current.value,
          profiles: [...current.value.profiles, profile],
        } satisfies ProfilesState);
      },
      fn: createMutation,
    }),
  );

  const edit = state.pipe(
    Atom.optimisticFn({
      reducer: (current, input: MutationInput<typeof editMutation>) => {
        if (!AsyncResult.isSuccess(current)) return current;
        const updatedAt = DateTime.nowUnsafe();
        return AsyncResult.success({
          ...current.value,
          profiles: current.value.profiles.map((profile) =>
            profile.id === input.payload.id
              ? {
                  ...profile,
                  name: input.payload.name.trim() as Profile["name"],
                  color: input.payload.color,
                  updatedAt,
                }
              : profile,
          ),
        });
      },
      fn: editMutation,
    }),
  );

  const deleteProfile = state.pipe(
    Atom.optimisticFn({
      reducer: (current, input: MutationInput<typeof deleteMutation>) =>
        AsyncResult.isSuccess(current)
          ? AsyncResult.success({
              ...current.value,
              profiles: current.value.profiles.filter((profile) => profile.id !== input.payload.id),
            })
          : current,
      fn: deleteMutation,
    }),
  );

  const setDefault = state.pipe(
    Atom.optimisticFn({
      reducer: (current, input: MutationInput<typeof setDefaultMutation>) =>
        AsyncResult.isSuccess(current)
          ? AsyncResult.success({ ...current.value, defaultProfileId: input.payload.id })
          : current,
      fn: setDefaultMutation,
    }),
  );

  return {
    profileAtoms: {
      state,
      create,
      edit,
      delete: deleteProfile,
      setDefault,
    },
  } as const;
};
