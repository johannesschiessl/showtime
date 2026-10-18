import path from "node:path";
import { createHash } from "node:crypto";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { showtimeLocalPort } from "../../packages/shared/src/local-endpoint.ts";
import { defineConfig, lazyPlugins, loadEnv } from "vite-plus";

export const contentSecurityPolicy = (html: string, configuredRpcUrl?: string) => {
  const connectSources = ["'self'", `ws://localhost:${showtimeLocalPort}/rpc/desktop/`];
  if (configuredRpcUrl) {
    const url = new URL(configuredRpcUrl);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Error("VITE_SHOWTIME_RPC_WEBSOCKET_URL must use ws: or wss:.");
    }
    if (url.hostname.startsWith("[")) {
      throw new Error(
        "VITE_SHOWTIME_RPC_WEBSOCKET_URL must use a hostname instead of an IPv6 literal for the renderer's content security policy. Use localhost for a loopback server.",
      );
    }
    connectSources.push(url.origin);
  }
  const hashes = Array.from(
    html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
    (match) => `'sha256-${createHash("sha256").update(match[1]!).digest("base64")}'`,
  );
  // 'self' permits the browser's same-origin socket. Electron uses the fixed
  // loopback desktop endpoint; a configured RPC server adds only its origin.
  return `default-src 'self'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ${connectSources.join(" ")}; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'`;
};

export default defineConfig({
  // Relative assets work both when Electron loads index.html from disk and when a web server serves it.
  base: "./",
  publicDir: path.resolve(__dirname, "../../assets"),
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  plugins: lazyPlugins(() => {
    let configuredRpcUrl: string | undefined;
    return [
      {
        name: "showtime-content-security-policy",
        apply: "build",
        configResolved(config) {
          configuredRpcUrl = loadEnv(
            config.mode,
            config.envDir,
            "VITE_",
          ).VITE_SHOWTIME_RPC_WEBSOCKET_URL;
        },
        transformIndexHtml: {
          order: "post",
          handler(html) {
            const policy = contentSecurityPolicy(html, configuredRpcUrl);
            return html.replace(
              "<head>",
              `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`,
            );
          },
        },
      },
      tailwindcss(),
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
    ];
  }),
});
