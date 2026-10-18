import * as React from "react";
import { useRpcMutation } from "@/hooks/useRpcMutation";
import { Exit } from "effect";
import { nanoid } from "nanoid";
import { liveHeartbeatIntervalMs, type LiveSessionId, type ShowId } from "@showtime/contracts";
import { livePresenceAtoms } from "@/client";

export function useLivePresence(showId: ShowId): boolean {
  const heartbeat = useRpcMutation(livePresenceAtoms.heartbeat);
  const release = useRpcMutation(livePresenceAtoms.release);
  const sessionId = React.useMemo(() => `live-${nanoid()}` as LiveSessionId, []);
  const [registered, setRegistered] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    let pending = false;

    const renew = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await heartbeat({ payload: { sessionId, showId } });
        if (active) setRegistered(Exit.isSuccess(result) && result.value);
      } finally {
        pending = false;
      }
    };

    void renew();
    const interval = window.setInterval(renew, liveHeartbeatIntervalMs);
    return () => {
      active = false;
      window.clearInterval(interval);
      void release({ payload: { sessionId } });
    };
  }, [heartbeat, release, sessionId, showId]);

  return registered;
}
