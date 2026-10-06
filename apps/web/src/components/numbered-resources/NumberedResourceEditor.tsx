import * as React from "react";
import { Exit, type Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { AlertCircleIcon, CheckIcon, Trash2Icon } from "lucide-react";
import { colors as colorOptions, type Color } from "@showtime/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { colorPreviewClassNames } from "@/components/color";
import { showContrastColorClassNames } from "@/components/show-contrast-color";
import { rpcErrorMessageFromCause } from "@/client";
import { cn } from "@/lib/utils";

interface NumberedResourceEditorItem {
  readonly id: string;
  readonly number: string;
  readonly color: Color;
  readonly name?: string;
  readonly pending?: boolean;
}

type MutationResult = Exit.Exit<unknown, unknown>;

export interface NumberedResourceEditorConfig<Item extends NumberedResourceEditorItem> {
  readonly singular: string;
  readonly plural: string;
  readonly activeListName: string;
  readonly EmptyIcon: React.ComponentType;
  readonly canDelete?: (item: Item) => boolean;
  readonly badge?: (item: Item) => React.ReactNode;
  readonly deleteLabel: (item: Item) => string;
}

interface NumberedResourceEditorProps<Item extends NumberedResourceEditorItem, Error> {
  readonly result: AsyncResult.AsyncResult<ReadonlyArray<Item>, Error>;
  readonly config: NumberedResourceEditorConfig<Item>;
  readonly onEdit: (edit: {
    readonly id: Item["id"];
    readonly number: Item["number"];
    readonly color: Color;
    readonly name?: string;
  }) => Promise<MutationResult>;
  readonly onDelete: (id: Item["id"]) => Promise<MutationResult>;
}

const capitalize = (value: string) => `${value[0]!.toUpperCase()}${value.slice(1)}`;

export function NumberedResourceEditor<Item extends NumberedResourceEditorItem, Error>({
  result,
  config,
  onEdit,
  onDelete,
}: NumberedResourceEditorProps<Item, Error>) {
  const items = AsyncResult.isSuccess(result) ? result.value : [];
  const [itemToDelete, setItemToDelete] = React.useState<Item>();
  const pluralTitle = capitalize(config.plural);

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col">
      {AsyncResult.isInitial(result) ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Spinner />
            </EmptyMedia>
            <EmptyTitle>Loading {config.plural}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : AsyncResult.isFailure(result) && items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertCircleIcon />
            </EmptyMedia>
            <EmptyTitle>{pluralTitle} could not be loaded</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <config.EmptyIcon />
            </EmptyMedia>
            <EmptyTitle>No {config.plural} yet</EmptyTitle>
            <EmptyDescription>Add one to get started</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
          {items.map((item) => (
            <NumberedResourceCard
              key={item.id}
              item={item}
              items={items}
              config={config}
              onEdit={onEdit}
              onDelete={() => setItemToDelete(item)}
            />
          ))}
        </div>
      )}
      <NumberedResourceDeleteDialog
        item={itemToDelete}
        config={config}
        onDelete={onDelete}
        onClose={() => setItemToDelete(undefined)}
      />
    </div>
  );
}

