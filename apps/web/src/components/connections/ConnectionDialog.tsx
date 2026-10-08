import * as React from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import QRCode from "qrcode";
import {
  CheckIcon,
  CopyIcon,
  PlusIcon,
  QrCodeIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react";
import type {
  ShowtimeConnectionCandidate,
  ShowtimeConnectionsState,
  ShowtimeLocalDiscoveryState,
  ShowtimePendingClient,
} from "@showtime/shared";
import type { Profile } from "@showtime/contracts";
import {
  hasShowtimeConnectionManagementScopes,
  normalizeShowtimeHostName,
  showtimeHostNameMaxLength,
  showtimeConnectionManagementScopes,
} from "@showtime/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import {
  canLoadPairingInfo,
  pairingInfoPollDelay,
  pairingInfoRetryDelay,
  pairingInfoRetryWait,
  selectPairingCandidateUrl,
  shouldPollPairingInfo,
} from "./pairing-dialog";
import {
  getConnectionManagementClient,
  type ConnectionManagementClient,
} from "./connection-management";
import {
  connectionsStateCacheAtom,
  currentConnectionsStateResult,
  refreshConnectionsStateAtom,
} from "./connection-state-resource";
import { cn } from "@/lib/utils";
import { copyText } from "@/clipboard";
import { profileAtoms } from "@/client";
import { useProfileSelection } from "@/profiles";
import { currentProfilesState, ProfileControl } from "@/components/profiles/ProfileSwitcher";
import { showColorClassNames } from "@/components/shows/show-color";
import { SettingsHeader, SettingsItem, SettingsSection } from "@/components/settings/SettingsPage";

