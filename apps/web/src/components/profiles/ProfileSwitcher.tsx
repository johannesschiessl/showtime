import * as React from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Exit, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import {
  profilesSyncKey,
  type Color,
  type Profile,
  type ProfileName,
  type ProfilesState,
} from "@showtime/contracts";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { profileAtoms, rpcErrorMessageFromCause } from "@/client";
import { useSelectedProfile } from "@/profiles";
import { ProfileAvatar } from "@/components/profiles/ProfileAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemGroup } from "@/components/ui/item";
import { ColorPickerPopover } from "@/components/ColorPickerPopover";
import { SettingsHeader, SettingsItem, SettingsSection } from "@/components/settings/SettingsPage";
import { colorPreviewClassNames } from "@/components/color";

const mutationOptions = { reactivityKeys: profilesSyncKey } as const;

const isPendingProfile = (profile: Profile): boolean =>
  "pending" in profile && profile.pending === true;

export const currentProfilesState = (
  result: AsyncResult.AsyncResult<ProfilesState, unknown>,
): ProfilesState | undefined =>
  AsyncResult.isSuccess(result)
    ? result.value
    : AsyncResult.isFailure(result)
      ? Option.getOrUndefined(result.previousSuccess)?.value
      : undefined;

export function ProfileSwitcher({
  className,
  variant = "full",
}: {
  readonly className?: string;
  readonly variant?: "full" | "avatar";
}) {
  const result = useAtomValue(profileAtoms.state);
  const state = currentProfilesState(result);
  const { selected, select } = useSelectedProfile(state);

  return (
    <ProfileControl
      className={className}
      variant={variant}
      state={state}
      selected={selected}
      onSelect={select}
      loadResult={result}
    />
  );
}

