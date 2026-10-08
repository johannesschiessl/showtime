import * as React from "react";
import { useAtomSet } from "@effect/atom-react";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon, Trash2Icon } from "lucide-react";
import type { Color, ShowName } from "@showtime/contracts";
import {
  editShowAtom,
  rpcErrorMessageFromCause,
  showDialogAtom,
  showMutationOptions,
  type ShowListItem,
} from "@/client";
import { useShowFromParams } from "@/hooks/useShowFromParams";
import { SettingsHeader, SettingsItem, SettingsSection } from "@/components/settings/SettingsPage";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ColorPickerPopover } from "@/components/ColorPickerPopover";
import { showColorClassNames } from "@/components/shows/show-color";
import { ShowDeleteDialog } from "@/components/shows/ShowDeleteDialog";
import { cn } from "@/lib/utils";

export function isUnchangedShowSave(
  next: { readonly name: string; readonly color: Color },
  committed: { readonly name: string; readonly color: Color },
  pendingSaves: number,
) {
  return pendingSaves === 0 && next.name === committed.name && next.color === committed.color;
}

export function GeneralSettings() {
  const { show, result } = useShowFromParams();
  const navigate = useNavigate();
  let content: React.ReactNode;

  if (AsyncResult.isInitial(result)) {
    content = <p className="text-sm text-muted-foreground">Loading show…</p>;
  } else if (AsyncResult.isFailure(result) && !show) {
    content = (
      <p role="alert" className="text-sm text-destructive">
        {rpcErrorMessageFromCause(result.cause)}
      </p>
    );
  } else if (!show) {
    content = <p className="text-sm text-muted-foreground">This show could not be found.</p>;
  } else {
    content = <GeneralSettingsLoaded key={show.id} show={show} />;
  }

  return (
    <div className="space-y-6">
      <SettingsHeader>General</SettingsHeader>
      {content}
      <ShowDeleteDialog onDeleted={() => navigate({ to: "/", replace: true })} />
    </div>
  );
}

function GeneralSettingsLoaded({ show }: { readonly show: ShowListItem }) {
  const editShow = useAtomSet(editShowAtom, { mode: "promiseExit" });
  const setDialog = useAtomSet(showDialogAtom);
  const [name, setName] = React.useState<string>(show.name);
  const [color, setColor] = React.useState<Color>(show.color);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const saveQueue = React.useRef(Promise.resolve());
  const pendingSaves = React.useRef(0);
  const suppressNextBlurSave = React.useRef(false);
  const committed = React.useRef({ name: show.name as string, color: show.color });

  const save = (nextName: string, nextColor: Color) => {
    const trimmed = nextName.trim();
    if (!trimmed) {
      setName(committed.current.name);
      return;
    }
    if (
      isUnchangedShowSave(
        { name: trimmed, color: nextColor },
        committed.current,
        pendingSaves.current,
      )
    )
      return;
    pendingSaves.current += 1;
    setSaving(true);
    setError(undefined);
    saveQueue.current = saveQueue.current
      .then(async () => {
        const result = await editShow({
          payload: { id: show.id, name: trimmed as ShowName, color: nextColor },
          ...showMutationOptions,
        });
        if (Exit.isFailure(result)) {
          setError(rpcErrorMessageFromCause(result.cause));
        } else {
          committed.current = { name: trimmed, color: nextColor };
          setError(undefined);
        }
      })
      .finally(() => {
        pendingSaves.current -= 1;
        if (pendingSaves.current === 0) setSaving(false);
      });
  };

  return (
    <>
      <div className="space-y-4">
        <SettingsSection title="General">
          <SettingsItem
            title="Show name"
            description="The name shown throughout Showtime."
            action={
              <Input
                aria-label="Show name"
                className="w-auto min-w-24 max-w-full [field-sizing:content]"
                size={Math.max(8, Math.min(40, name.length + 2))}
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.currentTarget.value)}
                onBlur={() => {
                  if (suppressNextBlurSave.current) {
                    suppressNextBlurSave.current = false;
                    return;
                  }
                  save(name, color);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    suppressNextBlurSave.current = true;
                    setName(committed.current.name);
                    event.currentTarget.blur();
                  }
                }}
              />
            }
          />
          <SettingsItem
            title="Show color"
            description="Used to identify this show at a glance."
            action={
              <ColorPickerPopover
                color={color}
                onColorChange={(nextColor) => {
                  setColor(nextColor);
                  save(name, nextColor);
                }}
                trigger={<Button type="button" variant="outline" className="w-full sm:w-40" />}
              >
                <span className={cn(showColorClassNames[color], "size-4 rounded")} />
                <span className="capitalize">{color}</span>
                <ChevronsUpDownIcon className="ml-auto" />
              </ColorPickerPopover>
            }
          />
        </SettingsSection>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {saving && <p className="text-xs text-muted-foreground">Saving…</p>}
      </div>

      <SettingsSection title="Danger zone">
        <SettingsItem
          title="Delete show"
          description="Remove this show and all of its songs, chat, microphones, and mixes."
          action={
            <Button variant="destructive" onClick={() => setDialog({ type: "delete", show })}>
              <Trash2Icon /> Delete show
            </Button>
          }
        />
      </SettingsSection>
    </>
  );
}
