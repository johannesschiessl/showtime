import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { ArrowLeftIcon, Settings2Icon } from "lucide-react";
import { showsAtom } from "@/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showColorClassNames } from "@/components/shows/show-color";
import { cn } from "@/lib/utils";

const allShowsValue = "all-shows";
const globalSettingsLabels = {
  appearance: "Appearance",
  connections: "Connections",
  profiles: "Profiles",
  updates: "Updates",
} as const;

type GlobalSettingsSection = keyof typeof globalSettingsLabels;

export function globalSettingsSectionFromParams(section: unknown): GlobalSettingsSection {
  return typeof section === "string" &&
    Object.prototype.hasOwnProperty.call(globalSettingsLabels, section)
    ? (section as GlobalSettingsSection)
    : "updates";
}

export function ShowSwitcher({
  showId,
  destination,
}: {
  readonly showId?: string;
  readonly destination: "show" | "settings";
}) {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const result = useAtomValue(showsAtom);
  const shows = AsyncResult.isSuccess(result)
    ? result.value
    : AsyncResult.isFailure(result)
      ? (Option.getOrUndefined(result.previousSuccess)?.value ?? [])
      : [];
  const selected = shows.find((show) => show.id === showId);
  const globalSettingsSection = globalSettingsSectionFromParams(params.section);
  const globalSettingsLabel = globalSettingsLabels[globalSettingsSection];

  const select = (value: string | null) => {
    if (!value) return;
    if (value === allShowsValue) {
      void navigate(
        destination === "settings"
          ? { to: "/settings/$section", params: { section: globalSettingsSection } }
          : { to: "/" },
      );
      return;
    }

    void navigate(
      destination === "settings"
        ? {
            to: "/shows/$showId/settings/$section",
            params: { showId: value, section: "general" },
          }
        : { to: "/shows/$showId", params: { showId: value } },
    );
  };

  return (
    <div className="no-drag-region">
      <Select value={showId ?? allShowsValue} onValueChange={select}>
        <SelectTrigger aria-label="Active show">
          <SelectValue>
            {selected ? (
              <ShowLabel name={selected.name} color={selected.color} />
            ) : destination === "settings" ? (
              globalSettingsLabel
            ) : (
              "All shows"
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {shows.map((show) => (
            <SelectItem
              key={show.id}
              value={show.id}
              disabled={"pending" in show && show.pending === true}
            >
              <ShowLabel name={show.name} color={show.color} />
            </SelectItem>
          ))}
          <SelectItem value={allShowsValue}>
            <span className="flex items-center gap-2">
              <span className="flex size-4 shrink-0 items-center justify-center">
                {destination === "settings" ? (
                  <Settings2Icon className="size-3.5" />
                ) : (
                  <ArrowLeftIcon className="size-3.5" />
                )}
              </span>
              <span>{destination === "settings" ? globalSettingsLabel : "All shows"}</span>
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function ShowLabel({
  name,
  color,
}: {
  readonly name: string;
  readonly color: keyof typeof showColorClassNames;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={cn(showColorClassNames[color], "size-4 shrink-0 rounded-[2px]")} />
      <span className="truncate">{name}</span>
    </span>
  );
}
