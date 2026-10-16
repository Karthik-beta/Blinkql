import { RotateCcw } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  type EngineStatus,
  getEngineStatus,
  startEngine,
  subscribeToEngineStatus,
} from "@/engine/engine";
import { CatalogPanel } from "@/features/catalog/CatalogPanel";
import { FileDropOverlay } from "@/features/catalog/FileDropOverlay";
import { QueryPanel } from "@/features/editor/QueryPanel";
import { ResultsTable } from "@/features/results/ResultsTable";
import { markOnce, marks } from "@/lib/user-timing";
import wordmarkDark from "../../brand/logo/blinkql-wordmark-dark.svg";
import wordmarkLight from "../../brand/logo/blinkql-wordmark-light.svg";
import { restart } from "./restart";

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

  useEffect(() => {
    // Benchmarked as "time to app shell" (bench/scenarios/time-to-app-shell.ts).
    markOnce(marks.appShell);
    // Start the engine while the user is still looking around, so the first query doesn't wait.
    startEngine();
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-11 shrink-0 items-center border-b bg-chrome px-4">
        <img src={wordmarkLight} alt="Blinkql" className="h-5 w-auto dark:hidden" />
        <img src={wordmarkDark} alt="Blinkql" className="hidden h-5 w-auto dark:block" />
      </header>
      <div className="flex min-h-0 flex-1">
        <CatalogPanel />
        <main aria-label="Workspace" className="flex min-w-0 flex-1 flex-col">
          <QueryPanel onRestart={() => void restart()} />
          <ResultsTable />
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
