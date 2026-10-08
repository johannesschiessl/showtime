import { TitleBar } from "@/components/TitleBar";
import { LiveTitleBarStatus } from "@/components/live/LiveTitleBarStatus";
import { songAtoms } from "@/client";
import { endLiveSession, useLiveElapsed } from "@/lib/LiveSession";
import { useAtomValue } from "@effect/atom-react";
import { useShowFromParams } from "@/hooks/useShowFromParams";
import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import type { ShowId } from "@showtime/contracts";
import { AsyncResult } from "effect/reactivity";
import React from "react";
import { LiveChatDrawer } from "@/components/live/LiveChatDrawer";
import { useLivePresence } from "@/lib/useLivePresence";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

export const Route = createFileRoute("/live")({
  component: RouteComponent,
});

function RouteComponent() {
  const { show: liveShow, showId } = useShowFromParams();
  if (!showId) {
    return (
      <React.Fragment>
        <TitleBar hideName={true} stack="above-content" />
        <div className="app-height overflow-hidden pt-[var(--title-bar-height)]">
          <Outlet />
        </div>
      </React.Fragment>
    );
  }

  return <LiveRouteContent key={showId} liveShow={liveShow} showId={showId as ShowId} />;
}

function LiveRouteContent({
  liveShow,
  showId,
}: {
  readonly liveShow: ReturnType<typeof useShowFromParams>["show"];
  readonly showId: ShowId;
}) {
  const typedShowId = showId;
  const liveRegistered = useLivePresence(typedShowId);
  const [liveReady, setLiveReady] = React.useState(false);

  React.useEffect(() => {
    if (liveRegistered) setLiveReady(true);
  }, [liveRegistered]);

  const songsResult = useAtomValue(songAtoms(typedShowId).songs);
  const songs = AsyncResult.getOrElse(songsResult, () => []).filter((song) => !song.deletedAt);
  const search = useRouterState({ select: (state) => state.location.search });
  const selectedId = typeof search.song === "string" ? search.song : undefined;
  const selectedIndex = Math.max(
    0,
    songs.findIndex((song) => song.id === selectedId),
  );
  const selectedSong = songs[selectedIndex];
  const elapsed = useLiveElapsed(typedShowId);

  return (
    <React.Fragment>
      <TitleBar
        hideName={true}
        liveShow={liveShow}
        liveStatus={
          selectedSong ? (
            <LiveTitleBarStatus
              position={selectedIndex + 1}
              total={songs.length}
              elapsed={elapsed}
            />
          ) : undefined
        }
        onLiveBack={() => endLiveSession(typedShowId)}
        stack="above-content"
      />
      <div className="app-height overflow-hidden pt-[var(--title-bar-height)]">
        {liveReady ? (
          <Outlet />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Spinner />
              </EmptyMedia>
              <EmptyTitle>Preparing Live</EmptyTitle>
              <EmptyDescription>
                Confirming that Showtime will remain available for this show.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      {liveReady && <LiveChatDrawer showId={typedShowId} />}
    </React.Fragment>
  );
}
