import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

const editor = (page: Page) => page.getByRole("textbox", { name: "SQL editor" });
const palette = (page: Page) => page.getByRole("dialog", { name: "Commands" });
const search = (page: Page) => page.getByRole("combobox", { name: "Search commands" });

async function openWorkbench(page: Page) {
  await page.goto("/app/");
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
}

/** Presses the shortcut the palette's button advertises: Ctrl+K, or ⌘K on Apple devices. */
async function pressPaletteShortcut(page: Page) {
  const keys = await page
    .getByRole("button", { name: "Commands" })
    .getAttribute("aria-keyshortcuts");
  await page.keyboard.press(keys ?? "");
}

async function runCommand(page: Page, label: string) {
  await pressPaletteShortcut(page);
  await expect(search(page)).toBeFocused();
  await page.keyboard.type(label);
  await page.keyboard.press("Enter");
  await expect(palette(page)).toBeHidden();
}

test.describe("Command palette", () => {
  test("opens with its shortcut, from the editor too, and gives focus back", async ({
    page,
    makeAxeBuilder,
  }) => {
    await openWorkbench(page);

    await pressPaletteShortcut(page);
    await expect(search(page)).toBeFocused();
    const scan = await makeAxeBuilder().include('[role="dialog"]').analyze();
    expect(scan.violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();

    await editor(page).click();
    await page.keyboard.type("SELECT 1");
    await pressPaletteShortcut(page);
    await expect(search(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toBeHidden();
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveText("SELECT 1");
  });

  test("loads sample data, runs a query on it and charts the result", async ({ page }) => {
    await openWorkbench(page);

    await runCommand(page, "load sample data: plants");
    await expect(page.getByRole("treeitem", { name: /^plants / })).toBeVisible();
    await expect(page.getByRole("dialog")).toBeHidden();

    await editor(page).click();
    await page.keyboard.type("SELECT plant_code, length(plant_name) AS name_length FROM plants");
    await runCommand(page, "run query");
    await expect(page.getByRole("grid", { name: "Results" })).toHaveAttribute("aria-rowcount", "5");

    await runCommand(page, "show chart");
    await expect(page.getByRole("button", { name: "Chart" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("region", { name: "Chart" })).toBeVisible();
  });

  test("opens the keyboard shortcuts", async ({ page, makeAxeBuilder }) => {
    await openWorkbench(page);

    await runCommand(page, "keyboard shortcuts");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog.getByRole("row", { name: /^Open the command palette/ })).toBeVisible();
    const scan = await makeAxeBuilder().include('[role="dialog"]').analyze();
    expect(scan.violations).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
