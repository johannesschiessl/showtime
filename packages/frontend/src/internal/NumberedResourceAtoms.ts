import { DateTime } from "effect";
import { Atom, AsyncResult } from "effect/unstable/reactivity";
import type { Color, ShowId } from "@showtime/contracts";
import { applyOptimisticNamedItemEdit } from "./optimistic.js";

export type NumberedResourceListItem<Id extends string = string, Number extends string = string> = {
  readonly id: Id;
  readonly number: Number;
  readonly color: Color;
  readonly name?: string;
  readonly createdAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
  readonly pending?: boolean;
};

type CreateInput = {
  readonly payload: { readonly color: Color };
};

type EditInput<Id extends string, Number extends string> = {
  readonly payload: {
    readonly id: Id;
    readonly number: Number;
    readonly color: Color;
    readonly name?: string;
  };
};

type DeleteInput<Id extends string> = {
  readonly payload: { readonly id: Id };
};

interface NumberedResourceAtomOptions<
  Item extends NumberedResourceListItem<Id, Number>,
  Id extends string,
  Number extends string,
  QueryError,
  CreateArg extends CreateInput,
  CreateSuccess,
  CreateError,
  EditArg extends EditInput<Id, Number>,
  EditSuccess,
  EditError,
  DeleteArg extends DeleteInput<Id>,
  DeleteSuccess,
  DeleteError,
> {
  readonly query: (
    showId: ShowId,
  ) => Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<Item>, QueryError>>;
  readonly createMutation: Atom.AtomResultFn<CreateArg, CreateSuccess, CreateError>;
  readonly editMutation: Atom.AtomResultFn<EditArg, EditSuccess, EditError>;
  readonly deleteMutation: Atom.AtomResultFn<DeleteArg, DeleteSuccess, DeleteError>;
  readonly makeTemporaryId: () => Id;
  readonly nextNumber: (numbers: Iterable<string>) => Number;
}

export const makeNumberedResourceAtomFamily = <
  Item extends NumberedResourceListItem<Id, Number>,
  Id extends string,
  Number extends string,
  QueryError,
  CreateArg extends CreateInput,
  CreateSuccess,
  CreateError,
  EditArg extends EditInput<Id, Number>,
  EditSuccess,
  EditError,
  DeleteArg extends DeleteInput<Id>,
  DeleteSuccess,
  DeleteError,
>(
  options: NumberedResourceAtomOptions<
    Item,
    Id,
    Number,
    QueryError,
    CreateArg,
    CreateSuccess,
    CreateError,
    EditArg,
    EditSuccess,
    EditError,
    DeleteArg,
    DeleteSuccess,
    DeleteError
  >,
) =>
  Atom.family((showId: ShowId) => {
    const items = options.query(showId).pipe(Atom.optimistic);
    const create = items.pipe(
      Atom.optimisticFn({
        reducer: (current, input: CreateArg) => {
          if (!AsyncResult.isSuccess(current)) return current;
          const now = DateTime.nowUnsafe();
          const item: Item = {
            id: options.makeTemporaryId(),
            number: options.nextNumber(current.value.map((item) => item.number)),
            color: input.payload.color,
            createdAt: now,
            updatedAt: now,
            pending: true,
          } as Item;
          return AsyncResult.success([...current.value, item]);
        },
        fn: options.createMutation,
      }),
    );
    const edit = items.pipe(
      Atom.optimisticFn({
        reducer: (current, input: EditArg) => {
          if (!AsyncResult.isSuccess(current)) return current;
          const updatedAt = DateTime.nowUnsafe();
          return AsyncResult.success(
            current.value.map((item) =>
              applyOptimisticNamedItemEdit(item, input.payload, updatedAt),
            ),
          );
        },
        fn: options.editMutation,
      }),
    );
    const deleteResource = items.pipe(
      Atom.optimisticFn({
        reducer: (current, input: DeleteArg) => {
          if (!AsyncResult.isSuccess(current)) return current;
          return AsyncResult.success(current.value.filter((item) => item.id !== input.payload.id));
        },
        fn: options.deleteMutation,
      }),
    );
    return { items, create, edit, delete: deleteResource } as const;
  });