function NumberedResourceCard<Item extends NumberedResourceEditorItem>({
  item,
  items,
  config,
  onEdit,
  onDelete,
}: {
  readonly item: Item;
  readonly items: ReadonlyArray<Item>;
  readonly config: NumberedResourceEditorConfig<Item>;
  readonly onEdit: NumberedResourceEditorProps<Item, unknown>["onEdit"];
  readonly onDelete: () => void;
}) {
  const [number, setNumber] = React.useState(String(item.number));
  const [name, setName] = React.useState(item.name ?? "");
  const [color, setColor] = React.useState(item.color);
  const [saveError, setSaveError] = React.useState<string>();
  const committedItem = React.useRef<NumberedResourceEditorItem>(item);
  const pendingSave = React.useRef<Promise<MutationResult> | undefined>(undefined);

  React.useEffect(() => {
    setNumber(String(item.number));
    setName(item.name ?? "");
    setColor(item.color);
    committedItem.current = item;
  }, [item.color, item.name, item.number]);

  const save = (next: { number?: string; name?: string; color?: Color }) => {
    const run = async () => {
      setSaveError(undefined);
      const current = committedItem.current;
      const edit = {
        id: item.id,
        number: ((next.number?.trim() ?? current.number) || current.number) as Item["number"],
        color: next.color ?? current.color,
        ...(next.name === undefined ? {} : { name: next.name.trim() }),
      };
      const result = await onEdit(edit);
      if (Exit.isFailure(result)) {
        committedItem.current = current;
        setSaveError(rpcErrorMessageFromCause(result.cause as Cause.Cause<unknown>));
      } else {
        committedItem.current = { ...current, ...edit };
      }
      return result;
    };
    const result = pendingSave.current?.then(run, run) ?? run();
    pendingSave.current = result;
    return result;
  };

  const trimmedNumber = number.trim();
  const duplicate = items.some(
    (other) => other.id !== item.id && other.number.trim() === trimmedNumber,
  );
  const commitNumber = async () => {
    const valid = trimmedNumber || item.number;
    setNumber(String(valid));
    if (valid !== item.number) {
      const result = await save({ number: valid });
      if (Exit.isFailure(result)) setNumber(String(item.number));
    }
  };

  const colors = showContrastColorClassNames[color];
  const canDelete = config.canDelete?.(item) ?? true;
  const badge = config.badge?.(item);

  return (
    <Card className="relative">
      {canDelete && (
        <Button
          type="button"
          variant="destructive"
          size="icon-sm"
          aria-label={`Delete ${config.singular} ${number}`}
          disabled={item.pending}
          onClick={onDelete}
          className="absolute top-2 right-2 md:opacity-0 md:transition-opacity md:group-hover/card:opacity-100 md:focus-visible:opacity-100"
        >
          <Trash2Icon />
        </Button>
      )}
      <CardContent className="flex flex-col items-center gap-3 text-center">
        <Popover>
          <PopoverTrigger
            disabled={item.pending}
            render={
              <div
                className={cn(
                  "flex size-14 shrink-0 items-center justify-center rounded-lg outline-none ring-ring/50 focus-visible:ring-3",
                  colors.background,
                )}
                aria-label={`Change color for ${config.singular} ${number}`}
              />
            }
          >
            <input
              aria-label={`${capitalize(config.singular)} label`}
              disabled={item.pending}
              value={number}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => {
                event.stopPropagation();
                event.currentTarget.select();
              }}
              onChange={(event) => setNumber(event.currentTarget.value)}
              onBlur={commitNumber}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              className={cn(
                "w-full bg-transparent text-center text-2xl font-bold outline-none",
                colors.text,
              )}
            />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto">
            <div className="grid grid-cols-6 gap-2">
              {colorOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={option}
                  aria-pressed={option === color}
                  disabled={item.pending}
                  className="relative flex size-8 items-center justify-center rounded-md outline-none ring-ring/50 hover:bg-accent focus-visible:ring-3"
                  onClick={async () => {
                    setColor(option);
                    const result = await save({ color: option });
                    if (Exit.isFailure(result)) setColor(item.color);
                  }}
                >
                  <span className={cn("size-5 rounded-md", colorPreviewClassNames[option])} />
                  {option === color && (
                    <CheckIcon className={cn("absolute size-3 drop-shadow", "text-white")} />
                  )}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <div className="w-full min-w-0">
          <Input
            aria-label={`Name for ${config.singular} ${number}`}
            disabled={item.pending}
            placeholder="Optional name"
            value={name}
            className="text-center"
            onChange={(event) => setName(event.currentTarget.value)}
            onBlur={async () => {
              if (name.trim() !== (item.name ?? "")) {
                const result = await save({ name });
                if (Exit.isFailure(result)) setName(item.name ?? "");
              }
            }}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
          <p
            className={cn(
              "mt-1 text-xs",
              duplicate ? "text-amber-600 dark:text-amber-400" : "invisible",
            )}
            role={duplicate ? "alert" : undefined}
          >
            Label already in use
          </p>
          {saveError && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {saveError}
            </p>
          )}
        </div>
        {badge && <Badge>{badge}</Badge>}
      </CardContent>
    </Card>
  );
}

function NumberedResourceDeleteDialog<Item extends NumberedResourceEditorItem>({
  item,
  config,
  onDelete,
  onClose,
}: {
  readonly item: Item | undefined;
  readonly config: NumberedResourceEditorConfig<Item>;
  readonly onDelete: NumberedResourceEditorProps<Item, unknown>["onDelete"];
  readonly onClose: () => void;
}) {
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string>();

  React.useEffect(() => {
    setIsDeleting(false);
    setDeleteError(undefined);
  }, [item]);

  const confirmDelete = async () => {
    if (!item) return;
    setIsDeleting(true);
    setDeleteError(undefined);
    const result = await onDelete(item.id);
    if (Exit.isSuccess(result)) {
      onClose();
    } else {
      setDeleteError(rpcErrorMessageFromCause(result.cause as Cause.Cause<unknown>));
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={item !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {config.singular}?</DialogTitle>
          <DialogDescription>
            This will remove {item ? config.deleteLabel(item) : ""} from the active{" "}
            {config.activeListName}.
          </DialogDescription>
        </DialogHeader>
        {deleteError && (
          <p role="alert" className="text-sm text-destructive">
            {deleteError}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" disabled={isDeleting} />}>
            Cancel
          </DialogClose>
          <Button variant="destructive" disabled={isDeleting} onClick={confirmDelete}>
            <Trash2Icon /> {isDeleting ? "Removing..." : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
