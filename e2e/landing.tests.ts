import { expect, test } from "./fixtures";

/**
 * Landing page tests for one system colour scheme, registered by `landing.<scheme>.spec.ts`
 * (see app-shell.tests.ts for why each scheme has its own file).
 */
export function landingTests(colorScheme: "light" | "dark") {
  test.describe(`landing page (${colorScheme})`, () => {
    test("says what Blinkql is and that it isn't ready yet", async ({ page }) => {
      await page.goto("/");

      await expect(page).toHaveTitle("Blinkql: query big files without uploading them");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Query big files without uploading them",
      );
      await expect(page.getByText("isn't ready to use yet").first()).toBeVisible();
      await expect(page.getByRole("listitem").filter({ hasText: "In progress" })).toContainText(
        "M0",
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

    test("runs the replay once, then nothing moves", async ({ page }) => {
      await page.goto("/");

      await expect(page.locator("body")).toHaveAttribute("data-phase", "done", { timeout: 5000 });
      await expect(page.getByText("40 rows in 212 ms")).toBeVisible();
      await expect(page.getByRole("table")).toContainText("PRS-03");
      // The done flash lasts 400 ms; after it, no animation is left running.
      await expect
        .poll(() =>
          page.evaluate(
            () => document.getAnimations().filter((a) => a.playState === "running").length,
          ),
        )
        .toBe(0);
    });

    test("replays from the keyboard and announces the result", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("body")).toHaveAttribute("data-phase", "done", { timeout: 5000 });

      const replay = page.getByRole("button", { name: "Replay" });
      await replay.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("body")).toHaveAttribute("data-phase", "loading");
      await expect(page.getByRole("status")).toHaveText("Query finished, 40 rows in 212 ms", {
        timeout: 5000,
      });
    });

    test("makes no third-party requests", async ({ page, baseURL }) => {
      const origins = new Set<string>();
      page.on("request", (request) => {
        origins.add(new URL(request.url()).origin);
      });

      await page.goto("/");
      await expect(page.locator("body")).toHaveAttribute("data-phase", "done", { timeout: 5000 });
      await page.evaluate(() => document.fonts.ready);

      expect([...origins]).toEqual([new URL(baseURL ?? "").origin]);
    });

    test("has no detectable accessibility violations", async ({ page, makeAxeBuilder }) => {
      await page.goto("/");
      await expect(page.locator("body")).toHaveAttribute("data-phase", "done", { timeout: 5000 });

      const results = await makeAxeBuilder().analyze();
      expect(results.violations).toEqual([]);
    });
  });

  test.describe(`landing page with reduced motion (${colorScheme})`, () => {
    test.use({ reducedMotion: "reduce" });

    test("shows the final state straight away", async ({ page }) => {
      await page.goto("/");

      await expect(page.locator("body")).toHaveAttribute("data-phase", "done");
      await expect(page.getByText("40 rows in 212 ms")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.getAnimations().filter((a) => a.playState === "running").length,
        ),
      ).toBe(0);
    });
  });

  test.describe(`landing page without JavaScript (${colorScheme})`, () => {
    test.use({ javaScriptEnabled: false });

    test("still shows the results and every section", async ({ page }) => {
      await page.goto("/");

      await expect(page.getByText("40 rows in 212 ms")).toBeVisible();
      await expect(page.getByRole("table")).toContainText("PRS-03");
      await expect(page.getByRole("heading", { name: "Help build it" })).toBeVisible();
    });
  });
}