export function ProfileControl({
  className,
  state,
  selected,
  onSelect,
  loadResult,
  fullWidth = false,
  variant = "full",
}: {
  readonly className?: string;
  readonly state: ProfilesState | undefined;
  readonly selected: Profile | undefined;
  readonly onSelect: (profile: Profile) => void;
  readonly loadResult: AsyncResult.AsyncResult<ProfilesState, unknown>;
  readonly fullWidth?: boolean;
  readonly variant?: "full" | "avatar";
}) {
  const [open, setOpen] = React.useState(false);

  if (variant === "avatar") {
    return (
      <>
        <ProfileAvatarPopover
          className={className}
          selected={selected}
          state={state}
          onSelect={onSelect}
          onEdit={() => setOpen(true)}
        />
        <ProfileDialog open={open} onOpenChange={setOpen} state={state} loadResult={loadResult} />
      </>
    );
  }

  return (
    <>
      <ButtonGroup aria-label="Profile controls" className={className}>
        <Select
          value={selected?.id ?? ""}
          disabled={!state}
          onValueChange={(id) => {
            const profile = state?.profiles.find((item) => item.id === id);
            if (profile) onSelect(profile);
          }}
        >
          <SelectTrigger
            aria-label="Selected profile"
            className={fullWidth ? "min-w-0 flex-1" : "w-44"}
          >
            <SelectValue>
              {selected ? <ProfileLabel profile={selected} /> : "Loading profiles…"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {state?.profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id} disabled={isPendingProfile(profile)}>
                <ProfileLabel profile={profile} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Manage profiles"
          onClick={() => setOpen(true)}
        >
          <PencilIcon />
        </Button>
      </ButtonGroup>
      <ProfileDialog open={open} onOpenChange={setOpen} state={state} loadResult={loadResult} />
    </>
  );
}

function ProfileAvatarPopover({
  className,
  selected,
  state,
  onSelect,
  onEdit,
}: {
  readonly className?: string;
  readonly selected: Profile | undefined;
  readonly state: ProfilesState | undefined;
  readonly onSelect: (profile: Profile) => void;
  readonly onEdit: () => void;
}) {
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger
        aria-label={selected ? `Profile: ${selected.name}` : "Select profile"}
        disabled={!selected}
        className={cn(
          "rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        {selected ? (
          <ProfileAvatar name={selected.name} color={selected.color} />
        ) : (
          <ProfileAvatar name="?" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <div className="flex flex-col">
          {state?.profiles.map((profile) => (
            <Button
              key={profile.id}
              type="button"
              variant={profile.id === selected?.id ? "secondary" : "ghost"}
              className="justify-start"
              disabled={isPendingProfile(profile)}
              onClick={() => {
                onSelect(profile);
                setPopoverOpen(false);
              }}
            >
              <ProfileAvatar
                name={profile.name}
                color={profile.color}
                className="size-5 text-[10px]"
              />
              <span className="truncate">{profile.name}</span>
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            className="justify-start"
            onClick={() => {
              setPopoverOpen(false);
              onEdit();
            }}
          >
            <PencilIcon className="size-4" /> Edit profiles
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ProfileLabel({ profile }: { readonly profile: Profile }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ProfileAvatar name={profile.name} color={profile.color} className="size-5 text-[10px]" />
      <span className="truncate">{profile.name}</span>
    </span>
  );
}

function ProfileDialog({
  open,
  onOpenChange,
  state,
  loadResult,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly state: ProfilesState | undefined;
  readonly loadResult: AsyncResult.AsyncResult<ProfilesState, unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Profiles</DialogTitle>
          <DialogDescription>
            Choose names and colors, and set the profile used by default.
          </DialogDescription>
        </DialogHeader>
        <ProfilesSettingsContent state={state} loadResult={loadResult} />
      </DialogContent>
    </Dialog>
  );
}

export function ProfilesSettings() {
  const result = useAtomValue(profileAtoms.state);
  const state = currentProfilesState(result);

  return (
    <div className="space-y-6">
      <SettingsHeader>Profiles</SettingsHeader>
      <ProfilesSettingsContent state={state} loadResult={result} />
    </div>
  );
}

function ProfilesSettingsContent({
  state,
  loadResult,
}: {
  readonly state: ProfilesState | undefined;
  readonly loadResult: AsyncResult.AsyncResult<ProfilesState, unknown>;
}) {
  const create = useAtomSet(profileAtoms.create, { mode: "promiseExit" });
  const setDefault = useAtomSet(profileAtoms.setDefault, { mode: "promiseExit" });
  const { selected, select } = useSelectedProfile(state);
  const [error, setError] = React.useState<string>();
  const [newName, setNewName] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [settingDefault, setSettingDefault] = React.useState(false);

  const add = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim();
    if (!state || !name || adding) return;
    setAdding(true);
    setError(undefined);
    const result = await create({
      payload: { name: name as ProfileName, color: "sky" },
      ...mutationOptions,
    });
    if (Exit.isFailure(result)) setError(rpcErrorMessageFromCause(result.cause));
    else setNewName("");
    setAdding(false);
  };

  const loadError =
    AsyncResult.isFailure(loadResult) && !state
      ? rpcErrorMessageFromCause(loadResult.cause)
      : undefined;
  const defaultProfile = state?.profiles.find((profile) => profile.id === state.defaultProfileId);

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Available profiles"
        action={
          <form onSubmit={add}>
            <InputGroup className="w-56">
              <InputGroupInput
                aria-label="New profile name"
                value={newName}
                maxLength={80}
                placeholder="New profile"
                disabled={!state || adding}
                onChange={(event) => setNewName(event.currentTarget.value)}
              />
              {newName.length > 0 && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    type="submit"
                    variant="outline"
                    disabled={!state || !newName.trim() || adding}
                  >
                    {adding ? "Adding…" : "Add"}
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          </form>
        }
      >
        <ItemGroup className="gap-0">
          {state?.profiles.map((profile) => (
            <ProfileItem
              key={profile.id}
              profile={profile}
              isDefault={profile.id === state.defaultProfileId}
              onError={setError}
            />
          ))}
        </ItemGroup>
      </SettingsSection>
      <SettingsSection title="Profile selection">
        <SettingsItem
          title="Default profile"
          description="Used when a device has not selected a profile."
          action={
            <Select
              value={state?.defaultProfileId ?? ""}
              disabled={!state || settingDefault}
              onValueChange={async (id) => {
                const profile = state?.profiles.find((item) => item.id === id);
                if (!profile || profile.id === state?.defaultProfileId) return;
                setSettingDefault(true);
                setError(undefined);
                const result = await setDefault({
                  payload: { id: profile.id },
                  ...mutationOptions,
                });
                if (Exit.isFailure(result)) setError(rpcErrorMessageFromCause(result.cause));
                setSettingDefault(false);
              }}
            >
              <SelectTrigger aria-label="Default profile" className="w-48 max-w-full">
                <SelectValue placeholder="Select a profile">
                  {defaultProfile && <ProfileLabel profile={defaultProfile} />}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {state?.profiles.map((profile) => (
                  <SelectItem
                    key={profile.id}
                    value={profile.id}
                    disabled={isPendingProfile(profile)}
                  >
                    <ProfileLabel profile={profile} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsItem
          title="Profile on this device"
          description="Used for your messages and activity on this device."
          action={
            <Select
              value={selected?.id ?? ""}
              disabled={!state}
              onValueChange={(id) => {
                const profile = state?.profiles.find((item) => item.id === id);
                if (profile) select(profile);
              }}
            >
              <SelectTrigger aria-label="Profile on this device" className="w-48 max-w-full">
                <SelectValue placeholder="Select a profile">
                  {selected && <ProfileLabel profile={selected} />}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {state?.profiles.map((profile) => (
                  <SelectItem
                    key={profile.id}
                    value={profile.id}
                    disabled={isPendingProfile(profile)}
                  >
                    <ProfileLabel profile={profile} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>
      {(error ?? loadError) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? loadError}
        </p>
      )}
    </div>
  );
}

function ProfileItem({
  profile,
  isDefault,
  onError,
}: {
  readonly profile: Profile;
  readonly isDefault: boolean;
  readonly onError: (message: string | undefined) => void;
}) {
  const edit = useAtomSet(profileAtoms.edit, { mode: "promiseExit" });
  const remove = useAtomSet(profileAtoms.delete, { mode: "promiseExit" });
  const [name, setName] = React.useState(profile.name as string);
  const [color, setColor] = React.useState<Color>(profile.color);
  const [busy, setBusy] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string>();
  const pending = isPendingProfile(profile);
  const saveQueue = React.useRef(Promise.resolve());
  const suppressNextBlurSave = React.useRef(false);
  React.useEffect(() => {
    setName(profile.name);
    setColor(profile.color);
  }, [profile.color, profile.name]);

  const save = (nextName: string, nextColor: Color) => {
    const trimmedName = nextName.trim();
    if (!trimmedName) {
      setName(profile.name);
      return;
    }
    if (trimmedName === profile.name && nextColor === profile.color) return;
    onError(undefined);
    saveQueue.current = saveQueue.current.then(async () => {
      const result = await edit({
        payload: {
          id: profile.id,
          name: trimmedName as ProfileName,
          color: nextColor,
        },
        ...mutationOptions,
      });
      if (Exit.isFailure(result)) onError(rpcErrorMessageFromCause(result.cause));
    });
  };

  const deleteProfile = async () => {
    setBusy(true);
    setDeleteError(undefined);
    saveQueue.current = saveQueue.current
      .then(async () => {
        const result = await remove({ payload: { id: profile.id }, ...mutationOptions });
        if (Exit.isFailure(result)) {
          setDeleteError(rpcErrorMessageFromCause(result.cause));
        } else {
          setDeleteOpen(false);
        }
      })
      .finally(() => setBusy(false));
    await saveQueue.current;
  };

  return (
    <>
      <Item className="min-h-16 border-0 px-0 py-3 sm:flex-nowrap">
        <ItemContent className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <InputGroup variant="ghost" className="w-fit max-w-full">
              <InputGroupAddon className="pl-3">
                <ColorPickerPopover
                  color={color}
                  onColorChange={(nextColor) => {
                    setColor(nextColor);
                    save(name, nextColor);
                  }}
                  trigger={
                    <button
                      type="button"
                      className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      aria-label={`Choose color for ${profile.name}`}
                      disabled={pending}
                    />
                  }
                >
                  <span
                    className={cn("block size-3 rounded-full", colorPreviewClassNames[color])}
                  />
                </ColorPickerPopover>
              </InputGroupAddon>
              <InputGroupInput
                aria-label={`Name for ${profile.name}`}
                className="w-auto min-w-0 flex-none [field-sizing:content]"
                size={Math.max(1, name.length)}
                value={name}
                maxLength={80}
                disabled={pending}
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
                    setName(profile.name);
                    event.currentTarget.blur();
                  }
                }}
              />
            </InputGroup>
            {isDefault && <Badge variant="outline">Default</Badge>}
          </div>
        </ItemContent>
        <ItemActions className="ml-auto shrink-0">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            aria-label={`Delete ${profile.name}`}
            disabled={busy || pending || isDefault}
            onClick={() => {
              setDeleteError(undefined);
              setDeleteOpen(true);
            }}
          >
            <Trash2Icon /> Delete
          </Button>
        </ItemActions>
      </Item>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete profile?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="font-semibold text-foreground">{profile.name}</strong> will be
              permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={deleteProfile}>
              {busy ? "Deleting..." : "Delete profile"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
