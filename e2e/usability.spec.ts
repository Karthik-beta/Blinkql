// The usability session script (issue #35), walked through the way a participant who doesn't
// write SQL would: only clicks and keys on visible controls, nothing typed into the editor.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openEngine, rowsBySize, writeDataset } from "../bench/datasets/generate.ts";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;
// The session's exit criterion: tasks 1–3 in under a minute. The script runs 1–4.
const SESSION_LIMIT_MS = 60_000;

// The session's file: `pnpm bench:data --size s --shape narrow --format csv`, default seed.
const SEED = 20_261_015;

let dir: string;
let path: string;

test.beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "blinkql-e2e-"));
  path = join(dir, "machine-telemetry.csv").replaceAll("\\", "/");
  const { connection } = await openEngine();
  await writeDataset(connection, {
    shape: "narrow",
    rows: rowsBySize.s,
    format: "csv",
    seed: SEED,
    path,
  });
  connection.closeSync();
});

test.afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("profiles a file and builds a chart in under a minute without SQL", async ({ page }) => {
  test.setTimeout(ENGINE_TIMEOUT + 2 * SESSION_LIMIT_MS);
  await page.goto("/app/");
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
  const startedAt = Date.now();
  // Each task's automation time, recorded in the report for the session notes.
  let taskStartedAt = startedAt;
  const finished = (task: string) => {
    const now = Date.now();
    test.info().annotations.push({ type: task, description: `${now - taskStartedAt} ms` });
    taskStartedAt = now;
  };

  // 1. Open the file.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import files" }).click();
  await (await chooser).setFiles(path);
  const table = page.getByRole("treeitem", { name: "machine_telemetry CSV · 8 columns" });
  await expect(table).toBeVisible();
  finished("1. open the file");

  // 2. Which columns have missing values, and how many machines: the tree's statistics.
  // The chevron beside the table's name expands it.
  await table.locator("button").first().click();
  const column = (name: string) =>
    table
      .getByRole("group")
      .getByRole("treeitem")
      .filter({
        has: page.getByText(name, { exact: true }),
      });
  // About 0.5% of the sensor readings are missing; status never is.
  await expect(column("temperature_c")).toContainText(/DOUBLE0\.\d+% null/);
  await expect(column("vibration_mm_s")).toContainText(/DOUBLE0\.\d+% null/);
  await expect(column("status")).toContainText(/VARCHAR0% null/);
  await expect(column("machine_id")).toContainText("null · 40 distinct");
  finished("2. missing values and machines");

  // 3. Minutes in each status, as a chart: show the rows, then chart them.
  await page.getByRole("button", { name: "Show rows of machine_telemetry" }).click();
  await expect(page.getByRole("grid", { name: "Results" })).toHaveAttribute(
    "aria-rowcount",
    String(rowsBySize.s + 1),
  );
  await page.getByRole("button", { name: "Chart", exact: true }).click();
  await page.getByLabel("X", { exact: true }).selectOption("status");
  await expect(page.getByRole("img", { name: "Bar chart of count(*) by status" })).toBeVisible();
  finished("3. chart of minutes per status");

  // 4. Save the chart as an image.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG" }).click();
  const png = await readFile(await (await download).path());
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  finished("4. save the chart as an image");

  expect(Date.now() - startedAt).toBeLessThan(SESSION_LIMIT_MS);
});
