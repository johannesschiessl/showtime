import * as React from "react";
import { LinkIcon, RadioTowerIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ConnectionLinkDialog } from "./ConnectionLinkDialog";

export function ConnectToShowtime({
  error,
  pending = false,
}: {
  readonly error?: string;
  readonly pending?: boolean;
}) {
  const [connectOpen, setConnectOpen] = React.useState(false);

  return (
    <main className="app-height flex bg-background pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] text-foreground">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RadioTowerIcon />
          </EmptyMedia>
          <EmptyTitle>
            {pending
              ? "Connecting to Showtime…"
              : error
                ? "Could not connect to Showtime"
                : "Connect to Showtime"}
          </EmptyTitle>
          <EmptyDescription>
            {pending
              ? "Saving this device's connection. This may take a few seconds."
              : (error ??
                "On the show computer, add this device under Connections. Then copy and open its connection link on this device.")}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" onClick={() => setConnectOpen(true)}>
            <LinkIcon /> Paste connection link
          </Button>
          <p className="max-w-sm text-xs text-muted-foreground">
            Keep both devices on the same local network. Connection links can also be sent through
            WhatsApp or another messaging app.
          </p>
        </EmptyContent>
      </Empty>
      <ConnectionLinkDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </main>
  );
}
