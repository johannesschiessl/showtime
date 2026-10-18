import { useRpcMutation } from "@/hooks/useRpcMutation";
import * as React from "react";
import { ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { type Color, type ShowName } from "@showtime/contracts";
import { Exit } from "effect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAtom } from "@effect/atom-react";
import { createShowAtom, editShowAtom, showDialogAtom, showMutationOptions } from "@/client";
import { rpcErrorMessageFromCause } from "@/client";
import { cn } from "@/lib/utils";
import { randomShowColor, showColorClassNames } from "./show-color";
import { Input } from "../ui/input";
import { ColorPickerPopover } from "@/components/ColorPickerPopover";

export function ShowFormDialog() {
  const [dialog, setDialog] = useAtom(showDialogAtom);
  const createShow = useRpcMutation(createShowAtom);
  const editShow = useRpcMutation(editShowAtom);
  const isOpen = dialog.type === "create" || dialog.type === "edit";
  const isEdit = dialog.type === "edit";
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState<Color>("sky");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (dialog.type === "edit") {
      setName(dialog.show.name);
      setColor(dialog.show.color);
      setSubmitError(undefined);
      setIsSubmitting(false);
      return;
    }

    if (dialog.type === "create") {
      setName("");
      setColor(randomShowColor());
      setSubmitError(undefined);
      setIsSubmitting(false);
    }
  }, [dialog]);

  const close = React.useCallback(() => setDialog({ type: "closed" }), [setDialog]);

  const submit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        return;
      }

      setIsSubmitting(true);
      setSubmitError(undefined);

      const result =
        dialog.type === "edit"
          ? await editShow({
              payload: {
                id: dialog.show.id,
                name: trimmed as ShowName,
                color,
              },
              ...showMutationOptions,
            })
          : dialog.type === "create"
            ? await createShow({
                payload: {
                  name: trimmed as ShowName,
                  color,
                },
                ...showMutationOptions,
              })
            : undefined;

      if (result === undefined) {
        setIsSubmitting(false);
        return;
      }

      if (Exit.isSuccess(result)) {
        close();
      } else {
        setSubmitError(rpcErrorMessageFromCause(result.cause));
        setIsSubmitting(false);
      }
    },
    [close, color, createShow, dialog, editShow, name],
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit show" : "New show"}</DialogTitle>
            <DialogDescription>
              {isEdit ? "Update the show details." : "Create a show."}
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Show name</span>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Color</span>
            <ColorPickerPopover
              color={color}
              onColorChange={setColor}
              trigger={<Button type="button" variant="outline" />}
            >
              <div className={cn(showColorClassNames[color], "size-4 rounded")} />
              <span className="capitalize">{color}</span>
              <ChevronsUpDownIcon className="ml-auto" />
            </ColorPickerPopover>
          </div>
          {submitError && (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}
          <DialogFooter>
            <DialogClose
              render={<Button type="button" variant="outline" disabled={isSubmitting} />}
            >
              Cancel
            </DialogClose>
            <Button type="submit" disabled={name.trim().length === 0 || isSubmitting}>
              {!isEdit && <PlusIcon />}
              {isSubmitting ? "Saving..." : isEdit ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
