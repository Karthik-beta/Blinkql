# Benchmarks

The method, budgets and optimization log live on the [Performance & Benchmarks](https://github.com/Karthik-beta/Blinkql/wiki/Performance-and-Benchmarks) wiki page. This file covers how to run the harness and what it writes.

## Run

```bash
pnpm bench         # build, then run every scenario; writes bench/results/<timestamp>-<sha>.json
pnpm bench:micro   # tinybench micro-benchmarks, printed to the terminal
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
  datasets/         # deterministic datasets (`pnpm bench:data`, coming in #7)
```

## Scenarios

| Name | Metric | Measures |
|---|---|---|
| `time-to-app-shell` | `timeToAppShell` (ms) | Navigation start until the `blinkql:app-shell` User Timing mark |

To add one, create `bench/scenarios/<name>.ts` exporting a `Scenario` (`bench/harness/types.ts`) and add it to `scenarios/index.ts`. The app records marks through `markOnce()` in `src/lib/user-timing.ts`; mark and scenario names are compared across commits, so don't rename them.

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
