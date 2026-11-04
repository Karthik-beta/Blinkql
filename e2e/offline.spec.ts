import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;

const csv = {
  name: "downtime.csv",
  mimeType: "text/csv",
  buffer: Buffer.from("machine_id,minutes\nM-01,12\nM-02,30\nM-01,8\n"),
};

test("opens the workbench and queries a local file with the network off", async ({
  page,
  context,
}) => {
  // Installing the service worker downloads the engine (~40 MB) as well as the page loading it.
  test.setTimeout(120_000);
  await page.goto("/app/");
  // The service worker precaches the workbench, the engine and the extensions on install.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  await page.reload();

  const engineStatus = page.getByRole("status").filter({ hasText: /^Engine/ });
  await expect(engineStatus).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
  await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();
  // Served from the service worker's cache, the page keeps its isolation headers.
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await page.getByLabel("Import files").setInputFiles([csv]);
  await expect(page.getByRole("tree", { name: "Tables" }).getByRole("treeitem")).toHaveCount(1);

  const editor = page.getByRole("textbox", { name: "SQL editor" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("SELECT sum(minutes) AS total FROM downtime");
  await page.keyboard.press("ControlOrMeta+Enter");

  const results = page.getByRole("grid", { name: "Results" });
  await expect(results.getByRole("row").nth(1)).toContainText("50");
});
