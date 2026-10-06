import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Mic2Icon } from "lucide-react";
import type { ShowId } from "@showtime/contracts";
import {
  NumberedResourceEditor,
  type NumberedResourceEditorConfig,
} from "@/components/numbered-resources/NumberedResourceEditor";
import { microphoneAtoms, microphonesRpcReactivityKey, type MicrophoneListItem } from "@/client";

export const Route = createFileRoute("/shows/$showId/microphones")({
  component: RouteComponent,
});

const config: NumberedResourceEditorConfig<MicrophoneListItem> = {
  singular: "microphone",
  plural: "microphones",
  activeListName: "microphone list",
  EmptyIcon: Mic2Icon,
  deleteLabel: (microphone) =>
    microphone.name?.trim()
      ? `“${microphone.name}” (number ${microphone.number})`
      : `microphone ${microphone.number}`,
};

function RouteComponent() {
  const { showId } = Route.useParams();
  const typedShowId = showId as ShowId;
  const atoms = React.useMemo(() => microphoneAtoms(typedShowId), [typedShowId]);
  const result = useAtomValue(atoms.microphones);
  const edit = useAtomSet(atoms.edit, { mode: "promiseExit" });
  const deleteMicrophone = useAtomSet(atoms.delete, { mode: "promiseExit" });

  return (
    <NumberedResourceEditor
      result={result}
      config={config}
      onEdit={(payload) =>
        edit({
          payload: { showId: typedShowId, ...payload },
          reactivityKeys: microphonesRpcReactivityKey(typedShowId),
        })
      }
      onDelete={(id) =>
        deleteMicrophone({
          payload: { showId: typedShowId, id },
          reactivityKeys: microphonesRpcReactivityKey(typedShowId),
        })
      }
    />
  );
}
