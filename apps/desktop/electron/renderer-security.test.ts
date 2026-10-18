import { describe, expect, it } from "vite-plus/test";
import { isTrustedRendererUrl } from "./renderer-security";

describe("owner renderer URLs", () => {
  it.each(["file:///C:/Showtime/index.html", "http://localhost:5173/"])(
    "allows hash routing only within %s",
    (url) => {
      expect(isTrustedRendererUrl(`${url}#/shows/one`, url)).toBe(true);
      expect(isTrustedRendererUrl(`${url}?redirect=other`, url)).toBe(false);
      expect(isTrustedRendererUrl("https://example.com/", url)).toBe(false);
      expect(isTrustedRendererUrl("file:///C:/other.html", url)).toBe(false);
    },
  );
});
