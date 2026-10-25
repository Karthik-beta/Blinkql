import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;
// A million rows arrive in about 490 batches (P-05). Playwright's WebKit on Windows takes a timer
// tick, about 15.6 ms, per batch, so they take about 8 s there.
const MILLION_ROWS_TIMEOUT = 30_000;

const results = (page: Page) => page.getByRole("grid", { name: "Results" });

async function runSql(page: Page, sql: string) {
  await page.goto("/app/");
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
  await page.getByRole("textbox", { name: "SQL editor" }).click();
  await page.keyboard.type(sql);
  await page.keyboard.press("ControlOrMeta+Enter");
}

test.describe("Results table", () => {
  test("shows the rows in view, and the rest as it scrolls", async ({ page }) => {
    await runSql(page, "SELECT range AS n, range * 2 AS doubled FROM range(500)");

    await expect(results(page).getByRole("columnheader")).toHaveText(["n", "doubled"]);
    await expect(results(page).getByRole("row").nth(1)).toHaveText("00");
    // The header and 500 rows, of which only those in view (and a few more) are in the page.
    await expect(results(page)).toHaveAttribute("aria-rowcount", "501");
    expect(await results(page).getByRole("row").count()).toBeLessThan(100);

    await results(page).evaluate((grid) => {
      grid.scrollTop = grid.scrollHeight;
    });
    await expect(results(page).getByRole("row").last()).toHaveText("499998");
    await expect(results(page).getByRole("row").last()).toHaveAttribute("aria-rowindex", "501");
  });

  // Fails about one run in three: as the last rows arrive, the refresh and the final update each
  // rebuild the view over every row and the virtualizer recomputes every row's position, often in
  // the same frame, which then takes 55-80 ms (#119).
  test.fixme("streams in a million rows without blocking the main thread", async ({
    page,
    longWorkDuringQueries,
  }) => {
    await runSql(page, "SELECT range AS n FROM range(1000000)");
    await expect(results(page)).toHaveAttribute("aria-rowcount", "1000001", {
      timeout: MILLION_ROWS_TIMEOUT,
    });
    expect(await longWorkDuringQueries()).toEqual([]);
  });

  test("scrolls through a million rows to the last", async ({ page }) => {
    // Taller than browsers can lay out (Firefox stops near 17.9 million px), so it's scaled.
    await runSql(page, "SELECT range AS n FROM range(1000000)");
    await expect(results(page)).toHaveAttribute("aria-rowcount", "1000001", {
      timeout: MILLION_ROWS_TIMEOUT,
    });

    for (const fraction of [0.25, 0.5, 1]) {
      await results(page).evaluate((grid, fraction) => {
        grid.scrollTop = (grid.scrollHeight - grid.clientHeight) * fraction;
      }, fraction);
      // The first row whole below the header is that far through the result.
      const firstInView = () =>
        results(page).evaluate((grid) => {
          const [header, ...rows] = grid.querySelectorAll('[role="row"]');
          const below = header?.getBoundingClientRect().bottom ?? 0;
          const row = rows.find((row) => row.getBoundingClientRect().top >= below - 1);
          return Number(row?.textContent) / 1_000_000;
        });
      await expect.poll(firstInView).toBeCloseTo(fraction, 2);
    }
    await expect(results(page).getByRole("row").last()).toHaveText("999999");
  });

  test("moves the active cell with the keyboard", async ({ page }) => {
    await runSql(page, "SELECT range AS n, 'row ' || range AS label FROM range(1000000)");
    await expect(results(page)).toHaveAttribute("aria-rowcount", "1000001", {
      timeout: MILLION_ROWS_TIMEOUT,
    });
    const active = () =>
      results(page).evaluate((grid) => {
        const id = grid.getAttribute("aria-activedescendant");
        return id ? document.getElementById(id)?.textContent : null;
      });

    await results(page).focus();
    await expect.poll(active).toBe("0");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await expect.poll(active).toBe("row 1");
    await page.keyboard.press("ControlOrMeta+End");
    await expect.poll(active).toBe("row 999999");
    await page.keyboard.press("ArrowUp");
    await expect.poll(active).toBe("row 999998");
    await page.keyboard.press("ControlOrMeta+Home");
    await expect.poll(active).toBe("0");
  });

  test("shows DuckDB's types the way DuckDB writes them", async ({ page }) => {
    await runSql(
      page,
      "SELECT 1 AS x, 2 AS x, NULL AS nothing, 123.45::DECIMAL(10, 2) AS price, " +
        "DATE '2026-10-16' AS day, TIMESTAMP '2026-10-16 05:47:17' AS at, " +
        "[1, 2] AS list, {'a': 'b'} AS struct, 9007199254740993::BIGINT AS big",
    );

    const cells = results(page).getByRole("row").nth(1).getByRole("gridcell");
    await expect(cells).toHaveText([
      "1",
      "2",
      "NULL",
      "123.45",
      "2026-10-16",
      "2026-10-16 05:47:17",
      "[1,2]",
      '{"a":"b"}',
      "9007199254740993",
    ]);
  });

  test("formats values inside lists, structs and maps by their type", async ({ page }) => {
    await runSql(
      page,
      "SELECT [DATE '2026-10-16', NULL] AS days, [1.5::DECIMAL(3, 1)] AS prices, " +
        "{'at': TIMESTAMP '2026-10-16 05:47:17', 'raw': 'A\\x00'::BLOB} AS struct, " +
        "MAP {'k': 2026} AS map",
    );

    const cells = results(page).getByRole("row").nth(1).getByRole("gridcell");
    await expect(cells).toHaveText([
      '["2026-10-16",null]',
      "[1.5]",
      '{"at":"2026-10-16 05:47:17","raw":"A\\\\x00"}',
      '{"k":2026}',
    ]);
  });

  test("shows arrays, enums and oddly named struct fields", async ({ page }) => {
    // DuckDB sends an ARRAY as a fixed-size list and an ENUM dictionary-encoded.
    await runSql(
      page,
      "SELECT [1, 2]::INTEGER[2] AS pair, 'b'::ENUM('a', 'b') AS letter, " +
        "{'toString': 7, '__proto__': 8} AS struct",
    );

    const cells = results(page).getByRole("row").nth(1).getByRole("gridcell");
    await expect(cells).toHaveText(["[1,2]", "b", '{"toString":7,"__proto__":8}']);
  });

  test("resizes columns by mouse and keyboard, and copies a block of cells", async ({ page }) => {
    // Records what's copied, so the test needn't read the system clipboard.
    await page.addInitScript(() => {
      const copied: string[] = [];
      Object.defineProperty(window, "copied", { value: copied });
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (text: string) => void copied.push(text) },
      });
    });
    await runSql(page, "SELECT range AS n, 'row ' || range AS label FROM range(100)");
    const header = results(page).getByRole("columnheader", { name: "label" });
    const width = async () => (await header.boundingBox())?.width ?? 0;
    // Resized widths are whole pixels; fitted ones needn't be.
    const widened = async (by: number) => Math.abs((await width()) - before - by) < 1;
    await expect(results(page).getByRole("row").nth(1)).toHaveText("0row 0");

    const before = await width();
    const edge = await header.getByTitle("Drag to resize, double-click to fit").boundingBox();
    if (!edge) throw new Error("The header has no edge to drag");
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2 + 60, edge.y + edge.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => widened(60)).toBe(true);
    // The rows follow the header.
    const cell = results(page).getByRole("gridcell", { name: "row 0", exact: true });
    expect((await cell.boundingBox())?.width).toBeCloseTo(await width(), 0);

    await header.click();
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(() => widened(76)).toBe(true);

    await results(page).getByRole("gridcell", { name: "0", exact: true }).click();
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("ControlOrMeta+c");
    const copied = () => page.evaluate(() => (window as unknown as { copied: string[] }).copied);
    await expect.poll(copied).toEqual(["0\trow 0\n1\trow 1"]);
  });

  test("has no detectable accessibility issues", async ({ page, makeAxeBuilder }) => {
    await runSql(page, "SELECT range AS n, NULL AS nothing FROM range(20)");
    await expect(results(page).getByRole("row").nth(1)).toHaveText("0NULL");
    // With a cell active, as when it's used from the keyboard.
    await results(page).focus();

    const scan = await makeAxeBuilder().include('[aria-label="Results"]').analyze();
    expect(scan.violations).toEqual([]);
  });
});
