import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
};

let parquet: Buffer;

test.beforeAll(async () => {
  // A Parquet file of a few MB, written by native DuckDB, so reading just its schema is clearly
  // less than reading all of it.
  const dir = await mkdtemp(join(tmpdir(), "blinkql-e2e-"));
  const path = join(dir, "orders.parquet").replaceAll("\\", "/");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run(
    `COPY (SELECT range AS id, md5(range::VARCHAR) AS code, random() AS amount FROM range(250000))
     TO '${path}' (FORMAT parquet)`,
  );
  connection.closeSync();
  instance.closeSync();
  parquet = await readFile(path);
  await rm(dir, { recursive: true });
});

type FileServer = { url: string; bytesSent: () => number; close: () => Promise<void> };

/** Serves `file` as `name` on a free port, answering range requests, with or without CORS. */
async function serve(file: Buffer, name: string, { cors }: { cors: boolean }): Promise<FileServer> {
  let sent = 0;
  const server: Server = createServer((request, response) => {
    if (cors)
      for (const [key, value] of Object.entries(corsHeaders)) response.setHeader(key, value);
    if (request.method === "OPTIONS") return response.writeHead(204).end();

    response.setHeader("Accept-Ranges", "bytes");
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), file.length - 1) : file.length - 1;
    const body = file.subarray(start, end + 1);
    response.setHeader("Content-Length", body.length);
    if (range) response.setHeader("Content-Range", `bytes ${start}-${end}/${file.length}`);
    response.writeHead(range ? 206 : 200);
    if (request.method === "HEAD") return response.end();
    sent += body.length;
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/${name}`,
    bytesSent: () => sent,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function openWorkbench(page: Page) {
  await page.goto("/app/");
  await expect(page.getByRole("status")).toHaveText(/^Engine ready/, { timeout: ENGINE_TIMEOUT });
}

async function addFromUrl(page: Page, url: string) {
  await page.getByRole("button", { name: "Add from URL" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a file from a URL" });
  await dialog.getByRole("textbox", { name: "URL" }).fill(url);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

test.describe("remote files", () => {
  test("reads a remote Parquet file's schema without downloading all of it", async ({ page }) => {
    const server = await serve(parquet, "orders.parquet", { cors: true });
    try {
      await openWorkbench(page);
      await addFromUrl(page, server.url);

      await expect(
        page
          .getByRole("tree", { name: "Tables" })
          .getByRole("treeitem", { name: "orders Parquet · 3 columns" }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      test.info().annotations.push({
        type: "bytes served",
        description: `${server.bytesSent()} of ${parquet.length}`,
      });
      expect(server.bytesSent()).toBeLessThan(parquet.length / 2);
    } finally {
      await server.close();
    }
  });

  test("reads a remote Excel workbook's first sheet", async ({ page }) => {
    const workbook = await readFile(fileURLToPath(new URL("data/machines.xlsx", import.meta.url)));
    const server = await serve(workbook, "machines.xlsx", { cors: true });
    try {
      await openWorkbench(page);
      await addFromUrl(page, server.url);

      await expect(
        page
          .getByRole("tree", { name: "Tables" })
          .getByRole("treeitem", { name: "machines Excel · 6 columns" }),
      ).toBeVisible({ timeout: EXTENSION_TIMEOUT });
      await expect(page.getByRole("alert")).toHaveCount(0);

      await page.getByRole("button", { name: "Show rows of machines" }).click();
      await expect(page.getByRole("grid", { name: "Results" })).toHaveAttribute(
        "aria-rowcount",
        "6",
      );
    } finally {
      await server.close();
    }
  });

  test("explains a server that doesn't allow cross-origin reads", async ({ page }) => {
    const server = await serve(parquet, "orders.parquet", { cors: false });
    try {
      await openWorkbench(page);
      await addFromUrl(page, server.url);

      await expect(page.getByRole("alert")).toContainText(
        `Couldn't import ${server.url}: The server doesn't let other websites read this file`,
      );
      await expect(page.getByRole("tree", { name: "Tables" })).toHaveCount(0);
    } finally {
      await server.close();
    }
  });
});
