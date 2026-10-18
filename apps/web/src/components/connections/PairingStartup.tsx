import * as React from "react";
import type { PairingResult } from "@/connection";
import { ConnectToShowtime } from "./ConnectToShowtime";

export function PairingStartup({
  request,
  children,
}: {
  readonly request: Promise<PairingResult> | undefined;
  readonly children: React.ReactNode;
}) {
  const [pairing, setPairing] = React.useState<PairingResult | undefined>(() =>
    request ? undefined : { status: "none" },
  );
  React.useEffect(() => {
    if (!request) return;
    void request.then(setPairing, () =>
      setPairing({
        status: "failed",
        message: "Showtime could not complete the connection. Open the connection link again.",
      }),
    );
  }, [request]);
  if (!pairing) return <ConnectToShowtime pending />;
  if (pairing.status === "failed") return <ConnectToShowtime error={pairing.message} />;
  return children;
}
