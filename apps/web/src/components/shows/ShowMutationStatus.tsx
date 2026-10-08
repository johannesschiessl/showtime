import * as React from "react";
import { AlertCircleIcon, CheckIcon, XIcon } from "lucide-react";
import { Atom } from "effect/reactivity";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { showMutationAtoms } from "@/client";
import { rpcErrorMessageFromCause } from "@/client";
import { getShowMutationStatusState } from "./ShowMutationStatusState";

export function ShowMutationStatus() {
  const createResult = useAtomValue(showMutationAtoms[0]);
  const editResult = useAtomValue(showMutationAtoms[1]);
  const deleteResult = useAtomValue(showMutationAtoms[2]);
  const resetCreate = useAtomSet(showMutationAtoms[0]);
  const resetEdit = useAtomSet(showMutationAtoms[1]);
  const resetDelete = useAtomSet(showMutationAtoms[2]);

  const { visibleFailure, waiting, success } = getShowMutationStatusState([
    createResult,
    editResult,
    deleteResult,
  ]);

  const reset = React.useCallback(() => {
    resetCreate(Atom.Reset);
    resetEdit(Atom.Reset);
    resetDelete(Atom.Reset);
  }, [resetCreate, resetDelete, resetEdit]);

  React.useEffect(() => {
    if (!success) {
      return;
    }

    const timeout = window.setTimeout(reset, 2_000);
    return () => window.clearTimeout(timeout);
  }, [reset, success]);

  if (!visibleFailure && !waiting && !success) {
    return null;
  }

  return (
    <div
      role={visibleFailure ? "alert" : "status"}
      aria-live={visibleFailure ? "assertive" : "polite"}
      className="fixed right-4 bottom-16 z-50 flex max-w-sm items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-lg"
    >
      {visibleFailure ? (
        <AlertCircleIcon className="size-4 text-destructive" />
      ) : waiting ? (
        <Spinner className="text-muted-foreground" />
      ) : (
        <CheckIcon className="size-4 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1">
        {visibleFailure
          ? rpcErrorMessageFromCause(visibleFailure.cause)
          : waiting
            ? "Saving changes..."
            : "Changes saved"}
      </span>
      <Button type="button" variant="ghost" size="icon-xs" onClick={reset}>
        <XIcon />
        <span className="sr-only">Dismiss save status</span>
      </Button>
    </div>
  );
}
