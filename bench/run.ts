// Runs the benchmark scenarios in a Playwright browser and writes a JSON result file.
//
//   pnpm bench                                    build, then every scenario in its default modes
//   pnpm bench --scenario time-to-app-shell --mode warm
//   pnpm bench --browser firefox --iterations 20
//   pnpm bench --url https://blinkql.vercel.app   benchmark a deployment instead of a local preview
//
// Method (see the Performance & Benchmarks wiki page): 3 warm-up and 10 measured iterations per
// scenario and mode, median and p95 reported, raw samples kept.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { chromium, firefox, webkit } from "@playwright/test";
import { preview } from "vite";
import { describeCommit, describeEnvironment } from "./harness/environment.ts";
import { measure, type ScenarioResult } from "./harness/measure.ts";
import type { Mode } from "./harness/types.ts";
import { scenarios } from "./scenarios/index.ts";

const browserTypes = { chromium, firefox, webkit };
const modes: readonly Mode[] = ["cold", "warm"];

function usage(problem: string): never {
  console.error(`${problem}

Usage: pnpm bench [options]
  --scenario <name>    run only this scenario (repeatable): ${scenarios.map((s) => s.name).join(", ")}
  --mode <cold|warm>   run only this mode (repeatable); default: each scenario's modes
  --browser <name>     chromium (default), firefox or webkit
  --warmup <n>         warm-up iterations, discarded (default 3)
  --iterations <n>     measured iterations (default 10)
  --url <url>          benchmark this URL instead of a local \`vite preview\` of dist/
  --out <dir>          where to write the result file (default bench/results)`);
  process.exit(2);
}

function count(value: string, option: string, min: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) usage(`--${option} must be a whole number ≥ ${min}`);
  return n;
}

const { values: args } = parseArgs({
  options: {
    scenario: { type: "string", multiple: true },
    mode: { type: "string", multiple: true },
    browser: { type: "string", default: "chromium" },
    warmup: { type: "string", default: "3" },
    iterations: { type: "string", default: "10" },
    url: { type: "string" },
    out: { type: "string", default: join("bench", "results") },
  },
});

const selected = args.scenario
  ? args.scenario.map(
      (name) => scenarios.find((s) => s.name === name) ?? usage(`Unknown scenario "${name}"`),
    )
  : scenarios;
const requestedModes = args.mode?.map((m) =>
  modes.includes(m as Mode) ? (m as Mode) : usage(`Unknown mode "${m}"`),
);
const browserName = args.browser as keyof typeof browserTypes;
const browserType = browserTypes[browserName] ?? usage(`Unknown browser "${args.browser}"`);
const iterations = {
  warmup: count(args.warmup, "warmup", 0),
  measured: count(args.iterations, "iterations", 1),
};

// The production build, served with the same headers as Vercel (vite.config.ts), on a free port.
const server = args.url ? undefined : await preview({ preview: { port: 0 }, logLevel: "silent" });
const baseURL = args.url ?? server?.resolvedUrls?.local[0];
if (!baseURL) throw new Error("vite preview didn't report a local URL");

// Chromium's memory measurement (bench/harness/page.ts) needs the full browser, not Playwright's
// default headless shell, and without ForceEagerMeasureMemory it waits for the next garbage
// collection, which can take 20 seconds or more.
const browser = await browserType.launch(
  browserName === "chromium"
    ? { channel: "chromium", args: ["--enable-blink-features=ForceEagerMeasureMemory"] }
    : {},
);
const results: ScenarioResult[] = [];
try {
  for (const scenario of selected) {
    for (const mode of requestedModes ?? scenario.modes) {
      process.stdout.write(`${scenario.name} (${mode}, ${browserName}) … `);
      const result = await measure(browser, scenario, mode, baseURL, iterations);
      results.push(result);
      const summary = Object.entries(result.metrics)
        .map(
          ([m, s]) =>
            `${m} median ${s.median.toFixed(1)} ${s.unit}, p95 ${s.p95.toFixed(1)} ${s.unit}`,
        )
        .join("; ");
      process.stdout.write(`${summary}\n`);
    }
  }

  const commit = describeCommit();
  const timestamp = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    timestamp,
    commit,
    environment: describeEnvironment(browser),
    config: { ...iterations, target: args.url ? "url" : "local-preview", url: args.url ?? null },
    results,
  };
  mkdirSync(args.out, { recursive: true });
  // e.g. 2026-10-15T09-30-00Z-1a2b3c4.json: sorts by time, and names the commit at a glance.
  const fileName = `${timestamp.replace(/\.\d+Z$/, "Z").replaceAll(":", "-")}-${commit.sha.slice(0, 7)}.json`;
  const file = join(args.out, fileName);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Results written to ${relative(process.cwd(), file)}\n`);
  if (commit.dirty) console.warn("Note: the working tree has uncommitted changes (commit.dirty).");
} finally {
  await browser.close();
  await server?.close();
}
