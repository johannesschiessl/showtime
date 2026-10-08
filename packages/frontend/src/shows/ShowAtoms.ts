import { Atom, AsyncResult } from "effect/reactivity";
import {
  compareShowSummaries,
  makeTemporaryId,
  sortShowSummaries,
  showIdPrefix,
  type Color,
  type ShowId,
  type ShowSummary,
} from "@showtime/contracts";
import type { ShowtimeRpcClient } from "../rpc/RpcClient.js";
import { showsRpcReactivityKey } from "../rpc/Reactivity.js";
import { latestSnapshot } from "../rpc/LatestSnapshot.js";
import type { StreamingRpcOptions } from "../rpc/StreamingRpcOptions.js";

export type ShowDialogState =
  | { readonly type: "closed" }
  | { readonly type: "create" }
  | { readonly type: "edit"; readonly show: ShowSummary }
  | { readonly type: "delete"; readonly show: ShowSummary };

export type ShowListItem = ShowSummary & {
  readonly pending?: boolean;
};

const sortShowListItems = (shows: ReadonlyArray<ShowListItem>) =>
  [...shows].sort(compareShowSummaries);

const makeTemporaryShowId = (): ShowId => makeTemporaryId(showIdPrefix) as ShowId;

const optimisticShowName = (name: string): ShowSummary["name"] => name as ShowSummary["name"];

const optimisticShowColor = (color: Color): ShowSummary["color"] => color;

export const makeShowAtoms = (RpcClient: ShowtimeRpcClient, options?: StreamingRpcOptions) => {
  const showDialogAtom = Atom.make<ShowDialogState>({ type: "closed" });

  const showsQueryAtom = latestSnapshot(RpcClient.query("shows.list", undefined), options);

  const showsAtom = showsQueryAtom.pipe(Atom.optimistic);

  const createShowMutation = RpcClient.mutation("shows.create");
  const editShowMutation = RpcClient.mutation("shows.edit");
  const deleteShowMutation = RpcClient.mutation("shows.delete");

  type MutationInput<T> = T extends Atom.AtomResultFn<infer Arg, infer _A, infer _E> ? Arg : never;

  const createShowAtom = showsAtom.pipe(
    Atom.optimisticFn({
      reducer: (current, input: MutationInput<typeof createShowMutation>) => {
        if (!AsyncResult.isSuccess(current)) {
          return current;
        }

        const now = new Date().toISOString();
        return AsyncResult.success(
          sortShowListItems([
            ...current.value,
            {
              id: makeTemporaryShowId(),
              name: optimisticShowName(input.payload.name.trim()),
              color: optimisticShowColor(input.payload.color),
              createdAt: now,
              updatedAt: now,
              pending: true,
            },
          ]),
        );
      },
      fn: createShowMutation,
    }),
  );

  const editShowAtom = showsAtom.pipe(
    Atom.optimisticFn({
      reducer: (current, input: MutationInput<typeof editShowMutation>) => {
        if (!AsyncResult.isSuccess(current)) {
          return current;
        }

        return AsyncResult.success(
          sortShowSummaries(
            current.value.map((show) =>
              show.id === input.payload.id
                ? {
                    ...show,
                    name: optimisticShowName(input.payload.name.trim()),
                    color: optimisticShowColor(input.payload.color),
                    updatedAt: new Date().toISOString(),
                  }
                : show,
            ),
          ),
        );
      },
      fn: editShowMutation,
    }),
  );

  const deleteShowAtom = showsAtom.pipe(
    Atom.optimisticFn({
      reducer: (current, input: MutationInput<typeof deleteShowMutation>) => {
        if (!AsyncResult.isSuccess(current)) {
          return current;
        }

        return AsyncResult.success(current.value.filter((show) => show.id !== input.payload.id));
      },
      fn: deleteShowMutation,
    }),
  );

  const showMutationOptions = {
    reactivityKeys: showsRpcReactivityKey,
  } as const;

  const showMutationAtoms = [createShowAtom, editShowAtom, deleteShowAtom] as const;

  return {
    showDialogAtom,
    showsAtom,
    createShowAtom,
    editShowAtom,
    deleteShowAtom,
    showMutationOptions,
    showMutationAtoms,
  } as const;
};
