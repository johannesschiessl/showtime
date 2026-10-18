// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { Exit } from "effect";
import { AtomRegistry, AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Color, ShowId, ShowName, ShowSummary } from "@showtime/contracts";
import { GeneralSettings } from "./GeneralSettings";

const mocks = vi.hoisted(() => ({
  editShow:
    vi.fn<
      (input: {
        payload: { id: ShowId; name: ShowName; color: Color };
      }) => Promise<Exit.Exit<ShowSummary, string>>
    >(),
}));

const { confirmedShowsAtom, showsAtom } = await vi.hoisted(async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    confirmedShowsAtom: Atom.make(AsyncResult.success<ReadonlyArray<ShowSummary>, string>([])),
    showsAtom: Atom.make(AsyncResult.success<ReadonlyArray<ShowSummary>, string>([])),
  };
});

vi.mock("@/client", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    confirmedShowsAtom,
    showsAtom,
    editShowAtom: Atom.make(AsyncResult.initial()),
    showDialogAtom: Atom.make({ type: "closed" }),
    showMutationOptions: {},
    rpcErrorMessageFromCause: () => "Save failed",
  };
});

vi.mock("@/hooks/useRpcMutation", () => ({ useRpcMutation: () => mocks.editShow }));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ showId: "show_000000000001" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/shows/ShowDeleteDialog", () => ({ ShowDeleteDialog: () => null }));
vi.mock("@/components/ColorPickerPopover", () => ({ ColorPickerPopover: () => null }));

const show = (name: string): ShowSummary => ({
  id: "show_000000000001" as ShowId,
  name: name as ShowName,
  color: "blue" as Color,
  createdAt: "2026-10-18T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
});

describe("GeneralSettings saves", () => {
  let container: HTMLDivElement;
  let root: Root;
  let registry: AtomRegistry.AtomRegistry;
  let input: HTMLInputElement;
  let finishSave: (result: Exit.Exit<ShowSummary, string>) => void;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.editShow.mockReset();
    registry = AtomRegistry.make();
    registry.set(confirmedShowsAtom, AsyncResult.success([show("Old")]));
    registry.set(showsAtom, AsyncResult.success([show("Old")]));
    const completion = new Promise<Exit.Exit<ShowSummary, string>>((resolve) => {
      finishSave = resolve;
    });
    mocks.editShow.mockImplementation(({ payload }) => {
      registry.set(showsAtom, AsyncResult.success([show(payload.name)]));
      return completion;
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <RegistryContext.Provider value={registry}>
          <GeneralSettings />
        </RegistryContext.Provider>,
      );
    });
    input = container.querySelector<HTMLInputElement>('[aria-label="Show name"]')!;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    registry.dispose();
    container.remove();
    vi.unstubAllGlobals();
  });

  const typeName = async (name: string) => {
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  const blur = async () => {
    await act(async () => {
      input.focus();
      input.blur();
    });
  };

  it("keeps a failed optimistic save available for retry", async () => {
    await typeName("New");
    await blur();
    expect(mocks.editShow).toHaveBeenCalledTimes(1);

    await act(async () => {
      registry.set(showsAtom, AsyncResult.success([show("Old")]));
      finishSave(Exit.fail("offline"));
    });

    expect(input.value).toBe("New");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Save failed");
    mocks.editShow.mockResolvedValueOnce(Exit.succeed(show("New")));
    await blur();
    expect(mocks.editShow).toHaveBeenCalledTimes(2);
    expect(mocks.editShow.mock.calls[1]?.[0].payload.name).toBe("New");
  });

  it("accepts the normalized successful name and later remote renames", async () => {
    await typeName("New ");
    await blur();
    expect(mocks.editShow.mock.calls[0]?.[0].payload.name).toBe("New");

    await act(async () => {
      registry.set(confirmedShowsAtom, AsyncResult.success([show("New")]));
      finishSave(Exit.succeed(show("New")));
    });
    expect(input.value).toBe("New");

    await act(async () => {
      registry.set(confirmedShowsAtom, AsyncResult.success([show("Remote")]));
      registry.set(showsAtom, AsyncResult.success([show("Remote")]));
    });
    expect(input.value).toBe("Remote");
    await blur();
    expect(mocks.editShow).toHaveBeenCalledTimes(1);
  });

  it("preserves newer edits when an earlier save succeeds", async () => {
    await typeName("New ");
    await blur();
    await typeName("Still typing");

    await act(async () => {
      registry.set(confirmedShowsAtom, AsyncResult.success([show("New")]));
      finishSave(Exit.succeed(show("New")));
    });
    expect(input.value).toBe("Still typing");

    await act(async () => {
      registry.set(confirmedShowsAtom, AsyncResult.success([show("Remote")]));
    });
    expect(input.value).toBe("Still typing");
  });

  it("normalizes an unchanged name without saving or blocking remote renames", async () => {
    await typeName("Old ");
    await blur();
    expect(input.value).toBe("Old");
    expect(mocks.editShow).not.toHaveBeenCalled();

    await act(async () => {
      registry.set(confirmedShowsAtom, AsyncResult.success([show("Remote")]));
    });
    expect(input.value).toBe("Remote");
  });
});
