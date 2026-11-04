// The service worker that opens the workbench without a network. Imported by vite.config.ts, so it
// runs in Node: no DOM here. Only the workbench registers it (UpdatePrompt.tsx); the landing page
// stays a plain page.
import type { Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export function offlineWorkbench(): Plugin[] {
  return VitePWA({
    // A new version waits until the user chooses to reload, so a running query isn't cut off.
    registerType: "prompt",
    injectRegister: false,
    // public/site.webmanifest, from brand/web, is the manifest.
    manifest: false,
    workbox: {
      // The workbench, the engine and the self-hosted extensions. Only the eh engine build is
      // precached, since browsers with WebAssembly exceptions run it. The mvp build is cached when
      // first used (runtimeCaching below), so those browsers work offline from their second visit.
      globPatterns: [
        "app/index.html",
        "assets/**/*",
        "duckdb-extensions/**/*",
        "theme-init.js",
        "favicon*",
        "*.png",
        "site.webmanifest",
      ],
      globIgnores: [
        // The landing page's own chunks (src/landing/main.ts) and link-preview image.
        "assets/landing-*",
        "assets/sample-run-*",
        "og-image.png",
        // The mvp engine build, cached when first used instead.
        "assets/duckdb-mvp-*",
        "assets/duckdb-browser-mvp.worker-*",
        "duckdb-extensions/*/wasm_mvp/**",
      ],
      // The eh engine build is a WebAssembly file of over 30 MB.
      maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
      runtimeCaching: [
        {
          // Content-hashed or versioned, so a cached copy never goes stale.
          urlPattern: ({ url }) =>
            /^\/assets\/duckdb-(browser-)?mvp[.-]/.test(url.pathname) ||
            /^\/duckdb-extensions\/[^/]+\/wasm_mvp\//.test(url.pathname),
          handler: "CacheFirst",
          options: { cacheName: "engine-mvp" },
        },
      ],
      navigateFallback: "/app/index.html",
      navigateFallbackAllowlist: [/^\/app\//],
    },
  });
}
