import { headersFor, responseHeaders } from "../scripts/headers.ts";
import { expect, test } from "./fixtures";

declare global {
  interface Window {
    cspViolations?: string[];
  }
}

test("caches the engine's hashed files as immutable, as vercel.json does", async ({ page }) => {
  const engineFiles = new Map<string, Promise<string | null>>();
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/assets/duckdb-")) {
      engineFiles.set(url.pathname, response.headerValue("cache-control"));
    }
  });

  await page.goto("/app/");
  // The engine's worker and its WebAssembly module.
  await expect.poll(() => engineFiles.size, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);

  for (const [path, cacheControl] of engineFiles) {
    expect(await cacheControl, path).toBe(headersFor(path)["Cache-Control"]);
  }
  expect(headersFor("/assets/duckdb-eh.wasm")["Cache-Control"]).toContain("immutable");
});

// Both pages: the landing page at / and the workbench at /app/.
for (const path of ["/", "/app/"]) {
  test.describe(path, () => {
    test("sends the production response headers from vercel.json", async ({ page }) => {
      const response = await page.goto(path);
      expect(response).not.toBeNull();

      const headers = await response?.allHeaders();
      for (const [key, value] of Object.entries(responseHeaders)) {
        expect(headers?.[key.toLowerCase()], key).toBe(value);
      }
    });

    test("is cross-origin isolated", async ({ page }) => {
      await page.goto(path);

      // Needed for SharedArrayBuffer, a multithreaded engine and precise memory measurement.
      expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
    });

    test("loads without Content Security Policy violations", async ({ page }) => {
      // Registered before any page script runs, so nothing the page loads is missed.
      await page.addInitScript(() => {
        window.cspViolations = [];
        document.addEventListener("securitypolicyviolation", (event) => {
          window.cspViolations?.push(`${event.effectiveDirective}: ${event.blockedURI}`);
        });
      });

      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);

      expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    });
  });
}
