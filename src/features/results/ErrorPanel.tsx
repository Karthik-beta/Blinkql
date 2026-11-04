import { CircleAlert, Crosshair, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeError, type EngineError, lineAt } from "./engine-error";

/** At most this many characters either side of the error, so a long line still fits. */
const CONTEXT = 60;

/** The line with the error and a caret under it, as DuckDB prints it. */
function Excerpt({ sql, position }: { sql: string; position: number }) {
  const line = lineAt(sql, position);
  const from = Math.max(0, line.column - CONTEXT);
  const before = from > 0 ? "…" : "";
  const after = line.column + CONTEXT < line.text.length ? "…" : "";
  const text = before + line.text.slice(from, line.column + CONTEXT) + after;
  const caret = " ".repeat(before.length + line.column - from);
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-muted-foreground">Line {line.number}</figcaption>
      <pre className="overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono text-foreground">
        {text}
        {"\n"}
        <span aria-hidden className="text-destructive">
          {caret}^
        </span>
      </pre>
    </figure>
  );
}

type Props = {
  error: EngineError;
  sql: string;
  /** Shown as "Go to error" when the error's position can still be found in the editor. */
  onGoTo?: () => void;
  /** Shown as "Restart engine" when the engine crashed. */
  onRestart?: () => void;
};

/** What went wrong with the last query, where, and what to try. */
export function ErrorPanel({ error, sql, onGoTo, onRestart }: Props) {
  const { title, hint, label } = describeError(error);
  const showsMessage = error.message.trim() !== title;

  return (
    <div
      role="alert"
      aria-labelledby="query-error-title"
      className="flex max-h-[40%] shrink-0 flex-col gap-2 overflow-y-auto border-t bg-background px-3 py-2 text-xs"
    >
      <div className="flex items-start gap-2">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span id="query-error-title" className="font-medium text-destructive text-sm">
              {title}
            </span>
            <span className="text-muted-foreground">{label}</span>
          </p>
          {hint && <p>{hint}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {onGoTo && (
            <Button variant="outline" size="sm" onClick={onGoTo}>
              <Crosshair data-icon="inline-start" aria-hidden />
              Go to error
            </Button>
          )}
          {error.crashed && onRestart && (
            <Button size="sm" onClick={onRestart}>
              <RotateCcw data-icon="inline-start" aria-hidden />
              Restart engine
            </Button>
          )}
        </div>
      </div>

      {error.position !== undefined && <Excerpt sql={sql} position={error.position} />}

      {showsMessage && (
        <details>
          <summary className="cursor-default text-muted-foreground">DuckDB's message</summary>
          <pre className="mt-1 whitespace-pre-wrap font-mono">{error.message.trim()}</pre>
        </details>
      )}
    </div>
  );
}
