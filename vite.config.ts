import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { devServerHeaders, responseHeaders } from "./scripts/headers.ts";

// https://vite.dev/config/ and https://vitest.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
