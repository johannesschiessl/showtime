import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { SpeakerIcon } from "lucide-react";
import { mainMixId, type ShowId } from "@showtime/contracts";
import {
  NumberedResourceEditor,
  type NumberedResourceEditorConfig,
} from "@/components/numbered-resources/NumberedResourceEditor";
import { mixAtoms, mixesRpcReactivityKey, type MixListItem } from "@/client";

export const Route = createFileRoute("/shows/$showId/mixes")({ component: RouteComponent });

const config: NumberedResourceEditorConfig<MixListItem> = {
  singular: "mix",
  plural: "mixes",
  activeListName: "mix list",
  EmptyIcon: SpeakerIcon,
  canDelete: (mix) => mix.id !== mainMixId,
  badge: (mix) => (mix.id === mainMixId ? "Main mix" : undefined),
  deleteLabel: (mix) => (mix.name?.trim() ? `“${mix.name}” (${mix.number})` : `mix ${mix.number}`),
};

function RouteComponent() {
  const { showId } = Route.useParams();
  const typedShowId = showId as ShowId;
  const atoms = React.useMemo(() => mixAtoms(typedShowId), [typedShowId]);
  const result = useAtomValue(atoms.mixes);
  const edit = useAtomSet(atoms.edit, { mode: "promiseExit" });
  const deleteMix = useAtomSet(atoms.delete, { mode: "promiseExit" });

  return (
    <NumberedResourceEditor
      result={result}
      config={config}
      onEdit={(payload) =>
        edit({
          payload: { showId: typedShowId, ...payload },
          reactivityKeys: mixesRpcReactivityKey(typedShowId),
        })
      }
      onDelete={(id) =>
        deleteMix({
          payload: { showId: typedShowId, id },
          reactivityKeys: mixesRpcReactivityKey(typedShowId),
        })
      }
    />
  );
}
