import { marks } from "../src/lib/user-timing.ts";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

test.describe("engine", () => {
  test("starts DuckDB-wasm in a worker and answers SELECT 42", async ({ page }) => {
    const engineFiles: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("duckdb")) engineFiles.push(request.url());
    });

    await page.goto("/app/");

    // The status only says "ready" after the engine has answered SELECT 42 (src/engine/engine.ts).
    await expect(page.getByRole("status")).toHaveText(/^Engine ready · DuckDB v\d+\.\d+\.\d+/, {
      timeout: ENGINE_TIMEOUT,
    });

    // Off the main thread...
    expect(page.workers().some((worker) => worker.url().includes("duckdb-browser"))).toBe(true);
    // ...with every engine file served from our own origin (ADR-008), never a CDN.
    expect(engineFiles.length).toBeGreaterThan(0);
    const origin = new URL(page.url()).origin;
    for (const url of engineFiles) expect(new URL(url).origin).toBe(origin);

    const ready = await page.evaluate(
      (name) => performance.getEntriesByName(name, "mark").length,
      marks.engineReady,
    );
    expect(ready).toBe(1);
  });
});
