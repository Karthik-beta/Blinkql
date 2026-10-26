// Fails if a benchmark result breaks a ceiling in bench/smoke-thresholds.json. `pnpm bench:smoke`
// runs it on every pull request after a short benchmark run.
//
//   node bench/check-thresholds.ts <result.json | directory>   a directory: its newest result file
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ScenarioResult } from "./harness/measure.ts";
import { breaches, type Thresholds } from "./harness/thresholds.ts";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node bench/check-thresholds.ts <result.json | directory>");
  process.exit(2);
}

// Result file names start with their timestamp, so the last one by name is the newest.
let file = target;
if (statSync(target).isDirectory()) {
  const newest = readdirSync(target)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .at(-1);
  if (!newest) {
    console.error(`No result files in ${target}`);
    process.exit(2);
  }
  file = join(target, newest);
}
const { results } = JSON.parse(readFileSync(file, "utf8")) as { results: ScenarioResult[] };
const thresholds = JSON.parse(
  readFileSync(new URL("smoke-thresholds.json", import.meta.url), "utf8"),
) as Thresholds;

const found = breaches(results, thresholds);
if (found.length > 0) {
  console.error(`${file} breaks ${found.length} benchmark threshold(s):`);
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}
process.stdout.write(`${file} is within every benchmark threshold\n`);
