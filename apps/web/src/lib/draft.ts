/** Accept remote changes only for fields that still match their previous server value. */
export const mergeRemoteDraft = <Draft extends object>(
  draft: Draft,
  previous: Draft,
  incoming: Draft,
): Draft => {
  const merged = { ...incoming };
  for (const key in { ...draft, ...incoming }) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(previous[key])) merged[key] = draft[key];
  }
  return merged;
};
