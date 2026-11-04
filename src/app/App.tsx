import { PanelLeft, RotateCcw, X } from "lucide-react";
import {
  lazy,
  Profiler,
  type RefObject,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  type EngineStatus,
  getEngineStatus,
  startEngine,
  subscribeToEngineStatus,
} from "@/engine/engine";
import { type CatalogHandle, CatalogPanel } from "@/features/catalog/CatalogPanel";
import { getCatalog, restoreDatasets, subscribeToCatalog } from "@/features/catalog/catalog";
import { FileDropOverlay } from "@/features/catalog/FileDropOverlay";
import { getChartPreset, subscribeToChartPreset } from "@/features/charts/chart-preset";
import { CommandPalette } from "@/features/commands/CommandPalette";
import type { Command } from "@/features/commands/command";
import { ShortcutsDialog } from "@/features/commands/ShortcutsDialog";
import { QueryPanel, type QueryPanelHandle } from "@/features/editor/QueryPanel";
import { runShortcut } from "@/features/editor/shortcut";
import { HistoryPanel } from "@/features/history/HistoryPanel";
import { startHistory } from "@/features/history/history";
import { ExportButtons, type ExportHandle, exportFormats } from "@/features/results/ExportButtons";
import { cancelQuery, getQueryRun, subscribeToQueryRun } from "@/features/results/query-run";
import { ResultsTable } from "@/features/results/ResultsTable";
import { samples } from "@/features/samples/samples";
import { ShareDialog, type ShareHandle } from "@/features/share/ShareDialog";
import { TemplatesDialog, type TemplatesHandle } from "@/features/templates/TemplatesDialog";
import { Tour, TourInvite } from "@/features/tour/Tour";
import { startTour } from "@/features/tour/tour-step";
import { afterNextPaint, markOnce, marks, recordCommit } from "@/lib/user-timing";
import wordmarkDark from "../../brand/logo/blinkql-wordmark-dark.svg";
import wordmarkLight from "../../brand/logo/blinkql-wordmark-light.svg";
import { OfflineIndicator } from "./OfflineIndicator";
import { restart } from "./restart";
import { UpdatePrompt } from "./UpdatePrompt";

// The chart panel loads when it's first shown; many sessions only use the table.
const ChartPanel = lazy(() =>
  import("@/features/charts/ChartPanel").then(({ ChartPanel }) => ({ default: ChartPanel })),
);

// Below Tailwind's lg breakpoint the sidebar no longer fits beside the workspace, so it becomes a
// sheet that slides over it (Design Language, "Smaller screens").
const narrowScreen = "(width < 64rem)";

/** What had the focus as the screen last changed width, before the layout changed with it. */
let focusedAtWidthChange: Element | null = null;

