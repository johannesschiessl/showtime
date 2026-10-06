import { describe, expect, it } from "vite-plus/test";
import { nextMicrophoneNumber } from "./microphone.js";
import { nextMixNumber } from "./mix.js";
import { nextNumberedResourceNumber } from "./numbered-resource.js";

describe("nextNumberedResourceNumber", () => {
  it("increments canonical positive-integer labels", () => {
    expect(nextNumberedResourceNumber(["1", "3", "2"])).toBe("4");
  });

  it("ignores custom labels that Number would interpret as integers", () => {
    const labels = ["2e3", "0x10", " 2 ", "02", "+2", "0", "9007199254740992"];

    expect(nextNumberedResourceNumber(labels)).toBe("1");
    expect(nextMicrophoneNumber(labels)).toBe("1");
    expect(nextMixNumber(labels)).toBe("1");
  });
});
