import { describe, expect, it } from "vite-plus/test";
import { profileSelectionStorageKey, readProfileSelection } from "./profile-selection";

const storageWith = (value: string | null) => ({
  getItem: (key: string) => (key === profileSelectionStorageKey ? value : null),
});

describe("profile selection persistence", () => {
  it("returns a valid branded profile ID", () => {
    expect(
      readProfileSelection(
        storageWith(JSON.stringify({ version: 1, profileId: "profile_0000000000000000" })),
      ),
    ).toBe("profile_0000000000000000");
  });

  it("rejects strings that are not profile IDs", () => {
    expect(
      readProfileSelection(storageWith(JSON.stringify({ version: 1, profileId: "corrupted" }))),
    ).toBeUndefined();
  });

  it("rejects malformed storage", () => {
    expect(readProfileSelection(storageWith("not-json"))).toBeUndefined();
  });

  it("handles a browser that blocks access to storage itself", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    try {
      expect(readProfileSelection()).toBeUndefined();
    } finally {
      if (previous) Object.defineProperty(globalThis, "localStorage", previous);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it.each([
    { profileId: "profile_0000000000000000" },
    { version: 0, profileId: "profile_0000000000000000" },
    { version: 2, profileId: "profile_0000000000000000" },
    { version: 1, profileId: "profile_0000000000000000", legacy: true },
  ])("rejects non-version-1 or non-exact records", (record) => {
    expect(readProfileSelection(storageWith(JSON.stringify(record)))).toBeUndefined();
  });
});
