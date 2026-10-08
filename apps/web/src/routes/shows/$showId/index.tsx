import * as React from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircleIcon, ArrowLeftIcon, FolderXIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { AsyncResult } from "effect/reactivity";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useAtomSet } from "@effect/atom-react";
import { useRelativeDateNow } from "@/hooks/useRelativeDateNow";
import { showDialogAtom } from "@/client";
import { useShowFromParams } from "@/hooks/useShowFromParams";
import { formatRelativeDate } from "@/lib/dates";
import { ShowDeleteDialog } from "@/components/shows/ShowDeleteDialog";
import { ShowFormDialog } from "@/components/shows/ShowFormDialog";
import { showColorClassNames } from "@/components/shows/show-color";
import { Spinner } from "@/components/ui/spinner";
import { rpcErrorMessageFromCause } from "@/client";
import { ProfileSwitcher } from "@/components/profiles/ProfileSwitcher";

export const Route = createFileRoute("/shows/$showId/")({
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  const setDialog = useAtomSet(showDialogAtom);
  const { show, result } = useShowFromParams();
  const updatedAtValues = React.useMemo(() => (show ? [show.updatedAt] : []), [show]);
  const now = useRelativeDateNow(updatedAtValues);
  const showName = show?.name ?? "Show";
  const showColorClassName = showColorClassNames[show?.color ?? "neutral"];

  if (AsyncResult.isInitial(result)) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>Loading show</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  if (AsyncResult.isFailure(result) && !show) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertCircleIcon />
          </EmptyMedia>
          <EmptyTitle>Show could not be loaded</EmptyTitle>
          <EmptyDescription>{rpcErrorMessageFromCause(result.cause)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!show) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderXIcon />
          </EmptyMedia>
          <EmptyTitle>Show not found</EmptyTitle>
          <EmptyDescription>This show may have been deleted.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <React.Fragment>
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia>
            <div className={`${showColorClassName} size-8 shrink-0 rounded-md`} />
          </EmptyMedia>
          <EmptyTitle className="text-lg font-bold">{showName}</EmptyTitle>
          {show && (
            <EmptyDescription title={show.updatedAt}>
              {formatRelativeDate(show.updatedAt, now)}
            </EmptyDescription>
          )}
        </EmptyHeader>
        {show && (
          <EmptyContent>
            <div className="flex flex-col items-center gap-2">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" onClick={() => setDialog({ type: "edit", show })}>
                  <PencilIcon />
                  Edit
                </Button>
                <Button variant="destructive" onClick={() => setDialog({ type: "delete", show })}>
                  <Trash2Icon />
                  Delete
                </Button>
              </div>
              <Button
                nativeButton={false}
                variant="ghost"
                className="md:hidden"
                render={<Link to="/" />}
              >
                <ArrowLeftIcon /> Back to all shows
              </Button>
              <div className="md:hidden">
                <ProfileSwitcher />
              </div>
            </div>
          </EmptyContent>
        )}
      </Empty>
      <ShowFormDialog />
      <ShowDeleteDialog onDeleted={() => navigate({ to: "/", replace: true })} />
    </React.Fragment>
  );
}
