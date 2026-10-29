import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Loading the engine means fetching and compiling ~35 MB of WebAssembly.
const ENGINE_TIMEOUT = 60_000;
// Excel support is an extension the engine fetches and compiles when a workbook is first opened.
const EXTENSION_TIMEOUT = 30_000;

type Fixture = { name: string; mimeType: string; buffer: Buffer };

const csv: Fixture = {
  name: "Machine Events.csv",
  mimeType: "text/csv",
  buffer: Buffer.from("machine_id;event;minutes\nM-01;run;42\nM-02;stop;7\n"),
};
const json: Fixture = {
  name: "shifts.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify([{ shift: "A", start: "06:00" }, { shift: "B" }])),
};
const jsonLines: Fixture = {
  name: "alarms.ndjson",
  mimeType: "application/x-ndjson",
  buffer: Buffer.from(
    '{"code":101,"severity":"high","line":1}\n{"code":7,"severity":"low","line":2}\n',
  ),
};
let parquet: Fixture;
// Five machines with a header row and text, number, date and true/false columns, some empty.
// Committed rather than written in beforeAll, since native DuckDB writes .xlsx only with its excel
// extension, downloaded on first use: `COPY (…) TO 'machines.xlsx' (FORMAT xlsx, HEADER true)`.
const excelWorkbook = fileURLToPath(new URL("data/machines.xlsx", import.meta.url));

test.beforeAll(async () => {
  // A real Parquet file, written by native DuckDB.
  const dir = await mkdtemp(join(tmpdir(), "blinkql-e2e-"));
  const path = join(dir, "orders.parquet").replaceAll("\\", "/");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run(
    `COPY (SELECT range AS id, range * 1.5 AS amount FROM range(100)) TO '${path}' (FORMAT parquet)`,
  );
  connection.closeSync();
  instance.closeSync();
  parquet = {
    name: "orders.parquet",
    mimeType: "application/octet-stream",
    buffer: await readFile(path),
  };
  await rm(dir, { recursive: true });
});

async function openWorkbench(page: Page) {
  await page.goto("/app/");
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
}

function tableList(page: Page) {
  return page.getByRole("tree", { name: "Tables" });
}

