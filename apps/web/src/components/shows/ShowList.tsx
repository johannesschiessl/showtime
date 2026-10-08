import { useMemo } from "react";
import { AlertCircleIcon, FolderIcon } from "lucide-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAtomValue } from "@effect/atom-react";
import { useRelativeDateNow } from "@/hooks/useRelativeDateNow";
import { showsAtom, type ShowListItem } from "@/client";
import { rpcErrorMessageFromCause } from "@/client";
import { ShowItem } from "./ShowItem";
import { Spinner } from "@/components/ui/spinner";

export function ShowList() {
  const result = useAtomValue(showsAtom);

  if (AsyncResult.isInitial(result)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner />
          </EmptyMedia>
          <EmptyTitle>Loading shows</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  if (AsyncResult.isFailure(result)) {
    const previous = Option.getOrUndefined(result.previousSuccess);
    if (previous && previous.value.length > 0) {
      return <ShowItems shows={previous.value} />;
    }

    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertCircleIcon />
          </EmptyMedia>
          <EmptyTitle>Shows could not be loaded</EmptyTitle>
          <EmptyDescription>{rpcErrorMessageFromCause(result.cause)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (result.value.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderIcon />
          </EmptyMedia>
          <EmptyTitle>No shows yet</EmptyTitle>
          <EmptyDescription>Create a show to get started.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return <ShowItems shows={result.value} />;
}

function ShowItems({ shows }: { readonly shows: ReadonlyArray<ShowListItem> }) {
  const updatedAtValues = useMemo(() => shows.map((show) => show.updatedAt), [shows]);
  const now = useRelativeDateNow(updatedAtValues);

  return (
    <ScrollArea className="h-full w-full sm:px-4">
      <ItemGroup>
        {shows.map((show) => (
          <div key={show.id} role="listitem">
            <ShowItem show={show} now={now} />
          </div>
        ))}
      </ItemGroup>
    </ScrollArea>
  );
}
