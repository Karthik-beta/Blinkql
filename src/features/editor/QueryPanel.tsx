import { Play } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { formatDuration, formatRows } from "@/features/results/format";
import {
  getQueryRun,
  type QueryRun,
  runQuery,
  subscribeToQueryRun,
} from "@/features/results/query-run";
import { SqlEditor, type SqlEditorHandle } from "./SqlEditor";
import { runShortcut } from "./shortcut";

/** Milliseconds since `startedAt`, updated ten times a second while `active`. */
function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(performance.now());
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}

function Summary({ run }: { run: QueryRun }) {
  switch (run.state) {
    case "idle":
      return <span>Press {runShortcut.label} to run the query.</span>;
    case "running":
      return <span>Running…</span>;
    case "done":
      return (
        <span>
          {formatRows(run.table.numRows)} in {formatDuration(run.durationMs)}
        </span>
      );
    case "failed":
      return null;
  }
}

/** The SQL editor with its toolbar (Run) and, below it, the results bar. */
export function QueryPanel() {
  const run = useSyncExternalStore(subscribeToQueryRun, getQueryRun);
  const editor = useRef<SqlEditorHandle>(null);
  const running = run.state === "running";
  const elapsed = useElapsed(running ? run.startedAt : null);

  return (
    <section aria-label="Query" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-end border-b bg-chrome px-2">
        <Button
          // Stays focusable while running, so keyboard focus isn't lost mid-query.
          focusableWhenDisabled
          disabled={running}
          aria-keyshortcuts={runShortcut.aria}
          onClick={() => void runQuery(editor.current?.sqlToRun() ?? "")}
        >
          <Play data-icon="inline-start" aria-hidden />
          {running ? (
            <>
              Running <span className="tabular-nums">{formatDuration(elapsed)}</span>
            </>
          ) : (
            <>
              Run
              <kbd
                aria-hidden
                className="ml-1 rounded-sm border border-primary-foreground/40 px-1 font-sans font-normal"
              >
                {runShortcut.keys}
              </kbd>
            </>
          )}
        </Button>
      </div>

      <SqlEditor ref={editor} onRun={(sql) => void runQuery(sql)} />

      <div className="flex h-10 shrink-0 items-center gap-2 border-t bg-chrome px-3 text-xs">
        <p aria-live="polite" className="text-muted-foreground tabular-nums">
          <Summary run={run} />
        </p>
        {run.state === "failed" && (
          <p
            role="alert"
            className="min-w-0 truncate font-mono text-destructive"
            title={run.error.message}
          >
            Query failed: {run.error.message}
          </p>
        )}
      </div>
    </section>
  );
}
