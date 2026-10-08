import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { asyncResultValueOrElse, isFailureWithoutValue } from "./AsyncResult.js";

describe("isFailureWithoutValue", () => {
  it("keeps a failed refresh available when it retained an empty value", () => {
    const previousSuccess = AsyncResult.success<ReadonlyArray<string>, string>([]);
    const result = AsyncResult.fail<string, ReadonlyArray<string>>("offline", {
      previousSuccess: Option.some(previousSuccess),
    });

    expect(isFailureWithoutValue(result)).toBe(false);
  });

  it("identifies a failure that has never loaded a value", () => {
    expect(isFailureWithoutValue(AsyncResult.fail("offline"))).toBe(true);
  });

  it("does not identify success or initial states as unavailable failures", () => {
    expect(isFailureWithoutValue(AsyncResult.success([]))).toBe(false);
    expect(isFailureWithoutValue(AsyncResult.initial())).toBe(false);
  });
});

describe("asyncResultValueOrElse", () => {
  it("uses the previous success while a refresh is failed", () => {
    const previousSuccess = AsyncResult.success<ReadonlyArray<string>, string>(["available"]);
    const result = AsyncResult.fail<string, ReadonlyArray<string>>("offline", {
      previousSuccess: Option.some(previousSuccess),
    });

    expect(asyncResultValueOrElse(result, () => [])).toEqual(["available"]);
  });

  it("uses the fallback before any value is available", () => {
    expect(
      asyncResultValueOrElse(AsyncResult.initial<ReadonlyArray<string>, string>(), () => []),
    ).toEqual([]);
  });
});
