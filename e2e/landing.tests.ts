import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

const runningAnimations = (page: Page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);

/** Runs the hero's sample query live and waits for the engine's answer. */
async function runLive(page: Page) {
  test.slow();
  await page.getByRole("button", { name: "Run it live" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-phase", "done", {
    timeout: ENGINE_TIMEOUT,
  });
}

/**
 * Landing page tests for one system colour scheme, registered by `landing.<scheme>.spec.ts`
 * (see app-shell.tests.ts for why each scheme has its own file).
 */
export function landingTests(colorScheme: "light" | "dark") {
  test.describe(`landing page (${colorScheme})`, () => {
    test("says what Blinkql is and that it's an early version", async ({ page }) => {
      await page.goto("/");

      await expect(page).toHaveTitle("Blinkql: query big files without uploading them");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Query big files without uploading them",
      );
      await expect(page.getByText("An early version works today").first()).toBeVisible();
      await expect(page.getByRole("listitem").filter({ hasText: "In progress" })).toContainText(
        "M5",
      );
      await expect(page.getByRole("link", { name: "Try the early workbench" })).toHaveAttribute(
        "href",
        "/app/",
      );
      await expect(page.getByRole("link", { name: "Read the roadmap" })).toHaveAttribute(
        "href",
        /wiki\/Roadmap-and-Milestones$/,
      );
    });

    test("invites contributors, with one filled button", async ({ page }) => {
      await page.goto("/");

      const contribute = page.locator("#contribute");
      await expect(
        contribute.getByRole("link", { name: "Read the contributing guide" }),
      ).toHaveAttribute("href", /wiki\/Contributing$/);
      await expect(
        contribute.getByRole("link", { name: "Browse good first issues" }),
      ).toBeVisible();
      await expect(contribute.getByRole("link", { name: "Join the discussions" })).toBeVisible();
      await expect(page.locator(".button-primary")).toHaveCount(1);
    });

    test("follows the system colour scheme", async ({ page }) => {
      await page.goto("/");

      const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      expect(isDark).toBe(colorScheme === "dark");
    });

    test("loads with the sample result and nothing moving", async ({ page }) => {
      await page.goto("/");

      await expect(page.locator("body")).toHaveAttribute("data-phase", "idle");
      await expect(page.getByText("56 rows in 212 ms")).toBeVisible();
      await expect(page.getByRole("table")).toContainText("PRS-03");
      expect(await runningAnimations(page)).toBe(0);
    });

    test("runs the sample query on the real engine, then nothing moves", async ({ page }) => {
      test.slow();
      await page.goto("/");

      await page.getByRole("button", { name: "Run it live" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("body")).toHaveAttribute("data-phase", "loading");
      await expect(page.locator("body")).toHaveAttribute("data-phase", "done", {
        timeout: ENGINE_TIMEOUT,
      });

      await expect(page.getByRole("status")).toHaveText(/^Query finished, 56 rows in \d+ ms$/);
      const readout = page.locator(".readout");
      await expect(readout).toContainText(/56 rows in\s+\d+ ms/);
      await expect(readout).not.toContainText("212 ms");
      // The live rows replace the static ones, whose WLD-02 row has a NULL quality.
      await expect(page.getByRole("table")).toContainText("2026-10-");
      await expect(page.getByRole("table")).not.toContainText("NULL");
      // The lamp flashes once when the query returns; after the 400 ms flash, nothing is left running.
      await expect.poll(() => runningAnimations(page)).toBe(0);
    });

    test("makes no third-party requests, even running the engine", async ({ page, baseURL }) => {
      const origins = new Set<string>();
      page.on("request", (request) => {
        origins.add(new URL(request.url()).origin);
      });

      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await runLive(page);

      expect([...origins]).toEqual([new URL(baseURL ?? "").origin]);
    });

    test("has no detectable accessibility violations", async ({ page, makeAxeBuilder }) => {
      await page.goto("/");
      expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

      await runLive(page);
      expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
    });
  });

  test.describe(`landing page with reduced motion (${colorScheme})`, () => {
    test.use({ reducedMotion: "reduce" });

    test("runs the sample query without animating the lamp", async ({ page }) => {
      await page.goto("/");
      expect(await runningAnimations(page)).toBe(0);

      await runLive(page);
      expect(await runningAnimations(page)).toBe(0);
    });
  });

  test.describe(`landing page without JavaScript (${colorScheme})`, () => {
    test.use({ javaScriptEnabled: false });

    test("still shows the results and every section", async ({ page }) => {
      await page.goto("/");

      await expect(page.getByText("56 rows in 212 ms")).toBeVisible();
      await expect(page.getByRole("table")).toContainText("PRS-03");
      await expect(page.getByRole("heading", { name: "Help build it" })).toBeVisible();
      // Running the query needs JavaScript, so its button doesn't show.
      await expect(page.getByRole("button", { name: "Run it live" })).toBeHidden();
    });
  });
}
