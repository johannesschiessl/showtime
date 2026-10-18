import * as React from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { liveSongNavigationDirection } from "./LiveSongNavigationState";

export function LiveSongNavigation({
  previous,
  next,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  readonly previous?: string;
  readonly next?: string;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;

      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "a,button,input,select,textarea,[contenteditable],[role='button'],[role='textbox']",
        )
      )
        return;

      const direction = liveSongNavigationDirection(event.key);
      if (direction === "previous" && hasPrevious) {
        event.preventDefault();
        onPrevious();
      } else if (direction === "next" && hasNext) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasNext, onNext, onPrevious, hasPrevious]);

  return (
    <nav
      aria-label="Setlist navigation"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 gap-2 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:pointer-events-none sm:inset-0 sm:block sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none"
    >
      <div className="min-w-0 sm:pointer-events-auto sm:fixed sm:top-1/2 sm:left-4 sm:-translate-y-1/2">
        <Button
          variant="outline"
          size="lg"
          disabled={!hasPrevious}
          aria-label={
            hasPrevious ? `Previous song: ${previous || "Unnamed song"}` : "Start of setlist"
          }
          aria-keyshortcuts="ArrowLeft ArrowDown"
          onClick={onPrevious}
          className="w-full min-w-0 sm:w-auto"
        >
          <ChevronLeftIcon />
          <span className="min-w-0 flex-1 truncate sm:max-w-40">
            {hasPrevious ? previous || "Unnamed song" : "Start"}
          </span>
        </Button>
      </div>
      <div className="min-w-0 sm:pointer-events-auto sm:fixed sm:top-1/2 sm:right-4 sm:-translate-y-1/2">
        <Button
          variant="outline"
          size="lg"
          disabled={!hasNext}
          aria-label={hasNext ? `Next song: ${next || "Unnamed song"}` : "End of setlist"}
          aria-keyshortcuts="Space ArrowRight ArrowUp"
          onClick={onNext}
          className="w-full min-w-0 sm:w-auto"
        >
          <span className="min-w-0 flex-1 truncate sm:max-w-40">
            {hasNext ? next || "Unnamed song" : "End"}
          </span>
          <ChevronRightIcon />
        </Button>
      </div>
    </nav>
  );
}
