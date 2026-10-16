import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { devServerHeaders, responseHeaders } from "./scripts/headers.ts";
import { duckdbExtensions } from "./src/engine/vite-plugin.ts";
import { landingPage } from "./src/landing/vite-plugin.ts";

// https://vite.dev/config/ and https://vitest.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), landingPage(), duckdbExtensions()],
  // Two pages: the landing page at / and the workbench at /app/. The landing page loads no React.
  build: {
    rolldownOptions: {
      input: {
        landing: fileURLToPath(new URL("./index.html", import.meta.url)),
        app: fileURLToPath(new URL("./app/index.html", import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Same isolation and security headers as production (vercel.json); the CSP is preview-only.
  server: {
    port: 5173,
    strictPort: true,
    headers: devServerHeaders,
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: responseHeaders,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "bench/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
