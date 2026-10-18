import { describe, expect, it } from "vite-plus/test";
import { contentSecurityPolicy } from "./vite.config.ts";

const connectSources = (policy: string) =>
  policy.split("; ").find((directive) => directive.startsWith("connect-src "));

describe("renderer content security policy", () => {
  it("limits sockets to the same origin and the desktop loopback endpoint", () => {
    expect(connectSources(contentSecurityPolicy("<head></head>"))).toBe(
      "connect-src 'self' ws://localhost:8585/rpc/desktop/",
    );
  });

  it("adds only the configured RPC origin", () => {
    expect(
      connectSources(contentSecurityPolicy("<head></head>", "wss://rpc.example:9443/rpc")),
    ).toBe("connect-src 'self' ws://localhost:8585/rpc/desktop/ wss://rpc.example:9443");
  });

  it("rejects configured RPC URLs with a non-WebSocket scheme", () => {
    expect(() => contentSecurityPolicy("", "https://rpc.example/rpc")).toThrow(
      "must use ws: or wss:",
    );
  });

  it("explains how to configure IPv6 servers without an unsupported CSP source", () => {
    expect(() => contentSecurityPolicy("", "ws://[::1]:8585/rpc")).toThrow(
      "must use a hostname instead of an IPv6 literal",
    );
  });
});
