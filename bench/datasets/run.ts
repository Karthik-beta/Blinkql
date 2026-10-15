// Generates the benchmark datasets: synthetic manufacturing telemetry from a fixed seed.
//
//   pnpm bench:data                            every dataset (about 1 GB; L takes the longest)
//   pnpm bench:data --size s                   only S, in both shapes and formats
//   pnpm bench:data --size m --shape narrow --format parquet
//
// Same seed, generator version and DuckDB version → byte-identical files. manifest.json records
// each file's SHA-256 so results from different machines can be checked against the same data.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import {
  type Dataset,
  datasets,
  describeFile,
  fileName,
  openEngine,
  rowsBySize,
  writeDataset,
} from "./generate.ts";
import { GENERATOR_VERSION } from "./schema.ts";

const DEFAULT_SEED = 20_261_015;

function usage(problem: string): never {
  console.error(`${problem}

Usage: pnpm bench:data [options]
  --size <s|m|l>             only this size (repeatable): s 100k, m 1M, l 10M rows
  --shape <narrow|wide>      only this shape (repeatable): 8 or 50 columns
  --format <csv|parquet>     only this format (repeatable); L is Parquet only
  --seed <n>                 default ${DEFAULT_SEED}; other seeds aren't comparable with published results
  --out <dir>                default bench/datasets/data`);
  process.exit(2);
}

function oneOf<T extends string>(
  option: string,
  allowed: readonly T[],
  values?: string[],
): readonly T[] {
  if (!values) return allowed;
  return values.map((v) =>
    allowed.includes(v as T) ? (v as T) : usage(`Unknown ${option} "${v}"`),
  );
}

const { values: args } = parseArgs({
  options: {
    size: { type: "string", multiple: true },
    shape: { type: "string", multiple: true },
    format: { type: "string", multiple: true },
    seed: { type: "string", default: String(DEFAULT_SEED) },
    out: { type: "string", default: join("bench", "datasets", "data") },
  },
});

const sizes = oneOf("size", ["s", "m", "l"], args.size);
const shapes = oneOf("shape", ["narrow", "wide"], args.shape);
const formats = oneOf("format", ["csv", "parquet"], args.format);
const seed = Number(args.seed);
if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32)
  usage("--seed must be a whole number below 2^32");

const selected = datasets.filter(
  (d: Dataset) => sizes.includes(d.size) && shapes.includes(d.shape) && formats.includes(d.format),
);
if (selected.length === 0)
  usage("No dataset matches those options (L comes only as narrow Parquet)");

mkdirSync(args.out, { recursive: true });
const { connection, version } = await openEngine();
const files = [];
for (const dataset of selected) {
  const rows = rowsBySize[dataset.size];
  const path = join(args.out, fileName(dataset));
  process.stdout.write(`${relative(process.cwd(), path)} (${rows.toLocaleString("en")} rows) … `);
  const started = performance.now();
  await writeDataset(connection, { ...dataset, rows, seed, path });
  const file = await describeFile(path, dataset, rows);
  files.push(file);
  const mb = (file.bytes / 1e6).toFixed(1);
  process.stdout.write(`${mb} MB in ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
}

const manifest = { generatorVersion: GENERATOR_VERSION, seed, duckdb: version, files };
writeFileSync(join(args.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `Manifest written to ${relative(process.cwd(), join(args.out, "manifest.json"))}\n`,
);
