import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;
// Runs for hours unless cancelled.
const LONG_QUERY = "SELECT sum(range) FROM range(1000000000000)";

const editor = (page: Page) => page.getByRole("textbox", { name: "SQL editor" });
const summary = (page: Page) => page.getByRole("region", { name: "Query" }).getByText(/ in \d/);

async function openWorkbench(page: Page) {
  await page.goto("/app/");
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
}

/** Presses Tab until the SQL editor has focus, the way a keyboard-only user gets there. */
async function tabToEditor(page: Page) {
  for (let presses = 0; presses < 10; presses++) {
    await page.keyboard.press("Tab");
    // The editor is in a shadow root (src/features/editor/SqlEditor.tsx), so ask that root.
    const focused = await editor(page).evaluate(
      (element) => (element.getRootNode() as ShadowRoot).activeElement === element,
    );
    if (focused) return;
  }
  throw new Error("Tab never reached the SQL editor");
}

test.describe("SQL editor", () => {
  test("writes and runs a query with only the keyboard", async ({ page }) => {
    await openWorkbench(page);

    await tabToEditor(page);
    await page.keyboard.type("SELECT * FROM range(40)");
    await page.keyboard.press("ControlOrMeta+Enter");

    await expect(summary(page)).toHaveText(/^40 rows in \d+(\.\d)? m?s$/);
    // The shortcut ran the query instead of inserting a line.
    await expect(editor(page)).toHaveText("SELECT * FROM range(40)");
  });

  test("highlights SQL with the theme, despite the strict CSP", async ({ page }) => {
    await page.goto("/app/");

    await editor(page).click();
    await page.keyboard.type("SELECT 1");
    // CodeMirror styles everything at runtime; under a CSP that blocked them, this would be plain.
    const keyword = page.locator(".cm-line span", { hasText: /^SELECT$/ });
    await expect(keyword).toHaveCSS("font-weight", "600");
    await expect(page.locator(".cm-gutters")).toHaveCSS("display", "flex");
  });

  test("runs only the selected part", async ({ page }) => {
    await openWorkbench(page);

    await editor(page).click();
    await page.keyboard.type("SELECT * FROM range(3);");
    await page.keyboard.press("Enter");
    await page.keyboard.type("SELECT * FROM range(5);");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("ControlOrMeta+Enter");

    await expect(summary(page)).toHaveText(/^5 rows in /);
  });

  test("runs from the Run button", async ({ page }) => {
    await openWorkbench(page);

    await editor(page).click();
    await page.keyboard.type("SELECT 42 AS answer");
    await page.getByRole("button", { name: "Run" }).click();

    await expect(summary(page)).toHaveText(/^1 row in /);
  });

  test("says when a query fails", async ({ page }) => {
    await openWorkbench(page);

    await editor(page).click();
    await page.keyboard.type("SELEC 1");
    await page.keyboard.press("ControlOrMeta+Enter");

    await expect(page.getByRole("alert")).toContainText('Syntax error near "SELEC"');
  });

  test("cancels a long query with Escape, and runs the next one", async ({ page }) => {
    await openWorkbench(page);

    await editor(page).click();
    await page.keyboard.type(LONG_QUERY);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByText(/^Cancelled after /)).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeHidden();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("SELECT 42 AS answer");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(summary(page)).toHaveText(/^1 row in /);
  });

  test("cancels a long query when another is run", async ({ page }) => {
    await openWorkbench(page);

    await editor(page).click();
    await page.keyboard.type(LONG_QUERY);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("SELECT 42 AS answer");
    await page.keyboard.press("ControlOrMeta+Enter");

    await expect(summary(page)).toHaveText(/^1 row in /);
    await expect(page.getByRole("grid", { name: "Results" }).getByRole("row").nth(1)).toHaveText(
      "42",
    );
  });

  test("completes an imported table's columns after its alias", async ({ page }) => {
    await openWorkbench(page);
    await page
      .getByLabel("Import files")
      .setInputFiles([
        { name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from("id,amount\n1,2.5\n") },
      ]);
    await expect(page.getByRole("tree", { name: "Tables" }).getByRole("treeitem")).toHaveCount(1);

    await editor(page).click();
    await page.keyboard.type("SELECT * FROM orders AS o");
    // Replace the * with `o.`, so the alias is already there when the completions open.
    await page.keyboard.press("Home");
    for (let presses = 0; presses < "SELECT ".length; presses++) {
      await page.keyboard.press("ArrowRight");
    }
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.type("o.");

    await expect(page.getByRole("listbox").getByRole("option")).toHaveText([
      "amountDOUBLE",
      "idBIGINT",
    ]);
  });

  test("doesn't trap keyboard focus", async ({ page }) => {
    await page.goto("/app/");

    await tabToEditor(page);
    await page.keyboard.type("SELECT 1");
    // Tab isn't an indent key, so it leaves the editor. (Backwards here: the editor is the last stop
    // on the page, and a forward Tab would move focus into the browser's own toolbar.)
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Run" })).toBeFocused();
    await expect(editor(page)).toHaveText("SELECT 1");
  });
});
