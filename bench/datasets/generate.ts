// Writes datasets with DuckDB (the native build of the engine Blinkql runs in the browser).
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { columns, datasetQuery, macros, type Shape } from "./schema.ts";

export type Size = "s" | "m" | "l";
export type Format = "csv" | "parquet";

export const rowsBySize: Readonly<Record<Size, number>> = {
  s: 100_000,
  m: 1_000_000,
  l: 10_000_000,
};

export type Dataset = { size: Size; shape: Shape; format: Format };

/** Every dataset `pnpm bench:data` produces. L is Parquet only: as CSV it would be gigabytes. */
export const datasets: readonly Dataset[] = (["s", "m", "l"] as const).flatMap((size) =>
  (["narrow", "wide"] as const).flatMap((shape) =>
    (["csv", "parquet"] as const)
      .filter((format) => size !== "l" || (shape === "narrow" && format === "parquet"))
      .map((format) => ({ size, shape, format })),
  ),
);

export function fileName({ size, shape, format }: Dataset): string {
  return `telemetry-${size}-${shape}.${format}`;
}

// Fixed writer options: defaults could change between DuckDB releases and alter the bytes.
const copyOptions: Record<Format, string> = {
  csv: "FORMAT csv, HEADER true, DELIMITER ','",
  parquet: "FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 122880",
};

export async function openEngine(): Promise<{ connection: DuckDBConnection; version: string }> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  for (const macro of macros) await connection.run(macro);
  const reader = await connection.runAndReadAll("SELECT version()");
  return { connection, version: String(reader.getRows()[0]?.[0]) };
}

/** Writes one dataset to `path`, via a temporary file so an interrupted run leaves no partial file. */
export async function writeDataset(
  connection: DuckDBConnection,
  options: { shape: Shape; rows: number; format: Format; seed: number; path: string },
): Promise<void> {
  const partial = `${options.path}.partial`;
  const query = datasetQuery(options.shape, options.rows, options.seed);
  const target = partial.replaceAll("'", "''");
  try {
    await connection.run(`COPY (${query}) TO '${target}' (${copyOptions[options.format]})`);
    await rename(partial, options.path);
  } finally {
    await rm(partial, { force: true });
  }
}

export async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function describeFile(path: string, dataset: Dataset, rows: number) {
  return {
    file: fileName(dataset),
    ...dataset,
    rows,
    columns: columns(dataset.shape).length,
    bytes: (await stat(path)).size,
    sha256: await sha256(path),
  };
}
