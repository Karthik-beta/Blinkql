import { Play, Square } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ErrorPanel } from "@/features/results/ErrorPanel";
import { errorSpan, parseEngineError } from "@/features/results/engine-error";
import { formatDuration, formatRows } from "@/features/results/format";
import {
  cancelQuery,
  getQueryRun,
  type QueryRun,
  runQuery,
  subscribeToQueryRun,
} from "@/features/results/query-run";
import type { SqlEditorHandle, SqlRange } from "./SqlEditor";
import { runShortcut } from "./shortcut";

// CodeMirror is almost half of the workbench's script, so it loads after the first paint instead of
// holding it up. Until it arrives, the editor's space stays empty and nothing around it moves.
const SqlEditor = lazy(() =>
  import("./SqlEditor").then(({ SqlEditor }) => ({ default: SqlEditor })),
);

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
          {formatRows(run.rowCount)} in {formatDuration(run.durationMs)}
        </span>
      );
    case "cancelled":
      return <span>Cancelled after {formatDuration(run.durationMs)}</span>;
    case "failed":
      return <span>Failed after {formatDuration(run.durationMs)}</span>;
  }
}

type Props = {
  /** Restarts the engine, offered when it crashed. */
  onRestart?: () => void;
};

/** The SQL editor with its toolbar (Run) and, below it, the results bar. */
export function QueryPanel({ onRestart }: Props) {
  const run = useSyncExternalStore(subscribeToQueryRun, getQueryRun);
  const editor = useRef<SqlEditorHandle>(null);
  const running = run.state === "running";
  const elapsed = useElapsed(running ? run.startedAt : null);

  const failure = useMemo(() => {
    if (run.state !== "failed") return null;
    const error = parseEngineError(run.error, run.sql);
    const range: SqlRange | null =
      error.position === undefined
        ? null
        : { sql: run.sql, from: run.editorOffset, ...errorSpan(run.sql, error.position) };
    return { error, range };
  }, [run]);

  // Underline the error in the editor; whether "Go to error" can work depends on it.
  const [marked, setMarked] = useState(false);
  useEffect(() => {
    const range = failure?.range;
    setMarked(range ? (editor.current?.markError(range) ?? false) : false);
    if (!range) editor.current?.clearError();
  }, [failure]);

  // Escape cancels from anywhere on the page, unless something else (e.g. autocomplete) used it.
  useEffect(() => {
    if (!running) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) cancelQuery();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running]);

  const runSql = ({ sql, from }: { sql: string; from: number }) => void runQuery(sql, from);

  return (
    <section aria-label="Query" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-end gap-2 border-b bg-chrome px-2">
        {running && (
          <Button variant="outline" aria-keyshortcuts="Escape" onClick={cancelQuery}>
            <Square data-icon="inline-start" aria-hidden />
            Cancel
            <kbd aria-hidden className="ml-1 rounded-sm border px-1 font-sans font-normal">
              Esc
            </kbd>
          </Button>
        )}
        <Button
          // Stays focusable while running, so keyboard focus isn't lost mid-query.
          focusableWhenDisabled
          disabled={running}
          aria-keyshortcuts={runShortcut.aria}
          onClick={() => editor.current && runSql(editor.current.sqlToRun())}
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

      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <SqlEditor ref={editor} onRun={runSql} />
      </Suspense>

      <div className="flex h-10 shrink-0 items-center gap-2 border-t bg-chrome px-3 text-xs">
        <p aria-live="polite" className="text-muted-foreground tabular-nums">
          <Summary run={run} />
        </p>
      </div>

      {run.state === "failed" && failure && (
        <ErrorPanel
          error={failure.error}
          sql={run.sql}
          onGoTo={
            marked && failure.range
              ? () => failure.range && editor.current?.goTo(failure.range)
              : undefined
          }
          onRestart={onRestart}
        />
      )}
    </section>
  );
}
