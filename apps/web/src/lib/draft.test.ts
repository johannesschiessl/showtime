import { describe, expect, it } from "vite-plus/test";
import { mergeRemoteDraft } from "./draft";

describe("remote draft reconciliation", () => {
  it("keeps unsaved text while accepting changes to untouched fields", () => {
    const previous = { name: "Old", notes: "", assignments: [{ id: "mix1" }] };
    const draft = { ...previous, notes: "Typing" };
    expect(
      mergeRemoteDraft(draft, previous, {
        ...previous,
        name: "Remote",
        assignments: [{ id: "mix2" }],
      }),
    ).toEqual({ name: "Remote", notes: "Typing", assignments: [{ id: "mix2" }] });
    expect(mergeRemoteDraft(draft, previous, structuredClone(previous))).toEqual(draft);
  });
});
