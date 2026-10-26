import { RotateCcw } from "lucide-react";
import { lazy, Profiler, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  type EngineStatus,
  getEngineStatus,
  startEngine,
  subscribeToEngineStatus,
} from "@/engine/engine";
import { CatalogPanel } from "@/features/catalog/CatalogPanel";
import { restoreDatasets } from "@/features/catalog/catalog";
import { FileDropOverlay } from "@/features/catalog/FileDropOverlay";
import { getChartPreset, subscribeToChartPreset } from "@/features/charts/chart-preset";
import { QueryPanel } from "@/features/editor/QueryPanel";
import { HistoryPanel } from "@/features/history/HistoryPanel";
import { startHistory } from "@/features/history/history";
import { ExportButtons } from "@/features/results/ExportButtons";
import { ResultsTable } from "@/features/results/ResultsTable";
import { TemplatesDialog } from "@/features/templates/TemplatesDialog";
import { afterNextPaint, markOnce, marks, recordCommit } from "@/lib/user-timing";
import wordmarkDark from "../../brand/logo/blinkql-wordmark-dark.svg";
import wordmarkLight from "../../brand/logo/blinkql-wordmark-light.svg";
import { restart } from "./restart";

// The chart panel loads when it's first shown; many sessions only use the table.
const ChartPanel = lazy(() =>
  import("@/features/charts/ChartPanel").then(({ ChartPanel }) => ({ default: ChartPanel })),
);

function describeEngine(status: EngineStatus): string {
  switch (status.state) {
    case "idle":
    case "starting":
      return "Starting engine…";
    case "ready":
      return `Engine ready · DuckDB ${status.version}`;
    case "failed":
      return `Engine failed to start: ${status.error.message}`;
    case "crashed":
      return `Engine stopped: ${status.error.message}`;
  }
}

export function App() {
  const engine = useSyncExternalStore(subscribeToEngineStatus, getEngineStatus);
  const [showChart, setShowChart] = useState(false);
  const chartPreset = useSyncExternalStore(subscribeToChartPreset, getChartPreset);

  useEffect(() => {
    if (chartPreset) setShowChart(true);
  }, [chartPreset]);

  useEffect(() => {
    // Benchmarked as "time to app shell" (bench/scenarios/time-to-app-shell.ts).
    markOnce(marks.appShell);
    void restoreDatasets();
    void startHistory();
    // Start the engine while the user is still looking around, so the first query doesn't wait,
    // but only once the shell is on screen, so creating the worker doesn't delay the first paint.
    // A query sent before then starts it straight away.
    return afterNextPaint(startEngine);
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-11 shrink-0 items-center border-b bg-chrome px-4">
        <img src={wordmarkLight} alt="Blinkql" className="h-5 w-auto dark:hidden" />
        <img src={wordmarkDark} alt="Blinkql" className="hidden h-5 w-auto dark:block" />
        <div className="ml-auto">
          <TemplatesDialog />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-64 shrink-0 flex-col border-r bg-chrome">
          <CatalogPanel />
          <HistoryPanel />
        </div>
        <main aria-label="Workspace" className="flex min-w-0 flex-1 flex-col">
          <QueryPanel onRestart={() => void restart()} />
          <div className="flex items-center gap-3 border-t px-3 py-1">
            <fieldset aria-label="Results view" className="flex gap-1">
              <Button
                variant={showChart ? "ghost" : "secondary"}
                size="sm"
                aria-pressed={!showChart}
                onClick={() => setShowChart(false)}
              >
                Table
              </Button>
              <Button
                variant={showChart ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={showChart}
                onClick={() => setShowChart(true)}
              >
                Chart
              </Button>
            </fieldset>
            <ExportButtons />
          </div>
          {/* The table stays mounted under the chart, so it keeps its scroll and selection. */}
          <div hidden={showChart} className="flex min-h-0 flex-1 flex-col">
            {/* Reports each render of the results to the benchmark in profiling builds. */}
            <Profiler id="results" onRender={recordCommit}>
              <ResultsTable />
            </Profiler>
          </div>
          {showChart && (
            // Fills the chart's space while it loads, so the bars around it don't move.
            <Suspense fallback={<div className="min-h-0 flex-1 border-t" />}>
              <ChartPanel />
            </Suspense>
          )}
        </main>
      </div>
      <footer className="flex h-7 shrink-0 items-center gap-2 border-t bg-chrome px-4">
        <p
          role="status"
          className={`min-w-0 truncate text-xs ${
            engine.state === "failed" || engine.state === "crashed"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {describeEngine(engine)}
        </p>
        {(engine.state === "failed" || engine.state === "crashed") && (
          <Button variant="outline" size="xs" onClick={() => void restart()}>
            <RotateCcw data-icon="inline-start" aria-hidden />
            Restart engine
          </Button>
        )}
      </footer>
      <FileDropOverlay />
    </div>
  );
}
