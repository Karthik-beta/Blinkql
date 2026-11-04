// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { datasets, type Format, fileName, openEngine, sha256, writeDataset } from "./generate.ts";
import { columns, datasetQuery, type Shape } from "./schema.ts";

const SEED = 20_261_015;
const ROWS = 1_000;

let connection: DuckDBConnection;
let dir: string;

beforeAll(async () => {
  ({ connection } = await openEngine());
  dir = await mkdtemp(join(tmpdir(), "blinkql-datasets-"));
});

afterAll(async () => {
  connection.closeSync();
  await rm(dir, { recursive: true, force: true });
});

async function generate(shape: Shape, format: Format, name: string): Promise<string> {
  const path = join(dir, `${name}.${format}`);
  await writeDataset(connection, { shape, format, rows: ROWS, seed: SEED, path });
  return path;
}

describe("writeDataset", () => {
  it.each([
    ["narrow", "csv"],
    ["narrow", "parquet"],
    ["wide", "csv"],
    ["wide", "parquet"],
  ] as const)("writes byte-identical %s %s files on every run", async (shape, format) => {
    const first = await generate(shape, format, `${shape}-a`);
    const second = await generate(shape, format, `${shape}-b`);

    expect(await sha256(second)).toBe(await sha256(first));
  });

  // Pinned on purpose. These fail when a change alters the generated data (bump
  // GENERATOR_VERSION) or a DuckDB upgrade changes the bytes it writes (note it in the PR).
  // CI runs on Linux, so they also prove output is identical across platforms.
  it.each([
    ["narrow", "csv", "0992f5de5232544f57af13b6e84322c0f6ef7b7e8e58a616d36aae6c011bbfa6"],
    ["narrow", "parquet", "87676841c41c8fb5cfd1740c7f5f1bf4dbc6d107111e280263ca6ad694ec2ff9"],
    ["wide", "csv", "5d3f642b2ba45533506cfaa89e4062fe7b5105f439e5c97292864b1fd33183cb"],
    ["wide", "parquet", "8992c2eb875cdccf4cc4b92e169f24be2286da190775edb650916fd64a864536"],
  ] as const)("still writes the known %s %s file", async (shape, format, expected) => {
    const path = await generate(shape, format, `${shape}-pinned`);

    expect(await sha256(path)).toBe(expected);
  });

  it("writes a header and the expected first row", async () => {
    const path = await generate("narrow", "csv", "narrow-rows");
    const [header, firstRow] = (await readFile(path, "utf8")).split("\n");

    expect(header).toBe(
      columns("narrow")
        .map((c) => c.name)
        .join(","),
    );
    expect(firstRow).toBe("2026-01-01 00:00:00,M001,RUN,49,19,18,61.14,2.51");
  });

  it("writes the requested rows and 8 or 50 columns", async () => {
    for (const shape of ["narrow", "wide"] as const) {
      const path = (await generate(shape, "parquet", `${shape}-shape`)).replaceAll("\\", "/");
      const reader = await connection.runAndReadAll(
        `SELECT count(*), (SELECT count(*) FROM (DESCRIBE SELECT * FROM '${path}')) FROM '${path}'`,
      );

      expect(reader.getRows()[0]).toEqual([BigInt(ROWS), BigInt(shape === "narrow" ? 8 : 50)]);
    }
  });
});

describe("datasets", () => {
  it("covers S and M in both shapes and formats, and L as narrow Parquet only", () => {
    expect(datasets.map(fileName)).toEqual([
      "telemetry-s-narrow.csv",
      "telemetry-s-narrow.parquet",
      "telemetry-s-wide.csv",
      "telemetry-s-wide.parquet",
      "telemetry-m-narrow.csv",
      "telemetry-m-narrow.parquet",
      "telemetry-m-wide.csv",
      "telemetry-m-wide.parquet",
      "telemetry-l-narrow.parquet",
    ]);
  });
});

describe("datasetQuery", () => {
  it("rejects row counts and seeds outside the supported range", () => {
    expect(() => datasetQuery("narrow", 0, SEED)).toThrow(RangeError);
    expect(() => datasetQuery("narrow", 2 ** 26 + 1, SEED)).toThrow(RangeError);
    expect(() => datasetQuery("narrow", ROWS, -1)).toThrow(RangeError);
    expect(() => datasetQuery("narrow", ROWS, 2 ** 32)).toThrow(RangeError);
  });
});
