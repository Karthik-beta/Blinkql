import { useEffect, useSyncExternalStore } from "react";
import {
  type EngineStatus,
  getEngineStatus,
  startEngine,
  subscribeToEngineStatus,
} from "@/engine/engine";
import { markOnce, marks } from "@/lib/user-timing";
import wordmarkDark from "../../brand/logo/blinkql-wordmark-dark.svg";
import wordmarkLight from "../../brand/logo/blinkql-wordmark-light.svg";

function describeEngine(status: EngineStatus): string {
  switch (status.state) {
    case "idle":
    case "starting":
      return "Starting engine…";
    case "ready":
      return `Engine ready · DuckDB ${status.version}`;
    case "failed":
      return `Engine failed to start: ${status.error.message}`;
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
      <main aria-label="Workspace" className="min-h-0 flex-1" />
      <footer className="flex h-7 shrink-0 items-center border-t bg-chrome px-4">
        <p role="status" className="text-muted-foreground text-xs">
          {describeEngine(engine)}
        </p>
      </footer>
    </div>
  );
}
