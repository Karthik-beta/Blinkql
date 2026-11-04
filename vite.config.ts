import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vitest/config";
import { headersOnEveryResponse } from "./scripts/headers.ts";
import { offlineWorkbench } from "./src/app/vite-plugin.ts";
import { docsInputs, docsSection } from "./src/docs/vite-plugin.ts";
import { duckdbExtensions, duckdbWorkers } from "./src/engine/vite-plugin.ts";
import { landingPage } from "./src/landing/vite-plugin.ts";
import { siteFonts } from "./src/site/vite-plugin.ts";

// `BLINKQL_REACT_PROFILING=1 pnpm bench` builds with React's profiling build, so <Profiler>s report
// renders in production too (bench/README.md). It's slower, so its results aren't compared with
// those of a normal build.
const reactProfiling = process.env.BLINKQL_REACT_PROFILING === "1";

// `BLINKQL_ANALYZE=1 pnpm build` also writes a treemap of what's in each chunk to bench/bundle/.
const analyze = process.env.BLINKQL_ANALYZE === "1";

// https://vite.dev/config/ and https://vitest.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    landingPage(),
    docsSection(),
    siteFonts(),
    duckdbExtensions(),
    duckdbWorkers(),
    headersOnEveryResponse(),
    offlineWorkbench(),
    analyze && visualizer({ filename: "bench/bundle/stats.html", gzipSize: true }),
  ],
  // The landing page at /, the workbench at /app/, and the docs at /docs/ (one page per entry in
  // src/docs/pages.ts). Only the workbench loads React.
  build: {
    rolldownOptions: {
      input: {
        landing: fileURLToPath(new URL("./index.html", import.meta.url)),
        app: fileURLToPath(new URL("./app/index.html", import.meta.url)),
        ...docsInputs(new URL("./", import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      ...(reactProfiling && { "react-dom/client": "react-dom/profiling" }),
    },
  },
  // Both servers send the same isolation and security headers as production (vercel.json),
  // through headersOnEveryResponse(); the CSP is preview-only.
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "bench/**/*.test.ts", "scripts/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