function subscribeToScreenWidth(listener: () => void): () => void {
  const query = matchMedia(narrowScreen);
  const onChange = () => {
    focusedAtWidthChange = document.activeElement;
    listener();
  };
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const isNarrowScreen = () => matchMedia(narrowScreen).matches;

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

/** The parts of the workbench whose actions the command palette runs. */
type Handles = {
  queryPanel: RefObject<QueryPanelHandle | null>;
  catalogPanel: RefObject<CatalogHandle | null>;
  templates: RefObject<TemplatesHandle | null>;
  exportButtons: RefObject<ExportHandle | null>;
  share: RefObject<ShareHandle | null>;
};

/**
 * The command palette with every core action, each doing what its button does, and the shortcut
 * reference it opens. A component of its own, so a query starting or finishing re-renders just
 * the palette, not the whole workbench.
 */
function Commands({
  handles: { queryPanel, catalogPanel, templates, exportButtons, share },
  onShowChart,
}: {
  handles: Handles;
  onShowChart: (show: boolean) => void;
}) {
  const queryRun = useSyncExternalStore(subscribeToQueryRun, getQueryRun);
  const catalog = useSyncExternalStore(subscribeToCatalog, getCatalog);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const commands: Command[] = [
    {
      id: "run",
      label: "Run query",
      shortcut: runShortcut.label,
      disabled: queryRun.state === "running",
      run: () => queryPanel.current?.run(),
    },
    {
      id: "cancel",
      label: "Cancel query",
      shortcut: "Esc",
      disabled: queryRun.state !== "running",
      run: cancelQuery,
    },
    { id: "table", label: "Show table", run: () => onShowChart(false) },
    { id: "chart", label: "Show chart", run: () => onShowChart(true) },
    ...exportFormats.map(({ format, label }) => ({
      id: `export-${format}`,
      label: `Export as ${label}`,
      disabled: queryRun.state !== "done" || queryRun.rowCount === 0,
      run: () => exportButtons.current?.exportAs(format),
    })),
    {
      id: "share",
      label: "Share query",
      disabled: queryRun.state !== "done",
      run: () => share.current?.open(),
    },
    { id: "templates", label: "Browse templates", run: () => templates.current?.open() },
    { id: "import", label: "Import files", run: () => catalogPanel.current?.importFiles() },
    ...samples.map(({ name, title }) => ({
      id: `sample-${name}`,
      label: `Load sample data: ${title}`,
      disabled: catalog.tables.some((table) => table.name === name),
      run: () => catalogPanel.current?.loadSample(name),
    })),
    { id: "tour", label: "Take the tour", run: startTour },
    { id: "restart", label: "Restart engine", run: () => void restart() },
    { id: "shortcuts", label: "Show keyboard shortcuts", run: () => setShortcutsOpen(true) },
  ];
  return (
    <>
      <CommandPalette commands={commands} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}

export function App() {
  const engine = useSyncExternalStore(subscribeToEngineStatus, getEngineStatus);
  const [showChart, setShowChart] = useState(false);
  const chartPreset = useSyncExternalStore(subscribeToChartPreset, getChartPreset);
  const narrow = useSyncExternalStore(subscribeToScreenWidth, isNarrowScreen);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const tablesButton = useRef<HTMLButtonElement>(null);
  const workspace = useRef<HTMLElement>(null);

  // The sidebar is back beside the workspace, as when a tablet turns sideways, so the sheet is
  // closed for when the screen narrows again. If the focus was on something that went with the
  // narrow layout, such as Tables or the sheet, it's put in the workspace instead of being lost.
  useEffect(() => {
    if (narrow) return;
    setSidebarOpen(false);
    if (focusedAtWidthChange?.isConnected === false) workspace.current?.focus();
    focusedAtWidthChange = null;
  }, [narrow]);

  useEffect(() => {
    if (chartPreset) setShowChart(true);
  }, [chartPreset]);

  const handles: Handles = {
    queryPanel: useRef(null),
    catalogPanel: useRef(null),
    templates: useRef(null),
    exportButtons: useRef(null),
    share: useRef(null),
  };

  // A query started from the sheet, such as Show rows or a history entry, closes it, so the
  // results it's about to show aren't hidden behind it.
  useEffect(
    () =>
      subscribeToQueryRun(() => {
        if (getQueryRun().state === "running") setSidebarOpen(false);
      }),
    [],
  );

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

  const sidebar = (
    <>
      <CatalogPanel ref={handles.catalogPanel} />
      <HistoryPanel />
    </>
  );

  return (
    <div className="flex h-dvh flex-col">
      {/* The sidebar can hold hundreds of buttons (history). Focused here rather than by following
          the link, so the URL stays as it is. */}
      {/* biome-ignore lint/a11y/useValidAnchor: skip links are links, which is what screen reader users expect to find */}
      <a
        href="#workspace"
        className="sr-only z-50 rounded-md border bg-popover px-3 py-1 text-popover-foreground text-xs focus:not-sr-only focus:fixed focus:top-2 focus:left-4 focus:outline-2 focus:outline-ring"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("workspace")?.focus();
        }}
      >
        Skip to the workspace
      </a>
      <header className="flex h-11 shrink-0 items-center border-b bg-chrome px-4">
        {narrow && (
          <Button
            ref={tablesButton}
            variant="outline"
            size="sm"
            className="mr-3"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <PanelLeft data-icon="inline-start" aria-hidden />
            Tables
          </Button>
        )}
        <img src={wordmarkLight} alt="Blinkql" className="h-5 w-auto dark:hidden" />
        <img src={wordmarkDark} alt="Blinkql" className="hidden h-5 w-auto dark:block" />
        <div className="ml-auto flex gap-2">
          <Commands handles={handles} onShowChart={setShowChart} />
          <TemplatesDialog ref={handles.templates} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {narrow ? (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            {/* Named, because Safari doesn't focus a tapped button for the sheet to go back to. */}
            <SheetContent finalFocus={tablesButton}>
              {/* Lines up with the top bar, so Close is where Tables was. */}
              <div className="flex h-11 shrink-0 items-center border-b px-4">
                <SheetClose render={<Button variant="outline" size="sm" />}>
                  <X data-icon="inline-start" aria-hidden />
                  Close
                </SheetClose>
                <SheetTitle className="sr-only">Tables and queries</SheetTitle>
              </div>
              {sidebar}
            </SheetContent>
          </Sheet>
        ) : (
          <div className="flex w-64 shrink-0 flex-col border-r bg-chrome">{sidebar}</div>
        )}
        <main
          ref={workspace}
          id="workspace"
          aria-label="Workspace"
          tabIndex={-1}
          className="flex min-w-0 flex-1 flex-col outline-none"
        >
          <QueryPanel ref={handles.queryPanel} onRestart={() => void restart()} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1">
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
            {/* Wraps below the view buttons as a whole when the bar is too narrow for both. */}
            <div className="ml-auto flex min-w-0 items-center gap-3">
              <ExportButtons ref={handles.exportButtons} />
              <ShareDialog ref={handles.share} />
            </div>
          </div>
          {/* The table stays mounted under the chart, so it keeps its scroll and selection. */}
          <div hidden={showChart} className="relative flex min-h-0 flex-1 flex-col">
            {/* Reports each render of the results to the benchmark in profiling builds. */}
            <Profiler id="results" onRender={recordCommit}>
              <ResultsTable />
            </Profiler>
            <TourInvite />
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
        <div className="ml-auto flex items-center gap-4">
          <UpdatePrompt />
          <OfflineIndicator />
        </div>
      </footer>
      <FileDropOverlay />
      <Tour />
    </div>
  );
}
