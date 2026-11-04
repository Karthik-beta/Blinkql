import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

const editor = (page: Page) => page.getByRole("textbox", { name: "SQL editor" });
const tableList = (page: Page) => page.getByRole("tree", { name: "Tables" });

async function openWorkbench(page: Page) {
  await page.goto("/app/");
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
}

async function run(page: Page, sql: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(sql);
  await page.keyboard.press("ControlOrMeta+Enter");
}

test.describe("tables made in SQL", () => {
  test("lists tables and views made in SQL until they're dropped", async ({ page }) => {
    await openWorkbench(page);

    await run(
      page,
      "CREATE TABLE made AS SELECT range AS id FROM range(3); " +
        "CREATE VIEW doubled AS SELECT id * 2 AS twice, id FROM made",
    );

    const tables = tableList(page).getByRole("treeitem");
    await expect(tables).toHaveText([/^doubled/, /^made/]);
    const made = tableList(page).getByRole("treeitem", {
      name: "made SQL table · 1 column · gone after a reload",
    });
    const doubled = tableList(page).getByRole("treeitem", {
      name: "doubled SQL view · 2 columns · gone after a reload",
    });
    await expect(made).toBeVisible();
    await expect(doubled).toBeVisible();

    // Its rows are a click away, like an imported file's.
    await made.getByRole("button", { name: "Show rows of made" }).click();
    await expect(
      page.getByRole("region", { name: "Query" }).getByText(/^3 rows in \d/),
    ).toBeVisible();

    await run(page, "DROP VIEW doubled");
    await expect(tables).toHaveText([/^made/]);

    await made.getByRole("button", { name: "Drop made" }).click();
    await expect(tableList(page)).toBeHidden();
    await expect(page.getByText(/^No tables yet/)).toBeVisible();
  });
});
