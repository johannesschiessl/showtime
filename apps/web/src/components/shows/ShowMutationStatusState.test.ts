import { Cause } from "effect";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { getShowMutationStatusState } from "./ShowMutationStatusState";

describe("getShowMutationStatusState", () => {
  it("shows completed failures while unrelated mutations are waiting", () => {
    const failure = AsyncResult.failure(Cause.fail("delete failed"));
    const state = getShowMutationStatusState([
      AsyncResult.initial(true),
      AsyncResult.initial(),
      failure,
    ]);

    expect(state.visibleFailure).toBe(failure);
    expect(state.waiting).toBe(true);
    expect(state.success).toBe(false);
  });

  it("suppresses a mutation failure while that mutation is still waiting", () => {
    const state = getShowMutationStatusState([
      AsyncResult.failure(Cause.fail("create failed"), { waiting: true }),
    ]);

    expect(state.visibleFailure).toBeUndefined();
    expect(state.waiting).toBe(true);
    expect(state.success).toBe(false);
  });
});
