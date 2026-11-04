import { docsHome, docsPages } from "../src/docs/pages.ts";
import { expect, test } from "./fixtures";

const everyPage = [
  { path: "/docs/", title: "Docs | Blinkql", heading: docsHome.title },
  ...docsPages.map((page) => ({
    path: `/docs/${page.slug}/`,
    title: `${page.title} | Blinkql docs`,
    heading: page.title,
  })),
];

/**
 * Docs tests for one system colour scheme, registered by `docs.<scheme>.spec.ts` (see
 * app-shell.tests.ts for why each scheme has its own file).
 */
export function docsTests(colorScheme: "light" | "dark") {
  test.describe(`docs (${colorScheme})`, () => {
    for (const { path, title, heading } of everyPage) {
      test(`${path} loads with its title and no detectable accessibility violations`, async ({
        page,
        makeAxeBuilder,
      }) => {
        await page.goto(path);

        await expect(page).toHaveTitle(title);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
        expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
      });
    }

    test("follows the system colour scheme, screenshots included", async ({ page }) => {
      await page.goto("/docs/get-started/");

      const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      expect(isDark).toBe(colorScheme === "dark");
      const screenshot = page.getByRole("img", { name: /^The Blinkql workbench/ });
      await expect(screenshot).toHaveCount(1);
      await expect(screenshot).toHaveClass(`screenshot-${colorScheme}`);
      await screenshot.scrollIntoViewIfNeeded();
      await expect
        .poll(() => screenshot.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBe(1440);
    });

    test("marks the current page in the sidebar and navigates from it", async ({ page }) => {
      await page.goto("/docs/get-started/");

      const sidebar = page.getByRole("navigation", { name: "Docs" });
      await expect(sidebar.getByRole("link", { name: "Get started" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(sidebar.locator("[aria-current]")).toHaveCount(1);
      await expect(
        page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" }),
      ).toHaveAttribute("aria-current", "true");

      await sidebar.getByRole("link", { name: "Write queries" }).click();
      await expect(page).toHaveURL("/docs/write-queries/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Write queries");
      await expect(sidebar.getByRole("link", { name: "Write queries" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    test("goes to the next and previous pages, with nothing past either end", async ({ page }) => {
      const [first, second, third] = docsPages;
      const last = docsPages.at(-1);
      if (!first || !second || !third || !last) throw new Error("Too few docs pages");
      await page.goto(`/docs/${second.slug}/`);

      await page.getByRole("link", { name: `Next: ${third.title}` }).click();
      await expect(page).toHaveURL(`/docs/${third.slug}/`);
      await page.getByRole("link", { name: `Previous: ${second.title}` }).click();
      await expect(page).toHaveURL(`/docs/${second.slug}/`);

      await page.goto(`/docs/${first.slug}/`);
      await expect(page.getByRole("link", { name: /^Previous:/ })).toHaveCount(0);
      await page.goto(`/docs/${last.slug}/`);
      await expect(page.getByRole("link", { name: /^Next:/ })).toHaveCount(0);
    });

    test("is linked from the landing page's header", async ({ page }) => {
      await page.goto("/");

      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Docs" })
        .click();
      await expect(page).toHaveURL("/docs/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(docsHome.title);
      await expect(
        page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Docs" }),
      ).toHaveAttribute("aria-current", "page");
      for (const docsPage of docsPages) {
        await expect(
          page.getByRole("main").getByRole("listitem").getByRole("link", { name: docsPage.title }),
        ).toHaveAttribute("href", `/docs/${docsPage.slug}/`);
      }
    });

    test("makes no third-party requests", async ({ page, baseURL }) => {
      const origins = new Set<string>();
      page.on("request", (request) => {
        origins.add(new URL(request.url()).origin);
      });

      for (const { path } of everyPage) {
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
      }

      expect([...origins]).toEqual([new URL(baseURL ?? "").origin]);
    });
  });

  test.describe(`docs without JavaScript (${colorScheme})`, () => {
    test.use({ javaScriptEnabled: false });

    test("reads and navigates from the sidebar", async ({ page }) => {
      await page.goto("/docs/");

      const sidebar = page.getByRole("navigation", { name: "Docs" });
      await expect(sidebar).toBeVisible();
      await sidebar.getByRole("link", { name: "Open files" }).click();
      await expect(page).toHaveURL("/docs/open-files/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open files");
      await page.getByRole("link", { name: /^Next:/ }).click();
      await expect(page).toHaveURL(`/docs/${docsPages[2]?.slug}/`);
    });

    test.describe("on a phone", () => {
      test.use({ viewport: { width: 375, height: 812 } });

      test("folds the page list into a disclosure that opens and navigates", async ({ page }) => {
        await page.goto("/docs/get-started/");

        const pages = page.getByRole("navigation", { name: "Docs" });
        await expect(pages).toBeHidden();
        await page.getByText("Docs pages").click();
        await expect(pages).toBeVisible();
        await pages.getByRole("link", { name: "Keyboard shortcuts" }).click();
        await expect(page).toHaveURL("/docs/keyboard-shortcuts/");
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Keyboard shortcuts");
        // Nothing runs wider than the screen.
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(width).toBeLessThanOrEqual(375);
      });
    });
  });
}
