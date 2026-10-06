import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";
import { MicrophoneNumber, type MicrophoneNumber as MicrophoneNumberType } from "./microphone.js";

const decode = Schema.decodeUnknownSync(MicrophoneNumber);

describe("MicrophoneNumber", () => {
  it("accepts non-blank labels", () => {
    expect(decode("1")).toBe("1");
    expect(decode("A1")).toBe("A1");
  });

  it.each(["", "   "])("rejects invalid value %j", (value) => {
    expect(() => decode(value)).toThrow();
  });

  it("is nominally distinct from a plain string", () => {
    expectTypeOf<string>().not.toMatchTypeOf<MicrophoneNumberType>();
    expectTypeOf<MicrophoneNumberType>().toMatchTypeOf<string>();
  });
});
