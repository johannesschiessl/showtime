import path from "node:path";
import { createHash } from "node:crypto";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  // Relative assets work both when Electron loads index.html from disk and when a web server serves it.
  base: "./",
  publicDir: path.resolve(__dirname, "../../assets"),
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  plugins: lazyPlugins(() => [
    {
      name: "showtime-content-security-policy",
      apply: "build",
      transformIndexHtml: {
        order: "post",
        handler(html) {
          const hashes = Array.from(
            html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
            (match) => `'sha256-${createHash("sha256").update(match[1]!).digest("base64")}'`,
          );
          const policy = `default-src 'self'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'`;
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
  ]),
});
