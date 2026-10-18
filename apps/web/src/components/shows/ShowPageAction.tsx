import { useRpcMutation } from "@/hooks/useRpcMutation";
import type { ShowId } from "@showtime/contracts";
import { PlusIcon } from "lucide-react";
import {
  microphoneAtoms,
  microphonesRpcReactivityKey,
  mixAtoms,
  mixesRpcReactivityKey,
} from "@/client";
import { useCreateSong } from "@/components/songs/useCreateSong";
import { Button } from "@/components/ui/button";
import { randomShowColor } from "./show-color";

export function ShowPageAction({
  showId,
  pathname,
}: {
  readonly showId: ShowId;
  readonly pathname: string;
}) {
  const createMicrophone = useRpcMutation(microphoneAtoms(showId).create);
  const createMix = useRpcMutation(mixAtoms(showId).create);
  const songCreator = useCreateSong(showId);

  if (pathname.endsWith("/microphones")) {
    return (
      <Button
        size="sm"
        aria-label="Add microphone"
        onClick={() =>
          createMicrophone({
            payload: { showId, color: randomShowColor() },
            reactivityKeys: microphonesRpcReactivityKey(showId),
          })
        }
      >
        <PlusIcon /> <span className="hidden min-[400px]:inline">Add microphone</span>
      </Button>
    );
  }

  if (pathname.endsWith("/mixes")) {
    return (
      <Button
        size="sm"
        aria-label="Add mix"
        onClick={() =>
          createMix({
            payload: { showId, color: randomShowColor() },
            reactivityKeys: mixesRpcReactivityKey(showId),
          })
        }
      >
        <PlusIcon /> <span className="hidden min-[400px]:inline">Add mix</span>
      </Button>
    );
  }

  if (/\/setlist\/?$/.test(pathname)) {
    return (
      <Button
        size="sm"
        aria-label={songCreator.isCreating ? "Adding song" : "Add song"}
        disabled={songCreator.isCreating}
        onClick={songCreator.createSong}
      >
        <PlusIcon />
        <span className="hidden min-[400px]:inline">
          {songCreator.isCreating ? "Adding..." : "Add song"}
        </span>
      </Button>
    );
  }

  return null;
}
