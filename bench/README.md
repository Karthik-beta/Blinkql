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
| `first-rows-<dataset>` | warm | How soon a large result's first rows show, with no LIMIT: every row of `m-narrow-parquet`, `m-narrow-csv` and `s-wide-parquet`, and `m-narrow-parquet-filter` (`WHERE status = 'DOWN'`, about 5% of the rows). See [First rows](#first-rows) |
| `scroll-<rows>-<shape>` | warm | Showing and scrolling a large result: `scroll-10k-narrow`, `scroll-100k-narrow` and `scroll-1m-narrow` (from `telemetry-m-narrow.parquet`), `scroll-10k-wide` and `scroll-100k-wide` (from `telemetry-s-wide.parquet`). See [Scrolling](#scrolling) |
| `rerun-while-running` | warm | `rerunMs`: pressing Run on `SELECT 42` while a slow query (a few seconds) is still running, until its row shows. `attempts`: how many times Run had to be pressed; until P-06 a run during another was ignored, so it took two. No dataset needed |
| `chart-line-1m-<sql\|client>` | warm | A line chart of `avg(y)` over a million-row computed series, downsampled to 1,000 points in the engine (`sql`, the default) or with LTTB on the main thread (`client`, `?downsample=client`). See [Line charts](#line-charts). No dataset needed |

The dataset scenarios record, per iteration:

| Metric | Measures |
|---|---|
| `importMs` | The `blinkql:import` measure: registering the file, creating its view and reading its schema |
| `firstQueryMs` | `SELECT count(*)` straight after the import |
| `scanMs`, `filterMs`, `groupByMs`, `joinMs`, `windowMs` | The query set (`querySet` in `scenarios/datasets.ts`). Each returns at most 40 rows, so the time is the engine's work |
| `resultQueryMs` | `SELECT * … LIMIT 10000`: the engine's work plus transferring 10,000 rows to the main thread |
| `resultCountMs` | The same rows counted in the engine instead, so `resultQueryMs − resultCountMs` is the cost of the transfer |
| `resultConvertMs` | The `blinkql:results-convert` measure: preparing the 10,000 rows for the table. Until P-02 this copied them out of Arrow into row objects; since P-02 it only sets up a reader per column, and cells are read as they render |
| `resultRenderMs` | The `blinkql:results-render` measure: the result reaching the main thread until the frame after its rows are committed (preparing, reading and formatting cells included) |
| `resultFirstRowsMs` | The `blinkql:first-rows` measure: pressing Run until the frame after the result's first rows are committed, which is how long the user waits to see rows. Until P-05 the first rows came with the whole result |
| `resultFirstRowsRenderMs` | The `blinkql:first-rows-render` measure: the first rows reaching the main thread until the frame after they're committed. Budget: 100 ms |
| `memoryBytes`, `workerMemoryBytes` | `performance.measureUserAgentSpecificMemory()` with the 10,000 rows on screen: the whole page, and the engine's worker within it. Chromium only; left out elsewhere |
| `resultLongestFrameMs` | The longest animation frame from pressing Run until the 10,000 rows are shown, or 0 if none took 50 ms or more: the longest the page went without responding, style, layout and paint included. Chromium only (the Long Animation Frames API; the Long Tasks API leaves out tasks that run no script, such as a frame spent laying out the table) |
| `nextQueryRenderMs`, `nextQueryLongestFrameMs` | The same two measures for a one-row query (`scan`) run next, while the 10,000 rows are still on screen: what a large result costs the UI while it is replaced |
| `nextQueryMemoryBytes` | The page's memory after that query, once the 10,000 rows have been replaced. Chromium only |
| `resultCommits`, `resultReactMs`, `nextQueryCommits`, `nextQueryReactMs` | React's profiling build only (see below): how many times React rendered the results table in each of those two steps, and the total time it spent rendering it (the `<Profiler>`'s `actualDuration`) |

Query times (`*Ms` above, except import and render) are the `blinkql:query` measure: from sending the SQL to the engine until the Arrow result is on the main thread. A CSV view reads the file again on every query, so CSV query times include parsing it.

Chromium runs as the full browser in headless mode (`channel: "chromium"`) rather than Playwright's default headless shell, which lacks the memory API.

### Scrolling

Each `scroll-*` iteration imports its file, shows `SELECT * … LIMIT <rows>` and then scrolls the results twice from the top, moving them once per frame from `requestAnimationFrame` for 5 seconds each:

- **wheel**: a steady 3,000 px a second, like spinning a mouse wheel fast;
- **drag**: from the first row to the last, like dragging the scrollbar down. Every frame shows rows the last one didn't, so this is the hardest case for a virtualized grid.

| Metric | Measures |
|---|---|
| `renderMs`, `renderLongestFrameMs` | As `resultRenderMs` and `resultLongestFrameMs` above, for this many rows |
| `firstRowsMs`, `firstRowsRenderMs` | As `resultFirstRowsMs` and `resultFirstRowsRenderMs` above |
| `memoryBytes` | The page's memory with the rows on screen. Chromium only |
| `<kind>FrameMedianMs`, `<kind>FrameP95Ms` | The median and 95th percentile of the time between frames while scrolling. Headless Chromium draws at 75 Hz, so a smooth scroll is about 13.3 ms |
| `<kind>SlowFrames` | Frames that took more than 25 ms, so the display showed the previous frame again |
| `<kind>LongestFrameMs` | The longest animation frame while scrolling, as above. It only counts the main thread: a frame that is slow because the compositor is still rasterizing a large table shows in the frame times, not here |

Before P-04 every row is rendered, which makes the 100,000- and 1,000,000-row scenarios slow or impossible to run; pick the ones a build can run with `--scenario`.

### First rows

DuckDB computes a `LIMIT` or `ORDER BY` in full before it hands over any rows, so the dataset and scroll scenarios, which use `LIMIT`, can't show a result's first rows before the rest. The `first-rows-*` scenarios run queries DuckDB can stream, and record:

| Metric | Measures |
|---|---|
| `firstRowsMs`, `firstRowsRenderMs` | As `resultFirstRowsMs` and `resultFirstRowsRenderMs` above |
| `queryMs` | The `blinkql:query` measure: until the last of the result is on the main thread |
| `renderMs` | As `resultRenderMs` above: the last rows on the main thread until they're shown |
| `longestFrameMs` | The longest animation frame from pressing Run until every row is shown, as `resultLongestFrameMs` above |
| `memoryBytes` | The page's memory with the result on screen. Chromium only |

### Line charts

Each `chart-line-1m-*` iteration runs `SELECT range AS x, sin(range / 1000.0) + random() * 0.1 AS y FROM range(1000000)`, opens the Chart view, picks avg of y on the bar chart, then switches to Line and records:

| Metric | Measures |
|---|---|
| `chartRenderMs` | The `blinkql:chart-render` measure: choosing Line until the frame after ECharts has drawn it, the chart's query and any downsampling on the main thread included |
| `chartLongestFrameMs` | The longest animation frame in that time, as `resultLongestFrameMs` above |
| `hoverFrameMedianMs`, `hoverFrameP95Ms` | The median and 95th percentile of the time between frames while the pointer moves across the chart for 2 seconds, moving its tooltip |
| `hoverSlowFrames`, `hoverLongestFrameMs` | Frames slower than 25 ms while hovering, and the longest animation frame, as for scrolling |

### React's profiling build

```bash
BLINKQL_REACT_PROFILING=1 pnpm bench --scenario dataset-s-wide-parquet
```

builds the app with React's profiling build (`react-dom/profiling`), in which the `<Profiler>` around the results table (`src/app/App.tsx`) reports every render as a `blinkql:react-commit` measure. The dataset scenarios then also record the `*Commits` and `*ReactMs` metrics above. Profiling makes React slower, so compare a profiling run only with another profiling run; the result file says which it is (`config.reactProfiling`).

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
  "config": { "warmup": 3, "measured": 10, "target": "local-preview", "url": null, "reactProfiling": false },
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
