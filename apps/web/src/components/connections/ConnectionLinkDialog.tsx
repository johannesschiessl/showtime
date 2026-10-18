import * as React from "react";
import { LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { capturePairingFragment, showtimePairingNavigationUrl } from "@/connection";
import { isStandalonePwa } from "@/pwa";

type ConnectionState = "idle" | "connecting" | "error";

export function ConnectionLinkDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const handledRef = React.useRef(false);
  const [state, setState] = React.useState<ConnectionState>("idle");
  const [message, setMessage] = React.useState<string>();
  const [connectionUrl, setConnectionUrl] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setConnectionUrl("");
      return;
    }
    handledRef.current = false;
    setState("idle");
    setMessage(undefined);
  }, [open]);

  const connect = React.useCallback(async (value: string) => {
    const standalone = isStandalonePwa();
    const pairingUrl = showtimePairingNavigationUrl(value, window.location.href, standalone);
    if (!pairingUrl) {
      setState("error");
      setMessage(
        "This is not a complete Showtime connection link. Copy the entire link, including #pair= at the end.",
      );
      return false;
    }
    if (handledRef.current) return true;
    handledRef.current = true;
    setState("connecting");
    setMessage(undefined);
    navigator.vibrate?.(40);

    if (standalone || new URL(pairingUrl).origin === window.location.origin) {
      const target = new URL(pairingUrl);
      const result = await capturePairingFragment({
        hash: target.hash,
        pathname: window.location.pathname,
        search: window.location.search,
      });
      if (result.status === "paired") {
        window.location.reload();
        return true;
      }
      handledRef.current = false;
      setState("error");
      setMessage(
        result.status === "failed"
          ? result.message
          : "Showtime could not open this connection link.",
      );
      return false;
    }

    window.location.assign(pairingUrl);
    return true;
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect to Showtime</DialogTitle>
          <DialogDescription>
            Paste the complete connection link supplied by the show computer. You can send the link
            to this device through WhatsApp or another messaging app.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void connect(connectionUrl.trim());
          }}
        >
          <label htmlFor="showtime-connection-url" className="text-sm font-medium">
            Connection link
          </label>
          <Input
            id="showtime-connection-url"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="http://showtime-front-of-house.local:8585/#pair=…"
            value={connectionUrl}
            onChange={(event) => {
              setConnectionUrl(event.currentTarget.value);
              if (state === "error") {
                setState("idle");
                setMessage(undefined);
              }
            }}
          />
          <Button type="submit" disabled={!connectionUrl.trim() || state === "connecting"}>
            <LinkIcon /> {state === "connecting" ? "Connecting…" : "Open connection link"}
          </Button>
        </form>

        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
