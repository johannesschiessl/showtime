// @vitest-environment happy-dom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { capturePairingFragment } from "@/connection";
import { ConnectionLinkDialog } from "./ConnectionLinkDialog";

vi.mock("@/connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/connection")>()),
  capturePairingFragment: vi.fn(),
}));
vi.mock("@/pwa", () => ({ isStandalonePwa: () => false }));

describe("ConnectionLinkDialog", () => {
  let root: Root;

  beforeEach(() => {
    vi.mocked(capturePairingFragment).mockReset();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function submitConnectionLink(link: string) {
    await React.act(async () => {
      root.render(<ConnectionLinkDialog open onOpenChange={vi.fn()} />);
    });

    const input = document.querySelector<HTMLInputElement>("#showtime-connection-url")!;
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, link);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await React.act(async () => {
      document
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  it("redeems a pasted same-origin link without navigating a regular browser tab", async () => {
    vi.mocked(capturePairingFragment).mockResolvedValue({ status: "paired" });
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const token = "p".repeat(43);
    await submitConnectionLink(`${window.location.origin}/#pair=${token}`);

    expect(capturePairingFragment).toHaveBeenCalledWith({
      hash: `#pair=${token}`,
      pathname: window.location.pathname,
      search: window.location.search,
    });
    expect(assign).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("navigates to a cross-origin pairing link without redeeming it locally", async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const link = `http://showtime-front-of-house.local:8585/#pair=${"p".repeat(43)}`;
    await submitConnectionLink(link);

    expect(assign).toHaveBeenCalledExactlyOnceWith(link);
    expect(capturePairingFragment).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows a failed pairing result without reloading", async () => {
    const message = "This connection link has expired. Ask for a new link.";
    vi.mocked(capturePairingFragment).mockResolvedValue({ status: "failed", message });
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    await submitConnectionLink(`${window.location.origin}/#pair=${"p".repeat(43)}`);

    const alert = document.querySelector('p[role="alert"]');
    expect(alert?.textContent).toBe(message);
    expect(assign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
