// @vitest-environment happy-dom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { PairingResult } from "@/connection";
import { PairingStartup } from "./PairingStartup";

describe("PairingStartup", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await React.act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("renders the app synchronously when there is no pairing request", () => {
    expect(
      renderToStaticMarkup(
        <PairingStartup request={undefined}>
          <p>Show list</p>
        </PairingStartup>,
      ),
    ).toBe("<p>Show list</p>");
  });

  it("keeps the app pending until the pairing request finishes", async () => {
    let complete!: (result: PairingResult) => void;
    const request = new Promise<PairingResult>((resolve) => {
      complete = resolve;
    });
    await React.act(async () => {
      root.render(
        <PairingStartup request={request}>
          <p>Show list</p>
        </PairingStartup>,
      );
    });
    expect(container.textContent).toContain("Connecting to Showtime");
    expect(container.textContent).not.toContain("Show list");
    await React.act(async () => complete({ status: "paired" }));
    expect(container.textContent).toBe("Show list");
  });

  it("shows a recoverable failure when pairing unexpectedly rejects", async () => {
    let fail!: (error: Error) => void;
    const request = new Promise<PairingResult>((_resolve, reject) => {
      fail = reject;
    });
    await React.act(async () => {
      root.render(
        <PairingStartup request={request}>
          <p>Show list</p>
        </PairingStartup>,
      );
    });
    await React.act(async () => fail(new Error("History unavailable")));
    expect(container.textContent).toContain("Could not connect to Showtime");
    expect(container.textContent).toContain("Open the connection link again.");
    expect(container.textContent).not.toContain("Show list");
  });
});
