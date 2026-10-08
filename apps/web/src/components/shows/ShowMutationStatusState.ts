import { AsyncResult } from "effect/reactivity";

type ShowMutationResult = AsyncResult.AsyncResult<unknown, unknown>;
type ShowMutationFailure = Extract<ShowMutationResult, { readonly _tag: "Failure" }>;

export type ShowMutationStatusState = {
  readonly visibleFailure: ShowMutationFailure | undefined;
  readonly waiting: boolean;
  readonly success: boolean;
};

export const getShowMutationStatusState = (
  results: ReadonlyArray<ShowMutationResult>,
): ShowMutationStatusState => {
  const visibleFailure = results.find(
    (result): result is ShowMutationFailure =>
      AsyncResult.isFailure(result) && !AsyncResult.isWaiting(result),
  );
  const waiting = results.some(AsyncResult.isWaiting);
  const success =
    !visibleFailure && !waiting && results.some((result) => AsyncResult.isSuccess(result));

  return {
    visibleFailure,
    waiting,
    success,
  };
};
