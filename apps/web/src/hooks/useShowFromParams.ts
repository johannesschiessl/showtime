import { useParams } from "@tanstack/react-router";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";
import { showsAtom } from "@/client";

export function useShowFromParams() {
  const params = useParams({ strict: false });
  const showsResult = useAtomValue(showsAtom);
  const shows = AsyncResult.isSuccess(showsResult)
    ? showsResult.value
    : AsyncResult.isFailure(showsResult)
      ? Option.getOrUndefined(showsResult.previousSuccess)?.value
      : undefined;
  const showId = typeof params.showId === "string" ? params.showId : undefined;
  const show = showId ? shows?.find((show) => show.id === showId) : undefined;

  return {
    showId,
    show,
    shows,
    result: showsResult,
  } as const;
}
