import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The page shows the released version as major.minor, from package.json at build time.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const shortVersion = version.split(".").slice(0, 2).join(".");

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

/** The hero's results grid, captioned with how many of the query's rows it shows. */
const sampleResults = (page: Page) =>
  page.getByRole("table", { name: /^The first \d+ of \d+ rows$/ });

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
    test("says what Blinkql is, with one filled button to the workbench", async ({ page }) => {
      await page.goto("/");

      await expect(page).toHaveTitle("Blinkql: query big files without uploading them");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Query big files without uploading them",
      );
      const hero = page.locator(".hero");
      const filled = page.locator(".button-primary");
      await expect(filled).toHaveCount(1);
      await expect(filled).toHaveText("Open the workbench");
      await expect(filled).toHaveAttribute("href", "/app/");
      await expect(hero.getByRole("link", { name: "Read the docs" })).toHaveAttribute(
        "href",
        "/docs/",
      );
      await expect(hero).toContainText(`Free and open source. Version ${shortVersion}.`);
    });

    test("has every section, each linking to its docs page", async ({ page }) => {
      await page.goto("/");

      await expect(page.getByRole("heading", { level: 2 })).toHaveText([
        "From file to answer",
        "Ready-made analyses",
        "Your files stay on your computer",
        "Specifications",
        "Built in the open",
      ]);
      const steps = page.getByRole("list").filter({ has: page.getByRole("heading", { level: 3 }) });
      await expect(steps.first().getByRole("heading", { level: 3 })).toHaveText([
        "Open a file",
        "Ask in SQL",
        "See the answer",
        "Share what you found",
      ]);
      for (const [name, href] of [
        ["Open files", "/docs/open-files/"],
        ["Write queries", "/docs/write-queries/"],
        ["Explore results", "/docs/explore-results/"],
        ["Share and export", "/docs/share-and-export/"],
        ["Analysis templates", "/docs/templates/"],
        ["Privacy and storage", "/docs/privacy-and-storage/"],
        ["Browser support and limits", "/docs/browser-support/"],
      ] as const) {
        await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
      }
    });

    test("lists the templates and the specifications", async ({ page }) => {
      await page.goto("/");

      const templates = page.locator("section", { has: page.locator("#templates-title") });
      await expect(templates.getByRole("listitem")).toHaveCount(10);
      await expect(templates).toContainText("OEE by machine");
      await expect(templates).toContainText("Data-quality checks for an import file");

      const specs = page.getByRole("table", { name: "Blinkql's specifications" });
      await expect(specs.getByRole("rowheader")).toHaveText([
        "File formats",
        "Where files come from",
        "Comfortable file size",
        "Browsers",
        "SQL",
        "Data sent to a server",
        "Account",
        "Offline use",
        "Accessibility",
        "Price",
        "Licence",
        "Version",
      ]);
      for (const name of [
        "Data sent to a server None",
        "Account None",
        `Version ${shortVersion}`,
      ]) {
        await expect(specs.getByRole("row", { name, exact: true })).toBeVisible();
      }
    });

    test("points contributors to the guide, good first issues and the discussions", async ({
      page,
    }) => {
      await page.goto("/");

      await expect(page.getByRole("link", { name: "Read the contributing guide" })).toHaveAttribute(
        "href",
        /wiki\/Contributing$/,
      );
      await expect(page.getByRole("link", { name: "Browse good first issues" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Join the discussions" })).toBeVisible();
      await expect(page.getByRole("link", { name: "roadmap" })).toHaveAttribute(
        "href",
        /wiki\/Roadmap-and-Milestones$/,
      );
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
      await expect(sampleResults(page)).toContainText("PRS-03");
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
      await expect(sampleResults(page)).toContainText("2026-10-");
      await expect(sampleResults(page)).not.toContainText("NULL");
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
      await expect(sampleResults(page)).toContainText("PRS-03");
      await expect(page.getByRole("heading", { name: "Built in the open" })).toBeVisible();
      // Running the query needs JavaScript, so its button doesn't show.
      await expect(page.getByRole("button", { name: "Run it live" })).toBeHidden();
    });
  });
}
