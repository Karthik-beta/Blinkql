import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

const editor = (page: Page) => page.getByRole("textbox", { name: "SQL editor" });
const summary = (page: Page) => page.getByRole("region", { name: "Query" }).getByText(/ in \d/);
const history = (page: Page) => page.getByRole("list", { name: "Query history" });
const saved = (page: Page) => page.getByRole("list", { name: "Saved queries" });

async function openWorkbench(page: Page) {
  await page.goto("/app/");
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
}

async function run(page: Page, sql: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(sql);
  await page.keyboard.press("ControlOrMeta+Enter");
}

test.describe("query history and saved queries", () => {
  test("keeps past runs across a reload and runs one again", async ({ page }) => {
    await openWorkbench(page);
    await run(page, "SELECT * FROM range(3)");
    await expect(summary(page)).toHaveText(/^3 rows in /);
    await run(page, "SELECT * FROM range(5)");
    await expect(summary(page)).toHaveText(/^5 rows in /);

    await openWorkbench(page);
    await expect(history(page).getByRole("listitem")).toHaveCount(2);
    const older = history(page).getByRole("listitem").filter({ hasText: "range(3)" });
    await expect(older).toContainText("3 rows");

    await older.getByRole("button", { name: "Run again" }).click();
    await expect(summary(page)).toHaveText(/^3 rows in /);
    await expect(editor(page)).toHaveText("SELECT * FROM range(3)");
    await expect(history(page).getByRole("listitem")).toHaveCount(3);
  });

  test("keeps a saved query across a reload, renames and deletes it", async ({ page }) => {
    await openWorkbench(page);
    await editor(page).click();
    await page.keyboard.type("SELECT 42 AS answer");
    await page.getByRole("button", { name: "Saved" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Answer");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(saved(page).getByRole("listitem")).toHaveCount(1);

    await openWorkbench(page);
    await page.getByRole("button", { name: "Saved" }).click();
    await expect(saved(page).getByRole("listitem")).toContainText("Answer");
    await page.getByRole("button", { name: "Run Answer" }).click();
    await expect(summary(page)).toHaveText(/^1 row in /);

    await page.getByRole("button", { name: "Rename Answer" }).click();
    await page.getByRole("textbox", { name: "New name for Answer" }).fill("The answer");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Rename The answer" })).toBeFocused();

    await page.reload();
    await page.getByRole("button", { name: "Saved" }).click();
    await page.getByRole("button", { name: "Delete The answer" }).click();
    await expect(page.getByText("No saved queries yet.")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Saved" }).click();
    await expect(page.getByText("No saved queries yet.")).toBeVisible();
  });
});
