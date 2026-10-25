import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

const editor = (page: Page) => page.getByRole("textbox", { name: "SQL editor" });
const engineStatus = (page: Page) => page.getByRole("status");

async function openWorkbench(page: Page) {
  await page.goto("/app/");
  await expect(engineStatus(page)).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
}

/** Replaces the editor's contents with `sql` and runs it. */
async function run(page: Page, sql: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(sql);
  await page.keyboard.press("ControlOrMeta+Enter");
}

async function importMachines(page: Page) {
  await page.getByLabel("Import files").setInputFiles({
    name: "machines.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,machine_name\n1,press\n2,lathe\n"),
  });
  await expect(page.getByRole("tree", { name: "Tables" })).toContainText("machines");
}

test.describe("Engine errors", () => {
  test("suggests the table that was meant and marks where the error is", async ({ page }) => {
    await openWorkbench(page);
    await importMachines(page);

    await run(page, "SELECT *\nFROM machnes");

    const alert = page.getByRole("alert");
    await expect(alert).toContainText('There\'s no table called "machnes"');
    await expect(alert).toContainText('Did you mean "machines"?');
    await expect(alert).toContainText("Line 2");
    // The editor underlines the unknown name.
    await expect(page.locator(".cm-error-mark")).toHaveText("machnes");
  });

  test("suggests a column, and goes to the error on request", async ({ page }) => {
    await openWorkbench(page);
    await importMachines(page);

    await run(page, "SELECT machine_nam FROM machines");
    await expect(page.getByRole("alert")).toContainText('Did you mean "machine_name"?');

    await page.getByRole("button", { name: "Go to error" }).click();
    // Focus is back in the editor with the cursor on the error, ready to fix it.
    await page.keyboard.type("x");
    await expect(editor(page)).toHaveText("SELECT xmachine_nam FROM machines");
    // Editing removes the mark, which no longer points at anything.
    await expect(page.locator(".cm-error-mark")).toHaveCount(0);
  });

  test("says when a query is unfinished", async ({ page }) => {
    await openWorkbench(page);

    await run(page, "SELECT * FROM range(3) WHERE");
    await expect(page.getByRole("alert")).toContainText("The query ends too soon");
  });

  test("offers a restart after a crash and brings the tables back", async ({ page }) => {
    // The engine starts twice here, and each start compiles ~35 MB of WebAssembly.
    test.slow();
    // Keep hold of the engine's worker, so the test can make it fail the way a crashed one does.
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          (window as unknown as { engineWorker: Worker }).engineWorker = this;
        }
      };
    });
    await openWorkbench(page);
    await importMachines(page);

    await page.evaluate(() => {
      const { engineWorker } = window as unknown as { engineWorker: Worker };
      engineWorker.dispatchEvent(new ErrorEvent("error", { message: "out of memory" }));
    });
    await expect(engineStatus(page)).toHaveText("Engine stopped: out of memory");

    await run(page, "SELECT count(*) AS n FROM machines");
    await expect(page.getByRole("alert")).toContainText("The engine stopped");

    await page.getByRole("alert").getByRole("button", { name: "Restart engine" }).click();
    await expect(engineStatus(page)).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
    await expect(page.getByRole("tree", { name: "Tables" })).toContainText("machines");

    await run(page, "SELECT count(*) AS n FROM machines");
    await expect(page.getByRole("region", { name: "Query" }).getByText(/ in \d/)).toHaveText(
      /^1 row in /,
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("has no detectable accessibility issues", async ({ page, makeAxeBuilder }) => {
    await openWorkbench(page);

    await run(page, "SELECT * FROM machnes");
    await expect(page.getByRole("alert")).toBeVisible();

    const scan = await makeAxeBuilder().include('[role="alert"]').analyze();
    expect(scan.violations).toEqual([]);
  });
});
