import path from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./apps/web/src") } },
  test: {
    environment: "node",
    exclude: [".repos/**", "node_modules/**", "**/node_modules/**"],
  },
  fmt: {
    endOfLine: "lf",
    ignorePatterns: ["apps/web/src/routeTree.gen.ts", ".plans/**", ".repos/**"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["apps/web/src/routeTree.gen.ts", ".plans/**", ".repos/**"],
  },
  run: {
    cache: true,
  },
});