test.describe("file import", () => {
  test("imports CSV, Parquet, JSON and JSON lines from the file picker", async ({ page }) => {
    await openWorkbench(page);

    await page.getByLabel("Import files").setInputFiles([csv, parquet, json, jsonLines]);

    const tables = tableList(page).getByRole("treeitem");
    await expect(tables).toHaveCount(4);
    // The sniffer found the semicolon delimiter and the header row.
    await expect(tables.nth(0)).toHaveText("machine_events CSV · 3 columns · 49 B");
    await expect(tables.nth(1)).toHaveText(/^orders Parquet · 2 columns · [\d.]+ K?B$/);
    await expect(tables.nth(2)).toHaveText("shifts JSON · 2 columns · 45 B");
    await expect(tables.nth(3)).toHaveText("alarms JSON lines · 3 columns · 77 B");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("imports a file dropped anywhere on the page", async ({ page }) => {
    await openWorkbench(page);

    const dataTransfer = await page.evaluateHandle(
      ({ name, text }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([text], name, { type: "text/csv" }));
        return transfer;
      },
      { name: csv.name, text: csv.buffer.toString() },
    );
    await page.dispatchEvent("main", "dragenter", { dataTransfer });
    await expect(page.getByText("Drop files to import them as tables")).toBeVisible();
    await page.dispatchEvent("main", "drop", { dataTransfer });

    await expect(page.getByText("Drop files to import them as tables")).toBeHidden();
    await expect(tableList(page).getByRole("treeitem")).toHaveText([
      "machine_events CSV · 3 columns · 49 B",
    ]);
  });

  test("gives a second file with the same name its own table", async ({ page }) => {
    await openWorkbench(page);

    await page.getByLabel("Import files").setInputFiles([csv]);
    await expect(tableList(page).getByRole("treeitem")).toHaveCount(1);
    await page.getByLabel("Import files").setInputFiles([csv]);

    await expect(
      tableList(page)
        .getByRole("treeitem")
        .getByText(/^machine_events/),
    ).toHaveText(["machine_events", "machine_events_2"]);
  });

  test("browses a table's columns and inserts names with the keyboard", async ({ page }) => {
    await openWorkbench(page);
    await page.getByLabel("Import files").setInputFiles([csv]);

    const table = tableList(page).getByRole("treeitem", { name: "machine_events CSV · 3 columns" });
    await table.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowRight");

    const columns = table.getByRole("group").getByRole("treeitem");
    await expect(columns).toHaveText([
      "machine_idVARCHAR0% null · 2 distinct",
      "eventVARCHAR0% null · 2 distinct",
      "minutesBIGINT0% null · 2 distinct",
    ]);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("End");
    await expect(columns.nth(2)).toBeFocused();
    await page.keyboard.press("Enter");

    // "minutes" is a DuckDB keyword, so it's quoted.
    await expect(page.getByRole("textbox", { name: "SQL editor" })).toHaveText(
      'machine_events"minutes"',
    );
  });

  test("explains which files couldn't be imported", async ({ page }) => {
    await openWorkbench(page);

    await page.getByLabel("Import files").setInputFiles([
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
      { name: "broken.parquet", mimeType: "application/octet-stream", buffer: Buffer.from("nope") },
    ]);

    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      "Couldn't import notes.txt: Not a CSV, TSV, Excel (.xlsx), Parquet, JSON or JSON Lines file",
    );
    await expect(alert).toContainText(
      "Couldn't import broken.parquet: File 'broken.parquet' too small to be a Parquet file",
    );
    await expect(alert).not.toContainText("exception_type");
    await expect(alert).not.toContainText("exception_message");
    await expect(tableList(page)).toHaveCount(0);
  });

  test("imports an Excel workbook's first sheet, loading Excel support only then", async ({
    page,
  }) => {
    const excelRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/excel.duckdb_extension")) excelRequests.push(request.url());
    });
    await openWorkbench(page);
    expect(excelRequests).toEqual([]);

    await page.getByLabel("Import files").setInputFiles(excelWorkbook);

    await expect(tableList(page).getByRole("treeitem")).toHaveText(
      [/^machines Excel · 6 columns · [\d.]+ KB$/],
      { timeout: EXTENSION_TIMEOUT },
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(excelRequests).toHaveLength(1);

    const editor = page.getByRole("textbox", { name: "SQL editor" });
    await editor.click();
    await page.keyboard.type(
      "SELECT kind, hours, installed, active FROM machines WHERE line = 2 ORDER BY machine_id",
    );
    await page.keyboard.press("ControlOrMeta+Enter");

    const rows = page.getByRole("grid", { name: "Results" }).getByRole("row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toHaveText(/Mill.*7\.25.*2025-01-15.*true/);
    await expect(rows.nth(2)).toHaveText(/Grinder.*30.*2022-06-01.*true/);
  });

  test("explains which workbooks it can't read", async ({ page }) => {
    await openWorkbench(page);

    await page.getByLabel("Import files").setInputFiles([
      { name: "old.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("old") },
      // What a password-protected workbook starts with: an encrypted container, not a zip.
      {
        name: "locked.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from("d0cf11e0a1b11ae1000000000000000000000000", "hex"),
      },
    ]);

    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      "Couldn't import old.xls: Excel 97–2003 workbooks (.xls) can't be read. Save it as .xlsx in Excel first.",
    );
    await expect(alert).toContainText(
      "Couldn't import locked.xlsx: The workbook can't be read. It may be password-protected",
      { timeout: EXTENSION_TIMEOUT },
    );
    await expect(tableList(page)).toHaveCount(0);
  });

  test("profiles a table without any SQL", async ({ page }) => {
    await openWorkbench(page);
    await page.getByLabel("Import files").setInputFiles([parquet]);

    await page.getByRole("button", { name: "Profile orders" }).click();

    const grid = page.getByRole("grid", { name: "Results" });
    await expect(grid).toHaveAttribute("aria-rowcount", "3");
    for (const header of [
      "column_name",
      "column_type",
      "min",
      "max",
      "approx_unique",
      "q25",
      "null_percentage",
    ]) {
      await expect(grid.getByRole("columnheader", { name: header, exact: true })).toBeVisible();
    }
    await expect(grid.getByRole("row").nth(1)).toContainText("id");
  });
});
