import { useRpcMutation } from "@/hooks/useRpcMutation";
import * as React from "react";
import { Trash2Icon } from "lucide-react";
import { Exit } from "effect";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAtom } from "@effect/atom-react";
import { deleteShowAtom, showDialogAtom, showMutationOptions } from "@/client";
import { rpcErrorMessageFromCause } from "@/client";

type ShowDeleteDialogProps = {
  readonly onDeleted?: () => void | Promise<void>;
};

export function ShowDeleteDialog({ onDeleted }: ShowDeleteDialogProps) {
  const [dialog, setDialog] = useAtom(showDialogAtom);
  const deleteShow = useRpcMutation(deleteShowAtom);
  const isOpen = dialog.type === "delete";
  const showName = dialog.type === "delete" ? dialog.show.name : "this show";
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | undefined>();
  const dialogRef = React.useRef(dialog);

  dialogRef.current = dialog;

  const close = () => setDialog({ type: "closed" });

  const notifyDeleted = () => {
    if (!onDeleted) {
      return;
    }

    try {
      void Promise.resolve(onDeleted()).catch((error: unknown) => {
        console.error("Show deletion follow-up failed", error);
      });
    } catch (error) {
      console.error("Show deletion follow-up failed", error);
    }
  };

  React.useEffect(() => {
    if (dialog.type === "delete") {
      setIsDeleting(false);
      setDeleteError(undefined);
    }
  }, [dialog]);

  const confirmDelete = async () => {
    if (dialog.type !== "delete") {
      return;
    }

    const deletingShowId = dialog.show.id;
    setIsDeleting(true);
    setDeleteError(undefined);

    const result = await deleteShow({
      payload: {
        id: deletingShowId,
      },
      ...showMutationOptions,
    });

    const currentDialog = dialogRef.current;
    if (currentDialog.type !== "delete" || currentDialog.show.id !== deletingShowId) {
      return;
    }

    if (Exit.isSuccess(result)) {
      close();
      notifyDeleted();
    } else {
      setDeleteError(rpcErrorMessageFromCause(result.cause));
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete show?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete{" "}
            <strong className="font-semibold text-foreground">{showName}</strong>. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={isDeleting}
            onClick={confirmDelete}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
