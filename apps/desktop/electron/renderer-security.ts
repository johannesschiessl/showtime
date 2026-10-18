export const isTrustedRendererUrl = (candidate: string, rendererUrl: string) => {
  try {
    const actual = new URL(candidate);
    const expected = new URL(rendererUrl);
    actual.hash = "";
    expected.hash = "";
    return actual.href === expected.href;
  } catch {
    return false;
  }
};
