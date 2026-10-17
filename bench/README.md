# Benchmarks

The method, budgets and optimization log live on the [Performance & Benchmarks](https://github.com/Karthik-beta/Blinkql/wiki/Performance-and-Benchmarks) wiki page. This file covers how to run the harness and what it writes.

## Run

```bash
pnpm bench         # build, then run every scenario; writes bench/results/<timestamp>-<sha>.json
pnpm bench:micro   # tinybench micro-benchmarks, printed to the terminal
pnpm bench:data    # generate the datasets into bench/datasets/data/ (git-ignored)
```

`pnpm bench` serves the production build with `vite preview` (same headers as Vercel) and drives it with Playwright's pinned browsers. Options:

| Option | Default | |
|---|---|---|
| `--scenario <name>` | all | Repeatable |
| `--mode <cold\|warm>` | the scenario's modes | Repeatable. **cold**: a fresh browser context (empty cache) per iteration. **warm**: one context for all iterations, primed by the warm-ups |
| `--browser <name>` | `chromium` | `chromium`, `firefox` or `webkit` |
| `--warmup <n>` | `3` | Discarded iterations |
| `--iterations <n>` | `10` | Measured iterations |
| `--url <url>` | local preview | Benchmark a deployment instead |
| `--out <dir>` | `bench/results` | |

## Layout

```
bench/
  run.ts            # `pnpm bench` entry point
  harness/          # iteration loop, statistics, environment capture
  scenarios/        # one file per scenario, registered in index.ts
  micro/            # tinybench micro-benchmarks
  results/          # JSON result files
  datasets/         # deterministic dataset generator (`pnpm bench:data`); output in data/
```

## Datasets

`pnpm bench:data` writes synthetic manufacturing telemetry to `bench/datasets/data/`, which is git-ignored. Each row is one machine-minute: 40 machines, starting 2026-01-01 00:00. Generating everything takes about a minute and about 560 MB of disk.

| File | Rows | Columns |
|---|---|---|
| `telemetry-s-{narrow,wide}.{csv,parquet}` | 100,000 | 8 / 50 |
| `telemetry-m-{narrow,wide}.{csv,parquet}` | 1,000,000 | 8 / 50 |
| `telemetry-l-narrow.parquet` | 10,000,000 | 8 |

Use `--size`, `--shape` and `--format` (each repeatable) to generate a subset, e.g. `pnpm bench:data --size s`.

- **Narrow** (8 columns): `ts`, `machine_id`, `status` (RUN, IDLE or DOWN), `run_seconds`, `total_count`, `good_count`, `temperature_c` and `vibration_mm_s`. The two sensor columns are about 0.5% null.
- **Wide** (50 columns): the narrow columns, plus `line`, `shift`, `part_number`, `operator_id`, `spindle_rpm`, `power_kw`, `pressure_bar`, `coolant_temp_c`, `humidity_pct`, `ambient_temp_c`, `cycle_time_s`, `alarm_code` and `sensor_01`–`sensor_30`.

**Reproducibility.** Every value is a pure function of the seed, row and column. It's computed with integer hashing ([lowbias32](https://nullprogram.com/blog/2018/07/31/)) and plain arithmetic, so thread scheduling and platform maths libraries can't change it. The same seed, `GENERATOR_VERSION` (`bench/datasets/schema.ts`) and DuckDB version produce byte-identical files. `manifest.json` records each file's SHA-256, so results from different machines can be checked against the same data. Unit tests pin the hashes of small samples, so CI catches any change to the output.

## Scenarios

| Name | Modes | Metrics |
|---|---|---|
| `time-to-app-shell` | cold, warm | `timeToAppShell` (ms): navigation start until the `blinkql:app-shell` mark |
| `time-to-engine-ready` | cold, warm | `timeToEngineReady` (ms): navigation start until the `blinkql:engine-ready` mark. `bytesTransferred`: response headers and bodies downloaded until then, the engine's worker included; cached responses count 0 |
| `dataset-<size>-<shape>-<format>` | warm | One per S and M dataset, e.g. `dataset-m-wide-csv`. Each iteration opens the workbench, imports the file with the file picker and runs SQL through the editor, like a user. See below |

The dataset scenarios record, per iteration:

| Metric | Measures |
|---|---|
| `importMs` | The `blinkql:import` measure: registering the file, creating its view and reading its schema |
| `firstQueryMs` | `SELECT count(*)` straight after the import |
| `scanMs`, `filterMs`, `groupByMs`, `joinMs`, `windowMs` | The query set (`querySet` in `scenarios/datasets.ts`). Each returns at most 40 rows, so the time is the engine's work |
| `resultQueryMs` | `SELECT * … LIMIT 10000`: the engine's work plus transferring 10,000 rows to the main thread |
| `resultCountMs` | The same rows counted in the engine instead, so `resultQueryMs − resultCountMs` is the cost of the transfer |
| `resultConvertMs` | The `blinkql:results-convert` measure: the 10,000 rows copied out of Arrow into row objects |
| `resultRenderMs` | The `blinkql:results-render` measure: the result reaching the main thread until the frame after its rows are committed (converting included) |
| `memoryBytes`, `workerMemoryBytes` | `performance.measureUserAgentSpecificMemory()` with the 10,000 rows on screen: the whole page, and the engine's worker within it. Chromium only; left out elsewhere |

Query times (`*Ms` above, except import and render) are the `blinkql:query` measure: from sending the SQL to the engine until the Arrow result is on the main thread. A CSV view reads the file again on every query, so CSV query times include parsing it.

Chromium runs as the full browser in headless mode (`channel: "chromium"`) rather than Playwright's default headless shell, which lacks the memory API.

To add a scenario, create `bench/scenarios/<name>.ts` exporting a `Scenario` (`bench/harness/types.ts`) and add it to `scenarios/index.ts`; `harness/page.ts` has helpers that drive the workbench. The app records marks and measures through `src/lib/user-timing.ts`. Their names and scenario names are compared across commits, so don't rename them.

## Result file

```jsonc
{
  "schemaVersion": 1,
  "timestamp": "2026-10-15T05:35:55.000Z",
  "commit": { "sha": "…", "dirty": false },       // dirty: tracked files had uncommitted changes
  "environment": {
    "os": { "platform": "win32", "release": "…", "arch": "x64" },
    "cpu": { "model": "…", "cores": 8 },
    "memoryBytes": 25659326464,
    "node": "v24.21.0",
    "browser": { "name": "chromium", "version": "156.0.8078.4" },
    "ci": false
  },
  "config": { "warmup": 3, "measured": 10, "target": "local-preview", "url": null },
  "results": [
    {
      "scenario": "time-to-app-shell",
      "description": "…",
      "mode": "cold",
      "metrics": {
        "timeToAppShell": {
          "unit": "ms",
          "median": 183.35, "p95": 194.789, "min": 173.705, "max": 197.365, "mean": 184.135,
          "samples": [197.365, 190.745, "…"]               // measurement order
        }
      }
    }
  ]
}
```

Median and p95 interpolate linearly between ranks (the NumPy/R default), so the p95 of 10 samples lies between the 9th and 10th. Values are rounded to the microsecond.
