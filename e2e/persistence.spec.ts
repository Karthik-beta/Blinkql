import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

const csv = {
  name: "Machine Events.csv",
  mimeType: "text/csv",
  buffer: Buffer.from("machine_id;event;minutes\nM-01;run;42\nM-02;stop;7\n"),
};

const editor = (page: Page) => page.getByRole("textbox", { name: "SQL editor" });
const summary = (page: Page) => page.getByRole("region", { name: "Query" }).getByText(/ in \d/);
const tables = (page: Page) => page.getByRole("tree", { name: "Tables" }).getByRole("treeitem");

async function openWorkbench(page: Page) {
  await page.goto("/app/");
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
}

/** The table names in the stored datasets' manifest. */
function storedNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const datasets = await root.getDirectoryHandle("datasets");
      const manifest = await (await datasets.getFileHandle("manifest.json")).getFile();
      return (JSON.parse(await manifest.text()) as { name: string }[]).map(({ name }) => name);
    } catch {
      return [];
    }
  });
}

test.describe("kept datasets", () => {
  test("keeps an imported file across a reload until it's forgotten", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "Playwright's WebKit can't open the Origin Private File System (getFileHandle() fails with " +
        "UnknownError); the next test covers what users of such browsers get.",
    );
    // It starts the engine three times.
    test.slow();
    await openWorkbench(page);
    await page.getByLabel("Import files").setInputFiles([csv]);
    await expect(tables(page)).toHaveText(["machine_eventsCSV · 3 columns · 49 B"]);
    await expect.poll(() => storedNames(page)).toEqual(["machine_events"]);

    await openWorkbench(page);
    await expect(tables(page)).toHaveText(["machine_eventsCSV · 3 columns · 49 B"]);
    await editor(page).click();
    await page.keyboard.type("SELECT sum(minutes) AS total FROM machine_events");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(summary(page)).toHaveText(/^1 row in /);
    await expect(page.getByRole("grid", { name: "Results" })).toContainText("49");

    await page.getByRole("button", { name: "Forget machine_events" }).click();
    await expect(tables(page)).toHaveCount(0);
    await expect.poll(() => storedNames(page)).toEqual([]);

    await openWorkbench(page);
    await expect(page.getByText(/^No tables yet/)).toBeVisible();
    await expect(page.getByText(/can't keep these files/)).toHaveCount(0);
  });

  test("still imports, for this visit, where files can't be kept", async ({ page }) => {
    // It starts the engine twice.
    test.slow();
    // As in a private window, or a browser without the Origin Private File System.
    await page.addInitScript(() => {
      Object.defineProperty(StorageManager.prototype, "getDirectory", {
        value: () => Promise.reject(new DOMException("Not allowed", "SecurityError")),
      });
    });
    await openWorkbench(page);
    await page.getByLabel("Import files").setInputFiles([csv]);

    await expect(tables(page)).toHaveText(["machine_eventsCSV · 3 columns · 49 B"]);
    await expect(
      page.getByText(
        "This browser can't keep these files, so their tables will be gone after a reload.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await editor(page).click();
    await page.keyboard.type("SELECT * FROM machine_events");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(summary(page)).toHaveText(/^2 rows in /);

    await openWorkbench(page);
    await expect(page.getByText(/^No tables yet/)).toBeVisible();
  });
});
