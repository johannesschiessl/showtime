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

  it("keeps the local value when both sides change the same field", () => {
    expect(mergeRemoteDraft({ name: "Local" }, { name: "Old" }, { name: "Remote" })).toEqual({
      name: "Local",
    });
  });

  it("keeps locally edited optional fields omitted by the remote", () => {
    type Draft = { name: string; notes?: string };
    expect(
      mergeRemoteDraft<Draft>(
        { name: "Old", notes: "Local notes" },
        { name: "Old", notes: "" },
        { name: "Remote" },
      ),
    ).toEqual({ name: "Remote", notes: "Local notes" });
  });

  it("accepts removal of untouched optional fields", () => {
    type Draft = { name: string; notes?: string };
    const previous: Draft = { name: "Old", notes: "" };
    expect(mergeRemoteDraft<Draft>(previous, previous, { name: "Remote" })).toEqual({
      name: "Remote",
    });
  });
});