const timeUntil = (expiresAt: string, now: number) => {
  const remaining = Math.max(0, Date.parse(expiresAt) - now);
  if (remaining === 0) return "Link expired";
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return `Link expires in ${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export function ConnectionsSettings() {
  const [manager] = React.useState(getConnectionManagementClient);
  const cache = useAtomValue(connectionsStateCacheAtom);
  const loadState = useAtomSet(refreshConnectionsStateAtom, { mode: "promiseExit" });
  const setCache = useAtomSet(connectionsStateCacheAtom);
  const stateResult = currentConnectionsStateResult(cache, manager?.stateKey);
  const state = Option.getOrUndefined(AsyncResult.value(stateResult));
  const profilesResult = useAtomValue(profileAtoms.state);
  const profilesState = currentProfilesState(profilesResult);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<{
    readonly id: string;
    readonly name: string;
  }>();
  const [deleteError, setDeleteError] = React.useState<string>();
  const [hostNameDraft, setHostNameDraft] = React.useState("");
  const [hostNameConfirmOpen, setHostNameConfirmOpen] = React.useState(false);
  const [hostNameError, setHostNameError] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const [loading, setLoading] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
  const [pageVisible, setPageVisible] = React.useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const hostNameCandidate = hostNameDraft.trim()
    ? normalizeShowtimeHostName(hostNameDraft)
    : undefined;
  const hostNameChanged =
    state !== undefined && hostNameCandidate !== undefined && hostNameCandidate !== state.hostName;
  const hasPendingClients = state?.clients.some((client) => client.kind === "pending") ?? false;
  const loadedHostName = state?.hostName;

  React.useEffect(() => {
    if (loadedHostName) setHostNameDraft(loadedHostName);
  }, [loadedHostName]);

  React.useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const source = React.useMemo(
    () => (manager ? { key: manager.stateKey, manager } : undefined),
    [manager],
  );

  const applyState = React.useCallback(
    (value: ShowtimeConnectionsState) => {
      if (!manager) return;
      setCache((current) => ({
        key: manager.stateKey,
        revision: current.revision + 1,
        result: AsyncResult.success(value),
      }));
    },
    [manager, setCache],
  );

  const refreshNow = React.useCallback(() => {
    if (source) void loadState(source);
  }, [loadState, source]);

  React.useEffect(() => {
    if (!source || !pageVisible) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      await loadState(source);
      if (active) timer = window.setTimeout(poll, 1_000);
    };
    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadState, pageVisible, source]);

  React.useEffect(() => {
    if (!pageVisible || !hasPendingClients) return;
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clock);
  }, [hasPendingClients, pageVisible]);

  const updateEnabled = async (enabled: boolean) => {
    setLoading(true);
    setError(undefined);
    try {
      if (!manager?.setConnectionsEnabled) return;
      applyState(await manager.setConnectionsEnabled(enabled));
    } catch {
      setError("Showtime could not update connection settings.");
    } finally {
      setLoading(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setLoading(true);
    setDeleteError(undefined);
    try {
      if (!manager) return;
      applyState(await manager.removeConnection(deleteTarget.id));
      setDeleteTarget(undefined);
    } catch {
      setDeleteError("Showtime could not remove this client.");
    } finally {
      setLoading(false);
    }
  };

  const changeHostName = async () => {
    if (!hostNameCandidate || !hostNameChanged || !manager?.setHostName) return;
    setLoading(true);
    setHostNameError(undefined);
    try {
      applyState(await manager.setHostName(hostNameCandidate));
      setHostNameConfirmOpen(false);
    } catch {
      setHostNameError("Showtime could not change the host name.");
    } finally {
      setLoading(false);
    }
  };

  if (!manager) {
    return (
      <div className="space-y-6">
        <SettingsHeader>Connections</SettingsHeader>
        <SettingsSection title="Access">
          <SettingsItem
            title="Connection management unavailable"
            description="Connection settings can only be changed on the show computer or by a client with connection-management access."
          />
        </SettingsSection>
      </div>
    );
  }

  if (!state) {
    const failed = AsyncResult.isFailure(stateResult);
    return (
      <div className="space-y-6">
        <SettingsHeader>Connections</SettingsHeader>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">{failed ? <TriangleAlertIcon /> : <Spinner />}</EmptyMedia>
            <EmptyTitle>
              {failed ? "Connections could not be loaded" : "Loading connections"}
            </EmptyTitle>
            {failed && <EmptyDescription>Check the connection and try again.</EmptyDescription>}
          </EmptyHeader>
          {failed && (
            <EmptyContent>
              <Button type="button" variant="outline" onClick={refreshNow}>
                Try again
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <SettingsHeader>Connections</SettingsHeader>
        {manager.isOwner && (
          <SettingsSection title="Network">
            <SettingsItem
              title="Allow connections"
              description="Host the web app and let approved devices connect."
              action={
                <Switch
                  id="showtime-connections-enabled"
                  aria-label="Allow connections"
                  checked={state.enabled}
                  disabled={loading}
                  onCheckedChange={updateEnabled}
                />
              }
            />
            <SettingsItem
              title="Host name"
              description="The local address used to open Showtime. Changing it removes existing and pending client connections."
              action={
                <InputGroup className="w-fit max-w-full">
                  <InputGroupAddon>
                    <InputGroupText>showtime-</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Showtime host name"
                    className="w-auto min-w-0 flex-none px-0! [field-sizing:content]"
                    size={Math.max(1, Math.min(showtimeHostNameMaxLength, hostNameDraft.length))}
                    value={hostNameDraft}
                    maxLength={showtimeHostNameMaxLength}
                    pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={loading || !state.enabled}
                    onChange={(event) =>
                      setHostNameDraft(
                        event.currentTarget.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/g, "")
                          .slice(0, showtimeHostNameMaxLength),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && hostNameChanged) {
                        setHostNameError(undefined);
                        setHostNameConfirmOpen(true);
                      }
                      if (event.key === "Escape") setHostNameDraft(state.hostName);
                    }}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>.local</InputGroupText>
                    {hostNameChanged && (
                      <InputGroupButton
                        variant="destructive"
                        disabled={loading || !state.enabled}
                        onClick={() => {
                          setHostNameError(undefined);
                          setHostNameConfirmOpen(true);
                        }}
                      >
                        Change
                      </InputGroupButton>
                    )}
                  </InputGroupAddon>
                </InputGroup>
              }
            />
          </SettingsSection>
        )}
        <SettingsSection
          title="Devices"
          action={
            state.enabled && manager.canCreate ? (
              <Button
                type="button"
                disabled={loading}
                size="sm"
                onClick={() => setCreateOpen(true)}
              >
                <PlusIcon /> Add a new client
              </Button>
            ) : undefined
          }
        >
          {state.clients.length > 0 && (
            <ItemGroup className="gap-0 divide-y">
              {state.clients.map((client) => {
                const id = client.kind === "pending" ? client.invitationId : client.clientId;
                const connected = client.kind === "paired" && client.connected;
                return (
                  <Item key={id} className="min-h-16 border-0 px-0 py-3 sm:flex-nowrap">
                    <ItemMedia>
                      <span
                        className={`size-2.5 rounded-full ${connected ? "bg-primary" : "bg-destructive"}`}
                        aria-label={connected ? "Connected" : "Not connected"}
                      />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="flex items-center gap-2">
                        <span className="truncate">{client.name}</span>
                        <ClientProfileBadge
                          profile={profilesState?.profiles.find(
                            (profile) => profile.id === client.clientProfile,
                          )}
                        />
                      </ItemTitle>
                      <ItemDescription>
                        {client.kind === "pending"
                          ? timeUntil(client.expiresAt, now)
                          : connected
                            ? "Connected now"
                            : "Not currently connected"}
                        {hasShowtimeConnectionManagementScopes(client.scopes)
                          ? " · Can manage connections"
                          : ""}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      {client.kind === "pending" && (
                        <PairClientPopover
                          manager={manager}
                          client={client}
                          disabled={loading || !state.enabled}
                        />
                      )}
                      {manager.canDelete && (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={loading}
                          aria-label={`Revoke ${client.name}`}
                          onClick={() => {
                            setDeleteError(undefined);
                            setDeleteTarget({ id, name: client.name });
                          }}
                        >
                          <Trash2Icon /> Revoke
                        </Button>
                      )}
                    </ItemActions>
                  </Item>
                );
              })}
            </ItemGroup>
          )}
          {!loading && state.clients.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <WifiOffIcon />
                </EmptyMedia>
                <EmptyTitle>No connected clients</EmptyTitle>
                <EmptyDescription>
                  Add a client to give another device access to Showtime.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </SettingsSection>
        {(error ??
          (AsyncResult.isFailure(stateResult)
            ? "Showtime could not load connections."
            : undefined)) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? "Showtime could not load connections."}
          </p>
        )}
      </div>
      <CreateClientDialog
        manager={manager}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={applyState}
        profilesState={profilesState}
        profilesResult={profilesResult}
      />
      <AlertDialog open={hostNameConfirmOpen} onOpenChange={setHostNameConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TriangleAlertIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Change the host name?</AlertDialogTitle>
            <AlertDialogDescription>
              The old address will stop working. Every paired client and pending connection will be
              removed. Change{" "}
              <strong className="font-semibold text-foreground">{state.hostname}</strong> to{" "}
              <strong className="font-semibold text-foreground">
                showtime-{hostNameCandidate}.local
              </strong>{" "}
              and remove {state.clients.length} connection{state.clients.length === 1 ? "" : "s"}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          {hostNameError && (
            <p role="alert" className="text-sm text-destructive">
              {hostNameError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={loading}
              onClick={changeHostName}
            >
              {loading ? "Changing..." : "Change and remove connections"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={deleteTarget !== undefined}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>Revoke device?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="font-semibold text-foreground">{deleteTarget?.name}</strong> will
              no longer be able to connect to Showtime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={loading} onClick={remove}>
              {loading ? "Revoking..." : "Revoke device"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ClientProfileBadge({ profile }: { readonly profile: Profile | undefined }) {
  return (
    <Badge variant="outline">
      <span
        className={cn(
          profile ? showColorClassNames[profile.color] : "bg-muted-foreground",
          "size-2 rounded-full",
        )}
      />
      {profile?.name ?? "Unknown profile"}
    </Badge>
  );
}

function CreateClientDialog({
  manager,
  open,
  onOpenChange,
  onCreated,
  profilesState,
  profilesResult,
}: {
  readonly manager: ConnectionManagementClient;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (state: ShowtimeConnectionsState) => void;
  readonly profilesState: ReturnType<typeof currentProfilesState>;
  readonly profilesResult: Parameters<typeof currentProfilesState>[0];
}) {
  const { selected: currentProfile } = useProfileSelection(profilesState);
  const [name, setName] = React.useState("");
  const [clientProfileId, setClientProfileId] = React.useState("");
  const [canManageConnections, setCanManageConnections] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const creatingRef = React.useRef(false);
  const profileInitializedForOpen = React.useRef(false);
  const [error, setError] = React.useState<string>();
  const selectedProfile =
    profilesState?.profiles.find((profile) => profile.id === clientProfileId) ?? currentProfile;
  React.useEffect(() => {
    if (!open) {
      profileInitializedForOpen.current = false;
      return;
    }
    if (!profileInitializedForOpen.current && currentProfile) {
      profileInitializedForOpen.current = true;
      setClientProfileId(currentProfile.id);
    }
  }, [currentProfile, open]);
  const create = async () => {
    if (creatingRef.current || !selectedProfile) return;
    creatingRef.current = true;
    setCreating(true);
    setError(undefined);
    try {
      onCreated(
        await manager.createInvitation(
          name.trim() || undefined,
          selectedProfile.id,
          canManageConnections ? showtimeConnectionManagementScopes : [],
        ),
      );
      setName("");
      setCanManageConnections(false);
      onOpenChange(false);
    } catch {
      setError("Showtime could not add this client.");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new client</DialogTitle>
          <DialogDescription>
            Add a label to make this device easy to recognize, or leave it blank to use the next
            client number.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          maxLength={80}
          placeholder="For example, Alex’s iPad"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && !creating && void create()}
        />
        <ProfileControl
          className="w-full"
          state={profilesState}
          selected={selectedProfile}
          onSelect={(profile) => {
            profileInitializedForOpen.current = true;
            setClientProfileId(profile.id);
          }}
          loadResult={profilesResult}
          fullWidth
        />
        <Item variant="outline" render={<label htmlFor="showtime-client-can-manage" />}>
          <ItemContent>
            <ItemTitle>Allow this client to manage connections</ItemTitle>
            <ItemDescription>Let it view, add, connect, and remove other clients.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              id="showtime-client-can-manage"
              checked={canManageConnections}
              disabled={creating}
              onCheckedChange={setCanManageConnections}
            />
          </ItemActions>
        </Item>
        <Button type="button" disabled={creating || !selectedProfile} onClick={create}>
          {creating ? "Creating…" : "Create client"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PairClientPopover({
  manager,
  client,
  disabled,
}: {
  readonly manager: ConnectionManagementClient;
  readonly client: ShowtimePendingClient;
  readonly disabled: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [candidates, setCandidates] = React.useState<ReadonlyArray<ShowtimeConnectionCandidate>>(
    [],
  );
  const [selectedUrl, setSelectedUrl] = React.useState("");
  const [discovery, setDiscovery] = React.useState<ShowtimeLocalDiscoveryState>({
    kind: "disabled",
  });
  const [qrCode, setQrCode] = React.useState<string>();
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string>();
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setCandidates([]);
    setSelectedUrl("");
    setDiscovery({ kind: "probing" });
    setQrCode(undefined);
    setCopied(false);
    setError(undefined);
    let loadTimer: number | undefined;
    let expiryTimer: number | undefined;
    let consecutiveFailures = 0;
    let expiresAt = Date.parse(client.expiresAt);
    let hasRequestedPairingInfo = false;
    const setExpired = () => {
      if (!active) return;
      setCandidates([]);
      setSelectedUrl("");
      setQrCode(undefined);
      setError("This connection link has expired.");
    };
    const scheduleExpiry = () => {
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
      const wait = expiresAt - Date.now();
      if (!Number.isFinite(wait) || wait <= 0) {
        setExpired();
        return false;
      }
      expiryTimer = window.setTimeout(setExpired, wait);
      return true;
    };
    const hasExpired = () => pairingInfoRetryWait(expiresAt, 0) === undefined;
    const scheduleLoad = (delay: number) => {
      const wait = pairingInfoRetryWait(expiresAt, delay);
      if (wait === undefined) {
        setExpired();
        return;
      }
      loadTimer = window.setTimeout(load, wait);
    };
    const load = () => {
      if (!active) return;
      if (!canLoadPairingInfo(hasRequestedPairingInfo, expiresAt)) {
        setExpired();
        return;
      }
      hasRequestedPairingInfo = true;
      void manager.pairingInfo(client.invitationId).then(
        (info) => {
          if (!active) return;
          if (info.expiresAt === null) {
            setExpired();
            return;
          }
          expiresAt = Date.parse(info.expiresAt);
          if (hasExpired() || !scheduleExpiry()) return;
          consecutiveFailures = 0;
          setDiscovery(info.discovery);
          setCandidates(info.candidates);
          setSelectedUrl((currentUrl) => selectPairingCandidateUrl(info.candidates, currentUrl));
          if (info.discovery.kind === "probing") {
            setError(undefined);
          } else if (info.candidates.length === 0) {
            setError("No local network was found on this computer.");
          } else {
            setError(undefined);
          }
          if (shouldPollPairingInfo(info.discovery)) scheduleLoad(pairingInfoPollDelay);
        },
        () => {
          if (!active) return;
          if (hasExpired()) {
            setExpired();
            return;
          }
          consecutiveFailures += 1;
          setError("Showtime could not refresh the connection link. Retrying...");
          scheduleLoad(pairingInfoRetryDelay(consecutiveFailures));
        },
      );
    };
    load();
    return () => {
      active = false;
      if (loadTimer !== undefined) window.clearTimeout(loadTimer);
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
    };
  }, [client.expiresAt, client.invitationId, manager, open]);
  React.useEffect(() => {
    setQrCode(undefined);
    setCopied(false);
    if (!selectedUrl) return;
    setError(undefined);
    let active = true;
    void QRCode.toDataURL(selectedUrl, { errorCorrectionLevel: "M", margin: 2, width: 640 }).then(
      (value) => active && setQrCode(value),
    );
    return () => {
      active = false;
    };
  }, [selectedUrl]);
  const selected = candidates.find((candidate) => candidate.url === selectedUrl);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="outline" size="sm" disabled={disabled} />}
      >
        <QrCodeIcon /> Connect
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-3">
        {candidates.length > 0 && (
          <Select value={selectedUrl} onValueChange={(value) => value && setSelectedUrl(value)}>
            <SelectTrigger aria-label="Connection address">
              <SelectValue>{selected?.label ?? "Choose address"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.url} value={candidate.url}>
                  {candidate.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {selectedUrl && (
          <Input
            aria-label="Connection link"
            type="url"
            value={selectedUrl}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
        {qrCode && (
          <div className="aspect-square w-full overflow-hidden rounded-lg">
            <img
              src={qrCode}
              alt={`QR code for connecting ${client.name}`}
              className="block size-full rounded-lg"
            />
          </div>
        )}
        {discovery.kind === "probing" && !error && (
          <p className="text-sm text-muted-foreground">Finding an easy local address...</p>
        )}
        {discovery.kind === "degraded" && candidates.length > 0 && (
          <p className="text-sm text-muted-foreground">
            The easy local name is unavailable on this network. The IP address will still work.
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={!selectedUrl}
          onClick={async () => {
            try {
              await copyText(selectedUrl);
              setCopied(true);
              setError(undefined);
            } catch {
              setCopied(false);
              setError(
                "Could not copy automatically. Select the connection link above to copy it.",
              );
            }
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy connection link"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
